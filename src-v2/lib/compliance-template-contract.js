function object(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function text(value, maxLength) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function requiredState(value, fallback) {
  const number = Number(value);
  if ([0, 1, 10].includes(number)) return number;
  return fallback === true ? 1 : fallback === false ? 0 : 10;
}

function isPerSkcCertificate(value) {
  const identity = [
    value.certificateTypeCode,
    value.certificateTypeName,
    value.certificateType,
    value.name,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return identity.includes("1630") ||
    identity.includes("1631") ||
    identity.includes("smallcarpet") ||
    identity.includes("largecarpet");
}

function requirementName(record, data) {
  return text(
    data.certificateTypeName ||
      data.labelName ||
      data.complianceGroupName ||
      record.requirementKey,
    200,
  );
}

function requirementReusable(type, data) {
  if (type === "certificate") return isPerSkcCertificate(data);
  if (type === "package_photo" || type === "body_photo") {
    return ["1", "2"].includes(String(data.labelGroup || ""));
  }
  return false;
}

function cleanStringArray(value, maxItems = 100) {
  return Array.from(
    new Set(
      (Array.isArray(value) ? value : [])
        .map((item) => text(item, 200))
        .filter(Boolean),
    ),
  ).slice(0, maxItems);
}

export function complianceTemplatePaths(storeId, templateId = "") {
  const store = encodeURIComponent(String(storeId));
  const templates = `/v1/web/stores/${store}/publish-templates`;
  return {
    templates: `${templates}?type=compliance`,
    template: templateId
      ? `${templates}/${encodeURIComponent(String(templateId))}`
      : templates,
  };
}

export function buildComplianceTemplateCatalog(records = []) {
  return (Array.isArray(records) ? records : []).map((record) => {
    const data = object(record?.data);
    const type = text(record?.requirementType, 40) || "unsupported";
    const certificateTypeId = data.certificateTypeId ?? null;
    const certificateTypeCode = text(data.certificateTypeCode, 100);
    const labelId = data.labelId == null ? null : text(data.labelId, 40);
    return {
      key: text(
        record?.requirementKey ||
          certificateTypeCode ||
          certificateTypeId ||
          labelId,
        160,
      ),
      type,
      name: requirementName(record || {}, data),
      certificateTypeId,
      certificateTypeCode,
      complianceGroupCode: text(data.complianceGroupCode, 40),
      labelId,
      labelGroup: text(data.labelGroup, 20),
      isManualProductWarning: data.isManualProductWarning === true,
      isAutoProductWarning: data.isAutoProductWarning === true,
      isRequired: requiredState(data.isRequired, record?.required),
      reviewState: data.reviewState == null ? null : Number(data.reviewState),
      siteList: cleanStringArray(data.siteList),
      reusable: requirementReusable(type, data),
    };
  });
}

function cleanCertificate(assignment) {
  const value = object(assignment);
  return {
    certificateTypeId: value.certificateTypeId ?? null,
    certificateTypeCode: text(value.certificateTypeCode, 100),
    certificateTypeName: text(value.certificateTypeName, 200),
    certificateDimension: value.certificateDimension ?? null,
    poolSn: text(value.poolSn, 160),
    status: Number.isFinite(Number(value.status)) ? Number(value.status) : null,
    files: (Array.isArray(value.files) ? value.files : []).flatMap((file) => {
      const item = object(file);
      const localAssetRef = text(item.localAssetRef || item.localAssetId, 200);
      if (!localAssetRef || /^data:/i.test(localAssetRef)) return [];
      return [{
        localAssetRef,
        fileName: text(item.fileName, 200),
        mimeType: text(item.mimeType, 100),
        size: Math.max(0, Number(item.size) || 0),
      }];
    }),
    fieldValues: Object.fromEntries(
      Object.entries(object(value.fieldValues)).map(([fieldId, fieldValue]) => {
        const item = object(fieldValue);
        return [
          text(fieldId, 100),
          {
            valueIds: cleanStringArray(item.valueIds),
            value: text(item.value, 500),
            detectionAgencyId: text(item.detectionAgencyId, 160),
            laboratoryId: text(item.laboratoryId, 160),
          },
        ];
      }).filter(([fieldId]) => fieldId),
    ),
  };
}

function cleanPhoto(assignment) {
  const value = object(assignment);
  const localAssetRef = text(value.localAssetRef || value.localAssetId, 200);
  if (!localAssetRef || /^data:/i.test(localAssetRef)) return null;
  return {
    labelId: text(value.labelId, 40),
    labelGroup: text(value.labelGroup, 20),
    labelName: text(value.labelName, 200),
    localAssetRef,
    fileName: text(value.fileName, 200),
    mimeType: text(value.mimeType, 100),
    size: Math.max(0, Number(value.size) || 0),
    width: Number.isFinite(Number(value.width)) ? Number(value.width) : null,
    height: Number.isFinite(Number(value.height)) ? Number(value.height) : null,
    templateReusable: true,
  };
}

function catalogIdentity(item) {
  return [
    item.certificateTypeId,
    item.certificateTypeCode,
    item.labelId,
    item.key,
  ].map((value) => String(value ?? "")).find(Boolean) || "";
}

function assignmentIdentity(item) {
  return [
    item.certificateTypeId,
    item.certificateTypeCode,
    item.labelId,
  ].map((value) => String(value ?? "")).find(Boolean) || "";
}

function cleanDefaults(defaults, catalog) {
  const value = object(defaults);
  const photoCounts = new Map();
  const photos = (Array.isArray(value.photos) ? value.photos : [])
    .map(cleanPhoto)
    .filter(Boolean)
    .filter((item) => ["1", "2"].includes(item.labelGroup))
    .filter((item) => {
      const currentCount = photoCounts.get(item.labelGroup) || 0;
      const maxCount = item.labelGroup === "2" ? 2 : 1;
      if (currentCount >= maxCount) return false;
      photoCounts.set(item.labelGroup, currentCount + 1);
      return true;
    });
  return { certificates: [], agencies: [], warnings: [], photos };
}

function hasPhotoDefault(defaults, item) {
  return defaults.photos.some((assignment) =>
    assignment.labelGroup === String(item.labelGroup) &&
    Boolean(assignment.localAssetRef)
  );
}

function reportRuleIdentity(value) {
  return String(
    value?.certificateTypeId ??
    value?.certificateTypeCode ??
    value?.key ??
    "",
  );
}

function fieldValueComplete(field, value) {
  const item = object(value);
  if (String(field?.sourceFrom || "").toUpperCase() === "SRM") {
    return Boolean(item.detectionAgencyId && item.laboratoryId);
  }
  if ([1, 2, 5, 6].includes(Number(field?.inputType))) {
    return cleanStringArray(item.valueIds).length > 0;
  }
  return Boolean(text(item.value, 500));
}

export function validateComplianceTemplateDraft(input = {}) {
  const catalog = Array.isArray(input.catalog) ? input.catalog : [];
  const reportRules = Array.isArray(input.reportRules) ? input.reportRules : [];
  const defaults = cleanDefaults(input.defaults, catalog);
  const errors = { requirements: [] };
  const name = text(input.name, 80);
  const photoOnly = defaults.photos.length > 0;

  if (!name) errors.name = "请填写模板名称";
  if (!photoOnly) errors.requirements.push("至少上传一张通用实拍图");

  return {
    valid: !errors.name &&
      errors.requirements.length === 0,
    errors,
    data: {
      name,
      catalog,
      defaults,
    },
  };
}
