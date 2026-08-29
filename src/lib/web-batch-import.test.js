import assert from "node:assert/strict";
import test from "node:test";
import {
  attachBatchImageAssets,
  buildUniqueBatchSupplierCodes,
  isDraftReadyForBatch,
} from "./web-batch-import.js";

function image(id, type, name = `${id}.jpg`) {
  return {
    id,
    type,
    file: { name, type: "image/jpeg" },
    width: 1200,
    height: 1200,
  };
}

test("builds unique supplier codes when folder names normalize to the same value", () => {
  assert.deepEqual(
    buildUniqueBatchSupplierCodes([
      { name: "Modern Rug" },
      { name: "Modern-Rug" },
      { name: "云朵地毯" },
    ]),
    ["MODERN-RUG", "MODERN-RUG-2", "PRODUCT-003"],
  );
});

test("uploads every image slot and shares one SKU image across all sizes", () => {
  const main = image("main-1", "main");
  const detail = image("detail-1", "detail");
  const sku = image("sku-1", "sku");
  const result = attachBatchImageAssets({
    product: {
      main: [main],
      detail: [detail],
      square: [],
      swatch: [],
      description: [],
      sku: [sku],
    },
    uploaded: [
      { imageId: main.id, asset: { id: "asset-main" } },
      { imageId: detail.id, asset: { id: "asset-detail" } },
      { imageId: sku.id, asset: { id: "asset-sku" } },
    ],
    sizeRows: [{ id: "40x60" }, { id: "50x80" }],
  });

  assert.equal(result.mainAssetId, "asset-main");
  assert.equal(result.imageAssets.detail[0].assetId, "asset-detail");
  assert.deepEqual(
    result.sizeRows.map((row) => row.imageAssetId),
    ["asset-sku", "asset-sku"],
  );
});

test("blocks ambiguous SKU image counts instead of guessing the mapping", () => {
  const skuImages = [
    image("sku-1", "sku"),
    image("sku-2", "sku"),
  ];
  const result = attachBatchImageAssets({
    product: {
      main: [],
      detail: [],
      square: [],
      swatch: [],
      description: [],
      sku: skuImages,
    },
    uploaded: skuImages.map((item) => ({
      imageId: item.id,
      asset: { id: `asset-${item.id}` },
    })),
    sizeRows: [{ id: "1" }, { id: "2" }, { id: "3" }],
  });

  assert.equal(result.blockers.length, 1);
  assert.match(result.blockers[0], /请保留1张通用SKU图/);
  assert.ok(result.sizeRows.every((row) => row.imageAssetId === ""));
});

test("only fully preflighted drafts can enter a publish batch", () => {
  assert.equal(
    isDraftReadyForBatch({ status: "ready", preflight: { passed: true } }),
    true,
  );
  assert.equal(
    isDraftReadyForBatch({ status: "ready", preflight: { passed: false } }),
    false,
  );
  assert.equal(
    isDraftReadyForBatch({ status: "blocked", preflight: { passed: true } }),
    false,
  );
});
