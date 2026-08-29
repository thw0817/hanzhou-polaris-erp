import {
  applyGramsPerSquareMeter,
  applyPackagingTemplate,
  applyPricePerSquareMeter,
  buildSkuStageFromSizeTemplate,
} from "./product-sku-contract.js";

function number(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function dimensionText(lengthCm, widthCm) {
  const values = [number(lengthCm), number(widthCm)]
    .filter((value) => value > 0)
    .sort((left, right) => left - right);
  return values.length === 2 ? `${values[0]} × ${values[1]} cm` : "待设置尺寸";
}

function dateCode(now = new Date()) {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${month}${day}`;
}

export function buildBatchDraftName(title, fallback = "未命名商品草稿") {
  const source = String(title || "").trim() || String(fallback || "").trim();
  return (source || "未命名商品草稿").slice(0, 160);
}

export function buildDefaultBatchSupplierCode(index, now = new Date()) {
  return `家居-地毯-${dateCode(now)}${String(index + 1).padStart(3, "0")}`;
}

export function buildBatchSkuRows(sizeTemplate, groupId) {
  const sourceRows = Array.isArray(sizeTemplate?.data?.rows)
    ? sizeTemplate.data.rows
    : [];
  return sourceRows.map((source, index) => ({
    id: `${groupId}:sku:${index + 1}`,
    sizeText: String(source.sizeText || dimensionText(source.lengthCm, source.widthCm)),
    widthCm: number(source.widthCm),
    lengthCm: number(source.lengthCm),
    sizeMapping: null,
    imageAssetId: "",
    imageAssetSource: "",
    costPrice: "",
    weightGrams: null,
    inventoryNum: 0,
  }));
}

export function buildBatchSkuStage(sizeTemplate, groupId, saleSchema) {
  const stage = buildSkuStageFromSizeTemplate(sizeTemplate, saleSchema);
  return {
    colorMapping: stage.colorMapping,
    rows: stage.rows.map((row, index) => ({
      ...row,
      id: `${groupId}:sku:${index + 1}`,
      imageAssetId: "",
      imageAssetSource: "",
      costPrice: "",
      weightGrams: null,
      inventoryNum: 0,
    })),
  };
}

export function applyBatchSkuSettings(rows, {
  pricePerSquareMeter = "",
  gramsPerSquareMeter = "",
  packagingTemplate = null,
  packagingMaterial = "",
  inventory = "",
} = {}) {
  let result = Array.isArray(rows) ? rows.map((row) => ({ ...row })) : [];
  result = applyPricePerSquareMeter(result, pricePerSquareMeter);
  result = applyGramsPerSquareMeter(result, gramsPerSquareMeter);
  result = applyPackagingTemplate(result, packagingTemplate, packagingMaterial);
  const inventoryValue = Number(inventory);
  if (Number.isInteger(inventoryValue) && inventoryValue >= 0) {
    result = result.map((row) => ({ ...row, inventoryNum: inventoryValue }));
  }
  return result;
}

export function mapBatchSkuPreviews(rows, images, mode = "none") {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const sourceImages = Array.isArray(images) ? images : [];
  if (mode === "none" || !sourceImages.length) {
    return sourceRows.map((row) => ({ ...row, imageAssetId: "", imageAssetSource: "" }));
  }
  return sourceRows.map((row, index) => {
    const image = mode === "main"
      ? sourceImages[0]
      : sourceImages[index % sourceImages.length];
    const id = String(image?.id || image?.assetId || "").trim();
    return {
      ...row,
      imageAssetId: id,
      imageAssetSource: id ? `batch_${mode}` : "",
    };
  });
}

export function reorderBatchImages(images, activeId, overId) {
  const source = Array.isArray(images) ? images : [];
  const fromIndex = source.findIndex((image) => String(image?.id) === String(activeId));
  const toIndex = source.findIndex((image) => String(image?.id) === String(overId));
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return source;
  const next = [...source];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

export function applyBatchAttributeTemplate(template) {
  return Object.fromEntries(
    (Array.isArray(template?.data?.assignments) ? template.data.assignments : [])
      .map((assignment) => [String(assignment.attributeId), {
        valueIds: (assignment.valueIds || []).map(String),
        customValue: String(assignment.customValue || ""),
      }]),
  );
}

export function summarizeBatchProduct(row) {
  const skuRows = Array.isArray(row?.skuRows) ? row.skuRows : [];
  const withPrice = skuRows.filter((item) => String(item.costPrice || "").trim()).length;
  const withWeight = skuRows.filter((item) => number(item.weightGrams) > 0).length;
  const withPreview = skuRows.filter((item) => String(item.imageAssetId || "").trim()).length;
  const blockers = [];
  const title = String(row?.title || "").trim();
  const titleMaxLength = Number(row?.titleMaxLength);
  if (!title) blockers.push("标题未填写");
  if (
    title &&
    Number.isInteger(titleMaxLength) &&
    titleMaxLength >= 2 &&
    title.length > titleMaxLength
  ) {
    blockers.push(`标题超过SHEIN当前类目上限${titleMaxLength}个字符`);
  }
  if (!String(row?.attributeTemplateId || "").trim()) blockers.push("未引用商品属性模板");
  if (!String(row?.sizeTemplateId || "").trim() || !skuRows.length) blockers.push("未引用尺寸模板");
  if (skuRows.length && withPrice !== skuRows.length) blockers.push("SKU价格未完整生成");
  if (skuRows.length && withWeight !== skuRows.length) blockers.push("SKU克重未完整生成");
  if (withPreview > 0 && withPreview !== skuRows.length) blockers.push("已指定SKU预览图，但仍有SKU未指定");
  return {
    skuCount: skuRows.length,
    withPrice,
    withWeight,
    withPreview,
    blockers,
    readyForDetail: blockers.length === 0,
  };
}
