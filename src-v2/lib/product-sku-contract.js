import {
  calculateAreaSquareMeters,
  calculateWeightGrams,
  enrichSizeRows,
} from "../../src/lib/package-template.js";
import { buildSkuDrafts } from "../../src/lib/shein-publish-draft.js";

function normalize(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase()
    .replace(/[×xX＊*]/g, "x")
    .replace(/\s+/g, "");
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0;
}

function toApiId(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : value;
}

function normalizeSupplierSkuPart(value) {
  return String(value || "")
    .trim()
    .toLocaleUpperCase()
    .replace(/[×xX＊*]/g, "X")
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^-+|-+$/g, "") || "SKU";
}

function booleanFlag(value) {
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "是"].includes(
    String(value ?? "").trim().toLocaleLowerCase(),
  );
}

function fieldAllowsCustomValue(attribute) {
  const explicit = [
    attribute?.custom_attribute_value_permission,
    attribute?.custom_attribute_value_supported,
    attribute?.support_custom_attribute_value,
    attribute?.customValueAllowed,
    attribute?.is_custom_attribute_value,
  ].find((value) => typeof value === "boolean" || ["0", "1", "true", "false"].includes(String(value).toLocaleLowerCase()));
  if (explicit !== undefined) return booleanFlag(explicit);
  // SHEIN marks manual-input sale fields with mode 0/4. Unknown fields stay
  // fail-closed until the category snapshot exposes an affirmative signal.
  return [0, 4].includes(Number(attribute?.attribute_mode));
}

function numberText(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "";
  return String(Number(number.toFixed(2)));
}

export function formatHomeTextileCustomSize(sizeText, lengthCm, widthCm) {
  const source = String(sizeText || "").trim();
  const count = source.match(/(?:^|\s)(\d+)\s*(?:pc\b|件|个)/i)?.[1] || "1";
  const dimensions = [numberText(lengthCm), numberText(widthCm)]
    .filter(Boolean)
    .map(Number)
    .sort((left, right) => left - right);
  if (dimensions.length !== 2) return "";
  return `${count}pc ${dimensions[0]}cm*${dimensions[1]}cm`;
}

function canonicalDimensionText(sizeText, lengthCm, widthCm) {
  const source = String(sizeText || "").trim();
  if (!/\d+(?:\.\d+)?\s*(?:cm)?\s*[×xX＊*]\s*\d+(?:\.\d+)?/i.test(source)) {
    return source;
  }
  const dimensions = [Number(lengthCm), Number(widthCm)]
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((left, right) => left - right);
  if (dimensions.length !== 2) return source;
  const count = source.match(/^(\d+)\s*pc\b/i)?.[1];
  return `${count ? `${count}pc ` : ""}${dimensions[0]} × ${dimensions[1]} cm`;
}

function customPermissionMap(info) {
  return new Map(
    (Array.isArray(info?.data) ? info.data : [])
      .map((item) => [
        String(item?.attribute_id || ""),
        Number(item?.has_permission) === 1,
      ])
      .filter(([attributeId]) => attributeId),
  );
}

function buildAttributeField(attribute, permissions) {
  const permission = permissions.get(String(attribute.attribute_id || ""));
  return {
    id: String(attribute.attribute_id || ""),
    name: String(attribute.attribute_name || attribute.attribute_id || ""),
    required: Number(attribute.attribute_status) === 3,
    labelCode: Number(attribute.attribute_label || 0),
    attributeType: Number(attribute.attribute_type || 0),
    modeCode: Number(attribute.attribute_mode),
    customValueAllowed: permission === undefined
      ? fieldAllowsCustomValue(attribute)
      : permission,
    values: (attribute.attribute_value_info_list || [])
      .filter((value) => Number(value.is_show) !== 0)
      .map((value) => ({
        id: String(value.attribute_value_id || ""),
        label: String(value.attribute_value || value.attribute_value_id || ""),
      }))
      .filter((value) => value.id),
  };
}

export function buildSaleAttributeSchema(
  info = {},
  productTypeId,
  customAttributePermissions = {},
) {
  const permissions = customPermissionMap(customAttributePermissions);
  const productType = (info.data || []).find(
    (item) => String(item.product_type_id) === String(productTypeId),
  );
  const availableAttributes = (productType?.attribute_infos || [])
    .filter((attribute) =>
      [1, 2].includes(Number(attribute.attribute_type)) &&
      Number(attribute.attribute_status) !== 1 &&
      Number(attribute.attribute_is_show) !== 0
    )
    .map((attribute) => buildAttributeField(attribute, permissions))
    .filter((field) => field.id);

  return {
    mainAttributeStatus: Number(productType?.main_attribute_status || 0),
    fields: availableAttributes.filter((field) => field.attributeType === 1),
    sizeFields: availableAttributes.filter((field) => field.attributeType === 2),
  };
}

function resolveSizeMapping(row, fields, colorMapping) {
  const sizeFields = fields.filter(
    (field) => field.id !== colorMapping?.attributeId,
  );
  const sizeText = String(row?.sizeText || "").trim();
  return findUniqueSizeValue(sizeFields, sizeText) || (() => {
    const field = findSizeField(sizeFields);
    const customValue = field?.customValueAllowed
      ? formatHomeTextileCustomSize(sizeText, row?.lengthCm, row?.widthCm)
      : "";
    return field && customValue
      ? {
          attributeId: field.id,
          attributeName: field.name,
          valueId: "",
          valueLabel: sizeText,
          customValue,
        }
      : null;
  })();
}

function findUniqueValue(fields, label) {
  const target = normalize(label);
  if (!target) return null;
  const matches = fields.flatMap((field) =>
    field.values
      .filter((value) => normalize(value.label) === target)
      .map((value) => ({
        attributeId: field.id,
        attributeName: field.name,
        valueId: value.id,
        valueLabel: value.label,
      })),
  );
  return matches.length === 1 ? matches[0] : null;
}

function dimensionToken(value) {
  const source = String(value || "")
    .toLocaleLowerCase()
    .replace(/[×＊*]/g, "x")
    .replace(/厘米|公分/g, "cm");
  const match = source.match(/(\d+(?:\.\d+)?)(?:\s*cm)?\s*x\s*(\d+(?:\.\d+)?)(?:\s*cm)?/i)
    || source.match(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/i);
  if (!match) return "";
  return [Number(match[1]), Number(match[2])]
    .sort((left, right) => left - right)
    .map((number) => String(Number(number.toFixed(3))))
    .join("x");
}

function findUniqueSizeValue(fields, label) {
  const exact = findUniqueValue(fields, label);
  if (exact) return exact;
  const token = dimensionToken(label);
  if (!token) return null;
  const matches = fields.flatMap((field) => field.values
    .filter((value) => dimensionToken(value.label) === token)
    .map((value) => ({
      attributeId: field.id,
      attributeName: field.name,
      valueId: value.id,
      valueLabel: value.label,
    })));
  return matches.length === 1 ? matches[0] : null;
}

function findUniqueField(fields) {
  return fields.length === 1 ? fields[0] : null;
}

export function resolveMainSaleAttributeValue(saleSchema, value) {
  const input = String(value || "").trim();
  if (!input) return null;
  const mainFields = (Array.isArray(saleSchema?.fields) ? saleSchema.fields : [])
    .filter((field) => Number(field.labelCode) === 1);
  const official = findUniqueValue(mainFields, input);
  if (official) return official;
  const field = findUniqueField(
    mainFields.filter((item) => item.customValueAllowed === true),
  );
  return field
    ? {
        attributeId: field.id,
        attributeName: field.name,
        valueId: "",
        valueLabel: input,
        customValue: input,
      }
    : null;
}

function findSizeField(fields) {
  const candidates = fields.filter((field) => field.labelCode !== 1);
  const named = candidates.filter((field) =>
    /尺寸|尺码|size/i.test(`${field.name || ""} ${field.id || ""}`),
  );
  if (named.length === 1) return named[0];
  const custom = candidates.filter((field) => field.customValueAllowed === true);
  if (custom.length === 1) return custom[0];
  return findUniqueField(candidates);
}

function positiveIntegerText(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? String(number) : "";
}

function inferredSizeAttributeValue(field, row) {
  const name = String(field?.name || "");
  const width = Math.min(Number(row?.widthCm) || 0, Number(row?.lengthCm) || 0);
  const length = Math.max(Number(row?.widthCm) || 0, Number(row?.lengthCm) || 0);
  if (/直径|diameter/i.test(name)) {
    return positiveIntegerText(row?.diameterCm || width);
  }
  if (/宽度|宽|width/i.test(name)) return positiveIntegerText(width);
  if (/长度|长|length/i.test(name)) return positiveIntegerText(length);
  if (/高度|高|height/i.test(name)) return positiveIntegerText(row?.heightCm);
  return "";
}

function resolveSizeAttributeValues(row, sizeAttributeFields = []) {
  const source = asObject(row?.sizeAttributeValues);
  return Object.fromEntries(sizeAttributeFields.map((field) => {
    const key = String(field.id);
    const value = Object.prototype.hasOwnProperty.call(source, key)
      ? positiveIntegerText(source[key])
      : inferredSizeAttributeValue(field, row);
    return [key, value];
  }));
}

function buildSizeAttributeList(rows = [], sizeAttributeFields = []) {
  const result = [];
  for (const row of rows) {
    const sizeMapping = row.sizeMapping || null;
    const sizeAttributeValues = resolveSizeAttributeValues(row, sizeAttributeFields);
    for (const field of sizeAttributeFields) {
      const rawValue = sizeAttributeValues[String(field.id)];
      if (!rawValue) continue;
      const item = {
        attribute_id: toApiId(field.id),
        attribute_extra_value: rawValue,
      };
      if (sizeMapping?.attributeId) {
        item.relate_sale_attribute_id = toApiId(sizeMapping.attributeId);
        if (sizeMapping.valueId) {
          item.relate_sale_attribute_value_id = toApiId(sizeMapping.valueId);
        } else if (sizeMapping.customValue) {
          item.relate_sale_attribute_value = String(sizeMapping.customValue).trim();
        }
      }
      result.push(item);
    }
  }
  return result;
}

export function buildSkuStageFromSizeTemplate(template, saleSchema) {
  const data = asObject(template?.data);
  const fields = Array.isArray(saleSchema?.fields) ? saleSchema.fields : [];
  const sizeAttributeFields = Array.isArray(saleSchema?.sizeFields)
    ? saleSchema.sizeFields
    : [];
  const colorMapping = resolveMainSaleAttributeValue(saleSchema, data.colorText);
  const rows = (Array.isArray(data.rows) ? data.rows : []).map((row, index) => {
    const sizeText = String(row.sizeText || "").trim();
    const sizeMapping = resolveSizeMapping(row, fields, colorMapping);
    const dimensions = [Number(row.lengthCm) || 0, Number(row.widthCm) || 0]
      .filter((value) => value > 0)
      .sort((left, right) => left - right);
    const nextRow = {
      id: `${template.id}:${index}`,
      sizeText: canonicalDimensionText(sizeText, row.lengthCm, row.widthCm),
      widthCm: dimensions[0] || 0,
      lengthCm: dimensions[1] || 0,
      sizeMapping,
    };
    return {
      ...nextRow,
      sizeAttributeValues: resolveSizeAttributeValues(nextRow, sizeAttributeFields),
    };
  });
  return { colorMapping, rows };
}

export function reconcileSkuSizeMappings(rows, saleSchema, colorMapping) {
  const fields = Array.isArray(saleSchema?.fields) ? saleSchema.fields : [];
  const sizeAttributeFields = Array.isArray(saleSchema?.sizeFields)
    ? saleSchema.sizeFields
    : [];
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    ...row,
    sizeMapping: resolveSizeMapping(row, fields, colorMapping),
    sizeAttributeValues: resolveSizeAttributeValues(row, sizeAttributeFields),
  }));
}

export function applyPackagingTemplate(rows, template, material, { overwrite = false } = {}) {
  const materialRows = Array.isArray(template?.data?.materials?.[material])
    ? template.data.materials[material]
    : [];
  const enriched = enrichSizeRows(rows, { materialRows });
  if (overwrite) return enriched;
  return enriched.map((row, index) => {
    const source = rows[index] || {};
    const preserveManual = source.packageMatch === "manual" || (
      [
        source.packageLengthCm,
        source.packageWidthCm,
        source.packageHeightCm,
      ].every(positiveNumber) && !source.packageMatch
    );
    if (!preserveManual) return row;
    return {
      ...row,
      packageLengthCm: source.packageLengthCm,
      packageWidthCm: source.packageWidthCm,
      packageHeightCm: source.packageHeightCm,
      packageMatch: source.packageMatch === "matched" ? "matched" : "manual",
    };
  });
}

export function applyPricePerSquareMeter(rows, pricePerSquareMeter) {
  const unitPrice = Number(pricePerSquareMeter);
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) return rows;
  return rows.map((row) => {
    const area = calculateAreaSquareMeters(row);
    return area === null
      ? row
      : { ...row, costPrice: (area * unitPrice).toFixed(2) };
  });
}

export function applyGramsPerSquareMeter(rows, gramsPerSquareMeter) {
  const gsm = Number(gramsPerSquareMeter);
  if (!Number.isFinite(gsm) || gsm <= 0) return rows;
  return rows.map((row) => {
    const weightGrams = calculateWeightGrams(row, gsm);
    return weightGrams === null
      ? row
      : { ...row, weightGrams, weightSource: "area_estimate" };
  });
}

export function applyInventoryToAll(rows, inventory) {
  const value = Number(inventory);
  if (!Number.isInteger(value) || value < 0 || value > 99999) return rows;
  return rows.map((row) => ({ ...row, inventoryNum: value }));
}

export function applySupplierSkuPrefix(rows, supplierCode) {
  const prefix = String(supplierCode || "").trim();
  if (!prefix) return rows;
  const used = new Set();
  return rows.map((row) => {
    const base = `${prefix}-${normalizeSupplierSkuPart(row.sizeText)}`;
    let supplierSku = base.slice(0, 200);
    let suffix = 2;
    while (used.has(supplierSku)) {
      const marker = `-${suffix}`;
      supplierSku = `${base.slice(0, 200 - marker.length)}${marker}`;
      suffix += 1;
    }
    used.add(supplierSku);
    return { ...row, supplierSku };
  });
}

export function applySharedSkuImage(rows, assetId, source = "shared_sku") {
  const imageAssetId = String(assetId || "").trim();
  return rows.map((row) => ({
    ...row,
    imageAssetId,
    imageAssetSource: imageAssetId ? source : "",
  }));
}

export function ensureSupplierSkuRows(rows, supplierCode) {
  const prefix = String(supplierCode || "").trim();
  if (!prefix) return rows;
  const used = new Set(
    rows.map((row) => String(row.supplierSku || "").trim()).filter(Boolean),
  );
  return rows.map((row) => {
    if (String(row.supplierSku || "").trim()) return row;
    const base = `${prefix}-${normalizeSupplierSkuPart(row.sizeText)}`;
    let supplierSku = base.slice(0, 200);
    let suffix = 2;
    while (used.has(supplierSku)) {
      const marker = `-${suffix}`;
      supplierSku = `${base.slice(0, 200 - marker.length)}${marker}`;
      suffix += 1;
    }
    used.add(supplierSku);
    return { ...row, supplierSku, supplierSkuSource: "auto" };
  });
}

function skuImageSearchText(value) {
  return String(value || "")
    .replace(/\.[^.]+$/, "")
    .trim()
    .toLocaleUpperCase()
    .replace(/[×xX＊*]/g, "X")
    .replace(/[^\p{L}\p{N}.]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

function dimensionTokens(value) {
  return new Set(
    skuImageSearchText(value).match(/\d+(?:\.\d+)?X\d+(?:\.\d+)?/g) || [],
  );
}

export function assignSkuPreviewImage(
  rows,
  rowId,
  assetId,
  source = "per_sku_manual",
) {
  const normalizedAssetId = String(assetId || "").trim();
  return rows.map((row) => String(row.id) === String(rowId)
    ? {
        ...row,
        imageAssetId: normalizedAssetId,
        imageAssetSource: normalizedAssetId ? source : "",
      }
    : row);
}

export function autoMapSkuPreviewImages(rows, images) {
  let mappedRows = rows.map((row) => ({ ...row }));
  const unmatchedAssetIds = [];
  const ambiguousAssetIds = [];

  for (const image of images) {
    const assetId = String(image?.id || image?.assetId || "").trim();
    const imageText = skuImageSearchText([
      image?.originalName || image?.name,
      image?.recognizedText,
    ].filter(Boolean).join(" "));
    if (!assetId || !imageText) {
      if (assetId) unmatchedAssetIds.push(assetId);
      continue;
    }
    const supplierMatches = mappedRows.filter((row) => {
      const supplierSku = skuImageSearchText(row.supplierSku);
      return supplierSku.length >= 3 && imageText.includes(supplierSku);
    });
    let matches = supplierMatches;
    if (!matches.length) {
      const imageDimensions = dimensionTokens(imageText);
      matches = mappedRows.filter((row) => {
        const rowDimensions = new Set([
          ...dimensionTokens(row.sizeText),
          ...dimensionTokens(row.sizeMapping?.valueLabel),
        ]);
        return [...imageDimensions].some((token) => rowDimensions.has(token));
      });
    }
    if (matches.length !== 1) {
      (matches.length ? ambiguousAssetIds : unmatchedAssetIds).push(assetId);
      continue;
    }
    const rowId = String(matches[0].id);
    if (String(matches[0].imageAssetId || "").trim()) {
      ambiguousAssetIds.push(assetId);
      continue;
    }
    mappedRows = mappedRows.map((row) => String(row.id) === rowId
      ? {
          ...row,
          imageAssetId: assetId,
          imageAssetSource: image?.recognizedText ? "per_sku_ocr" : "per_sku_filename",
        }
      : row);
  }

  return { rows: mappedRows, unmatchedAssetIds, ambiguousAssetIds };
}

export function buildSkuPublishPreview({
  supplierCode,
  colorMapping,
  rows,
  sizeAttributeFields = [],
  currency,
  skuSettings = {},
  weightConfig = null,
  dimensionConfig = null,
}) {
  const sourceRows = ensureSupplierSkuRows(
    Array.isArray(rows) ? rows : [],
    supplierCode,
  );
  const skuInputs = Object.fromEntries(sourceRows.map((row) => [
    String(row.id),
    {
      supplierSku: row.supplierSku,
      costPrice: row.costPrice,
      inventoryNum: row.inventoryNum,
    },
  ]));
  const result = buildSkuDrafts({
    rows: sourceRows.map((row) => ({
      ...row,
      sheinAttributeId: row.sizeMapping?.attributeId || "",
      sheinAttributeValueId: row.sizeMapping?.valueId || "",
      sheinAttributeCustomValue: row.sizeMapping?.customValue || "",
      sheinValueLabel: row.sizeMapping?.valueLabel || row.sizeText,
    })),
    skuInputs,
    businessMode: "full",
    currency,
    weightConfig,
    dimensionConfig,
  });
  const saleAttribute = colorMapping
    ? {
        attribute_id: toApiId(colorMapping.attributeId),
        ...(colorMapping.valueId
          ? { attribute_value_id: toApiId(colorMapping.valueId) }
          : { custom_attribute_value: String(colorMapping.customValue || "").trim() }),
      }
    : null;
  const mallState = [1, 2].includes(Number(skuSettings.mall_state))
    ? Number(skuSettings.mall_state)
    : null;
  const stopPurchase = [1, 2].includes(Number(skuSettings.stop_purchase))
    ? Number(skuSettings.stop_purchase)
    : null;
  const skuList = result.items.map((item) => {
    const payload = { ...item.payload };
    delete payload.mall_state;
    delete payload.stop_purchase;
    if (mallState !== null) payload.mall_state = mallState;
    if (stopPurchase !== null) payload.stop_purchase = stopPurchase;
    return payload;
  });

  return {
    skc: {
      supplier_code: String(supplierCode || "").trim(),
      sale_attribute: saleAttribute,
      sku_list: skuList,
    },
    size_attribute_list: buildSizeAttributeList(sourceRows, sizeAttributeFields),
    pendingImageUploads: sourceRows
      .filter((row) => String(row.imageAssetId || "").trim())
      .map((row) => ({
        rowId: String(row.id),
        assetId: String(row.imageAssetId),
        supplierSku: String(row.supplierSku || "").trim(),
        targetLevel: "sku",
        imageType: 1,
        imageSort: 1,
      })),
    blockers: result.blockers,
  };
}

export function validateSkuStage({
  saleSchema,
  supplierCode,
  sizeTemplateId,
  colorMapping,
  rows,
  packagingTemplateId,
  packagingMaterial,
  currency,
  weightRequired = false,
}) {
  const fields = Array.isArray(saleSchema?.fields) ? saleSchema.fields : [];
  const sizeAttributeFields = Array.isArray(saleSchema?.sizeFields)
    ? saleSchema.sizeFields
    : [];
  const sizeSaleFields = fields.filter(
    (field) => field.id !== colorMapping?.attributeId,
  );
  const knownValues = new Set(
    fields.flatMap((field) =>
      field.values.map((value) => `${field.id}:${value.id}`)
    ),
  );
  const blockers = [];

  const normalizedSupplierCode = String(supplierCode || "").trim();
  if (!normalizedSupplierCode || normalizedSupplierCode.length > 200) {
    blockers.push({
      code: "SUPPLIER_CODE_INVALID",
      message: "商家SKC货号不能为空且不能超过200个字符",
    });
  }

  if (!String(currency || "").trim()) {
    blockers.push({
      code: "SKU_COST_CURRENCY_MISSING",
      message: "当前类目的SHEIN发布规范没有返回供货价币种",
    });
  }

  if (!sizeTemplateId) {
    blockers.push({
      code: "SIZE_TEMPLATE_REQUIRED",
      message: "未引用颜色与尺寸模板",
    });
  } else if (!rows.length) {
    blockers.push({
      code: "SKU_ROWS_REQUIRED",
      message: "颜色与尺寸模板没有生成SKU尺寸行",
    });
  }

  if (Number(saleSchema?.mainAttributeStatus) !== 1) {
    const colorField = colorMapping && fields.find(
      (field) =>
        String(field.id) === String(colorMapping.attributeId) &&
        Number(field.labelCode) === 1,
    );
    const colorKey = colorMapping?.valueId
      ? `${colorMapping.attributeId}:${colorMapping.valueId}`
      : "";
    const customColor = String(colorMapping?.customValue || "").trim();
    const validCustomColor = Boolean(
      customColor && colorField?.customValueAllowed === true,
    );
    if ((!colorKey || !knownValues.has(colorKey)) && !validCustomColor) {
      blockers.push({
        code: "COLOR_SALE_VALUE_REQUIRED",
        message: customColor && colorField
          ? "当前类目不允许自定义该销售属性值"
          : "共享颜色尚未匹配当前类目的SHEIN主销售属性值",
      });
    }
  }

  const supplierSkus = new Set();
  for (const row of rows) {
    const supplierSku = String(row.supplierSku || "").trim();
    if (supplierSku.length > 200) {
      blockers.push({
        code: "SUPPLIER_SKU_INVALID",
        message: `尺寸“${row.sizeText}”的商家SKU不能超过200个字符`,
        rowId: row.id,
      });
    } else if (supplierSkus.has(supplierSku)) {
      blockers.push({
        code: "SUPPLIER_SKU_DUPLICATE",
        message: `商家SKU“${supplierSku}”在当前商品中重复`,
        rowId: row.id,
      });
    } else {
      supplierSkus.add(supplierSku);
    }
    if (!positiveNumber(row.lengthCm) || !positiveNumber(row.widthCm)) {
      blockers.push({
        code: "SKU_FINISHED_DIMENSIONS_INVALID",
        message: `尺寸“${row.sizeText}”的成品长宽必须是大于0的数字`,
        rowId: row.id,
      });
    }
    const sizeKey = row.sizeMapping && row.sizeMapping.valueId
      ? `${row.sizeMapping.attributeId}:${row.sizeMapping.valueId}`
      : "";
    const customSize = String(row.sizeMapping?.customValue || "").trim();
    const customSizeField = row.sizeMapping && fields.find(
      (field) => String(field.id) === String(row.sizeMapping.attributeId),
    );
    const customSizeFieldKnown = Boolean(customSizeField);
    const customSizeAllowed = customSizeField?.customValueAllowed === true;
    if (sizeSaleFields.length > 0 &&
      (!sizeKey || !knownValues.has(sizeKey)) &&
      !(customSize && customSizeFieldKnown && customSizeAllowed)) {
      blockers.push({
        code: customSize && customSizeFieldKnown
          ? "CUSTOM_SIZE_NOT_ALLOWED"
          : "SIZE_SALE_VALUE_REQUIRED",
        message: customSize && customSizeFieldKnown
          ? `尺寸“${row.sizeText}”的自定义值未获当前类目 SHEIN 权限`
          : `尺寸“${row.sizeText}”尚未匹配当前类目的SHEIN销售属性值`,
        rowId: row.id,
      });
    }
    const sizeAttributeValues = resolveSizeAttributeValues(row, sizeAttributeFields);
    for (const field of sizeAttributeFields) {
      const value = sizeAttributeValues[String(field.id)];
      if (field.required && !value) {
        blockers.push({
          code: "SIZE_ATTRIBUTE_REQUIRED",
          message: `尺寸“${row.sizeText}”缺少必填尺码表字段“${field.name}”`,
          rowId: row.id,
        });
      } else if (value && !positiveIntegerText(value)) {
        blockers.push({
          code: "SIZE_ATTRIBUTE_INVALID",
          message: `尺寸“${row.sizeText}”的尺码表字段“${field.name}”必须是正整数`,
          rowId: row.id,
        });
      }
    }
    const costPrice = String(row.costPrice ?? "").trim();
    if (
      !/^\d+(?:\.\d{1,2})?$/.test(costPrice) ||
      !(Number(costPrice) > 0) ||
      Number(costPrice) > 100000
    ) {
      blockers.push({
        code: "SKU_COST_PRICE_INVALID",
        message: `尺寸“${row.sizeText}”的供货价必须大于0、不超过100000且最多2位小数`,
        rowId: row.id,
      });
    }
    const inventoryText = String(row.inventoryNum ?? "").trim();
    const inventory = Number(inventoryText);
    if (
      !inventoryText ||
      !Number.isInteger(inventory) ||
      inventory < 0 ||
      inventory > 99999
    ) {
      blockers.push({
        code: "SKU_INVENTORY_INVALID",
        message: `尺寸“${row.sizeText}”的库存必须是0到99999的整数`,
        rowId: row.id,
      });
    }
    const weightText = String(row.weightGrams ?? "").trim();
    if (
      (weightRequired && !positiveNumber(row.weightGrams)) ||
      (weightText && !positiveNumber(row.weightGrams))
    ) {
      blockers.push({
        code: "SKU_WEIGHT_INVALID",
        message: `尺寸“${row.sizeText}”的商品重量必须是大于0的克数`,
        rowId: row.id,
      });
    }
  }

  const rowsWithImages = rows.filter((row) =>
    String(row.imageAssetId || "").trim()
  );
  if (rowsWithImages.length > 0 && rowsWithImages.length !== rows.length) {
    blockers.push({
      code: "SKU_IMAGE_INCOMPLETE",
      message: "当前SKC已有SKU图，必须为其下所有SKU提供图片",
    });
  }

  if (!packagingTemplateId) {
    blockers.push({
      code: "PACKAGING_TEMPLATE_REQUIRED",
      message: "未引用打包体积模板",
    });
  } else if (!packagingMaterial) {
    blockers.push({
      code: "PACKAGING_MATERIAL_REQUIRED",
      message: "未选择打包体积模板中的材质",
    });
  } else {
    for (const row of rows) {
      if (
        !["matched", "manual"].includes(row.packageMatch) ||
        !positiveNumber(row.packageLengthCm) ||
        !positiveNumber(row.packageWidthCm) ||
        !positiveNumber(row.packageHeightCm)
      ) {
        blockers.push({
          code: "PACKAGING_SIZE_NOT_MATCHED",
          message: `尺寸“${row.sizeText}”没有匹配到当前材质的打包体积`,
          rowId: row.id,
        });
      }
    }
  }

  return { valid: blockers.length === 0, blockers };
}
