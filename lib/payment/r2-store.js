"use strict";

const crypto = require("crypto");
const fs = require("fs");
const { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const input = fs.createReadStream(filePath);
    input.on("error", reject);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("end", () => resolve(hash.digest("hex")));
  });
}

function safeDownloadName(value) {
  const clean = String(value || "tinypdf-compressed.pdf").replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "");
  return clean.toLowerCase().endsWith(".pdf") ? clean : `${clean || "tinypdf-compressed"}.pdf`;
}

function createR2Store(config, deps = {}) {
  const required = ["r2Endpoint", "r2AccessKeyId", "r2SecretAccessKey", "r2Bucket"];
  for (const key of required) if (!String(config && config[key] || "").trim()) throw new TypeError(`${key} is required`);
  const client = deps.client || new (deps.S3Client || S3Client)({
    region: "auto",
    endpoint: config.r2Endpoint,
    credentials: { accessKeyId: config.r2AccessKeyId, secretAccessKey: config.r2SecretAccessKey },
  });
  const Commands = {
    PutObjectCommand: deps.PutObjectCommand || PutObjectCommand,
    HeadObjectCommand: deps.HeadObjectCommand || HeadObjectCommand,
    GetObjectCommand: deps.GetObjectCommand || GetObjectCommand,
    DeleteObjectCommand: deps.DeleteObjectCommand || DeleteObjectCommand,
  };
  const signer = deps.getSignedUrl || getSignedUrl;

  function command(name, input) { return new Commands[name](input); }

  return {
    async putResult({ filePath, sizeBytes, checksumSha256 }) {
      const stat = await fs.promises.stat(filePath);
      if (Number(sizeBytes) !== stat.size || stat.size <= 0) throw new Error("result file size does not match upload metadata");
      const actualChecksum = await sha256File(filePath);
      if (!/^[a-f0-9]{64}$/i.test(String(checksumSha256 || "")) || actualChecksum !== String(checksumSha256).toLowerCase()) {
        throw new Error("result file checksum does not match upload metadata");
      }
      const objectKey = `results/${crypto.randomUUID()}/${crypto.randomBytes(32).toString("base64url")}.pdf`;
      await client.send(command("PutObjectCommand", {
        Bucket: config.r2Bucket,
        Key: objectKey,
        Body: fs.createReadStream(filePath),
        ContentType: "application/pdf",
        ChecksumAlgorithm: "SHA256",
        ChecksumSHA256: Buffer.from(actualChecksum, "hex").toString("base64"),
      }));
      return { bucket: config.r2Bucket, objectKey, sizeBytes: stat.size, checksumSha256: actualChecksum };
    },

    async headResult(objectKey) {
      const head = await client.send(command("HeadObjectCommand", { Bucket: config.r2Bucket, Key: objectKey }));
      const checksumSha256 = head.ChecksumSHA256 ? Buffer.from(head.ChecksumSHA256, "base64").toString("hex") : "";
      return { sizeBytes: Number(head.ContentLength), checksumSha256 };
    },

    async createDownloadUrl({ objectKey, downloadName, expiresInSeconds = 300 }) {
      const seconds = Number(expiresInSeconds);
      if (!Number.isInteger(seconds) || seconds < 1 || seconds > 300) throw new RangeError("download URL expiry must be between 1 and 300 seconds");
      return signer(client, command("GetObjectCommand", {
        Bucket: config.r2Bucket,
        Key: objectKey,
        ResponseContentType: "application/pdf",
        ResponseContentDisposition: `attachment; filename="${safeDownloadName(downloadName)}"`,
      }), { expiresIn: seconds });
    },

    async deleteResult(objectKey) {
      try {
        await client.send(command("DeleteObjectCommand", { Bucket: config.r2Bucket, Key: objectKey }));
      } catch (error) {
        if (!error || !["NotFound", "NoSuchKey", "404"].includes(String(error.name || error.Code || error.code || ""))) throw error;
      }
    },
  };
}

module.exports = { createR2Store, safeDownloadName, sha256File };
