import {
  ERP06_DOCUMENT_STATE_READBACK_ENDPOINT,
  ERP06_SHEIN_REMOTE_BOUNDARY_CONTRACT_VERSION,
  ERP06_SPU_INFO_READBACK_ENDPOINT,
} from "./erp06-shein-remote-boundary.js";
import {
  ERP06_OUTBOX_JOB_CONTRACT_VERSION,
  ERP06_OUTBOX_JOB_NAME,
} from "./erp06-outbox-dispatcher-service.js";

export const ERP06_OFFICIAL_READBACK_ORCHESTRATOR_CONTRACT_VERSION =
  "erp06-official-readback-orchestrator-v1";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STAGES = Object.freeze({
  document_state: Object.freeze({
    path: ERP06_DOCUMENT_STATE_READBACK_ENDPOINT,
    methodName: "readDocumentState",
  }),
  spu_info: Object.freeze({
    path: ERP06_SPU_INFO_READBACK_ENDPOINT,
    methodName: "readSpuInfo",
  }),
});

function text(value, max = 1000) {
  return String(value ?? "").trim().slice(0, max);
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function required(value, fieldName, max = 1000) {
  const normalized = text(value, max);
  if (!normalized) {
    throw new Erp06OfficialReadbackOrchestratorError(
      "ERP06_ORCHESTRATOR_INPUT_INVALID",
      `${fieldName} 不能为空`,
    );
  }
  return normalized;
}

function ensureUuid(value, fieldName) {
  const normalized = required(value, fieldName, 100);
  if (!UUID_PATTERN.test(normalized)) {
    throw new Erp06OfficialReadbackOrchestratorError(
      "ERP06_ORCHESTRATOR_INPUT_INVALID",
      `${fieldName} 不是有效 UUID`,
    );
  }
  return normalized;
}

function normalizeJob(job) {
  if (!job || typeof job !== "object" || Array.isArray(job)) {
    throw new Erp06OfficialReadbackOrchestratorError(
      "ERP06_ORCHESTRATOR_INPUT_INVALID",
      "ERP-06 官方回读缺少队列任务",
    );
  }
  if (job.name !== undefined && text(job.name, 200) !== ERP06_OUTBOX_JOB_NAME) {
    throw new Erp06OfficialReadbackOrchestratorError(
      "ERP06_ORCHESTRATOR_INPUT_INVALID",
      "ERP-06 官方回读只接受 erp06-publish-command",
    );
  }
  const source = job.data && typeof job.data === "object" && !Array.isArray(job.data)
    ? job.data
    : job;
  if (text(source.contractVersion, 200) !== ERP06_OUTBOX_JOB_CONTRACT_VERSION) {
    throw new Erp06OfficialReadbackOrchestratorError(
      "ERP06_ORCHESTRATOR_INPUT_INVALID",
      "ERP-06 官方回读任务 contract version 不匹配",
    );
  }
  const normalized = {
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
  if (job.id !== undefined && text(job.id, 100) !== normalized.commandId) {
    throw new Erp06OfficialReadbackOrchestratorError(
      "ERP06_ORCHESTRATOR_INPUT_INVALID",
      "队列任务 id 与 publish command 不一致",
    );
  }
  return normalized;
}

function normalizeStage(stage) {
  const normalized = text(stage, 100);
  if (!STAGES[normalized]) {
    throw new Erp06OfficialReadbackOrchestratorError(
      "ERP06_ORCHESTRATOR_INPUT_INVALID",
      "一次官方回读只能明确选择 document_state 或 spu_info",
    );
  }
  return { stage: normalized, ...STAGES[normalized] };
}

function uniqueSpuNames(values) {
  if (!Array.isArray(values)) {
    throw new Erp06OfficialReadbackOrchestratorError(
      "ERP06_ORCHESTRATOR_INPUT_INVALID",
      "document_state 回读必须提供 spuNames 数组",
    );
  }
  const normalized = Array.from(
    new Set(values.map((value) => text(value, 200)).filter(Boolean)),
  );
  if (!normalized.length || normalized.length > 100) {
    throw new Erp06OfficialReadbackOrchestratorError(
      "ERP06_ORCHESTRATOR_INPUT_INVALID",
      "document_state 回读的 spuNames 数量不符合要求",
    );
  }
  return normalized;
}

function stageInput(stage, { version, spuNames, spuName }) {
  const normalizedVersion = required(version, "version", 200);
  if (stage === "document_state") {
    return {
      version: normalizedVersion,
      spuNames: uniqueSpuNames(spuNames),
    };
  }
  return {
    version: normalizedVersion,
    spuName: required(spuName, "spuName", 200),
  };
}

function assertDependency(value, methodName, fieldName) {
  if (!value || typeof value[methodName] !== "function") {
    throw new Erp06OfficialReadbackOrchestratorError(
      "ERP06_ORCHESTRATOR_DEPENDENCY_INVALID",
      `${fieldName} 缺少 ${methodName}`,
    );
  }
}

function assertResultEnvelope(result, expected, definition) {
  const value = object(result);
  if (
    text(value.contractVersion, 200) !== ERP06_SHEIN_REMOTE_BOUNDARY_CONTRACT_VERSION ||
    text(value.commandId, 200) !== expected.commandId ||
    text(value.publishAttemptId, 200) !== expected.publishAttemptId ||
    text(value.productVersionId, 200) !== expected.productVersionId ||
    text(value.stage, 100) !== expected.stage ||
    text(value.path, 200) !== definition.path ||
    text(value.method, 20) !== "POST" ||
    typeof value.externalRead !== "boolean" ||
    typeof value.resolvesResultUnknown !== "boolean"
  ) {
    throw new Erp06OfficialReadbackOrchestratorError(
      "ERP06_ORCHESTRATOR_RESULT_INVALID",
      "官方回读结果的契约、作用域或 endpoint 不一致",
      409,
    );
  }
  return value;
}

function assertDisabledResult(result, expected, definition) {
  const value = assertResultEnvelope(result, expected, definition);
  if (
    text(value.status, 100) !== "disabled" ||
    value.externalRead !== false ||
    value.resolvesResultUnknown !== false ||
    value.projection !== null
  ) {
    throw new Erp06OfficialReadbackOrchestratorError(
      "ERP06_ORCHESTRATOR_RESULT_INVALID",
      "关闭状态的官方回读结果不符合安全契约",
      409,
    );
  }
  return value;
}

function assertReadResult(result, expected, definition) {
  const value = assertResultEnvelope(result, expected, definition);
  const projection = object(value.projection);
  if (
    text(value.status, 100) !== "read" ||
    value.externalRead !== true ||
    text(projection.mode, 100) !== "dry-run" ||
    projection.externalWrite !== false ||
    !text(projection.projectionVersion, 200) ||
    !projection.projection ||
    typeof projection.projection !== "object" ||
    !projection.summary ||
    typeof projection.summary !== "object"
  ) {
    throw new Erp06OfficialReadbackOrchestratorError(
      "ERP06_ORCHESTRATOR_RESULT_INVALID",
      "官方回读不是可安全落账的 dry-run projection",
      409,
    );
  }
  return value;
}

export class Erp06OfficialReadbackOrchestratorError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "Erp06OfficialReadbackOrchestratorError";
    this.code = code;
    this.status = status;
  }
}

export async function processErp06OfficialReadback({
  stage,
  job,
  authorization,
  version,
  versionFingerprint,
  spuNames,
  spuName,
  remoteBoundary,
  readbackRepository,
  occurredAt,
} = {}) {
  const definition = normalizeStage(stage);
  assertDependency(remoteBoundary, definition.methodName, "remoteBoundary");
  assertDependency(readbackRepository, "recordReadback", "readbackRepository");
  const expectedJob = normalizeJob(job);
  const input = stageInput(definition.stage, { version, spuNames, spuName });
  const normalizedVersionFingerprint = required(
    versionFingerprint ?? expectedJob.versionFingerprint,
    "versionFingerprint",
    500,
  );
  if (normalizedVersionFingerprint !== expectedJob.versionFingerprint) {
    throw new Erp06OfficialReadbackOrchestratorError(
      "ERP06_ORCHESTRATOR_INPUT_INVALID",
      "versionFingerprint 与队列任务不一致",
      409,
    );
  }
  const result = definition.stage === "document_state"
    ? await remoteBoundary.readDocumentState({
      job,
      authorization,
      version: input.version,
      spuNames: input.spuNames,
    })
    : await remoteBoundary.readSpuInfo({
      job,
      authorization,
      version: input.version,
      spuName: input.spuName,
    });
  const expected = {
    commandId: expectedJob.commandId,
    publishAttemptId: expectedJob.publishAttemptId,
    productVersionId: expectedJob.productVersionId,
    stage: definition.stage,
  };
  if (text(result?.status, 100) === "disabled") {
    assertDisabledResult(result, expected, definition);
    return {
      contractVersion: ERP06_OFFICIAL_READBACK_ORCHESTRATOR_CONTRACT_VERSION,
      state: "disabled",
      stage: definition.stage,
      externalRead: false,
      persisted: false,
      resolvesResultUnknown: false,
    };
  }
  const normalizedResult = assertReadResult(result, expected, definition);
  const persistence = await readbackRepository.recordReadback({
    tenantId: expectedJob.tenantId,
    storeId: expectedJob.storeId,
    commandId: expectedJob.commandId,
    publishAttemptId: expectedJob.publishAttemptId,
    productVersionId: expectedJob.productVersionId,
    version: input.version,
    versionFingerprint: normalizedVersionFingerprint,
    result: normalizedResult,
    ...(occurredAt === undefined ? {} : { occurredAt }),
  });
  return {
    contractVersion: ERP06_OFFICIAL_READBACK_ORCHESTRATOR_CONTRACT_VERSION,
    state: "persisted",
    stage: definition.stage,
    externalRead: true,
    persisted: true,
    resolvesResultUnknown: normalizedResult.resolvesResultUnknown,
    persistence,
  };
}
