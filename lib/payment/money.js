"use strict";

function assertMinor(value, field) {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${field} must be an integer minor-unit amount`);
  }
  if (value < 0) {
    throw new RangeError(`${field} must not be negative`);
  }
  return value;
}

function money(amountMinor, currency) {
  const normalizedCurrency = String(currency || "").trim().toUpperCase();
  if (!normalizedCurrency) {
    throw new TypeError("currency is required");
  }
  return {
    amountMinor: assertMinor(amountMinor, "amountMinor"),
    currency: normalizedCurrency,
  };
}

function financialDelta(previousMinor, nextMinor) {
  return assertMinor(nextMinor, "nextMinor") - assertMinor(previousMinor, "previousMinor");
}

module.exports = {
  assertMinor,
  money,
  financialDelta,
};
