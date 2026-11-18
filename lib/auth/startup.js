"use strict";
const { createEmailAuthService } = require("./service");
const { createEmailSender } = require("./email-sender");

async function startEmailAuth({ pool, secret, apiKey, from,
  makeService = createEmailAuthService, makeSender = createEmailSender }) {
  const deliveryAvailable = Boolean(apiKey && from);
  const service = makeService({ pool, secret,
    sendCode: deliveryAvailable ? makeSender({ apiKey, from }) : async () => { throw new Error("Email delivery is not configured"); } });
  await service.ready();
  // Existing sessions and payment identities remain usable without an email sender.
  // New sign-ins must never pretend that a verification email was sent.
  service.deliveryAvailable = deliveryAvailable;
  return service;
}
module.exports = { startEmailAuth };
