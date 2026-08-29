import { buildAttributeFields } from "../../src-v2/lib/attribute-template-contract.js";
import { deriveRugReportThresholdSources } from "../../src-v2/lib/rug-report-classification.js";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asId(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function normalizeAssignments(info, fields) {
  const fieldIds = new Set(fields.map((field) => String(field.id)));
  const grouped = new Map();
  for (const row of asArray(info?.productAttributeInfoList)) {
    const attributeId = asId(row?.attributeId);
    if (!attributeId || !fieldIds.has(attributeId)) continue;
    const current = grouped.get(attributeId) || {
      valueIds: [],
      customValues: [],
    };
    const valueId = asId(row?.attributeValueId);
    if (valueId && !current.valueIds.includes(valueId)) {
      current.valueIds.push(valueId);
    }
    const customValue = String(row?.attributeValue ?? "").trim();
    if (customValue && !current.customValues.includes(customValue)) {
      current.customValues.push(customValue);
    }
    grouped.set(attributeId, current);
  }
  return Object.fromEntries(
    fields
      .filter((field) => grouped.has(String(field.id)))
      .map((field) => {
        const value = grouped.get(String(field.id));
        return [
          String(field.id),
          {
            valueIds: value.valueIds,
            customValue: value.customValues.join(" / "),
          },
        ];
      }),
  );
}

export function existingRugReportSources(rawData) {
  const raw = asObject(rawData);
  const snapshot = asObject(raw.attributeSnapshot);
  return asObject(snapshot.rugReportSources || raw.rugReportSources);
}

export function buildProductAttributeSnapshot({
  info,
  schemaInfo,
  rugReportSources = {},
  fetchedAt,
  sourceTraceId = null,
} = {}) {
  const productTypeId = asId(info?.productTypeId);
  if (!productTypeId) {
    throw new Error("SHEIN商品详情缺少 productTypeId");
  }
  const fields = buildAttributeFields(schemaInfo, productTypeId);
  if (!fields.length) {
    throw new Error(`SHEIN商品类型 ${productTypeId} 未返回商品属性模板`);
  }
  const explicitRugReportSources = asObject(rugReportSources);
  const derivedThresholds = deriveRugReportThresholdSources(fields);
  const resolvedRugReportSources = Object.keys(explicitRugReportSources).length
    ? explicitRugReportSources
    : derivedThresholds ? { thresholds: derivedThresholds } : {};
  return {
    attributeSchemaSnapshot: {
      source: "/open-api/goods/query-attribute-template",
      fetchedAt: String(fetchedAt || ""),
      categoryId: asId(info?.categoryId),
      productTypeId,
      fields,
    },
    attributeValues: normalizeAssignments(info, fields),
    rugReportSources: resolvedRugReportSources,
    source: {
      endpoint: "/open-api/goods/spu-info",
      traceId: sourceTraceId,
      spuName: asId(info?.spuName),
    },
    productAttributeCount: asArray(info?.productAttributeInfoList).filter(
      (row) => fields.some((field) => String(field.id) === String(row?.attributeId)),
    ).length,
    note: "商品属性来自SHEIN只读SPU详情，已按官方属性模板剔除销售属性和SKU维度属性",
  };
}
