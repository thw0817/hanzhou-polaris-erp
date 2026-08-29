const REVIEW_STATE = Object.freeze({
  missing: 0,
  reviewing: 1,
  passed: 2,
  rejected: 3,
});

const PHOTO_REVIEW_STATE = Object.freeze({
  missing: 0,
  reviewing: 1,
  passed: 2,
  rejected: 3,
});

const SUPPORTED_GROUPS = new Set(["ZSZZL", "GSL"]);
const RULE_BLOCKER_CODES = new Set([
  "REQUIREMENTS_NOT_SYNCED",
  "PHOTO_REQUIREMENTS_NOT_SYNCED",
  "REQUIREMENT_STATE_UNKNOWN",
  "PHOTO_REQUIREMENT_STATE_UNKNOWN",
  "RULE_SNAPSHOT_MISSING",
  "RULE_SNAPSHOT_STALE",
]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function hasText(value) {
  return String(value ?? "").trim().length > 0;
}

function uniqueStrings(values) {
  return Array.from(
    new Set(asArray(values).map((value) => String(value)).filter(Boolean)),
  );
}

function requirementKey(requirement = {}) {
  if (requirement.labelId != null) {
    return `${requirement.labelId}:${String(requirement.labelGroup || "")}`;
  }
  return String(
    requirement.certificateTypeCode ||
      requirement.certificateTypeId ||
      "",
  );
}

function findAssignment(assignments, requirement) {
  const key = requirementKey(requirement);
  return asArray(assignments).find(
    (assignment) => requirementKey(assignment) === key,
  );
}

function addIssue(target, code, message, extra = {}) {
  target.push({ code, message, ...extra });
}

function enabledPresetFields(schema = {}) {
  return [
    ...asArray(schema.presetInfoList),
    ...asArray(schema.otherPresetInfoList),
  ].filter((field) => Number(field.isEnabled ?? 1) === 1);
}

function normalizeFieldValue(input) {
  if (Array.isArray(input)) return { valueIds: input, value: "" };
  if (input && typeof input === "object") {
    return {
      valueIds: asArray(input.valueIds || input.presetValueIds),
      value: input.value ?? input.customValue ?? "",
      agencyId:
        input.agencyId ?? input.detectionAgencyId ?? input.responsiblePersonId,
      laboratoryId: input.laboratoryId ?? input.labId,
    };
  }
  return { valueIds: [], value: input ?? "" };
}

function validDateValue(value) {
  if (!hasText(value)) return false;
  return !Number.isNaN(Date.parse(String(value)));
}

export function expectedAgencyType(requirement = {}) {
  const code = String(requirement.certificateTypeCode || "").toLowerCase();
  if (code === "eurespperson") return 0;
  if (code === "ukrespperson") return 1;
  if (code === "usrespperson") return 2;
  if (code === "manufacturer") return 3;
  if (code === "turespperson") return 4;
  return null;
}

export function isPerSkcFlammabilityCertificate(requirement = {}) {
  const identity = [
    requirement.certificateTypeCode,
    requirement.certificateTypeName,
    requirement.certificateType,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return (
    identity.includes("1630") ||
    identity.includes("1631") ||
    identity.includes("smallcarpet") ||
    identity.includes("largecarpet")
  );
}

function findPhotoAssignment(assignments, requirement) {
  const exact = findAssignment(assignments, requirement);
  if (exact) return exact;
  const labelGroup = String(requirement.labelGroup || "");
  if (!["1", "2"].includes(labelGroup)) return null;
  return asArray(assignments).find(
    (assignment) =>
      assignment.templateReusable === true &&
      String(assignment.labelGroup || "") === labelGroup,
  );
}

export function validateCertificateAssignment({
  requirement = {},
  assignment = {},
} = {}) {
  const blockers = [];
  const warnings = [];
  const typeName =
    requirement.certificateTypeName ||
    requirement.certificateTypeCode ||
    "资质证书";

  if (hasText(assignment.poolSn)) {
    if (Number(assignment.status) !== 2) {
      addIssue(
        blockers,
        "CERTIFICATE_NOT_EFFECTIVE",
        `${typeName}选择的证书当前不是“生效”状态`,
      );
    }
    return {
      valid: blockers.length === 0,
      blockers,
      warnings,
      mode:
        Number(assignment.certificateDimension) === 2
          ? "store_certificate"
          : "bind_existing",
    };
  }

  const schema = asObject(assignment.schema);
  if (!Object.keys(schema).length) {
    addIssue(
      blockers,
      "CERTIFICATE_SCHEMA_REQUIRED",
      `${typeName}尚未读取证书Schema`,
    );
    return { valid: false, blockers, warnings, mode: "create" };
  }
  if (Number(schema.isEnabled ?? 1) !== 1) {
    addIssue(
      blockers,
      "CERTIFICATE_SCHEMA_DISABLED",
      `${typeName}的证书Schema已被SHEIN停用`,
    );
  }
  if (Number(schema.certificateLabel ?? 0) !== 0) {
    addIssue(
      blockers,
      "CERTIFICATE_LABEL_UNSUPPORTED",
      `${typeName}不是当前API支持创建的普通证书类型`,
    );
  }
  const schemaTypeId = String(schema.certificateTypeId || "");
  if (
    schemaTypeId &&
    requirement.certificateTypeId != null &&
    schemaTypeId !== String(requirement.certificateTypeId)
  ) {
    addIssue(
      blockers,
      "CERTIFICATE_SCHEMA_MISMATCH",
      `${typeName}的Schema与当前合规要求不匹配`,
    );
  }

  if (!asArray(assignment.files).length) {
    addIssue(
      blockers,
      "CERTIFICATE_FILE_REQUIRED",
      `${typeName}缺少待上传的证书文件`,
    );
  }

  const fieldValues = asObject(assignment.fieldValues);
  for (const field of enabledPresetFields(schema)) {
    if (Number(field.isRequired) !== 1) continue;
    const value = normalizeFieldValue(fieldValues[String(field.presetId)]);
    const fieldName = field.presetRemark || field.presetName || field.presetId;
    const inputType = Number(field.inputType);

    if (String(field.sourceFrom || "").toUpperCase() === "SRM") {
      const agency = asArray(assignment.trustedSrmAgencies).find(
        (item) => String(item.detectionAgencyId) === String(value.agencyId),
      );
      const laboratory = asArray(agency?.laboratories).find(
        (item) => String(item.laboratoryId) === String(value.laboratoryId),
      );
      if (!agency || !laboratory) {
        addIssue(
          blockers,
          "CERTIFICATE_SRM_SELECTION_INVALID",
          `${typeName}的“${fieldName}”必须选择当前规则中的检测机构和实验室`,
          { presetId: field.presetId },
        );
      }
      continue;
    }

    if (inputType === 1 && value.valueIds.length !== 1) {
      addIssue(
        blockers,
        "CERTIFICATE_SINGLE_VALUE_REQUIRED",
        `${typeName}的“${fieldName}”必须选择1个SHEIN字段值`,
        { presetId: field.presetId },
      );
    } else if (inputType === 2 && value.valueIds.length === 0) {
      addIssue(
        blockers,
        "CERTIFICATE_MULTI_VALUE_REQUIRED",
        `${typeName}的“${fieldName}”至少选择1个SHEIN字段值`,
        { presetId: field.presetId },
      );
    } else if (inputType === 3 && !hasText(value.value)) {
      addIssue(
        blockers,
        "CERTIFICATE_TEXT_REQUIRED",
        `${typeName}的“${fieldName}”尚未填写`,
        { presetId: field.presetId },
      );
    } else if (inputType === 4 && !validDateValue(value.value)) {
      addIssue(
        blockers,
        "CERTIFICATE_DATE_REQUIRED",
        `${typeName}的“${fieldName}”需要有效日期`,
        { presetId: field.presetId },
      );
    } else if (inputType === 5 && value.valueIds.length === 0) {
      addIssue(
        blockers,
        "CERTIFICATE_WARNING_REQUIRED",
        `${typeName}的“${fieldName}”缺少警告语值`,
        { presetId: field.presetId },
      );
    } else if (
      inputType === 6 &&
      value.valueIds.length === 0 &&
      !hasText(value.agencyId)
    ) {
      addIssue(
        blockers,
        "CERTIFICATE_RESPONSIBLE_PERSON_REQUIRED",
        `${typeName}的“${fieldName}”缺少欧盟责任人平台ID`,
        { presetId: field.presetId },
      );
    }
    if ([1, 2, 5, 6].includes(inputType) && value.valueIds.length) {
      const enabledValueIds = new Set(
        asArray(field.presetValueList)
          .filter((option) => Number(option.isEnabled ?? 1) === 1)
          .map((option) => String(option.presetValueId)),
      );
      const invalidValueIds = value.valueIds
        .map(String)
        .filter((valueId) => !enabledValueIds.has(valueId));
      if (invalidValueIds.length) {
        addIssue(
          blockers,
          "CERTIFICATE_VALUE_INVALID",
          `${typeName}的“${fieldName}”包含已停用或不存在的SHEIN字段值`,
          { presetId: field.presetId, valueIds: invalidValueIds },
        );
      }
    }
  }

  return {
    valid: blockers.length === 0,
    blockers,
    warnings,
    mode: "create",
  };
}

export function validateAgencyAssignment({
  requirement = {},
  assignment = {},
} = {}) {
  const blockers = [];
  const warnings = [];
  const typeName =
    requirement.certificateTypeName ||
    requirement.certificateTypeCode ||
    "代理公司";
  if (!hasText(assignment.agencyId)) {
    addIssue(
      blockers,
      "AGENCY_REQUIRED",
      `${typeName}尚未选择SHEIN代理公司/责任人`,
    );
  }
  if (Number(assignment.agencyStatus) !== 0) {
    addIssue(
      blockers,
      "AGENCY_DISABLED",
      `${typeName}选择的代理公司已停用或状态未知`,
    );
  }
  if (![1, 2].includes(Number(assignment.applyStatus))) {
    addIssue(
      blockers,
      "AGENCY_NOT_APPROVED",
      `${typeName}选择的代理公司尚未通过可绑定审核`,
    );
  }
  const requiredAgencyType = expectedAgencyType(requirement);
  if (
    requiredAgencyType !== null &&
    Number(assignment.agencyType) !== requiredAgencyType
  ) {
    addIssue(
      blockers,
      "AGENCY_TYPE_MISMATCH",
      `${typeName}选择的代理公司类型与当前要求不匹配`,
      {
        expectedAgencyType: requiredAgencyType,
        actualAgencyType: assignment.agencyType ?? null,
      },
    );
  }
  if (Number(assignment.coveredProductRange) === 1) {
    addIssue(
      warnings,
      "AGENCY_STORE_WIDE",
      `${typeName}已声明覆盖全部商品，应先回查平台自动绑定结果`,
    );
  }
  return {
    valid: blockers.length === 0,
    blockers,
    warnings,
    mode:
      Number(assignment.coveredProductRange) === 1
        ? "store_wide"
        : "bind",
  };
}

export function validateWarningAssignment({
  requirement = {},
  assignment = {},
} = {}) {
  const blockers = [];
  const warnings = [];
  const rules = asObject(assignment.rules);
  const fields = asArray(rules.presetInfo?.presetFields)
    .filter((field) => Number(field.isEnabled ?? 1) === 1)
    .sort((left, right) => Number(left.fieldSort) - Number(right.fieldSort));
  const typeName =
    requirement.certificateTypeName ||
    requirement.certificateTypeCode ||
    "手动警告语";

  if (!fields.length) {
    addIssue(
      blockers,
      "WARNING_RULES_REQUIRED",
      `${typeName}尚未读取动态填写规则`,
    );
    return {
      valid: false,
      blockers,
      warnings,
      selectedByField: {},
      requiredWarningValueIds: [],
    };
  }
  if (
    rules.certificateTypeCode &&
    requirement.certificateTypeCode &&
    rules.certificateTypeCode !== requirement.certificateTypeCode
  ) {
    addIssue(
      blockers,
      "WARNING_RULES_MISMATCH",
      `${typeName}的动态规则与当前合规要求不匹配`,
    );
  }

  const selectedByField = asObject(assignment.selectedByField);
  const warningField = fields[fields.length - 1];
  const regularFields = fields.slice(0, -1);
  const selectedRegularIds = new Set();
  const regularValueById = new Map();

  for (const field of regularFields) {
    const enabledValues = asArray(field.presetFieldValues).filter(
      (value) => Number(value.isEnabled ?? 1) === 1,
    );
    for (const value of enabledValues) {
      regularValueById.set(String(value.fieldValueId), value);
    }
    const enabledIds = new Set(
      enabledValues.map((value) => String(value.fieldValueId)),
    );
    const selected = uniqueStrings(selectedByField[field.fieldCode]);
    const invalid = selected.filter((valueId) => !enabledIds.has(valueId));
    if (invalid.length) {
      addIssue(
        blockers,
        "WARNING_VALUE_INVALID",
        `${typeName}的“${field.fieldName}”包含已禁用或不存在的值`,
        { fieldCode: field.fieldCode, fieldValueIds: invalid },
      );
    }
    if (Number(field.fieldType) === 1 && selected.length > 1) {
      addIssue(
        blockers,
        "WARNING_SINGLE_VALUE_ONLY",
        `${typeName}的“${field.fieldName}”只能选择1个值`,
        { fieldCode: field.fieldCode },
      );
    }
    for (const valueId of selected) selectedRegularIds.add(valueId);
  }
  for (const valueId of selectedRegularIds) {
    const value = regularValueById.get(valueId);
    const conflicts = uniqueStrings(value?.exclusionFieldValueIds).filter(
      (conflictId) => selectedRegularIds.has(conflictId),
    );
    if (conflicts.length) {
      addIssue(
        blockers,
        "WARNING_VALUES_CONFLICT",
        `${typeName}选择了互斥字段值`,
        { fieldValueId: valueId, conflictingFieldValueIds: conflicts },
      );
    }
  }

  const enabledWarningValues = asArray(warningField.presetFieldValues).filter(
    (value) => Number(value.isEnabled ?? 1) === 1,
  );
  const enabledWarningIds = new Set(
    enabledWarningValues.map((value) => String(value.fieldValueId)),
  );
  const selectedWarningIds = new Set(
    uniqueStrings(selectedByField[warningField.fieldCode]).filter((valueId) => {
      if (enabledWarningIds.has(valueId)) return true;
      addIssue(
        blockers,
        "WARNING_VALUE_INVALID",
        `${typeName}包含已禁用或不存在的警告语值`,
        { fieldCode: warningField.fieldCode, fieldValueIds: [valueId] },
      );
      return false;
    }),
  );
  const requiredWarningValueIds = enabledWarningValues
    .filter((warningValue) =>
      asArray(warningValue.mappingPaths).some((path) =>
        uniqueStrings(path.fieldValueIds).some((valueId) =>
          selectedRegularIds.has(valueId),
        ),
      ),
    )
    .map((value) => String(value.fieldValueId));

  for (const valueId of requiredWarningValueIds) {
    selectedWarningIds.add(valueId);
  }
  if (!selectedWarningIds.size) {
    addIssue(
      blockers,
      "WARNING_SELECTION_REQUIRED",
      `${typeName}尚未形成可提交的警告语`,
      { fieldCode: warningField.fieldCode },
    );
  }

  return {
    valid: blockers.length === 0,
    blockers,
    warnings,
    selectedByField: {
      ...selectedByField,
      [warningField.fieldCode]: Array.from(selectedWarningIds),
    },
    requiredWarningValueIds,
  };
}

function mergeInputs(template, skc, explicitInput) {
  const defaults = asObject(template?.defaults);
  const templateInput = asObject(template?.assignmentsBySkc?.[skc]);
  return {
    ...defaults,
    ...templateInput,
    ...asObject(explicitInput),
  };
}

function action(type, requirement, payload = {}) {
  return {
    type,
    requirementKey: requirementKey(requirement),
    certificateTypeCode: requirement.certificateTypeCode || null,
    certificateTypeId: requirement.certificateTypeId ?? null,
    ...payload,
  };
}

export function buildSkcCompliancePreflight({
  row = {},
  template = null,
  input = {},
  now = Date.now(),
  maxRuleAgeMs = 24 * 60 * 60 * 1000,
} = {}) {
  const blockers = [];
  const warnings = [];
  const actions = [];
  const waiting = [];
  const skc = String(row.skc || row.id || "");

  if (!row.sourceCoverage?.requirementsReturned) {
    addIssue(
      blockers,
      "REQUIREMENTS_NOT_SYNCED",
      "商品合规要求尚未从SHEIN完整同步",
    );
  }
  if (!row.sourceCoverage?.photoRequirementsReturned) {
    addIssue(
      blockers,
      "PHOTO_REQUIREMENTS_NOT_SYNCED",
      "实拍图要求尚未从SHEIN完整同步",
    );
  }
  const snapshotAt = template?.ruleSnapshotAt || template?.validatedAt;
  if (template && !snapshotAt) {
    addIssue(
      blockers,
      "RULE_SNAPSHOT_MISSING",
      "合规模板缺少SHEIN规则快照时间，提交前必须重新读取参照SKC",
    );
  }
  if (
    snapshotAt &&
    Number.isFinite(maxRuleAgeMs) &&
    now - Date.parse(snapshotAt) > maxRuleAgeMs
  ) {
    addIssue(
      blockers,
      "RULE_SNAPSHOT_STALE",
      "合规模板规则快照已超过24小时，提交前必须重新同步",
    );
  }

  const certificateAssignments = asArray(input.certificates);
  const agencyAssignments = asArray(input.agencies);
  const warningAssignments = asArray(input.warnings);
  const photoAssignments = asArray(input.photos);
  const requirements = [
    ...asArray(row.certificateRequirements),
    ...asArray(row.agencyRequirements),
    ...asArray(row.warningRequirements),
  ];

  for (const requirement of requirements) {
    const required = Number(requirement.isRequired) === 1;
    const reviewState = Number(requirement.reviewState);
    if (Number(requirement.isRequired) === 10) {
      addIssue(
        blockers,
        "REQUIREMENT_STATE_UNKNOWN",
        `${requirement.certificateTypeName || "合规要求"}处于瞬时未知状态`,
        { requirementKey: requirementKey(requirement) },
      );
      continue;
    }
    if (reviewState === REVIEW_STATE.passed) continue;
    if (reviewState === REVIEW_STATE.reviewing) {
      waiting.push({
        type: "requirement",
        requirementKey: requirementKey(requirement),
        name: requirement.certificateTypeName || "",
      });
      continue;
    }
    if (!required && reviewState !== REVIEW_STATE.rejected) continue;

    if (requirement.complianceGroupCode === "ZSZZL") {
      const assignment = findAssignment(certificateAssignments, requirement);
      if (!assignment) {
        addIssue(
          blockers,
          "CERTIFICATE_ASSIGNMENT_REQUIRED",
          `${requirement.certificateTypeName || "证书"}缺少证书资料或证书库绑定`,
          { requirementKey: requirementKey(requirement) },
        );
        continue;
      }
      if (isPerSkcFlammabilityCertificate(requirement)) {
        if (String(assignment.skc || "") !== skc) {
          addIssue(
            blockers,
            "CERTIFICATE_PER_SKC_UPLOAD_REQUIRED",
            `${requirement.certificateTypeName || "1630/1631检测报告"}必须由当前SKC单独上传`,
            { requirementKey: requirementKey(requirement), skc },
          );
          continue;
        }
        if (hasText(assignment.poolSn)) {
          addIssue(
            blockers,
            "CERTIFICATE_POOL_REUSE_NOT_ALLOWED",
            `${requirement.certificateTypeName || "1630/1631检测报告"}不能从通用证书池复用`,
            { requirementKey: requirementKey(requirement), skc },
          );
          continue;
        }
        const uploadedFiles = asArray(assignment.files);
        if (
          !uploadedFiles.length ||
          uploadedFiles.some(
            (file) =>
              !hasText(file.fileUrl) ||
              !hasText(file.fileMd5) ||
              !hasText(file.fileName),
          )
        ) {
          addIssue(
            blockers,
            "CERTIFICATE_DIRECT_UPLOAD_REQUIRED",
            `${requirement.certificateTypeName || "1630/1631检测报告"}必须先通过SHEIN证书文件接口完成直传`,
            { requirementKey: requirementKey(requirement), skc },
          );
          continue;
        }
      }
      const result = validateCertificateAssignment({ requirement, assignment });
      blockers.push(...result.blockers);
      warnings.push(...result.warnings);
      if (result.valid) {
        if (result.mode === "store_certificate") {
          actions.push(action("certificate.recheck_store_scope", requirement));
        } else if (result.mode === "bind_existing") {
          actions.push(
            action("certificate.bind_existing", requirement, {
              poolSn: assignment.poolSn,
            }),
          );
        } else {
          actions.push(
            action("certificate.create_and_bind", requirement, {
              certificateDimension:
                assignment.certificateDimension ??
                assignment.schema?.certificateDimension ??
                null,
              schema: assignment.schema,
              files: asArray(assignment.files),
              fieldValues: asObject(assignment.fieldValues),
            }),
          );
        }
      }
    } else if (requirement.complianceGroupCode === "GSL") {
      const assignment = findAssignment(agencyAssignments, requirement);
      if (!assignment) {
        addIssue(
          blockers,
          "AGENCY_ASSIGNMENT_REQUIRED",
          `${requirement.certificateTypeName || "代理公司"}缺少平台代理公司选择`,
          { requirementKey: requirementKey(requirement) },
        );
        continue;
      }
      const result = validateAgencyAssignment({ requirement, assignment });
      blockers.push(...result.blockers);
      warnings.push(...result.warnings);
      if (result.valid) {
        actions.push(
          action(
            result.mode === "store_wide"
              ? "agency.recheck_store_scope"
              : "agency.bind",
            requirement,
            {
              agencyId: assignment.agencyId,
              agencyType: assignment.agencyType ?? null,
            },
          ),
        );
      }
    } else if (
      requirement.complianceGroupCode === "HGXXL" &&
      requirement.isManualProductWarning === true
    ) {
      const assignment = findAssignment(warningAssignments, requirement);
      if (!assignment) {
        addIssue(
          blockers,
          "WARNING_ASSIGNMENT_REQUIRED",
          `${requirement.certificateTypeName || "手动警告语"}尚未填写`,
          { requirementKey: requirementKey(requirement) },
        );
        continue;
      }
      const result = validateWarningAssignment({ requirement, assignment });
      blockers.push(...result.blockers);
      warnings.push(...result.warnings);
      if (result.valid) {
        actions.push(
          action("warning.update", requirement, {
            selectedByField: result.selectedByField,
            autoMappedWarningValueIds: result.requiredWarningValueIds,
            rules: assignment.rules,
          }),
        );
      }
    }
  }

  for (const requirement of asArray(row.unsupportedRequirements)) {
    const unresolved =
      Number(requirement.reviewState) !== REVIEW_STATE.passed &&
      (Number(requirement.isRequired) === 1 ||
        Number(requirement.reviewState) === REVIEW_STATE.rejected);
    if (!unresolved) continue;
    addIssue(
      blockers,
      "API_UNSUPPORTED_REQUIREMENT",
      `${requirement.certificateTypeName || requirement.complianceGroupCode || "合规项"}当前开放平台不支持写入，请到SHEIN商品合规管理后台处理`,
      {
        requirementKey: requirementKey(requirement),
        complianceGroupCode: requirement.complianceGroupCode || null,
        certificateTypeCode: requirement.certificateTypeCode || null,
        handlingMode: "shein_backstage_only",
      },
    );
  }

  const photoRequirements = [
    ...asArray(row.bodyPhotoRequirements),
    ...asArray(row.packagePhotoRequirements),
  ];
  for (const requirement of photoRequirements) {
    if (Number(requirement.isRequired) === 10) {
      addIssue(
        blockers,
        "PHOTO_REQUIREMENT_STATE_UNKNOWN",
        `${requirement.labelName || "实拍图要求"}处于瞬时未知状态`,
        { labelId: requirement.labelId },
      );
      continue;
    }
    const reviewStatus = Number(requirement.reviewStatus);
    if (
      reviewStatus === PHOTO_REVIEW_STATE.reviewing ||
      reviewStatus === PHOTO_REVIEW_STATE.passed
    ) {
      continue;
    }
    if (
      Number(requirement.isRequired) !== 1 &&
      reviewStatus !== PHOTO_REVIEW_STATE.rejected
    ) {
      continue;
    }
    const assignment = findPhotoAssignment(photoAssignments, requirement);
    if (
      !assignment ||
      (!hasText(assignment.localAssetRef) &&
        !hasText(assignment.uploadedPictureId))
    ) {
      addIssue(
        blockers,
        "PHOTO_ASSIGNMENT_REQUIRED",
        `${requirement.labelName || "合规实拍图"}缺少当前SKC的真实图片`,
        { labelId: requirement.labelId, labelGroup: requirement.labelGroup },
      );
      continue;
    }
    actions.push({
      type: "photo.upload_and_bind",
      requirementKey: requirementKey(requirement),
      labelId: requirement.labelId,
      labelGroup: String(requirement.labelGroup || ""),
      localAssetRef: assignment.localAssetRef || null,
      uploadedPictureId: assignment.uploadedPictureId || null,
      fileName: assignment.fileName || null,
      mimeType: assignment.mimeType || null,
      size: assignment.size ?? null,
      width: assignment.width ?? null,
      height: assignment.height ?? null,
    });
  }

  let status = "compliant";
  if (blockers.length) {
    status = blockers.every((item) => RULE_BLOCKER_CODES.has(item.code))
      ? "rules_pending"
      : "blocked";
  } else if (actions.length) {
    status = "ready";
  } else if (waiting.length) {
    status = "waiting_review";
  }

  return {
    skc,
    status,
    executable: status === "ready",
    actions,
    blockers,
    warnings,
    waiting,
    counts: {
      actions: actions.length,
      blockers: blockers.length,
      warnings: warnings.length,
      waiting: waiting.length,
    },
  };
}

export function buildCompliancePreflight({
  rows = [],
  template = null,
  inputsBySkc = {},
  now = Date.now(),
  maxRuleAgeMs,
} = {}) {
  const plans = asArray(rows).map((row) =>
    buildSkcCompliancePreflight({
      row,
      template,
      input: mergeInputs(template, row.skc, inputsBySkc?.[row.skc]),
      now,
      maxRuleAgeMs,
    }),
  );
  const statusCounts = plans.reduce((counts, plan) => {
    counts[plan.status] = (counts[plan.status] || 0) + 1;
    return counts;
  }, {});
  return {
    dryRun: true,
    executable:
      plans.some((plan) => plan.status === "ready") &&
      plans.every((plan) => ["ready", "compliant"].includes(plan.status)),
    plans,
    summary: {
      total: plans.length,
      ready: statusCounts.ready || 0,
      compliant: statusCounts.compliant || 0,
      waitingReview: statusCounts.waiting_review || 0,
      rulesPending: statusCounts.rules_pending || 0,
      blocked: statusCounts.blocked || 0,
      actionCount: plans.reduce(
        (total, plan) => total + plan.actions.length,
        0,
      ),
      blockerCount: plans.reduce(
        (total, plan) => total + plan.blockers.length,
        0,
      ),
    },
  };
}
