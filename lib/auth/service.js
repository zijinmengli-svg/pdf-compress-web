"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const CODE_MS = 10 * 60_000;
const SESSION_MS = 30 * 24 * 60 * 60_000;
const COOLDOWN_MS = 60_000;

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Invalid email address");
  return email;
}

async function withTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

function createEmailAuthService({ pool, secret, sendCode, now = () => new Date() }) {
  if (!pool || !secret || typeof sendCode !== "function") throw new TypeError("Email auth dependencies are required");
  const hmac = value => crypto.createHmac("sha256", secret).update(String(value)).digest("hex");
  const invalidCode = () => { throw new Error("Invalid or expired verification code"); };

  async function ready() {
    await pool.query(fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8"));
  }

  async function incrementLimit(tx, kind, value, maximum, timestamp) {
    const hour = Math.floor(timestamp.getTime() / 3_600_000);
    const bucket = hmac(`limit:${kind}:${value}:${hour}`);
    const result = await tx.query(`INSERT INTO auth_limits(bucket,request_count,expires_at) VALUES ($1,1,$2)
      ON CONFLICT(bucket) DO UPDATE SET request_count = auth_limits.request_count + 1
      RETURNING request_count`, [bucket, new Date((hour + 1) * 3_600_000)]);
    return Number(result.rows[0].request_count) <= maximum;
  }

  async function requestCode({ email: input, ip = "" }) {
    const email = normalizeEmail(input);
    const timestamp = now();
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
    const codeHash = hmac(`challenge:${email}:${code}`);
    const allowed = await withTransaction(pool, async tx => {
      await tx.query("DELETE FROM auth_limits WHERE expires_at <= $1", [timestamp]);
      const current = (await tx.query("SELECT last_sent_at FROM auth_challenges WHERE email = $1", [email])).rows[0];
      if (current && timestamp.getTime() - new Date(current.last_sent_at).getTime() < COOLDOWN_MS) return false;
      const emailAllowed = await incrementLimit(tx, "email", email, 5, timestamp);
      const ipAllowed = await incrementLimit(tx, "ip", ip, 60, timestamp);
      if (!emailAllowed || !ipAllowed) return false;
      const inserted = await tx.query(`INSERT INTO auth_challenges(email,code_hash,expires_at,last_sent_at,attempts,created_at)
        VALUES ($1,$2,$3,$4,0,$4) ON CONFLICT(email) DO NOTHING RETURNING email`,
      [email, codeHash, new Date(timestamp.getTime() + CODE_MS), timestamp]);
      if (inserted.rowCount) return true;
      const updated = await tx.query(`UPDATE auth_challenges SET code_hash=$2,expires_at=$3,last_sent_at=$4,attempts=0
        WHERE email=$1 AND last_sent_at <= $5 RETURNING email`,
      [email, codeHash, new Date(timestamp.getTime() + CODE_MS), timestamp, new Date(timestamp.getTime() - COOLDOWN_MS)]);
      return updated.rowCount > 0;
    });
    if (!allowed) throw new Error("Please wait before requesting another code");
    try { await sendCode(email, code); }
    catch {
      await pool.query("DELETE FROM auth_challenges WHERE email=$1 AND code_hash=$2", [email, codeHash]);
      throw new Error("Verification email could not be sent");
    }
    return { sent: true };
  }

  async function verifyCode({ email: input, code }) {
    const email = normalizeEmail(input);
    if (!/^\d{6}$/.test(String(code || ""))) invalidCode();
    const timestamp = now();
    const result = await withTransaction(pool, async tx => {
      const challenge = (await tx.query("SELECT * FROM auth_challenges WHERE email=$1 FOR UPDATE", [email])).rows[0];
      if (!challenge || new Date(challenge.expires_at) <= timestamp || Number(challenge.attempts) >= 5) return null;
      const expected = Buffer.from(challenge.code_hash, "hex");
      const supplied = Buffer.from(hmac(`challenge:${email}:${code}`), "hex");
      if (!crypto.timingSafeEqual(expected, supplied)) {
        await tx.query("UPDATE auth_challenges SET attempts=attempts+1 WHERE email=$1", [email]);
        return null;
      }
      await tx.query("DELETE FROM auth_challenges WHERE email=$1", [email]);
      const account = (await tx.query(`INSERT INTO auth_accounts(id,email,created_at,updated_at)
        VALUES ($1,$2,$3,$3) ON CONFLICT(email) DO UPDATE SET updated_at=$3 RETURNING id,email`,
      [crypto.randomUUID(), email, timestamp])).rows[0];
      const token = crypto.randomBytes(32).toString("base64url");
      await tx.query("INSERT INTO auth_sessions(token_hash,account_id,expires_at,created_at) VALUES ($1,$2,$3,$4)",
        [hmac(`session:${token}`), account.id, new Date(timestamp.getTime() + SESSION_MS), timestamp]);
      return { token, account: { id: account.id, email: account.email } };
    });
    if (!result) invalidCode();
    return result;
  }

  async function getSession(token) {
    if (!/^[A-Za-z0-9_-]{40,}$/.test(String(token || ""))) return null;
    const row = (await pool.query(`SELECT a.id,a.email FROM auth_sessions s JOIN auth_accounts a ON a.id=s.account_id
      WHERE s.token_hash=$1 AND s.expires_at>$2`, [hmac(`session:${token}`), now()])).rows[0];
    return row ? { account: { id: row.id, email: row.email } } : null;
  }

  async function logout(token) {
    if (token) await pool.query("DELETE FROM auth_sessions WHERE token_hash=$1", [hmac(`session:${token}`)]);
  }

  return { ready, requestCode, verifyCode, getSession, logout };
}

module.exports = { createEmailAuthService, createEmailSender: require("./email-sender").createEmailSender, normalizeEmail, SESSION_MS };
