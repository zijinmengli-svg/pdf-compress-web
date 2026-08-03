"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const fsp = fs.promises;
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
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
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 72 72] /Resources << >> /Contents 4 0 R >>",
    "<< /Length 0 >>\nstream\n\nendstream",
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

function multipart(pdf, boundary) {
  const opening = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="pdf"; filename="highly-compressible.pdf"\r\nContent-Type: application/pdf\r\n\r\n`);
  const target = Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="targetMB"\r\n\r\n1\r\n--${boundary}\r\nContent-Disposition: form-data; name="landingLanguage"\r\n\r\nen\r\n--${boundary}--\r\n`);
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
          if (state.status === "done" || state.status === "error") {
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

(async () => {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "tinypdf-regression-"));
  const child = spawn(process.execPath, ["server-simple.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), WEB_SESSION_SECRET: SESSION_SECRET, ADMIN_SESSION_SECRET: "admin-session-secret" },
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
    assert.strictEqual(finalState.status, "done", "a valid result smaller than 1% of the input must remain downloadable");
    assert.ok(finalState.resultBytes > 0);
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
    assert.strictEqual(download.statusCode, 200, "a completed highly-compressible PDF must download");
    assert.ok(download.body.subarray(0, 5).equals(Buffer.from("%PDF-")));
    console.log("compression regression test passed");
  } finally {
    child.kill("SIGTERM");
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
