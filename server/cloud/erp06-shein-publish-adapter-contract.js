import crypto from "node:crypto";
import { ERP06_OUTBOX_JOB_CONTRACT_VERSION } from "./erp06-outbox-dispatcher-service.js";

export const ERP06_SHEIN_PUBLISH_ADAPTER_CONTRACT_VERSION =
  "erp06-shein-publish-v1";
export const ERP06_SHEIN_PUBLISH_ENDPOINT =
  "/open-api/goods/product/publishOrEdit";
export const ERP06_DOCUMENT_STATE_READBACK_ENDPOINT =
  "/open-api/goods/query-document-state";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RETRYABLE_SHEIN_CODE = "4000004";

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function text(value, max = 1000) {
  return String(value ?? "").trim().slice(0, max);
}

function identityField(value, camel, snake) {
  return value?.[camel] ?? value?.[snake];
}

function fingerprint(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(value)), "utf8")
    .digest("hex");
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

function sensitiveKey(key) {
  return /(?:secret|token|password|credential|authorization|signature|private[_-]?key|access[_-]?key)/i.test(
    String(key),
  );
}

function findSensitiveKey(value, path = "source") {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const match = findSensitiveKey(item, `${path}[${index}]`);
      if (match) return match;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  for (const [key, child] of Object.entries(value)) {
    if (sensitiveKey(key)) return `${path}.${key}`;
    const match = findSensitiveKey(child, `${path}.${key}`);
    if (match) return match;
  }
  return null;
}

function ensureUuid(value, fieldName) {
  const normalized = text(value, 100);
  if (!UUID_PATTERN.test(normalized)) {
    throw new Erp06SheinPublishAdapterError(
      "ERP06_ADAPTER_INVALID_IDENTITY",
      `${fieldName} 不是有效 UUID`,
    );
  }
  return normalized;
}

function ensureRequiredText(value, fieldName) {
  const normalized = text(value, 200);
  if (!normalized) {
    throw new Erp06SheinPublishAdapterError(
      "ERP06_ADAPTER_INVALID_IDENTITY",
      `${fieldName} 不能为空`,
    );
  }
  return normalized;
}

function normalizeJobData(job) {
  const source = object(job?.data || job);
  if (job?.name !== undefined && job.name !== "erp06-publish-command") {
    throw new Erp06SheinPublishAdapterError(
      "ERP06_ADAPTER_JOB_NAME_INVALID",
      "ERP-06 队列任务名称不是 publish command contract",
    );
  }
  const contractVersion = ensureRequiredText(
    source.contractVersion,
    "contractVersion",
  );
  if (contractVersion !== ERP06_OUTBOX_JOB_CONTRACT_VERSION) {
    throw new Erp06SheinPublishAdapterError(
      "ERP06_ADAPTER_CONTRACT_VERSION_INVALID",
      "ERP-06 SHEIN 发布适配器契约版本不匹配",
    );
  }
  return {
    contractVersion,
    commandId: ensureUuid(source.commandId, "commandId"),
    tenantId: ensureUuid(source.tenantId, "tenantId"),
    storeId: ensureUuid(source.storeId, "storeId"),
    publishBatchId: ensureUuid(source.publishBatchId, "publishBatchId"),
    publishBatchItemId: ensureUuid(
      source.publishBatchItemId,
      "publishBatchItemId",
    ),
    publishAttemptId: ensureUuid(
      source.publishAttemptId,
      "publishAttemptId",
    ),
    productVersionId: ensureUuid(
      source.productVersionId,
      "productVersionId",
    ),
    sourceDraftRevisionId: ensureUuid(
      source.sourceDraftRevisionId,
      "sourceDraftRevisionId",
    ),
    versionFingerprint: ensureRequiredText(
      source.versionFingerprint,
      "versionFingerprint",
    ),
  };
}

function sourceIdentity(source) {
  return {
    commandId: identityField(source, "commandId", "command_id"),
    tenantId: identityField(source, "tenantId", "tenant_id"),
    storeId: identityField(source, "storeId", "store_id"),
    publishAttemptId: identityField(
      source,
      "publishAttemptId",
      "publish_attempt_id",
    ),
    productVersionId: identityField(
      source,
      "productVersionId",
      "product_version_id",
    ),
    sourceDraftRevisionId: identityField(
      source,
      "sourceDraftRevisionId",
      "source_draft_revision_id",
    ),
    versionFingerprint: identityField(
      source,
      "versionFingerprint",
      "version_fingerprint",
    ),
  };
}

function assertSameIdentity(jobData, source) {
  const identity = sourceIdentity(source);
  for (const field of [
    "commandId",
    "tenantId",
    "storeId",
    "publishAttemptId",
    "productVersionId",
    "sourceDraftRevisionId",
  ]) {
    if (text(identity[field], 200) !== text(jobData[field], 200)) {
      throw new Erp06SheinPublishAdapterError(
        "ERP06_ADAPTER_SCOPE_MISMATCH",
        `冻结发布源的 ${field} 与队列命令不一致`,
      );
    }
  }
  if (text(identity.versionFingerprint, 500) !== jobData.versionFingerprint) {
    throw new Erp06SheinPublishAdapterError(
      "ERP06_ADAPTER_FINGERPRINT_MISMATCH",
      "冻结 ProductVersion 指纹与队列命令不一致",
    );
  }
}

function assertSafeSource(source) {
  const match = findSensitiveKey(source);
  if (match) {
    throw new Erp06SheinPublishAdapterError(
      "ERP06_ADAPTER_SENSITIVE_SOURCE",
      `冻结发布源包含禁止进入适配器边界的敏感字段: ${match}`,
    );
  }
}

function normalizeReceipt(payload, diagnostics = {}) {
  const info = object(payload.info);
  if (payload.code !== "0" || info.success !== true) return null;
  const skcs = (Array.isArray(info.skc_list) ? info.skc_list : []).map((skc) => ({
    skcName: text(skc?.skc_name, 200),
    skus: (Array.isArray(skc?.sku_list) ? skc.sku_list : []).map((sku) => ({
      skuCode: text(sku?.sku_code, 200),
      supplierSku: text(sku?.supplier_sku, 200),
    })),
  }));
  const receipt = {
    success: true,
    spuName: text(info.spu_name, 200),
    version: text(info.version, 200),
    skcs,
    traceId: text(payload.traceId || diagnostics.traceId, 200) || null,
  };
  if (
    !receipt.spuName ||
    !receipt.version ||
    !receipt.skcs.length ||
    receipt.skcs.some((skc) =>
      !skc.skcName ||
      !skc.skus.length ||
      skc.skus.some((sku) => !sku.skuCode || !sku.supplierSku),
    )
  ) {
    return null;
  }
  return receipt;
}

function responseFailure({ payload, error }) {
  const response = object(payload);
  const code = text(response.code || error?.code, 100) || null;
  const status = Number(error?.status ?? response.status);
  const traceId = text(
    error?.traceId || response.traceId || response.trace_id,
    200,
  ) || null;
  const requiresReauthorization = code === "openapi00001";
  const retryable = !requiresReauthorization && (
    code === RETRYABLE_SHEIN_CODE ||
    status === 429 ||
    (status >= 500 && status <= 599)
  );
  return {
    outcome: "failed",
    state: "failed",
    remoteCallMade: true,
    sendStarted: true,
    retryable,
    error: {
      code,
      message: text(
        response.msg || response.message || error?.message || "SHEIN商品发布失败",
        1000,
      ),
      traceId,
      ...(requiresReauthorization ? { requiresReauthorization: true } : {}),
    },
  };
}

function unknownResult(error = null, message = "SHEIN发布结果未知，必须先官方回读") {
  return {
    outcome: "unknown",
    state: "result_unknown",
    remoteCallMade: true,
    sendStarted: true,
    retryable: false,
    error: {
      code: text(error?.code, 100) || null,
      message: text(error?.message, 1000) || message,
      traceId: text(error?.traceId, 200) || null,
    },
  };
}

function notSent(commandId, publishAttemptId, code, message) {
  return {
    contractVersion: ERP06_SHEIN_PUBLISH_ADAPTER_CONTRACT_VERSION,
    commandId,
    publishAttemptId,
    outcome: "not_sent",
    state: "not_sent",
    remoteCallMade: false,
    sendStarted: false,
    retryable: false,
    error: { code, message },
  };
}

export class Erp06SheinPublishAdapterError extends Error {
  constructor(code, message, status = 409) {
    super(message);
    this.name = "Erp06SheinPublishAdapterError";
    this.code = code;
    this.status = status;
  }
}

export function buildErp06SheinPublishRequest({ job, source } = {}) {
  const jobData = normalizeJobData(job);
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Erp06SheinPublishAdapterError(
      "ERP06_ADAPTER_SOURCE_INVALID",
      "ERP-06 冻结发布源不是对象",
    );
  }
  assertSameIdentity(jobData, source);
  assertSafeSource(source);
  const requestBody = source.requestBody ?? source.request_body;
  if (!requestBody || typeof requestBody !== "object" || Array.isArray(requestBody)) {
    throw new Erp06SheinPublishAdapterError(
      "ERP06_ADAPTER_REQUEST_BODY_MISSING",
      "ERP-06 冻结发布源缺少 publishOrEdit 请求体",
    );
  }
  const path = text(source.endpoint || source.path, 200) || ERP06_SHEIN_PUBLISH_ENDPOINT;
  if (path !== ERP06_SHEIN_PUBLISH_ENDPOINT) {
    throw new Erp06SheinPublishAdapterError(
      "ERP06_ADAPTER_ENDPOINT_INVALID",
      "ERP-06 商品发布适配器只能使用官方 publishOrEdit 接口",
    );
  }
  return {
    contractVersion: ERP06_SHEIN_PUBLISH_ADAPTER_CONTRACT_VERSION,
    method: "POST",
    path,
    commandId: jobData.commandId,
    tenantId: jobData.tenantId,
    storeId: jobData.storeId,
    publishAttemptId: jobData.publishAttemptId,
    productVersionId: jobData.productVersionId,
    sourceDraftRevisionId: jobData.sourceDraftRevisionId,
    versionFingerprint: jobData.versionFingerprint,
    requestFingerprint: fingerprint(requestBody),
    body: requestBody,
  };
}

export class Erp06SheinPublishAdapter {
  constructor({
    executionEnabled = false,
    send = null,
    onSendStarted = null,
  } = {}) {
    this.executionEnabled = executionEnabled === true;
    this.send = send;
    this.onSendStarted = onSendStarted;
  }

  buildReadbackPlaceholder({ job, attemptState } = {}) {
    const jobData = normalizeJobData(job);
    if (!["submitted", "result_unknown"].includes(text(attemptState, 100))) {
      throw new Erp06SheinPublishAdapterError(
        "ERP06_READBACK_NOT_ALLOWED",
        "只有 submitted 或 result_unknown 才能进入官方单据状态回读边界",
      );
    }
    return {
      contractVersion: ERP06_SHEIN_PUBLISH_ADAPTER_CONTRACT_VERSION,
      commandId: jobData.commandId,
      publishAttemptId: jobData.publishAttemptId,
      stage: "document_state",
      endpoint: ERP06_DOCUMENT_STATE_READBACK_ENDPOINT,
      method: "POST",
      status: "not_implemented",
      supported: false,
      externalRead: false,
      resolvesResultUnknown: false,
      message: "官方商品单据状态回读占位尚未接入，不得据此解除 result_unknown",
    };
  }

  async execute({ job, authorization, sourceLoader } = {}) {
    const jobData = normalizeJobData(job);
    if (!this.executionEnabled) {
      return notSent(
        jobData.commandId,
        jobData.publishAttemptId,
        "ERP06_SHEIN_PUBLISH_EXECUTION_DISABLED",
        "ERP-06 SHEIN真实发布边界当前关闭",
      );
    }
    if (
      !authorization ||
      authorization.executionEnabled !== true ||
      authorization.authorizesPublishing !== true ||
      text(authorization.attemptState, 100) !== "claimed" ||
      !text(authorization.claimId, 200) ||
      text(authorization.tenantId, 200) !== jobData.tenantId ||
      text(authorization.storeId, 200) !== jobData.storeId ||
      text(authorization.commandId, 200) !== jobData.commandId ||
      text(authorization.publishAttemptId, 200) !== jobData.publishAttemptId
    ) {
      return notSent(
        jobData.commandId,
        jobData.publishAttemptId,
        "ERP06_SHEIN_PUBLISH_AUTHORIZATION_REQUIRED",
        "ERP-06 SHEIN发布缺少当前租户店铺、领取记录或一次性执行授权",
      );
    }
    if (typeof sourceLoader !== "function") {
      return notSent(
        jobData.commandId,
        jobData.publishAttemptId,
        "ERP06_ADAPTER_SOURCE_LOADER_REQUIRED",
        "ERP-06 SHEIN发布缺少冻结版本 sourceLoader",
      );
    }
    let frozenSource;
    try {
      frozenSource = await sourceLoader({
        ...jobData,
        claimId: text(authorization.claimId, 200),
      });
    } catch (error) {
      return notSent(
        jobData.commandId,
        jobData.publishAttemptId,
        "ERP06_ADAPTER_SOURCE_UNAVAILABLE",
        text(error?.message, 1000) || "ERP-06 冻结发布源暂不可用",
      );
    }
    const request = buildErp06SheinPublishRequest({ job: jobData, source: frozenSource });
    if (typeof this.send !== "function") {
      return notSent(
        jobData.commandId,
        jobData.publishAttemptId,
        "ERP06_ADAPTER_SENDER_REQUIRED",
        "ERP-06 SHEIN发布边界未配置实际请求 sender",
      );
    }
    if (typeof this.onSendStarted !== "function") {
      return notSent(
        jobData.commandId,
        jobData.publishAttemptId,
        "ERP06_SEND_STARTED_PERSISTENCE_REQUIRED",
        "发送 SHEIN 请求前必须先持久化 send_started",
      );
    }
    try {
      await this.onSendStarted({
        contractVersion: request.contractVersion,
        commandId: request.commandId,
        publishAttemptId: request.publishAttemptId,
        productVersionId: request.productVersionId,
        versionFingerprint: request.versionFingerprint,
        path: request.path,
      });
    } catch (error) {
      return notSent(
        jobData.commandId,
        jobData.publishAttemptId,
        "ERP06_SEND_STARTED_PERSISTENCE_FAILED",
        text(error?.message, 1000) || "send_started 持久化失败，已阻断远端请求",
      );
    }
    try {
      const response = await this.send(request);
      const payload = object(response?.payload || response);
      const receipt = normalizeReceipt(payload, response?.diagnostics);
      if (receipt) {
        return {
          contractVersion: request.contractVersion,
          commandId: request.commandId,
          publishAttemptId: request.publishAttemptId,
          outcome: "accepted",
          state: "submitted",
          remoteCallMade: true,
          sendStarted: true,
          retryable: false,
          receipt,
        };
      }
      if (payload.code !== "0" || object(payload.info).success === false) {
        return {
          contractVersion: request.contractVersion,
          commandId: request.commandId,
          publishAttemptId: request.publishAttemptId,
          ...responseFailure({ payload }),
        };
      }
      return {
        contractVersion: request.contractVersion,
        commandId: request.commandId,
        publishAttemptId: request.publishAttemptId,
        ...unknownResult(
          {
            code: "ERP06_PUBLISH_RESPONSE_INCOMPLETE",
            message: "SHEIN返回成功状态但缺少完整SPU、SKC、SKU或审核版本，必须回读确认",
            traceId: payload.traceId || response?.diagnostics?.traceId,
          },
          "SHEIN返回成功状态但缺少完整SPU、SKC、SKU或审核版本，必须回读确认",
        ),
      };
    } catch (error) {
      const explicitResponse = Boolean(error?.response && typeof error.response === "object");
      const result = explicitResponse
        ? responseFailure({ payload: error.response, error })
        : unknownResult(error);
      return {
        contractVersion: request.contractVersion,
        commandId: request.commandId,
        publishAttemptId: request.publishAttemptId,
        ...result,
      };
    }
  }
}
