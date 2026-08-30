import crypto from "node:crypto";

import {
  getErp07EndpointSchema,
  validateErp07EndpointPayload,
} from "./erp07-shein-endpoint-schema.js";

export const ERP07_RESPONSE_EVIDENCE_CAPTURE_VERSION =
  "erp07-response-evidence-capture-v1";

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

export class Erp07ResponseEvidenceError extends Error {
  constructor(code, message, status = 422) {
    super(message);
    this.name = "Erp07ResponseEvidenceError";
    this.code = code;
    this.status = status;
  }
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
  const normalizedSourceRef = sourceRefSnapshot(sourceRef);
  const normalizedObservedAt = observedAtSnapshot(observedAt);
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
    sourceRef: normalizedSourceRef,
    scope: Object.freeze(normalizedScope),
    observedAt: normalizedObservedAt,
    httpStatus: normalizedResponse.httpStatus,
    upstreamCode: normalizedResponse.upstreamCode,
    traceId: normalizedResponse.traceId,
    payloadSha256: digest(normalizedResponse.payload),
    fieldObservations: Object.freeze(
      fieldObservations(schema, normalizedResponse.payload)
        .map((observation) => Object.freeze(observation)),
    ),
    reviewStatus: "pending_manual_acceptance",
    eligibleForCatalogUpgrade: false,
  });
}
