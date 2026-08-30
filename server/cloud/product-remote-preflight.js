import crypto from "node:crypto";
import { verifyProductPublishCandidate } from "./product-publish-candidate.js";

const ENDPOINTS = Object.freeze({
  permission: "/open-api/goods/product/check-publish-permission",
  shelfQuota: "/open-api/goods/query-shelf-quota",
  supplierSkuRepeated:
    "/open-api/goods/product/check-supplierSku-repeated",
  uploadPic: "/open-api/goods/upload-pic",
  transformPic: "/open-api/goods/transform-pic",
  compliance: "/open-api/goods-compliance-requirements/list",
});

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function text(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
  );
}

function fingerprint(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

export function productRemotePublishCandidateFingerprint(candidate = {}) {
  const source = object(candidate);
  const { fingerprint: ignored, ...snapshot } = source;
  return fingerprint(snapshot);
}

export function verifyProductRemotePublishCandidate(candidate = {}) {
  const source = object(candidate);
  return (
    source.state === "ready_for_publish_confirmation" &&
    source.publishingEnabled === false &&
    text(source.fingerprint, 64) ===
      productRemotePublishCandidateFingerprint(source)
  );
}

function candidateSupplierSkus(candidate) {
  const requestBody = object(candidate.requestBody);
  return Array.from(new Set(
    (Array.isArray(requestBody.skc_list) ? requestBody.skc_list : [])
      .flatMap((skc) => Array.isArray(skc?.sku_list) ? skc.sku_list : [])
      .map((sku) => text(sku?.supplier_sku, 200))
      .filter(Boolean),
  ));
}

function traceId(diagnostics) {
  return text(object(diagnostics).traceId, 160);
}

function normalizeUpload(upload) {
  const source = object(upload);
  const targetLevel = text(source.targetLevel, 30);
  const imageType = Number(source.imageType);
  const imageSort = Number(source.imageSort);
  const assetId = text(source.assetId || source.localId, 200);
  const supplierSku = text(source.supplierSku, 200);
  const allowedTypes = targetLevel === "sku"
    ? new Set([1])
    : targetLevel === "site-detail"
      ? new Set([7])
      : new Set([1, 2, 5, 6]);
  if (
    !assetId ||
    !["spu", "skc", "sku", "site-detail"].includes(targetLevel) ||
    !allowedTypes.has(imageType) ||
    !Number.isInteger(imageSort) ||
    imageSort <= 0 ||
    (targetLevel === "sku" && !supplierSku)
  ) {
    return null;
  }
  return {
    assetId,
    templateId: text(source.templateId, 200),
    targetLevel,
    imageType,
    imageSort,
    supplierSku,
    name: text(source.name, 200),
    slot: text(source.slot, 100),
  };
}

function validImageUrl(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function reusablePreviousUploads(candidate) {
  const previous = object(candidate);
  if (!verifyProductRemotePublishCandidate(previous)) return [];
  const results = object(object(previous.checks).uploadPic).results;
  return (Array.isArray(results) ? results : [])
    .map((result) => {
      const source = object(result);
      const assetId = text(source.assetId, 200);
      const imageType = Number(source.imageType);
      const imageUrl = text(source.imageUrl, 2000);
      if (!assetId || !Number.isInteger(imageType) || !validImageUrl(imageUrl)) {
        return null;
      }
      return {
        assetId,
        imageType,
        imageUrl,
        traceId: text(source.traceId, 160),
      };
    })
    .filter(Boolean);
}

function addImage(container, image) {
  const current = object(container.image_info);
  const list = Array.isArray(current.image_info_list)
    ? current.image_info_list
    : [];
  container.image_info = {
    ...current,
    image_info_list: [...list, image],
  };
}

function applyImages(requestBody, uploads) {
  const resolved = structuredClone(requestBody);
  const skcList = Array.isArray(resolved.skc_list) ? resolved.skc_list : [];
  const skc = skcList[0];
  const siteDetailImages = [];

  for (const upload of uploads) {
    const image = {
      image_sort: upload.imageSort,
      image_type: upload.imageType,
      image_url: upload.imageUrl,
    };
    if (upload.targetLevel === "spu") {
      addImage(resolved, image);
      continue;
    }
    if (upload.targetLevel === "skc") {
      if (!skc) throw new Error("发布候选缺少可绑定图片的SKC");
      addImage(skc, image);
      continue;
    }
    if (upload.targetLevel === "sku") {
      const sku = skcList
        .flatMap((item) => Array.isArray(item?.sku_list) ? item.sku_list : [])
        .find((item) =>
          text(item?.supplier_sku, 200) === upload.supplierSku
        );
      if (!sku) {
        throw new Error(`SKU图片无法绑定商家SKU“${upload.supplierSku}”`);
      }
      addImage(sku, image);
      continue;
    }
    siteDetailImages.push({
      image_sort: upload.imageSort,
      image_url: upload.imageUrl,
    });
  }

  if (siteDetailImages.length) {
    resolved.site_detail_image_info_list = [{
      image_info_list: siteDetailImages,
    }];
  }
  return resolved;
}

function baseSnapshot(candidate, checkedAt) {
  return {
    version: 1,
    endpoint: "/open-api/goods/product/publishOrEdit",
    checkedAt: text(checkedAt, 80),
    sourceCandidateFingerprint: text(candidate.fingerprint, 64),
    publishingEnabled: false,
    requiresSkcComplianceReadback:
      candidate.requiresSkcComplianceReadback === true,
    ...(candidate.postPublishCompliancePhotos
      ? { postPublishCompliancePhotos: candidate.postPublishCompliancePhotos }
      : {}),
  };
}

export async function runProductRemotePreflight({
  candidate = {},
  publishPreflight = {},
  previousRemoteCandidate = {},
  uploadImage,
  checkedAt = new Date().toISOString(),
} = {}) {
  const source = object(candidate);
  const base = baseSnapshot(source, checkedAt);
  const blockers = [];
  if (!verifyProductPublishCandidate(source)) {
    return {
      ...base,
      state: "blocked",
      fingerprint: "",
      requestBody: null,
      blockers: [{
        code: "PUBLISH_CANDIDATE_FINGERPRINT_INVALID",
        message: "发布候选快照缺失、已过期或指纹校验失败",
      }],
      checks: {},
    };
  }

  const preflight = object(publishPreflight);
  const permission = object(preflight.permission);
  const shelfQuota = object(preflight.shelfQuota);
  const supplierSkuCheck = object(preflight.supplierSkuCheck);
  const supplierSkus = candidateSupplierSkus(source);
  const skuResults = Array.isArray(supplierSkuCheck.results)
    ? supplierSkuCheck.results
    : [];
  const resultBySku = new Map(
    skuResults.map((item) => [text(item?.supplierSku, 200), item]),
  );
  const repeatedSkus = supplierSkus.filter(
    (supplierSku) => resultBySku.get(supplierSku)?.repeated === true,
  );
  const uncheckedSkus = supplierSkus.filter(
    (supplierSku) => !resultBySku.has(supplierSku),
  );
  const availableLimit = Number(shelfQuota.availableLimit);
  const shelfQuotaUnavailable = shelfQuota.availability === "unavailable";
  const shelfQuotaUnlimited = shelfQuota.availability === "unlimited";

  if (permission.canPublishProduct !== true) {
    blockers.push({
      code: "PUBLISH_PERMISSION_DENIED",
      message: text(permission.reason) || "当前店铺不允许发布商品",
    });
  }
  if (shelfQuotaUnavailable || shelfQuotaUnlimited) {
    // SHEIN may expose publish permission while restricting the separate
    // quota endpoint. The publish API remains the final quota authority.
  } else if (!Number.isFinite(availableLimit)) {
    blockers.push({
      code: "SHELF_QUOTA_UNAVAILABLE",
      message: "SHEIN未返回明确的店铺可用上架额度",
    });
  } else if (availableLimit <= 0) {
    blockers.push({
      code: "SHELF_QUOTA_EXHAUSTED",
      message: "当前店铺没有可用上架额度",
    });
  }
  if (uncheckedSkus.length) {
    blockers.push({
      code: "SUPPLIER_SKU_CHECK_INCOMPLETE",
      message: `以下商家SKU未完成查重：${uncheckedSkus.join("、")}`,
    });
  }
  if (repeatedSkus.length) {
    blockers.push({
      code: "SUPPLIER_SKU_REPEATED",
      message: `商家SKU重复：${repeatedSkus.join("、")}`,
    });
  }

  const checks = {
    permission: {
      endpoint: ENDPOINTS.permission,
      state: permission.canPublishProduct === true ? "passed" : "blocked",
      traceId: traceId(permission.diagnostics),
    },
    shelfQuota: {
      endpoint: ENDPOINTS.shelfQuota,
      state: shelfQuotaUnavailable
        ? "unavailable"
        : shelfQuotaUnlimited
        ? "unlimited"
        : Number.isFinite(availableLimit) && availableLimit > 0
        ? "passed"
        : "blocked",
      availableLimit: Number.isFinite(availableLimit) ? availableLimit : null,
      availability: shelfQuotaUnavailable
        ? "unavailable"
        : shelfQuotaUnlimited
        ? "unlimited"
        : "available",
      reason: text(shelfQuota.reason, 500),
      traceId: traceId(shelfQuota.diagnostics),
    },
    supplierSkuRepeated: {
      endpoint: ENDPOINTS.supplierSkuRepeated,
      state: !supplierSkus.length
        ? "not_required"
        : !uncheckedSkus.length && !repeatedSkus.length
          ? "passed"
          : "blocked",
      checkedCount: supplierSkus.length - uncheckedSkus.length,
      supplierSkus,
      repeatedSkus,
      traceIds: (Array.isArray(supplierSkuCheck.diagnostics)
        ? supplierSkuCheck.diagnostics
        : [supplierSkuCheck.diagnostics])
        .map(traceId)
        .filter(Boolean),
    },
    uploadPic: {
      endpoint: ENDPOINTS.uploadPic,
      state: "pending",
      requestedCount: 0,
      uploadedCount: 0,
      reusedCount: 0,
      results: [],
    },
    transformPic: {
      endpoint: ENDPOINTS.transformPic,
      state: "skipped",
      reason: "对象存储中的本地图片统一使用upload-pic，不需要外链转图",
    },
    complianceReadback: {
      endpoint: ENDPOINTS.compliance,
      state: source.requiresSkcComplianceReadback === true
        ? "deferred_until_skc_created"
        : "not_required",
    },
  };

  if (blockers.length) {
    checks.uploadPic.state = "not_started";
    return {
      ...base,
      state: "blocked",
      fingerprint: "",
      requestBody: null,
      blockers,
      checks,
    };
  }

  const uploadPlan = (Array.isArray(source.pendingImageUploads)
    ? source.pendingImageUploads
    : []).map(normalizeUpload);
  if (uploadPlan.some((upload) => !upload)) {
    return {
      ...base,
      state: "blocked",
      fingerprint: "",
      requestBody: null,
      blockers: [{
        code: "IMAGE_UPLOAD_PLAN_INVALID",
        message: "发布候选中的图片上传计划无法可靠解析",
      }],
      checks: {
        ...checks,
        uploadPic: {
          ...checks.uploadPic,
          state: "blocked",
        },
      },
    };
  }
  if (uploadPlan.length && typeof uploadImage !== "function") {
    return {
      ...base,
      state: "blocked",
      fingerprint: "",
      requestBody: null,
      blockers: [{
        code: "IMAGE_UPLOAD_UNAVAILABLE",
        message: "SHEIN图片上传服务尚未配置",
      }],
      checks: {
        ...checks,
        uploadPic: {
          ...checks.uploadPic,
          state: "blocked",
          requestedCount: uploadPlan.length,
        },
      },
    };
  }

  const remoteByAssetAndType = new Map(
    reusablePreviousUploads(previousRemoteCandidate).map((upload) => [
      `${upload.assetId}:${upload.imageType}`,
      { imageUrl: upload.imageUrl, traceId: upload.traceId },
    ]),
  );
  const resolvedUploads = [];
  checks.uploadPic.requestedCount = uploadPlan.length;
  for (const upload of uploadPlan) {
    const cacheKey = `${upload.assetId}:${upload.imageType}`;
    let remote = remoteByAssetAndType.get(cacheKey);
    if (!remote) {
      try {
        const result = object(await uploadImage({
          assetId: upload.assetId,
          templateId: upload.templateId,
          imageType: upload.imageType,
          name: upload.name,
        }));
        const imageUrl = text(
          result.imageUrl || object(object(result.payload).info).image_url,
          2000,
        );
        if (!validImageUrl(imageUrl)) {
          throw new Error("SHEIN图片上传未返回有效的HTTPS图片地址");
        }
        remote = {
          imageUrl,
          traceId: traceId(result.diagnostics),
        };
        remoteByAssetAndType.set(cacheKey, remote);
        checks.uploadPic.uploadedCount += 1;
      } catch (error) {
        blockers.push({
          code: "IMAGE_UPLOAD_FAILED",
          message: `图片“${upload.name || upload.assetId}”上传失败：${
            error?.message || "未知错误"
          }`,
        });
        break;
      }
    } else {
      checks.uploadPic.reusedCount += 1;
    }
    const resolved = {
      ...upload,
      imageUrl: remote.imageUrl,
      traceId: remote.traceId,
    };
    resolvedUploads.push(resolved);
    checks.uploadPic.results.push({
      assetId: upload.assetId,
      targetLevel: upload.targetLevel,
      supplierSku: upload.supplierSku,
      imageType: upload.imageType,
      imageSort: upload.imageSort,
      imageUrl: remote.imageUrl,
      traceId: remote.traceId,
    });
  }

  if (blockers.length) {
    checks.uploadPic.state = "blocked";
    return {
      ...base,
      state: "blocked",
      fingerprint: "",
      requestBody: null,
      blockers,
      checks,
    };
  }

  let requestBody;
  try {
    requestBody = applyImages(source.requestBody, resolvedUploads);
  } catch (error) {
    checks.uploadPic.state = "blocked";
    return {
      ...base,
      state: "blocked",
      fingerprint: "",
      requestBody: null,
      blockers: [{
        code: "IMAGE_BINDING_FAILED",
        message: error?.message || "SHEIN图片无法绑定到发布报文",
      }],
      checks,
    };
  }
  checks.uploadPic.state = "passed";
  const snapshot = {
    ...base,
    state: "ready_for_publish_confirmation",
    requestBody,
    blockers: [],
    checks,
  };
  return {
    ...snapshot,
    fingerprint: productRemotePublishCandidateFingerprint(snapshot),
  };
}

export const PRODUCT_REMOTE_PREFLIGHT_ENDPOINTS = ENDPOINTS;
