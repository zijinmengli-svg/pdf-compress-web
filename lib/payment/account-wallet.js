"use strict";

const crypto = require("node:crypto");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveAccountWallet({ pool, accountId, guestWalletHash, secret }) {
  if (!pool || typeof pool.connect !== "function") throw new TypeError("pool is required");
  if (!UUID.test(String(accountId || ""))) throw new TypeError("verified account ID is required");
  if (!String(secret || "")) throw new TypeError("wallet secret is required");
  if (!String(guestWalletHash || "").trim()) throw new TypeError("guest wallet hash is required");
  const walletHash = crypto.createHmac("sha256", secret).update(`account-wallet:${accountId}`).digest("hex");
  const tx = await pool.connect();
  try {
    await tx.query("BEGIN");
    const account = (await tx.query("SELECT id FROM auth_accounts WHERE id = $1", [accountId])).rows[0];
    if (!account) throw new Error("Verified account not found");
    const existing = (await tx.query("SELECT wallet_hash FROM account_wallets WHERE account_id = $1", [accountId])).rows[0];
    if (!existing) {
      const now = new Date();
      await tx.query("INSERT INTO reward_wallets(id,wallet_hash,created_at,updated_at) VALUES ($1,$2,$3,$3) ON CONFLICT(wallet_hash) DO NOTHING", [crypto.randomUUID(), walletHash, now]);
      await tx.query("INSERT INTO account_wallets(account_id,wallet_hash,created_at) VALUES ($1,$2,$3) ON CONFLICT(account_id) DO NOTHING", [accountId, walletHash, now]);
    }
    const resolved = (await tx.query("SELECT wallet_hash FROM account_wallets WHERE account_id = $1", [accountId])).rows[0];
    if (!resolved || resolved.wallet_hash === guestWalletHash) throw new Error("Account and guest wallet must be distinct");
    await tx.query("COMMIT");
    return { accountId, walletHash: resolved.wallet_hash };
  } catch (error) {
    await tx.query("ROLLBACK");
    throw error;
  } finally {
    tx.release();
  }
}

module.exports = { resolveAccountWallet };
