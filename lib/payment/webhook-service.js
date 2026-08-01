"use strict";

const crypto = require("crypto");

function createWebhookService({ repo, pool, paddle }) {
  if (!repo || !paddle) throw new TypeError("repo and paddle are required");
  return {
    async acceptWebhook({ rawBody, signature }) {
      const event = await paddle.verifyWebhook(rawBody, signature);
      const data = event.data || {};
      const receipt = await repo.enqueueWebhookReceipt({
        eventId: event.eventId || event.event_id,
        eventType: event.eventType || event.event_type,
        transactionId: data.transactionId || data.id || null,
        resourceId: data.id || null,
        orderHint: data.customData && data.customData.tinypdfOrderId || null,
        payloadHash: crypto.createHash("sha256").update(rawBody, "utf8").digest("hex"),
      }, pool);
      return { accepted: true, duplicate: !receipt.inserted, eventType: event.eventType || event.event_type };
    },
  };
}

module.exports = { createWebhookService };
