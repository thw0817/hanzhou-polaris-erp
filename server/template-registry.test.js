import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { TemplateRegistry } from "./template-registry.js";

function createRegistry() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "shein-template-registry-"));
  const filePath = path.join(directory, "templates.json");
  return { filePath, registry: new TemplateRegistry({ filePath }) };
}

test("persists product templates by store and increments versions", () => {
  const { filePath, registry } = createRegistry();
  const created = registry.save({
    name: "装饰地毯",
    storeId: "S1",
    templateType: "product",
    categoryId: "3155",
    productTypeId: "991",
    attributeValues: { 77: { valueIds: ["284"], customValue: "" } },
  });
  const updated = registry.save({ ...created, name: "装饰地毯新版" });

  assert.equal(updated.version, 2);
  assert.equal(updated.revisions.length, 2);
  assert.equal(registry.list({ storeId: "S1" }).length, 1);
  assert.equal(registry.list({ storeId: "S2" }).length, 0);
  assert.equal(statSync(filePath).mode & 0o777, 0o600);

  const restored = new TemplateRegistry({ filePath });
  assert.equal(restored.get(created.id).name, "装饰地毯新版");
  assert.equal(JSON.parse(readFileSync(filePath, "utf8")).version, 1);
});

test("removes a saved template", () => {
  const { registry } = createRegistry();
  const template = registry.save({
    name: "门垫",
    storeId: "S1",
    templateType: "product",
    categoryId: "1954",
    productTypeId: "209",
  });
  assert.equal(registry.remove(template.id), true);
  assert.equal(registry.list().length, 0);
});
