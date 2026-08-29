import { randomUUID } from "node:crypto";
import { Worker } from "bullmq";
import Redis from "ioredis";
import { verifyProductPublishCandidate } from "./product-publish-candidate.js";
import { verifyProductRemotePublishCandidate } from "./product-remote-preflight.js";
import {
  PRODUCT_PUBLISH_JOB_NAME,
  PRODUCT_PUBLISH_QUEUE_NAME,
} from "./job-queue.js";

function invalidJob() {
  const error = new Error("商品发布队列消息无效");
  error.code = "INVALID_PRODUCT_PUBLISH_JOB";
  return error;
}

function text(value) {
  return String(value || "").trim();
}

function candidateFailure() {
  return {
    code: "PRODUCT_PUBLISH_CANDIDATE_STALE",
    message: "商品草稿或冻结发布载荷已变化，未调用SHEIN，请重新预检并确认",
    traceId: null,
  };
}

export async function processProductPublishRun({
  job,
  repository,
  executor,
  workerId = "product-publish-worker",
  randomId = randomUUID,
  now = () => new Date(),
} = {}) {
  if (
    !repository ||
    !executor ||
    job?.name !== PRODUCT_PUBLISH_JOB_NAME
  ) {
    throw invalidJob();
  }
  const tenantId = text(job.data?.tenantId);
  const storeId = text(job.data?.storeId);
  const executionRunId = text(job.data?.executionRunId);
  if (!tenantId || !storeId || !executionRunId) throw invalidJob();

  await repository.markExpiredClaimsUnknown({
    tenantId,
    storeId,
    executionRunId,
    expiredAt: now(),
  });

  const processedJobIds = [];
  const summary = {
    executionRunId,
    submittedCount: 0,
    retryableFailureCount: 0,
    terminalFailureCount: 0,
    unknownCount: 0,
  };
  while (true) {
    const claimId = randomId();
    const claimed = await repository.claimNextJob({
      tenantId,
      storeId,
      executionRunId,
      workerId,
      claimId,
      claimedAt: now(),
      excludedJobIds: processedJobIds,
    });
    if (!claimed) break;
    processedJobIds.push(claimed.id);

    const source = await repository.loadClaimedExecutionSource({
      tenantId,
      storeId,
      executionRunId,
      jobId: claimed.id,
      claimId,
    });
    const currentSource = source?.currentSourceCandidate;
    const remoteCandidate = source?.remoteCandidate;
    const sourceFingerprint = text(claimed.source_candidate_fingerprint);
    const remoteFingerprint = text(claimed.remote_candidate_fingerprint);
    if (
      !source ||
      !verifyProductPublishCandidate(currentSource) ||
      text(currentSource.fingerprint) !== sourceFingerprint ||
      !verifyProductRemotePublishCandidate(remoteCandidate) ||
      text(remoteCandidate.fingerprint) !== remoteFingerprint ||
      text(remoteCandidate.sourceCandidateFingerprint) !== sourceFingerprint
    ) {
      await repository.recordExecutionFailure({
        tenantId,
        storeId,
        executionRunId,
        jobId: claimed.id,
        claimId,
        outcome: "failed",
        retryable: false,
        error: candidateFailure(),
        failedAt: now(),
      });
      summary.terminalFailureCount += 1;
      continue;
    }

    const result = await executor.execute({
      tenantId,
      storeId,
      job: source.job,
      claimId,
      remoteCandidate,
    });
    if (result.outcome === "accepted") {
      const persisted = await repository.recordSubmitted({
        tenantId,
        storeId,
        executionRunId,
        jobId: claimed.id,
        claimId,
        receipt: result.receipt,
        submittedAt: now(),
      });
      if (!persisted) {
        throw new Error("商品发布结果无法关联当前领取任务");
      }
      summary.submittedCount += 1;
      continue;
    }
    await repository.recordExecutionFailure({
      tenantId,
      storeId,
      executionRunId,
      jobId: claimed.id,
      claimId,
      outcome: result.outcome,
      retryable: result.retryable === true,
      error: result.error,
      failedAt: now(),
    });
    if (result.outcome === "unknown") summary.unknownCount += 1;
    else if (result.retryable === true) summary.retryableFailureCount += 1;
    else summary.terminalFailureCount += 1;
  }
  await repository.settleExecutionRun({
    tenantId,
    storeId,
    executionRunId,
    settledAt: now(),
  });
  return summary;
}

export function createProductPublishWorker({
  redisUrl,
  repository,
  executor,
  concurrency = 1,
  queueName = PRODUCT_PUBLISH_QUEUE_NAME,
  prefix = "shein-console",
} = {}) {
  if (!redisUrl) throw new Error("商品发布 Worker 缺少 REDIS_URL");
  if (!repository || !executor) {
    throw new Error("商品发布 Worker 缺少执行仓储或执行器");
  }
  const connection = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
  const worker = new Worker(
    queueName,
    (job) => processProductPublishRun({ job, repository, executor }),
    { connection, concurrency, prefix },
  );
  return {
    worker,
    async close() {
      await worker.close();
      await connection.quit();
    },
  };
}
