"use strict";

const assert = require("assert");
const { runCommand } = require("../lib/process-runner");

(async () => {
  const started = Date.now();
  await assert.rejects(
    runCommand(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { timeoutMs: 100 }),
    /timed out/i
  );
  assert.ok(Date.now() - started < 2000, "a hung child process must be terminated promptly");
  console.log("process runner timeout regression test passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
