import http from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildAttributeFields } from "../src-v2/lib/attribute-template-contract.js";
import { classifyRugReportFromProductAttributes } from "../src-v2/lib/rug-report-classification.js";
import {
  expectedAgencyType,
  isPerSkcFlammabilityCertificate,
} from "./compliance-workflow.js";
import {
  buildPhotoBindBody,
  buildPhotoUploadRequest,
  SHEIN_COMPLIANCE_WRITE_PATHS,
} from "./compliance-write-contract.js";

const DEFAULT_LEGACY_PROXY = "http://127.0.0.1:8787";
const MAX_BODY_BYTES = 1024 * 1024;
const jobs = new Map();
const detailCache = new Map();
const draftCache = new Map();
const reportCache = new Map();
const mediaCache = new Map();
let localStateLoaded = false;
const localStateFile = process.env.SHEIN_V2_REAL_STATE_FILE || path.resolve(process.cwd(), ".data/v2-real-local-state.json");
const localMediaDir = process.env.SHEIN_V2_REAL_MEDIA_DIR || path.resolve(process.cwd(), ".data/v2-real-local-media");

function loadLocalState() {
  if (!existsSync(localStateFile)) return;
  try {
    const state = JSON.parse(readFileSync(localStateFile, "utf8"));
    for (const draft of state.drafts || []) {
      if (draft?.storeId && draft?.skc) draftCache.set(`${draft.storeId}:${draft.skc}`, draft);
    }
    for (const report of state.reports || []) {
      if (report?.storeId && report?.skc) reportCache.set(`${report.storeId}:${report.skc}`, report);
    }
    for (const asset of state.assets || []) {
      if (asset?.id && asset?.storeId) {
        mediaCache.set(asset.id, {
          asset,
          bytes: null,
          filePath: path.join(localMediaDir, `${asset.id}.bin`),
        });
      }
    }
  } catch {
    // A corrupt local editing cache must not prevent the read-only workspace from starting.
  }
}

function persistLocalState() {
  if (process.env.SHEIN_V2_REAL_DISABLE_PERSISTENCE === "true") return;
  mkdirSync(path.dirname(localStateFile), { recursive: true, mode: 0o700 });
  const temporaryPath = `${localStateFile}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify({
    version: 1,
    drafts: Array.from(draftCache.values()),
    reports: Array.from(reportCache.values()),
    assets: Array.from(mediaCache.values()).map(({ asset }) => asset),
  }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporaryPath, localStateFile);
}

function ensureLocalStateLoaded() {
  if (localStateLoaded || process.env.SHEIN_V2_REAL_DISABLE_PERSISTENCE === "true") return;
  localStateLoaded = true;
  loadLocalState();
}

function json(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json;charset=UTF-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  response.end(JSON.stringify(payload));
}

function errorPayload(error, fallbackCode = "LOCAL_REAL_PROXY_FAILED") {
  const message = String(error?.message || "");
  const ipWhitelistMatch = message.match(
    /IP\s+is\s+not\s+in\s+the\s+whitelist\s*:\s*([^\s]+)/i,
  );
  if (ipWhitelistMatch) {
    return {
      code: "SHEIN_IP_NOT_ALLOWED",
      msg: `当前出口 IP ${ipWhitelistMatch[1]} 不在 SHEIN 开放平台白名单，请添加后重试`,
      sourceCode: String(error?.code || "") || null,
      traceId: error?.traceId || null,
    };
  }
  if (String(error?.code || "") === "openapi00001") {
    return {
      code: "SHEIN_REAUTHORIZATION_REQUIRED",
      msg: "SHEIN 拒绝了当前店铺授权签名，请前往店铺管理重新授权后再刷新总览",
      sourceCode: "openapi00001",
      traceId: error?.traceId || null,
    };
  }
  return {
    code: String(error?.code || fallbackCode),
    msg: error?.message || "本地真实数据服务失败",
    traceId: error?.traceId || null,
    details: error?.response?.info || error?.response?.details || null,
  };
}

async function readBody(request) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (Buffer.byteLength(raw) > MAX_BODY_BYTES) {
      const error = new Error("请求体过大");
      error.status = 413;
      throw error;
    }
  }
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error("请求体不是有效 JSON");
    error.status = 400;
    throw error;
  }
}

async function legacyRequest(path, { method = "GET", body } = {}) {
  const response = await fetch(
    `${process.env.SHEIN_LOCAL_PROXY_TARGET || DEFAULT_LEGACY_PROXY}${path}`,
    {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const error = new Error(
      String(payload.msg || payload.message || "本地 SHEIN 代理请求失败"),
    );
    error.status = response.status;
    error.code = payload.code || "LOCAL_SHEIN_PROXY_FAILED";
    error.traceId = payload.traceId || null;
    error.response = payload;
    throw error;
  }
  return payload;
}

async function legacyBinaryRequest(path, {
  bytes,
  contentType,
  fileName,
  width,
  height,
} = {}) {
  const response = await fetch(
    `${process.env.SHEIN_LOCAL_PROXY_TARGET || DEFAULT_LEGACY_PROXY}${path}`,
    {
      method: "POST",
      headers: {
        "content-type": contentType,
        "x-file-name": encodeURIComponent(fileName),
        "x-image-width": String(width),
        "x-image-height": String(height),
      },
      body: bytes,
    },
  );
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const error = new Error(
      String(payload.msg || payload.message || "本地 SHEIN 图片上传代理失败"),
    );
    error.status = response.status;
    error.code = payload.code || "LOCAL_SHEIN_UPLOAD_FAILED";
    error.traceId = payload.traceId || null;
    error.response = payload;
    throw error;
  }
  return payload;
}

function photoSlotGroup(photo = {}) {
  const slot = String(photo.photoSlot || "");
  const labelGroup = String(photo.labelGroup || "");
  if (slot === "product" || (!slot && labelGroup === "1")) return "body";
  if (
    ["inner_package", "outer_package"].includes(slot) ||
    (!slot && labelGroup === "2")
  ) {
    return "package";
  }
  const error = new Error("实拍图未标明商品本体或包装分组");
  error.status = 422;
  error.code = "PHOTO_GROUP_INVALID";
  throw error;
}

function isResolvedComplianceStatus(value) {
  return ["通过", "无需", "审核成功", "审核通过"].includes(
    String(value || ""),
  );
}

function isPhotoSubmissionStatus(value) {
  return ["失败", "待补充"].includes(String(value || ""));
}

function requiredPhotoGroups(detail = {}) {
  const records = asArray(detail.records);
  const needsAttention = (requirementType, summaryStatus) => {
    const groupRecords = records.filter(
      (record) => record.requirementType === requirementType,
    );
    return groupRecords.length
      ? groupRecords.some((record) => isPhotoSubmissionStatus(record.status))
      : isPhotoSubmissionStatus(summaryStatus);
  };
  return {
    body: needsAttention("body_photo", detail.item?.summary?.bodyPhoto),
    package: needsAttention(
      "package_photo",
      detail.item?.summary?.packagePhoto,
    ),
  };
}

function localMediaEntry(storeId, localAssetRef) {
  const assetId = String(localAssetRef || "").replace(/^media:/, "");
  const entry = mediaCache.get(assetId);
  if (!assetId || !entry || entry.asset.storeId !== storeId) {
    const error = new Error("本地实拍图不存在，请重新上传后保存草稿");
    error.status = 409;
    error.code = "PHOTO_LOCAL_MEDIA_NOT_FOUND";
    throw error;
  }
  if (!entry.bytes && entry.filePath && existsSync(entry.filePath)) {
    entry.bytes = readFileSync(entry.filePath);
  }
  if (entry.asset.status !== "ready" || !entry.bytes?.length) {
    const error = new Error("本地实拍图尚未上传完成");
    error.status = 409;
    error.code = "PHOTO_LOCAL_MEDIA_NOT_READY";
    throw error;
  }
  return { assetId, entry };
}

function publicStore(store, lastSyncedAt = null) {
  return {
    id: String(store.id),
    supplierId: store.supplierId || null,
    label: store.label || `SHEIN 店铺 ${store.supplierId || "未命名"}`,
    businessMode: store.businessMode || "全托管",
    status: store.status || "active",
    environment: "production",
    authorizedAt: store.connectedAt || null,
    lastSyncedAt,
  };
}

function businessSnapshot(data) {
  if (!data) return null;
  return {
    productCount: Number(data.productCount || data.products?.length || 0),
    products: Array.isArray(data.products)
      ? data.products.map((product) => ({
          ...product,
          title: product.title || product.name || "",
          imageUrl: product.imageUrl || product.image || "",
        }))
      : [],
    warnings: Array.isArray(data.warnings)
      ? data.warnings.map((warning) => ({
          ...warning,
          tone: warning.tone || warning.severity || "medium",
        }))
      : [],
    totals: data.totals || {},
  };
}

function dashboardFromBusiness(storeId, data, syncedAt, refreshJob = null) {
  const snapshot = businessSnapshot(data);
  const sourceCutoff = data?.dataDate || new Date().toISOString().slice(0, 10);
  return {
    state: snapshot ? "ready" : "idle",
    snapshot,
    stale: false,
    syncedAt: syncedAt || null,
    sourceCutoff,
    refreshStartedAt: refreshJob?.startedAt || null,
    refreshCompletedAt: refreshJob?.completedAt || null,
    lastError: refreshJob?.error || null,
    refreshJob,
    storeId,
    refreshAfterSeconds: 0,
  };
}

function mapBusinessJob(job) {
  return {
    id: job.id,
    jobType: "store_business_refresh",
    state: job.state,
    progress: job.progress || {},
    error: job.error || null,
    items: [],
    requestedBy: { name: "当前账号", me: true },
    startedAt: job.startedAt || null,
    completedAt: job.completedAt || null,
    createdAt: job.createdAt || null,
    updatedAt: job.updatedAt || job.completedAt || job.startedAt || null,
  };
}

function mapComplianceJob(job) {
  if (!job) return null;
  const state = job.state === "completed" ? "succeeded"
    : job.state === "completed_with_errors" ? "failed"
      : job.state === "interrupted" ? "cancelled" : job.state;
  return {
    id: job.id,
    jobType: "compliance_sync",
    state,
    progress: {
      total: Number(job.total || 0),
      processed: Number(job.processed || 0),
      succeeded: Number(job.success || 0),
      failed: Number(job.failed || 0),
    },
    error: job.error ? { code: "COMPLIANCE_SYNC_FAILED", message: job.error } : null,
    items: [],
    requestedBy: { name: "当前账号", me: true },
    startedAt: job.startedAt || null,
    completedAt: job.completedAt || null,
    createdAt: job.startedAt || null,
    updatedAt: job.updatedAt || job.completedAt || job.startedAt || null,
  };
}

function complianceSnapshot(syncedAt) {
  if (!syncedAt) return null;
  const fetchedAt = new Date(syncedAt);
  return {
    fetchedAt: fetchedAt.toISOString(),
    expiresAt: new Date(fetchedAt.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    traceId: null,
    fresh: true,
  };
}

const complianceStatusPriority = Object.freeze({
  "需修正": 0,
  "待补充": 1,
  "审核中": 2,
  "待同步": 3,
  "未同步": 4,
  "通过": 5,
});

function workspaceItem(product, row, complianceSyncedAt) {
  const skc = String(row?.skc || product?.skc || "");
  const synced = Boolean(row && complianceSyncedAt);
  const summary = {
    certificate: row?.certificate || "未同步",
    agency: row?.agency || "未同步",
    warning: row?.warning || "未同步",
    platformOnly: row?.platformOnly || "未同步",
    packagePhoto: row?.packagePhoto || "未同步",
    bodyPhoto: row?.bodyPhoto || "未同步",
    sourceCoverage: row?.sourceCoverage || null,
  };
  return {
    id: skc,
    skc,
    supplierCode: String(product?.supplierCode || product?.spu || skc),
    categoryId: String(product?.categoryId || ""),
    categoryName: String(product?.categoryName || ""),
    shelfStatus: product?.statusCode ?? product?.state ?? null,
    complianceStatus: synced ? (row?.state || "通过") : "未同步",
    summary,
    updatedAt: complianceSyncedAt || null,
    snapshot: synced ? complianceSnapshot(complianceSyncedAt) : null,
    attributeSnapshot: null,
    reportDecision: null,
    draft: null,
    serverPreflight: null,
  };
}

function emptyDetail(item) {
  return {
    item,
    records: [],
    snapshots: [],
    draft: null,
    workspaceCapabilities: {
      mode: "local_direct",
      refreshCurrentSkc: true,
      directReportStorage: true,
      photoTemplateApply: true,
      reportTemplateApply: false,
      photoShare: true,
      photoBindingDiagnostic: true,
      photoSubmit: true,
      reportSubmit: false,
    },
    editorModel: {
      certificateRulesFresh: false,
      certificateLibraryFresh: false,
      certificateLibrary: [],
      agencyLibraryRequired: false,
      agencyRequirements: [],
      agencyLibraryFresh: false,
      agencyLibrary: [],
      warningRulesRequired: false,
      warningRulesFresh: false,
      warningRules: [],
      certificates: [],
      detectionAgencies: [],
      platformCapabilities: [],
    },
    latestPreflight: null,
    preflightHistory: [],
    latestPreflightReviews: [],
    releaseGate: { publishingEnabled: false, blockerCount: 0, blockers: [] },
  };
}

function publicDraft(draft) {
  if (!draft) return null;
  const inputs = asObject(draft.inputs);
  const preflight = asObject(draft.preflight);
  return {
    id: draft.id,
    storeId: draft.storeId,
    skc: draft.skc,
    templateId: draft.templateId || null,
    requirementSnapshot: draft.requirementSnapshot || {},
    inputs: {
      certificates: asArray(inputs.certificates),
      agencies: asArray(inputs.agencies),
      warnings: asArray(inputs.warnings),
      photos: asArray(inputs.photos),
      platformPhotoActions: asArray(inputs.platformPhotoActions),
    },
    preflight,
    status: draft.status,
    updatedAt: draft.updatedAt,
  };
}

function draftProjection(draft) {
  if (!draft) return null;
  const preflight = asObject(draft.preflight);
  return {
    id: draft.id,
    status: draft.status,
    updatedAt: draft.updatedAt,
    blockerCount: Number(preflight.blockerCount || 0),
    preflight: {
      evaluated: preflight.evaluated === true,
      savedExecutable: preflight.savedExecutable === true,
      blockerCount: Number(preflight.blockerCount || 0),
      warningCount: Number(preflight.warningCount || 0),
      waitingCount: Number(preflight.waitingCount || 0),
      blockers: asArray(preflight.blockers),
      warnings: asArray(preflight.warnings),
    },
  };
}

function detailWithDraft(storeId, detail) {
  const draft = draftCache.get(`${storeId}:${detail.item?.skc || ""}`);
  if (!draft) return detail;
  const projection = draftProjection(draft);
  return {
    ...detail,
    item: { ...detail.item, draft: projection },
    draft: projection,
  };
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function requirementIdentity(value) {
  return String(value?.certificateTypeId ?? value?.certificateTypeCode ?? "").trim();
}

function editorCertificateField(field) {
  return {
    id: String(field?.presetId ?? ""),
    name: String(field?.presetRemark || field?.presetName || field?.presetId || ""),
    inputType: Number(field?.inputType),
    required: Number(field?.isRequired) === 1,
    sourceFrom: String(field?.sourceFrom || ""),
    unit: String(field?.unit || ""),
    options: asArray(field?.presetValueList)
      .filter((option) => Number(option?.isEnabled ?? 1) === 1)
      .map((option) => ({
        id: String(option?.presetValueId ?? ""),
        label: String(option?.presetValue || option?.presetValueId || ""),
      })),
  };
}

function buildEditorModel(row, bundle) {
  const requirements = asObject(bundle.requirements);
  const schemas = asArray(bundle.certificateSchemas);
  const certificateRequirements = asArray(requirements.certificates);
  const agencyRequirements = asArray(requirements.agencies);
  const warningRequirements = asArray(requirements.warnings);
  const certificateCodes = new Set(
    certificateRequirements.map((item) => String(item?.certificateTypeCode || "")),
  );
  const warningCodes = new Set(
    warningRequirements.map((item) => String(item?.certificateTypeCode || "")),
  );
  const sourceCoverage = row?.sourceCoverage || {};
  const requirementFresh = sourceCoverage.requirementsReturned === true &&
    sourceCoverage.photoRequirementsReturned === true;
  const schemaFresh = bundle.sourceCoverage?.certificateSchemas === true;
  const agencyFresh = bundle.sourceCoverage?.agencies === true;
  const warningFresh = bundle.sourceCoverage?.warningRules === true;

  return {
    certificateRulesFresh: requirementFresh && schemaFresh,
    certificateLibraryFresh: bundle.sourceCoverage?.certificateLibrary === true,
    certificateLibrary: asArray(bundle.certificates).filter((certificate) =>
      String(certificate?.poolSn || "") &&
      Number(certificate?.status) === 2 &&
      certificateCodes.has(String(certificate?.certificateTypeCode || "")),
    ).map((certificate) => ({
      poolId: String(certificate?.poolId ?? ""),
      poolSn: String(certificate.poolSn),
      certificateTypeId: String(certificate?.certificateTypeId ?? ""),
      certificateTypeCode: String(certificate?.certificateTypeCode || ""),
      name: String(certificate?.certificateTypeName || "资质证书"),
      certificateDimension: certificate?.certificateDimension ?? null,
      effectiveTime: String(certificate?.effectiveTime || ""),
      invalidTime: String(certificate?.invalidTime || ""),
      alertTime: String(certificate?.alertTime || ""),
      bindSkcFlag: certificate?.bindSkcFlag ?? null,
      lastUpdateTime: String(certificate?.lastUpdateTime || ""),
      fileNames: asArray(certificate?.fileNames).map(String),
    })),
    agencyLibraryRequired: agencyRequirements.length > 0,
    agencyRequirements: agencyRequirements.map((requirement) => ({
      key: requirementIdentity(requirement),
      certificateTypeId: requirement?.certificateTypeId ?? null,
      certificateTypeCode: String(requirement?.certificateTypeCode || ""),
      name: String(requirement?.certificateTypeName || "代理公司"),
      required: Number(requirement?.isRequired) === 1,
      agencyType: expectedAgencyType(requirement),
    })),
    agencyLibraryFresh: agencyRequirements.length > 0 && agencyFresh,
    agencyLibrary: agencyRequirements.length > 0 && agencyFresh
      ? asArray(bundle.agencies).filter((agency) =>
        String(agency?.agencyId ?? "") &&
        Number(agency?.agencyStatus) === 0 &&
        [1, 2].includes(Number(agency?.applyStatus)),
      ).map((agency) => ({
        agencyId: String(agency.agencyId),
        name: String(agency?.agencyName || "代理公司"),
        agencyType: agency?.agencyType ?? null,
        agencySubType: agency?.agencySubType ?? null,
        agencyStartTime: String(agency?.agencyStartTime || ""),
        agencyEndTime: String(agency?.agencyEndTime || ""),
        coveredProductRange: agency?.coveredProductRange ?? null,
        updateTime: String(agency?.updateTime || ""),
      }))
      : [],
    warningRulesRequired: warningRequirements.length > 0,
    warningRulesFresh: warningRequirements.length > 0 && warningFresh,
    warningRules: warningRequirements.length > 0 && warningFresh
      ? asArray(bundle.warningRules)
        .filter((rule) => warningCodes.has(String(rule?.certificateTypeCode || "")))
        .map((rule) => ({
          certificateTypeId: String(rule?.certificateTypeId ?? ""),
          certificateTypeCode: String(rule?.certificateTypeCode || ""),
          name: String(rule?.certificateTypeName || "手动警示语"),
          fields: asArray(rule?.fields).map((field) => ({
            fieldCode: String(field?.fieldCode || ""),
            name: String(field?.fieldName || field?.fieldCode || "字段"),
            fieldType: Number(field?.fieldType),
            fieldSort: Number(field?.fieldSort),
            values: asArray(field?.values).map((value) => ({
              id: String(value?.fieldValueId ?? ""),
              label: String(value?.fieldValue || ""),
              exclusionFieldValueIds: asArray(value?.exclusionFieldValueIds).map(String),
              mappingPaths: asArray(value?.mappingPaths).map((path) =>
                asArray(path?.fieldValueIds).map(String),
              ),
            })),
          })).sort((left, right) => left.fieldSort - right.fieldSort),
        }))
      : [],
    certificates: certificateRequirements.map((requirement) => {
      const schema = schemas.find((candidate) =>
        requirementIdentity(candidate) === requirementIdentity(requirement),
      );
      const supported = Boolean(
        schemaFresh && schema && Number(schema.isEnabled) === 1 &&
        Number(schema.certificateLabel ?? 0) === 0 &&
        String(schema.certificateTypeId) !== "844",
      );
      return {
        key: requirementIdentity(requirement),
        certificateTypeId: requirement?.certificateTypeId ?? null,
        certificateTypeCode: String(requirement?.certificateTypeCode || ""),
        name: String(requirement?.certificateTypeName || schema?.certificateType || "资质证书"),
        required: Number(requirement?.isRequired) === 1,
        perSkc: isPerSkcFlammabilityCertificate(requirement),
        supported,
        unsupportedReason: supported
          ? null
          : !schemaFresh
            ? "CERTIFICATE_SCHEMA_STALE"
            : !schema
              ? "CERTIFICATE_SCHEMA_MISSING"
              : "CERTIFICATE_TYPE_UNSUPPORTED",
        certificateDimension: schema?.certificateDimension ?? null,
        fields: schema
          ? [...asArray(schema.presetInfoList), ...asArray(schema.otherPresetInfoList)]
            .filter((field) => Number(field?.isEnabled ?? 1) === 1)
            .map(editorCertificateField)
          : [],
      };
    }),
    detectionAgencies: asArray(bundle.srmDetectionAgencyList).flatMap((item) => {
      const agency = asObject(item?.detectionAgency);
      const id = String(agency.detectionAgencyId ?? "").trim();
      return id
        ? [{
            id,
            name: String(agency.detectionAgencyName || id),
            laboratories: asArray(item?.laboratoryList).flatMap((laboratory) => {
              const laboratoryId = String(laboratory?.laboratoryId ?? "").trim();
              return laboratoryId
                ? [{ id: laboratoryId, name: String(laboratory?.laboratoryName || laboratoryId) }]
                : [];
            }),
          }]
        : [];
    }),
    platformCapabilities: asArray(requirements.unsupported).flatMap((requirement) => {
      const typeId = String(requirement?.certificateTypeId ?? "");
      const code = String(requirement?.certificateTypeCode || "");
      const name = String(requirement?.certificateTypeName || "");
      const searchable = `${code} ${name}`.toLowerCase();
      const capabilityKey = typeId === "844" || searchable.includes("产品标识符") || searchable.includes("productidenti")
        ? "product_identifier"
        : searchable.includes("gcc") ? "gcc" : "";
      return capabilityKey
        ? [{
            capabilityKey,
            readEndpoint: "/open-api/goods-compliance-requirements/list",
            certificateTypeId: requirement?.certificateTypeId ?? null,
            certificateTypeCode: code,
            certificateTypeName: name,
            complianceGroupCode: String(requirement?.complianceGroupCode || ""),
            isManualProductWarning: requirement?.isManualProductWarning ?? null,
            isAutoProductWarning: requirement?.isAutoProductWarning ?? null,
            isRequired: requirement?.isRequired ?? null,
            reviewState: requirement?.reviewState ?? null,
            editable: false,
            writeStatus: "unsupported_by_official_api",
            writeEndpoint: null,
            writeFields: null,
          }]
        : [];
    }),
  };
}

function complianceRecords(row, bundle) {
  const groups = [
    ["certificate", "certificates", "certificate"],
    ["agency", "agencies", "agency"],
    ["warning", "warnings", "warning"],
    ["package_photo", "packagePhotos", "packagePhoto"],
    ["body_photo", "bodyPhotos", "bodyPhoto"],
    ["unsupported", "unsupported", "platformOnly"],
  ];
  return groups.flatMap(([requirementType, property, statusProperty]) =>
    asArray(bundle.requirements?.[property]).map((data, index) => ({
      id: `${row.skc}:${requirementType}:${requirementIdentity(data) || data.labelId || index + 1}`,
      requirementType,
      requirementKey: `${requirementIdentity(data) || `${data.labelId || "label"}:${data.labelGroup || ""}`}:${index + 1}`,
      status: String(row?.[statusProperty] || "待同步"),
      required: Number(data?.isRequired) === 1,
      data,
      traceId: null,
      checkedAt: bundle.fetchedAt || null,
    })),
  );
}

function complianceSnapshots(row, bundle) {
  const fetchedAt = String(bundle.fetchedAt || new Date().toISOString());
  const expiresAt = new Date(new Date(fetchedAt).getTime() + 24 * 60 * 60 * 1000).toISOString();
  const sourceCoverage = bundle.sourceCoverage || {};
  return [
    ["compliance_requirement", {
      ...asObject(bundle.requirements),
      sourceCoverage: row?.sourceCoverage || {},
      diagnostics: bundle.diagnostics || [],
      errors: bundle.errors || [],
    }, row?.sourceCoverage?.requirementsReturned === true && row?.sourceCoverage?.photoRequirementsReturned === true],
    ["certificate_schema", { certificateSchemas: bundle.certificateSchemas || [], srmDetectionAgencyList: bundle.srmDetectionAgencyList || [] }, sourceCoverage.certificateSchemas === true],
    ["certificate_library", { certificates: bundle.certificates || [] }, sourceCoverage.certificateLibrary === true],
    ["agency_library", { agencies: bundle.agencies || [], bindableAgencies: bundle.bindableAgencies || [] }, sourceCoverage.agencies === true],
    ["warning_rules", { warningRules: bundle.warningRules || [] }, sourceCoverage.warningRules === true],
  ].map(([ruleType, payload, fresh]) => ({
    ruleType,
    payload,
    traceId: asArray(bundle.diagnostics)[0]?.traceId || null,
    fetchedAt,
    expiresAt,
    fresh,
  }));
}

function buildAttributeProjection(productDetail, attributeInfo, template, traceId) {
  const productTypeId = String(productDetail?.productTypeId || "");
  const fields = buildAttributeFields(attributeInfo || {}, productTypeId);
  const assignments = {};
  for (const row of asArray(productDetail?.productAttributeInfoList)) {
    const id = String(row?.attributeId || "");
    if (!fields.some((field) => field.id === id)) continue;
    const current = assignments[id] || { valueIds: [], customValue: "" };
    const valueId = String(row?.attributeValueId || "").trim();
    const customValue = String(row?.attributeValue || "").trim();
    if (valueId && !current.valueIds.includes(valueId)) current.valueIds.push(valueId);
    if (customValue) current.customValue = current.customValue ? `${current.customValue} / ${customValue}` : customValue;
    assignments[id] = current;
  }
  const projectedFields = fields.map((field) => {
    const assignment = assignments[field.id] || { valueIds: [], customValue: "" };
    return {
      id: field.id,
      name: field.name,
      required: field.required,
      mode: field.mode,
      assigned: assignment.valueIds.length > 0 || Boolean(assignment.customValue),
      valueIds: assignment.valueIds,
      valueLabels: assignment.valueIds.map((valueId) => field.values.find((value) => value.id === valueId)?.label || `官方值 ID ${valueId}`),
      customValue: assignment.customValue,
    };
  });
  const templateData = asObject(template?.data);
  const sources = asObject(templateData.rugReportSources || template?.rugReportSources);
  const hasSnapshot = Boolean(productTypeId && fields.length);
  return {
    fields,
    assignments,
    sources,
    snapshot: hasSnapshot ? {
      fetchedAt: new Date().toISOString(),
      categoryId: String(productDetail?.categoryId || ""),
      productTypeId,
      fieldCount: projectedFields.length,
      assignedFieldCount: projectedFields.filter((field) => field.assigned).length,
      fields: projectedFields,
      sourceEndpoint: "/open-api/goods/spu-info",
      traceId: traceId || null,
      reportSourcesConfigured: Object.keys(sources).length > 0,
    } : null,
  };
}

function buildReportDecision(bundle, attributes) {
  const requirements = asArray(bundle.requirements?.certificates).filter(isPerSkcFlammabilityCertificate);
  if (!requirements.length) return null;
  if (!attributes.snapshot) {
    return {
      reportType: null,
      longestEdgeCm: null,
      areaM2: null,
      evidence: [],
      blockers: [{ code: "ATTRIBUTE_SNAPSHOT_MISSING", message: "未读取到当前类目的官方商品属性，无法判定 1630/1631" }],
    };
  }
  const result = classifyRugReportFromProductAttributes({
    fields: attributes.fields,
    assignments: attributes.assignments,
    sources: attributes.sources,
  });
  const thresholdResult = classifyRugReportFromBooleanThresholds(attributes.snapshot.fields);
  const classified = thresholdResult || result;
  const expected = Array.from(new Set(requirements.map((requirement) =>
    reportTypeForRequirement(requirement),
  ).filter(Boolean)));
  const blockers = [...classified.blockers];
  if (classified.reportType && expected.length && !expected.includes(classified.reportType)) {
    blockers.push({ code: "RUG_REPORT_TYPE_MISMATCH", message: `商品属性判定为 ${classified.reportType}，但当前官方要求为 ${expected.join("、")}` });
  }
  return {
    reportType: classified.reportType,
    longestEdgeCm: classified.longestEdgeCm,
    areaM2: classified.areaM2,
    evidence: classified.evidence,
    blockers: blockers.map((item) => ({ code: String(item.code || "RUG_REPORT_CLASSIFICATION_BLOCKED"), message: String(item.message || "1630/1631判定被阻断") })),
  };
}

function reportTypeForRequirement(requirement) {
  const identity = `${requirement?.certificateTypeCode || ""} ${requirement?.certificateTypeName || ""}`.toLowerCase();
  if (identity.includes("1631") || identity.includes("smallcarpet")) return "1631";
  if (identity.includes("1630") || identity.includes("largecarpet")) return "1630";
  return null;
}

function normalizeBooleanAttribute(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["是", "yes", "true", "1"].includes(normalized)) return true;
  if (["否", "no", "false", "0"].includes(normalized)) return false;
  return null;
}

function classifyRugReportFromBooleanThresholds(fields) {
  const longest = fields.find((field) => /最长边大于\s*1[.]8|longest\s+side.*1[.]8/i.test(field.name));
  const area = fields.find((field) => /面积大于\s*2[.]16|area.*2[.]16/i.test(field.name));
  if (!longest && !area) return null;
  const blockers = [];
  const readValue = (field, label) => {
    if (!field) {
      blockers.push({ code: "ATTRIBUTE_SOURCE_MISSING", message: `缺少官方属性“${label}”，无法判定 1630/1631` });
      return null;
    }
    const rawValue = [...asArray(field.valueLabels), field.customValue].filter(Boolean).join(" / ");
    const value = normalizeBooleanAttribute(rawValue);
    if (value === null) {
      blockers.push({ code: "ATTRIBUTE_VALUE_UNRESOLVED", message: `官方属性“${field.name}”当前值缺失或无法识别，无法判定 1630/1631` });
    }
    return value;
  };
  const longestValue = readValue(longest, "是否最长边大于1.8m");
  const areaValue = readValue(area, "是否面积大于2.16m²");
  return {
    reportType: blockers.length ? null : (longestValue || areaValue ? "1630" : "1631"),
    longestEdgeCm: null,
    areaM2: null,
    evidence: [longest, area].filter(Boolean).map((field) => ({
      attributeId: field.id,
      attributeName: field.name,
      rawValue: [...asArray(field.valueLabels), field.customValue].filter(Boolean).join(" / "),
      valueId: field.valueIds?.[0] || "",
      unit: "",
      normalizedUnit: "boolean",
      normalizedValue: normalizeBooleanAttribute([...asArray(field.valueLabels), field.customValue].filter(Boolean).join(" / ")) ? 1 : 0,
    })),
    blockers,
  };
}

async function readStoreData(storeId, summary = false) {
  return legacyRequest(
    `/api/shein/stores/${encodeURIComponent(storeId)}/data${summary ? "?summary=1" : ""}`,
  );
}

async function readCompliance(storeId, skc = "") {
  const suffix = skc ? `?skc=${encodeURIComponent(skc)}` : "";
  return legacyRequest(`/api/shein/stores/${encodeURIComponent(storeId)}/compliance${suffix}`);
}

async function readComplianceJob(storeId) {
  return legacyRequest(
    `/api/shein/stores/${encodeURIComponent(storeId)}/compliance/sync/status`,
  );
}

async function readComplianceRow(storeId, skc) {
  const result = await readCompliance(storeId, skc);
  const rows = result.data?.rows || (result.data?.skc ? [result.data] : []);
  return rows.find((row) => String(row.skc) === String(skc)) || null;
}

async function readComplianceRules(storeId, skc) {
  return legacyRequest(
    `/api/shein/stores/${encodeURIComponent(storeId)}/compliance/rules`,
    { method: "POST", body: { skc } },
  );
}

async function readProductForCompliance(storeId, skc) {
  return legacyRequest(
    `/api/shein/stores/${encodeURIComponent(storeId)}/products/identify`,
    { method: "POST", body: { skc } },
  );
}

async function readAttributeTemplateForCompliance(storeId, productTypeId) {
  return legacyRequest(
    `/api/shein/stores/${encodeURIComponent(storeId)}/template/attributes`,
    { method: "POST", body: { productTypeId, force: true } },
  );
}

async function readLocalAttributeTemplates(storeId, productTypeId) {
  return legacyRequest(
    `/api/attribute-templates?storeId=${encodeURIComponent(storeId)}&productTypeId=${encodeURIComponent(productTypeId)}`,
  );
}

async function runLocalCompliancePreflight(storeId, skc, draft, detail) {
  let result = {};
  let remoteAvailable = true;
  try {
    result = await legacyRequest(
      `/api/shein/stores/${encodeURIComponent(storeId)}/compliance/preflight`,
      {
        method: "POST",
        body: {
          skcList: [skc],
          inputsBySkc: { [skc]: draft?.inputs || {} },
        },
      },
    );
  } catch (error) {
    if (String(error?.code || "") !== "ROUTE_NOT_FOUND") throw error;
    remoteAvailable = false;
  }
  const plan = result.plans?.[0] || result.preflight?.plans?.[0] || null;
  const blockers = [
    ...(detail.item.reportDecision?.blockers || []),
    ...(plan?.blockers || []),
  ];
  if (remoteAvailable && !plan) {
    blockers.push({ code: "COMPLIANCE_PREFLIGHT_UNAVAILABLE", message: "本地服务端未返回可验证的合规 dry-run 计划，不能标记为就绪" });
  }
  const preflight = {
    id: `local-preflight-${randomUUID()}`,
    skc,
    status: blockers.length ? "blocked" : plan?.status || "rules_pending",
    executable: false,
    counts: {
      actions: Number(plan?.counts?.actions || plan?.actions?.length || 0),
      blockers: blockers.length,
      warnings: Number(plan?.counts?.warnings || plan?.warnings?.length || 0),
      waiting: Number(plan?.counts?.waiting || plan?.waiting?.length || 0),
    },
    blockers,
    warnings: plan?.warnings || [],
    waitingCount: Number(plan?.counts?.waiting || plan?.waiting?.length || 0),
    actionTypes: asArray(plan?.actions).map((action) => String(action.type || "")),
    actionSummaries: asArray(plan?.actions),
    ruleSnapshots: detail.snapshots.map((snapshot) => ({
      ruleType: snapshot.ruleType,
      fingerprint: snapshot.traceId || "local-rule-snapshot",
      fetchedAt: snapshot.fetchedAt,
      expiresAt: snapshot.expiresAt,
    })),
    inputFingerprint: "local-draft-input",
    ruleFingerprint: "local-rule-snapshot",
    mediaFingerprint: "local-media-evidence",
    requirementRuleSnapshotId: detail.snapshots.find((snapshot) => snapshot.ruleType === "compliance_requirement")?.traceId || "local-requirements",
    certificateRuleSnapshotId: detail.snapshots.find((snapshot) => snapshot.ruleType === "certificate_schema")?.traceId || null,
    createdAt: new Date().toISOString(),
    currentForDraft: true,
    currentForRules: true,
    currentForMedia: true,
    publishingEnabled: false,
  };
  draft.preflight = {
    evaluated: true,
    savedExecutable: false,
    blockerCount: preflight.counts.blockers,
    warningCount: preflight.counts.warnings,
    waitingCount: preflight.counts.waiting,
    blockers: preflight.blockers,
    warnings: preflight.warnings,
  };
  draft.updatedAt = preflight.createdAt;
  draftCache.set(`${storeId}:${skc}`, draft);
  return preflight;
}

async function buildComplianceDetail(storeId, item, row, bundle) {
  const productResult = await readProductForCompliance(storeId, item.skc);
  const productDetail = productResult.detail || {};
  const productTypeId = String(productDetail.productTypeId || "");
  const attributeResult = productTypeId
    ? await readAttributeTemplateForCompliance(storeId, productTypeId)
    : { info: null };
  const templateResult = productTypeId
    ? await readLocalAttributeTemplates(storeId, productTypeId)
    : { templates: [] };
  const template = (templateResult.templates || []).find((candidate) =>
    String(candidate.productTypeId || "") === productTypeId,
  ) || null;
  const traceId = productResult.diagnostics?.detail?.traceId || null;
  const attributes = buildAttributeProjection(
    productDetail,
    attributeResult.info,
    template,
    traceId,
  );
  const reportDecision = buildReportDecision(bundle, attributes);
  const detail = {
    item: {
      ...item,
      attributeSnapshot: attributes.snapshot,
      reportDecision,
    },
    records: complianceRecords(row, bundle),
    snapshots: complianceSnapshots(row, bundle),
    draft: null,
    workspaceCapabilities: {
      mode: "local_direct",
      refreshCurrentSkc: true,
      directReportStorage: true,
      photoTemplateApply: true,
      reportTemplateApply: false,
      photoShare: true,
      photoBindingDiagnostic: true,
      photoSubmit: true,
      reportSubmit: false,
    },
    editorModel: buildEditorModel(row, bundle),
    latestPreflight: null,
    preflightHistory: [],
    latestPreflightReviews: [],
    releaseGate: {
      publishingEnabled: false,
      blockerCount: reportDecision?.blockers?.length || 0,
      blockers: reportDecision?.blockers || [],
    },
  };
  detailCache.set(`${storeId}:${item.skc}`, detail);
  return detail;
}

async function getStore(storeId) {
  const result = await legacyRequest("/api/shein/stores");
  const store = (result.stores || []).find(
    (item) =>
      String(item.id) === String(storeId) && item.source !== "cloud-authorization",
  );
  if (!store) {
    const error = new Error("未找到已连接店铺");
    error.status = 404;
    error.code = "STORE_NOT_FOUND";
    throw error;
  }
  return store;
}

async function getWorkspace(storeId, url) {
  const [business, compliance] = await Promise.all([
    readStoreData(storeId),
    readCompliance(storeId),
  ]);
  const products = business.data?.products || [];
  const rows = compliance.data?.rows || [];
  const rowsBySkc = new Map(rows.map((row) => [String(row.skc), row]));
  const syncedAt = compliance.data?.syncedAt || null;
  let items = products.map((product) => workspaceItem(
    product,
    rowsBySkc.get(String(product.skc)),
    syncedAt,
  ));
  if (!items.length) {
    items = rows.map((row) => workspaceItem(null, row, syncedAt));
  }
  const query = String(url.searchParams.get("q") || "").trim().toLowerCase();
  const status = String(url.searchParams.get("status") || "").trim();
  if (query) items = items.filter((item) => `${item.skc} ${item.supplierCode}`.toLowerCase().includes(query));
  if (status) items = items.filter((item) => item.complianceStatus === status);
  items.sort((left, right) => {
    const leftPriority = complianceStatusPriority[left.complianceStatus] ?? 4;
    const rightPriority = complianceStatusPriority[right.complianceStatus] ?? 4;
    return leftPriority - rightPriority || String(left.skc).localeCompare(String(right.skc));
  });
  const requestedPage = Number(url.searchParams.get("page") || 1);
  const requestedPageSize = Number(url.searchParams.get("pageSize") || 50);
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const pageSize = Number.isInteger(requestedPageSize) && requestedPageSize > 0
    ? Math.min(100, requestedPageSize) : 50;
  const total = items.length;
  const pageCount = total ? Math.ceil(total / pageSize) : 0;
  const auditSummary = {
    notRun: items.filter((item) => !item.snapshot).length,
    needsRerun: 0,
    pending: items.filter((item) => ["待补充", "审核中", "待同步"].includes(item.complianceStatus)).length,
    reviewed: 0,
  };
  const complianceSummary = {
    total: items.length,
    nonCompliant: items.filter((item) => ["需修正", "待补充"].includes(item.complianceStatus)).length,
    inProgress: items.filter((item) => ["审核中", "待同步"].includes(item.complianceStatus)).length,
    passed: items.filter((item) => item.complianceStatus === "通过").length,
  };
  return {
    items: items.slice((page - 1) * pageSize, page * pageSize),
    auditSummary,
    complianceSummary,
    pagination: { page, pageSize, total, pageCount },
  };
}

function listJobs(storeId, filters) {
  let result = Array.from(jobs.values()).filter((job) => job.storeId === storeId);
  if (filters.state) result = result.filter((job) => job.state === filters.state);
  if (filters.jobType) result = result.filter((job) => job.jobType === filters.jobType);
  return result.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export function createV2LocalRealServer() {
  ensureLocalStateLoaded();
  return http.createServer(async (request, response) => {
    if (request.method === "OPTIONS") return json(response, 204, {});
    const url = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);
    try {
      if (request.method === "GET" && url.pathname === "/health") {
        return json(response, 200, { ok: true, service: "shein-v2-local-real" });
      }
      if (request.method === "GET" && url.pathname === "/v1/web/session") {
        return json(response, 200, {
          authenticated: true,
          tenant: { id: "tenant-local", name: "SHEIN涵舟工作室 · 本地" },
          user: {
            id: "user-local",
            email: "local@hanzhou.icu",
            displayName: "本地验收管理员",
            role: "owner",
          },
          expiresAt: "2099-01-01T00:00:00.000Z",
        });
      }
      if (request.method === "GET" && url.pathname === "/v1/web/stores") {
        const result = await legacyRequest("/api/shein/stores");
        const stores = (result.stores || []).filter(
          (store) => store.source !== "cloud-authorization",
        );
        return json(response, 200, {
          stores: stores.map((store) => publicStore(store)),
          count: stores.length,
        });
      }
      if (request.method === "POST" && url.pathname === "/v1/web/shein/auth/start") {
        const result = await legacyRequest("/api/shein/auth/url", { method: "POST", body: {} });
        return json(response, 200, {
          authorizationUrl: result.url,
          expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        });
      }

      const storeMatch = url.pathname.match(/^\/v1\/web\/stores\/([^/]+)(?:\/(.*))?$/);
      if (!storeMatch) return json(response, 404, { code: "ROUTE_NOT_FOUND", msg: "接口不存在" });
      const storeId = decodeURIComponent(storeMatch[1]);
      const suffix = storeMatch[2] || "";
      await getStore(storeId);

      if (request.method === "PATCH" && !suffix) {
        const result = await legacyRequest(
          `/api/shein/stores/${encodeURIComponent(storeId)}`,
          { method: "PATCH", body: await readBody(request) },
        );
        return json(response, 200, {
          store: publicStore(result.store),
        });
      }
      if (request.method === "GET" && suffix === "business-dashboard") {
        const result = await readStoreData(storeId);
        const lastJob = listJobs(storeId, { jobType: "store_business_refresh" })[0] || null;
        return json(response, 200, dashboardFromBusiness(storeId, result.data, result.syncedAt, lastJob));
      }
      if (request.method === "POST" && suffix === "business-dashboard") {
        const now = new Date().toISOString();
        const job = {
          id: `local-business-${Date.now()}`,
          storeId,
          jobType: "store_business_refresh",
          state: "running",
          progress: { snapshotStored: false },
          error: null,
          createdAt: now,
          startedAt: now,
          completedAt: null,
          updatedAt: now,
        };
        jobs.set(job.id, job);
        try {
          const result = await legacyRequest(`/api/shein/stores/${encodeURIComponent(storeId)}/sync`, {
            method: "POST",
            body: {},
          });
          job.state = "succeeded";
          job.progress = {
            total: result.data?.productCount || result.data?.products?.length || 0,
            processed: result.data?.productCount || result.data?.products?.length || 0,
            succeeded: result.data?.productCount || result.data?.products?.length || 0,
            failed: 0,
            snapshotStored: true,
          };
          job.completedAt = result.syncedAt || new Date().toISOString();
          job.updatedAt = job.completedAt;
          return json(response, 200, dashboardFromBusiness(storeId, result.data, result.syncedAt, mapBusinessJob(job)));
        } catch (error) {
          job.state = "failed";
          const failure = errorPayload(error, "BUSINESS_SYNC_FAILED");
          job.error = { code: failure.code, message: failure.msg };
          job.completedAt = new Date().toISOString();
          job.updatedAt = job.completedAt;
          throw error;
        }
      }
      if (request.method === "GET" && suffix === "products") {
        const result = await readStoreData(storeId);
        const products = result.data?.products || [];
        const pageNum = Math.max(1, Number(url.searchParams.get("pageNum") || 1));
        const pageSize = Math.max(1, Math.min(100, Number(url.searchParams.get("pageSize") || 30)));
        return json(response, 200, {
          products: products.slice((pageNum - 1) * pageSize, pageNum * pageSize),
          count: products.length,
          total: products.length,
          pageNum,
          pageSize,
        });
      }
      if (request.method === "POST" && suffix === "compliance/refresh") {
        const result = await legacyRequest(`/api/shein/stores/${encodeURIComponent(storeId)}/compliance/sync`, {
          method: "POST",
          body: await readBody(request),
        });
        const job = mapComplianceJob(result.job);
        if (job) jobs.set(job.id, { ...job, storeId });
        for (const key of detailCache.keys()) {
          if (key.startsWith(`${storeId}:`)) detailCache.delete(key);
        }
        return json(response, 202, { started: result.started !== false, job });
      }
      if (request.method === "GET" && suffix === "compliance-workspace") {
        return json(response, 200, await getWorkspace(storeId, url));
      }
      const mediaTicketMatch = suffix.match(/^media\/upload-ticket$/);
      if (request.method === "POST" && mediaTicketMatch) {
        const input = await readBody(request);
        const asset = {
          id: `local-media-${randomUUID()}`,
          storeId,
          purpose: String(input.purpose || "compliance_evidence"),
          status: "pending_upload",
          originalName: String(input.originalName || "未命名文件"),
          contentType: String(input.contentType || "application/octet-stream"),
          sizeBytes: Number(input.sizeBytes || 0),
          width: null,
          height: null,
          referenceCount: 0,
          expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          createdAt: new Date().toISOString(),
        };
        mediaCache.set(asset.id, { asset, bytes: null });
        persistLocalState();
        return json(response, 200, {
          asset,
          upload: {
            method: "PUT",
            url: `/v1/web/stores/${encodeURIComponent(storeId)}/media/${encodeURIComponent(asset.id)}/content`,
            headers: { "Content-Type": asset.contentType },
            expiresAt: asset.expiresAt,
          },
        });
      }
      const mediaContentMatch = suffix.match(/^media\/([^/]+)\/content$/);
      if (request.method === "GET" && mediaContentMatch) {
        const assetId = decodeURIComponent(mediaContentMatch[1]);
        const entry = mediaCache.get(assetId);
        if (!entry || entry.asset.storeId !== storeId) {
          return json(response, 404, { code: "MEDIA_ASSET_NOT_FOUND", msg: "本地媒体暂存记录不存在" });
        }
        if (!entry.bytes && entry.filePath && existsSync(entry.filePath)) {
          entry.bytes = readFileSync(entry.filePath);
        }
        if (!entry.bytes || entry.asset.status !== "ready") {
          return json(response, 409, { code: "MEDIA_UPLOAD_INCOMPLETE", msg: "实拍图片尚未上传完成" });
        }
        response.writeHead(200, {
          "Content-Type": entry.asset.contentType,
          "Cache-Control": "private, max-age=300",
          "Content-Length": entry.bytes.length,
        });
        response.end(entry.bytes);
        return;
      }
      if (request.method === "PUT" && mediaContentMatch) {
        const assetId = decodeURIComponent(mediaContentMatch[1]);
        const entry = mediaCache.get(assetId);
        if (!entry || entry.asset.storeId !== storeId) {
          return json(response, 404, { code: "MEDIA_ASSET_NOT_FOUND", msg: "本地媒体暂存记录不存在" });
        }
        const chunks = [];
        let size = 0;
        for await (const chunk of request) {
          size += chunk.length;
          if (size > 20 * 1024 * 1024) {
            return json(response, 413, { code: "MEDIA_TOO_LARGE", msg: "实拍图片不能超过 20MB" });
          }
          chunks.push(chunk);
        }
        entry.bytes = Buffer.concat(chunks);
        mkdirSync(localMediaDir, { recursive: true, mode: 0o700 });
        entry.filePath = entry.filePath || path.join(localMediaDir, `${assetId}.bin`);
        writeFileSync(entry.filePath, entry.bytes, { mode: 0o600 });
        persistLocalState();
        return json(response, 200, { ok: true });
      }
      const mediaCompleteMatch = suffix.match(/^media\/([^/]+)\/complete$/);
      if (request.method === "POST" && mediaCompleteMatch) {
        const assetId = decodeURIComponent(mediaCompleteMatch[1]);
        const entry = mediaCache.get(assetId);
        if (!entry || entry.asset.storeId !== storeId) {
          return json(response, 404, { code: "MEDIA_ASSET_NOT_FOUND", msg: "本地媒体暂存记录不存在" });
        }
        if (!entry.bytes && entry.filePath && existsSync(entry.filePath)) {
          entry.bytes = readFileSync(entry.filePath);
        }
        if (!entry.bytes) {
          return json(response, 409, { code: "MEDIA_UPLOAD_INCOMPLETE", msg: "实拍图片尚未上传完成" });
        }
        entry.asset.status = "ready";
        entry.asset.sizeBytes = entry.bytes.length;
        const completion = await readBody(request);
        const requestedSha256 = String(completion.sha256 || "").trim();
        const actualSha256 = createHash("sha256").update(entry.bytes).digest("hex");
        if (requestedSha256 && requestedSha256 !== actualSha256) {
          return json(response, 409, { code: "MEDIA_DIGEST_MISMATCH", msg: "实拍图片校验失败，请重新上传" });
        }
        const width = Number(completion.width || 0);
        const height = Number(completion.height || 0);
        entry.asset.width = Number.isInteger(width) && width > 0 ? width : null;
        entry.asset.height = Number.isInteger(height) && height > 0 ? height : null;
        persistLocalState();
        return json(response, 200, { asset: entry.asset, alreadyCompleted: false });
      }
      const templateMatch = suffix.match(/^publish-templates(?:\/([^/]+))?$/);
      if (request.method === "GET" && templateMatch) {
        const type = url.searchParams.get("type") || "";
        const result = await legacyRequest(
          `/api/templates?storeId=${encodeURIComponent(storeId)}${type ? `&type=${encodeURIComponent(type)}` : ""}`,
        );
        return json(response, 200, { templates: result.templates || [], count: (result.templates || []).length });
      }
      const photoTemplateMatch = suffix.match(/^compliance\/photo-templates\/([^/]+)\/apply$/);
      if (request.method === "POST" && photoTemplateMatch) {
        const templateId = decodeURIComponent(photoTemplateMatch[1]);
        const input = await readBody(request);
        const templateResult = await legacyRequest(
          `/api/templates?storeId=${encodeURIComponent(storeId)}&type=compliance`,
        );
        const template = (templateResult.templates || []).find((candidate) => String(candidate.id) === templateId);
        if (!template) {
          return json(response, 404, { code: "COMPLIANCE_PHOTO_TEMPLATE_NOT_FOUND", msg: "实拍图模板不存在或不属于当前店铺" });
        }
        const photos = asArray(asObject(template.data).defaults?.photos).filter((photo) =>
          ["1", "2"].includes(String(photo?.labelGroup || "")) && String(photo?.localAssetRef || "").startsWith("media:"),
        ).map((photo) => ({
          ...photo,
          photoSlot: undefined,
        }));
        const key = `${storeId}:${String(input.skc || "")}`;
        const existing = draftCache.get(key) || {
          id: `local-draft-${randomUUID()}`,
          storeId,
          skc: String(input.skc || ""),
          templateId: null,
          requirementSnapshot: {},
          inputs: { certificates: [], agencies: [], warnings: [], photos: [] },
          preflight: {},
          status: "draft",
          updatedAt: null,
        };
        const templateGroups = new Set(photos.map((photo) => photoSlotGroup(photo)));
        const mergedPhotos = [
          ...asArray(existing.inputs?.photos).filter((photo) => !templateGroups.has(photoSlotGroup(photo))),
          ...photos,
        ];
        draftCache.set(key, { ...existing, inputs: { ...asObject(existing.inputs), photos: mergedPhotos }, updatedAt: new Date().toISOString() });
        persistLocalState();
        return json(response, 200, { templateId, skc: String(input.skc || ""), externalWrite: false, photos });
      }
      const applyTemplateMatch = suffix.match(/^compliance\/templates\/([^/]+)\/apply$/);
      if (request.method === "POST" && applyTemplateMatch) {
        const templateId = decodeURIComponent(applyTemplateMatch[1]);
        const input = await readBody(request);
        const templateResult = await legacyRequest(
          `/api/templates?storeId=${encodeURIComponent(storeId)}&type=compliance`,
        );
        const template = (templateResult.templates || []).find((candidate) =>
          String(candidate.id) === templateId,
        );
        if (!template) {
          return json(response, 404, { code: "COMPLIANCE_TEMPLATE_NOT_FOUND", msg: "合规模板不存在或不属于当前店铺" });
        }
        const skcNames = Array.from(new Set(asArray(input.skcNames).map(String).filter(Boolean)));
        const items = [];
        for (const skc of skcNames) {
          const workspace = await getWorkspace(storeId, new URL(`${url.origin}/v1/web/stores/${encodeURIComponent(storeId)}/compliance-workspace?q=${encodeURIComponent(skc)}&pageSize=100`));
          const item = workspace.items.find((candidate) => candidate.skc === skc);
          if (!item) {
            items.push({ skc, status: "failed", blockers: [{ code: "COMPLIANCE_SKC_NOT_FOUND", message: "当前经营数据中未找到该 SKC" }], warnings: [] });
            continue;
          }
          const sourceData = asObject(template.data);
          const defaults = asObject(sourceData.defaults);
          const now = new Date().toISOString();
          const draft = {
            id: `local-draft-${randomUUID()}`,
            storeId,
            skc,
            templateId,
            requirementSnapshot: {
              requirements: sourceData.requirements || [],
              fetchedAt: sourceData.ruleFetchedAt || null,
              expiresAt: sourceData.ruleExpiresAt || null,
            },
            inputs: {
              certificates: asArray(defaults.certificates),
              agencies: asArray(defaults.agencies),
              warnings: asArray(defaults.warnings),
              photos: asArray(defaults.photos),
            },
            preflight: {},
            status: "draft",
            updatedAt: now,
          };
          draftCache.set(`${storeId}:${skc}`, draft);
          persistLocalState();
          items.push({ skc, status: "saved", draft: publicDraft(draft), blockers: [], warnings: [] });
        }
        return json(response, 200, {
          templateId,
          generatedAt: new Date().toISOString(),
          externalWrite: false,
          items,
          summary: {
            requested: skcNames.length,
            saved: items.filter((item) => item.status === "saved").length,
            blocked: items.filter((item) => item.status === "blocked").length,
            failed: items.filter((item) => item.status === "failed").length,
          },
        });
      }
      const draftMatch = suffix.match(/^compliance\/drafts\/([^/]+)$/);
      if ((request.method === "GET" || request.method === "PUT") && draftMatch) {
        const skc = decodeURIComponent(draftMatch[1]);
        const key = `${storeId}:${skc}`;
        if (request.method === "GET") {
          return json(response, 200, { draft: publicDraft(draftCache.get(key)) });
        }
        const input = await readBody(request);
        const existing = draftCache.get(key) || null;
        if (String(input.expectedUpdatedAt || "") !== String(existing?.updatedAt || "")) {
          if (existing && input.expectedUpdatedAt !== existing.updatedAt) {
            return json(response, 409, { code: "COMPLIANCE_DRAFT_CONFLICT", msg: "合规草稿已被其他本地页面更新，请重新读取后再保存" });
          }
        }
        const now = new Date().toISOString();
        const draft = {
          id: existing?.id || `local-draft-${randomUUID()}`,
          storeId,
          skc,
          templateId: input.templateId || existing?.templateId || null,
          requirementSnapshot: asObject(input.requirementSnapshot),
          inputs: asObject(input.inputs),
          preflight: asObject(input.preflight),
          status: String(input.status || "draft"),
          updatedAt: now,
        };
        draftCache.set(key, draft);
        persistLocalState();
        return json(response, 200, { draft: publicDraft(draft) });
      }
      const reportMatch = suffix.match(/^compliance\/reports\/([^/]+)$/);
      if ((request.method === "GET" || request.method === "PUT") && reportMatch) {
        const skc = decodeURIComponent(reportMatch[1]);
        const key = `${storeId}:${skc}`;
        if (request.method === "GET") {
          return json(response, 200, { report: reportCache.get(key) || null });
        }
        const input = await readBody(request);
        const assignment = asObject(input.assignment);
        const identity = `${assignment.certificateTypeCode || ""} ${assignment.certificateTypeName || ""}`.toLowerCase();
        if (!identity.includes("1630") && !identity.includes("1631") && !identity.includes("smallcarpet") && !identity.includes("largecarpet")) {
          return json(response, 422, { code: "COMPLIANCE_REPORT_TYPE_INVALID", msg: "当前接口只接受 1630/1631 当前 SKC 单独报告" });
        }
        const report = {
          storeId,
          skc,
          assignment: { ...assignment, skc },
          updatedAt: new Date().toISOString(),
        };
        reportCache.set(key, report);
        persistLocalState();
        return json(response, 200, { report });
      }
      const preflightMatch = suffix.match(/^compliance-workspace\/([^/]+)\/preflight$/);
      const photoBindContractCheckMatch = suffix.match(/^compliance-workspace\/([^/]+)\/photos\/bind-contract-check$/);
      const photoSubmitMatch = suffix.match(/^compliance-workspace\/([^/]+)\/photos\/submit$/);
      if (request.method === "POST" && photoBindContractCheckMatch) {
        const skc = decodeURIComponent(photoBindContractCheckMatch[1]);
        const detail = detailCache.get(`${storeId}:${skc}`);
        const input = await readBody(request);
        const assignments = asArray(input.photos);
        const requirements = asArray(detail?.records).filter((record) =>
          ["body_photo", "package_photo"].includes(record.requirementType),
        );
        // SHEIN 的 skc-label-list 只有两个官方分组：
        // 1 = 商品本体，2 = 包装（原始文档描述为外包装）。
        const officialGroups = [
          { officialGroup: "product", localGroup: "body", label: "商品本体实拍图", labelGroup: "1" },
          { officialGroup: "package", localGroup: "package", label: "包装实拍图", labelGroup: "2" },
        ];
        const checks = officialGroups.map(({ officialGroup, localGroup, label, labelGroup }) => {
          const localAssignments = assignments.filter((photo) => photoSlotGroup(photo) === localGroup);
          const labelIds = [...new Set(requirements
            .filter((record) => String(record.data?.labelGroup || "") === labelGroup)
            .map((record) => record.data?.labelId)
            .filter((value) => value !== undefined && value !== null))];
          return {
            officialGroup,
            label,
            labelGroup,
            labelIds,
            localPhotoCount: localAssignments.length,
            status: localAssignments.length ? "candidate" : "missing_local_photo",
            message: localAssignments.length
              ? officialGroup === "package"
                ? `已找到 ${localAssignments.length} 张本地包装实拍图；只会写入 packageLableList`
                : `已找到 ${localAssignments.length} 张本地商品本体实拍图；只会写入 bodyLableList`
              : `当前没有本地${label}`,
          };
        });
        const missingOfficialFields = [
          "历史图片覆盖/删除字段及其替换语义（当前官方文档仅定义重新绑定，不提供删除字段）",
        ];
        return json(response, 200, {
          externalWrite: false,
          requestPath: SHEIN_COMPLIANCE_WRITE_PATHS.photoBind,
          uploadPath: SHEIN_COMPLIANCE_WRITE_PATHS.photoUpload,
          status: "candidate_only",
          fields: {
            skc,
            bindBodyAfterUpload: {
              skcList: [skc],
              packageLableList: assignments
                .filter((photo) => photoSlotGroup(photo) === "package")
                .map((photo) => ({
                  sourceFileName: photo.fileName || null,
                  imageUrl: "<由上传接口返回>",
                  imageMd5: "<由上传接口返回>",
                })),
              bodyLableList: assignments
                .filter((photo) => photoSlotGroup(photo) === "body")
                .map((photo) => ({
                  sourceFileName: photo.fileName || null,
                  imageUrl: "<由上传接口返回>",
                  imageMd5: "<由上传接口返回>",
                })),
            },
            photoGroups: officialGroups.map(({ officialGroup, localGroup, label, labelGroup }) => ({
              officialGroup,
              label,
              labelGroup,
              localPhotos: assignments
                .filter((photo) => photoSlotGroup(photo) === localGroup)
                .map((photo) => ({
                  photoSlot: photo?.photoSlot || null,
                  labelId: photo?.labelId ?? null,
                  labelGroup: photo?.labelGroup || null,
                  localAssetRef: photo?.localAssetRef || null,
                  uploadedPictureId: photo?.uploadedPictureId ?? null,
                  sheinImageUrl: photo?.sheinImageUrl || null,
                  fileName: photo?.fileName || null,
                })),
            })),
          },
          missingOfficialFields,
          checks,
        });
      }
      if (request.method === "POST" && photoSubmitMatch) {
        const skc = decodeURIComponent(photoSubmitMatch[1]);
        const input = await readBody(request);
        if (String(input.confirmation || "") !== "提交当前SKC实拍图") {
          return json(response, 409, {
            code: "PHOTO_SUBMIT_CONFIRMATION_REQUIRED",
            msg: "提交前必须确认当前 SKC 和实拍图分组",
          });
        }
        const draft = draftCache.get(`${storeId}:${skc}`);
        const detail = detailCache.get(`${storeId}:${skc}`);
        if (!detail || !asArray(detail.snapshots).length) {
          return json(response, 409, {
            code: "PHOTO_RULE_SNAPSHOT_REQUIRED",
            msg: "请先刷新当前 SKC 的官方合规规则后再提交",
          });
        }
        const photos = asArray(draft?.inputs?.photos);
        if (!draft) {
          return json(response, 409, {
            code: "PHOTO_DRAFT_REQUIRED",
            msg: "请先上传实拍图并保存当前 SKC 草稿",
          });
        }
        const requiredGroups = requiredPhotoGroups(detail);
        if (!requiredGroups.body && !requiredGroups.package) {
          return json(response, 409, {
            code: "PHOTO_NO_FAILED_GROUP",
            msg: "当前 SKC 没有失败或待补充的实拍图分组，无需重复提交",
          });
        }
        const selectedPhotos = photos.filter((photo) => {
          const group = photoSlotGroup(photo);
          return requiredGroups[group] === true;
        });
        const hasBodyPhoto = selectedPhotos.some(
          (photo) => photoSlotGroup(photo) === "body",
        );
        const packagePhotos = selectedPhotos.filter(
          (photo) => photoSlotGroup(photo) === "package",
        );
        const bodyPhotos = selectedPhotos.filter(
          (photo) => photoSlotGroup(photo) === "body",
        );
        if (packagePhotos.length > 15 || bodyPhotos.length > 15) {
          return json(response, 422, {
            code: "PHOTO_GROUP_LIMIT_EXCEEDED",
            msg: "商品本体实拍图和商品包装实拍图每组最多上传 15 张",
          });
        }
        const missingGroups = [
          ...(requiredGroups.body && !hasBodyPhoto ? ["商品本体实拍图"] : []),
          ...(requiredGroups.package && !packagePhotos.length
            ? ["商品包装实拍图"]
            : []),
        ];
        if (missingGroups.length) {
          return json(response, 422, {
            code: "PHOTO_REQUIRED_GROUP_MISSING",
            msg: `请先补齐当前失败分组：${missingGroups.join("；")}`,
            requiredGroups,
          });
        }

        const uploadedByAssetId = new Map();
        const packageLableList = [];
        const bodyLableList = [];
        const uploads = [];
        for (const photo of selectedPhotos) {
          const group = photoSlotGroup(photo);
          const { assetId, entry } = localMediaEntry(storeId, photo.localAssetRef);
          const fileName = String(photo.fileName || entry.asset.originalName || "compliance-photo.jpg");
          const mimeType = String(photo.mimeType || entry.asset.contentType || "");
          const width = Number(photo.width || entry.asset.width || 0);
          const height = Number(photo.height || entry.asset.height || 0);
          buildPhotoUploadRequest({
            fileName,
            mimeType,
            size: entry.bytes.length,
            width,
            height,
          });
          let upload = uploadedByAssetId.get(assetId);
          if (!upload) {
            upload = await legacyBinaryRequest(
              `/api/local/shein/stores/${encodeURIComponent(storeId)}/upload-compliance-photo`,
              {
                bytes: entry.bytes,
                contentType: mimeType,
                fileName,
                width,
                height,
              },
            );
            uploadedByAssetId.set(assetId, upload);
            uploads.push({
              photoSlot: photo.photoSlot || null,
              fileName,
              traceId: upload.diagnostics?.traceId || null,
            });
          }
          const receipt = {
            imageUrl: String(upload.info?.imageUrl || ""),
            imageMd5: String(upload.info?.imageMd5 || ""),
          };
          if (group === "package") packageLableList.push(receipt);
          else bodyLableList.push(receipt);
        }

        const bindBody = buildPhotoBindBody({
          skcList: [skc],
          packageLableList,
          bodyLableList,
        });
        const dryRun = await legacyRequest(
          `/api/shein/stores/${encodeURIComponent(storeId)}/compliance/photos/bind`,
          { method: "POST", body: { payload: bindBody, execute: false } },
        );
        const executed = await legacyRequest(
          `/api/shein/stores/${encodeURIComponent(storeId)}/compliance/photos/bind`,
          {
            method: "POST",
            body: {
              payload: bindBody,
              execute: true,
              confirmationToken: dryRun.confirmationToken,
            },
          },
        );
        let readback = null;
        let readbackWarning = null;
        try {
          readback = await legacyRequest(
            `/api/shein/stores/${encodeURIComponent(storeId)}/compliance/sync`,
            { method: "POST", body: { skcList: [skc] } },
          );
        } catch (error) {
          readbackWarning = {
            code: error.code || "PHOTO_READBACK_SYNC_FAILED",
            message: error.message,
          };
        }
        detailCache.delete(`${storeId}:${skc}`);
        return json(response, 200, {
          ...executed,
          externalWrite: true,
          uploads,
          readback,
          readbackWarning,
          historyMutation: "not_documented",
        });
      }
      if (request.method === "POST" && preflightMatch) {
        const skc = decodeURIComponent(preflightMatch[1]);
        const draft = draftCache.get(`${storeId}:${skc}`);
        const detail = detailCache.get(`${storeId}:${skc}`);
        if (!draft || !detail) {
          return json(response, 409, { code: "COMPLIANCE_PREFLIGHT_NEEDS_DETAIL", msg: "请先刷新当前 SKC 的合规数据并保存本地草稿" });
        }
        const preflight = await runLocalCompliancePreflight(storeId, skc, draft, detail);
        const nextDetail = {
          ...detail,
          draft: draftProjection(draft),
          item: { ...detail.item, draft: draftProjection(draft) },
          latestPreflight: preflight,
          preflightHistory: [preflight],
          releaseGate: {
            publishingEnabled: false,
            blockerCount: preflight.counts.blockers,
            blockers: preflight.blockers,
          },
        };
        detailCache.set(`${storeId}:${skc}`, nextDetail);
        return json(response, 200, { preflight });
      }
      const photoShareMatch = suffix.match(/^compliance-workspace\/([^/]+)\/photos\/share$/);
      if (request.method === "POST" && photoShareMatch) {
        const sourceSkc = decodeURIComponent(photoShareMatch[1]);
        const input = await readBody(request);
        const photos = asArray(input.photos);
        const targetSkcs = Array.from(new Set(asArray(input.targetSkcs).map(String).filter((target) => target && target !== sourceSkc)));
        const workspace = await getWorkspace(storeId, new URL(`${url.origin}/v1/web/stores/${encodeURIComponent(storeId)}/compliance-workspace?page=1&pageSize=100`));
        const knownSkcs = new Set(workspace.items.map((item) => item.skc));
        const items = [];
        for (const targetSkc of targetSkcs) {
          if (!knownSkcs.has(targetSkc)) {
            items.push({ skc: targetSkc, status: "failed", message: "当前经营数据中未找到该 SKC" });
            continue;
          }
          const targetKey = `${storeId}:${targetSkc}`;
          const existing = draftCache.get(targetKey) || {
            id: `local-draft-${randomUUID()}`,
            storeId,
            skc: targetSkc,
            templateId: null,
            requirementSnapshot: {},
            inputs: { certificates: [], agencies: [], warnings: [], photos: [] },
            preflight: {},
            status: "draft",
            updatedAt: null,
          };
          const existingPhotos = asArray(existing.inputs?.photos);
          const sharedGroups = new Set(photos.map((photo) => photoSlotGroup(photo)));
          const nextPhotos = [
            ...existingPhotos.filter((photo) => !sharedGroups.has(photoSlotGroup(photo))),
            ...photos.map((photo) => ({ ...photo })),
          ];
          const draft = {
            ...existing,
            inputs: { ...asObject(existing.inputs), photos: nextPhotos },
            updatedAt: new Date().toISOString(),
          };
          draftCache.set(targetKey, draft);
          items.push({ skc: targetSkc, status: "saved" });
        }
        persistLocalState();
        return json(response, 200, { externalWrite: false, items });
      }
      const detailMatch = suffix.match(/^compliance-workspace\/([^/]+)$/);
      if (request.method === "GET" && detailMatch) {
        const skc = decodeURIComponent(detailMatch[1]);
        const workspace = await getWorkspace(storeId, new URL(`${url.origin}/v1/web/stores/${encodeURIComponent(storeId)}/compliance-workspace?q=${encodeURIComponent(skc)}&pageSize=100`));
        const item = workspace.items.find((candidate) => candidate.skc === skc);
        if (!item) return json(response, 404, { code: "COMPLIANCE_SKC_NOT_FOUND", msg: "当前经营数据中未找到该 SKC" });
        return json(response, 200, detailWithDraft(
          storeId,
          detailCache.get(`${storeId}:${skc}`) || emptyDetail(item),
        ));
      }
      const rulesRefreshMatch = suffix.match(/^compliance-workspace\/([^/]+)\/rules\/refresh$/);
      if (request.method === "POST" && rulesRefreshMatch) {
        const skc = decodeURIComponent(rulesRefreshMatch[1]);
        const workspace = await getWorkspace(storeId, new URL(`${url.origin}/v1/web/stores/${encodeURIComponent(storeId)}/compliance-workspace?q=${encodeURIComponent(skc)}&pageSize=100`));
        const item = workspace.items.find((candidate) => candidate.skc === skc);
        if (!item) return json(response, 404, { code: "COMPLIANCE_SKC_NOT_FOUND", msg: "当前经营数据中未找到该 SKC" });
        const row = await readComplianceRow(storeId, skc);
        if (!row) return json(response, 409, { code: "COMPLIANCE_RULES_NO_TARGET", msg: "当前 SKC 尚未有可供刷新判断的合规同步记录" });
        const result = await readComplianceRules(storeId, skc);
        const bundle = result.data || null;
        if (!bundle || String(bundle.skc || skc) !== skc) {
          return json(response, 502, { code: "COMPLIANCE_RULES_EMPTY_RESPONSE", msg: "SHEIN 未返回当前 SKC 的合规规则快照" });
        }
        return json(response, 200, {
          refreshed: true,
          detail: detailWithDraft(
            storeId,
            await buildComplianceDetail(storeId, item, row, bundle),
          ),
        });
      }
      const jobsMatch = suffix.match(/^sync-jobs(?:\/([^/]+))?$/);
      if (request.method === "GET" && jobsMatch) {
        if (jobsMatch[1]) {
          const job = jobs.get(decodeURIComponent(jobsMatch[1]));
          if (!job) return json(response, 404, { code: "SYNC_JOB_NOT_FOUND", msg: "未找到本地任务" });
          return json(response, 200, {
            job: {
              ...job,
              items: Array.isArray(job.items) ? job.items : [],
            },
          });
        }
        try {
          const compliance = await readComplianceJob(storeId);
          const mapped = mapComplianceJob(compliance.job);
          if (mapped) jobs.set(mapped.id, { ...mapped, storeId });
        } catch {
          // A missing compliance cache is a valid empty state.
        }
        return json(response, 200, {
          jobs: listJobs(storeId, {
            state: url.searchParams.get("state") || "",
            jobType: url.searchParams.get("jobType") || "",
          }),
          count: listJobs(storeId, {}).length,
        });
      }
      if (request.method === "GET" && suffix === "compliance-workspace") {
        return json(response, 200, await getWorkspace(storeId, url));
      }
      if (request.method === "POST" && ["rules/refresh", "publish/schema-sync"].includes(suffix)) {
        return json(response, 503, {
          code: "LOCAL_READ_ONLY",
          msg: "本地真实模式只支持 SHEIN 数据读取和同步，不执行规则写入或发布操作",
        });
      }
      return json(response, 404, { code: "ROUTE_NOT_FOUND", msg: "本地真实模式暂未开放此接口" });
    } catch (error) {
      const status = String(error?.code || "") === "openapi00001"
        ? 401
        : Number(error.status || 500);
      return json(response, status, errorPayload(error));
    }
  });
}

export function startV2LocalRealServer({ port = 8790, host = "127.0.0.1" } = {}) {
  const server = createV2LocalRealServer();
  server.listen(port, host, () => {
    console.log(`[shein-v2-local-real] http://${host}:${port}`);
  });
  return server;
}

if (process.argv[1] && process.argv[1].endsWith("v2-local-real-server.js")) {
  startV2LocalRealServer({
    port: Number(process.env.SHEIN_V2_REAL_PORT || 8790),
    host: process.env.SHEIN_V2_REAL_HOST || "127.0.0.1",
  });
}
