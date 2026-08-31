import { requestShein as defaultRequestShein } from "../shein-client.js";
import {
  ERP07_SHEIN_ENDPOINT_CONTRACT_VERSION,
  buildErp07EndpointRequest,
  classifyErp07Response,
} from "./erp07-shein-endpoint-contract.js";
import {
  ERP07_SHEIN_ENDPOINT_SCHEMA_VERSION,
  Erp07EndpointSchemaError,
  getErp07EndpointSchema,
  validateErp07EndpointPayload,
  validateErp07EndpointQuery,
} from "./erp07-shein-endpoint-schema.js";
import {
  buildErp07ResponseEvidenceReviewDossier,
  buildErp07ResponseEvidenceSnapshot,
  normalizeErp07ResponseEvidenceCaptureContext,
} from "./erp07-response-evidence.js";

export const ERP07_SHEIN_ADAPTER_CONTRACT_VERSION =
  "erp07-shein-adapter-v1";

const SEND_BOUNDARIES = new Set(["before_send", "after_send", "unknown"]);

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function text(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function credentialInput(credentials, apiBaseUrl) {
  const source = object(credentials);
  const baseUrl = text(source?.baseUrl || apiBaseUrl, 500);
  const openKeyId = text(source?.openKeyId, 500);
  const secretKey = text(source?.secretKey, 1000);
  if (!baseUrl || !openKeyId || !secretKey) {
    throw new Erp07SheinAdapterError(
      "ERP07_ADAPTER_CREDENTIALS_INVALID",
      "ERP-07 SHEIN 远端边界的凭证或 API 地址不完整",
    );
  }
  return { baseUrl, openKeyId, secretKey };
}

function safeDiagnostics(response) {
  const source = object(response?.diagnostics);
  const status = Number(response?.status ?? source?.status);
  return {
    status: Number.isInteger(status) ? status : null,
    code: text(source?.code ?? response?.payload?.code, 100) || null,
    traceId: text(source?.traceId ?? response?.payload?.traceId, 200) || null,
    ...(Number.isFinite(source?.durationMs)
      ? { durationMs: Math.max(0, Number(source.durationMs)) }
      : {}),
  };
}

function safeResponse(response) {
  const payload = response?.payload ?? response;
  if (!object(payload)) {
    throw new Erp07SheinAdapterError(
      "ERP07_ADAPTER_RESPONSE_INVALID",
      "ERP-07 SHEIN 返回不是对象",
    );
  }
  return {
    payload,
    response: object(response) ? response : { payload },
    diagnostics: safeDiagnostics(response),
  };
}

function safeRequestMetadata(request, schema, { redactForEvidenceCapture = false } = {}) {
  const metadata = {
    contractVersion: request.contractVersion,
    schemaVersion: ERP07_SHEIN_ENDPOINT_SCHEMA_VERSION,
    endpoint: request.endpoint,
    method: request.method,
    path: request.path,
    mode: request.mode,
    traceId: request.traceId,
    requiredHeaders: [...schema.headers],
  };
  if (redactForEvidenceCapture) {
    return {
      ...metadata,
      redactedForEvidenceCapture: true,
    };
  }
  return {
    ...metadata,
    scope: request.scope,
    body: request.body,
    ...(request.query ? { query: request.query } : {}),
  };
}

function sourcePendingRead(schema) {
  const evidence = schema?.source?.responseEvidence;
  return schema?.mode === "read" &&
    evidence?.status === "internal_consumer_contract" &&
    evidence?.gaps?.includes("official_response_fields_not_captured");
}

function schemaError(code, message, error, details = {}) {
  return new Erp07SheinAdapterError(
    code,
    message,
    422,
    {
      ...details,
      ...(error?.path ? { path: error.path } : {}),
    },
  );
}

function featureDisabledError(mode) {
  if (mode === "business_write") {
    return new Erp07SheinAdapterError(
      "ERP07_ADAPTER_BUSINESS_WRITE_DISABLED",
      "ERP-07 SHEIN 业务写入边界当前关闭",
    );
  }
  if (mode !== "read") {
    return new Erp07SheinAdapterError(
      "ERP07_ADAPTER_NON_BUSINESS_WRITE_DISABLED",
      "ERP-07 SHEIN 非业务写入边界当前关闭",
    );
  }
  return new Erp07SheinAdapterError(
    "ERP07_ADAPTER_REMOTE_DISABLED",
    "ERP-07 SHEIN 远端读取边界当前关闭",
  );
}

function classifyResult({
  request,
  schema,
  classification,
  payload,
  diagnostics,
  responseEvidenceDossier = null,
  redactRequestForEvidenceCapture = false,
}) {
  const result = {
    adapterContractVersion: ERP07_SHEIN_ADAPTER_CONTRACT_VERSION,
    schemaVersion: ERP07_SHEIN_ENDPOINT_SCHEMA_VERSION,
    endpoint: request.endpoint,
    request: safeRequestMetadata(request, schema, {
      redactForEvidenceCapture: redactRequestForEvidenceCapture,
    }),
    sourceEvidenceStatus: schema.source.evidenceStatus,
    responseEvidence: schema.source.responseEvidence,
    authorizedStoreRead: schema.source.authorizedStoreRead,
    diagnostics,
    ...classification,
  };
  if ((classification.outcome === "read_success" || classification.outcome === "accepted") &&
      !responseEvidenceDossier) {
    result.payload = payload;
  }
  if (responseEvidenceDossier) result.responseEvidenceDossier = responseEvidenceDossier;
  return result;
}

export class Erp07SheinAdapterError extends Error {
  constructor(code, message, status = 409, details = {}) {
    super(message);
    this.name = "Erp07SheinAdapterError";
    this.code = code;
    this.status = status;
    this.details = Object.freeze({ ...details });
  }
}

export class Erp07SheinAdapter {
  constructor({
    apiBaseUrl = "",
    resolveCredentials = null,
    request = defaultRequestShein,
    readEnabled = false,
    writeEnabled = false,
    sourcePendingEvidenceCaptureEnabled = false,
    language = "zh-cn",
    timeoutMs = 15_000,
  } = {}) {
    this.apiBaseUrl = text(apiBaseUrl, 500);
    this.resolveCredentials = resolveCredentials;
    this.request = request;
    this.readEnabled = readEnabled === true;
    this.writeEnabled = writeEnabled === true;
    this.sourcePendingEvidenceCaptureEnabled = sourcePendingEvidenceCaptureEnabled === true;
    this.language = text(language, 20) || "zh-cn";
    this.timeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0
      ? Math.floor(timeoutMs)
      : 15_000;
  }

  async execute({
    endpoint,
    body = {},
    query,
    scope,
    traceId,
    allowWrite = false,
    sendBoundary = "unknown",
    acceptedEvidence = false,
    sourcePendingEvidenceCapture = null,
  } = {}) {
    if (!SEND_BOUNDARIES.has(sendBoundary)) {
      throw new Erp07SheinAdapterError(
        "ERP07_ADAPTER_SEND_BOUNDARY_INVALID",
        "ERP-07 SHEIN 发送边界只能是 before_send、after_send 或 unknown",
      );
    }
    if (typeof acceptedEvidence !== "boolean") {
      throw new Erp07SheinAdapterError(
        "ERP07_ADAPTER_EVIDENCE_INVALID",
        "ERP-07 SHEIN 成功证据必须是布尔值",
      );
    }

    const request = buildErp07EndpointRequest({
      endpoint,
      body,
      query,
      scope,
      traceId,
      allowWrite,
    });
    const schema = getErp07EndpointSchema(request.endpoint);
    try {
      validateErp07EndpointPayload({
        endpoint: request.endpoint,
        direction: "request",
        payload: request.body,
      });
    } catch (error) {
      if (error instanceof Erp07EndpointSchemaError) {
        throw schemaError(
          "ERP07_ADAPTER_REQUEST_SCHEMA_INVALID",
          "ERP-07 SHEIN 请求未通过版本化 schema 校验",
          error,
          { endpoint: request.endpoint, schemaVersion: ERP07_SHEIN_ENDPOINT_SCHEMA_VERSION },
        );
      }
      throw error;
    }
    if (request.query) {
      try {
        validateErp07EndpointQuery({
          endpoint: request.endpoint,
          query: request.query,
        });
      } catch (error) {
        if (error instanceof Erp07EndpointSchemaError) {
          throw schemaError(
            "ERP07_ADAPTER_QUERY_SCHEMA_INVALID",
            "ERP-07 SHEIN 查询参数未通过版本化 schema 校验",
            error,
            { endpoint: request.endpoint, schemaVersion: ERP07_SHEIN_ENDPOINT_SCHEMA_VERSION },
          );
        }
        throw error;
      }
    }

    const requiresSourcePendingCapture = sourcePendingRead(schema);
    let evidenceCaptureContext = null;
    if (requiresSourcePendingCapture) {
      if (!this.sourcePendingEvidenceCaptureEnabled) {
        throw new Erp07SheinAdapterError(
          "ERP07_ADAPTER_SOURCE_PENDING_READ_DISABLED",
          "官方响应字段待核验的读取接口只允许专用证据采集模式执行",
        );
      }
      try {
        evidenceCaptureContext = normalizeErp07ResponseEvidenceCaptureContext(
          sourcePendingEvidenceCapture,
        );
      } catch {
        throw new Erp07SheinAdapterError(
          "ERP07_ADAPTER_SOURCE_PENDING_CAPTURE_REQUIRED",
          "source-pending 读取必须携带有效的授权回执编号和观测时间",
        );
      }
    }

    if (request.mode === "read" ? !this.readEnabled : !this.writeEnabled) {
      throw featureDisabledError(request.mode);
    }
    if (typeof this.resolveCredentials !== "function") {
      throw new Erp07SheinAdapterError(
        "ERP07_ADAPTER_CREDENTIAL_RESOLVER_REQUIRED",
        "ERP-07 SHEIN 远端边界未配置凭证解析器",
      );
    }
    if (typeof this.request !== "function") {
      throw new Erp07SheinAdapterError(
        "ERP07_ADAPTER_TRANSPORT_REQUIRED",
        "ERP-07 SHEIN 远端边界未配置传输器",
      );
    }

    let credentials;
    try {
      credentials = credentialInput(
        await this.resolveCredentials(request.scope),
        this.apiBaseUrl,
      );
    } catch (error) {
      if (error instanceof Erp07SheinAdapterError) throw error;
      throw new Erp07SheinAdapterError(
        "ERP07_ADAPTER_CREDENTIAL_RESOLUTION_FAILED",
        "ERP-07 SHEIN 凭证解析失败",
      );
    }

    const transportInput = {
      baseUrl: credentials.baseUrl,
      method: request.method,
      path: request.path,
      ...(request.method === "GET" && Object.keys(request.body).length === 0
        ? {}
        : { body: request.body }),
      ...(request.query ? { query: request.query } : {}),
      openKeyId: credentials.openKeyId,
      secretKey: credentials.secretKey,
      language: this.language,
      timeoutMs: this.timeoutMs,
    };

    let response;
    try {
      response = await this.request(transportInput);
    } catch (error) {
      const classification = classifyErp07Response({
        endpoint: request.endpoint,
        error,
        sendBoundary,
        acceptedEvidence,
      });
      return classifyResult({
        request,
        schema,
        classification,
        payload: null,
        redactRequestForEvidenceCapture: requiresSourcePendingCapture,
        diagnostics: safeDiagnostics({
          status: error?.status,
          payload: error?.response,
          diagnostics: error?.diagnostics,
        }),
      });
    }

    const normalized = safeResponse(response);
    try {
      validateErp07EndpointPayload({
        endpoint: request.endpoint,
        direction: "response",
        payload: normalized.payload,
      });
    } catch (error) {
      if (error instanceof Erp07EndpointSchemaError) {
        throw schemaError(
          "ERP07_ADAPTER_RESPONSE_SCHEMA_INVALID",
          "ERP-07 SHEIN 响应未通过版本化 schema 校验",
          error,
          { endpoint: request.endpoint, schemaVersion: ERP07_SHEIN_ENDPOINT_SCHEMA_VERSION },
        );
      }
      throw error;
    }

    const classification = classifyErp07Response({
      endpoint: request.endpoint,
      response: normalized.response,
      sendBoundary,
      acceptedEvidence,
    });
    let responseEvidenceDossier = null;
    if (requiresSourcePendingCapture && classification.outcome === "read_success") {
      try {
        const snapshot = buildErp07ResponseEvidenceSnapshot({
          endpoint: request.endpoint,
          scope: request.scope,
          sourceRef: evidenceCaptureContext.sourceRef,
          observedAt: evidenceCaptureContext.observedAt,
          response: {
            status: normalized.diagnostics.status,
            payload: normalized.payload,
            diagnostics: normalized.diagnostics,
          },
        });
        responseEvidenceDossier = buildErp07ResponseEvidenceReviewDossier({ snapshot });
      } catch {
        throw new Erp07SheinAdapterError(
          "ERP07_ADAPTER_SOURCE_PENDING_EVIDENCE_INVALID",
          "source-pending 读取响应未能生成脱敏证据摘要",
          422,
        );
      }
    }
    return classifyResult({
      request,
      schema,
      classification,
      payload: normalized.payload,
      diagnostics: normalized.diagnostics,
      responseEvidenceDossier,
      redactRequestForEvidenceCapture: requiresSourcePendingCapture,
    });
  }
}

export {
  ERP07_SHEIN_ENDPOINT_CONTRACT_VERSION,
};
