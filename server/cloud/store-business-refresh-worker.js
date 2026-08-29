import { Worker } from "bullmq";
import Redis from "ioredis";
import {
  STORE_BUSINESS_REFRESH_JOB_NAME,
  STORE_BUSINESS_REFRESH_QUEUE_NAME,
} from "./job-queue.js";

export const STORE_BUSINESS_REFRESH_WORKER_LOCK_DURATION_MS = 15 * 60_000;
export const STORE_BUSINESS_REFRESH_WORKER_LOCK_RENEW_TIME_MS = 30_000;
export const STORE_BUSINESS_REFRESH_WORKER_STALLED_INTERVAL_MS = 5 * 60_000;

export function buildStoreBusinessRefreshWorkerOptions({
  concurrency = 1,
  prefix = "shein-console",
} = {}) {
  return {
    concurrency,
    prefix,
    // Business refreshes fan out to several SHEIN reads. Keep the BullMQ
    // lock alive so a healthy worker is not marked stalled mid-refresh.
    lockDuration: STORE_BUSINESS_REFRESH_WORKER_LOCK_DURATION_MS,
    lockRenewTime: STORE_BUSINESS_REFRESH_WORKER_LOCK_RENEW_TIME_MS,
    stalledInterval: STORE_BUSINESS_REFRESH_WORKER_STALLED_INTERVAL_MS,
  };
}

function invalidJob() {
  const error = new Error("经营数据刷新队列消息无效");
  error.code = "INVALID_STORE_BUSINESS_REFRESH_JOB";
  return error;
}

export async function processStoreBusinessRefreshJob({ job, service } = {}) {
  if (!service || job?.name !== STORE_BUSINESS_REFRESH_JOB_NAME) {
    throw invalidJob();
  }
  const data = job.data || {};
  const tenantId = String(data.tenantId || "").trim();
  const storeId = String(data.storeId || "").trim();
  const jobId = String(data.jobId || "").trim();
  if (!tenantId || !storeId || !jobId) throw invalidJob();
  return service.processRefreshJob({
    context: {
      tenantId,
      userId: data.requestedBy ? String(data.requestedBy) : null,
    },
    storeId,
    jobId,
  });
}

export function createStoreBusinessRefreshWorker({
  redisUrl,
  service,
  concurrency = 1,
  queueName = STORE_BUSINESS_REFRESH_QUEUE_NAME,
  prefix = "shein-console",
} = {}) {
  if (!redisUrl) throw new Error("经营数据刷新 Worker 缺少 REDIS_URL");
  if (!service) throw new Error("经营数据刷新 Worker 缺少 service");
  const connection = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
  const worker = new Worker(
    queueName,
    (job) => processStoreBusinessRefreshJob({ job, service }),
    { connection, ...buildStoreBusinessRefreshWorkerOptions({ concurrency, prefix }) },
  );
  return {
    worker,
    async close() {
      await worker.close();
      await connection.quit();
    },
  };
}
