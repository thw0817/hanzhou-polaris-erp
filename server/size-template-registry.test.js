import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SizeTemplateRegistry } from "./size-template-registry.js";

test("saves, lists, updates and removes named size templates", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "shein-size-templates-"));
  const filePath = path.join(directory, "templates.json");
  const registry = new SizeTemplateRegistry({ filePath });
  const created = registry.save({
    name: "矩形地毯常用尺寸",
    storeId: "store-1",
    categoryId: "3155",
    productTypeId: "991",
    shape: "rectangle",
    rows: [{ id: "row-1", sheinAttributeValueId: 100 }],
  });
  assert.equal(registry.list({ storeId: "store-1" }).length, 1);
  const updated = registry.save({ ...created, name: "矩形地毯完整尺寸" });
  assert.equal(updated.version, 2);
  assert.equal(registry.remove(created.id), true);
  assert.equal(registry.list().length, 0);
  assert.equal(JSON.parse(readFileSync(filePath, "utf8")).version, 1);
});
