import test from "node:test";
import assert from "node:assert/strict";
import {
  PUBLISH_PREFLIGHT_PATHS,
  runPublishPreflight,
} from "./publish-preflight.js";

test("runs documented publish permission and supplier SKU checks", async () => {
  const calls = [];
  const result = await runPublishPreflight({
    supplierSkuList: ["RUG-40X60", "RUG-50X80", "RUG-40X60"],
    request: async (options) => {
      calls.push(options);
      if (options.path === PUBLISH_PREFLIGHT_PATHS.permission) {
        return {
          payload: {
            code: "0",
            info: { canPublishProduct: true, reason: "" },
          },
          diagnostics: { traceId: "permission-trace" },
        };
      }
      if (options.path === PUBLISH_PREFLIGHT_PATHS.shelfQuota) {
        return {
          payload: {
            code: "0",
            info: { isControlled: true, availableQuota: 12 },
          },
          diagnostics: { traceId: "quota-trace" },
        };
      }
      return {
        payload: {
          code: "0",
          info: [
            { supplierSku: "RUG-40X60", repeated: false },
            { supplierSku: "RUG-50X80", repeated: false },
          ],
        },
        diagnostics: { traceId: "sku-trace" },
      };
    },
  });

  assert.deepEqual(calls, [
    {
      method: "GET",
      path: "/open-api/goods/product/check-publish-permission",
    },
    {
      method: "POST",
      path: "/open-api/goods-publish-quotas/detail",
      body: {},
    },
    {
      method: "POST",
      path: "/open-api/goods/product/check-supplierSku-repeated",
      body: { supplierSkuList: ["RUG-40X60", "RUG-50X80"] },
    },
  ]);
  assert.equal(result.passed, true);
  assert.equal(result.supplierSkuCheck.requestedCount, 2);
});

test("treats an explicitly unlimited SHEIN publish quota as passed", async () => {
  const result = await runPublishPreflight({
    supplierSkuList: ["RUG-40X60"],
    request: async ({ path }) => {
      if (path === PUBLISH_PREFLIGHT_PATHS.permission) {
        return { payload: { code: "0", info: { canPublishProduct: true } }, diagnostics: {} };
      }
      if (path === PUBLISH_PREFLIGHT_PATHS.shelfQuota) {
        return {
          payload: { code: "0", info: { isControlled: false } },
          diagnostics: {},
        };
      }
      return {
        payload: { code: "0", info: [{ supplierSku: "RUG-40X60", repeated: false }] },
        diagnostics: {},
      };
    },
  });

  assert.equal(result.passed, true);
  assert.equal(result.shelfQuota.availability, "unlimited");
  assert.equal(result.shelfQuota.availableQuota, null);
});

test("allows a publish candidate without merchant SKU values", async () => {
  const paths = [];
  const result = await runPublishPreflight({
    supplierSkuList: [],
    request: async ({ path }) => {
      paths.push(path);
      if (path === PUBLISH_PREFLIGHT_PATHS.permission) {
        return { payload: { code: "0", info: { canPublishProduct: true } }, diagnostics: {} };
      }
      return {
        payload: { code: "0", info: { isControlled: false } },
        diagnostics: {},
      };
    },
  });

  assert.equal(result.passed, true);
  assert.equal(result.supplierSkuCheck.requestedCount, 0);
  assert.equal(result.supplierSkuCheck.checkedCount, 0);
  assert.deepEqual(paths, [
    PUBLISH_PREFLIGHT_PATHS.permission,
    PUBLISH_PREFLIGHT_PATHS.shelfQuota,
  ]);
});

test("blocks publishing when the store is denied or an SKU is repeated", async () => {
  const result = await runPublishPreflight({
    supplierSkuList: ["TAKEN-SKU"],
    request: async ({ path }) => {
      if (path === PUBLISH_PREFLIGHT_PATHS.permission) {
        return {
            payload: {
              code: "0",
              info: {
                canPublishProduct: false,
                reason: "店铺当前不可发品",
              },
            },
            diagnostics: {},
          };
      }
      if (path === PUBLISH_PREFLIGHT_PATHS.shelfQuota) {
        return {
          payload: { code: "0", info: { availableLimit: 0 } },
          diagnostics: {},
        };
      }
      return {
        payload: {
          code: "0",
          info: [{ supplierSku: "TAKEN-SKU", repeated: true }],
        },
        diagnostics: {},
      };
    },
  });

  assert.equal(result.passed, false);
  assert.deepEqual(result.supplierSkuCheck.repeatedSkus, ["TAKEN-SKU"]);
  assert.deepEqual(result.blockers, [
    "店铺当前不可发品",
    "当前店铺没有可用上架额度",
    "已有 1 个商家SKU被占用",
  ]);
});

test("keeps publish preflight usable when the separate quota endpoint is not authorized", async () => {
  const result = await runPublishPreflight({
    supplierSkuList: ["RUG-40X60"],
    request: async ({ path }) => {
      if (path === PUBLISH_PREFLIGHT_PATHS.permission) {
        return {
          payload: { code: "0", info: { canPublishProduct: true } },
          diagnostics: { traceId: "permission-trace" },
        };
      }
      if (path === PUBLISH_PREFLIGHT_PATHS.shelfQuota) {
        const error = new Error("应用没有该接口访问权限，请检查：/open-api/goods/query-shelf-quota");
        error.traceId = "quota-denied-trace";
        error.status = 403;
        throw error;
      }
      return {
        payload: {
          code: "0",
          info: [{ supplierSku: "RUG-40X60", repeated: false }],
        },
        diagnostics: { traceId: "sku-trace" },
      };
    },
  });

  assert.equal(result.passed, true);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.shelfQuota.availableLimit, null);
  assert.equal(result.shelfQuota.availability, "unavailable");
  assert.match(result.warnings[0], /真实发布时由SHEIN最终校验额度/);
});

test("checks more than 200 supplier SKUs in documented 200-item batches", async () => {
  const skuBatchSizes = [];
  const result = await runPublishPreflight({
    supplierSkuList: Array.from({ length: 201 }, (_, index) => `SKU-${index}`),
    request: async ({ path, body }) => {
      if (path === PUBLISH_PREFLIGHT_PATHS.permission) {
        return {
          payload: { code: "0", info: { canPublishProduct: true } },
          diagnostics: {},
        };
      }
      if (path === PUBLISH_PREFLIGHT_PATHS.shelfQuota) {
        return {
          payload: { code: "0", info: { availableLimit: 8 } },
          diagnostics: {},
        };
      }
      skuBatchSizes.push(body.supplierSkuList.length);
      return {
        payload: {
          code: "0",
          info: body.supplierSkuList.map((supplierSku) => ({
            supplierSku,
            repeated: false,
          })),
        },
        diagnostics: {},
      };
    },
  });

  assert.deepEqual(skuBatchSizes, [200, 1]);
  assert.equal(result.passed, true);
  assert.equal(result.supplierSkuCheck.checkedCount, 201);
});
