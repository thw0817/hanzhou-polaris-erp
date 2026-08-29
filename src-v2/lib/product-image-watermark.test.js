import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_WATERMARK_OPTIONS,
  normalizeWatermarkOptions,
} from "./product-image-watermark.js";

test("normalizes watermark text to half-width English while preserving spaces", () => {
  assert.deepEqual(normalizeWatermarkOptions({
    text: "  SHEIN 地毯  ",
    fontSize: 999,
    opacity: 0.99,
    color: "#ABCDEF",
  }), {
    text: "  SHEIN   ",
    fontSize: 160,
    opacity: 0.5,
    color: "#abcdef",
  });
});

test("falls back to stable defaults for invalid watermark settings", () => {
  assert.deepEqual(normalizeWatermarkOptions({ text: "", fontSize: "bad", opacity: "bad", color: "red" }), {
    ...DEFAULT_WATERMARK_OPTIONS,
  });
});
