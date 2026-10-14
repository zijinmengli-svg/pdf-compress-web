"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const fsp = fs.promises;
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const { createWebSession, requestTokenFor } = require("../lib/web-session");

const ROOT = path.join(__dirname, "..");
const PORT = 3900 + Math.floor(Math.random() * 400);
const SESSION_SECRET = "compression-regression-session-secret";

function request(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks), headers: res.headers }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function makePaddedPdf(bytes) {
  const content = "BT /F1 12 Tf 10 36 Td (TinyPDF) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 72 72] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index < offsets.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  const document = Buffer.from(pdf, "latin1");
  return Buffer.concat([document, Buffer.alloc(bytes - document.length)]);
}

function multipart(pdf, boundary, targetMB = 1) {
  const opening = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="pdf"; filename="highly-compressible.pdf"\r\nContent-Type: application/pdf\r\n\r\n`);
  const target = Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="targetMB"\r\n\r\n${targetMB}\r\n--${boundary}\r\nContent-Disposition: form-data; name="landingLanguage"\r\n\r\nen\r\n--${boundary}--\r\n`);
  return Buffer.concat([opening, pdf, target]);
}

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    const timer = setTimeout(() => reject(new Error(`server did not start: ${stderr}`)), 15000);
    const check = async () => {
      try {
        const response = await request({ hostname: "127.0.0.1", port: PORT, path: "/api/config", method: "GET" });
        if (response.statusCode === 200) { clearTimeout(timer); resolve(); return; }
      } catch {}
      setTimeout(check, 100);
    };
    check();
  });
}

function waitForFinalState(jobId, accessToken, cookie) {
  return new Promise((resolve, reject) => {
    const req = http.get({
      hostname: "127.0.0.1",
      port: PORT,
      path: `/api/jobs/${jobId}/events?access=${encodeURIComponent(accessToken)}`,
      headers: {
        Cookie: cookie,
        "User-Agent": "Mozilla/5.0",
        "Sec-Fetch-Site": "same-origin",
        Referer: `http://127.0.0.1:${PORT}/`,
      },
    }, (res) => {
      let pending = "";
      res.on("data", (chunk) => {
        pending += chunk.toString();
        const events = pending.split("\n\n");
        pending = events.pop();
        for (const event of events) {
          const data = event.split("\n").find((line) => line.startsWith("data: "));
          if (!data) continue;
          const state = JSON.parse(data.slice(6));
          if (["done", "below_range", "error"].includes(state.status)) {
            req.destroy();
            resolve(state);
            return;
          }
        }
      });
    });
    req.on("error", (error) => { if (error.code !== "ECONNRESET") reject(error); });
    setTimeout(() => { req.destroy(); reject(new Error("compression timed out")); }, 30000);
  });
}

async function waitForAnalyticsEvent(filePath, jobId, eventName) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const contents = await fsp.readFile(filePath, "utf8").catch(() => "");
    const match = contents.split("\n").filter(Boolean).map(line => JSON.parse(line))
      .find(event => event.event === eventName && event.data?.jobId === jobId);
    if (match) return match;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`missing ${eventName} analytics for ${jobId}`);
}

(async () => {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "tinypdf-regression-"));
  const actualGs = execFileSync("which", ["gs"]).toString().trim();
  const gsTrace = path.join(tempDir, "gs-pdfwrite-runs.txt");
  const gsWrapper = path.join(tempDir, "gs");
  await fsp.writeFile(gsWrapper, '#!/bin/sh\ncase "$*" in *-sDEVICE=pdfwrite*) printf "x\\n" >> "$GS_TRACE_FILE";; esac\nexec "$REAL_GS" "$@"\n', { mode: 0o755 });
  const analyticsFile = path.join(tempDir, "analytics-events.jsonl");
  const child = spawn(process.execPath, ["server-simple.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), WEB_SESSION_SECRET: SESSION_SECRET, ADMIN_SESSION_SECRET: "admin-session-secret", ANALYTICS_FILE: analyticsFile, PATH: `${tempDir}${path.delimiter}${process.env.PATH}`, REAL_GS: actualGs, GS_TRACE_FILE: gsTrace },
    stdio: ["ignore", "ignore", "pipe"],
  });

  try {
    await waitForServer(child);
    const session = createWebSession(SESSION_SECRET);
    const cookie = `tinypdf_web_session=${encodeURIComponent(session.value)}`;
    const boundary = `----TinyPDF${crypto.randomBytes(8).toString("hex")}`;
    const body = multipart(makePaddedPdf(2 * 1024 * 1024), boundary);
    const response = await request({
      hostname: "127.0.0.1",
      port: PORT,
      path: "/api/jobs",
      method: "POST",
      headers: {
        Cookie: cookie,
        "User-Agent": "Mozilla/5.0",
        "Sec-Fetch-Site": "same-origin",
        Origin: `http://127.0.0.1:${PORT}`,
        Referer: `http://127.0.0.1:${PORT}/`,
        "X-TinyPDF-Web-Token": requestTokenFor(session.value, SESSION_SECRET),
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": body.length,
      },
    }, body);
    assert.strictEqual(response.statusCode, 200);
    const job = JSON.parse(response.body.toString("utf8"));
    const finalState = await waitForFinalState(job.id, job.accessToken, cookie);
    assert.strictEqual(finalState.status, "below_range", "a tiny but valid PDF should remain downloadable without counting as an exact-size success");
    assert(finalState.resultBytes > 0 && finalState.resultBytes < 0.9 * 1024 * 1024);
    const download = await request({
      hostname: "127.0.0.1",
      port: PORT,
      path: `/api/jobs/${job.id}/download?access=${encodeURIComponent(job.accessToken)}`,
      method: "GET",
      headers: {
        Cookie: cookie,
        "User-Agent": "Mozilla/5.0",
        "Sec-Fetch-Site": "same-origin",
        Referer: `http://127.0.0.1:${PORT}/`,
      },
    });
    assert.strictEqual(download.statusCode, 200, "a valid below-range result should be downloadable");
    assert(download.body.subarray(0, 5).equals(Buffer.from("%PDF-")));
    assert.strictEqual(download.body.length, finalState.resultBytes);
    const candidateEvent = await waitForAnalyticsEvent(analyticsFile, job.id, "compress_below_range");
    assert.strictEqual(candidateEvent.data.resultBytes, finalState.resultBytes);
    const analyticsContents = await fsp.readFile(analyticsFile, "utf8");
    assert(!analyticsContents.split("\n").filter(Boolean).map(line => JSON.parse(line))
      .some(event => event.data?.jobId === job.id && ["compress_success", "compress_error"].includes(event.event)),
    "a downloadable below-range result must not be logged as success or error");

    const undersizedBoundary = `----TinyPDF${crypto.randomBytes(8).toString("hex")}`;
    const undersizedBody = multipart(makePaddedPdf(6 * 1024 * 1024), undersizedBoundary, 5);
    const undersizedResponse = await request({
      hostname: "127.0.0.1",
      port: PORT,
      path: "/api/jobs",
      method: "POST",
      headers: {
        Cookie: cookie,
        "User-Agent": "Mozilla/5.0",
        "Sec-Fetch-Site": "same-origin",
        Origin: `http://127.0.0.1:${PORT}`,
        Referer: `http://127.0.0.1:${PORT}/`,
        "X-TinyPDF-Web-Token": requestTokenFor(session.value, SESSION_SECRET),
        "Content-Type": `multipart/form-data; boundary=${undersizedBoundary}`,
        "Content-Length": undersizedBody.length,
      },
    }, undersizedBody);
    assert.strictEqual(undersizedResponse.statusCode, 200);
    const undersizedJob = JSON.parse(undersizedResponse.body.toString("utf8"));
    const undersizedState = await waitForFinalState(undersizedJob.id, undersizedJob.accessToken, cookie);
    assert.strictEqual(undersizedState.status, "below_range", "a 2 MB result must not count as a successful 5 MB result");
    assert(undersizedState.resultBytes < 4 * 1024 * 1024);

    const smallBoundary = `----TinyPDF${crypto.randomBytes(8).toString("hex")}`;
    const smallBody = multipart(makePaddedPdf(2 * 1024 * 1024), smallBoundary, 1.5);
    const smallResponse = await request({
      hostname: "127.0.0.1",
      port: PORT,
      path: "/api/jobs",
      method: "POST",
      headers: {
        Cookie: cookie,
        "User-Agent": "Mozilla/5.0",
        "Sec-Fetch-Site": "same-origin",
        Origin: `http://127.0.0.1:${PORT}`,
        Referer: `http://127.0.0.1:${PORT}/`,
        "X-TinyPDF-Web-Token": requestTokenFor(session.value, SESSION_SECRET),
        "Content-Type": `multipart/form-data; boundary=${smallBoundary}`,
        "Content-Length": smallBody.length,
      },
    }, smallBody);
    assert.strictEqual(smallResponse.statusCode, 200);
    const smallJob = JSON.parse(smallResponse.body.toString("utf8"));
    const smallState = await waitForFinalState(smallJob.id, smallJob.accessToken, cookie);
    assert.strictEqual(smallState.status, "below_range", "an output below 90% of a sub-2-MiB target remains available but is not exact-size success");

    const impossibleBoundary = `----TinyPDF${crypto.randomBytes(8).toString("hex")}`;
    const impossibleBody = multipart(makePaddedPdf(2 * 1024 * 1024), impossibleBoundary, 0.0001);
    const impossibleResponse = await request({
      hostname: "127.0.0.1",
      port: PORT,
      path: "/api/jobs",
      method: "POST",
      headers: {
        Cookie: cookie,
        "User-Agent": "Mozilla/5.0",
        "Sec-Fetch-Site": "same-origin",
        Origin: `http://127.0.0.1:${PORT}`,
        Referer: `http://127.0.0.1:${PORT}/`,
        "X-TinyPDF-Web-Token": requestTokenFor(session.value, SESSION_SECRET),
        "Content-Type": `multipart/form-data; boundary=${impossibleBoundary}`,
        "Content-Length": impossibleBody.length,
      },
    }, impossibleBody);
    assert.strictEqual(impossibleResponse.statusCode, 200);
    const impossibleJob = JSON.parse(impossibleResponse.body.toString("utf8"));
    const impossibleState = await waitForFinalState(impossibleJob.id, impossibleJob.accessToken, cookie);
    assert.strictEqual(impossibleState.status, "error", "a result above the requested maximum must not count as success");
    assert.strictEqual(impossibleState.errorCode, "TARGET_RANGE_TOO_LARGE");
    console.log("compression regression test passed");
  } finally {
    child.kill("SIGTERM");
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
