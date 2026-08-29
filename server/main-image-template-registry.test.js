import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { MainImageTemplateRegistry } from "./main-image-template-registry.js";
import { LocalImageAssetStore } from "./local-image-assets.js";

test("persists append-only main image templates", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "shein-main-images-"));
  const registry = new MainImageTemplateRegistry({
    filePath: path.join(directory, "templates.json"),
  });
  const template = registry.save({
    name: "天鹅绒尾图",
    storeId: "store-1",
    images: [{ id: "image-1", url: "/api/local-assets/main-images/a.jpg" }],
  });
  assert.equal(template.placement, "append");
  assert.equal(template.imageType, 1);
  assert.equal(registry.list({ storeId: "store-1" })[0].name, "天鹅绒尾图");
});

test("stores local JPG assets with opaque names", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "shein-image-assets-"));
  const store = new LocalImageAssetStore({ directory });
  const saved = store.save({
    bytes: Buffer.from([1, 2, 3]),
    mimeType: "image/jpeg",
    originalName: "material.jpg",
  });
  assert.match(saved.fileName, /^[0-9a-f-]+\.jpg$/);
  assert.deepEqual(store.get(saved.fileName).bytes, Buffer.from([1, 2, 3]));
});
