import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_PRODUCT_IMAGE_BYTES,
  shouldCompressProductImage,
} from "./product-image-compress.js";

test("compresses only images above the 3MB upload threshold", () => {
  assert.equal(MAX_PRODUCT_IMAGE_BYTES, 3 * 1024 * 1024);
  assert.equal(shouldCompressProductImage({ size: 3 * 1024 * 1024 }), false);
  assert.equal(shouldCompressProductImage({ size: 3 * 1024 * 1024 + 1 }), true);
});
