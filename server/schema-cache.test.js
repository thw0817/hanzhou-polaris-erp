import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { SchemaCache } from "./schema-cache.js";

test("persists SHEIN schemas by store, kind and category key", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "shein-schema-cache-"));
  const filePath = path.join(directory, "schema.json");
  const cache = new SchemaCache({ filePath });
  cache.set("S1", "attributes", "991", { data: [{ product_type_id: 991 }] });

  const restored = new SchemaCache({ filePath });
  assert.deepEqual(restored.get("S1", "attributes", "991").value, {
    data: [{ product_type_id: 991 }],
  });
  assert.equal(restored.get("S2", "attributes", "991"), null);
});

