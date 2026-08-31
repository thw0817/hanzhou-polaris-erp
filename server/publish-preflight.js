const PUBLISH_PERMISSION_PATH =
  "/open-api/goods/product/check-publish-permission";
const PUBLISH_QUOTA_PATH = "/open-api/goods-publish-quotas/detail";
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

function normalizePublishQuota(info = {}) {
  if (info.isControlled === false) {
    return {
      isControlled: false,
      availability: "unlimited",
      availableQuota: null,
      totalQuota: null,
      usedCount: null,
    };
  }
  const rawValue = info.availableQuota;
  const value = Number(rawValue);
  const totalQuota = Number(info.totalQuota);
  const usedCount = Number(info.usedCount);
  return {
    isControlled: info.isControlled === true ? true : null,
    availability: info.isControlled === true && Number.isFinite(value)
      ? "available"
      : "unavailable",
    availableQuota: info.isControlled === true && Number.isFinite(value) ? value : null,
    totalQuota: Number.isFinite(totalQuota) ? totalQuota : null,
    usedCount: Number.isFinite(usedCount) ? usedCount : null,
  };
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
  adapterRequest = null,
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
      "发品预检的官方响应字段待核验，远端预检已安全锁定",
    );
    error.code = "ERP07_ADAPTER_SOURCE_PENDING_READ_DISABLED";
    error.status = 409;
    throw error;
  }
  const normalizedSkuList = normalizeSupplierSkuList(supplierSkuList);
  const permissionRequest = {
    method: "GET",
    path: PUBLISH_PERMISSION_PATH,
    ...(String(brandCode || "").trim()
      ? { query: { brandCode: String(brandCode).trim() } }
      : {}),
  };
  const permissionResult = await remoteRequest(permissionRequest);
  let quotaResult;
  let publishQuotaUnavailableReason = "";
  try {
    quotaResult = await remoteRequest({
      method: "POST",
      path: PUBLISH_QUOTA_PATH,
      body: {},
    });
  } catch (error) {
    publishQuotaUnavailableReason = error?.message || "无法读取SHEIN商家发品额度";
    quotaResult = {
      payload: { code: error?.code || "PUBLISH_QUOTA_UNAVAILABLE", info: {} },
      diagnostics: {
        code: error?.code || null,
        traceId: error?.traceId || null,
        status: error?.status || null,
      },
    };
  }
  const repeatedResults = [];
  if (normalizedSkuList.length) {
    for (const skuBatch of chunk(normalizedSkuList, SUPPLIER_SKU_BATCH_SIZE)) {
      repeatedResults.push(await remoteRequest({
        method: "POST",
        path: SUPPLIER_SKU_REPEATED_PATH,
        body: { supplierSkuList: skuBatch },
      }));
    }
  }

  const permissionInfo = permissionResult.payload?.info || {};
  const quotaInfo = quotaResult.payload?.info || {};
  const canPublishProduct = getPublishPermission(permissionInfo);
  const publishQuota = normalizePublishQuota(quotaInfo);
  const publishQuotaUnavailable =
    publishQuotaUnavailableReason || publishQuota.availability === "unavailable";
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
  if (publishQuotaUnavailable) {
    blockers.push(
      `未读取SHEIN商家发品额度：${publishQuotaUnavailableReason || "SHEIN未返回明确的商家可用发品额度"}`,
    );
  } else if (publishQuota.availability === "unlimited") {
    // SHEIN explicitly says this merchant is not controlled by publish quota.
  } else if (publishQuota.availableQuota === null) {
    blockers.push("SHEIN未返回明确的商家可用发品额度");
  } else if (publishQuota.availableQuota <= 0) {
    blockers.push("当前商家没有可用发品额度");
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
    publishQuota: {
      ...publishQuota,
      availability: publishQuotaUnavailable ? "unavailable" : publishQuota.availability,
      reason: publishQuotaUnavailableReason,
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
  publishQuota: PUBLISH_QUOTA_PATH,
  supplierSkuRepeated: SUPPLIER_SKU_REPEATED_PATH,
});
