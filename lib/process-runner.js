"use strict";

const { spawn } = require("child_process");

/**
 * Run a child process with a hard timeout. A failed or hung external process
 * must settle the caller's promise so an HTTP job can reach a terminal state.
 */
function runCommand(command, args = [], options = {}) {
  const timeoutMs = Number(options.timeoutMs || 0);
  const killGraceMs = Number(options.killGraceMs || 500);
  const spawnOptions = {
    cwd: options.cwd,
    env: options.env,
    stdio: options.stdio || ["ignore", "pipe", "pipe"],
  };

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, spawnOptions);
    } catch (error) {
      reject(error);
      return;
    }

    const stdout = [];
    const stderr = [];
    let settled = false;
    let terminationError = null;
    let timeoutTimer = null;
    let killTimer = null;

    if (child.stdout) child.stdout.on("data", chunk => stdout.push(chunk));
    if (child.stderr) child.stderr.on("data", chunk => stderr.push(chunk));

    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
      if (error) reject(error);
      else resolve(result);
    };

    const terminate = (error) => {
      if (settled || terminationError) return;
      terminationError = error;
      try { child.kill("SIGTERM"); } catch {}
      killTimer = setTimeout(() => {
        if (!settled) {
          try { child.kill("SIGKILL"); } catch {}
        }
      }, Math.max(0, killGraceMs));
    };

    child.on("error", error => finish(terminationError || error));
    child.on("close", (code, signal) => {
      if (terminationError) {
        finish(terminationError);
        return;
      }
      const result = {
        code,
        signal,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
      };
      if (code !== 0) {
        const detail = result.stderr.toString("utf8").slice(0, 200);
        const error = new Error(`${command} exited with code ${code}${signal ? ` (${signal})` : ""}${detail ? `: ${detail}` : ""}`);
        error.code = "CHILD_PROCESS_FAILED";
        error.result = result;
        finish(error);
        return;
      }
      finish(null, result);
    });

    if (timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        const error = new Error(`${command} timed out after ${timeoutMs}ms`);
        error.code = "ETIMEDOUT";
        terminate(error);
      }, timeoutMs);
    }

    if (options.signal) {
      const onAbort = () => {
        const reason = options.signal.reason instanceof Error
          ? options.signal.reason
          : new Error(String(options.signal.reason || "Command aborted"));
        reason.code = reason.code || "ABORT_ERR";
        terminate(reason);
      };
      if (options.signal.aborted) onAbort();
      else options.signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

module.exports = { runCommand };
