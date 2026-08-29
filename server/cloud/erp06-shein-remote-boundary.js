import { requestShein as defaultRequestShein } from "../shein-client.js";
import {
  ERP06_OUTBOX_JOB_CONTRACT_VERSION,
  ERP06_OUTBOX_JOB_NAME,
} from "./erp06-outbox-dispatcher-service.js";
import {
  ERP06_SHEIN_PUBLISH_ADAPTER_CONTRACT_VERSION,
  ERP06_SHEIN_PUBLISH_ENDPOINT,
} from "./erp06-shein-publish-adapter-contract.js";
import { normalizeProductDocumentState } from "./document-state-projections.js";
import { normalizeSpuInfo } from "./spu-readback-projections.js";

export const ERP06_SHEIN_REMOTE_BOUNDARY_CONTRACT_VERSION =
  "erp06-shein-remote-v1";
export const ERP06_DOCUMENT_STATE_READBACK_ENDPOINT =
  "/open-api/goods/query-document-state";
export const ERP06_SPU_INFO_READBACK_ENDPOINT = "/open-api/goods/spu-info";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const READBACK_ATTEMPT_STATES = new Set(["submitted", "result_unknown"]);

function text(value, max = 1000) {
  return String(value ?? "").trim().slice(0, max);
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function required(value, fieldName, max = 500) {
  const normalized = text(value, max);
  if (!normalized) {
    throw new Erp06SheinRemoteBoundaryError(
      "ERP06_REMOTE_REQUEST_INVALID",
      `${fieldName} 不能为空`,
    );
  }
  return normalized;
}

function uuid(value, fieldName) {
  const normalized = required(value, fieldName, 100);
  if (!UUID_PATTERN.test(normalized)) {
    throw new Erp06SheinRemoteBoundaryError(
      "ERP06_REMOTE_REQUEST_INVALID",
      `${fieldName} 不是有效 UUID`,
    );
  }
  return normalized;
}

function jobData(job) {
  if (!job || typeof job !== "object" || Array.isArray(job)) {
    throw new Erp06SheinRemoteBoundaryError(
      "ERP06_REMOTE_REQUEST_INVALID",
      "ERP-06 SHEIN 回读缺少队列任务",
    );
  }
  if (job.name !== undefined && text(job.name, 200) !== ERP06_OUTBOX_JOB_NAME) {
    throw new Erp06SheinRemoteBoundaryError(
      "ERP06_REMOTE_REQUEST_INVALID",
      "ERP-06 SHEIN 回读只接受 erp06-publish-command",
    );
  }
  const data = job.data && typeof job.data === "object" && !Array.isArray(job.data)
    ? job.data
    : job;
  if (text(data.contractVersion, 200) !== ERP06_OUTBOX_JOB_CONTRACT_VERSION) {
    throw new Erp06SheinRemoteBoundaryError(
      "ERP06_REMOTE_REQUEST_INVALID",
      "ERP-06 SHEIN 回读任务 contract version 不匹配",
    );
  }
  const normalized = {
    contractVersion: ERP06_OUTBOX_JOB_CONTRACT_VERSION,
    commandId: uuid(data.commandId, "commandId"),
    tenantId: uuid(data.tenantId, "tenantId"),
    storeId: uuid(data.storeId, "storeId"),
    publishBatchId: uuid(data.publishBatchId, "publishBatchId"),
    publishBatchItemId: uuid(data.publishBatchItemId, "publishBatchItemId"),
    publishAttemptId: uuid(data.publishAttemptId, "publishAttemptId"),
    productVersionId: uuid(data.productVersionId, "productVersionId"),
    sourceDraftRevisionId: uuid(data.sourceDraftRevisionId, "sourceDraftRevisionId"),
    versionFingerprint: required(data.versionFingerprint, "versionFingerprint"),
  };
  if (job.id !== undefined && text(job.id, 100) !== normalized.commandId) {
    throw new Erp06SheinRemoteBoundaryError(
      "ERP06_REMOTE_REQUEST_INVALID",
      "队列任务 id 与 publish command 不一致",
    );
  }
  return normalized;
}

function uniqueStrings(values, fieldName, maxItems) {
  if (!Array.isArray(values)) {
    throw new Erp06SheinRemoteBoundaryError(
      "ERP06_REMOTE_REQUEST_INVALID",
      `${fieldName} 必须是数组`,
    );
  }
  const normalized = Array.from(
    new Set(values.map((value) => text(value, 200)).filter(Boolean)),
  );
  if (!normalized.length || normalized.length > maxItems) {
    throw new Erp06SheinRemoteBoundaryError(
      "ERP06_REMOTE_REQUEST_INVALID",
      `${fieldName} 数量不符合要求`,
    );
  }
  return normalized;
}

function assertRequestScope(request, expected) {
  const normalized = object(request);
  if (
    text(normalized.contractVersion, 200) !==
      ERP06_SHEIN_PUBLISH_ADAPTER_CONTRACT_VERSION ||
    text(normalized.method, 20) !== "POST" ||
    text(normalized.path, 200) !== ERP06_SHEIN_PUBLISH_ENDPOINT ||
    text(normalized.commandId, 200) !== expected.commandId ||
    text(normalized.tenantId, 200) !== expected.tenantId ||
    text(normalized.storeId, 200) !== expected.storeId ||
    text(normalized.publishAttemptId, 200) !== expected.publishAttemptId ||
    text(normalized.productVersionId, 200) !== expected.productVersionId
  ) {
    throw new Erp06SheinRemoteBoundaryError(
      "ERP06_REMOTE_PUBLISH_REQUEST_INVALID",
      "ERP-06 SHEIN 发布请求的官方路径、契约或作用域不一致",
    );
  }
  if (!normalized.body || typeof normalized.body !== "object" || Array.isArray(normalized.body)) {
    throw new Erp06SheinRemoteBoundaryError(
      "ERP06_REMOTE_PUBLISH_REQUEST_INVALID",
      "ERP-06 SHEIN 发布请求缺少冻结 body",
    );
  }
  return normalized;
}

function assertRequestMatchesAuthorization(request, authorization) {
  const normalized = object(authorization);
  for (const fieldName of [
    "tenantId",
    "storeId",
    "commandId",
    "publishAttemptId",
    "productVersionId",
  ]) {
    if (
      normalized[fieldName] !== undefined &&
      text(normalized[fieldName], 200) !== text(request[fieldName], 200)
    ) {
      throw new Erp06SheinRemoteBoundaryError(
        "ERP06_REMOTE_PUBLISH_REQUEST_INVALID",
        "ERP-06 SHEIN 发布请求与当前授权作用域不一致",
      );
    }
  }
}

function assertAuthorization(authorization, expected, kind) {
  const normalized = object(authorization);
  const authorized = kind === "publish"
    ? normalized.authorizesPublishing === true
    : normalized.authorizesReadback === true;
  const expectedAttemptStates = kind === "publish"
    ? normalized.attemptState === "claimed"
    : READBACK_ATTEMPT_STATES.has(text(normalized.attemptState, 100));
  if (
    !authorized ||
    !expectedAttemptStates ||
    text(normalized.tenantId, 200) !== expected.tenantId ||
    text(normalized.storeId, 200) !== expected.storeId ||
    text(normalized.commandId, 200) !== expected.commandId ||
    text(normalized.publishAttemptId, 200) !== expected.publishAttemptId ||
    (kind === "publish" && text(normalized.productVersionId, 200) !== expected.productVersionId)
  ) {
    throw new Erp06SheinRemoteBoundaryError(
      kind === "publish"
        ? "ERP06_REMOTE_PUBLISH_AUTHORIZATION_REQUIRED"
        : "ERP06_REMOTE_READBACK_AUTHORIZATION_REQUIRED",
      kind === "publish"
        ? "ERP-06 SHEIN 发布缺少当前租户店铺、领取记录或一次性执行授权"
        : "ERP-06 SHEIN 回读缺少当前租户店铺、Attempt 状态或显式回读授权",
    );
  }
  return normalized;
}

function credentialInput(credentials, apiBaseUrl) {
  const source = object(credentials);
  const baseUrl = text(source.baseUrl || apiBaseUrl, 500);
  const openKeyId = text(source.openKeyId, 500);
  const secretKey = text(source.secretKey, 1000);
  if (!baseUrl || !openKeyId || !secretKey) {
    throw new Erp06SheinRemoteBoundaryError(
      "ERP06_REMOTE_CREDENTIALS_INVALID",
      "ERP-06 SHEIN 请求凭据或 API 地址不完整",
    );
  }
  return { baseUrl, openKeyId, secretKey };
}

function safeDiagnostics(response) {
  const source = object(response?.diagnostics);
  return {
    status: Number.isInteger(source.status) ? source.status : null,
    code: text(source.code ?? response?.payload?.code, 100) || null,
    traceId: text(source.traceId ?? response?.payload?.traceId, 200) || null,
    ...(Number.isFinite(source.durationMs)
      ? { durationMs: Math.max(0, Number(source.durationMs)) }
      : {}),
  };
}

function safeResponse(response) {
  const payload = response?.payload ?? response;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Erp06SheinRemoteBoundaryError(
      "ERP06_REMOTE_RESPONSE_INVALID",
      "SHEIN 返回不是对象",
    );
  }
  return {
    payload,
    diagnostics: safeDiagnostics(response),
  };
}

function disabledReadback({ request, stage }) {
  return {
    contractVersion: ERP06_SHEIN_REMOTE_BOUNDARY_CONTRACT_VERSION,
    commandId: request.commandId,
    publishAttemptId: request.publishAttemptId,
    productVersionId: request.productVersionId,
    stage,
    path: request.path,
    method: request.method,
    status: "disabled",
    externalRead: false,
    resolvesResultUnknown: false,
    projection: null,
  };
}

function documentEvidenceResolves(projection, requestedVersion, requestedSpuNames) {
  if (!projection || projection.empty || !projection.projection?.records?.length) {
    return false;
  }
  const records = projection.projection.records;
  if (records.some((record) => text(record.version, 200) !== requestedVersion)) {
    return false;
  }
  const returnedSpuNames = new Set(
    records.map((record) => text(record.spuName, 200)).filter(Boolean),
  );
  return requestedSpuNames.every((spuName) => returnedSpuNames.has(spuName));
}

export class Erp06SheinRemoteBoundaryError extends Error {
  constructor(code, message, status = 409) {
    super(message);
    this.name = "Erp06SheinRemoteBoundaryError";
    this.code = code;
    this.status = status;
  }
}

export function buildErp06DocumentStateReadbackRequest({ job, version, spuNames } = {}) {
  const data = jobData(job);
  const normalizedVersion = required(version, "version", 200);
  const normalizedSpuNames = uniqueStrings(spuNames, "spuNames", 100);
  return {
    contractVersion: ERP06_SHEIN_REMOTE_BOUNDARY_CONTRACT_VERSION,
    commandId: data.commandId,
    tenantId: data.tenantId,
    storeId: data.storeId,
    publishAttemptId: data.publishAttemptId,
    productVersionId: data.productVersionId,
    sourceDraftRevisionId: data.sourceDraftRevisionId,
    versionFingerprint: data.versionFingerprint,
    method: "POST",
    path: ERP06_DOCUMENT_STATE_READBACK_ENDPOINT,
    body: {
      version: normalizedVersion,
      spuList: normalizedSpuNames.map((spuName) => ({ spuName })),
    },
  };
}

export function buildErp06SpuInfoReadbackRequest({ job, version, spuName } = {}) {
  const data = jobData(job);
  required(version, "version", 200);
  const normalizedSpuName = required(spuName, "spuName", 200);
  return {
    contractVersion: ERP06_SHEIN_REMOTE_BOUNDARY_CONTRACT_VERSION,
    commandId: data.commandId,
    tenantId: data.tenantId,
    storeId: data.storeId,
    publishAttemptId: data.publishAttemptId,
    productVersionId: data.productVersionId,
    sourceDraftRevisionId: data.sourceDraftRevisionId,
    versionFingerprint: data.versionFingerprint,
    method: "POST",
    path: ERP06_SPU_INFO_READBACK_ENDPOINT,
    body: {
      languageList: ["zh-cn", "en"],
      spuName: normalizedSpuName,
    },
  };
}

export class Erp06SheinRemoteBoundary {
  constructor({
    apiBaseUrl = "",
    resolveCredentials = null,
    request = defaultRequestShein,
    executionEnabled = false,
    readbackEnabled = false,
    language = "zh-cn",
    timeoutMs = 60_000,
  } = {}) {
    this.apiBaseUrl = text(apiBaseUrl, 500);
    this.resolveCredentials = resolveCredentials;
    this.request = request;
    this.executionEnabled = executionEnabled === true;
    this.readbackEnabled = readbackEnabled === true;
    this.language = text(language, 20) || "zh-cn";
    this.timeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0
      ? Math.floor(timeoutMs)
      : 60_000;
  }

  async #requestRemote(request, authorization, expected, kind) {
    assertAuthorization(authorization, expected, kind);
    if (kind === "publish" && !this.executionEnabled) {
      throw new Erp06SheinRemoteBoundaryError(
        "ERP06_REMOTE_PUBLISH_DISABLED",
        "ERP-06 SHEIN真实发布边界当前关闭",
      );
    }
    if (kind === "readback" && !this.readbackEnabled) {
      return null;
    }
    if (typeof this.resolveCredentials !== "function") {
      throw new Erp06SheinRemoteBoundaryError(
        "ERP06_REMOTE_CREDENTIAL_RESOLVER_REQUIRED",
        "ERP-06 SHEIN 远端边界未配置凭据解析器",
      );
    }
    if (typeof this.request !== "function") {
      throw new Erp06SheinRemoteBoundaryError(
        "ERP06_REMOTE_REQUESTER_REQUIRED",
        "ERP-06 SHEIN 远端边界未配置请求器",
      );
    }
    const credentials = credentialInput(
      await this.resolveCredentials({
        tenantId: expected.tenantId,
        storeId: expected.storeId,
      }),
      this.apiBaseUrl,
    );
    const response = await this.request({
      baseUrl: credentials.baseUrl,
      method: request.method,
      path: request.path,
      body: request.body,
      openKeyId: credentials.openKeyId,
      secretKey: credentials.secretKey,
      language: this.language,
      timeoutMs: this.timeoutMs,
    });
    return safeResponse(response);
  }

  async sendPublish({ request, authorization } = {}) {
    const expected = {
      commandId: required(request?.commandId, "commandId", 200),
      tenantId: required(request?.tenantId, "tenantId", 200),
      storeId: required(request?.storeId, "storeId", 200),
      publishAttemptId: required(request?.publishAttemptId, "publishAttemptId", 200),
      productVersionId: required(request?.productVersionId, "productVersionId", 200),
    };
    const normalizedRequest = assertRequestScope(request, expected);
    assertRequestMatchesAuthorization(normalizedRequest, authorization);
    return this.#requestRemote(normalizedRequest, authorization, expected, "publish");
  }

  async readDocumentState({ job, authorization, version, spuNames } = {}) {
    const request = buildErp06DocumentStateReadbackRequest({ job, version, spuNames });
    const expected = jobData(job);
    assertAuthorization(authorization, expected, "readback");
    if (!this.readbackEnabled) return disabledReadback({ request, stage: "document_state" });
    const response = await this.#requestRemote(request, authorization, expected, "readback");
    const projection = normalizeProductDocumentState(
      response.payload?.info ?? response.payload,
      { requestedVersion: request.body.version },
    );
    const resolvesResultUnknown = documentEvidenceResolves(
      projection,
      request.body.version,
      request.body.spuList.map((item) => item.spuName),
    );
    return {
      contractVersion: ERP06_SHEIN_REMOTE_BOUNDARY_CONTRACT_VERSION,
      commandId: request.commandId,
      publishAttemptId: request.publishAttemptId,
      productVersionId: request.productVersionId,
      stage: "document_state",
      path: request.path,
      method: request.method,
      status: "read",
      externalRead: true,
      resolvesResultUnknown,
      projection,
      diagnostics: response.diagnostics,
    };
  }

  async readSpuInfo({ job, authorization, version, spuName } = {}) {
    const request = buildErp06SpuInfoReadbackRequest({ job, version, spuName });
    const expected = jobData(job);
    assertAuthorization(authorization, expected, "readback");
    if (!this.readbackEnabled) return disabledReadback({ request, stage: "spu_info" });
    const response = await this.#requestRemote(request, authorization, expected, "readback");
    const projection = normalizeSpuInfo(
      response.payload?.info ?? response.payload,
      { expectedSpuName: request.body.spuName },
    );
    return {
      contractVersion: ERP06_SHEIN_REMOTE_BOUNDARY_CONTRACT_VERSION,
      commandId: request.commandId,
      publishAttemptId: request.publishAttemptId,
      productVersionId: request.productVersionId,
      stage: "spu_info",
      path: request.path,
      method: request.method,
      status: "read",
      externalRead: true,
      resolvesResultUnknown: true,
      projection,
      diagnostics: response.diagnostics,
    };
  }
}
