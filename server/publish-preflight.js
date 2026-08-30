const PUBLISH_PERMISSION_PATH =
  "/open-api/goods/product/check-publish-permission";
const SHELF_QUOTA_PATH = "/open-api/goods-publish-quotas/detail";
const SUPPLIER_SKU_REPEATED_PATH =
  "/open-api/goods/product/check-supplierSku-repeated";
const SUPPLIER_SKU_BATCH_SIZE = 200;

function normalizeSupplierSkuList(values) {
  if (!Array.isArray(values)) {
    const error = new Error("supplierSkuList 必须是数组");
    error.status = 400;
    throw error;
  }
  const normalized = Array.from(
    new Set(values.map((value) => String(value || "").trim()).filter(Boolean)),
  );
  return normalized;
}

function getPublishPermission(info = {}) {
  return info.canPublishProduct ?? info.can_publish_product ?? null;
}

function normalizeShelfQuota(info = {}) {
  if (info.isControlled === false) {
    return {
      isControlled: false,
      availability: "unlimited",
      availableQuota: null,
      availableLimit: null,
      totalQuota: null,
      usedCount: null,
    };
  }
  const rawValue = info.availableQuota ?? info.availableLimit;
  const value = Number(rawValue);
  return {
    isControlled: info.isControlled === true ? true : null,
    availability: Number.isFinite(value) ? "available" : "unavailable",
    availableQuota: Number.isFinite(value) ? value : null,
    availableLimit: Number.isFinite(value) ? value : null,
    totalQuota: Number.isFinite(Number(info.totalQuota))
      ? Number(info.totalQuota)
      : null,
    usedCount: Number.isFinite(Number(info.usedCount))
      ? Number(info.usedCount)
      : null,
  };
}

function isShelfQuotaPermissionError(error) {
  const message = [
    error?.message,
    error?.response?.msg,
    error?.response?.message,
  ]
    .filter(Boolean)
    .join(" ");
  return /没有该接口访问权限|接口访问权限|无权访问|权限不足/.test(message);
}

function chunk(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

export async function runPublishPreflight({
  supplierSkuList,
  brandCode = "",
  request,
} = {}) {
  if (typeof request !== "function") {
    throw new TypeError("request is required");
  }
  const normalizedSkuList = normalizeSupplierSkuList(supplierSkuList);
  const permissionRequest = {
    method: "GET",
    path: PUBLISH_PERMISSION_PATH,
    ...(String(brandCode || "").trim()
      ? { query: { brandCode: String(brandCode).trim() } }
      : {}),
  };
  const permissionResult = await request(permissionRequest);
  let quotaResult;
  let shelfQuotaUnavailableReason = "";
  try {
    quotaResult = await request({
      method: "POST",
      path: SHELF_QUOTA_PATH,
      body: {},
    });
  } catch (error) {
    if (!isShelfQuotaPermissionError(error)) throw error;
    shelfQuotaUnavailableReason =
      error?.message || "当前应用未开通SHEIN上架额度查询权限";
    quotaResult = {
      payload: { code: "SHELF_QUOTA_PERMISSION_UNAVAILABLE", info: {} },
      diagnostics: {
        traceId: error?.traceId || null,
        status: error?.status || null,
      },
    };
  }
  const repeatedResults = [];
  if (normalizedSkuList.length) {
    for (const skuBatch of chunk(normalizedSkuList, SUPPLIER_SKU_BATCH_SIZE)) {
      repeatedResults.push(await request({
        method: "POST",
        path: SUPPLIER_SKU_REPEATED_PATH,
        body: { supplierSkuList: skuBatch },
      }));
    }
  }

  const permissionInfo = permissionResult.payload?.info || {};
  const quotaInfo = quotaResult.payload?.info || {};
  const canPublishProduct = getPublishPermission(permissionInfo);
  const shelfQuota = normalizeShelfQuota(quotaInfo);
  const shelfQuotaUnavailable =
    shelfQuotaUnavailableReason || shelfQuota.availability === "unavailable";
  const skuResults = repeatedResults.flatMap((result) =>
    Array.isArray(result.payload?.info)
      ? result.payload.info.map((item) => ({
          supplierSku: String(item.supplierSku || ""),
          repeated: item.repeated === true,
        }))
      : []
  );
  const repeatedSkus = skuResults
    .filter((item) => item.repeated)
    .map((item) => item.supplierSku);
  const blockers = [];
  const warnings = [];

  if (canPublishProduct !== true) {
    blockers.push(
      permissionInfo.reason ||
        (canPublishProduct === false
          ? "当前店铺不允许发布商品"
          : "SHEIN未返回明确的可发品权限"),
    );
  }
  if (shelfQuotaUnavailable) {
    warnings.push(
      `未读取SHEIN上架额度：${shelfQuotaUnavailableReason}；真实发布时由SHEIN最终校验额度`,
    );
  } else if (shelfQuota.availability === "unlimited") {
    // The new quota API explicitly says this merchant is not quota-controlled.
  } else if (shelfQuota.availableQuota === null) {
    blockers.push("SHEIN未返回明确的店铺可用发品额度");
  } else if (shelfQuota.availableQuota <= 0) {
    blockers.push("当前店铺没有可用上架额度");
  }
  if (skuResults.length !== normalizedSkuList.length) {
    blockers.push("SHEIN返回的商家SKU校验数量与请求数量不一致");
  }
  if (repeatedSkus.length) {
    blockers.push(`已有 ${repeatedSkus.length} 个商家SKU被占用`);
  }

  return {
    passed: blockers.length === 0,
    blockers,
    warnings,
    permission: {
      canPublishProduct,
      reason: permissionInfo.reason || "",
      diagnostics: permissionResult.diagnostics,
    },
    shelfQuota: {
      ...shelfQuota,
      availability: shelfQuotaUnavailable ? "unavailable" : shelfQuota.availability,
      reason: shelfQuotaUnavailableReason,
      diagnostics: quotaResult.diagnostics,
    },
    supplierSkuCheck: {
      requestedCount: normalizedSkuList.length,
      checkedCount: skuResults.length,
      repeatedSkus,
      results: skuResults,
      diagnostics: repeatedResults.map((result) => result.diagnostics),
    },
  };
}

export const PUBLISH_PREFLIGHT_PATHS = Object.freeze({
  permission: PUBLISH_PERMISSION_PATH,
  shelfQuota: SHELF_QUOTA_PATH,
  supplierSkuRepeated: SUPPLIER_SKU_REPEATED_PATH,
});
