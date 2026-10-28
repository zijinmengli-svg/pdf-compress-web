"use strict";

function createCatalog({ environment, products }) {
  if (!["sandbox", "production"].includes(environment)) throw new TypeError("Invalid payment environment");
  if (!Array.isArray(products)) throw new TypeError("Payment products are required");
  const registry = new Map();
  for (const product of products) {
    if (!product || typeof product.key !== "string" || registry.has(product.key) || !Array.isArray(product.offers)) {
      throw new TypeError("Invalid payment product");
    }
    const offers = new Map();
    for (const offer of product.offers) {
      if (!offer || typeof offer.key !== "string" || offers.has(offer.key) || !Array.isArray(offer.quantities) ||
          !Number.isSafeInteger(offer.unitsPerQuantity) || offer.unitsPerQuantity < 1) {
        throw new TypeError("Invalid payment offer");
      }
      offers.set(offer.key, offer);
    }
    registry.set(product.key, { product, offers });
  }
  return {
    resolveOffer({ productKey, offerKey, quantity }) {
      const entry = registry.get(productKey);
      const offer = entry && entry.offers.get(offerKey);
      if (!entry || entry.product.enabled !== true || !offer || offer.enabled !== true ||
          !Number.isSafeInteger(quantity) || !offer.quantities.includes(quantity)) {
        throw new TypeError("Payment offer is unavailable");
      }
      const binding = offer.paddle && offer.paddle[environment];
      if (!binding || !/^pro_/.test(String(binding.productId || "")) || !/^pri_/.test(String(binding.priceId || ""))) {
        throw new Error("Payment catalog is incomplete");
      }
      const entitlementUnits = quantity * offer.unitsPerQuantity;
      if (!Number.isSafeInteger(entitlementUnits)) throw new TypeError("Invalid entitlement quantity");
      return { productKey, offerKey, productId: binding.productId, priceId: binding.priceId, quantity, entitlementUnits };
    },
  };
}

module.exports = { createCatalog };
