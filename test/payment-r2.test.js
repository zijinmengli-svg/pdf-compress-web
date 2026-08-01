"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createR2Store } = require("../lib/payment/r2-store");
const { createCleanupService } = require("../lib/payment/cleanup-service");

class Command { constructor(input) { this.input = input; } }
class PutObjectCommand extends Command {}
class HeadObjectCommand extends Command {}
class GetObjectCommand extends Command {}
class DeleteObjectCommand extends Command {}

(async () => {
  const tempPath = path.join(os.tmpdir(), `tinypdf-r2-${crypto.randomUUID()}.pdf`);
  const content = Buffer.from("private compressed pdf bytes");
  await fs.promises.writeFile(tempPath, content);
  const checksum = crypto.createHash("sha256").update(content).digest("hex");
  const calls = [];
  let signedCommand = null;
  const client = {
    async send(command) {
      calls.push(command);
      if (command instanceof PutObjectCommand) {
        for await (const _chunk of command.input.Body) { /* consume body */ }
        return {};
      }
      if (command instanceof HeadObjectCommand) return { ContentLength: content.length, ChecksumSHA256: Buffer.from(checksum, "hex").toString("base64") };
      if (command instanceof DeleteObjectCommand) return {};
      return {};
    },
  };
  const store = createR2Store({
    r2Endpoint: "https://example.r2.cloudflarestorage.com",
    r2AccessKeyId: "key",
    r2SecretAccessKey: "secret",
    r2Bucket: "paid-results",
  }, { client, PutObjectCommand, HeadObjectCommand, GetObjectCommand, DeleteObjectCommand, getSignedUrl: async (_client, command, options) => { signedCommand = command; return `https://signed.example/${command.input.Key}?expires=${options.expiresIn}`; } });

  const stored = await store.putResult({ orderId: "order-123", filePath: tempPath, sizeBytes: content.length, checksumSha256: checksum });
  assert.match(stored.objectKey, /^results\/[0-9a-f-]{36}\/[A-Za-z0-9_-]{32,}\.pdf$/);
  assert.strictEqual(stored.objectKey.includes("order-123"), false);
  assert.strictEqual(stored.objectKey.includes("resume.pdf"), false);
  const put = calls.find((call) => call instanceof PutObjectCommand);
  assert.strictEqual(put.input.ContentType, "application/pdf");
  assert.strictEqual(Object.hasOwn(put.input, "ACL"), false);
  await assert.deepStrictEqual(await store.headResult(stored.objectKey), { sizeBytes: content.length, checksumSha256: checksum });
  const url = await store.createDownloadUrl({ objectKey: stored.objectKey, downloadName: "resume.pdf", expiresInSeconds: 300 });
  assert.match(url, /expires=300/);
  assert.match(signedCommand.input.ResponseContentDisposition, /attachment/);
  await store.deleteResult(stored.objectKey);

  const files = new Map([
    ["ok", { id: "ok", orderId: "order-ok", objectKey: "results/a/file.pdf", deleteAttempts: 0 }],
    ["bad", { id: "bad", orderId: "order-bad", objectKey: "results/b/file.pdf", deleteAttempts: 0 }],
  ]);
  const cleanupRepo = {
    files,
    async listExpiredFileObjects() { return [...files.values()].filter((file) => !file.storageStatus); },
    async getOrderForUpdate(id) { return { id, payment_status: "paid", fulfillment_status: "available" }; },
    async getFileObjectForUpdate(id) { return files.get(id); },
    async markFileDeleted(id) { files.get(id).storageStatus = "deleted"; },
    async recordFileDeleteFailure(id) { const file = files.get(id); file.storageStatus = "failed"; file.deleteAttempts += 1; },
    async updateOrderState() {},
  };
  const cleanup = createCleanupService({
    repo: cleanupRepo,
    r2: { async deleteResult(key) { if (key.includes("/b/")) throw new Error("network"); } },
    now: () => new Date("2026-08-01T00:00:00.000Z"),
    transaction: async (_pool, fn) => fn({}),
  });
  assert.deepStrictEqual(await cleanup.cleanupExpiredFiles(), { deleted: 1, failed: 1 });
  assert.strictEqual(files.get("ok").storageStatus, "deleted");
  assert.strictEqual(files.get("bad").deleteAttempts, 1);

  await fs.promises.unlink(tempPath);
  console.log("payment R2 tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
