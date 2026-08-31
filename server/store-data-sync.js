import { normalizeProductSearch } from "./shein-product.js";

export const STORE_DATA_PATHS = Object.freeze({
  productSearch: "/open-api/goods/searchProduct",
  skuSales: "/open-api/goods/query-sku-sales",
  stockQuery: "/open-api/stock/stock-query",
  exactShelfStatus: "/open-api/goods-compliance/skc-label-list",
  productDetail: "/open-api/goods/spu-info",
});

const STORE_REFRESH_MIN_REQUEST_INTERVAL_MS = 150;
const STORE_REFRESH_RATE_LIMIT_RETRY_DELAYS_MS = Object.freeze([1500, 3000, 6000]);

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isSheinRateLimited(error) {
  return String(error?.code || error?.response?.code || "") === "832213" ||
    error?.status === 429 || /限流/.test(String(error?.message || ""));
}

function createRateLimitedRequest(request) {
  let queue = Promise.resolve();
  let nextRequestAt = 0;

  return (options) => {
    const task = queue.then(async () => {
      const waitMs = Math.max(0, nextRequestAt - Date.now());
      if (waitMs > 0) await sleep(waitMs);
      nextRequestAt = Date.now() + STORE_REFRESH_MIN_REQUEST_INTERVAL_MS;

      for (let attempt = 0; ; attempt += 1) {
        try {
          return await request(options);
        } catch (error) {
          const retryDelay = STORE_REFRESH_RATE_LIMIT_RETRY_DELAYS_MS[attempt];
          if (!isSheinRateLimited(error) || retryDelay === undefined) throw error;
          await sleep(retryDelay);
          nextRequestAt = Date.now();
        }
      }
    });
    queue = task.catch(() => {});
    return task;
  };
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function mapConcurrent(values, limit, mapper) {
  const result = new Array(values.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, limit), values.length) },
    async () => {
      while (cursor < values.length) {
        const index = cursor;
        cursor += 1;
        result[index] = await mapper(values[index], index);
      }
    },
  );
  await Promise.all(workers);
  return result;
}

function normalizeSalesRows(info) {
  if (Array.isArray(info?.dataList)) return info.dataList;
  if (Array.isArray(info)) {
    return info.flatMap((item) => item?.dataList || []);
  }
  return [];
}

function sumSales(rows) {
  return rows.reduce(
    (totals, row) => ({
      today: totals.today + Number(row.realTimeSaleCnt || 0),
      yesterday: totals.yesterday + Number(row.cydSaleCnt || 0),
      sales7: totals.sales7 + Number(row.c7dSaleCnt || 0),
      sales30: totals.sales30 + Number(row.c30dSaleCnt || 0),
    }),
    { today: 0, yesterday: 0, sales7: 0, sales30: 0 },
  );
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function optionalFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

const SHELF_STATES = Object.freeze({
  0: "待上架",
  1: "已上架",
  2: "已下架",
  3: "已售罄",
});

function shelfStatusNumber(value) {
  const candidate = Array.isArray(value) ? value[0] : value;
  const number = Number(candidate);
  return Number.isInteger(number) && number >= 0 && number <= 3
    ? number
    : null;
}

function normalizeExactShelfRows(info) {
  const rows = Array.isArray(info) ? info : Array.isArray(info?.data) ? info.data : [];
  return rows
    .map((row) => ({
      skc: String(row?.skc || row?.skcName || ""),
      status: shelfStatusNumber(row?.skcShelfStatus),
    }))
    .filter((row) => row.skc && row.status !== null);
}

function normalizeStockRows(info) {
  const wrappers = Array.isArray(info) ? info : info ? [info] : [];
  return wrappers.flatMap((wrapper) => wrapper?.goodsInventory || [])
    .flatMap((goods) => goods?.skuList || [])
    .map((row) => ({
      skuCode: String(row?.skuCode || ""),
      // A missing SHEIN field is unknown, not zero. Zero is a valid platform
      // value and is preserved by optionalFiniteNumber.
      inventory: optionalFiniteNumber(row?.totalInventoryQuantity),
      usable: optionalFiniteNumber(row?.totalUsableInventory),
      locked: [row?.totalLockedQuantity, row?.totalTempLockQuantity].every(
        (value) => optionalFiniteNumber(value) !== null,
      )
        ? optionalFiniteNumber(row?.totalLockedQuantity) + optionalFiniteNumber(row?.totalTempLockQuantity)
        : null,
      transit: optionalFiniteNumber(row?.totalTransitQuantity),
    }))
    .filter((row) => row.skuCode);
}

function firstLocalized(items, key) {
  if (!Array.isArray(items)) return "";
  const row = items.find((item) => item?.language === "zh-cn") ||
    items.find((item) => item?.language === "en") || items[0];
  return String(row?.[key] || "");
}

function detailSize(sku) {
  return (sku?.saleAttributeList || [])
    .map((attribute) => firstLocalized(attribute?.attributeValueMultiList, "attributeValueName"))
    .filter(Boolean)
    .join(" / ");
}

function validShelfTime(value) {
  const text = String(value || "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T]/.exec(text);
  if (!match || Number(match[1]) < 2000) return "";
  return text;
}

function listingDays(firstShelfTime, now) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(firstShelfTime || ""));
  if (!match) return null;
  const listed = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const todayParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(todayParts.map((part) => [part.type, part.value]));
  const today = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day));
  return Math.max(0, Math.floor((today - listed) / 86_400_000) + 1);
}

function normalizeProductDetails(info) {
  const result = [];
  for (const skc of info?.skcInfoList || []) {
    const shelfRows = Array.isArray(skc?.shelfStatusInfoList)
      ? skc.shelfStatusInfoList
      : [];
    const firstShelfTime = shelfRows
      .map((row) => validShelfTime(row?.firstShelfTime))
      .filter(Boolean)
      .sort()[0] || "";
    const latestStatus = shelfRows.some((row) => Number(row?.shelfStatus) === 1)
      ? 1
      : shelfRows.length ? 2 : null;
    result.push({
      skc: String(skc?.skcName || ""),
      firstShelfTime,
      detailShelfStatus: latestStatus,
      skuDetails: (skc?.skuInfoList || []).map((sku) => ({
        skuCode: String(sku?.skuCode || ""),
        supplierSku: String(sku?.supplierSku || ""),
        size: detailSize(sku) || String(sku?.supplierSku || ""),
      })),
    });
  }
  return result.filter((row) => row.skc);
}

export function buildStoreBusinessWarnings(products = []) {
  const warnings = [];
  for (const product of products) {
    const inventory = optionalFiniteNumber(product.actualInventory ?? product.inventory);
    const sales7 = finiteNumber(product.sales?.sales7);
    const sales30 = finiteNumber(product.sales?.sales30);
    const previous23Average = Math.max(0, sales30 - sales7) / 23;
    const recentAverage = sales7 / 7;
    const daysOfCover = inventory !== null && recentAverage > 0
      ? Number((inventory / recentAverage).toFixed(1))
      : null;
    const base = {
      productId: product.id,
      skc: product.skc,
      name: product.name,
      image: product.image,
      listingDays: product.listingDays ?? null,
      salesToday: finiteNumber(product.sales?.today),
      inventory,
      actualInventory: inventory,
      sales7,
      sales30,
      daysOfCover,
      suggestedRestock: inventory === null ? null : Math.max(0, sales7 - inventory),
    };

    if (
      product.state === "已上架" &&
      inventory !== null &&
      product.listingDays !== null &&
      product.listingDays <= 7 &&
      sales7 > 3
    ) {
      const suggestedRestock = Math.max(0, sales7 - inventory);
      warnings.push({
        ...base,
        id: `${product.skc}:new-product-restock`,
        type: "new_product_restock",
        severity: "high",
        title: "新品起量，立即检查实物库存",
        message: suggestedRestock > 0
          ? `上架 ${product.listingDays} 天、近7日销售 ${sales7} 件，实物库存 ${inventory} 件，建议至少补货 ${suggestedRestock} 件。`
          : `上架 ${product.listingDays} 天、近7日销售 ${sales7} 件，实物库存 ${inventory} 件；新品已起量，请提前安排下一轮备货。`,
      });
    }

    if (product.state === "已上架" && inventory !== null && inventory <= 0) {
      warnings.push({
        ...base,
        id: `${product.skc}:out-of-stock`,
        type: "out_of_stock",
        severity: sales30 > 0 ? "high" : "medium",
        title: "已上架商品实物库存为 0",
        message: sales30 > 0
          ? `近30日销售 ${sales30} 件，当前库存为0，存在直接断货风险。`
          : "当前已上架但没有实物库存，请核对SHEIN仓库存。",
      });
    } else if (
      product.state === "已上架" &&
      inventory !== null &&
      sales7 > 0 &&
      daysOfCover !== null &&
      daysOfCover <= 7
    ) {
      warnings.push({
        ...base,
        id: `${product.skc}:low-stock`,
        type: "low_stock",
        severity: daysOfCover <= 3 ? "high" : "medium",
        title: `预计仅够销售 ${daysOfCover} 天`,
        message: `按近7日平均销量估算，实物库存 ${inventory} 件，需要尽快核对备货。`,
      });
    }

    if (inventory !== null && inventory >= 20 && sales30 === 0) {
      warnings.push({
        ...base,
        id: `${product.skc}:slow-moving`,
        type: "slow_moving",
        severity: "medium",
        title: "有库存但近30日无销量",
        message: `当前库存 ${inventory} 件，建议检查曝光、主图、价格和商品状态。`,
      });
    }

    if (product.state !== "已上架" && inventory !== null && inventory > 0) {
      warnings.push({
        ...base,
        id: `${product.skc}:off-shelf-stock`,
        type: "off_shelf_stock",
        severity: "low",
        title: `${product.state}商品仍有实物库存`,
        message: `当前实物库存 ${inventory} 件，请核对商品状态与备货安排。`,
      });
    }

    if (
      sales30 >= 10 &&
      previous23Average > 0 &&
      recentAverage < previous23Average * 0.5
    ) {
      warnings.push({
        ...base,
        id: `${product.skc}:sales-drop`,
        type: "sales_drop",
        severity: "medium",
        title: "近7日销售速度明显下降",
        message: `近7日日均 ${recentAverage.toFixed(1)} 件，低于此前23日日均 ${previous23Average.toFixed(1)} 件。`,
      });
    }
  }
  const weight = { high: 0, medium: 1, low: 2 };
  return warnings.sort((a, b) =>
    (weight[a.severity] ?? 9) - (weight[b.severity] ?? 9) ||
    b.sales30 - a.sales30,
  );
}

function compactDiagnostics(diagnostics) {
  return diagnostics
    .map((item) => ({
      traceId: item?.traceId || "",
      durationMs: Number(item?.durationMs || 0),
    }))
    .filter((item) => item.traceId || item.durationMs)
    .slice(-20);
}

export function summarizeStoreBusinessData(snapshot) {
  if (!snapshot) return null;
  return {
    totals: {
      today: Number(snapshot.totals?.today || 0),
      yesterday: Number(snapshot.totals?.yesterday || 0),
      sales7: Number(snapshot.totals?.sales7 || 0),
      sales30: Number(snapshot.totals?.sales30 || 0),
    },
    productCount: Number(snapshot.productCount || 0),
    spuCount: Number(snapshot.spuCount || 0),
    skuCount: Number(snapshot.skuCount || 0),
    dataDate: snapshot.dataDate || "",
  };
}

export async function syncStoreBusinessData({
  request,
  adapterRequest = null,
  previousSnapshot = null,
  now = () => new Date(),
  allowSourcePendingSyntheticReadForTest = false,
} = {}) {
  const remoteRequest = typeof adapterRequest === "function"
    ? adapterRequest
    : request;
  if (typeof remoteRequest !== "function") {
    throw new TypeError("request is required");
  }
  if (!allowSourcePendingSyntheticReadForTest && typeof adapterRequest !== "function") {
    const error = new Error(
      "SKU销量的官方响应字段待核验，远端经营同步已安全锁定",
    );
    error.code = "ERP07_ADAPTER_SOURCE_PENDING_READ_DISABLED";
    error.status = 409;
    throw error;
  }

  const rateLimitedRequest = createRateLimitedRequest(remoteRequest);

  const pageSize = 10;
  const spuRows = [];
  const searchDiagnostics = [];
  let pageNum = 1;
  let expectedCount = null;

  while (pageNum === 1 || spuRows.length < expectedCount) {
    const result = await rateLimitedRequest({
      method: "POST",
      path: STORE_DATA_PATHS.productSearch,
      body: {
        pageNum,
        pageSize,
        languageList: ["zh-cn", "en"],
      },
    });
    const rows = Array.isArray(result.payload.info?.data)
      ? result.payload.info.data
      : [];
    if (expectedCount === null) {
      const count = Number(result.payload.info?.meta?.count);
      expectedCount = Number.isFinite(count) ? count : Number.POSITIVE_INFINITY;
    }
    searchDiagnostics.push(result.diagnostics);
    spuRows.push(...rows);
    if (!rows.length || rows.length < pageSize) break;
    pageNum += 1;
  }

  const products = normalizeProductSearch({ data: spuRows });
  const skuCodes = Array.from(
    new Set(products.flatMap((product) => product.skuCodes || [])),
  );
  const salesRows = [];
  const salesDiagnostics = [];
  const optionalDiagnostics = [];
  const optionalRequest = async (options) => {
    try {
      return await rateLimitedRequest(options);
    } catch (error) {
      optionalDiagnostics.push({
        path: options.path,
        code: String(error?.code || "OPTIONAL_REQUEST_FAILED"),
      });
      return null;
    }
  };

  const skuBatches = chunks(skuCodes, 100);
  const salesResults = await mapConcurrent(skuBatches, 4, (skuBatch) => rateLimitedRequest({
    method: "POST",
    path: STORE_DATA_PATHS.skuSales,
    body: { skuCodeList: skuBatch },
  }));
  for (const result of salesResults) {
    salesRows.push(...normalizeSalesRows(result.payload.info));
    salesDiagnostics.push(result.diagnostics);
  }

  const exactStatusBySkc = new Map();
  const statusResults = await mapConcurrent(
    chunks(products.map((product) => product.skc).filter(Boolean), 100),
    3,
    (skcBatch) => optionalRequest({
      method: "POST",
      path: STORE_DATA_PATHS.exactShelfStatus,
      body: { pageNum: 1, pageSize: 100, skcList: skcBatch },
    }),
  );
  for (const result of statusResults.filter(Boolean)) {
    for (const row of normalizeExactShelfRows(result.payload.info)) {
      exactStatusBySkc.set(row.skc, row.status);
    }
  }

  const actualStockBySku = new Map();
  const stockResults = await mapConcurrent(skuBatches, 6, (skuBatch) =>
    optionalRequest({
      method: "POST",
      path: STORE_DATA_PATHS.stockQuery,
      body: {
        skuCodeList: skuBatch,
        warehouseType: "1",
        invType: "PI",
      },
    }),
  );
  for (const result of stockResults) {
    if (!result) continue;
    for (const row of normalizeStockRows(result.payload.info)) {
      actualStockBySku.set(row.skuCode, row);
    }
  }

  const previousBySkc = new Map(
    (previousSnapshot?.products || []).map((product) => [String(product.skc), product]),
  );
  const detailBySkc = new Map();
  for (const product of products) {
    const previous = previousBySkc.get(String(product.skc));
    if (previous?.firstShelfTime) {
      detailBySkc.set(String(product.skc), {
        skc: String(product.skc),
        firstShelfTime: previous.firstShelfTime,
        skuDetails: previous.skus || [],
      });
    }
  }
  const missingSpus = Array.from(new Set(
    products
      .filter((product) => !detailBySkc.has(String(product.skc)))
      .map((product) => product.spu)
      .filter(Boolean),
  ));
  const detailResults = await mapConcurrent(missingSpus, 6, (spuName) =>
    optionalRequest({
      method: "POST",
      path: STORE_DATA_PATHS.productDetail,
      body: { languageList: ["zh-cn", "en"], spuName },
    }),
  );
  for (const result of detailResults.filter(Boolean)) {
    for (const detail of normalizeProductDetails(result.payload.info)) {
      detailBySkc.set(detail.skc, detail);
    }
  }

  const salesBySku = new Map(
    salesRows.map((row) => [String(row.skuCode || ""), row]),
  );
  const enrichedProducts = products.map((product) => {
    const detail = detailBySkc.get(String(product.skc)) || null;
    const detailSkuByCode = new Map(
      (detail?.skuDetails || []).map((sku) => [String(sku.skuCode), sku]),
    );
    const skus = (product.skuItems || []).map((sku) => {
      const sales = sumSales([salesBySku.get(String(sku.skuCode))].filter(Boolean));
      const actualStock = actualStockBySku.get(String(sku.skuCode));
      const actualInventory = actualStock?.usable ?? null;
      const recentAverage = sales.sales7 / 7;
      return {
        skuCode: sku.skuCode,
        supplierSku: sku.supplierSku,
        size: detailSkuByCode.get(String(sku.skuCode))?.size || sku.size || sku.supplierSku,
        sales,
        actualInventory,
        lockedInventory: actualStock?.locked ?? null,
        transitInventory: actualStock?.transit ?? null,
        daysOfCover: actualInventory !== null && recentAverage > 0
          ? Number((actualInventory / recentAverage).toFixed(1))
          : null,
        suggestedRestock: actualInventory === null ? null : Math.max(0, sales.sales7 - actualInventory),
        replenishmentGap: actualInventory === null ? null : Math.max(0, sales.sales7 - actualInventory),
      };
    });
    const productSalesRows = product.skuCodes
      .map((skuCode) => salesBySku.get(String(skuCode)))
      .filter(Boolean);
    const sales = sumSales(productSalesRows);
    const dates = productSalesRows.map((row) => row.dt).filter(Boolean);
    const recentAverage = sales.sales7 / 7;
    const actualInventoryValues = skus.map((sku) => sku.actualInventory);
    const actualInventory = actualInventoryValues.length && actualInventoryValues.every((value) => value !== null)
      ? actualInventoryValues.reduce((total, value) => total + value, 0)
      : null;
    const skuTransitRows = skus
      .map((sku) => sku.transitInventory)
      .filter((value) => value !== null);
    const transitInventory = skuTransitRows.length
      ? skuTransitRows.reduce((total, value) => total + value, 0)
      : null;
    const replenishmentGap = actualInventory === null ? null : Math.max(0, sales.sales7 - actualInventory);
    const exactStatus = exactStatusBySkc.get(String(product.skc));
    const statusCode = exactStatus ?? null;
    return {
      ...product,
      statusCode,
      state: statusCode === null
        ? "待同步"
        : SHELF_STATES[statusCode],
      statusSource: statusCode === null ? "unavailable" : "shein_skc_label_list",
      sales,
      sales7: sales.sales7,
      salesDataDate: dates.sort().at(-1) || "",
      skus,
      actualInventory,
      transitInventory,
      inventory: actualInventory,
      firstShelfTime: detail?.firstShelfTime || "",
      listingDays: listingDays(detail?.firstShelfTime, now()),
      daysOfCover: actualInventory !== null && recentAverage > 0
        ? Number((actualInventory / recentAverage).toFixed(1))
        : null,
      replenishmentGap,
    };
  }).sort((a, b) => b.sales.sales30 - a.sales.sales30 || a.skc.localeCompare(b.skc));

  const salesTotals = sumSales(salesRows);
  const warnings = buildStoreBusinessWarnings(enrichedProducts);
  const inventoryValues = enrichedProducts.map((product) => product.actualInventory);
  const inventory = inventoryValues.length && inventoryValues.every((value) => value !== null)
    ? inventoryValues.reduce((total, value) => total + value, 0)
    : null;
  const productTransitRows = enrichedProducts
    .map((product) => product.transitInventory)
    .filter((value) => value !== null);
  const transitInventory = productTransitRows.length
    ? productTransitRows.reduce((total, value) => total + value, 0)
    : null;
  const activeProductCount = enrichedProducts.filter(
    (product) => product.state === "已上架",
  ).length;

  return {
    products: enrichedProducts,
    totals: {
      ...salesTotals,
      inventory,
      actualInventory: inventory,
      transitInventory,
      activeProductCount,
      pendingProductCount: enrichedProducts.filter((product) => product.state === "待上架").length,
      offShelfProductCount: enrichedProducts.filter((product) => product.state === "已下架").length,
      soldOutProductCount: enrichedProducts.filter((product) => product.state === "已售罄").length,
      warningCount: warnings.length,
      highWarningCount: warnings.filter((item) => item.severity === "high").length,
    },
    warnings,
    productCount: enrichedProducts.length,
    spuCount: spuRows.length,
    skuCount: skuCodes.length,
    dataDate:
      salesRows
        .map((row) => row.dt)
        .filter(Boolean)
        .sort()
        .at(-1) || "",
    diagnostics: {
      productPageCount: searchDiagnostics.length,
      salesBatchCount: salesDiagnostics.length,
      statusBatchCount: statusResults.length,
      stockBatchCount: stockResults.length,
      detailRequestCount: detailResults.length,
      optionalFailures: optionalDiagnostics,
      recentProductRequests: compactDiagnostics(searchDiagnostics),
      recentSalesRequests: compactDiagnostics(salesDiagnostics),
    },
  };
}
