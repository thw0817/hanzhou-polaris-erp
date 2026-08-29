import crypto from "node:crypto";

const TEMPLATE_TYPES = new Set([
  "attribute",
  "title_rule",
  "commercial",
  "publish_settings",
  "size",
  "packaging",
  "tail_image",
  "compliance",
]);

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class PublishTemplateError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "PublishTemplateError";
    this.code = code;
    this.status = status;
  }
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function text(value, max = 200) {
  return String(value || "").trim().slice(0, max);
}

function positive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function normalizeSizeLabel(value) {
  return text(value, 120).replace(/^\s*(\d+)\s*(?:件|个)\s*/u, "$1pc ");
}

function validIsoDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day;
}

function validateTailImages(data) {
  const sourceIds = Array.isArray(data.assetIds) ? data.assetIds : [];
  const assetIds = [...new Set(sourceIds.map(String).filter(Boolean))];
  if (!assetIds.length) {
    throw new PublishTemplateError("INVALID_IMAGE_TEMPLATE", "尾部主图模板至少需要一张图片");
  }
  const sourceAssets = Array.isArray(data.assets) ? data.assets : [];
  const assetsById = new Map(
    sourceAssets.map((asset) => [String(asset?.id || ""), asset]),
  );
  const assets = assetIds.map((id) => {
    const asset = object(assetsById.get(id));
    const crop = object(asset.crop);
    return {
      id,
      storeId: text(asset.storeId, 100),
      originalName: text(asset.originalName, 200),
      contentType: text(asset.contentType, 100),
      width: positiveInteger(asset.width),
      height: positiveInteger(asset.height),
      crop: {
        mode: crop.mode === "cropped" ? "cropped" : "original",
        presetId: crop.presetId === "portrait" ? "portrait" : "square",
        sourceWidth: positiveInteger(crop.sourceWidth),
        sourceHeight: positiveInteger(crop.sourceHeight),
        outputWidth: positiveInteger(crop.outputWidth),
        outputHeight: positiveInteger(crop.outputHeight),
      },
    };
  });
  return { placement: "append", assetIds, assets };
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

function requirementIdentity(value) {
  return [
    value.certificateTypeId,
    value.certificateTypeCode,
    value.labelId,
    value.key,
  ].map((item) => String(item ?? "")).find(Boolean) || "";
}

function sanitizeComplianceRequirements(value) {
  return (Array.isArray(value) ? value : []).map((requirement) => {
    const item = object(requirement);
    const required = Number(item.isRequired);
    const type = text(item.type, 40) || "unsupported";
    const labelGroup = text(item.labelGroup, 20);
    return {
      key: text(item.key, 160),
      type,
      name: text(item.name, 200),
      certificateTypeId: item.certificateTypeId ?? null,
      certificateTypeCode: text(item.certificateTypeCode, 100),
      complianceGroupCode: text(item.complianceGroupCode, 40),
      labelId: item.labelId == null ? null : text(item.labelId, 40),
      labelGroup,
      isManualProductWarning: item.isManualProductWarning === true,
      isAutoProductWarning: item.isAutoProductWarning === true,
      isRequired: [0, 1, 10].includes(required) ? required : 10,
      reviewState: item.reviewState == null ? null : Number(item.reviewState),
      siteList: cleanStringArray(item.siteList),
      reusable: type === "certificate"
        ? isPerSkcCertificate(item)
        : ["package_photo", "body_photo"].includes(type) &&
          ["1", "2"].includes(labelGroup),
    };
  });
}

function sanitizeComplianceDefaults(value, requirements) {
  const defaults = object(value);
  const reportRequirements = new Map(
    requirements
      .filter((item) =>
        item.type === "certificate" &&
        item.reusable &&
        isPerSkcCertificate(item)
      )
      .map((item) => [requirementIdentity(item), item]),
  );
  const certificates = (Array.isArray(defaults.certificates)
    ? defaults.certificates
    : []).flatMap((assignment) => {
      const item = object(assignment);
      const rule = reportRequirements.get(requirementIdentity(item));
      if (!rule || !isPerSkcCertificate(item)) return [];
      return [{
        certificateTypeId: item.certificateTypeId ?? null,
        certificateTypeCode: text(item.certificateTypeCode, 100),
        certificateTypeName: text(item.certificateTypeName, 200),
        certificateDimension: item.certificateDimension ?? null,
        poolSn: text(item.poolSn, 160),
        status: Number.isFinite(Number(item.status)) ? Number(item.status) : null,
        files: (Array.isArray(item.files) ? item.files : []).flatMap((file) => {
          const entry = object(file);
          const localAssetRef = text(
            entry.localAssetRef || entry.localAssetId,
            200,
          );
          if (!localAssetRef || /^data:/i.test(localAssetRef)) return [];
          return [{
            localAssetRef,
            fileName: text(entry.fileName, 200),
            mimeType: text(entry.mimeType, 100),
            size: Math.max(0, Number(entry.size) || 0),
          }];
        }),
        fieldValues: Object.fromEntries(
          Object.entries(object(item.fieldValues)).map(([fieldId, fieldValue]) => {
            const entry = object(fieldValue);
            return [
              text(fieldId, 100),
              {
                valueIds: cleanStringArray(entry.valueIds),
                value: text(entry.value, 500),
                detectionAgencyId: text(entry.detectionAgencyId, 160),
                laboratoryId: text(entry.laboratoryId, 160),
              },
            ];
          }).filter(([fieldId]) => fieldId),
        ),
      }];
    });
  const photoCandidates = (Array.isArray(defaults.photos)
    ? defaults.photos
    : []).flatMap((assignment) => {
      const item = object(assignment);
      const labelId = text(item.labelId, 40);
      const labelGroup = text(item.labelGroup, 20);
      const localAssetRef = text(item.localAssetRef || item.localAssetId, 200);
      if (
        !["1", "2"].includes(labelGroup) ||
        !localAssetRef ||
        /^data:/i.test(localAssetRef)
      ) {
        return [];
      }
      return [{
        labelId,
        labelGroup,
        labelName: text(item.labelName, 200),
        localAssetRef,
        fileName: text(item.fileName, 200),
        mimeType: text(item.mimeType, 100),
        size: Math.max(0, Number(item.size) || 0),
        width: Number.isFinite(Number(item.width)) ? Number(item.width) : null,
        height: Number.isFinite(Number(item.height)) ? Number(item.height) : null,
        templateReusable: true,
      }];
    })
    .filter((item, index, items) => {
      const key = `${item.labelGroup}:${item.localAssetRef}`;
      return items.findIndex((candidate) =>
        `${candidate.labelGroup}:${candidate.localAssetRef}` === key
      ) === index;
    })
  const photoCounts = new Map();
  // labelGroup === "2" allows two package photos; labelGroup === "1" allows one body photo.
  const photos = photoCandidates.filter((item) => {
    const group = String(item.labelGroup || "");
    const limit = group === "2" ? 2 : group === "1" ? 1 : 0;
    const count = photoCounts.get(group) || 0;
    if (count >= limit) return false;
    photoCounts.set(group, count + 1);
    return true;
  });
  return { certificates, agencies: [], warnings: [], photos };
}

function validateCompliance(data) {
  if (text(data.templateKind, 40) === "rug_report") {
    const reportType = text(data.reportType, 10);
    const reportDate = text(data.reportDate, 20);
    const sourceFile = object(data.reportFile);
    const localAssetRef = text(
      sourceFile.localAssetRef || sourceFile.localAssetId,
      200,
    );
    if (!["1630", "1631"].includes(reportType)) {
      throw new PublishTemplateError(
        "INVALID_RUG_REPORT_TYPE",
        "报告模板必须选择1630或1631",
      );
    }
    if (!validIsoDate(reportDate)) {
      throw new PublishTemplateError(
        "INVALID_RUG_REPORT_DATE",
        "报告模板必须填写有效的报告日期",
      );
    }
    if (!/^media:[^\s]+$/i.test(localAssetRef)) {
      throw new PublishTemplateError(
        "INVALID_RUG_REPORT_FILE",
        "报告模板必须上传受保护的报告文件",
      );
    }
    const reportFile = {
      localAssetRef,
      fileName: text(sourceFile.fileName, 200),
      mimeType: text(sourceFile.mimeType, 100),
      size: Math.max(0, Number(sourceFile.size) || 0),
    };
    const certificateTypeCode = `RugReport${reportType}`;
    return {
      templateKind: "rug_report",
      reportType,
      reportDate,
      reportFile,
      requirements: [],
      defaults: {
        certificates: [{
          certificateTypeId: null,
          certificateTypeCode,
          certificateTypeName: `16 CFR ${reportType} 检测报告`,
          certificateDimension: null,
          poolSn: "",
          status: null,
          files: [reportFile],
          fieldValues: {},
        }],
        agencies: [],
        warnings: [],
        photos: [],
      },
      storeScoped: true,
      revalidateOnUse: true,
    };
  }
  const requirements = sanitizeComplianceRequirements(
    data.requirements || data.catalog,
  );
  return {
    requirements,
    defaults: sanitizeComplianceDefaults(data.defaults, requirements),
    storeScoped: true,
    revalidateOnUse: true,
  };
}

function complianceMediaAssetIds(data) {
  const source = object(data);
  const refs = [
    source.reportFile?.localAssetRef,
    ...(Array.isArray(source.defaults?.certificates)
      ? source.defaults.certificates.flatMap((certificate) =>
          Array.isArray(certificate?.files)
            ? certificate.files.map((file) => file?.localAssetRef)
            : [],
        )
      : []),
    ...(Array.isArray(source.defaults?.photos)
      ? source.defaults.photos.map((photo) => photo?.localAssetRef)
      : []),
  ];
  return Array.from(new Set(refs.flatMap((reference) => {
    const match = /^media:([^\s]+)$/i.exec(String(reference || "").trim());
    return match ? [match[1]] : [];
  })));
}

function fingerprint(input) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");
}

function validatePackaging(data) {
  const materials = object(data.materials);
  const materialNames = Object.keys(materials);
  if (!materialNames.length) {
    throw new PublishTemplateError("INVALID_PACKAGING_TEMPLATE", "打包体积表没有可用材质");
  }
  let recordCount = 0;
  let overwrittenCount = Number(data.overwrittenCount || 0);
  const normalizedMaterials = {};
  for (const material of materialNames) {
    const rows = Array.isArray(materials[material]) ? materials[material] : [];
    if (!rows.length) {
      throw new PublishTemplateError("INVALID_PACKAGING_TEMPLATE", `${material}没有尺寸记录`);
    }
    const rowsByDimension = new Map();
    for (const row of rows) {
      const values = [
        row.widthCm,
        row.lengthCm,
        row.packageLengthCm,
        row.packageWidthCm,
        row.packageHeightCm,
      ];
      if (values.some((value) => positive(value) === null)) {
        throw new PublishTemplateError(
          "INVALID_PACKAGING_TEMPLATE",
          `${material}存在空值、零值或非数字尺寸`,
        );
      }
      const key = [Number(row.widthCm), Number(row.lengthCm)].sort((a, b) => a - b).join("x");
      if (rowsByDimension.has(key)) overwrittenCount += 1;
      rowsByDimension.set(key, { ...row, key });
    }
    normalizedMaterials[material] = [...rowsByDimension.values()];
    recordCount += rowsByDimension.size;
  }
  return {
    ...data,
    materials: normalizedMaterials,
    materialCount: materialNames.length,
    sizeCount: new Set(
      materialNames.flatMap((material) =>
        normalizedMaterials[material].map((row) =>
          [Number(row.widthCm), Number(row.lengthCm)].sort((a, b) => a - b).join("x"),
        ),
      ),
    ).size,
    recordCount,
    overwrittenCount,
  };
}

function validateRugReportSources(value, fields) {
  const source = object(value);
  const dimensions = Array.isArray(source.dimensions)
    ? source.dimensions
    : [];
  const thresholds = object(source.thresholds);
  const hasThresholds = Object.keys(thresholds).length > 0;
  if (!dimensions.length && !hasThresholds) return null;
  if (dimensions.length && hasThresholds) {
    throw new PublishTemplateError(
      "INVALID_RUG_REPORT_SOURCES",
      "1630/1631判定不能同时配置尺寸和是/否阈值属性",
    );
  }
  const fieldsById = new Map(
    fields.map((field) => [String(field.id || ""), field]),
  );
  if (hasThresholds) {
    const normalizeThreshold = (value, label) => {
      const item = object(value);
      const attributeId = text(item.attributeId, 100);
      const exceededValueId = text(item.exceededValueId, 100);
      const withinValueId = text(item.withinValueId, 100);
      const field = fieldsById.get(attributeId);
      if (
        !field ||
        ![3, 4].includes(Number(field.typeCode)) ||
        Number(field.dataDimension) !== 1
      ) {
        throw new PublishTemplateError(
          "INVALID_RUG_REPORT_ATTRIBUTE",
          `${label}判定属性不在当前SHEIN商品属性中`,
        );
      }
      const allowedValueIds = new Set(
        (field.values || []).map((option) => String(option.id || "")),
      );
      if (
        !exceededValueId ||
        !withinValueId ||
        exceededValueId === withinValueId ||
        !allowedValueIds.has(exceededValueId) ||
        !allowedValueIds.has(withinValueId)
      ) {
        throw new PublishTemplateError(
          "INVALID_RUG_REPORT_THRESHOLD_VALUES",
          `属性“${field.name}”必须配置当前SHEIN Schema中的“是/否”阈值选项`,
        );
      }
      return { attributeId, exceededValueId, withinValueId };
    };
    return {
      thresholds: {
        longestEdge: normalizeThreshold(thresholds.longestEdge, "最长边"),
        area: normalizeThreshold(thresholds.area, "面积"),
      },
    };
  }
  if (dimensions.length !== 2) {
    throw new PublishTemplateError(
      "INVALID_RUG_REPORT_SOURCES",
      "1630/1631判定必须配置两个成品边长商品属性",
    );
  }
  const allowedUnits = new Set(["mm", "cm", "m"]);
  return {
    dimensions: dimensions.map((dimension) => {
      const item = object(dimension);
      const attributeId = text(item.attributeId, 100);
      const unit = text(item.unit, 10);
      const field = fieldsById.get(attributeId);
      if (
        !field ||
        ![3, 4].includes(Number(field.typeCode)) ||
        Number(field.dataDimension) !== 1
      ) {
        throw new PublishTemplateError(
          "INVALID_RUG_REPORT_ATTRIBUTE",
          "1630/1631判定属性不在当前SHEIN商品属性中",
        );
      }
      if (!allowedUnits.has(unit)) {
        throw new PublishTemplateError(
          "INVALID_RUG_REPORT_UNIT",
          `属性“${field.name}”缺少可识别的长度单位`,
        );
      }
      return { attributeId, unit };
    }),
  };
}

function validateTemplate(input) {
  const templateType = text(input.templateType, 30);
  const name = text(input.name, 80);
  const categoryId = text(input.categoryId, 80);
  const productTypeId = text(input.productTypeId, 80);
  let data = object(input.data);
  const schemaSource = object(input.schemaSnapshot);
  if (!TEMPLATE_TYPES.has(templateType)) {
    throw new PublishTemplateError("INVALID_TEMPLATE_TYPE", "模板类型不正确");
  }
  if (!name) {
    throw new PublishTemplateError("INVALID_TEMPLATE_NAME", "模板名称不能为空");
  }
  if (templateType === "attribute" && (!categoryId || !productTypeId)) {
    throw new PublishTemplateError(
      "CATEGORY_REQUIRED",
      "商品属性模板必须绑定SHEIN末级类目",
    );
  }
  if (templateType === "attribute") {
    if (!Array.isArray(data.assignments)) {
      throw new PublishTemplateError("INVALID_ATTRIBUTE_TEMPLATE", "商品属性模板缺少属性赋值");
    }
    if (!data.schemaFetchedAt) {
      throw new PublishTemplateError("SCHEMA_REQUIRED", "保存前必须读取当前SHEIN属性结构");
    }
    const fields = Array.isArray(schemaSource.fields) ? schemaSource.fields : [];
    if (!fields.length) {
      throw new PublishTemplateError("SCHEMA_REQUIRED", "商品属性模板缺少SHEIN字段快照");
    }
    const assignments = new Map(
      data.assignments.map((item) => [String(item.attributeId || ""), item]),
    );
    const productFields = fields.filter((item) => [3, 4].includes(Number(item.typeCode)));
    const rugReportSources = validateRugReportSources(
      data.rugReportSources,
      productFields,
    );
    const knownFieldIds = new Set(productFields.map((field) => String(field.id)));
    if ([...assignments.keys()].some((attributeId) => !knownFieldIds.has(attributeId))) {
      throw new PublishTemplateError("INVALID_ATTRIBUTE_ID", "模板包含当前SHEIN类目未返回的商品属性");
    }
    for (const field of productFields) {
      const assignment = assignments.get(String(field.id));
      const valueIds = Array.isArray(assignment?.valueIds)
        ? [...new Set(assignment.valueIds.map(String).filter(Boolean))]
        : [];
      const customValue = text(assignment?.customValue, 500);
      if (field.required && !valueIds.length && !customValue) {
        throw new PublishTemplateError(
          "REQUIRED_ATTRIBUTE_MISSING",
          `必填属性“${field.name}”未填写`,
        );
      }
      const mode = Number(field.modeCode);
      if (valueIds.length && ![1, 3, 4].includes(mode)) {
        throw new PublishTemplateError("INVALID_ATTRIBUTE_MODE", `属性“${field.name}”不允许选择预设值`);
      }
      if (customValue && ![0, 4].includes(mode)) {
        throw new PublishTemplateError("INVALID_ATTRIBUTE_MODE", `属性“${field.name}”不允许手工输入`);
      }
      const allowedValues = new Set((field.values || []).map((item) => String(item.id)));
      if (valueIds.some((valueId) => !allowedValues.has(valueId))) {
        throw new PublishTemplateError("INVALID_ATTRIBUTE_VALUE", `属性“${field.name}”包含SHEIN未返回的选项`);
      }
      if (Number(field.maxSelections) > 0 && valueIds.length > Number(field.maxSelections)) {
        throw new PublishTemplateError("TOO_MANY_ATTRIBUTE_VALUES", `属性“${field.name}”最多选择${field.maxSelections}项`);
      }
    }
    data = {
      ...data,
      assignments: Array.from(assignments.entries()).map(([attributeId, item]) => ({
        attributeId,
        valueIds: [...new Set((item.valueIds || []).map(String).filter(Boolean))],
        customValue: text(item.customValue, 500),
      })),
    };
    if (rugReportSources) data.rugReportSources = rugReportSources;
    else delete data.rugReportSources;
  }
  if (templateType === "title_rule") {
    data = {
      fullTitle: text(data.fullTitle, 1000),
      prefix: text(data.prefix, 300),
      keywords: text(data.keywords, 500),
      suffix: text(data.suffix, 300),
    };
    if (!Object.values(data).some(Boolean)) {
      throw new PublishTemplateError(
        "INVALID_TITLE_RULE_TEMPLATE",
        "标题规则模板至少需要填写一项规则",
      );
    }
  }
  if (templateType === "commercial") {
    const pricePerSquareMeter = positive(data.pricePerSquareMeter);
    const gramsPerSquareMeter = positive(data.gramsPerSquareMeter);
    if (
      pricePerSquareMeter === null ||
      pricePerSquareMeter > 100000 ||
      gramsPerSquareMeter === null ||
      gramsPerSquareMeter > 100000
    ) {
      throw new PublishTemplateError(
        "INVALID_COMMERCIAL_TEMPLATE",
        "计价与克重模板必须填写有效的每平方米供货单价和每平方米克重",
      );
    }
    data = { pricePerSquareMeter, gramsPerSquareMeter };
  }
  if (templateType === "publish_settings") {
    const mallState = text(data.mallState, 10);
    const stopPurchase = text(data.stopPurchase, 10);
    const shelfRequire = text(data.shelfRequire, 10);
    const shelfWay = text(data.shelfWay, 10);
    if (
      !["1", "2"].includes(mallState) ||
      !["1", "2"].includes(stopPurchase) ||
      !["0", "1"].includes(shelfRequire) ||
      shelfWay !== "1"
    ) {
      throw new PublishTemplateError(
        "INVALID_PUBLISH_SETTINGS_TEMPLATE",
        "发布设置模板必须填写有效的全托管状态并使用自动上架",
      );
    }
    data = { mallState, stopPurchase, shelfRequire, shelfWay };
  }
  if (templateType === "size") {
    const colorText = text(data.colorText || data.rows?.[0]?.colorLabel, 80);
    if (!colorText) {
      throw new PublishTemplateError("INVALID_SIZE_TEMPLATE", "尺寸模板必须填写一个共用颜色");
    }
    if (!Array.isArray(data.rows) || !data.rows.length) {
      throw new PublishTemplateError("INVALID_SIZE_TEMPLATE", "尺寸模板至少需要一行规格");
    }
    data = {
      colorText,
      matchingPolicy: "match_current_shein_schema_on_publish",
      rows: data.rows.map((row, index) => {
        const normalized = {
          sizeText: normalizeSizeLabel(row.sizeText || row.sizeLabel),
          lengthCm: positive(row.lengthCm),
          widthCm: positive(row.widthCm),
        };
        if (!normalized.sizeText) {
          throw new PublishTemplateError(
            "INVALID_SIZE_TEMPLATE",
            `第${index + 1}行必须填写自定义尺寸`,
          );
        }
        if (normalized.lengthCm === null || normalized.widthCm === null) {
          throw new PublishTemplateError(
            "INVALID_SIZE_TEMPLATE",
            `第${index + 1}行的长、宽必须是大于0的数字`,
          );
        }
        return normalized;
      }),
    };
  }
  if (templateType === "packaging") data = validatePackaging(data);
  if (templateType === "tail_image") data = validateTailImages(data);
  if (templateType === "compliance") data = validateCompliance(data);
  return {
    templateType,
    name,
    categoryId: templateType === "compliance" ? "" : categoryId,
    productTypeId,
    schemaFingerprint: Object.keys(schemaSource).length ? fingerprint(schemaSource) : "",
    data,
  };
}

function publicTemplate(row, context = {}) {
  const scope = row.scope || "store";
  const isAdministrator = ["owner", "admin"].includes(context.role);
  const rawData = row.template_data || {};
  const data = row.template_type === "compliance" && rawData.templateKind !== "rug_report"
    ? Object.fromEntries(
        Object.entries(rawData).filter(([key]) => ![
          "referenceSkc",
          "categoryName",
          "ruleFetchedAt",
          "ruleExpiresAt",
        ].includes(key)),
      )
    : rawData;
  const categoryMetadata = row.template_type === "compliance"
    ? {}
    : {
        categoryId: row.category_id,
        productTypeId: row.product_type_id,
        schemaFingerprint: row.schema_fingerprint,
      };
  return {
    id: row.id,
    storeId: row.store_id,
    scope,
    scopeLabel: scope === "tenant"
      ? "全员通用"
      : scope === "user"
        ? "我的店铺通用"
        : "当前店铺",
    ownerUserId: row.owner_user_id || row.created_by || null,
    canManage: scope === "tenant"
      ? isAdministrator
      : scope === "user"
        ? String(row.owner_user_id || row.created_by || "") === String(context.userId || "")
        : isAdministrator || String(row.created_by || "") === String(context.userId || ""),
    templateType: row.template_type,
    name: row.name,
    ...categoryMetadata,
    data,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PostgresPublishTemplateRepository {
  constructor({ pool } = {}) {
    if (!pool) throw new Error("PostgresPublishTemplateRepository 缺少 pool");
    this.pool = pool;
  }

  async list({ tenantId, storeId, userId, templateType }) {
    const result = await this.pool.query({
      text: `SELECT * FROM publish_templates
             WHERE tenant_id=$1
               AND (
                 scope='tenant'
                 OR (scope='user' AND owner_user_id=$3)
                 OR (scope='store' AND store_id=$2)
               )
               AND ($4::text IS NULL OR template_type=$4)
             ORDER BY CASE scope WHEN 'store' THEN 1 WHEN 'user' THEN 2 ELSE 3 END,
                      updated_at DESC`,
      values: [tenantId, storeId, userId, templateType || null],
    });
    return result.rows;
  }

  async save(input) {
    const result = await this.pool.query({
      text: `INSERT INTO publish_templates (
               id, tenant_id, store_id, template_type, name, category_id,
               product_type_id, schema_fingerprint, template_data,
               scope, owner_user_id, created_by, updated_by
             ) VALUES (
               COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6,
               $7, $8, $9::jsonb, $10, $11, $11, $11
             )
             ON CONFLICT (id) DO UPDATE SET
               name=EXCLUDED.name,
               category_id=EXCLUDED.category_id,
               product_type_id=EXCLUDED.product_type_id,
               schema_fingerprint=EXCLUDED.schema_fingerprint,
               template_data=EXCLUDED.template_data,
               version=publish_templates.version+1,
               updated_by=EXCLUDED.updated_by,
               updated_at=now()
             WHERE publish_templates.tenant_id=EXCLUDED.tenant_id
               AND publish_templates.template_type=EXCLUDED.template_type
               AND publish_templates.scope=EXCLUDED.scope
               AND (
                 (publish_templates.scope='tenant' AND $12::boolean)
                 OR (
                   publish_templates.scope='user'
                   AND publish_templates.owner_user_id=EXCLUDED.owner_user_id
                 )
                 OR (
                   publish_templates.scope='store'
                   AND publish_templates.store_id=EXCLUDED.store_id
                   AND (publish_templates.created_by=$11 OR $12::boolean)
                 )
               )
             RETURNING *`,
      values: [
        input.id || null,
        input.tenantId,
        input.storeId,
        input.templateType,
        input.name,
        input.categoryId,
        input.productTypeId,
        input.schemaFingerprint,
        JSON.stringify(input.data),
        input.scope,
        input.userId,
        input.canManageTenantTemplates,
      ],
    });
    return result.rows[0] || null;
  }

  async syncMediaReferences({ tenantId, storeId, templateId, mediaAssetIds = [] }) {
    const ids = [...new Set(mediaAssetIds.map(String))];
    if (ids.some((id) => !UUID_PATTERN.test(id))) {
      throw new PublishTemplateError("INVALID_IMAGE_TEMPLATE", "尾部主图包含无效的素材ID");
    }
    const previous = await this.pool.query({
      text: `SELECT asset_id FROM media_asset_references
             WHERE tenant_id=$1 AND store_id=$2
               AND reference_type='product_template' AND reference_key=$3`,
      values: [tenantId, storeId, String(templateId)],
    });
    await this.pool.query({
      text: `DELETE FROM media_asset_references
             WHERE tenant_id=$1 AND store_id=$2
               AND reference_type='product_template' AND reference_key=$3`,
      values: [tenantId, storeId, String(templateId)],
    });
    if (ids.length) {
      const inserted = await this.pool.query({
        text: `INSERT INTO media_asset_references (
                 asset_id, tenant_id, store_id, reference_type, reference_key
               )
               SELECT m.id, $2, $3, 'product_template', $4
               FROM media_assets m
               WHERE m.id = ANY($1::uuid[])
                 AND m.tenant_id=$2 AND m.store_id=$3
                 AND m.status IN ('ready', 'referenced')
               ON CONFLICT (asset_id, reference_type, reference_key) DO NOTHING`,
        values: [ids, tenantId, storeId, String(templateId)],
      });
      if (inserted.rowCount !== ids.length) {
        throw new PublishTemplateError(
          "INVALID_IMAGE_TEMPLATE",
          "尾部主图包含不存在、未完成上传或不属于当前店铺的图片",
          409,
        );
      }
    }
    const affectedIds = [...new Set([
      ...(previous.rows || []).map((item) => String(item.asset_id)),
      ...ids,
    ])].filter((id) => UUID_PATTERN.test(id));
    if (affectedIds.length) {
      await this.pool.query({
        text: `UPDATE media_assets m
               SET reference_count=refs.reference_count,
                   status=CASE
                     WHEN refs.reference_count > 0
                       AND m.status IN ('ready','referenced','pending_delete') THEN 'referenced'
                     WHEN refs.reference_count = 0 AND m.status='referenced' THEN 'ready'
                     ELSE m.status
                   END,
                   updated_at=now()
               FROM (
                 SELECT m2.id, COUNT(r.asset_id)::int AS reference_count
                 FROM media_assets m2
                 LEFT JOIN media_asset_references r ON r.asset_id=m2.id
                 WHERE m2.id = ANY($1::uuid[])
                 GROUP BY m2.id
               ) refs
               WHERE m.id=refs.id`,
        values: [affectedIds],
      });
    }
  }

  async remove({ tenantId, storeId, userId, canManageTenantTemplates, id }) {
    const target = await this.pool.query({
      text: `SELECT * FROM publish_templates
             WHERE id=$1 AND tenant_id=$2
               AND (
                 (scope='tenant' AND $5::boolean)
                 OR (scope='user' AND owner_user_id=$4)
                 OR (
                   scope='store' AND store_id=$3
                   AND (created_by=$4 OR $5::boolean)
                 )
               )`,
      values: [id, tenantId, storeId, userId, canManageTenantTemplates],
    });
    if (!target.rows[0]) return false;
    await this.syncMediaReferences({
      tenantId,
      storeId: target.rows[0].store_id,
      templateId: id,
      mediaAssetIds: [],
    });
    const result = await this.pool.query({
      text: `DELETE FROM publish_templates
             WHERE id=$1 AND tenant_id=$2
             RETURNING id`,
      values: [id, tenantId],
    });
    return result.rowCount > 0;
  }
}

export class WebPublishTemplateService {
  constructor({ repository } = {}) {
    if (!repository) throw new Error("WebPublishTemplateService 缺少 repository");
    this.repository = repository;
  }

  async list({ context, storeId, templateType }) {
    if (templateType && !TEMPLATE_TYPES.has(templateType)) {
      throw new PublishTemplateError("INVALID_TEMPLATE_TYPE", "模板类型不正确");
    }
    const rows = await this.repository.list({
      tenantId: context.tenantId,
      storeId,
      userId: context.userId,
      templateType,
    });
    return {
      templates: rows.map((row) => publicTemplate(row, context)),
      count: rows.length,
    };
  }

  async resolveVisibleMedia({ context, storeId, id, assetId }) {
    const rows = await this.repository.list({
      tenantId: context.tenantId,
      storeId,
      userId: context.userId,
      templateType: "tail_image",
    });
    const row = rows.find((item) => String(item.id) === String(id));
    const assetIds = Array.isArray(row?.template_data?.assetIds)
      ? row.template_data.assetIds.map(String)
      : [];
    if (!row || !assetIds.includes(String(assetId))) {
      throw new PublishTemplateError(
        "TEMPLATE_MEDIA_NOT_FOUND",
        "图片不属于当前账号可见的尾部主图模板",
        404,
      );
    }
    return { originStoreId: row.store_id, assetId: String(assetId) };
  }

  async save({ context, storeId, input = {}, id = null }) {
    const normalized = validateTemplate(input);
    const canManageTenantTemplates = ["owner", "admin"].includes(context.role);
    const scope = normalized.templateType === "compliance"
      ? "store"
      : canManageTenantTemplates
        ? "tenant"
        : "user";
    let row;
    try {
      row = await this.repository.save({
        ...normalized,
        id,
        tenantId: context.tenantId,
        storeId,
        userId: context.userId,
        scope,
        canManageTenantTemplates,
      });
    } catch (error) {
      if (error?.code === "23505") {
        throw new PublishTemplateError(
          "DUPLICATE_TEMPLATE_NAME",
          scope === "tenant"
            ? "全员通用模板中已有同类型同名模板"
            : scope === "user"
              ? "你的模板中已有同类型同名模板"
              : "当前店铺已有同类型同名模板",
          409,
        );
      }
      throw error;
    }
    if (!row) {
      throw new PublishTemplateError("TEMPLATE_CONFLICT", "模板不存在或不属于当前店铺", 409);
    }
    if (typeof this.repository.syncMediaReferences === "function") {
      await this.repository.syncMediaReferences({
        tenantId: context.tenantId,
        storeId: row.store_id,
        templateId: row.id,
        mediaAssetIds: normalized.templateType === "tail_image"
          ? normalized.data.assetIds
          : normalized.templateType === "compliance"
            ? complianceMediaAssetIds(normalized.data)
            : [],
      });
    }
    return { template: publicTemplate(row, context) };
  }

  async remove({ context, storeId, id }) {
    const removed = await this.repository.remove({
      tenantId: context.tenantId,
      storeId,
      userId: context.userId,
      canManageTenantTemplates: ["owner", "admin"].includes(context.role),
      id,
    });
    if (!removed) {
      throw new PublishTemplateError("TEMPLATE_NOT_FOUND", "模板不存在或已删除", 404);
    }
    return { ok: true, id };
  }
}
