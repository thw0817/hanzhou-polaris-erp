import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPublishSchemaCoverage,
  flattenPublishCategoryLeaves,
} from "./publish-schema-coverage.js";

test("publish schema coverage keeps every SHEIN leaf category", () => {
  const info = {
    data: [{
      category_id: 100,
      category_name: "家居",
      last_category: false,
      children: [{
        category_id: 101,
        category_name: "床品",
        last_category: false,
        children: [{
          category_id: 102,
          product_type_id: 202,
          category_name: "被套",
          last_category: true,
        }],
      }],
    }],
  };

  assert.deepEqual(flattenPublishCategoryLeaves(info), [{
    categoryId: "102",
    productTypeId: "202",
    name: "被套",
    path: ["家居", "床品", "被套"],
  }]);
});

test("publish schema coverage marks attribute and publish standard separately", () => {
  const result = buildPublishSchemaCoverage({
    categoryInfo: {
      data: [
        {
          category_id: 101,
          category_name: "床品",
          last_category: true,
          product_type_id: 202,
        },
        {
          category_id: 102,
          category_name: "地毯",
          last_category: true,
          product_type_id: 303,
        },
      ],
    },
    attributeSnapshots: [
      { productTypeId: "202", fetchedAt: "2026-08-07T00:00:00.000Z" },
    ],
    publishStandardSnapshots: [
      { categoryId: "101", fetchedAt: "2026-08-07T00:00:00.000Z" },
      { categoryId: "102", fetchedAt: "2026-08-07T00:00:00.000Z" },
    ],
  });

  assert.deepEqual(result.summary, {
    total: 2,
    ready: 1,
    pending: 1,
    attributeReady: 1,
    publishStandardReady: 2,
  });
  assert.equal(result.categories[0].ready, true);
  assert.equal(result.categories[1].attributeReady, false);
  assert.equal(result.categories[1].publishStandardReady, true);
});
