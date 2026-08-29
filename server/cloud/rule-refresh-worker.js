import { Worker } from "bullmq";
import Redis from "ioredis";
import { RULE_REFRESH_JOB_NAME, RULE_REFRESH_QUEUE_NAME } from "./job-queue.js";

export const RULE_REFRESH_WORKER_LOCK_DURATION_MS = 15 * 60_000;
export const RULE_REFRESH_WORKER_LOCK_RENEW_TIME_MS = 30_000;
export const RULE_REFRESH_WORKER_STALLED_INTERVAL_MS = 5 * 60_000;

export function buildRuleRefreshWorkerOptions({
  concurrency = 1,
  prefix = "shein-console",
} = {}) {
  return {
    concurrency,
    prefix,
    // A full refresh is a long-running job. Keep the lock comfortably longer
    // than an upstream read and renew it independently of the lock lifetime;
    // otherwise a busy event loop can make BullMQ mark the job stalled midway.
    lockDuration: RULE_REFRESH_WORKER_LOCK_DURATION_MS,
    lockRenewTime: RULE_REFRESH_WORKER_LOCK_RENEW_TIME_MS,
    stalledInterval: RULE_REFRESH_WORKER_STALLED_INTERVAL_MS,
  };
}

function invalidJob() {
  const error = new Error("规则刷新队列消息无效");
  error.code = "INVALID_RULE_REFRESH_JOB";
  return error;
}

export async function processRuleRefreshJob({ job, service } = {}) {
  if (!service || job?.name !== RULE_REFRESH_JOB_NAME) throw invalidJob();
  const data = job.data || {};
  const tenantId = String(data.tenantId || "").trim();
  const storeId = String(data.storeId || "").trim();
  const jobId = String(data.jobId || "").trim();
  const scope = String(data.scope || "referenced").trim();
  if (!tenantId || !storeId || !jobId) throw invalidJob();
  if (!["referenced", "all"].includes(scope)) throw invalidJob();
  if (data.retryTargets != null && !Array.isArray(data.retryTargets)) {
    throw invalidJob();
  }
  const input = {
    context: {
      tenantId,
      userId: data.requestedBy ? String(data.requestedBy) : null,
      // The queue can only be populated after the control route has passed
      // requireAdministrator(). Preserve that authorization for the trusted
      // worker; without it, force-refresh reads are treated as member reads
      // and fail with RULE_SYNC_REQUIRED for every category.
      role: "admin",
    },
    storeId,
    jobId,
    scope,
  };
  if (Array.isArray(data.retryTargets)) input.retryTargets = data.retryTargets;
  return service.processRefreshJob(input);
}

export function createRuleRefreshWorker({
  redisUrl,
  service,
  concurrency = 1,
  queueName = RULE_REFRESH_QUEUE_NAME,
  prefix = "shein-console",
} = {}) {
  if (!redisUrl) throw new Error("规则刷新 Worker 缺少 REDIS_URL");
  if (!service) throw new Error("规则刷新 Worker 缺少 service");
  const connection = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
  const worker = new Worker(
    queueName,
    (job) => processRuleRefreshJob({ job, service }),
    { connection, ...buildRuleRefreshWorkerOptions({ concurrency, prefix }) },
  );
  return {
    worker,
    async close() {
      await worker.close();
      await connection.quit();
    },
  };
}
