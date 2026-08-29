export const SHEIN_TEMPLATE_ENDPOINTS = {
  categoryTree: {
    method: "POST",
    path: "/open-api/goods/query-category-tree",
    requestFields: [],
    responseFields: [
      "category_id",
      "category_name",
      "children",
      "last_category",
      "parent_category_id",
      "product_type_id",
    ],
  },
  attributeTemplate: {
    method: "POST",
    path: "/open-api/goods/query-attribute-template",
    requestFields: ["product_type_id_list"],
    responseFields: [
      "product_type_id",
      "main_attribute_status",
      "attribute_infos",
      "attribute_id",
      "attribute_name",
      "attribute_is_show",
      "attribute_type",
      "attribute_label",
      "attribute_mode",
      "attribute_input_num",
      "attribute_status",
      "attribute_remark_list",
      "attribute_value_info_list",
    ],
  },
  publishStandard: {
    method: "POST",
    path: "/open-api/goods/query-publish-fill-in-standard",
    requestFields: ["category_id"],
    responseFields: [
      "fill_in_standard_list",
      "field_key",
      "module",
      "required",
      "show",
      "currency",
      "default_language",
      "default_language_title_max_length",
      "language_title_max_length_list",
      "picture_config_list",
      "weight_config",
      "length_width_height_config",
      "support_sale_attribute_sort",
    ],
  },
  associatedRules: {
    method: "POST",
    path: "/open-api/goods/get-associated-attribute-rules",
    requestFields: ["get_linked_rule_req_list"],
    responseFields: [
      "group_id",
      "link_rule_attribute_list",
      "attribute_id",
      "attribute_value_list",
      "attribute_value_pre_fill_list",
    ],
  },
  complianceRequirements: {
    method: "POST",
    path: "/open-api/goods-compliance-requirements/list",
    requestFields: [
      "certificateTypeCodes",
      "pageNum",
      "pageSize",
      "reviewStates",
      "skcNames",
    ],
    responseFields: [
      "skcName",
      "items",
      "certificateTypeCode",
      "certificateTypeId",
      "certificateTypeName",
      "complianceGroupCode",
      "isAutoProductWarning",
      "isManualProductWarning",
      "isRequired",
      "reviewState",
    ],
  },
  certificateSchema: {
    method: "POST",
    path: "/open-api/goods-certificate-schemas/detail",
    requestFields: ["certificateTypeCodes", "certificateTypeIdList"],
    responseFields: [
      "certificateTypeInfoList",
      "certificateDimension",
      "certificateLabel",
      "certificateType",
      "certificateTypeId",
      "complianceGroupCode",
      "fileModelUrl",
      "isEnabled",
      "otherPresetInfoList",
      "presetInfoList",
      "inputType",
      "isRequired",
      "presetId",
      "presetName",
      "presetRemark",
      "presetValueList",
      "sourceFrom",
      "unit",
      "srmDetectionAgencyList",
    ],
  },
  certificateSearch: {
    method: "POST",
    path: "/open-api/goods-certificates/search",
    requestFields: [
      "certificateTypeCodeList",
      "fileName",
      "pageNum",
      "pageSize",
      "poolSnList",
      "statusList",
    ],
    responseFields: [
      "poolSn",
      "certificateTypeCode",
      "certificateTypeName",
      "status",
      "certificateDimension",
      "effectiveTime",
      "invalidTime",
      "bindSkcFlag",
      "fileList",
      "presetInfoList",
    ],
  },
  agencyList: {
    method: "POST",
    path: "/open-api/goods-compliance/agency-list",
    requestFields: ["agencyId", "agencyName", "pageNum", "pageSize"],
    responseFields: [
      "agencyId",
      "agencyName",
      "agencyStatus",
      "agencyType",
      "agencySubType",
      "applyStatus",
      "brandCodes",
      "coveredProductRange",
      "agencyStartTime",
      "agencyEndTime",
    ],
  },
  warningRules: {
    method: "POST",
    path: "/open-api/goods-compliance/query-warning-certificate-rules",
    requestFields: [],
    responseFields: [
      "certificateTypeId",
      "certificateTypeCode",
      "certificateTypeName",
      "presetInfo",
      "presetFields",
      "fieldCode",
      "fieldName",
      "fieldType",
      "fieldSort",
      "isEnabled",
      "presetFieldValues",
      "fieldValueId",
      "fieldValue",
      "exclusionFieldValueIds",
      "mappingPaths",
      "valueSort",
    ],
  },
  photoRequirements: {
    method: "POST",
    path: "/open-api/goods-compliance/skc-label-list",
    requestFields: [
      "pageSize",
      "pageNum",
      "skcList",
      "skcShelfStatusList",
      "reviewStatusList",
      "isRequired",
    ],
    responseFields: [
      "skc",
      "skcShelfStatus",
      "skcLabelInfoList",
      "isRequired",
      "labelId",
      "labelName",
      "labelGroup",
      "siteList",
      "reviewStatus",
      "failReason",
    ],
  },
};

export const ATTRIBUTE_STATUS = {
  1: "不可填写",
  2: "选填",
  3: "必填",
};

export const ATTRIBUTE_TYPE = {
  1: "销售属性",
  2: "尺寸属性",
  3: "成分属性",
  4: "普通属性",
};

export const ATTRIBUTE_MODE = {
  0: "手工输入",
  1: "下拉多选",
  2: "销售属性下拉单选",
  3: "下拉单选",
  4: "下拉多选+手工输入",
};

export const COMPLIANCE_GROUPS = {
  ZSZZL: {
    label: "证书资质类",
    supported: true,
    nextEndpoint: "certificateSchema",
  },
  GSL: {
    label: "公司类",
    supported: true,
    nextEndpoint: "agencyList",
  },
  HGXXL: {
    label: "合规信息类",
    supported: "manual-warning-only",
    nextEndpoint: "warningRules",
  },
  SPTL: {
    label: "卖点证书",
    supported: false,
  },
  SPSMS: {
    label: "说明书",
    supported: false,
  },
};

export function flattenLeafCategories(info = {}) {
  const leaves = [];
  const visit = (nodes, path = []) => {
    for (const node of nodes || []) {
      const nextPath = [...path, node.category_name];
      if (node.last_category) {
        leaves.push({
          categoryId: node.category_id,
          productTypeId: node.product_type_id,
          name: node.category_name,
          path: nextPath,
        });
      } else {
        visit(node.children, nextPath);
      }
    }
  };
  visit(info.data);
  return leaves;
}

export function findCategoryTrail(info = {}, categoryId) {
  const target = String(categoryId || "");
  const visit = (nodes, trail = []) => {
    for (const node of nodes || []) {
      const nextTrail = [...trail, node];
      if (String(node.category_id) === target) return nextTrail;
      const match = visit(node.children, nextTrail);
      if (match) return match;
    }
    return null;
  };
  return visit(info.data) || [];
}

export function toCategorySelection(trail = []) {
  const leaf = trail[trail.length - 1];
  if (!leaf?.last_category) return null;
  return {
    categoryId: leaf.category_id,
    productTypeId: leaf.product_type_id,
    name: leaf.category_name,
    path: trail.map((node) => node.category_name),
  };
}

export function buildAttributeFields(info = {}, productTypeId) {
  const productType = (info.data || []).find(
    (item) => String(item.product_type_id) === String(productTypeId),
  );
  return (productType?.attribute_infos || [])
    .filter((attribute) => attribute.attribute_status !== 1)
    .map((attribute) => ({
      id: attribute.attribute_id,
      name: attribute.attribute_name,
      required: attribute.attribute_status === 3,
      status: ATTRIBUTE_STATUS[attribute.attribute_status] || "未知",
      type: ATTRIBUTE_TYPE[attribute.attribute_type] || "未知",
      typeCode: attribute.attribute_type,
      dataDimension: Number(attribute.data_dimension || 0),
      labelCode: attribute.attribute_label,
      mode: ATTRIBUTE_MODE[attribute.attribute_mode] || "未知",
      modeCode: attribute.attribute_mode,
      maxSelections: attribute.attribute_input_num,
      remarks: attribute.attribute_remark_list || [],
      visible: attribute.attribute_is_show !== 0,
      values: (attribute.attribute_value_info_list || [])
        .filter((value) => value.is_show !== 0)
        .map((value) => ({
          id: value.attribute_value_id,
          label: value.attribute_value,
          labelEn: value.attribute_value_en || "",
          custom: Boolean(value.is_custom_attribute_value),
        })),
    }));
}

export function hasAttributeAssignment(value = {}) {
  return Boolean(
    String(value.customValue || "").trim() ||
      (Array.isArray(value.valueIds) && value.valueIds.length),
  );
}

export function validateAttributeAssignments(fields = [], values = {}, perProductIds = []) {
  const perProduct = new Set(perProductIds.map(String));
  const issues = fields
    .filter((field) => field.required)
    .filter(
      (field) =>
        !perProduct.has(String(field.id)) &&
        !hasAttributeAssignment(values[String(field.id)]),
    )
    .map((field) => `必填属性“${field.name}”需要填写模板值或设为单品填写`);
  return { valid: issues.length === 0, issues };
}

export function buildComplianceRequirements(info = {}) {
  return (info.data || []).flatMap((record) =>
    (record.items || []).map((item) => ({
      skcName: record.skcName,
      ...item,
      groupLabel: COMPLIANCE_GROUPS[item.complianceGroupCode]?.label || "未知分组",
      support: resolveComplianceSupport(item),
    })),
  );
}

export function resolveComplianceSupport(requirement = {}) {
  if (requirement.isAutoProductWarning) return "platform-auto";
  if (requirement.isManualProductWarning) return "api";
  const group = COMPLIANCE_GROUPS[requirement.complianceGroupCode];
  return group?.supported === true ? "api" : "unsupported";
}

export function canBindAgency(agency = {}) {
  return agency.agencyStatus === 0 && [1, 2].includes(agency.applyStatus);
}

export function validateTemplateSync(state = {}) {
  const issues = [];
  if (!state.name?.trim()) issues.push("请填写模板名称");
  if (state.syncStatus !== "synced") issues.push("尚未读取SHEIN接口数据");
  if (state.type === "product" && !state.categoryId) issues.push("尚未选择SHEIN末级类目");
  if (state.type === "compliance" && !state.referenceSkc?.trim()) {
    issues.push("尚未填写参照SKC");
  }
  return { valid: issues.length === 0, issues };
}
