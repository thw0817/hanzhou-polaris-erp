import assert from "node:assert/strict";
import test from "node:test";
import {
  isSheinMainImageReady,
  outputSizeForPreset,
} from "./main-image-crop.js";

test("accepts only SHEIN portrait or square main-image dimensions under 3MB", () => {
  assert.equal(isSheinMainImageReady({ width: 1340, height: 1785, sizeBytes: 1000 }), true);
  assert.equal(isSheinMainImageReady({ width: 1200, height: 1200, sizeBytes: 1000 }), true);
  assert.equal(isSheinMainImageReady({ width: 1340, height: 1750, sizeBytes: 1000 }), false);
  assert.equal(isSheinMainImageReady({ width: 800, height: 800, sizeBytes: 1000 }), false);
  assert.equal(isSheinMainImageReady({ width: 1200, height: 1200, sizeBytes: 4 * 1024 * 1024 }), false);
});

test("uses exact SHEIN output sizes for crop presets", () => {
  assert.deepEqual(outputSizeForPreset("portrait"), {
    id: "portrait",
    label: "纵图 1340×1785",
    aspect: 1340 / 1785,
    width: 1340,
    height: 1785,
  });
  assert.equal(outputSizeForPreset("square").width, 1200);
});
