const ATTRIBUTE_MODE = {
  0: "手工输入",
  1: "多选",
  3: "单选",
  4: "选择或手工输入",
};
const ATTRIBUTE_REMARK = {
  1: "重要",
  2: "合规",
  3: "质量",
  4: "关务",
};

export function attributeTemplatePaths(storeId, templateId = "") {
  const store = encodeURIComponent(String(storeId));
  const templates = `/v1/web/stores/${store}/publish-templates`;
  return {
    categories: `/v1/web/stores/${store}/publish/categories`,
    schema: `/v1/web/stores/${store}/publish/schema`,
    schemaCoverage: `/v1/web/stores/${store}/publish/schema-coverage`,
    schemaSync: `/v1/web/stores/${store}/publish/schema-sync`,
    associatedRules: `/v1/web/stores/${store}/publish/associated-rules`,
    templates: `${templates}?type=attribute`,
    template: templateId
      ? `${templates}/${encodeURIComponent(String(templateId))}`
      : templates,
  };
}

export function normalizeCategoryTree(info = {}) {
  const normalize = (nodes) => (nodes || [])
    .map((node) => ({
      categoryId: String(node.category_id || ""),
      productTypeId: String(node.product_type_id || ""),
      name: String(node.category_name || node.category_id || ""),
      lastCategory: Boolean(node.last_category),
      children: normalize(node.children),
    }))
    .filter((node) => node.categoryId);

  return normalize(info.data);
}

export function flattenLeafCategories(info = {}) {
  const leaves = [];
  const visit = (nodes, path = []) => {
    for (const node of nodes) {
      const nextPath = [...path, node.name];
      if (node.lastCategory) {
        leaves.push({
          categoryId: node.categoryId,
          productTypeId: node.productTypeId,
          name: node.name,
          path: nextPath,
        });
      } else {
        visit(node.children, nextPath);
      }
    }
  };
  visit(normalizeCategoryTree(info));
  return leaves.filter((item) => item.categoryId && item.productTypeId);
}

export function buildAttributeFields(info = {}, productTypeId) {
  const productType = (info.data || []).find(
    (item) => String(item.product_type_id) === String(productTypeId),
  );
  return (productType?.attribute_infos || [])
    .filter((attribute) =>
      attribute.attribute_status !== 1 &&
      attribute.attribute_is_show !== 0 &&
      [3, 4].includes(Number(attribute.attribute_type)) &&
      Number(attribute.data_dimension) !== 3
    )
    .map((attribute) => ({
      id: String(attribute.attribute_id || ""),
      name: String(attribute.attribute_name || attribute.attribute_id || ""),
      required: Number(attribute.attribute_status) === 3,
      typeCode: Number(attribute.attribute_type),
      dataDimension: Number(attribute.data_dimension || 0),
      modeCode: Number(attribute.attribute_mode),
      mode: ATTRIBUTE_MODE[Number(attribute.attribute_mode)] || "按平台规则填写",
      maxSelections: Number(attribute.attribute_input_num || 0),
      remarks: Array.isArray(attribute.attribute_remark_list)
        ? attribute.attribute_remark_list.map(
          (remark) => ATTRIBUTE_REMARK[Number(remark)] || String(remark),
        )
        : [],
      values: (attribute.attribute_value_info_list || [])
        .filter((value) => value.is_show !== 0)
        .map((value) => ({
          id: String(value.attribute_value_id || ""),
          label: String(value.attribute_value || value.attribute_value_id || ""),
        }))
        .filter((value) => value.id),
      ruleInfoList: (attribute.rule_info_list || []).map((rule) => ({
        id: String(rule.id || ""),
        conditionType: Number(rule.condition_type || 0),
        conditionOperator: Number(rule.condition_operator || 0),
        value: String(rule.value || ""),
      })),
    }))
    .filter((field) => field.id);
}

export function isCompositionPercentageField(field = {}) {
  return Number(field.dataDimension) === 2 &&
    Number(field.modeCode) === 4 &&
    /成分|composition/i.test(String(field.name || ""));
}

export function validateAttributeAssignments(fields = [], assignments = {}) {
  const missing = [];
  const invalid = [];
  const missingReasons = {};
  fields.forEach((field) => {
    const assignment = assignments[String(field.id)] || {};
    const valueIds = Array.isArray(assignment.valueIds) ? assignment.valueIds : [];
    const customValue = String(assignment.customValue || "").trim();
    if (field.required && !valueIds.length && !customValue) {
      missing.push(field);
      missingReasons[String(field.id)] = "必填属性未填写";
      return;
    }
    // SHEIN 的 data_dimension=2 / mode=4 不是普通下拉：必须是“一个官方值 + 数字附加值”。
    if (Number(field.dataDimension) === 2 && Number(field.modeCode) === 4) {
      if (valueIds.length !== 1 || !customValue) {
        invalid.push(field);
        missingReasons[String(field.id)] = valueIds.length
          ? "选择官方值后还需要填写数字附加值"
          : "请选择一个官方值并填写数字附加值";
      }
    }
  });
  return {
    missingFieldIds: missing.map((field) => String(field.id)),
    missingFieldNames: missing.map((field) => field.name),
    invalidFieldIds: invalid.map((field) => String(field.id)),
    invalidFieldNames: invalid.map((field) => field.name),
    missingReasons,
  };
}
