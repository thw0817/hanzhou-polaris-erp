import {
  Erp06SheinPublishAdapter,
} from "./erp06-shein-publish-adapter-contract.js";
import {
  processErp06OfficialReadback,
} from "./erp06-official-readback-orchestrator.js";
import {
  processErp06PublishJob,
} from "./erp06-publish-worker-service.js";

export const ERP06_PUBLISH_READBACK_PIPELINE_CONTRACT_VERSION =
  "erp06-publish-readback-pipeline-v1";

const READBACK_OUTCOMES = new Set(["accepted", "unknown"]);
const READBACK_STAGES = new Set(["document_state", "spu_info"]);

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function text(value, max = 1000) {
  return String(value ?? "").trim().slice(0, max);
}

function pipelineJobData(job) {
  return object(job?.data || job);
}

function dependency(value, methodName, fieldName) {
  if (!value || typeof value[methodName] !== "function") {
    throw new Erp06PublishReadbackPipelineError(
      "ERP06_PIPELINE_DEPENDENCY_INVALID",
      `${fieldName} 缺少 ${methodName}`,
    );
  }
}

function normalizeReadback(readback) {
  if (readback === undefined || readback === null) return null;
  if (!readback || typeof readback !== "object" || Array.isArray(readback)) {
    throw new Erp06PublishReadbackPipelineError(
      "ERP06_PIPELINE_READBACK_INVALID",
      "官方回读配置必须是对象或 null",
    );
  }
  return { ...readback };
}

function validateReadbackSpec(readback, data) {
  if (!readback) return;
  const stage = text(readback.stage, 100);
  if (!READBACK_STAGES.has(stage)) {
    throw new Erp06PublishReadbackPipelineError(
      "ERP06_PIPELINE_READBACK_INVALID",
      "官方回读阶段只能是 document_state 或 spu_info",
    );
  }
  if (!text(readback.version, 200)) {
    throw new Erp06PublishReadbackPipelineError(
      "ERP06_PIPELINE_READBACK_INVALID",
      "官方回读必须提供 platform version",
    );
  }
  if (
    readback.versionFingerprint !== undefined
    && text(readback.versionFingerprint, 500) !== text(data.versionFingerprint, 500)
  ) {
    throw new Erp06PublishReadbackPipelineError(
      "ERP06_PIPELINE_SCOPE_MISMATCH",
      "官方回读 versionFingerprint 与队列任务不一致",
      409,
    );
  }
  if (stage === "document_state") {
    if (!Array.isArray(readback.spuNames)) {
      throw new Erp06PublishReadbackPipelineError(
        "ERP06_PIPELINE_READBACK_INVALID",
        "document_state 回读必须提供 spuNames 数组",
      );
    }
    const names = Array.from(
      new Set(readback.spuNames.map((value) => text(value, 200)).filter(Boolean)),
    );
    if (!names.length || names.length > 100 || names.length !== readback.spuNames.length) {
      throw new Erp06PublishReadbackPipelineError(
        "ERP06_PIPELINE_READBACK_INVALID",
        "document_state 回读的 spuNames 数量或值不符合要求",
      );
    }
  } else if (!text(readback.spuName, 200)) {
    throw new Erp06PublishReadbackPipelineError(
      "ERP06_PIPELINE_READBACK_INVALID",
      "spu_info 回读必须提供 spuName",
    );
  }
}

function readbackAuthorization({ data, publish, authorizesReadback }) {
  return {
    tenantId: data.tenantId,
    storeId: data.storeId,
    commandId: data.commandId,
    publishAttemptId: data.publishAttemptId,
    productVersionId: data.productVersionId,
    versionFingerprint: data.versionFingerprint,
    claimId: publish.claimId,
    attemptState: publish.outcome === "unknown" ? "result_unknown" : "submitted",
    authorizesReadback: authorizesReadback === true,
  };
}

function pipelineState(publish, readbackResult) {
  if (publish.outcome === "accepted") return "completed";
  if (readbackResult?.resolvesResultUnknown === true) return "completed";
  return "readback_pending";
}

export class Erp06PublishReadbackPipelineError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "Erp06PublishReadbackPipelineError";
    this.code = code;
    this.status = status;
  }
}

/**
 * Isolated ERP-06 composition only. It is intentionally not wired to any
 * production worker, Control route, queue consumer, or deployment profile.
 */
export async function processErp06PublishReadbackJob({
  job,
  commandRepository,
  resultRepository,
  sourceLoader = null,
  remoteBoundary,
  readbackRepository,
  executionEnabled = false,
  authorizesPublishing = false,
  authorizesReadback = false,
  readback = null,
  workerId,
  claimId,
  dryRun = true,
  now,
} = {}) {
  dependency(remoteBoundary, "sendPublish", "remoteBoundary");
  const readbackSpec = normalizeReadback(readback);
  const data = pipelineJobData(job);
  validateReadbackSpec(readbackSpec, data);
  if (readbackSpec) {
    dependency(remoteBoundary, readbackSpec.stage === "spu_info"
      ? "readSpuInfo"
      : "readDocumentState", "remoteBoundary");
    dependency(readbackRepository, "recordReadback", "readbackRepository");
  }

  const publish = await processErp06PublishJob({
    job,
    commandRepository,
    resultRepository,
    sourceLoader,
    executionEnabled,
    authorizesPublishing,
    workerId,
    claimId,
    dryRun,
    now,
    adapterFactory: ({ job: frozenJob, authorization, onSendStarted }) => {
      if (text(frozenJob?.commandId, 200) !== text(authorization?.commandId, 200)) {
        throw new Erp06PublishReadbackPipelineError(
          "ERP06_PIPELINE_SCOPE_MISMATCH",
          "Worker 传入 adapter factory 的 job/授权 commandId 不一致",
          409,
        );
      }
      return new Erp06SheinPublishAdapter({
        executionEnabled: executionEnabled === true
          && remoteBoundary.executionEnabled === true,
        send: (request) => remoteBoundary.sendPublish({
          request,
          authorization,
        }),
        onSendStarted,
      });
    },
  });

  if (!READBACK_OUTCOMES.has(publish.outcome)) {
    return {
      contractVersion: ERP06_PUBLISH_READBACK_PIPELINE_CONTRACT_VERSION,
      state: publish.outcome === "failed" ? "publish_failed" : publish.state,
      publish,
      readback: null,
    };
  }

  if (!readbackSpec) {
    return {
      contractVersion: ERP06_PUBLISH_READBACK_PIPELINE_CONTRACT_VERSION,
      state: "readback_required",
      publish,
      readback: null,
    };
  }

  const readbackResult = await processErp06OfficialReadback({
    stage: readbackSpec.stage,
    job,
    authorization: readbackAuthorization({
      data,
      publish,
      authorizesReadback,
    }),
    version: readbackSpec.version,
    versionFingerprint: readbackSpec.versionFingerprint ?? data.versionFingerprint,
    spuNames: readbackSpec.spuNames,
    spuName: readbackSpec.spuName,
    remoteBoundary,
    readbackRepository,
    occurredAt: readbackSpec.occurredAt,
  });

  return {
    contractVersion: ERP06_PUBLISH_READBACK_PIPELINE_CONTRACT_VERSION,
    state: readbackResult.state === "disabled"
      ? "readback_disabled"
      : pipelineState(publish, readbackResult),
    publish,
    readback: readbackResult,
  };
}
