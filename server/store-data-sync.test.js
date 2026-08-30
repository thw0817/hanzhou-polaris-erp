import test from "node:test";
import assert from "node:assert/strict";
import {
  buildStoreBusinessWarnings,
  STORE_DATA_PATHS,
  summarizeStoreBusinessData,
  syncStoreBusinessData,
} from "./store-data-sync.js";

function syncStoreBusinessDataForSyntheticTest(input = {}) {
  return syncStoreBusinessData({
    ...input,
    allowSourcePendingSyntheticReadForTest: true,
  });
}

test("business sync locks source-pending SKU sales before any request", async () => {
  let requests = 0;
  await assert.rejects(
    syncStoreBusinessData({
      request: async () => {
        requests += 1;
        throw new Error("must not request SHEIN");
      },
    }),
    (error) => error.code === "ERP07_ADAPTER_SOURCE_PENDING_READ_DISABLED" && error.status === 409,
  );
  assert.equal(requests, 0);
});

test("builds stock, slow-moving and sales-drop warnings only from real product metrics", () => {
  const warnings = buildStoreBusinessWarnings([
    {
      id: "SKC-1", skc: "SKC-1", name: "断货地毯", state: "已上架",
      inventory: 0, sales: { sales7: 7, sales30: 30 },
    },
    {
      id: "SKC-2", skc: "SKC-2", name: "滞销地毯", state: "已上架",
      inventory: 25, sales: { sales7: 0, sales30: 0 },
    },
    {
      id: "SKC-3", skc: "SKC-3", name: "下降地毯", state: "已上架",
      inventory: 80, sales: { sales7: 2, sales30: 40 },
    },
  ]);
  assert.ok(warnings.some((warning) => warning.type === "out_of_stock"));
  assert.ok(warnings.some((warning) => warning.type === "slow_moving"));
  assert.ok(warnings.some((warning) => warning.type === "sales_drop"));
  assert.equal(warnings[0].severity, "high");
});

test("flags a fast-selling product within its first seven listing days", () => {
  const warnings = buildStoreBusinessWarnings([{
    id: "NEW-1",
    skc: "NEW-1",
    name: "新品地毯",
    state: "已上架",
    listingDays: 6,
    actualInventory: 2,
    sales: { today: 1, sales7: 5, sales30: 5 },
  }]);
  const warning = warnings.find((item) => item.type === "new_product_restock");
  assert.ok(warning);
  assert.equal(warning.severity, "high");
  assert.equal(warning.suggestedRestock, 3);
  assert.match(warning.message, /建议至少补货 3 件/);
});

function skc(skcName, skuCode, shelfStatus = 1) {
  return {
    skcName,
    skcShelfStatus: shelfStatus,
    skcTitle: [{ language: "zh-cn", title: `${skcName}标题` }],
    skuList: [{ skuCode, supplierSku: `${skuCode}-merchant` }],
  };
}

test("paginates products, batches SKU sales and aggregates store totals", async () => {
  const calls = [];
  const result = await syncStoreBusinessDataForSyntheticTest({
    request: async (options) => {
      calls.push(options);
      if (options.path === STORE_DATA_PATHS.productSearch) {
        const page = options.body.pageNum;
        return {
          payload: {
            code: "0",
            info: {
              meta: { count: 11 },
              data:
                page === 1
                  ? Array.from({ length: 10 }, (_, index) => ({
                      spuName: `spu-${index}`,
                      categoryId: "3155",
                      skcList: [skc(`skc-${index}`, `sku-${index}`)],
                    }))
                  : [
                      {
                        spuName: "spu-10",
                        categoryId: "3155",
                        skcList: [skc("skc-10", "sku-10")],
                      },
                    ],
            },
          },
          diagnostics: { traceId: `product-${page}` },
        };
      }
      return {
        payload: {
          code: "0",
          info: {
            dataList: options.body.skuCodeList.map((skuCode, index) => ({
              skuCode,
              realTimeSaleCnt: index + 1,
              cydSaleCnt: 1,
              c7dSaleCnt: 2,
              c30dSaleCnt: 3,
              dt: "20260728",
            })),
          },
        },
        diagnostics: { traceId: "sales-1" },
      };
    },
  });

  assert.equal(result.spuCount, 11);
  assert.equal(result.productCount, 11);
  assert.equal(result.skuCount, 11);
  assert.equal(result.totals.today, 66);
  assert.equal(result.totals.sales7, 22);
  assert.equal(result.products[0].sales7, 2);
  assert.equal(result.products[0].replenishmentGap, null);
  assert.equal(result.products[0].transitInventory, null);
  assert.equal(result.totals.transitInventory, null);
  assert.equal(result.totals.actualInventory, null);
  assert.equal(
    calls.filter((call) => call.path === STORE_DATA_PATHS.productSearch).length,
    2,
  );
  assert.deepEqual(
    calls.find((call) => call.path === STORE_DATA_PATHS.skuSales).body
      .skuCodeList,
    Array.from({ length: 11 }, (_, index) => `sku-${index}`),
  );
  assert.equal(result.diagnostics.productPageCount, 2);
  assert.equal(result.diagnostics.salesBatchCount, 1);
  assert.deepEqual(summarizeStoreBusinessData(result), {
    totals: {
      today: 66,
      yesterday: 11,
      sales7: 22,
      sales30: 33,
    },
    productCount: 11,
    spuCount: 11,
    skuCount: 11,
    dataDate: "20260728",
  });
});

test("uses exact shelf state, physical stock, listing days and SKU metrics", async () => {
  const result = await syncStoreBusinessDataForSyntheticTest({
    now: () => new Date("2026-08-02T06:00:00.000Z"),
    request: async (options) => {
      if (options.path === STORE_DATA_PATHS.productSearch) {
        return {
          payload: { info: { meta: { count: 1 }, data: [{
            spuName: "spu-1",
            skcList: [{
              ...skc("sf260725201011173711193", "sku-1", 0),
              skcMainPicUrl: "https://example.test/rug.jpg",
              skuList: [{
                skuCode: "sku-1",
                supplierSku: "4060",
                skuSalesAttributeList: [{
                  language: "zh-cn",
                  attributeValueName: "40×60cm",
                }],
              }],
            }],
          }] } },
          diagnostics: {},
        };
      }
      if (options.path === STORE_DATA_PATHS.skuSales) {
        return {
          payload: { info: { dataList: [{
            skuCode: "sku-1", realTimeSaleCnt: 2, cydSaleCnt: 1,
            c7dSaleCnt: 7, c30dSaleCnt: 30, dt: "20260801",
          }] } },
          diagnostics: {},
        };
      }
      if (options.path === STORE_DATA_PATHS.exactShelfStatus) {
        return {
          payload: { info: [{ skc: "sf260725201011173711193", skcShelfStatus: 0 }] },
          diagnostics: {},
        };
      }
      if (options.path === STORE_DATA_PATHS.stockQuery) {
        const usable = 12;
        return {
          payload: { info: [{ goodsInventory: [{ skuList: [{
            skuCode: "sku-1",
            totalInventoryQuantity: usable,
            totalUsableInventory: usable,
            totalLockedQuantity: 0,
            totalTempLockQuantity: 0,
            totalTransitQuantity: 5,
          }] }] }] },
          diagnostics: {},
        };
      }
      if (options.path === STORE_DATA_PATHS.productDetail) {
        return {
          payload: { info: { skcInfoList: [{
            skcName: "sf260725201011173711193",
            shelfStatusInfoList: [{ firstShelfTime: "2026-07-25 10:00:00", shelfStatus: 0 }],
            skuInfoList: [{
              skuCode: "sku-1",
              supplierSku: "4060",
              saleAttributeList: [{
                attributeValueMultiList: [{ language: "zh-cn", attributeValueName: "40×60cm" }],
              }],
            }],
          }] } },
          diagnostics: {},
        };
      }
      throw new Error(`unexpected path ${options.path}`);
    },
  });

  const product = result.products[0];
  assert.equal(product.state, "待上架");
  assert.equal(product.statusCode, 0);
  assert.equal(product.statusSource, "shein_skc_label_list");
  assert.equal(product.actualInventory, 12);
  assert.equal(product.transitInventory, 5);
  assert.equal(product.listingDays, 9);
  assert.equal("sellingMode" in product, false);
  assert.equal("virtualInventory" in product, false);
  assert.equal(product.skus[0].size, "40×60cm");
  assert.equal(product.skus[0].transitInventory, 5);
  assert.equal(product.skus[0].suggestedRestock, 0);
  assert.equal(product.skus[0].replenishmentGap, 0);
  assert.equal(product.replenishmentGap, 0);
  assert.equal(result.totals.pendingProductCount, 1);
  assert.equal(result.totals.transitInventory, 5);
  assert.equal(result.totals.offShelfProductCount, 0);
});

test("does not infer the shelf label when the exact SHEIN status readback fails", async () => {
  const result = await syncStoreBusinessDataForSyntheticTest({
    request: async (options) => {
      if (options.path === STORE_DATA_PATHS.productSearch) {
        return {
          payload: { info: { meta: { count: 1 }, data: [{
            spuName: "spu-1",
            skcList: [skc("skc-1", "sku-1", 1)],
          }] } },
          diagnostics: {},
        };
      }
      if (options.path === STORE_DATA_PATHS.skuSales) {
        return { payload: { info: { dataList: [] } }, diagnostics: {} };
      }
      if (options.path === STORE_DATA_PATHS.exactShelfStatus) {
        throw Object.assign(new Error("status endpoint unavailable"), { code: "E_DOWN" });
      }
      if (options.path === STORE_DATA_PATHS.stockQuery) {
        return { payload: { info: [] }, diagnostics: {} };
      }
      if (options.path === STORE_DATA_PATHS.productDetail) {
        return { payload: { info: { skcInfoList: [] } }, diagnostics: {} };
      }
      throw new Error(`unexpected path ${options.path}`);
    },
  });

  assert.equal(result.products[0].state, "待同步");
  assert.equal(result.products[0].statusCode, null);
  assert.equal(result.products[0].statusSource, "unavailable");
  assert.ok(result.diagnostics.optionalFailures.some(
    (failure) => failure.path === STORE_DATA_PATHS.exactShelfStatus,
  ));
});

test("keeps missing stock-query fields unknown instead of creating a false zero-stock warning", async () => {
  const result = await syncStoreBusinessDataForSyntheticTest({
    request: async (options) => {
      if (options.path === STORE_DATA_PATHS.productSearch) {
        return { payload: { info: { meta: { count: 1 }, data: [{
          spuName: "spu-1", skcList: [skc("skc-unknown", "sku-unknown", 1)],
        }] } }, diagnostics: {} };
      }
      if (options.path === STORE_DATA_PATHS.skuSales) {
        return { payload: { info: { dataList: [{ skuCode: "sku-unknown", c7dSaleCnt: 7, c30dSaleCnt: 7 }] } }, diagnostics: {} };
      }
      if (options.path === STORE_DATA_PATHS.stockQuery) {
        return { payload: { info: [] }, diagnostics: {} };
      }
      if (options.path === STORE_DATA_PATHS.exactShelfStatus) {
        return { payload: { info: [{ skc: "skc-unknown", skcShelfStatus: 1 }] }, diagnostics: {} };
      }
      if (options.path === STORE_DATA_PATHS.productDetail) {
        return { payload: { info: { skcInfoList: [] } }, diagnostics: {} };
      }
      throw new Error(`unexpected path ${options.path}`);
    },
  });

  const product = result.products[0];
  assert.equal(product.actualInventory, null);
  assert.equal(product.replenishmentGap, null);
  assert.equal(product.daysOfCover, null);
  assert.equal(result.totals.actualInventory, null);
  assert.equal(result.warnings.some((warning) => warning.type === "out_of_stock"), false);
});

test("skips the sales endpoint when the store has no published SKU", async () => {
  const calls = [];
  const result = await syncStoreBusinessDataForSyntheticTest({
    request: async (options) => {
      calls.push(options);
      return {
        payload: { code: "0", info: { meta: { count: 0 }, data: [] } },
        diagnostics: {},
      };
    },
  });

  assert.equal(result.productCount, 0);
  assert.equal(result.totals.sales30, 0);
  assert.equal(calls.length, 1);
});

test("retries a rate-limited SHEIN read before completing the refresh", async () => {
  let attempts = 0;
  const result = await syncStoreBusinessDataForSyntheticTest({
    request: async (options) => {
      if (options.path !== STORE_DATA_PATHS.productSearch) {
        throw new Error(`unexpected path ${options.path}`);
      }
      attempts += 1;
      if (attempts === 1) {
        throw Object.assign(new Error("请求被限流"), { code: "832213" });
      }
      return {
        payload: { info: { meta: { count: 0 }, data: [] } },
        diagnostics: {},
      };
    },
  });

  assert.equal(attempts, 2);
  assert.equal(result.productCount, 0);
});
