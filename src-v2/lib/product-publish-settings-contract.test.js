import assert from "node:assert/strict";
import test from "node:test";
import { buildProductPublishSettingsStage } from "./product-publish-settings-contract.js";

test("uses fixed publishing defaults without requiring user input", () => {
  const result = buildProductPublishSettingsStage({
    businessMode: "全托管",
    settings: {},
  });

  assert.deepEqual(result.blockers, []);
  assert.deepEqual(result.payload, {
    root: { shelf_require: "0" },
    skc: { shelf_way: "1" },
    sku: { mall_state: 1, stop_purchase: 1 },
  });
});

test("ignores custom values and always builds the fixed SHEIN payload", () => {
  const result = buildProductPublishSettingsStage({
    businessMode: "full",
    settings: {
      mallState: "2",
      stopPurchase: "2",
      shelfRequire: "1",
      shelfWay: "2",
      hopeOnSaleDate: "2026-08-20T09:30",
    },
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.payload, {
    root: { shelf_require: "0" },
    skc: { shelf_way: "1" },
    sku: { mall_state: 1, stop_purchase: 1 },
  });
});

test("does not expose fixed fields even when the live fill standard marks them visible", () => {
  const result = buildProductPublishSettingsStage({
    businessMode: "全托管",
    fillInStandard: [
      { field_key: "stop_purchase", show: false, required: true },
      { field_key: "shelf_require", show: false, required: true },
    ],
    settings: {
      mallState: "2",
      stopPurchase: "2",
      shelfRequire: "1",
      shelfWay: "2",
    },
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.payload, {
    root: { shelf_require: "0" },
    skc: { shelf_way: "1" },
    sku: { mall_state: 1, stop_purchase: 1 },
  });
});

test("still rejects unsupported business modes", () => {
  const result = buildProductPublishSettingsStage({
    businessMode: "自运营",
    settings: {
      mallState: "2",
      stopPurchase: "2",
      shelfRequire: "1",
      shelfWay: "2",
      hopeOnSaleDate: "2026-02-31T09:30",
    },
  });

  assert.deepEqual(
    result.blockers.map((item) => item.code),
    ["BUSINESS_MODE_UNSUPPORTED"],
  );
});
