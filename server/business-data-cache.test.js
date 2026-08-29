import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { BusinessDataCache } from "./business-data-cache.js";

test("persists business snapshots independently for each store", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "shein-business-cache-"));
  const filePath = path.join(directory, "business.json");
  const cache = new BusinessDataCache({ filePath });

  cache.set("store-a", { products: [{ skc: "skc-a" }], totals: { sales7: 3 } });
  cache.set("store-b", { products: [], totals: { sales7: 0 } });

  const restored = new BusinessDataCache({ filePath });
  assert.equal(restored.get("store-a").value.products[0].skc, "skc-a");
  assert.equal(restored.get("store-b").value.totals.sales7, 0);
});

test("can update in memory without rewriting the recovery checkpoint", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "shein-business-cache-"));
  const filePath = path.join(directory, "business.json");
  const cache = new BusinessDataCache({ filePath });

  cache.set("store-a", { progress: 20 });
  cache.set("store-a", { progress: 40 }, { persist: false });

  assert.equal(cache.get("store-a").value.progress, 40);
  assert.equal(
    new BusinessDataCache({ filePath }).get("store-a").value.progress,
    20,
  );

  cache.set("store-a", { progress: 40 });
  assert.equal(
    new BusinessDataCache({ filePath }).get("store-a").value.progress,
    40,
  );
});

test("compacts duplicated legacy compliance arrays while loading", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "shein-business-cache-"));
  const filePath = path.join(directory, "business.json");
  writeFileSync(
    filePath,
    JSON.stringify({
      version: 1,
      records: [
        {
          storeId: "store-a",
          syncedAt: "2026-07-30T00:00:00.000Z",
          value: {
            compliance: {
              rows: [
                {
                  skc: "skc-a",
                  requirements: [{ certificateTypeId: 1 }],
                  photoRequirements: [{ labelId: 2 }],
                  certificateRequirements: [{ certificateTypeId: 1 }],
                  packagePhotoRequirements: [{ labelId: 2 }],
                },
              ],
            },
          },
        },
      ],
    }),
  );

  const cache = new BusinessDataCache({ filePath });
  const [row] = cache.get("store-a").value.compliance.rows;
  assert.equal("requirements" in row, false);
  assert.equal("photoRequirements" in row, false);
  assert.deepEqual(row.certificateRequirements, [{ certificateTypeId: 1 }]);
  assert.equal(
    readFileSync(filePath, "utf8").includes('"photoRequirements"'),
    false,
  );
});

test("removes stale photo failure reasons while loading the local cache", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "shein-business-cache-"));
  const filePath = path.join(directory, "business.json");
  writeFileSync(
    filePath,
    JSON.stringify({
      version: 1,
      records: [{
        storeId: "store-a",
        syncedAt: "2026-08-21T00:00:00.000Z",
        value: {
          compliance: {
            rows: [{
              skc: "skc-a",
              bodyPhotoRequirements: [
                { labelId: 1, isRequired: 0, reviewStatus: 3, failReason: ["非必传旧原因"] },
              ],
              packagePhotoRequirements: [
                { labelId: 2, isRequired: 1, reviewStatus: 1, failReasonList: ["已通过旧原因"] },
                { labelId: 3, isRequired: 1, reviewStatus: 3, failReason: ["当前失败原因"] },
              ],
            }],
          },
        },
      }],
    }),
  );

  const cache = new BusinessDataCache({ filePath });
  const [row] = cache.get("store-a").value.compliance.rows;
  assert.equal("failReason" in row.bodyPhotoRequirements[0], false);
  assert.equal("failReasonList" in row.packagePhotoRequirements[0], false);
  assert.deepEqual(row.packagePhotoRequirements[1].failReason, ["当前失败原因"]);
  const persisted = readFileSync(filePath, "utf8");
  assert.equal(persisted.includes("非必传旧原因"), false);
  assert.equal(persisted.includes("已通过旧原因"), false);
  assert.equal(persisted.includes("当前失败原因"), true);
});
