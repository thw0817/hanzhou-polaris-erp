import { randomUUID } from "node:crypto";

import {
  ERP06_OUTBOX_JOB_CONTRACT_VERSION,
  ERP06_OUTBOX_JOB_NAME,
} from "./erp06-outbox-dispatcher-service.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TERMINAL_ATTEMPT_STATES = new Set([
  "result_unknown",
  "superseded_by_new_attempt",
]);
const RESULT_OUTCOMES = new Set(["accepted", "failed", "unknown", "not_sent"]);

function text(value, max = 1000) {
  return String(value ?? "").trim().slice(0, max);
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function ensureUuid(value, fieldName) {
  const normalized = text(value, 100);
  if (!UUID_PATTERN.test(normalized)) {
    throw new Erp06PublishWorkerError(
      "ERP06_WORKER_JOB_INVALID",
      `${fieldName} 不是有效 UUID`,
    );
  }
  return normalized;
}

function required(value, fieldName, max = 1000) {
  const normalized = text(value, max);
  if (!normalized) {
    throw new Erp06PublishWorkerError(
      "ERP06_WORKER_JOB_INVALID",
      `${fieldName} 不能为空`,
    );
  }
  return normalized;
}

function identityField(row, camel, snake) {
  return row?.[camel] ?? row?.[snake];
}

function normalizeJob(job) {
  if (!job || typeof job !== "object" || Array.isArray(job)) {
    throw new Erp06PublishWorkerError(
      "ERP06_WORKER_JOB_INVALID",
      "ERP-06 Worker 缺少队列任务",
    );
  }
  if (text(job.name, 200) !== ERP06_OUTBOX_JOB_NAME) {
    throw new Erp06PublishWorkerError(
      "ERP06_WORKER_JOB_INVALID",
      "ERP-06 Worker 只接受 erp06-publish-command",
    );
  }
  const source = object(job.data);
  if (text(source.contractVersion, 200) !== ERP06_OUTBOX_JOB_CONTRACT_VERSION) {
    throw new Erp06PublishWorkerError(
      "ERP06_WORKER_JOB_INVALID",
      "ERP-06 Worker contract version 不匹配",
    );
  }
  const payload = {
    contractVersion: ERP06_OUTBOX_JOB_CONTRACT_VERSION,
    commandId: ensureUuid(source.commandId, "commandId"),
    tenantId: ensureUuid(source.tenantId, "tenantId"),
    storeId: ensureUuid(source.storeId, "storeId"),
    publishBatchId: ensureUuid(source.publishBatchId, "publishBatchId"),
    publishBatchItemId: ensureUuid(source.publishBatchItemId, "publishBatchItemId"),
    publishAttemptId: ensureUuid(source.publishAttemptId, "publishAttemptId"),
    productVersionId: ensureUuid(source.productVersionId, "productVersionId"),
    sourceDraftRevisionId: ensureUuid(
      source.sourceDraftRevisionId,
      "sourceDraftRevisionId",
    ),
    versionFingerprint: required(source.versionFingerprint, "versionFingerprint", 500),
  };
  if (job.id !== undefined && text(job.id, 100) !== payload.commandId) {
    throw new Erp06PublishWorkerError(
      "ERP06_WORKER_JOB_INVALID",
      "队列任务 id 与 publish command 不一致",
    );
  }
  return payload;
}

function assertMatches(claimed, expected, camel, snake = camel) {
  const actual = identityField(claimed, camel, snake);
  if (text(actual, 200) !== text(expected, 200)) {
    throw new Erp06PublishWorkerError(
      "ERP06_WORKER_CLAIM_IDENTITY_MISMATCH",
      `Worker claim 的 ${snake} 与队列任务不一致`,
      409,
    );
  }
}

function assertClaimIdentity(claimed, expected, claimId) {
  assertMatches(claimed, expected.commandId, "commandId", "id");
  assertMatches(claimed, expected.tenantId, "tenantId", "tenant_id");
  assertMatches(claimed, expected.storeId, "storeId", "store_id");
  assertMatches(claimed, expected.publishAttemptId, "publishAttemptId", "publish_attempt_id");
  assertMatches(claimed, expected.productVersionId, "productVersionId", "product_version_id");
  if (text(claimed.state, 100) !== "dispatching") {
    throw new Erp06PublishWorkerError(
      "ERP06_WORKER_CLAIM_IDENTITY_MISMATCH",
      "Worker claim 未处于 dispatching 状态",
      409,
    );
  }
  if (text(claimed.worker_claim_id, 200) !== claimId) {
    throw new Erp06PublishWorkerError(
      "ERP06_WORKER_CLAIM_IDENTITY_MISMATCH",
      "Worker claimId 已漂移或已失效",
      409,
    );
  }
  if (TERMINAL_ATTEMPT_STATES.has(text(claimed.attempt_state, 100))) {
    throw new Erp06PublishWorkerError(
      "ERP06_WORKER_ATTEMPT_NOT_EXECUTABLE",
      "result_unknown 或已被新尝试替代的 Attempt 不得再次执行",
      409,
    );
  }
  const summary = object(claimed.payload_summary);
  if (
    Object.keys(summary).length &&
    text(summary.versionFingerprint ?? summary.version_fingerprint, 500) !==
      expected.versionFingerprint
  ) {
    throw new Erp06PublishWorkerError(
      "ERP06_WORKER_CLAIM_IDENTITY_MISMATCH",
      "Worker claim 的版本指纹与队列任务不一致",
      409,
    );
  }
  for (const [camel, snake] of [
    ["publishBatchId", "publishBatchId"],
    ["publishBatchItemId", "publishBatchItemId"],
    ["publishAttemptId", "publishAttemptId"],
    ["productVersionId", "productVersionId"],
    ["sourceDraftRevisionId", "sourceDraftRevisionId"],
  ]) {
    if (summary[camel] !== undefined || summary[snake] !== undefined) {
      assertMatches(summary, expected[camel], camel, snake);
    }
  }
}

function assertAdapterResult(result, expected) {
  const normalized = object(result);
  if (!RESULT_OUTCOMES.has(text(normalized.outcome, 100))) {
    throw new Erp06PublishWorkerError(
      "ERP06_WORKER_RESULT_INVALID",
      "SHEIN 适配器返回了不支持的 outcome",
      409,
    );
  }
  if (text(normalized.commandId, 200) !== expected.commandId) {
    throw new Erp06PublishWorkerError(
      "ERP06_WORKER_RESULT_SCOPE_MISMATCH",
      "SHEIN 适配器结果的 commandId 不一致",
      409,
    );
  }
  if (text(normalized.publishAttemptId, 200) !== expected.publishAttemptId) {
    throw new Erp06PublishWorkerError(
      "ERP06_WORKER_RESULT_SCOPE_MISMATCH",
      "SHEIN 适配器结果的 publishAttemptId 不一致",
      409,
    );
  }
  return normalized;
}

export class Erp06PublishWorkerError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.name = "Erp06PublishWorkerError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export async function processErp06PublishJob({
  job,
  commandRepository,
  resultRepository,
  adapterFactory,
  sourceLoader = null,
  executionEnabled = false,
  authorizesPublishing = false,
  workerId = `erp06-publish-worker-${process.pid}`,
  claimId = randomUUID(),
  dryRun = true,
  now = () => new Date(),
} = {}) {
  const payload = normalizeJob(job);
  if (!commandRepository || typeof commandRepository.claimCommand !== "function") {
    throw new Erp06PublishWorkerError(
      "ERP06_WORKER_DEPENDENCY_INVALID",
      "ERP-06 Worker 缺少 commandRepository.claimCommand",
    );
  }
  if (!resultRepository || typeof resultRepository.recordSendStarted !== "function") {
    throw new Erp06PublishWorkerError(
      "ERP06_WORKER_DEPENDENCY_INVALID",
      "ERP-06 Worker 缺少 resultRepository.recordSendStarted",
    );
  }
  if (!resultRepository || typeof resultRepository.recordPublishResult !== "function") {
    throw new Erp06PublishWorkerError(
      "ERP06_WORKER_DEPENDENCY_INVALID",
      "ERP-06 Worker 缺少 resultRepository.recordPublishResult",
    );
  }
  if (typeof adapterFactory !== "function") {
    throw new Erp06PublishWorkerError(
      "ERP06_WORKER_DEPENDENCY_INVALID",
      "ERP-06 Worker 缺少 adapterFactory",
    );
  }
  const normalizedClaimId = required(claimId, "claimId", 200);
  const claimed = await commandRepository.claimCommand({
    tenantId: payload.tenantId,
    storeId: payload.storeId,
    commandId: payload.commandId,
    workerId: text(workerId, 200) || `erp06-publish-worker-${process.pid}`,
    claimId: normalizedClaimId,
    now: now(),
  });
  if (!claimed) {
    return {
      state: "not_claimed",
      commandId: payload.commandId,
      claimId: normalizedClaimId,
      remoteCallMade: false,
    };
  }
  assertClaimIdentity(claimed, payload, normalizedClaimId);

  const adapter = adapterFactory({
    onSendStarted: async (info = {}) => resultRepository.recordSendStarted({
      tenantId: payload.tenantId,
      storeId: payload.storeId,
      commandId: payload.commandId,
      publishAttemptId: payload.publishAttemptId,
      claimId: normalizedClaimId,
      productVersionId: payload.productVersionId,
      versionFingerprint: payload.versionFingerprint,
      path: info.path,
      occurredAt: now(),
    }),
  });
  if (!adapter || typeof adapter.execute !== "function") {
    throw new Erp06PublishWorkerError(
      "ERP06_WORKER_ADAPTER_INVALID",
      "ERP-06 Worker 的 SHEIN adapter 不可执行",
    );
  }
  const adapterResult = assertAdapterResult(
    await adapter.execute({
      job: payload,
      authorization: {
        executionEnabled: executionEnabled === true,
        authorizesPublishing: authorizesPublishing === true,
        attemptState: "claimed",
        claimId: normalizedClaimId,
        tenantId: payload.tenantId,
        storeId: payload.storeId,
        commandId: payload.commandId,
        publishAttemptId: payload.publishAttemptId,
      },
      sourceLoader,
    }),
    payload,
  );

  if (adapterResult.outcome === "not_sent") {
    if (dryRun !== true) {
      throw new Erp06PublishWorkerError(
        "ERP06_WORKER_NOT_SENT_NOT_DRY_RUN",
        "not_sent 结果只能在显式 dry-run 下释放命令",
        409,
      );
    }
    if (typeof commandRepository.releaseCommandDryRun !== "function") {
      throw new Erp06PublishWorkerError(
        "ERP06_WORKER_DEPENDENCY_INVALID",
        "ERP-06 Worker 缺少 dry-run release boundary",
      );
    }
    const released = await commandRepository.releaseCommandDryRun({
      tenantId: payload.tenantId,
      storeId: payload.storeId,
      commandId: payload.commandId,
      claimId: normalizedClaimId,
      releasedAt: now(),
    });
    if (!released) {
      throw new Erp06PublishWorkerError(
        "ERP06_WORKER_RELEASE_FAILED",
        "ERP-06 dry-run 命令释放失败，拒绝猜测性重试",
        409,
      );
    }
    return {
      state: "not_sent",
      outcome: "not_sent",
      commandId: payload.commandId,
      publishAttemptId: payload.publishAttemptId,
      claimId: normalizedClaimId,
      released: true,
      remoteCallMade: false,
    };
  }

  if (adapterResult.remoteCallMade !== true || adapterResult.sendStarted !== true) {
    throw new Erp06PublishWorkerError(
      "ERP06_WORKER_RESULT_NOT_SENT",
      "非 not_sent 结果必须证明已发送且已持久化 send_started",
      409,
    );
  }
  const persisted = await resultRepository.recordPublishResult({
    tenantId: payload.tenantId,
    storeId: payload.storeId,
    commandId: payload.commandId,
    publishAttemptId: payload.publishAttemptId,
    claimId: normalizedClaimId,
    productVersionId: payload.productVersionId,
    result: adapterResult,
    occurredAt: now(),
  });
  return {
    state: "completed",
    outcome: adapterResult.outcome,
    commandId: payload.commandId,
    publishAttemptId: payload.publishAttemptId,
    claimId: normalizedClaimId,
    persisted,
    remoteCallMade: true,
  };
}
