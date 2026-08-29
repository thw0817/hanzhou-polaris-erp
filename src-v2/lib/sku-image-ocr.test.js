import assert from "node:assert/strict";
import test from "node:test";
import {
  autoMapSkuPreviewImagesByOcr,
  extractSkuImageDimensionTokens,
} from "./sku-image-ocr.js";

test("extracts both orientations from OCR dimension text", () => {
  assert.deepEqual([...extractSkuImageDimensionTokens("40 × 60 cm")].sort(), ["40x60", "60x40"]);
});

test("maps a SKU preview image from OCR-recognized size text", () => {
  const result = autoMapSkuPreviewImagesByOcr([
    { id: "row-1", sizeText: "40×60 cm", lengthCm: 60, widthCm: 40 },
    { id: "row-2", sizeText: "80×120 cm", lengthCm: 120, widthCm: 80 },
  ], [{ id: "asset-1", recognizedText: "PRODUCT LABEL 40 x 60 cm" }]);
  assert.equal(result.rows[0].imageAssetId, "asset-1");
  assert.equal(result.rows[0].imageAssetSource, "per_sku_ocr");
  assert.deepEqual(result.unmatchedAssetIds, []);
});
