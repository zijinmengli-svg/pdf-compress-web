"use strict";

const EVENT_TYPES = new Set(["transaction.completed", "adjustment.created", "adjustment.updated"]);

function createPrepaidWebhookRepository({ now = () => new Date() } = {}) {
  async function enqueueWebhookReceipt(input, db) {
    if (!db || typeof db.query !== "function") throw new TypeError("database is required");
    if (!input || !/^(?:evt_[A-Za-z0-9_]+|reconcile:txn_[A-Za-z0-9_]+)$/.test(String(input.eventId || "")) ||
        !EVENT_TYPES.has(input.eventType) || !String(input.payloadHash || "").trim()) {
      throw new TypeError("invalid Paddle webhook receipt");
    }
    const result = await db.query(`INSERT INTO prepaid_webhook_receipts
      (event_id,event_type,transaction_id,resource_id,payload_hash,next_attempt_at)
      VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
    [input.eventId, input.eventType, input.transactionId || null, input.resourceId || null, input.payloadHash, now()]);
    return { inserted: result.rows.length > 0 };
  }

  async function claimWebhookReceipts(limit, leaseUntil, db) {
    if (!db || typeof db.query !== "function") throw new TypeError("database is required");
    const bounded = Math.min(100, Math.max(1, Math.floor(Number(limit) || 25)));
    if (!(leaseUntil instanceof Date) || !Number.isFinite(leaseUntil.getTime()) || leaseUntil <= now()) throw new TypeError("future lease expiry is required");
    const claimed = [];
    // Compare-and-set avoids granting the same event twice when two workers race.
    // A lost race is retried on the next poll; it cannot mark the event processed.
    for (let attempt = 0; attempt < bounded * 2 && claimed.length < bounded; attempt++) {
      const at = now();
      const next = (await db.query(`SELECT event_id FROM prepaid_webhook_receipts
        WHERE (processing_status = 'queued' AND next_attempt_at <= $1)
          OR (processing_status = 'processing' AND lease_expires_at <= $1)
        ORDER BY received_at ASC, event_id ASC LIMIT 1`, [at])).rows[0];
      if (!next) break;
      const result = await db.query(`UPDATE prepaid_webhook_receipts SET processing_status = 'processing', lease_expires_at = $2
        WHERE event_id = $1 AND ((processing_status = 'queued' AND next_attempt_at <= $3)
          OR (processing_status = 'processing' AND lease_expires_at <= $3)) RETURNING *`,
      [next.event_id, leaseUntil, at]);
      if (result.rows[0]) claimed.push(result.rows[0]);
    }
    return claimed;
  }

  async function completeWebhookReceipt(eventId, { message = "processed" } = {}, db) {
    if (!db || typeof db.query !== "function") throw new TypeError("database is required");
    const safeMessage = String(message).slice(0, 100);
    await db.query(`UPDATE prepaid_webhook_receipts SET processing_status = 'processed',
      processed_at = $2, lease_expires_at = NULL, safe_error = $3
      WHERE event_id = $1 AND processing_status = 'processing'`, [eventId, now(), safeMessage]);
  }

  async function retryWebhookReceipt(eventId, safeError, retryAt, db) {
    if (!db || typeof db.query !== "function") throw new TypeError("database is required");
    if (!(retryAt instanceof Date) || !Number.isFinite(retryAt.getTime())) throw new TypeError("retry time is required");
    await db.query(`UPDATE prepaid_webhook_receipts SET processing_status = 'queued',
      processing_attempts = processing_attempts + 1, next_attempt_at = $2,
      lease_expires_at = NULL, safe_error = $3
      WHERE event_id = $1 AND processing_status = 'processing'`, [eventId, retryAt, String(safeError || "failed").slice(0, 100)]);
  }

  return { enqueueWebhookReceipt, claimWebhookReceipts, completeWebhookReceipt, retryWebhookReceipt };
}

module.exports = { createPrepaidWebhookRepository };
