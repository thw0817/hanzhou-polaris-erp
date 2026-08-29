import { appendTailMainImages } from "./main-image-template.js";
import { buildSizeAttributeList } from "./shein-size-template.js";

function hasText(value) {
  return String(value ?? "").trim().length > 0;
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function configRequired(config, fallback = true) {
  if (!config || config.is_required === undefined || config.is_required === null) {
    return fallback;
  }
  if (typeof config.is_required === "boolean") return config.is_required;
  return ["1", "true", "yes", "required", "是"].includes(
    String(config.is_required).trim().toLowerCase(),
  );
}

function preferredUnit(config, preferred, fallback) {
  const units = Array.isArray(config?.available_units)
    ? config.available_units.map(String).filter(Boolean)
    : [];
  const available = units.length ? units : [fallback];
  return available.find(
    (unit) => unit.toLowerCase() === preferred.toLowerCase(),
  ) || available[0];
}

function convertWeightFromGrams(value, unit) {
  if (!value) return null;
  if (unit === "lb") return Number((value / 453.59237).toFixed(2));
  if (unit === "Oz") return Number((value / 28.349523125).toFixed(2));
  return Number(value.toFixed(2));
}

function convertDimensionFromCentimeters(value, unit) {
  if (!value) return null;
  if (unit === "Inch") return Number((value / 2.54).toFixed(2));
  if (unit === "Ft") return Number((value / 30.48).toFixed(2));
  return Number(value.toFixed(2));
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= 99999
    ? number
    : null;
}

function toApiId(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : value;
}

function hasAssignment(value = {}) {
  return Boolean(
    (Array.isArray(value.valueIds) && value.valueIds.length) ||
      hasText(value.customValue),
  );
}

function configMap(pictureConfig = []) {
  return Object.fromEntries(
    pictureConfig.map((item) => [
      item.field_key,
      Boolean(item.is_true),
    ]),
  );
}

const dynamicPayloadField = {
  reference_product_link: "competing_product_link",
  sample_spec: "sample_info",
  proof_of_stock: "proof_of_stock_list",
  brand_code: "brand_code",
  skc_title: "skc_multi_language_name_list",
  product_detail_picture: "site_detail_image_info_list",
  suggest_price: "suggested_retail_price",
  ip_character: "ip_character_list",
};

function toUploadItem(image, {
  targetLevel,
  imageType,
  imageSort,
  slot,
}) {
  return {
    localId: image.id || image.url || image.previewUrl || "",
    name: image.file?.name || image.originalName || image.name || "",
    previewUrl: image.previewUrl || image.url || "",
    source: image.source || "product",
    templateId: image.templateId || "",
    targetLevel,
    imageType,
    imageSort,
    slot,
    status: "local",
  };
}

export function buildProductAttributeList({
  fields = [],
  templateValues = {},
  overrides = {},
  perProductFieldIds = [],
} = {}) {
  const perProduct = new Set(perProductFieldIds.map(String));
  const items = [];
  const unresolved = [];

  fields
    .filter((field) => [3, 4].includes(Number(field.typeCode)))
    .forEach((field) => {
      const key = String(field.id);
      const requiresOverride = perProduct.has(key);
      const assignment = requiresOverride
        ? overrides[key]
        : (overrides[key] ?? templateValues[key]);

      if (!hasAssignment(assignment)) {
        if (field.required) {
          unresolved.push({
            fieldId: key,
            fieldName: field.name,
            reason: requiresOverride
              ? "需要为当前商品单独填写"
              : "模板缺少必填值",
          });
        }
        return;
      }

      const allowsPreset = [1, 3, 4].includes(Number(field.modeCode));
      const allowsManual = [0, 4].includes(Number(field.modeCode));

      const valueIds = Array.from(new Set(assignment.valueIds || []));
      if (allowsPreset) {
        valueIds.forEach((valueId) => {
          items.push({
            attribute_id: toApiId(field.id),
            attribute_value_id: toApiId(valueId),
            ...(Number(field.dataDimension) === 2 && allowsManual && valueIds.length === 1 && hasText(assignment.customValue)
              ? { attribute_extra_value: String(assignment.customValue).trim() }
              : {}),
          });
        });
      }
      if (allowsManual && hasText(assignment.customValue) && !valueIds.length) {
        items.push({
          attribute_id: toApiId(field.id),
          attribute_extra_value: String(assignment.customValue).trim(),
        });
      }
    });

  return { items, unresolved };
}

export function buildPublishImagePlan({
  product = {},
  tailTemplate = null,
  pictureConfig = [],
} = {}) {
  const rules = configMap(pictureConfig);
  const useSpuPictures = rules.switch_spu_picture === true;
  const productGallery = [
    ...(product.main || []),
    ...(product.detail || []),
  ];
  const gallery = appendTailMainImages(productGallery, tailTemplate).images;
  const primary = gallery[0] || null;
  const detailImages = gallery.slice(1);
  const galleryLevel = useSpuPictures ? "spu" : "skc";
  const blockers = [];
  const uploads = [];

  if (!primary) {
    blockers.push("缺少商品主图");
  } else {
    uploads.push(
      toUploadItem(primary, {
        targetLevel: galleryLevel,
        imageType: 1,
        imageSort: 1,
        slot: "gallery-primary",
      }),
    );
  }

  const detailShowKey = `${galleryLevel}_image_detail_show`;
  const detailRequiredKey = `${galleryLevel}_image_detail_required`;
  if (rules[detailShowKey] === false && detailImages.length) {
    blockers.push(
      `${galleryLevel.toUpperCase()} 图片方案不允许提交细节图`,
    );
  }
  if (rules[detailRequiredKey] === true && !detailImages.length) {
    blockers.push(
      `${galleryLevel.toUpperCase()} 图片方案要求至少一张细节图`,
    );
  }
  if (detailImages.length > 10) {
    blockers.push(
      `${galleryLevel.toUpperCase()} 细节图最多10张，当前${detailImages.length}张`,
    );
  }
  detailImages.slice(0, 10).forEach((image, index) => {
    uploads.push(
      toUploadItem(image, {
        targetLevel: galleryLevel,
        imageType: 2,
        imageSort: index + 2,
        slot: "gallery-detail",
      }),
    );
  });

  const skcOffset = useSpuPictures ? 1 : uploads.filter(
    (item) => item.targetLevel === "skc",
  ).length + 1;
  (product.square || []).slice(0, 1).forEach((image, index) => {
    uploads.push(
      toUploadItem(image, {
        targetLevel: "skc",
        imageType: 5,
        imageSort: skcOffset + index,
        slot: "square",
      }),
    );
  });
  const swatchOffset = uploads.filter(
    (item) => item.targetLevel === "skc",
  ).length + 1;
  (product.swatch || []).slice(0, 1).forEach((image, index) => {
    uploads.push(
      toUploadItem(image, {
        targetLevel: "skc",
        imageType: 6,
        imageSort: swatchOffset + index,
        slot: "swatch",
      }),
    );
  });
  (product.sku || []).forEach((image, index) => {
    uploads.push(
      toUploadItem(image, {
        targetLevel: "sku",
        imageType: 1,
        imageSort: 1,
        slot: `sku-${index + 1}`,
      }),
    );
  });
  (product.description || []).forEach((image, index) => {
    uploads.push(
      toUploadItem(image, {
        targetLevel: "site-detail",
        imageType: 7,
        imageSort: index + 1,
        slot: "site-detail",
      }),
    );
  });

  return {
    isSpuPic: useSpuPictures,
    scheme: useSpuPictures ? "new-spu" : "legacy-skc",
    uploads,
    blockers,
    galleryCount: gallery.length,
    tailCount: gallery.filter((image) => image.source === "tail-template").length,
  };
}

export function buildSkuDrafts({
  rows = [],
  skuInputs = {},
  defaultSkuInput = {},
  businessMode = "full",
  currency = "",
  weightConfig = null,
  dimensionConfig = null,
} = {}) {
  const sourceRows = rows.length ? rows : [{ id: "single-sku" }];
  const items = [];
  const blockers = [];
  const weightRequired = configRequired(weightConfig, true);
  const dimensionsRequired = configRequired(dimensionConfig, true);
  const weightUnit = preferredUnit(weightConfig, "g", "g");
  const dimensionUnit = preferredUnit(dimensionConfig, "cm", "cm");

  sourceRows.forEach((row, index) => {
    const rowKey = String(row.id || row.sheinValueId || index);
    const input = { ...defaultSkuInput, ...(skuInputs[rowKey] || {}) };
    const label = row.sheinValueLabel || row.name || `SKU ${index + 1}`;
    const supplierSku = String(input.supplierSku || "").trim();
    const costPrice = String(input.costPrice || "").trim();
    const inventoryNum = nonNegativeInteger(input.inventoryNum);
    const length = positiveNumber(row.packageLengthCm ?? input.length);
    const width = positiveNumber(row.packageWidthCm ?? input.width);
    const height = positiveNumber(row.packageHeightCm ?? input.height);
    const weight = positiveNumber(row.weightGrams ?? input.weight);

    if (!supplierSku) blockers.push(`${label}缺少商家SKU`);
    const dimensionValues = [length, width, height];
    const hasAnyDimension = dimensionValues.some(Boolean);
    const hasAllDimensions = dimensionValues.every(Boolean);
    if ((dimensionsRequired && !hasAllDimensions) || (hasAnyDimension && !hasAllDimensions)) {
      blockers.push(`${label}缺少含包装长宽高`);
    }
    if (weightRequired && !weight) {
      blockers.push(`${label}缺少产品重量（含包装）`);
    }
    if (inventoryNum === null) blockers.push(`${label}库存需为0-99999的整数`);
    if (["full", "semi"].includes(businessMode)) {
      const price = Number(costPrice);
      if (
        !costPrice ||
        !Number.isFinite(price) ||
        price < 0 ||
        price > 100000 ||
        !/^\d+(?:\.\d{1,2})?$/.test(costPrice)
      ) {
        blockers.push(`${label}供货价需为0-100000且最多2位小数`);
      }
      if (!currency) blockers.push(`${label}缺少发布规范返回的供货价币种`);
    }

    const sku = {
      supplier_sku: supplierSku,
      mall_state: Number(input.mallState || 1),
      stock_info_list:
        inventoryNum === null ? [] : [{ inventory_num: inventoryNum }],
      sale_attribute_list:
        row.sheinAttributeId && (row.sheinAttributeValueId || row.sheinAttributeCustomValue)
          ? [
              {
                attribute_id: toApiId(row.sheinAttributeId),
                ...(row.sheinAttributeValueId
                  ? { attribute_value_id: toApiId(row.sheinAttributeValueId) }
                  : { custom_attribute_value: String(row.sheinAttributeCustomValue).trim() }),
              },
            ]
          : [],
    };
    if (hasAllDimensions) {
      sku.length = String(convertDimensionFromCentimeters(length, dimensionUnit));
      sku.width = String(convertDimensionFromCentimeters(width, dimensionUnit));
      sku.height = String(convertDimensionFromCentimeters(height, dimensionUnit));
      sku.length_width_height_unit = dimensionUnit;
    }
    if (weight) {
      sku.weight = convertWeightFromGrams(weight, weightUnit);
      sku.weight_unit = weightUnit;
    }
    if (["full", "semi"].includes(businessMode)) {
      sku.cost_info = {
        cost_price: costPrice,
        currency,
      };
    }
    if (businessMode === "full") {
      sku.stop_purchase = Number(input.stopPurchase || 1);
    }
    items.push({ key: rowKey, label, payload: sku });
  });

  return { items, blockers };
}

export function buildNewProductDraft({
  categoryId,
  productTypeId,
  defaultLanguage,
  currency,
  product = {},
  productFields = {},
  attributeFields = [],
  attributeTemplate = null,
  attributeOverrides = {},
  sizeRows = [],
  sizeAttributeFields = [],
  skuInputs = {},
  defaultSkuInput = {},
  tailTemplate = null,
  pictureConfig = [],
  fillStandardList = [],
  weightConfig = null,
  dimensionConfig = null,
  dynamicPayload = {},
  businessMode = "full",
} = {}) {
  const blockers = [];
  const title = String(productFields.title || product.name || "").trim();
  const supplierCode = String(productFields.supplierCode || "").trim();
  const attributes = buildProductAttributeList({
    fields: attributeFields,
    templateValues: attributeTemplate?.attributeValues || {},
    overrides: attributeOverrides,
    perProductFieldIds: attributeTemplate?.perProductFieldIds || [],
  });
  const images = buildPublishImagePlan({
    product,
    tailTemplate,
    pictureConfig,
  });
  const skus = buildSkuDrafts({
    rows: sizeRows,
    skuInputs,
    defaultSkuInput,
    businessMode,
    currency,
    weightConfig,
    dimensionConfig,
  });
  const skcSaleAttributeId = productFields.skcSaleAttributeId;
  const skcSaleAttributeValueId = productFields.skcSaleAttributeValueId;
  const standardMap = Object.fromEntries(
    fillStandardList.map((item) => [item.field_key, item]),
  );
  const resolvedDynamicPayload = { ...dynamicPayload };
  const firstSizeRow = sizeRows[0];
  if (
    standardMap.sample_spec?.show === true &&
    skcSaleAttributeId &&
    skcSaleAttributeValueId &&
    firstSizeRow?.sheinAttributeId &&
    firstSizeRow?.sheinAttributeValueId
  ) {
    resolvedDynamicPayload.sample_spec = {
      sample_spec: {
        main_spec: {
          attribute_id: toApiId(skcSaleAttributeId),
          attribute_value_id: toApiId(skcSaleAttributeValueId),
        },
        sub_spec_list: [
          {
            attribute_id: String(firstSizeRow.sheinAttributeId),
            attribute_value_id: String(firstSizeRow.sheinAttributeValueId),
          },
        ],
      },
      sample_judge_type: 2,
      reserve_sample_flag: 2,
      spot_flag: Number(productFields.spotFlag || 1),
    };
  }

  if (!categoryId) blockers.push("缺少SHEIN末级类目ID");
  if (!productTypeId) blockers.push("缺少SHEIN商品类型ID");
  if (!defaultLanguage) blockers.push("缺少发布规范返回的默认语种");
  if (!title) blockers.push("缺少默认语种商品标题");
  if (!supplierCode) blockers.push("缺少商家SKC货号");
  if (!skcSaleAttributeId || !skcSaleAttributeValueId) {
    blockers.push("缺少SKC主销售属性");
  }
  fillStandardList
    .filter((item) => item.show === true && item.required === true)
    .forEach((item) => {
      const value = resolvedDynamicPayload[item.field_key];
      if (
        value === undefined ||
        value === null ||
        value === "" ||
        (Array.isArray(value) && !value.length)
      ) {
        blockers.push(`缺少动态必填字段 ${item.field_key}`);
      }
    });
  blockers.push(
    ...attributes.unresolved.map(
      (item) => `${item.fieldName}：${item.reason}`,
    ),
    ...images.blockers,
    ...skus.blockers,
  );

  const payload = {
    category_id: toApiId(categoryId),
    product_type_id: toApiId(productTypeId),
    source_system: "OpenAPI",
    suit_flag: 0,
    is_spu_pic: images.isSpuPic,
    multi_language_name_list: defaultLanguage && title
      ? [{ language: defaultLanguage, name: title }]
      : [],
    product_attribute_list: attributes.items,
    size_attribute_list: buildSizeAttributeList(
      sizeRows,
      sizeAttributeFields,
    ),
    skc_list: [
      {
        supplier_code: supplierCode,
        shelf_way: String(productFields.shelfWay || "1"),
        sale_attribute:
          skcSaleAttributeId && skcSaleAttributeValueId
            ? {
                attribute_id: toApiId(skcSaleAttributeId),
                attribute_value_id: toApiId(skcSaleAttributeValueId),
              }
            : null,
        sku_list: skus.items.map((item) => item.payload),
      },
    ],
  };
  if (businessMode === "full") {
    const shelfRule = standardMap.shelf_require;
    if (shelfRule?.show !== false) {
      payload.shelf_require = String(productFields.shelfRequire ?? "1");
    }
  }
  Object.entries(resolvedDynamicPayload).forEach(([fieldKey, value]) => {
    if (standardMap[fieldKey]?.show !== false && value !== "") {
      payload[dynamicPayloadField[fieldKey] || fieldKey] = value;
    }
  });

  return {
    id: product.id || "",
    title,
    payload,
    imagePlan: images,
    skuRows: skus.items,
    blockers: Array.from(new Set(blockers)),
    pendingUploadCount: images.uploads.length,
    readyForPreflight:
      blockers.length === 0 && images.uploads.length > 0,
  };
}
