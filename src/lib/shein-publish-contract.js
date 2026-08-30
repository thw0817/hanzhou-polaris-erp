export const SHEIN_PUBLISH_ENDPOINTS = Object.freeze({
  publishPermission: {
    method: "GET",
    path: "/open-api/goods/product/check-publish-permission",
    label: "确认店铺是否可发品",
  },
  publishQuota: {
    method: "POST",
    path: "/open-api/goods-publish-quotas/detail",
    label: "查询商家发品额度",
  },
  categoryTree: {
    method: "POST",
    path: "/open-api/goods/query-category-tree",
    label: "店铺查商品末级分类",
  },
  publishStandard: {
    method: "POST",
    path: "/open-api/goods/query-publish-fill-in-standard",
    label: "商品发布字段规范",
  },
  attributeTemplate: {
    method: "POST",
    path: "/open-api/goods/query-attribute-template",
    label: "查询分类可用属性",
  },
  associatedAttributeRules: {
    method: "POST",
    path: "/open-api/goods/get-associated-attribute-rules",
    label: "查询关联属性填写规则",
  },
  siteList: {
    method: "POST",
    path: "/open-api/goods/query-site-list",
    label: "查询店铺站点和币种信息",
  },
  brandList: {
    method: "POST",
    path: "/open-api/goods/query-brand-list",
    label: "查询可用品牌列表",
  },
  supplierSkuRepeated: {
    method: "POST",
    path: "/open-api/goods/product/check-supplierSku-repeated",
    label: "查询商家SKU是否已存在",
  },
  uploadPicture: {
    method: "POST",
    path: "/open-api/goods/upload-pic",
    label: "本地图片上传",
  },
  publishOrEdit: {
    method: "POST",
    path: "/open-api/goods/product/publishOrEdit",
    label: "商品发布/编辑",
  },
});

export const PUBLISH_STANDARD_FIELD_MAP = Object.freeze({
  reference_product_link: "competing_product_link",
  sample_spec: "sample_info",
  proof_of_stock: "proof_of_stock_list",
  shelf_require: "shelf_require",
  brand_code: "brand_code",
  skc_title: "skc_multi_language_name_list",
  minimum_stock_quantity: "minimum_stock_quantity",
  product_detail_picture: "site_detail_image_info_list",
  quantity_info: "quantity_info",
  suggest_price: "suggested_retail_price",
  supplier_barcode: "supplier_barcode",
  package_type: "package_type",
  ip_character: "ip_character_list",
});

export const SHEIN_PUBLISH_GROUPS = Object.freeze([
  {
    id: "basic",
    label: "基本信息",
    source: "publishStandard",
    fields: [
      { key: "source_system", label: "来源系统", required: true, fixed: "OpenAPI" },
      { key: "suit_flag", label: "套装标识", required: true, fixed: 0 },
      { key: "category_id", label: "末级类目ID", required: true, source: "categoryTree" },
      { key: "product_type_id", label: "商品类型ID", required: true, source: "categoryTree" },
      {
        key: "multi_language_name_list",
        label: "商品标题",
        required: true,
        source: "publishStandard",
      },
      {
        key: "multi_language_desc_list",
        label: "商品描述",
        required: false,
        source: "publishStandard",
      },
      { key: "brand_code", label: "品牌", dynamic: "brand_code", source: "brandList" },
      { key: "ip_character_list", label: "IP信息", dynamic: "ip_character" },
    ],
  },
  {
    id: "attributes",
    label: "属性与规格",
    source: "attributeTemplate",
    fields: [
      { key: "product_attribute_list", label: "商品属性", required: true },
      { key: "size_attribute_list", label: "尺码属性", conditional: true },
      { key: "skc_list.sale_attribute", label: "SKC主销售属性", required: true },
      { key: "sku_list.sale_attribute_list", label: "SKU次销售属性", conditional: true },
      { key: "sku_scope_attribute_list", label: "SKU维度商品属性", conditional: true },
    ],
  },
  {
    id: "images",
    label: "图片",
    source: "uploadPicture",
    fields: [
      {
        key: "image_info",
        label: "SPU或SKC图片",
        required: true,
        dynamic: "picture_config_list",
      },
      { key: "sku_list.image_info", label: "SKU图", conditional: true },
      {
        key: "site_detail_image_info_list",
        label: "站点详情图",
        dynamic: "product_detail_picture",
      },
    ],
  },
  {
    id: "supply",
    label: "SKU与供应信息",
    source: "publishOrEdit",
    fields: [
      { key: "skc_list.supplier_code", label: "商家SKC货号", required: true },
      { key: "sku_list.supplier_sku", label: "商家SKU", required: true },
      { key: "sku_list.cost_info", label: "供货价", businessModes: ["full", "semi"] },
      { key: "sku_list.length", label: "包装长度", required: true },
      { key: "sku_list.width", label: "包装宽度", required: true },
      { key: "sku_list.height", label: "包装高度", required: true },
      { key: "sku_list.weight", label: "包装重量", required: true },
      { key: "sku_list.mall_state", label: "商城销售状态", required: true },
      { key: "sku_list.stop_purchase", label: "采购状态", businessModes: ["full"] },
      { key: "sku_list.stock_info_list", label: "库存信息", required: true },
      { key: "shelf_require", label: "到仓后上架", businessModes: ["full"] },
      { key: "shelf_way", label: "上架方式", businessModes: ["full", "semi"] },
    ],
  },
]);

export const BUSINESS_MODE_LABELS = Object.freeze({
  full: "全托管",
  semi: "半托管",
  self: "自运营",
  pop: "POP",
});

export function normalizeFillStandard(responseInfo = {}) {
  const standards = Object.fromEntries(
    (responseInfo.fill_in_standard_list || []).map((item) => [
      item.field_key,
      {
        module: item.module || "",
        required: Boolean(item.required),
        show: Boolean(item.show),
        payloadField: PUBLISH_STANDARD_FIELD_MAP[item.field_key] || item.field_key,
      },
    ]),
  );

  return {
    standards,
    currency: responseInfo.currency || "",
    defaultLanguage: responseInfo.default_language || "",
    defaultTitleMaxLength: responseInfo.default_language_title_max_length || null,
    languageTitleLimits: responseInfo.language_title_max_length_list || [],
    pictureConfig: responseInfo.picture_config_list || [],
    weightConfig: responseInfo.weight_config || null,
    dimensionConfig: responseInfo.length_width_height_config || null,
    supportsSaleAttributeSort: Boolean(responseInfo.support_sale_attribute_sort),
  };
}

function hasText(value) {
  return typeof value === "string" ? value.trim().length > 0 : value !== null && value !== undefined;
}

function requiredForMode(field, businessMode) {
  return Boolean(field.required || field.businessModes?.includes(businessMode));
}

export function getVisiblePublishFields({ businessMode = "full", fillStandard } = {}) {
  const standardMap = fillStandard?.standards || {};

  return SHEIN_PUBLISH_GROUPS.map((group) => ({
    ...group,
    fields: group.fields
      .filter((field) => {
        if (!field.dynamic) return true;
        const standard = standardMap[field.dynamic];
        return standard ? standard.show : true;
      })
      .map((field) => {
        const standard = field.dynamic ? standardMap[field.dynamic] : null;
        return {
          ...field,
          required: requiredForMode(field, businessMode) || Boolean(standard?.required),
          unresolved: Boolean(field.dynamic && !standard),
        };
      }),
  }));
}

export function validateNewProductDraft(
  draft,
  { businessMode = "full", fillStandard } = {},
) {
  const errors = [];
  const required = (key, label) => {
    if (!hasText(draft[key])) errors.push({ key, message: `${label}不能为空` });
  };

  required("categoryId", "末级类目");
  required("productTypeId", "商品类型");
  required("title", "默认语种商品标题");
  required("supplierCode", "商家SKC货号");
  required("supplierSku", "商家SKU");
  required("length", "包装长度");
  required("width", "包装宽度");
  required("height", "包装高度");
  required("weight", "包装重量");

  if (!draft.mainImageCount) {
    errors.push({ key: "mainImageCount", message: "每个SKC必须提供1张主图" });
  }
  if (Number(draft.mainImageCount) > 1) {
    errors.push({ key: "mainImageCount", message: "每个SKC最多提供1张主图" });
  }
  if (Number(draft.detailImageCount) > 10) {
    errors.push({ key: "detailImageCount", message: "每个SKC最多提供10张细节图" });
  }
  if (!draft.productAttributesReady) {
    errors.push({ key: "productAttributesReady", message: "商品属性尚未按类目接口完成" });
  }
  if (!draft.saleAttributesReady) {
    errors.push({ key: "saleAttributesReady", message: "SKC/SKU销售属性尚未按类目接口完成" });
  }

  if (businessMode === "full" || businessMode === "semi") {
    required("costPrice", "供货价");
    required("currency", "供货价币种");
    required("shelfWay", "上架方式");
  }
  if (businessMode === "full") {
    required("stopPurchase", "采购状态");
    required("shelfRequire", "到仓后上架设置");
  }

  const standards = fillStandard?.standards || {};
  Object.entries(standards).forEach(([fieldKey, standard]) => {
    if (!standard.show && hasText(draft[standard.payloadField])) {
      errors.push({
        key: standard.payloadField,
        message: `${standard.payloadField} 当前店铺/类目不可填写`,
      });
    }
    if (standard.show && standard.required && !hasText(draft[standard.payloadField])) {
      errors.push({
        key: standard.payloadField,
        message: `${standard.payloadField} 是当前店铺/类目的动态必填字段`,
      });
    }
  });

  return errors;
}

export function createPublishPreflightPlan({
  businessMode = "full",
  hasCategory = false,
  hasAttributes = false,
  hasImages = false,
} = {}) {
  const steps = [
    { endpoint: "publishPermission", state: "pending", blocksSubmit: true },
    { endpoint: "publishQuota", state: "pending", blocksSubmit: true },
    { endpoint: "categoryTree", state: hasCategory ? "ready" : "pending", blocksSubmit: true },
    { endpoint: "publishStandard", state: "pending", blocksSubmit: true },
    { endpoint: "attributeTemplate", state: hasAttributes ? "ready" : "pending", blocksSubmit: true },
    { endpoint: "associatedAttributeRules", state: "pending", blocksSubmit: true },
    { endpoint: "brandList", state: "pending", blocksSubmit: false },
    { endpoint: "supplierSkuRepeated", state: "pending", blocksSubmit: true },
  ];

  if (businessMode !== "full") {
    steps.splice(6, 0, { endpoint: "siteList", state: "pending", blocksSubmit: true });
  }
  if (hasImages) {
    steps.push({ endpoint: "uploadPicture", state: "local-ready", blocksSubmit: true });
  }
  steps.push({ endpoint: "publishOrEdit", state: "waiting", blocksSubmit: true });

  return steps.map((step, index) => ({
    ...step,
    order: index + 1,
    ...SHEIN_PUBLISH_ENDPOINTS[step.endpoint],
  }));
}
