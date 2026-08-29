import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProductImageStage,
  orderedTailTemplateImages,
} from "./product-image-contract.js";

const main = { assetId: "asset-main", originalName: "main.jpg" };
const mainSecond = { assetId: "asset-main-2", originalName: "main-2.jpg" };
const detail = { assetId: "asset-detail", originalName: "detail.jpg" };
const tailTemplate = {
  id: "tail-template-1",
  name: "售后说明",
  data: {
    placement: "append",
    assetIds: ["asset-tail-2", "asset-tail-1"],
    assets: [
      { id: "asset-tail-1", originalName: "tail-1.jpg" },
      { id: "asset-tail-2", originalName: "tail-2.jpg" },
    ],
  },
};

test("keeps tail template order and appends it after product images", () => {
  assert.deepEqual(
    orderedTailTemplateImages(tailTemplate).map((asset) => asset.id),
    ["asset-tail-2", "asset-tail-1"],
  );
  const result = buildProductImageStage({
    mainImages: [main],
    detailImages: [detail],
    tailTemplate,
    pictureConfig: [
      { field_key: "switch_spu_picture", is_true: false },
      { field_key: "skc_image_detail_show", is_true: true },
      { field_key: "skc_image_detail_required", is_true: true },
    ],
    fillInStandard: [{
      field_key: "product_detail_picture",
      show: true,
      required: false,
    }],
  });

  assert.equal(result.valid, true);
  assert.equal(result.scheme, "legacy-skc");
  assert.deepEqual(result.rules, {
    detailAllowed: true,
    detailRequired: true,
    siteDetailRuleReturned: true,
    siteDetailAllowed: true,
    siteDetailRequired: false,
    siteDetailFieldKey: "product_detail_picture",
  });
  assert.deepEqual(
    result.uploads.map((item) => [
      item.localId,
      item.targetLevel,
      item.imageType,
      item.imageSort,
      item.source,
    ]),
    [
      ["asset-main", "skc", 1, 1, "product"],
      ["asset-detail", "skc", 2, 2, "product"],
      ["asset-tail-2", "skc", 2, 3, "tail-template"],
      ["asset-tail-1", "skc", 2, 4, "tail-template"],
    ],
  );
});

test("plans only dynamically allowed type-7 site detail images", () => {
  const allowed = buildProductImageStage({
    mainImages: [main],
    descriptionImages: [{ assetId: "asset-description", originalName: "description.jpg" }],
    fillInStandard: [{
      field_key: "product_detail_pic",
      show: true,
      required: true,
    }],
  });
  assert.equal(allowed.valid, true);
  assert.deepEqual(
    allowed.uploads.map((item) => [item.localId, item.targetLevel, item.imageType, item.imageSort]),
    [
      ["asset-main", "skc", 1, 1],
      ["asset-description", "site-detail", 7, 1],
    ],
  );

  const forbidden = buildProductImageStage({
    mainImages: [main],
    descriptionImages: [{ assetId: "asset-description" }],
    fillInStandard: [{
      field_key: "product_detail_picture",
      show: false,
      required: false,
    }],
  });
  assert.equal(forbidden.blockers[0].code, "SITE_DETAIL_IMAGES_NOT_ALLOWED");

  const required = buildProductImageStage({
    mainImages: [main],
    fillInStandard: [{
      field_key: "product_detail_picture",
      show: true,
      required: true,
    }],
  });
  assert.equal(required.blockers[0].code, "SITE_DETAIL_IMAGE_REQUIRED");
});

test("plans one SKC square image as SHEIN image_type 5", () => {
  const result = buildProductImageStage({
    mainImages: [main],
    squareImages: [{ assetId: "asset-square", originalName: "square.jpg" }],
    swatchImages: [{ assetId: "asset-swatch", originalName: "swatch.jpg" }],
  });
  assert.equal(result.valid, true);
  assert.deepEqual(
    result.uploads.find((item) => item.slot === "square"),
    {
      localId: "asset-square",
      name: "square.jpg",
      previewUrl: "",
      source: "product",
      templateId: "",
      targetLevel: "skc",
      imageType: 5,
      imageSort: 2,
      slot: "square",
      status: "local",
    },
  );
  assert.equal(result.counts.square, 1);
  assert.deepEqual(
    result.uploads.find((item) => item.slot === "swatch"),
    {
      localId: "asset-swatch",
      name: "swatch.jpg",
      previewUrl: "",
      source: "product",
      templateId: "",
      targetLevel: "skc",
      imageType: 6,
      imageSort: 3,
      slot: "swatch",
      status: "local",
    },
  );
  assert.equal(result.counts.swatch, 1);
});

test("uses the live picture switch for SPU images", () => {
  const result = buildProductImageStage({
    mainImages: [main],
    pictureConfig: [
      { field_key: "switch_spu_picture", is_true: true },
      { field_key: "spu_image_detail_show", is_true: true },
    ],
  });

  assert.equal(result.scheme, "new-spu");
  assert.equal(result.rules.detailAllowed, true);
  assert.equal(result.uploads[0].targetLevel, "spu");
});

test("accepts multiple ordered product main images", () => {
  const result = buildProductImageStage({
    mainImages: [main, mainSecond],
    pictureConfig: [{ field_key: "switch_spu_picture", is_true: true }],
  });
  assert.equal(result.valid, true);
  assert.deepEqual(
    result.uploads.map((item) => [item.localId, item.imageSort]),
    [["asset-main", 1], ["asset-main-2", 2]],
  );
});

test("fails closed for missing, forbidden or excessive detail images", () => {
  const missing = buildProductImageStage({
    pictureConfig: [
      { field_key: "skc_image_detail_required", is_true: true },
    ],
  });
  assert.deepEqual(
    missing.blockers.map((item) => item.code),
    ["PRODUCT_MAIN_IMAGE_REQUIRED", "PRODUCT_DETAIL_IMAGE_REQUIRED"],
  );

  const forbidden = buildProductImageStage({
    mainImages: [main],
    detailImages: [detail],
    pictureConfig: [
      { field_key: "skc_image_detail_show", is_true: false },
    ],
  });
  assert.deepEqual(
    forbidden.blockers.map((item) => item.code),
    ["PRODUCT_DETAIL_IMAGES_NOT_ALLOWED"],
  );
  assert.equal(forbidden.rules.detailAllowed, false);

  const excessive = buildProductImageStage({
    mainImages: [main],
    detailImages: Array.from({ length: 11 }, (_, index) => ({
      assetId: `detail-${index}`,
    })),
    pictureConfig: [
      { field_key: "skc_image_detail_show", is_true: true },
    ],
  });
  assert.equal(excessive.blockers[0].code, "PRODUCT_DETAIL_IMAGE_LIMIT");
});
