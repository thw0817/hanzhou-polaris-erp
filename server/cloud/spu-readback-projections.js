import { WebhookProcessingError } from "./webhook-event-processor.js";

function asText(value, fieldName, { required = false } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) {
      throw new WebhookProcessingError(
        "INVALID_SPU_READBACK",
        `SPU回读缺少 ${fieldName}`,
      );
    }
    return null;
  }
  if (typeof value !== "string" && typeof value !== "number") {
    throw new WebhookProcessingError(
      "INVALID_SPU_READBACK",
      `SPU回读字段 ${fieldName} 类型无效`,
    );
  }
  return String(value);
}

function normalizeSku(sku, skcIndex, skuIndex) {
  if (!sku || typeof sku !== "object" || Array.isArray(sku)) {
    throw new WebhookProcessingError(
      "INVALID_SPU_READBACK",
      `SPU回读第 ${skcIndex + 1} 个SKC的第 ${skuIndex + 1} 个SKU不是对象`,
    );
  }
  return {
    skuCode: asText(sku.skuCode, "skuCode", { required: true }),
    supplierSku: asText(sku.supplierSku, "supplierSku"),
  };
}

function normalizeSkc(skc, index) {
  if (!skc || typeof skc !== "object" || Array.isArray(skc)) {
    throw new WebhookProcessingError(
      "INVALID_SPU_READBACK",
      `SPU回读第 ${index + 1} 个SKC不是对象`,
    );
  }
  const skuInfoList = Array.isArray(skc.skuInfoList)
    ? skc.skuInfoList
    : [];
  const skcName = asText(skc.skcName, "skcName", { required: true });
  if (!skuInfoList.length) {
    throw new WebhookProcessingError(
      "INVALID_SPU_READBACK",
      `SPU回读SKC ${skcName} 缺少SKU关系`,
    );
  }
  return {
    skcName,
    supplierCode: asText(skc.supplierCode, "supplierCode"),
    skuList: skuInfoList.map((sku, skuIndex) =>
      normalizeSku(sku, index, skuIndex),
    ),
  };
}

export function normalizeSpuInfo(info, { expectedSpuName = "" } = {}) {
  if (!info || typeof info !== "object" || Array.isArray(info)) {
    throw new WebhookProcessingError(
      "INVALID_SPU_READBACK",
      "SPU回读 info 不是对象",
    );
  }
  const spuName = asText(info.spuName, "spuName", { required: true });
  const expected = String(expectedSpuName || "").trim();
  if (expected && spuName !== expected) {
    throw new WebhookProcessingError(
      "INVALID_SPU_READBACK",
      `SPU回读编码与请求不一致: ${spuName}`,
    );
  }
  const skcInfoList = Array.isArray(info.skcInfoList)
    ? info.skcInfoList
    : [];
  if (!skcInfoList.length) {
    throw new WebhookProcessingError(
      "INVALID_SPU_READBACK",
      "SPU回读缺少SKC关系",
    );
  }
  const skcs = skcInfoList.map(normalizeSkc);
  const skuCount = skcs.reduce(
    (total, skc) => total + skc.skuList.length,
    0,
  );
  return {
    projectionVersion: "spu-readback-v1",
    mode: "dry-run",
    externalWrite: false,
    projection: {
      eventFamily: "goods/spu-info",
      spuName,
      categoryId: info.categoryId ?? null,
      productTypeId: info.productTypeId ?? null,
      supplierCode: asText(info.supplierCode, "supplierCode"),
      skcs,
    },
    summary: {
      disposition: "read-only-spu-relationship-readback",
      spuName,
      skcCount: skcs.length,
      skuCount,
    },
  };
}
