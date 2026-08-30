import crypto from "node:crypto";

const PRODUCT_ATTRIBUTE_MODES = new Set([0, 1, 3, 4]);
const REMOTE_CHECKS = [
  "check-publish-permission",
  "goods-publish-quotas/detail",
  "check-supplierSku-repeated",
  "upload-pic",
  "transform-pic",
  "goods-compliance-requirements/list",
];

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function text(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function uniqueStrings(value) {
  return Array.from(
    new Set((Array.isArray(value) ? value : []).map(String).filter(Boolean)),
  );
}

function productFields(data) {
  const snapshot = object(object(data).attributeSchemaSnapshot);
  return (Array.isArray(snapshot.fields) ? snapshot.fields : []).filter(
    (field) =>
      [3, 4].includes(Number(field?.typeCode)) &&
      Number(field?.dataDimension) !== 3,
  );
}

function normalizedAssignments(data) {
  return object(object(data).attributeValues);
}

function assignmentValue(value) {
  const source = object(value);
  return {
    valueIds: uniqueStrings(source.valueIds),
    customValue: text(source.customValue),
  };
}

function fieldMetadataComplete(field) {
  return typeof field?.required === "boolean" &&
    PRODUCT_ATTRIBUTE_MODES.has(Number(field?.modeCode)) &&
    Number.isFinite(Number(field?.maxSelections)) &&
    Array.isArray(field?.values) &&
    Array.isArray(field?.ruleInfoList);
}

function customValueRuleBlocker(field, customValue) {
  for (const rule of field.ruleInfoList) {
    const type = Number(rule?.conditionType);
    const value = text(rule?.value, 100);
    if (type === 1 && !/^[1-9]\d*$/.test(customValue)) {
      return `属性“${field.name}”必须填写正整数`;
    }
    if (type === 4 && !/^(?:0|[1-9]\d*)$/.test(customValue)) {
      return `属性“${field.name}”必须填写自然数`;
    }
    if (type === 3) {
      const decimalPlaces = Number(value);
      const pattern = Number.isInteger(decimalPlaces) && decimalPlaces >= 0
        ? decimalPlaces === 0
          ? /^\d+$/
          : new RegExp(`^\\d+(?:\\.\\d{1,${decimalPlaces}})?$`)
        : null;
      if (!pattern || !pattern.test(customValue)) {
        return `属性“${field.name}”的小数格式不符合SHEIN规则`;
      }
    }
    if (![1, 3, 4].includes(type)) {
      return `属性“${field.name}”的手工输入规则当前无法可靠校验`;
    }
  }
  return "";
}

export function buildAssociatedAttributeRuleRequest(data = {}) {
  const assignments = normalizedAssignments(data);
  return productFields(data).flatMap((field) => {
    const assignment = assignmentValue(assignments[String(field.id)]);
    const allowedValues = new Set(
      (Array.isArray(field.values) ? field.values : [])
        .map((value) => String(value?.id || ""))
        .filter(Boolean),
    );
    const valueIds = assignment.valueIds.filter((valueId) =>
      allowedValues.has(valueId)
    );
    if (valueIds.length) {
      return valueIds.map((attributeValueId) => ({
        attributeId: String(field.id),
        attributeValueId,
      }));
    }
    return assignment.customValue
      ? [{ attributeId: String(field.id) }]
      : [];
  });
}

export function buildProductAttributePreflight({
  data = {},
  categoryId = "",
  productTypeId = "",
  associatedRuleResult = null,
  associatedRuleError = "",
} = {}) {
  const source = object(data);
  const snapshot = object(source.attributeSchemaSnapshot);
  const fields = productFields(source);
  const assignments = normalizedAssignments(source);
  const blockers = [];
  const publishList = [];

  if (!text(snapshot.fetchedAt, 80)) {
    blockers.push({
      code: "ATTRIBUTE_SCHEMA_SNAPSHOT_MISSING",
      message: "缺少当前类目的SHEIN商品属性快照",
    });
  }
  if (
    text(snapshot.categoryId, 100) !== text(categoryId, 100) ||
    text(snapshot.productTypeId, 100) !== text(productTypeId, 100)
  ) {
    blockers.push({
      code: "ATTRIBUTE_SCHEMA_CATEGORY_MISMATCH",
      message: "商品属性快照与当前SHEIN末级类目不一致",
    });
  }
  if (fields.some((field) => !fieldMetadataComplete(field))) {
    blockers.push({
      code: "ATTRIBUTE_SCHEMA_METADATA_MISSING",
      message: "商品属性快照缺少必填状态、录入方式或值规则",
    });
  }

  const knownIds = new Set(fields.map((field) => String(field.id)));
  const sizeAttributeIds = new Set(
    (Array.isArray(object(source.salesSchemaSnapshot).sizeFields)
      ? object(source.salesSchemaSnapshot).sizeFields
      : [])
      .map((field) => String(field?.id || ""))
      .filter(Boolean),
  );
  if (Object.keys(assignments).some((attributeId) => !knownIds.has(attributeId))) {
    blockers.push({
      code: "ATTRIBUTE_ID_INVALID",
      message: "商品属性包含当前SHEIN类目未返回的属性ID",
    });
  }

  const selectedByField = new Map();
  for (const field of fields) {
    if (!fieldMetadataComplete(field)) continue;
    const fieldId = String(field.id);
    const assignment = assignmentValue(assignments[fieldId]);
    const allowedValues = new Set(
      field.values.map((value) => String(value?.id || "")).filter(Boolean),
    );
    const validValueIds = assignment.valueIds.filter((valueId) =>
      allowedValues.has(valueId)
    );
    selectedByField.set(fieldId, new Set(validValueIds));

    if (
      field.required &&
      !assignment.valueIds.length &&
      !assignment.customValue
    ) {
      blockers.push({
        code: "REQUIRED_ATTRIBUTE_MISSING",
        message: `必填属性“${field.name}”未填写`,
        attributeId: fieldId,
      });
    }
    if (assignment.valueIds.some((valueId) => !allowedValues.has(valueId))) {
      blockers.push({
        code: "ATTRIBUTE_VALUE_INVALID",
        message: `属性“${field.name}”包含SHEIN未返回的属性值`,
        attributeId: fieldId,
      });
    }

    const mode = Number(field.modeCode);
    if (assignment.valueIds.length && mode === 0) {
      blockers.push({
        code: "ATTRIBUTE_VALUE_NOT_ALLOWED",
        message: `属性“${field.name}”不允许选择预设值`,
        attributeId: fieldId,
      });
    }
    if (assignment.customValue && [1, 3].includes(mode)) {
      blockers.push({
        code: "ATTRIBUTE_EXTRA_VALUE_NOT_ALLOWED",
        message: `属性“${field.name}”不允许手工输入`,
        attributeId: fieldId,
      });
    }
    if (mode === 3 && assignment.valueIds.length > 1) {
      blockers.push({
        code: "TOO_MANY_ATTRIBUTE_VALUES",
        message: `属性“${field.name}”只能选择1项`,
        attributeId: fieldId,
      });
    } else if (
      Number(field.maxSelections) > 0 &&
      assignment.valueIds.length > Number(field.maxSelections)
    ) {
      blockers.push({
        code: "TOO_MANY_ATTRIBUTE_VALUES",
        message: `属性“${field.name}”最多选择${field.maxSelections}项`,
        attributeId: fieldId,
      });
    }
    if (Number(field.dataDimension) === 2 && mode === 4) {
      if (validValueIds.length !== 1) {
        blockers.push({
          code: "ATTRIBUTE_EXTRA_VALUE_TARGET_REQUIRED",
          message: `属性“${field.name}”必须选择且只能选择1个官方值，并填写对应数字`,
          attributeId: fieldId,
        });
      } else if (!assignment.customValue) {
        blockers.push({
          code: "ATTRIBUTE_EXTRA_VALUE_REQUIRED",
          message: `属性“${field.name}”还需要填写数字附加值`,
          attributeId: fieldId,
        });
      } else if (!/^\d+(?:\.\d+)?$/.test(assignment.customValue)) {
        blockers.push({
          code: "ATTRIBUTE_EXTRA_VALUE_NUMERIC_REQUIRED",
          message: `属性“${field.name}”的附加值必须是数字`,
          attributeId: fieldId,
        });
      } else if (String(field.name).includes("成分") && Number(assignment.customValue) !== 100) {
        blockers.push({
          code: "ATTRIBUTE_COMPOSITION_TOTAL_INVALID",
          message: "成分只有一个材料时，成分百分比必须填写100",
          attributeId: fieldId,
        });
      }
    }
    if (
      mode === 4 &&
      assignment.customValue &&
      assignment.valueIds.length !== 1
    ) {
      blockers.push({
        code: "ATTRIBUTE_EXTRA_VALUE_AMBIGUOUS",
        message: `属性“${field.name}”的手工输入值无法对应到唯一属性值`,
        attributeId: fieldId,
      });
    }
    if (assignment.customValue && field.ruleInfoList.length) {
      const ruleMessage = customValueRuleBlocker(field, assignment.customValue);
      if (ruleMessage) {
        blockers.push({
          code: "ATTRIBUTE_EXTRA_VALUE_RULE_INVALID",
          message: ruleMessage,
          attributeId: fieldId,
        });
      }
    }

    if (mode === 0 && assignment.customValue) {
      publishList.push({
        attribute_id: fieldId,
        attribute_extra_value: assignment.customValue,
      });
    } else {
      validValueIds.forEach((valueId) => {
        publishList.push({
          attribute_id: fieldId,
          attribute_value_id: valueId,
          ...(mode === 4 &&
            assignment.customValue &&
            validValueIds.length === 1
            ? { attribute_extra_value: assignment.customValue }
            : {}),
        });
      });
    }
  }

  const linked = object(associatedRuleResult);
  const associatedRules = Array.isArray(linked.rules) ? linked.rules : [];
  if (!text(linked.checkedAt, 80)) {
    blockers.push({
      code: "ASSOCIATED_RULES_UNAVAILABLE",
      message: text(associatedRuleError) || "服务端尚未完成SHEIN关联属性规则检查",
    });
  } else {
    for (const rule of associatedRules) {
      const attributeId = String(rule?.attribute_id || "");
      if (sizeAttributeIds.has(attributeId)) {
        continue;
      }
      if (!knownIds.has(attributeId)) {
        blockers.push({
          code: "ASSOCIATED_ATTRIBUTE_UNSUPPORTED",
          message: `SHEIN关联规则要求填写尚未接入的属性“${attributeId}”`,
          attributeId,
        });
        continue;
      }
      const allowed = new Set([
        ...(Array.isArray(rule?.attribute_value_list)
          ? rule.attribute_value_list
          : []),
        ...(Array.isArray(rule?.attribute_value_pre_fill_list)
          ? rule.attribute_value_pre_fill_list
          : []),
      ].map(String));
      const assignment = assignmentValue(assignments[attributeId]);
      const selected = selectedByField.get(attributeId) || new Set();
      const hasAssignment = assignment.customValue || selected.size > 0;
      if (
        !hasAssignment ||
        (allowed.size > 0 && ![...selected].some((valueId) => allowed.has(valueId)))
      ) {
        const field = fields.find((item) => String(item.id) === attributeId);
        blockers.push({
          code: "ASSOCIATED_ATTRIBUTE_REQUIRED",
          message: `SHEIN关联规则要求补充“${field?.name || attributeId}”`,
          attributeId,
        });
      }
    }
  }

  return {
    checkedAt: text(snapshot.fetchedAt, 80),
    associatedRulesCheckedAt: text(linked.checkedAt, 80),
    associatedRulesTraceId: text(linked.traceId, 160),
    blockers,
    publishPreview: {
      product_attribute_list: publishList,
    },
  };
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

export function productPublishCandidateFingerprint(candidate = {}) {
  const source = object(candidate);
  return fingerprint({
    requestBody: source.requestBody,
    pendingImageUploads: Array.isArray(source.pendingImageUploads)
      ? source.pendingImageUploads
      : [],
    audit: object(source.audit),
    remoteChecks: Array.isArray(source.remoteChecks)
      ? source.remoteChecks
      : [],
    postPublishCompliancePhotos: object(source.postPublishCompliancePhotos),
  });
}

function postPublishCompliancePhotos(compliance) {
  const source = object(compliance?.postPublishPhotos);
  const normalize = (value) => (Array.isArray(value) ? value : [])
    .map((photo) => ({
      assetId: text(photo?.assetId || photo?.localAssetRef, 200),
      name: text(photo?.name || photo?.fileName, 200),
    }))
    .filter((photo) => photo.assetId);
  return {
    package: normalize(source.package),
    body: normalize(source.body),
  };
}

export function verifyProductPublishCandidate(candidate = {}) {
  const source = object(candidate);
  return source.state === "ready_for_remote_preflight" &&
    Boolean(text(source.fingerprint, 64)) &&
    source.requestBody &&
    typeof source.requestBody === "object" &&
    text(source.fingerprint, 64) === productPublishCandidateFingerprint(source);
}

function sectionBlockers(preflight, source) {
  const section = object(object(preflight)[source]);
  if (!Object.keys(section).length) {
    return [{
      source,
      code: "PREFLIGHT_SECTION_MISSING",
      message: `缺少${source}服务端预检结果`,
    }];
  }
  return (Array.isArray(section.blockers) ? section.blockers : []).map(
    (blocker) => ({
      source,
      code: text(blocker?.code, 100) || "PREFLIGHT_BLOCKED",
      message: text(blocker?.message) || `${source}预检未通过`,
    }),
  );
}

export function buildProductPublishCandidate({
  data = {},
  categoryId = "",
  productTypeId = "",
  preflight = {},
  generatedAt = new Date().toISOString(),
} = {}) {
  const trusted = object(preflight);
  const sectionNames = [
    "attributes",
    "content",
    "images",
    "sku",
    "publishSettings",
    "compliance",
  ];
  const blockers = sectionNames.flatMap((source) =>
    sectionBlockers(trusted, source)
  );
  const rugReport = object(trusted.rugReport);
  const postPublishTasks = (Array.isArray(object(trusted.compliance).postPublishTasks)
    ? object(trusted.compliance).postPublishTasks
    : []).map((task) => ({
      source: "compliance",
      code: text(task?.code, 100) || "POST_PUBLISH_COMPLIANCE_PENDING",
      message: text(task?.message) || "SKC生成后需处理合规任务",
    }));
  const rugTasks = [];
  if (
    !rugTasks.length &&
    !["1630", "1631"].includes(String(rugReport.reportType || "")) &&
    !postPublishTasks.some((task) => [
      "WAITING_FOR_SHEIN_REPORT_REQUIREMENT",
      "RUG_REPORT_NOT_CLASSIFIED",
    ].includes(task.code))
  ) {
    postPublishTasks.push({
      source: "rugReport",
      code: "RUG_REPORT_UNRESOLVED",
      message: "SKC生成后读取SHEIN要求并处理1630/1631报告与日期",
    });
  }

  const compliancePhotos = postPublishCompliancePhotos(trusted.compliance);

  const base = {
    version: 1,
    endpoint: "/open-api/goods/product/publishOrEdit",
    generatedAt: text(generatedAt, 80),
    state: blockers.length ? "blocked" : "ready_for_remote_preflight",
    publishingEnabled: false,
    blockers,
    postPublishTasks,
    postPublishCompliancePhotos: compliancePhotos,
    remoteChecks: REMOTE_CHECKS,
  };
  if (blockers.length) {
    return {
      ...base,
      fingerprint: "",
      requestBody: null,
      pendingImageUploads: [],
      requiresSkcComplianceReadback: true,
    };
  }

  const source = object(data);
  const attributes = object(trusted.attributes);
  const content = object(trusted.content);
  const images = object(trusted.images);
  const sku = object(trusted.sku);
  const settings = object(trusted.publishSettings);
  const compliance = object(trusted.compliance);
  const rootSettings = object(object(settings.payload).root);
  const skcSettings = object(object(settings.payload).skc);
  const contentPreview = object(content.publishPreview);
  const attributePreview = object(attributes.publishPreview);
  const skuPreview = object(sku.publishPreview);
  const skc = object(skuPreview.skc);
  const requestBody = {
    category_id: text(categoryId, 100),
    product_type_id: text(productTypeId, 100),
    source_system: "OpenAPI",
    suit_flag: 0,
    is_spu_pic: images.scheme === "new-spu",
    supplier_code: text(source.supplierCode, 200),
    ...rootSettings,
    multi_language_name_list: Array.isArray(
      contentPreview.multi_language_name_list,
    ) ? contentPreview.multi_language_name_list : [],
    ...(Array.isArray(contentPreview.multi_language_desc_list) &&
      contentPreview.multi_language_desc_list.length
      ? {
          multi_language_desc_list:
            contentPreview.multi_language_desc_list,
        }
      : {}),
    product_attribute_list: Array.isArray(
      attributePreview.product_attribute_list,
    ) ? attributePreview.product_attribute_list : [],
    ...(Array.isArray(skuPreview.size_attribute_list) &&
      skuPreview.size_attribute_list.length
      ? { size_attribute_list: skuPreview.size_attribute_list }
      : {}),
    skc_list: [{
      ...skc,
      ...skcSettings,
    }],
  };
  const pendingImageUploads = [
    ...(Array.isArray(images.uploads) ? images.uploads : []).map((upload) => ({
      source: "product",
      ...upload,
    })),
    ...(Array.isArray(skuPreview.pendingImageUploads)
      ? skuPreview.pendingImageUploads
      : []).map((upload) => ({
        source: "sku",
        ...upload,
      })),
  ];
  const audit = {
    categoryId: text(categoryId, 100),
    productTypeId: text(productTypeId, 100),
    attributeSchemaFetchedAt: text(attributes.checkedAt, 80),
    associatedRulesCheckedAt: text(
      attributes.associatedRulesCheckedAt,
      80,
    ),
    associatedRulesTraceId: text(attributes.associatedRulesTraceId, 160),
    publishStandardFetchedAt: text(settings.checkedAt, 80),
    imageRulesFetchedAt: text(images.checkedAt, 80),
    salesSchemaFetchedAt: text(sku.checkedAt, 80),
    complianceRulesFetchedAt: text(compliance.checkedAt, 80),
    rugReportType: String(rugReport.reportType),
  };
  return {
    ...base,
    fingerprint: productPublishCandidateFingerprint({
      requestBody,
      pendingImageUploads,
      postPublishCompliancePhotos: compliancePhotos,
      audit,
      remoteChecks: REMOTE_CHECKS,
    }),
    requestBody,
    pendingImageUploads,
    requiresSkcComplianceReadback:
      compliance.requiresSkcRevalidation === true,
    audit,
  };
}
