import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { AttributeTemplateRegistry } from "./attribute-template-registry.js";

test("saves, updates, lists and deletes named product attribute templates", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "shein-attributes-"));
  const filePath = path.join(directory, "templates.json");
  const registry = new AttributeTemplateRegistry({ filePath });

  const saved = registry.save({
    name: "天鹅绒地毯属性",
    storeId: "store-1",
    categoryId: "991",
    productTypeId: "3155",
    attributeValues: { 10: { valueIds: ["20"], customValue: "" } },
    perProductFieldIds: ["30"],
  });
  assert.equal(
    registry.list({ storeId: "store-1", productTypeId: "3155" }).length,
    1,
  );

  const updated = registry.save({ ...saved, name: "天鹅绒地毯属性二版" });
  assert.equal(updated.version, 2);
  assert.equal(updated.name, "天鹅绒地毯属性二版");
  assert.equal(registry.remove(saved.id), true);
  assert.equal(registry.list().length, 0);

  const persisted = JSON.parse(readFileSync(filePath, "utf8"));
  assert.deepEqual(persisted.templates, []);
});
