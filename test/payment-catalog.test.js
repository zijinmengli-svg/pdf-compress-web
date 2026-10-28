"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createCatalog } = require("../lib/payment/catalog");

const products = [{
  key: "tinypdf", enabled: true, offers: [{ key: "compression-credit", enabled: true,
    quantities: [1, 3, 5, 10], unitsPerQuantity: 1,
    paddle: { sandbox: { productId: "pro_test", priceId: "pri_test" }, production: { productId: "pro_live", priceId: "pri_live" } },
  }],
}];

test("TinyPDF quantities use one price and grant one credit per paid unit", () => {
  const catalog = createCatalog({ environment: "sandbox", products });
  for (const quantity of [1, 3, 5, 10]) {
    assert.deepEqual(catalog.resolveOffer({ productKey: "tinypdf", offerKey: "compression-credit", quantity }), {
      productKey: "tinypdf", offerKey: "compression-credit", productId: "pro_test", priceId: "pri_test",
      quantity, entitlementUnits: quantity,
    });
  }
});

test("unknown, disabled, invalid-quantity, or unconfigured offers cannot be sold", () => {
  const catalog = createCatalog({ environment: "sandbox", products });
  for (const input of [
    { productKey: "other", offerKey: "compression-credit", quantity: 1 },
    { productKey: "tinypdf", offerKey: "other", quantity: 1 },
    ...[0, 2, -1, 1.5, "1"].map(quantity => ({ productKey: "tinypdf", offerKey: "compression-credit", quantity })),
  ]) assert.throws(() => catalog.resolveOffer(input));
  assert.throws(() => createCatalog({ environment: "sandbox", products: [{ ...products[0], enabled: false }] }).resolveOffer({ productKey: "tinypdf", offerKey: "compression-credit", quantity: 1 }));
  assert.throws(() => createCatalog({ environment: "sandbox", products: [{ ...products[0], offers: [{ ...products[0].offers[0], paddle: { sandbox: { productId: "pro_test" } } }] }] }).resolveOffer({ productKey: "tinypdf", offerKey: "compression-credit", quantity: 1 }));
  assert.throws(() => createCatalog({ environment: "invalid", products }));
});
