"use strict";

const assert = require("assert");
const crypto = require("crypto");
const path = require("path");
const { newDb, DataType } = require("pg-mem");
const { runPaymentMigrations } = require("../lib/payment/database");
const { createReferralRepository } = require("../lib/referral/repository");

async function makeRepository() {
  const db = newDb({ autoCreateForeignKeyIndices: true, noAstCoverageCheck: true });
  db.public.registerFunction({ name: "pg_advisory_lock", args: [DataType.bigint], returns: DataType.bool, implementation: () => true });
  db.public.registerFunction({ name: "pg_advisory_unlock", args: [DataType.bigint], returns: DataType.bool, implementation: () => true });
  const pg = db.adapters.createPg();
  const pool = new pg.Pool();
  await runPaymentMigrations(pool, path.join(__dirname, "../db/migrations"));
  return { pool, repo: createReferralRepository({ pool, now: () => new Date("2026-08-08T04:00:00.000Z") }) };
}

async function main() {
  const { pool, repo } = await makeRepository();
  const settings = await repo.getSettings(pool);
  assert.strictEqual(Number(settings.daily_reward_cap), 50);
  assert.strictEqual(settings.enabled, false);

  const inviter = await repo.ensureWallet({ walletHash: "wallet-a", legacyIdentityHash: "legacy-a" }, pool);
  const invitee = await repo.ensureWallet({ walletHash: "wallet-b", legacyIdentityHash: "legacy-b" }, pool);
  const invite = await repo.ensureInviteCode({ walletId: inviter.id, codeHash: "code-a" }, pool);
  assert.ok(invite.id);
  const attribution = await repo.lockFirstTouch({ inviteCodeHash: "code-a", inviteeWalletId: invitee.id }, pool);
  assert.strictEqual(attribution.inviter_wallet_id, inviter.id);
  const second = await repo.lockFirstTouch({ inviteCodeHash: "code-other", inviteeWalletId: invitee.id }, pool);
  assert.strictEqual(second.inviter_wallet_id, inviter.id);

  await repo.ensureWelcomeCredit({ walletId: invitee.id, legacyIdentityHash: "legacy-b" }, pool);
  const credit = await repo.consumeCredit({ walletId: invitee.id, jobId: "job-1", idempotencyKey: "consume-job-1" }, pool);
  assert.strictEqual(credit.granted, true);
  const duplicate = await repo.consumeCredit({ walletId: invitee.id, jobId: "job-1", idempotencyKey: "consume-job-1" }, pool);
  assert.strictEqual(duplicate.granted, true);
  assert.strictEqual(duplicate.duplicate, true);

  await repo.updateSettings({ enabled: true, dailyRewardCap: 50 }, pool);
  const settled = await repo.settleReferral({ inviteeWalletId: invitee.id, jobId: "job-1", downloadTokenId: crypto.randomUUID(), risk: { suspicious: false } }, pool);
  assert.strictEqual(settled.status, "rewarded");
  const repeated = await repo.settleReferral({ inviteeWalletId: invitee.id, jobId: "job-1", downloadTokenId: crypto.randomUUID(), risk: { suspicious: false } }, pool);
  assert.strictEqual(repeated.status, "already_settled");

  const summary = await repo.getAdminSummary({ from: new Date("2026-08-08T00:00:00.000Z"), to: new Date("2026-08-09T00:00:00.000Z") }, pool);
  assert.strictEqual(summary.rewarded, 1);
  assert.strictEqual(summary.rewardCredits, 3);

  await pool.end();
  console.log("referral repository tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
