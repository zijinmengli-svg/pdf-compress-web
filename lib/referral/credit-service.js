"use strict";

function createCreditService({ repo, pool, now = () => new Date() }) {
  if (!repo || !pool) throw new TypeError("repo and pool are required");

  async function walletFor({ walletHash, legacyIdentityHash }, db = pool) {
    return repo.ensureWallet({ walletHash, legacyIdentityHash }, db);
  }

  return {
    async consumeForCompression({ walletHash, legacyIdentityHash = "", jobId }, db = pool) {
      const settings = await repo.getSettings(db);
      if (!settings || !settings.enabled) return { granted: false, source: "disabled", remaining: 0 };
      const wallet = await walletFor({ walletHash, legacyIdentityHash }, db);
      await repo.ensureWelcomeCredit({ walletId: wallet.id, legacyIdentityHash }, db);
      return repo.consumeCredit({ walletId: wallet.id, jobId, idempotencyKey: `compression:${wallet.id}:${jobId}`, now: now() }, db);
    },

    async getBalance({ walletHash, legacyIdentityHash = "" }, db = pool) {
      const settings = await repo.getSettings(db);
      if (!settings || !settings.enabled) return { available: 0, grants: [] };
      const wallet = await walletFor({ walletHash, legacyIdentityHash }, db);
      await repo.ensureWelcomeCredit({ walletId: wallet.id, legacyIdentityHash }, db);
      return repo.getWalletStatus({ walletHash }, db);
    },
  };
}

module.exports = { createCreditService };
