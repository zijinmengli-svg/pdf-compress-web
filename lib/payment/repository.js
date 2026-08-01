"use strict";

const crypto = require("crypto");
const { withTransaction } = require("./database");

function asMinor(value, field) {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount)) throw new TypeError(`${field} must be a safe integer`);
  return amount;
}

function resultRow(result) { return result.rows[0] || null; }
function dbOrPool(db, pool) { return db || pool; }
function hasConnect(db) { return db && typeof db.connect === "function"; }

function createPaymentRepository({ pool, now = () => new Date() }) {
  if (!pool || typeof pool.query !== "function") throw new TypeError("pool is required");

  async function inTransaction(db, fn) {
    return hasConnect(db) ? withTransaction(db, fn) : fn(db);
  }

  return {
    async getSettings(db = pool) {
      return resultRow(await db.query("SELECT * FROM payment_settings WHERE singleton = true"));
    },

    async updateSettingsAfterPaddleSync(input, db = pool) {
      const sql = `INSERT INTO payment_settings (singleton, environment, billing_enabled, paddle_product_id, paddle_price_id, usd_amount_minor, cny_amount_minor, tax_mode, version, last_sync_status, last_sync_error, last_synced_at, updated_at)
        VALUES (true, $1, $2, $3, $4, $5, $6, $7, 1, $8, $9, $10, $10)
        ON CONFLICT (singleton) DO UPDATE SET environment = EXCLUDED.environment, billing_enabled = EXCLUDED.billing_enabled, paddle_product_id = EXCLUDED.paddle_product_id, paddle_price_id = EXCLUDED.paddle_price_id, usd_amount_minor = EXCLUDED.usd_amount_minor, cny_amount_minor = EXCLUDED.cny_amount_minor, tax_mode = EXCLUDED.tax_mode, version = payment_settings.version + 1, last_sync_status = EXCLUDED.last_sync_status, last_sync_error = EXCLUDED.last_sync_error, last_synced_at = EXCLUDED.last_synced_at, updated_at = EXCLUDED.updated_at
        RETURNING *`;
      return resultRow(await db.query(sql, [input.environment, Boolean(input.billingEnabled), input.paddleProductId, input.paddlePriceId, asMinor(input.usdAmountMinor, "usdAmountMinor"), asMinor(input.cnyAmountMinor, "cnyAmountMinor"), input.taxMode || "location", input.lastSyncStatus || "synced", input.lastSyncError || "", input.lastSyncedAt || now()]));
    },

    async consumeFreeGrant(identityHash, orderId, db = pool) {
      return inTransaction(db, async (tx) => {
        const current = resultRow(await tx.query("SELECT * FROM free_grants WHERE anonymous_identity_hash = $1 FOR UPDATE", [identityHash]));
        if (current && !current.restored_at) return false;
        if (current) {
          await tx.query("UPDATE free_grants SET consumed_order_id = $2, consumed_at = $3, restored_at = NULL, restore_reason = '' WHERE anonymous_identity_hash = $1", [identityHash, orderId, now()]);
        } else {
          await tx.query("INSERT INTO free_grants(anonymous_identity_hash, consumed_order_id, consumed_at) VALUES ($1, $2, $3)", [identityHash, orderId, now()]);
        }
        return true;
      });
    },

    async restoreFreeGrant(identityHash, orderId, reason, db = pool) {
      return inTransaction(db, async (tx) => resultRow(await tx.query("UPDATE free_grants SET restored_at = $3, restore_reason = $4 WHERE anonymous_identity_hash = $1 AND consumed_order_id = $2 AND restored_at IS NULL RETURNING *", [identityHash, orderId, now(), String(reason || "server_failure")] )));
    },

    async createOrder(input, db = pool) {
      const sql = `INSERT INTO orders (id, public_token_hash, job_id, anonymous_identity_hash, payment_status, fulfillment_status, paddle_product_id, paddle_price_id, original_bytes, target_bytes, result_bytes, reached_target, language, country, price_amount_minor, price_currency, source, source_category, source_json, compressed_at, expires_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`;
      return resultRow(await db.query(sql, [input.id, input.publicTokenHash, input.jobId, input.anonymousIdentityHash, input.paymentStatus, input.fulfillmentStatus, input.paddleProductId || null, input.paddlePriceId || null, asMinor(input.originalBytes, "originalBytes"), asMinor(input.targetBytes, "targetBytes"), asMinor(input.resultBytes, "resultBytes"), Boolean(input.reachedTarget), input.language, input.country || "", asMinor(input.priceAmountMinor, "priceAmountMinor"), String(input.priceCurrency).toUpperCase(), input.source, input.sourceCategory, input.sourceJson || {}, input.compressedAt || now(), input.expiresAt]));
    },

    async getOrder(orderId, db = pool) { return resultRow(await db.query("SELECT * FROM orders WHERE id = $1", [orderId])); },
    async getOrderForUpdate(orderId, db) { return resultRow(await db.query("SELECT * FROM orders WHERE id = $1 FOR UPDATE", [orderId])); },

    async updateOrderState(orderId, patch, db = pool) {
      const columns = { paymentStatus: "payment_status", fulfillmentStatus: "fulfillment_status", paidAt: "paid_at", downloadUrlIssuedAt: "download_url_issued_at", expiresAt: "expires_at", paddleCustomerId: "paddle_customer_id" };
      const entries = Object.entries(patch).filter(([key]) => columns[key]);
      if (!entries.length) throw new TypeError("no permitted order state fields supplied");
      const values = entries.map(([, value]) => value);
      const assignments = entries.map(([key], index) => `${columns[key]} = $${index + 1}`).join(", ");
      values.push(now(), orderId);
      return resultRow(await db.query(`UPDATE orders SET ${assignments}, updated_at = $${values.length - 1} WHERE id = $${values.length} RETURNING *`, values));
    },

    async attachPaddleTransaction(orderId, transactionId, db = pool) {
      return inTransaction(db, async (tx) => resultRow(await tx.query("UPDATE orders SET paddle_transaction_id = $2, updated_at = $3 WHERE id = $1 AND paddle_transaction_id IS NULL RETURNING *", [orderId, transactionId, now()])));
    },

    async upsertFinancials(orderId, financials, db = pool) {
      const keys = ["transactionCurrency", "customerSubtotalMinor", "customerDiscountMinor", "customerTaxMinor", "customerTotalMinor", "paddleFeeMinor", "transactionEarningsMinor", "payoutCurrency", "payoutSubtotalMinor", "payoutTaxMinor", "payoutFeeMinor", "payoutEarningsMinor", "payoutExchangeRate", "adjustedPayoutEarningsMinor", "reconciledAt"];
      const v = keys.map((key) => financials[key]);
      const minorIndices = [1,2,3,4,5,6,8,9,10,11,13];
      for (const index of minorIndices) v[index] = asMinor(v[index], keys[index]);
      const sql = `INSERT INTO order_financials (order_id, transaction_currency, customer_subtotal_minor, customer_discount_minor, customer_tax_minor, customer_total_minor, paddle_fee_minor, transaction_earnings_minor, payout_currency, payout_subtotal_minor, payout_tax_minor, payout_fee_minor, payout_earnings_minor, payout_exchange_rate, adjusted_payout_earnings_minor, reconciled_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
        ON CONFLICT (order_id) DO UPDATE SET transaction_currency=EXCLUDED.transaction_currency, customer_subtotal_minor=EXCLUDED.customer_subtotal_minor, customer_discount_minor=EXCLUDED.customer_discount_minor, customer_tax_minor=EXCLUDED.customer_tax_minor, customer_total_minor=EXCLUDED.customer_total_minor, paddle_fee_minor=EXCLUDED.paddle_fee_minor, transaction_earnings_minor=EXCLUDED.transaction_earnings_minor, payout_currency=EXCLUDED.payout_currency, payout_subtotal_minor=EXCLUDED.payout_subtotal_minor, payout_tax_minor=EXCLUDED.payout_tax_minor, payout_fee_minor=EXCLUDED.payout_fee_minor, payout_earnings_minor=EXCLUDED.payout_earnings_minor, payout_exchange_rate=EXCLUDED.payout_exchange_rate, adjusted_payout_earnings_minor=EXCLUDED.adjusted_payout_earnings_minor, reconciled_at=EXCLUDED.reconciled_at RETURNING *`;
      return resultRow(await db.query(sql, [orderId, ...v]));
    },

    async appendOrderEvent(event, db = pool) {
      const sql = `INSERT INTO order_events (id, order_id, event_type, source, provider_event_id, payment_status, fulfillment_status, customer_amount_minor, customer_currency, revenue_delta_minor, revenue_currency, metadata, occurred_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT DO NOTHING RETURNING *`;
      return resultRow(await db.query(sql, [event.id || crypto.randomUUID(), event.orderId, event.eventType, event.source, event.providerEventId || null, event.paymentStatus, event.fulfillmentStatus, asMinor(event.customerAmountMinor || 0, "customerAmountMinor"), String(event.customerCurrency || "USD").toUpperCase(), asMinor(event.revenueDeltaMinor || 0, "revenueDeltaMinor"), String(event.revenueCurrency || "USD").toUpperCase(), event.metadata || {}, event.occurredAt || now()]));
    },

    async enqueueWebhookReceipt(receipt, db = pool) {
      try {
        const row = resultRow(await db.query(`INSERT INTO webhook_receipts (event_id, event_type, transaction_id, payload_hash, resource_id, order_hint)
          VALUES ($1,$2,$3,$4,$5,$6) RETURNING processing_status`, [receipt.eventId, receipt.eventType, receipt.transactionId || null, receipt.payloadHash, receipt.resourceId || null, receipt.orderHint || null]));
        return { inserted: true, status: row.processing_status };
      } catch (error) {
        if (error && (error.code === "23505" || /duplicate|unique/i.test(String(error.message)))) {
          return { inserted: false, status: "queued" };
        }
        throw error;
      }
    },

    async claimWebhookReceipts(limit, leaseUntil, db = pool) {
      const result = await db.query(`WITH due AS (SELECT event_id FROM webhook_receipts WHERE processing_status IN ('queued','failed') AND next_attempt_at <= $1 ORDER BY received_at ASC LIMIT $2 FOR UPDATE SKIP LOCKED)
        UPDATE webhook_receipts w SET processing_status='processing', processing_attempts=processing_attempts+1, lease_expires_at=$3 FROM due WHERE w.event_id=due.event_id RETURNING w.*`, [now(), Number(limit), leaseUntil]);
      return result.rows;
    },
    async retryWebhookReceipt(eventId, safeError, nextAttemptAt, db = pool) { return resultRow(await db.query("UPDATE webhook_receipts SET processing_status = 'failed', safe_error = $2, next_attempt_at = $3, lease_expires_at = NULL WHERE event_id = $1 RETURNING *", [eventId, String(safeError || ""), nextAttemptAt])); },
    async completeWebhookReceipt(eventId, result, db = pool) { return resultRow(await db.query("UPDATE webhook_receipts SET processing_status = $2, processing_result = $3, safe_error = '', lease_expires_at = NULL, processed_at = $4 WHERE event_id = $1 RETURNING *", [eventId, result && result.ignored ? "ignored" : "processed", String((result && result.message) || ""), now()])); },

    async createCheckoutAttempt(input, db = pool) { return resultRow(await db.query("INSERT INTO checkout_attempts(id, order_id, attempt_key, state, paddle_transaction_id, last_safe_error) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *", [input.id, input.orderId, input.attemptKey, input.state || "created", input.paddleTransactionId || null, input.lastSafeError || ""])); },
    async getActiveCheckoutAttempt(orderId, db = pool) { return resultRow(await db.query("SELECT * FROM checkout_attempts WHERE order_id = $1 AND state IN ('created','uploading','uploaded','paddle_creating','reconcile_pending','ready') ORDER BY started_at DESC LIMIT 1", [orderId])); },
    async updateCheckoutAttempt(attemptId, patch, db = pool) { return resultRow(await db.query("UPDATE checkout_attempts SET state = COALESCE($2,state), paddle_transaction_id = COALESCE($3,paddle_transaction_id), last_safe_error = COALESCE($4,last_safe_error), updated_at = $5 WHERE id = $1 RETURNING *", [attemptId, patch.state || null, patch.paddleTransactionId || null, patch.lastSafeError || null, now()])); },

    async createFileObject(input, db = pool) { return resultRow(await db.query("INSERT INTO file_objects(id, order_id, provider, bucket, object_key, size_bytes, checksum_sha256, storage_status, stored_at, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,'stored',$8,$9) RETURNING *", [input.id, input.orderId, input.provider || "r2", input.bucket, input.objectKey, asMinor(input.sizeBytes, "sizeBytes"), input.checksumSha256, input.storedAt || now(), input.expiresAt])); },
    async getActiveFileObject(orderId, db = pool) { return resultRow(await db.query("SELECT * FROM file_objects WHERE order_id = $1 AND storage_status = 'stored'", [orderId])); },
    async markFileDeleted(fileId, deletedAt, db = pool) { return resultRow(await db.query("UPDATE file_objects SET storage_status = 'deleted', deleted_at = $2, next_delete_retry_at = NULL WHERE id = $1 RETURNING *", [fileId, deletedAt || now()])); },
    async recordFileDeleteFailure(fileId, error, nextRetryAt, db = pool) { return resultRow(await db.query("UPDATE file_objects SET storage_status = 'delete_failed', delete_attempts = delete_attempts + 1, last_delete_error = $2, next_delete_retry_at = $3 WHERE id = $1 RETURNING *", [fileId, String(error || ""), nextRetryAt])); },
    async listExpiredFileObjects(limit, db = pool) { const result = await db.query("SELECT * FROM file_objects WHERE storage_status IN ('stored','delete_failed') AND expires_at <= $1 AND (next_delete_retry_at IS NULL OR next_delete_retry_at <= $1) ORDER BY expires_at ASC LIMIT $2", [now(), Number(limit)]); return result.rows; },

    async listOrders(filters = {}) { const values = []; const where = []; if (filters.paymentStatus) { values.push(filters.paymentStatus); where.push(`payment_status = $${values.length}`); } if (filters.from) { values.push(filters.from); where.push(`created_at >= $${values.length}`); } if (filters.to) { values.push(filters.to); where.push(`created_at < $${values.length}`); } values.push(Math.min(Math.max(Number(filters.limit) || 50, 1), 200)); const result = await pool.query(`SELECT * FROM orders ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT $${values.length}`, values); return result.rows; },
    async listOrderEvents(orderId) { const result = await pool.query("SELECT * FROM order_events WHERE order_id = $1 ORDER BY occurred_at ASC, recorded_at ASC", [orderId]); return result.rows; },
    async paymentSummary(range = {}) { const from = range.from || new Date(0); const to = range.to || now(); const financials = await pool.query("SELECT COALESCE(SUM(adjusted_payout_earnings_minor), 0) AS net FROM order_financials f JOIN orders o ON o.id=f.order_id WHERE o.created_at >= $1 AND o.created_at < $2 AND f.payout_currency='USD'", [from, to]); const totals = await pool.query("SELECT transaction_currency AS currency, COALESCE(SUM(customer_total_minor), 0) AS total FROM order_financials f JOIN orders o ON o.id=f.order_id WHERE o.created_at >= $1 AND o.created_at < $2 GROUP BY transaction_currency", [from, to]); return { netEarningsUsdMinor: Number(financials.rows[0].net), customerTotalsByCurrency: Object.fromEntries(totals.rows.map((row) => [row.currency, Number(row.total)])) }; },
  };
}

module.exports = { createPaymentRepository };
