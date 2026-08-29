import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProductFolderDraftShell,
  buildProductFolderImportGroups,
  productFolderName,
  suggestProductImageSlot,
  validateProductFolderMappings,
} from "./product-folder-import-contract.js";

function file(name, path, type = "image/jpeg") {
  return { name, type, webkitRelativePath: path };
}

test("recognizes explicit SHEIN image slots and defaults unmarked images to main", () => {
  assert.equal(suggestProductImageSlot(file("main_01.jpg", "商品A/main_01.jpg")), "main");
  assert.equal(suggestProductImageSlot(file("01.jpg", "商品A/细节/01.jpg")), "detail");
  assert.equal(suggestProductImageSlot(file("desc-1.png", "商品A/desc-1.png", "image/png")), "description");
  assert.equal(suggestProductImageSlot(file("sku_blue.jpg", "商品A/sku_blue.jpg")), "sku");
  assert.equal(suggestProductImageSlot(file("001.jpg", "商品A/001.jpg")), "main");
});

test("keeps a single product root when the second directory is an image slot", () => {
  assert.equal(productFolderName(file("01.jpg", "云朵地毯/主图/01.jpg")), "云朵地毯");
  assert.equal(productFolderName(file("02.jpg", "云朵地毯/细节/02.jpg")), "云朵地毯");
});

test("splits a batch root into product subfolders and ignores unsupported files", () => {
  const result = buildProductFolderImportGroups([
    file("main.jpg", "批量根目录/商品A/main.jpg"),
    file("detail.jpg", "批量根目录/商品A/detail.jpg"),
    file("main.png", "批量根目录/商品B/main.png", "image/png"),
    { name: "说明.pdf", type: "application/pdf", webkitRelativePath: "批量根目录/说明.pdf" },
  ]);
  assert.deepEqual(result.groups.map((group) => group.name), ["商品A", "商品B"]);
  assert.equal(result.groups[0].files.length, 2);
  assert.equal(result.ignoredCount, 1);
});

test("allows multiple main and SKU images while enforcing carousel limits", () => {
  const result = validateProductFolderMappings([
    { slot: "main" },
    { slot: "main" },
    { slot: "sku" },
    { slot: "sku" },
    ...Array.from({ length: 3 }, () => ({ slot: "detail" })),
    ...Array.from({ length: 2 }, () => ({ slot: "description" })),
  ], { existingDetailCount: 8, existingDescriptionCount: 9 });
  assert.equal(result.blockers.length, 2);
  assert.equal(result.counts.sku, 2);
  assert.equal(result.counts.unassigned, 0);
});

test("builds one local blocked draft shell without guessing SHEIN fields", () => {
  const result = buildProductFolderDraftShell({
    name: " 云朵地毯 ",
    uploadedImages: [
      { slot: "main", asset: { id: "main-1", originalName: "main.jpg", contentType: "image/jpeg", width: 1340, height: 1785, sizeBytes: 1024 } },
      { slot: "detail", asset: { id: "detail-1", originalName: "detail.jpg", contentType: "image/jpeg", width: 1340, height: 1785, sizeBytes: 2048 } },
      { slot: "sku", asset: { id: "sku-1", originalName: "sku.jpg", contentType: "image/jpeg", width: 800, height: 800, sizeBytes: 512 } },
      { slot: "unassigned", asset: { id: "ignored-1", originalName: "unknown.jpg" } },
    ],
  });

  assert.equal(result.input.name, "云朵地毯");
  assert.equal(result.input.categoryId, "");
  assert.equal(result.input.productTypeId, "");
  assert.equal(result.input.status, "blocked");
  assert.deepEqual(result.input.preflight, {});
  assert.deepEqual(result.input.data.imageAssets.main.map((asset) => asset.assetId), ["main-1"]);
  assert.deepEqual(result.input.data.imageAssets.detail.map((asset) => asset.assetId), ["detail-1"]);
  assert.deepEqual(result.input.data.skuPreviewImages.map((asset) => asset.assetId), ["sku-1"]);
  assert.equal("complianceTemplateId" in result.input.data, false);
  assert.equal("attributeValues" in result.input.data, false);
  assert.equal("publishSettings" in result.input.data, false);
  assert.equal(result.externalWrite, false);
});
