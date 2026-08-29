import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPublishProduct,
  classifyPublishImage,
  validatePublishImage,
} from "./publish-image-rules.js";

const imageFile = (name = "main_1.jpg", size = 512 * 1024) => ({ name, size });

test("classifies supported folder naming conventions", () => {
  assert.equal(classifyPublishImage("main_1.jpg"), "main");
  assert.equal(classifyPublishImage("detail_2.png"), "detail");
  assert.equal(classifyPublishImage("square_front.jpg"), "square");
  assert.equal(classifyPublishImage("swatch_blue.png"), "swatch");
  assert.equal(classifyPublishImage("description_01.jpg"), "description");
  assert.equal(classifyPublishImage("sku_red.jpg"), "sku");
});

test("accepts SHEIN main image dimensions", () => {
  assert.deepEqual(
    validatePublishImage(imageFile(), "main", 1340, 1785),
    [],
  );
  assert.deepEqual(
    validatePublishImage(imageFile(), "main", 1200, 1200),
    [],
  );
  assert.deepEqual(
    validatePublishImage(imageFile("sku.jpg"), "sku", 1340, 1785),
    [],
  );
});

test("rejects invalid main and oversized images", () => {
  const issues = validatePublishImage(
    imageFile("main_1.jpg", 4 * 1024 * 1024),
    "main",
    1000,
    1400,
  );
  assert.equal(issues.length, 2);
  assert.match(issues[0], /3MB/);
});

test("validates swatch and description image slots", () => {
  assert.deepEqual(
    validatePublishImage(imageFile("swatch.png"), "swatch", 80, 80),
    [],
  );
  assert.deepEqual(
    validatePublishImage(imageFile("description.jpg"), "description", 900, 1200),
    [],
  );
  assert.equal(
    validatePublishImage(imageFile("swatch.png"), "swatch", 120, 120).length,
    1,
  );
});

test("builds product blockers and SKU image source", () => {
  const product = buildPublishProduct({
    name: "BathMat",
    files: [
      {
        id: "sku",
        type: "sku",
        file: imageFile("sku_blue.jpg"),
        issues: [],
        previewUrl: "blob:sku",
      },
    ],
  });
  assert.equal(product.skuImageSource, "1 张独立 SKU 图");
  assert.match(product.blockers[0], /缺少主图/);
});
