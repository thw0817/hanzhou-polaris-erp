import test from "node:test";
import assert from "node:assert/strict";
import { appendTailMainImages } from "./main-image-template.js";

test("appends reusable images after product main images", () => {
  const result = appendTailMainImages(
    [{ id: "main-1" }, { id: "main-2" }],
    {
      id: "template-1",
      name: "天鹅绒尾图",
      images: [{ id: "tail-1" }, { id: "tail-2" }],
    },
  );

  assert.deepEqual(
    result.images.map((image) => image.id),
    ["main-1", "main-2", "tail-1", "tail-2"],
  );
  assert.deepEqual(
    result.images.map((image) => image.sequence),
    [1, 2, 3, 4],
  );
  assert.equal(result.productCount, 2);
  assert.equal(result.tailCount, 2);
  assert.equal(result.images[2].source, "tail-template");
  assert.equal(result.images[2].templateId, "template-1");
  assert.ok(result.images.every((image) => image.apiImageType === undefined));
});

test("does not add tail images when no template is selected", () => {
  const result = appendTailMainImages([{ id: "main-1" }]);

  assert.deepEqual(result.images.map((image) => image.id), ["main-1"]);
  assert.equal(result.tailCount, 0);
});
