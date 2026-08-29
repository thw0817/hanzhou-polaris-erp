import { Worker } from "bullmq";
import Redis from "ioredis";
import {
  COMPLIANCE_SYNC_JOB_NAME,
  COMPLIANCE_SYNC_QUEUE_NAME,
} from "./job-queue.js";

export const COMPLIANCE_SYNC_WORKER_LOCK_DURATION_MS = 15 * 60_000;
export const COMPLIANCE_SYNC_WORKER_LOCK_RENEW_TIME_MS = 30_000;
export const COMPLIANCE_SYNC_WORKER_STALLED_INTERVAL_MS = 5 * 60_000;

export function buildComplianceSyncWorkerOptions({
  concurrency = 1,
  prefix = "shein-console",
} = {}) {
  return {
    concurrency,
    prefix,
    // Compliance reads can span many SKCs and several SHEIN requests. Keep
    // the BullMQ lock alive so a healthy worker is not marked stalled.
    lockDuration: COMPLIANCE_SYNC_WORKER_LOCK_DURATION_MS,
    lockRenewTime: COMPLIANCE_SYNC_WORKER_LOCK_RENEW_TIME_MS,
    stalledInterval: COMPLIANCE_SYNC_WORKER_STALLED_INTERVAL_MS,
  };
}

function invalidJob() {
  const error = new Error("合规同步队列消息无效");
  error.code = "INVALID_COMPLIANCE_SYNC_JOB";
  return error;
}

export async function processComplianceSyncJob({ job, service } = {}) {
  if (!service || job?.name !== COMPLIANCE_SYNC_JOB_NAME) throw invalidJob();
  const data = job.data || {};
  const tenantId = String(data.tenantId || "").trim();
  const storeId = String(data.storeId || "").trim();
  const jobId = String(data.jobId || "").trim();
  if (!tenantId || !storeId || !jobId) throw invalidJob();
  return service.processSyncJob({
    context: {
      tenantId,
      userId: data.requestedBy ? String(data.requestedBy) : null,
    },
    storeId,
    jobId,
  });
}

export function createComplianceSyncWorker({
  redisUrl,
  service,
  concurrency = 1,
  queueName = COMPLIANCE_SYNC_QUEUE_NAME,
  prefix = "shein-console",
} = {}) {
  if (!redisUrl) throw new Error("合规同步 Worker 缺少 REDIS_URL");
  if (!service) throw new Error("合规同步 Worker 缺少 service");
  const connection = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
  const worker = new Worker(
    queueName,
    (job) => processComplianceSyncJob({ job, service }),
    { connection, ...buildComplianceSyncWorkerOptions({ concurrency, prefix }) },
  );
  return {
    worker,
    async close() {
      await worker.close();
      await connection.quit();
    },
  };
}
