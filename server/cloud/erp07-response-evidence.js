import crypto from "node:crypto";

import {
  getErp07EndpointSchema,
  validateErp07EndpointPayload,
} from "./erp07-shein-endpoint-schema.js";

export const ERP07_RESPONSE_EVIDENCE_CAPTURE_VERSION =
  "erp07-response-evidence-capture-v2";
export const ERP07_RESPONSE_EVIDENCE_DOSSIER_VERSION =
  "erp07-response-evidence-dossier-v2";

const AUTHORIZED_READ_SOURCE = /^authorized-store-read:[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const SENSITIVE_KEY = /(?:authorization|cookie|password|passwd|secret|token|api[_-]?key|access[_-]?key|credential|signature|headers?|request|response|raw|body|payload|bytes?|file)/i;
const SENSITIVE_SOURCE_VALUE = /(?:[?&](?:token|sig|signature|x-amz-[^=&]+|authorization|password|secret)=|(?:bearer\s+|(?:secret|token|password|signature|access[_-]?key)\s*[:=]))/i;
const SAFE_INPUT_KEYS = new Set(["payload", "diagnostics", "status"]);
const SAFE_DIAGNOSTIC_KEYS = new Set(["status", "code", "traceId", "durationMs"]);
const REQUIRED_SCOPE_FIELDS = ["tenantId", "storeId", "supplierId"];
const SAFE_CAPTURE_INPUT_KEYS = new Set([
  "endpoint",
  "scope",
  "sourceRef",
  "observedAt",
  "response",
]);
const SAFE_CAPTURE_CONTEXT_KEYS = new Set(["sourceRef", "observedAt"]);
const SAFE_DOSSIER_INPUT_KEYS = new Set(["snapshot"]);
const SAFE_SNAPSHOT_KEYS = new Set([
  "captureVersion",
  "endpoint",
  "contractVersion",
  "schemaVersion",
  "sourceRef",
  "scope",
  "observedAt",
  "httpStatus",
  "upstreamCode",
  "traceId",
  "payloadSha256",
  "fieldObservations",
  "responseShape",
  "reviewStatus",
  "eligibleForCatalogUpgrade",
]);
const SAFE_OBSERVATION_TYPES = new Set([
  "null",
  "array",
  "integer",
  "number",
  "string",
  "boolean",
  "object",
  "unknown",
]);

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function safeText(value, max = 200) {
  const text = String(value ?? "").trim();
  if (!text || text.length > max || /[\u0000-\u001f\u007f]/.test(text)) return null;
  return text;
}

function canonicalize(value, seen = new Set()) {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item, seen));
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) throw new Error("循环响应对象");
  seen.add(value);
  const output = Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key], seen)]),
  );
  seen.delete(value);
  return output;
}

function digest(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(value)), "utf8")
    .digest("hex");
}

function assertNoSensitiveKeys(value, seen = new Set()) {
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) assertNoSensitiveKeys(item, seen);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) {
      throw new Erp07ResponseEvidenceError(
        "ERP07_RESPONSE_EVIDENCE_SENSITIVE_INPUT",
        "响应证据禁止接收请求头、凭证、原始请求或原始响应字段",
      );
    }
    assertNoSensitiveKeys(child, seen);
  }
}

function assertSafeDiagnostics(value) {
  const diagnostics = object(value);
  if (!diagnostics) return;
  if (Object.keys(diagnostics).some((key) => !SAFE_DIAGNOSTIC_KEYS.has(key))) {
    throw new Erp07ResponseEvidenceError(
      "ERP07_RESPONSE_EVIDENCE_SENSITIVE_INPUT",
      "响应证据的 diagnostics 只接受状态、错误码、traceId 和耗时字段",
    );
  }
  assertNoSensitiveKeys(diagnostics);
}

function scopeSnapshot(scope) {
  const source = object(scope);
  if (!source) {
    throw new Erp07ResponseEvidenceError(
      "ERP07_RESPONSE_EVIDENCE_SCOPE_INVALID",
      "响应证据缺少租户、店铺和供应商范围",
    );
  }
  if (Object.keys(source).some((key) => !REQUIRED_SCOPE_FIELDS.includes(key))) {
    throw new Erp07ResponseEvidenceError(
      "ERP07_RESPONSE_EVIDENCE_SCOPE_INVALID",
      "响应证据范围只接受租户、店铺和供应商字段",
    );
  }
  const output = {};
  for (const field of REQUIRED_SCOPE_FIELDS) {
    const value = safeText(source[field], 120);
    if (!value) {
      throw new Erp07ResponseEvidenceError(
        "ERP07_RESPONSE_EVIDENCE_SCOPE_INVALID",
        "响应证据的租户、店铺和供应商范围必须完整",
      );
    }
    output[field] = value;
  }
  return output;
}

function sourceRefSnapshot(sourceRef) {
  const value = safeText(sourceRef, 160);
  if (!value || !AUTHORIZED_READ_SOURCE.test(value) || SENSITIVE_SOURCE_VALUE.test(value)) {
    throw new Erp07ResponseEvidenceError(
      "ERP07_RESPONSE_EVIDENCE_SOURCE_REF_INVALID",
      "响应证据必须绑定授权店铺只读回执编号",
    );
  }
  return value;
}

function observedAtSnapshot(observedAt) {
  const value = safeText(observedAt, 80);
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    throw new Erp07ResponseEvidenceError(
      "ERP07_RESPONSE_EVIDENCE_OBSERVED_AT_INVALID",
      "响应证据观测时间无效",
    );
  }
  return date.toISOString();
}

function responseInput(response) {
  const source = object(response);
  if (!source || Object.keys(source).some((key) => !SAFE_INPUT_KEYS.has(key))) {
    throw new Erp07ResponseEvidenceError(
      "ERP07_RESPONSE_EVIDENCE_SENSITIVE_INPUT",
      "响应证据只接受脱离请求头的 payload 和 diagnostics",
    );
  }
  const payload = object(source.payload);
  if (!payload) {
    throw new Erp07ResponseEvidenceError(
      "ERP07_RESPONSE_EVIDENCE_PAYLOAD_INVALID",
      "响应证据缺少结构化 payload",
    );
  }
  assertNoSensitiveKeys(payload);
  const diagnostics = object(source.diagnostics) || {};
  assertSafeDiagnostics(diagnostics);
  const status = Number(source.status ?? diagnostics.status);
  const httpStatus = Number.isInteger(status) ? status : null;
  const traceId = safeText(diagnostics.traceId || payload.traceId, 200);
  const upstreamCode = safeText(diagnostics.code ?? payload.code, 100);
  if (!httpStatus || !traceId || !upstreamCode) {
    throw new Erp07ResponseEvidenceError(
      "ERP07_RESPONSE_EVIDENCE_DIAGNOSTICS_INVALID",
      "响应证据缺少 HTTP 状态、traceId 或上游 code",
    );
  }
  return { payload, httpStatus, traceId, upstreamCode };
}

function pathSegments(fieldPath) {
  return fieldPath.split(".").map((segment) => {
    const isArray = segment.endsWith("[]");
    return { key: isArray ? segment.slice(0, -2) : segment, isArray };
  });
}

function resolveFieldValues(value, segments) {
  if (!segments.length) return [{ value }];
  const current = object(value);
  if (!current) return [];
  const [segment, ...rest] = segments;
  if (!Object.prototype.hasOwnProperty.call(current, segment.key)) return [];
  const child = current[segment.key];
  if (segment.isArray) {
    if (!Array.isArray(child)) return [];
    if (!rest.length) return [{ value: child }];
    return child.flatMap((item) => resolveFieldValues(item, rest));
  }
  return resolveFieldValues(child, rest);
}

function valueType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  if (typeof value === "number") return "number";
  if (typeof value === "string") return "string";
  if (typeof value === "boolean") return "boolean";
  if (value && typeof value === "object") return "object";
  return "unknown";
}

const MAX_RESPONSE_SHAPE_NODES = 256;
const RESPONSE_SHAPE_KEY_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
const RESPONSE_SHAPE_PATH_PATTERN = /^(?:[A-Za-z0-9_-]+|<invalid-key>)(?:\[\])?(?:\.(?:[A-Za-z0-9_-]+|<invalid-key>)(?:\[\])?)*$/;

function buildResponseShape(payload) {
  const typesByPath = new Map();
  let visitedNodes = 0;
  let truncated = false;

  function visit(value, currentPath) {
    if (visitedNodes >= MAX_RESPONSE_SHAPE_NODES) {
      truncated = true;
      return;
    }
    visitedNodes += 1;
    const types = typesByPath.get(currentPath) || new Set();
    types.add(valueType(value));
    typesByPath.set(currentPath, types);

    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item, `${currentPath}[]`);
        if (truncated) break;
      }
      return;
    }
    if (!value || typeof value !== "object") return;

    for (const key of Object.keys(value).sort()) {
      const safeKey = RESPONSE_SHAPE_KEY_PATTERN.test(key)
        ? key
        : "<invalid-key>";
      visit(
        value[key],
        currentPath ? `${currentPath}.${safeKey}` : safeKey,
      );
      if (truncated) break;
    }
  }

  visit(payload, "");
  const fields = [...typesByPath.entries()]
    .filter(([path]) => path)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([path, types]) => Object.freeze({
      path,
      valueTypes: Object.freeze([...types].sort()),
    }));
  return Object.freeze({
    fields: Object.freeze(fields),
    truncated,
  });
}

function fieldObservations(schema, payload) {
  return schema.source.responseEvidence.fields.map((field) => {
    const values = resolveFieldValues(payload, pathSegments(field));
    return {
      field,
      observed: values.length > 0,
      occurrences: values.length,
      valueTypes: [...new Set(values.map(({ value }) => valueType(value)))].sort(),
    };
  });
}

function invalidDossier(message) {
  throw new Erp07ResponseEvidenceError(
    "ERP07_RESPONSE_EVIDENCE_DOSSIER_INVALID",
    message,
  );
}

function normalizeResponseShape(value) {
  const source = object(value);
  if (!source || Object.keys(source).some((key) => !["fields", "truncated"].includes(key)) ||
      typeof source.truncated !== "boolean" || !Array.isArray(source.fields) ||
      source.fields.length > MAX_RESPONSE_SHAPE_NODES) {
    invalidDossier("响应证据结构摘要格式无效");
  }
  let previousPath = "";
  const paths = new Set();
  const fields = source.fields.map((field) => {
    const entry = object(field);
    const fieldPath = safeText(entry?.path, 240);
    if (!fieldPath || !RESPONSE_SHAPE_PATH_PATTERN.test(fieldPath) ||
        paths.has(fieldPath) || fieldPath < previousPath ||
        !Array.isArray(entry.valueTypes) || entry.valueTypes.length === 0 ||
        new Set(entry.valueTypes).size !== entry.valueTypes.length ||
        entry.valueTypes.some((type) => !SAFE_OBSERVATION_TYPES.has(type))) {
      invalidDossier("响应证据结构摘要字段无效");
    }
    previousPath = fieldPath;
    paths.add(fieldPath);
    return Object.freeze({
      path: fieldPath,
      valueTypes: Object.freeze([...entry.valueTypes]),
    });
  });
  return Object.freeze({
    fields: Object.freeze(fields),
    truncated: source.truncated,
  });
}

function snapshotForDossier(snapshot) {
  const value = object(snapshot);
  if (!value || Object.keys(value).some((key) => !SAFE_SNAPSHOT_KEYS.has(key))) {
    invalidDossier("响应证据审阅摘要格式无效");
  }
  if (value.captureVersion !== ERP07_RESPONSE_EVIDENCE_CAPTURE_VERSION ||
      value.reviewStatus !== "pending_manual_acceptance" ||
      value.eligibleForCatalogUpgrade !== false) {
    invalidDossier("响应证据审阅摘要不具备待人工审核的固定状态");
  }
  const endpoint = safeText(value.endpoint, 160);
  let schema;
  try {
    schema = getErp07EndpointSchema(endpoint);
  } catch {
    invalidDossier("响应证据审阅摘要绑定的 endpoint 无效");
  }
  if (schema.mode !== "read") {
    invalidDossier("响应证据审阅摘要只允许只读 endpoint");
  }
  if (schema.source.responseEvidence.status !== "internal_consumer_contract" ||
      !schema.source.responseEvidence.gaps.includes("official_response_fields_not_captured")) {
    invalidDossier("响应证据审阅摘要只适用于官方响应字段待核验的 endpoint");
  }
  if (value.contractVersion !== schema.contractVersion || value.schemaVersion !== schema.schemaVersion) {
    invalidDossier("响应证据审阅摘要版本与当前 endpoint 契约不一致");
  }
  const sourceRef = sourceRefSnapshot(value.sourceRef);
  const scope = scopeSnapshot(value.scope);
  const observedAt = observedAtSnapshot(value.observedAt);
  const traceId = safeText(value.traceId, 200);
  const payloadSha256 = safeText(value.payloadSha256, 64);
  if (!traceId || !payloadSha256 || !/^[a-f0-9]{64}$/.test(payloadSha256) ||
      value.httpStatus !== 200 || String(value.upstreamCode) !== "0") {
    invalidDossier("响应证据审阅摘要缺少成功回执的固定标识");
  }
  const observations = value.fieldObservations;
  const expectedFields = schema.source.responseEvidence.fields;
  if (!Array.isArray(observations) || observations.length !== expectedFields.length) {
    invalidDossier("响应证据审阅摘要字段覆盖范围与 endpoint 不一致");
  }
  const normalizedObservations = observations.map((observation, index) => {
    const entry = object(observation);
    if (!entry || Object.keys(entry).some((key) => ![
      "field",
      "observed",
      "occurrences",
      "valueTypes",
    ].includes(key)) || entry.field !== expectedFields[index] ||
        typeof entry.observed !== "boolean" ||
        !Number.isInteger(entry.occurrences) || entry.occurrences < 0 ||
        entry.observed !== (entry.occurrences > 0) ||
        !Array.isArray(entry.valueTypes) ||
        entry.valueTypes.some((type) => !SAFE_OBSERVATION_TYPES.has(type)) ||
        new Set(entry.valueTypes).size !== entry.valueTypes.length ||
        (entry.observed && entry.valueTypes.length === 0) ||
        (!entry.observed && entry.valueTypes.length !== 0)) {
      invalidDossier("响应证据审阅摘要字段观测结果无效");
    }
    return Object.freeze({
      field: entry.field,
      observed: entry.observed,
      occurrences: entry.occurrences,
      valueTypes: Object.freeze([...entry.valueTypes]),
    });
  });
  const responseShape = normalizeResponseShape(value.responseShape);
  return {
    schema,
    endpoint: schema.id,
    sourceRef,
    scope,
    observedAt,
    traceId,
    payloadSha256,
    observations: normalizedObservations,
    responseShape,
  };
}

export class Erp07ResponseEvidenceError extends Error {
  constructor(code, message, status = 422) {
    super(message);
    this.name = "Erp07ResponseEvidenceError";
    this.code = code;
    this.status = status;
  }
}

export function normalizeErp07ResponseEvidenceCaptureContext({
  ...input
} = {}) {
  if (Object.keys(input).some((key) => !SAFE_CAPTURE_CONTEXT_KEYS.has(key))) {
    throw new Erp07ResponseEvidenceError(
      "ERP07_RESPONSE_EVIDENCE_INPUT_INVALID",
      "响应证据采集上下文禁止未知扩展字段",
    );
  }
  return Object.freeze({
    sourceRef: sourceRefSnapshot(input.sourceRef),
    observedAt: observedAtSnapshot(input.observedAt),
  });
}

export function buildErp07ResponseEvidenceSnapshot({
  ...input
} = {}) {
  if (Object.keys(input).some((key) => !SAFE_CAPTURE_INPUT_KEYS.has(key))) {
    throw new Erp07ResponseEvidenceError(
      "ERP07_RESPONSE_EVIDENCE_INPUT_INVALID",
      "响应证据输入禁止未知扩展字段",
    );
  }
  const {
    endpoint,
    scope,
    sourceRef,
    observedAt,
    response,
  } = input;
  let schema;
  try {
    schema = getErp07EndpointSchema(endpoint);
  } catch {
    throw new Erp07ResponseEvidenceError(
      "ERP07_RESPONSE_EVIDENCE_ENDPOINT_INVALID",
      "响应证据绑定的 ERP-07 endpoint 不存在",
    );
  }
  if (schema.mode !== "read") {
    throw new Erp07ResponseEvidenceError(
      "ERP07_RESPONSE_EVIDENCE_READ_ONLY_REQUIRED",
      "响应证据捕获只允许授权店铺只读 endpoint",
    );
  }

  const normalizedScope = scopeSnapshot(scope);
  const captureContext = normalizeErp07ResponseEvidenceCaptureContext({
    sourceRef,
    observedAt,
  });
  const normalizedResponse = responseInput(response);
  if (normalizedResponse.httpStatus !== 200 || normalizedResponse.upstreamCode !== "0") {
    throw new Erp07ResponseEvidenceError(
      "ERP07_RESPONSE_EVIDENCE_UPSTREAM_NOT_SUCCESS",
      "只有 HTTP 200 且上游 code=0 的授权只读响应可生成证据摘要",
    );
  }
  try {
    validateErp07EndpointPayload({
      endpoint: schema.id,
      direction: "response",
      payload: normalizedResponse.payload,
    });
  } catch {
    throw new Erp07ResponseEvidenceError(
      "ERP07_RESPONSE_EVIDENCE_SCHEMA_INVALID",
      "授权只读响应未通过 ERP-07 版本化响应 schema",
    );
  }

  return Object.freeze({
    captureVersion: ERP07_RESPONSE_EVIDENCE_CAPTURE_VERSION,
    endpoint: schema.id,
    contractVersion: schema.contractVersion,
    schemaVersion: schema.schemaVersion,
    sourceRef: captureContext.sourceRef,
    scope: Object.freeze(normalizedScope),
    observedAt: captureContext.observedAt,
    httpStatus: normalizedResponse.httpStatus,
    upstreamCode: normalizedResponse.upstreamCode,
    traceId: normalizedResponse.traceId,
    payloadSha256: digest(normalizedResponse.payload),
    fieldObservations: Object.freeze(
      fieldObservations(schema, normalizedResponse.payload)
        .map((observation) => Object.freeze(observation)),
    ),
    responseShape: buildResponseShape(normalizedResponse.payload),
    reviewStatus: "pending_manual_acceptance",
    eligibleForCatalogUpgrade: false,
  });
}

export function buildErp07ResponseEvidenceReviewDossier({ ...input } = {}) {
  if (Object.keys(input).some((key) => !SAFE_DOSSIER_INPUT_KEYS.has(key))) {
    invalidDossier("响应证据审阅摘要输入禁止未知扩展字段");
  }
  const normalized = snapshotForDossier(input.snapshot);
  const missing = normalized.observations
    .filter((observation) => !observation.observed)
    .map((observation) => observation.field);

  return Object.freeze({
    dossierVersion: ERP07_RESPONSE_EVIDENCE_DOSSIER_VERSION,
    endpoint: normalized.endpoint,
    method: normalized.schema.method,
    path: normalized.schema.path,
    contractVersion: normalized.schema.contractVersion,
    schemaVersion: normalized.schema.schemaVersion,
    sourceEvidenceStatus: normalized.schema.source.responseEvidence.status,
    sourceRefDigestSha256: digest(normalized.sourceRef),
    scopeDigestSha256: digest(normalized.scope),
    observedAt: normalized.observedAt,
    traceId: normalized.traceId,
    responseDigestSha256: normalized.payloadSha256,
    responseShape: normalized.responseShape,
    fieldCoverage: Object.freeze({
      expected: normalized.observations.length,
      observed: normalized.observations.length - missing.length,
      missing: Object.freeze(missing),
    }),
    catalogUpgrade: Object.freeze({
      status: "blocked_source_pending",
      eligible: false,
      reasons: Object.freeze([
        "official_response_fields_not_captured",
        "authorized_store_read_requires_independent_review",
      ]),
    }),
  });
}
