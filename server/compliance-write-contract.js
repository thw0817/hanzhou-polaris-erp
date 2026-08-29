export const SHEIN_COMPLIANCE_WRITE_PATHS = Object.freeze({
  certificateUpload: "/open-api/goods-certificate-files/upload",
  certificateSave: "/open-api/goods-certificates/save",
  certificateBind: "/open-api/goods-certificates/bind",
  agencyBind: "/open-api/goods-compliance/save-skc-agency",
  warningUpdate:
    "/open-api/goods-compliance/update-skc-warning-certificate",
  photoUpload:
    "/open-api/goods-compliance/upload-skc-label-picture",
  photoBind: "/open-api/goods-compliance/skc-save-label",
});

export const SHEIN_CERTIFICATE_MAX_BYTES = 20 * 1024 * 1024;
export const SHEIN_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export const SHEIN_CERTIFICATE_BIND_BATCH_SIZE = 400;
export const SHEIN_PHOTO_MAX_COUNT_PER_SKC = 15;

export const SHEIN_CERTIFICATE_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
]);

export const SHEIN_COMPLIANCE_PHOTO_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
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

function requiredText(value, name) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new TypeError(`${name} is required`);
  return normalized;
}

function requiredInteger(value, name) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized)) {
    throw new TypeError(`${name} must be an integer`);
  }
  return normalized;
}

function uniqueStrings(values, name) {
  const normalized = Array.from(
    new Set(
      asArray(values)
        .map((value) => String(value ?? "").trim())
        .filter(Boolean),
    ),
  );
  if (!normalized.length) throw new TypeError(`${name} is required`);
  return normalized;
}

function officialId(value, name) {
  if (value === null || value === undefined || value === "") {
    throw new TypeError(`${name} is required`);
  }
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && String(numeric) === String(value)
    ? numeric
    : value;
}

function enabledSchemaFields(schema = {}) {
  return [
    ...asArray(schema.presetInfoList),
    ...asArray(schema.otherPresetInfoList),
  ].filter((field) => Number(field.isEnabled ?? 1) === 1);
}

function schemaOptionById(field = {}, valueId) {
  return asArray(field.presetValueList).find(
    (option) => String(option.presetValueId) === String(valueId),
  );
}

function normalizeExplicitValueList(valueList, presetId) {
  if (!Array.isArray(valueList) || !valueList.length) {
    throw new TypeError(`preset ${presetId} valueList is required`);
  }
  return valueList.map((item) => {
    const source = asObject(item);
    const result = {};
    if (source.valueId !== undefined && source.valueId !== null) {
      result.valueId = officialId(
        source.valueId,
        `preset ${presetId} valueId`,
      );
    }
    if (source.value !== undefined && source.value !== null) {
      result.value = source.value;
    }
    if (!Object.keys(result).length) {
      throw new TypeError(
        `preset ${presetId} valueList item must contain valueId or value`,
      );
    }
    return result;
  });
}

function buildSchemaFieldValueList(field, input) {
  const source = asObject(input);
  if (Array.isArray(source.valueList)) {
    return normalizeExplicitValueList(source.valueList, field.presetId);
  }

  if (String(field.sourceFrom || "").toUpperCase() === "SRM") {
    return [
      {
        valueId: officialId(
          source.detectionAgencyId ?? source.agencyId,
          `preset ${field.presetId} detectionAgencyId`,
        ),
        value: officialId(
          source.laboratoryId ?? source.labId,
          `preset ${field.presetId} laboratoryId`,
        ),
      },
    ];
  }

  const inputType = Number(field.inputType);
  if ([1, 2, 5, 6].includes(inputType)) {
    const ids = asArray(source.valueIds ?? source.presetValueIds);
    if (!ids.length) {
      throw new TypeError(`preset ${field.presetId} valueIds is required`);
    }
    return ids.map((valueId) => {
      const option = schemaOptionById(field, valueId);
      if (!option) {
        throw new TypeError(
          `preset ${field.presetId} contains an unknown SHEIN valueId`,
        );
      }
      return {
        valueId: officialId(
          option.presetValueId,
          `preset ${field.presetId} valueId`,
        ),
      };
    });
  }

  if ([3, 4].includes(inputType)) {
    if (!hasText(source.value)) {
      throw new TypeError(`preset ${field.presetId} value is required`);
    }
    const value = String(source.value).trim();
    if (inputType === 4) {
      const matched = value.match(/^(\d{4}-\d{2}-\d{2})(?:\s+00:00:00)?$/);
      if (!matched || Number.isNaN(Date.parse(`${matched[1]}T00:00:00Z`))) {
        throw new TypeError(
          `preset ${field.presetId} date must use YYYY-MM-DD`,
        );
      }
      return [{ value: `${matched[1]} 00:00:00` }];
    }
    return [{ value }];
  }

  throw new TypeError(
    `preset ${field.presetId} uses an unsupported inputType`,
  );
}

export function buildCertificatePresetInfoList({
  schema = {},
  fieldValues = {},
} = {}) {
  const values = asObject(fieldValues);
  const result = [];
  for (const field of enabledSchemaFields(schema)) {
    const input = values[String(field.presetId)];
    if (input === undefined || input === null) {
      if (Number(field.isRequired) === 1) {
        throw new TypeError(`preset ${field.presetId} is required`);
      }
      continue;
    }
    result.push({
      presetId: requiredInteger(field.presetId, "presetId"),
      valueList: buildSchemaFieldValueList(field, input),
    });
  }
  return result;
}

export function buildCertificateUploadRequest({
  fileName,
  mimeType,
  size,
} = {}) {
  const normalizedFileName = requiredText(fileName, "fileName");
  if (!SHEIN_CERTIFICATE_MIME_TYPES.has(mimeType)) {
    throw new TypeError("certificate file must be PDF, PNG, JPG or JPEG");
  }
  const normalizedSize = requiredInteger(size, "size");
  if (normalizedSize <= 0) throw new TypeError("size must be positive");
  if (normalizedSize > SHEIN_CERTIFICATE_MAX_BYTES) {
    throw new TypeError("certificate file exceeds SHEIN 20MB limit");
  }
  return {
    method: "POST",
    path: SHEIN_COMPLIANCE_WRITE_PATHS.certificateUpload,
    multipartField: "file",
    fileName: normalizedFileName,
    mimeType,
    size: normalizedSize,
  };
}

export function buildCertificateSaveBody({
  certificateTypeCode,
  certificateDimension,
  poolSn = "",
  fileList = [],
  presetInfoList = [],
} = {}) {
  const normalizedFileList = asArray(fileList).map((file) => ({
    fileUrl: requiredText(file?.fileUrl, "fileList.fileUrl"),
    fileMd5: requiredText(file?.fileMd5, "fileList.fileMd5"),
    fileName: requiredText(file?.fileName, "fileList.fileName"),
  }));
  const normalizedPresetInfoList = asArray(presetInfoList).map((field) => ({
    presetId: requiredInteger(field?.presetId, "presetInfoList.presetId"),
    valueList: normalizeExplicitValueList(
      field?.valueList,
      field?.presetId,
    ),
  }));
  return {
    certificateTypeCode: requiredText(
      certificateTypeCode,
      "certificateTypeCode",
    ),
    certificateDimension: requiredInteger(
      certificateDimension,
      "certificateDimension",
    ),
    poolSn: String(poolSn ?? ""),
    fileList: normalizedFileList,
    presetInfoList: normalizedPresetInfoList,
  };
}

export function buildCertificateBindBody({ poolSn, skcNames } = {}) {
  const normalizedSkcNames = uniqueStrings(skcNames, "skcNames");
  if (normalizedSkcNames.length > SHEIN_CERTIFICATE_BIND_BATCH_SIZE) {
    throw new TypeError("certificate bind supports at most 400 SKCs");
  }
  return {
    poolSn: requiredText(poolSn, "poolSn"),
    skcNames: normalizedSkcNames,
  };
}

export function parseCertificateSaveResponse(payload = {}) {
  const source = asObject(payload);
  const info = asObject(source.info);
  if (String(source.code ?? "") !== "0") {
    throw new TypeError(source.msg || "certificate save failed");
  }
  if (String(info.code ?? "") !== "0") {
    throw new TypeError(info.failMsg || "certificate save failed");
  }
  return {
    poolSn: requiredText(info.poolSn, "info.poolSn"),
    existPoolSnList: asArray(info.existPoolSnList).map((value) => String(value)),
    traceId: hasText(source.traceId) ? String(source.traceId) : null,
  };
}

export function parseCertificateBindResponse(payload = {}) {
  const source = asObject(payload);
  if (String(source.code ?? "") !== "0") {
    throw new TypeError(source.msg || "certificate bind failed");
  }
  const info = asObject(source.info);
  if (info.code !== undefined && String(info.code) !== "0") {
    throw new TypeError(info.failMsg || info.msg || "certificate bind failed");
  }
  return {
    info,
    traceId: hasText(source.traceId) ? String(source.traceId) : null,
  };
}

export function parsePhotoBindResponse(payload = {}) {
  const source = asObject(payload);
  if (String(source.code ?? "") !== "0") {
    throw new TypeError(source.msg || "photo bind failed");
  }
  const info = asObject(source.info);
  const faildCount = Number(info.faildCount || 0);
  const successCount = Number(info.successCount || 0);
  const faildList = asArray(info.faildList).map((item) => ({
    skc: String(item?.skc || ""),
    code: String(item?.code || ""),
    reason: String(item?.reason || ""),
  }));
  if (faildCount > 0 || successCount < 1) {
    throw new TypeError(
      faildList[0]?.reason || "photo bind did not return a successful task",
    );
  }
  return {
    totalCount: Number(info.totalCount || successCount + faildCount),
    successCount,
    faildCount,
    faildList,
    traceId: hasText(source.traceId) ? String(source.traceId) : null,
  };
}

export function buildAgencyBindBody({
  agencyId,
  agencyType,
  skc,
} = {}) {
  const result = {
    skc: uniqueStrings(skc, "skc"),
    agencyId: officialId(agencyId, "agencyId"),
  };
  if (agencyType !== undefined && agencyType !== null && agencyType !== "") {
    result.agencyType = requiredInteger(agencyType, "agencyType");
  }
  return result;
}

function warningFields(rules = {}) {
  return asArray(rules.presetInfo?.presetFields)
    .filter((field) => Number(field.isEnabled ?? 1) === 1)
    .sort((left, right) => Number(left.fieldSort) - Number(right.fieldSort));
}

function enabledWarningValueMap(field = {}) {
  return new Map(
    asArray(field.presetFieldValues)
      .filter((value) => Number(value.isEnabled ?? 1) === 1)
      .map((value) => [String(value.fieldValueId), value]),
  );
}

export function buildWarningUpdateBody({
  certificateTypeCode,
  skcNames,
  rules,
  selectedByField = {},
} = {}) {
  const fields = warningFields(rules);
  if (!fields.length) throw new TypeError("warning rules are required");
  const warningField = fields[fields.length - 1];
  const normalizedSelections = {};
  const selectedRegularIds = new Set();

  for (const field of fields) {
    const valueMap = enabledWarningValueMap(field);
    const selected = Array.from(
      new Set(
        asArray(selectedByField?.[field.fieldCode]).map((value) =>
          String(value),
        ),
      ),
    );
    for (const valueId of selected) {
      if (!valueMap.has(valueId)) {
        throw new TypeError(
          `warning field ${field.fieldCode} contains an unknown valueId`,
        );
      }
      if (field !== warningField) selectedRegularIds.add(valueId);
    }
    normalizedSelections[field.fieldCode] = selected;
  }

  const warningValues = enabledWarningValueMap(warningField);
  for (const [valueId, value] of warningValues.entries()) {
    const required = asArray(value.mappingPaths).some((mappingPath) =>
      asArray(mappingPath.fieldValueIds).some((regularId) =>
        selectedRegularIds.has(String(regularId)),
      ),
    );
    if (
      required &&
      !normalizedSelections[warningField.fieldCode].includes(valueId)
    ) {
      normalizedSelections[warningField.fieldCode].push(valueId);
    }
  }

  return {
    certificateTypeCode: requiredText(
      certificateTypeCode,
      "certificateTypeCode",
    ),
    skcNames: uniqueStrings(skcNames, "skcNames"),
    fieldList: fields.map((field) => ({
      fieldCode: requiredText(field.fieldCode, "fieldCode"),
      fieldValues: normalizedSelections[field.fieldCode].map((valueId) => ({
        fieldValueId: officialId(valueId, "fieldValueId"),
      })),
    })),
  };
}

export function buildPhotoUploadRequest({
  fileName,
  mimeType,
  size,
  width,
  height,
} = {}) {
  const normalizedFileName = requiredText(fileName, "fileName");
  if (!SHEIN_COMPLIANCE_PHOTO_MIME_TYPES.has(mimeType)) {
    throw new TypeError("compliance photo must be PNG, JPG or JPEG");
  }
  const normalizedSize = requiredInteger(size, "size");
  const normalizedWidth = requiredInteger(width, "width");
  const normalizedHeight = requiredInteger(height, "height");
  if (normalizedSize <= 0) throw new TypeError("size must be positive");
  if (normalizedSize > SHEIN_PHOTO_MAX_BYTES) {
    throw new TypeError("compliance photo exceeds SHEIN 10MB limit");
  }
  if (
    normalizedWidth <= 0 ||
    normalizedHeight <= 0 ||
    normalizedWidth > 8000 ||
    normalizedHeight > 8000
  ) {
    throw new TypeError(
      "compliance photo width and height must be within 8000px",
    );
  }
  return {
    method: "POST",
    path: SHEIN_COMPLIANCE_WRITE_PATHS.photoUpload,
    multipartField: "file",
    fileName: normalizedFileName,
    mimeType,
    size: normalizedSize,
    width: normalizedWidth,
    height: normalizedHeight,
  };
}

function normalizePhotoBindList(values, name) {
  return asArray(values).map((photo) => ({
    imageUrl: requiredText(photo?.imageUrl, `${name}.imageUrl`),
    imageMd5: requiredText(photo?.imageMd5, `${name}.imageMd5`),
  }));
}

export function buildPhotoBindBody({
  skcList,
  packageLableList,
  bodyLableList,
} = {}) {
  const normalizedPackagePhotos = normalizePhotoBindList(
    packageLableList,
    "packageLableList",
  );
  const normalizedBodyPhotos = normalizePhotoBindList(
    bodyLableList,
    "bodyLableList",
  );
  if (!normalizedPackagePhotos.length && !normalizedBodyPhotos.length) {
    throw new TypeError("packageLableList or bodyLableList is required");
  }
  return {
    skcList: uniqueStrings(skcList, "skcList"),
    ...(normalizedPackagePhotos.length
      ? { packageLableList: normalizedPackagePhotos }
      : {}),
    ...(normalizedBodyPhotos.length
      ? { bodyLableList: normalizedBodyPhotos }
      : {}),
  };
}
