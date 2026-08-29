import { pathToFileURL } from "node:url";
import { loadConfig } from "../config.js";
import { CloudCredentialCipher } from "./credential-cipher.js";
import {
  BullMqJobQueue,
  STORE_BUSINESS_REFRESH_QUEUE_NAME,
} from "./job-queue.js";
import { createPostgresPool } from "./postgres.js";
import { PostgresStoreRepository } from "./store-repository.js";
import { SheinWebReadService } from "./web-business-service.js";
import {
  PostgresStoreBusinessRepository,
  WebStoreBusinessService,
} from "./store-business-service.js";
import { createStoreBusinessRefreshWorker } from "./store-business-refresh-worker.js";
import {
  startStoreBusinessRefreshScheduleLoop,
  StoreBusinessRefreshScheduler,
} from "./store-business-refresh-scheduler.js";

function writeLog(logger, level, event, fields) {
  const write = logger?.[level];
  if (typeof write !== "function") return;
  write.call(logger, `[store-business-refresh-worker] ${event} ${JSON.stringify(fields)}`);
}

export async function startStoreBusinessRefreshWorkerServer(
  config = loadConfig(),
  { logger = console } = {},
) {
  if (config.runtimeMode !== "cloud") {
    throw new Error("经营数据刷新 Worker 要求 SHEIN_RUNTIME_MODE=cloud");
  }
  if (
    !config.databaseUrl ||
    !config.redisUrl ||
    !config.appId ||
    !config.appSecret ||
    !config.cloudEncryptionKey
  ) {
    throw new Error("经营数据刷新 Worker 缺少 PostgreSQL、Redis 或 SHEIN 凭证配置");
  }
  if (
    config.storeBusinessRefresh?.schedulerEnabled &&
    !config.storeBusinessRefresh?.executionEnabled
  ) {
    throw new Error("定时调度必须同时启用经营数据刷新");
  }

  const pool = createPostgresPool({
    connectionString: config.databaseUrl,
    max: Math.max(4, Number(config.storeBusinessRefresh?.workerConcurrency || 1) + 2),
  });
  const storeRepository = new PostgresStoreRepository({
    pool,
    credentialCipher: new CloudCredentialCipher({
      base64Key: config.cloudEncryptionKey,
    }),
  });
  const webBusiness = new SheinWebReadService({
    storeRepository,
    apiBaseUrl: config.apiBaseUrl,
  });
  const schedulerQueue = config.storeBusinessRefresh?.schedulerEnabled
    ? new BullMqJobQueue({
        redisUrl: config.redisUrl,
        queueName: STORE_BUSINESS_REFRESH_QUEUE_NAME,
      })
    : null;
  const service = new WebStoreBusinessService({
    repository: new PostgresStoreBusinessRepository({ pool }),
    syncStore: (input) => webBusiness.syncStoreBusiness(input),
    queue: schedulerQueue,
  });
  const workerService = createStoreBusinessRefreshWorker({
    redisUrl: config.redisUrl,
    service,
    concurrency: Number(config.storeBusinessRefresh?.workerConcurrency || 1),
  });

  workerService.worker.on("completed", (job, result) => {
    writeLog(logger, "info", "completed", {
      queueJobId: String(job.id || ""),
      syncJobId: String(job.data?.jobId || ""),
      state: String(result?.state || (result?.skipped ? "skipped" : "completed")),
    });
  });
  workerService.worker.on("failed", (job, error) => {
    writeLog(logger, "error", "failed", {
      queueJobId: String(job?.id || ""),
      syncJobId: String(job?.data?.jobId || ""),
      errorCode: String(error?.code || "STORE_BUSINESS_REFRESH_FAILED"),
    });
  });
  workerService.worker.on("error", (error) => {
    writeLog(logger, "error", "worker-error", {
      errorCode: String(error?.code || "WORKER_ERROR"),
      errorName: String(error?.name || "Error"),
    });
  });

  await workerService.worker.waitUntilReady();
  const scheduleLoop = config.storeBusinessRefresh?.schedulerEnabled
    ? startStoreBusinessRefreshScheduleLoop({
        scheduler: new StoreBusinessRefreshScheduler({
          pool,
          service,
          staleAfterMs: config.storeBusinessRefresh.scheduleIntervalMs,
        }),
        intervalMs: config.storeBusinessRefresh.scheduleIntervalMs,
        onResult: (summary) => writeLog(logger, "info", "schedule", summary),
        onError: (error) => writeLog(logger, "error", "schedule-error", {
          errorCode: String(error?.code || "STORE_BUSINESS_SCHEDULE_FAILED"),
          errorName: String(error?.name || "Error"),
        }),
      })
    : null;
  await scheduleLoop?.ready;
  writeLog(logger, "info", "ready", {
    queue: workerService.worker.name,
    concurrency: workerService.worker.opts.concurrency,
    executionPolicy: "read-only-idempotent-retry",
    schedulerEnabled: Boolean(scheduleLoop),
  });
  return {
    worker: workerService.worker,
    async close() {
      await scheduleLoop?.close();
      await workerService.close();
      await schedulerQueue?.close();
      await pool.end();
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startStoreBusinessRefreshWorkerServer()
    .then((service) => {
      let closing = false;
      const close = async (signal) => {
        if (closing) return;
        closing = true;
        writeLog(console, "info", "shutdown", { signal });
        await service.close();
      };
      for (const signal of ["SIGINT", "SIGTERM"]) {
        process.once(signal, () => {
          close(signal)
            .then(() => { process.exitCode = 0; })
            .catch((error) => {
              console.error("[store-business-refresh-worker] shutdown-error", error);
              process.exitCode = 1;
            });
        });
      }
    })
    .catch((error) => {
      console.error("[store-business-refresh-worker] startup-error", error);
      process.exitCode = 1;
    });
}
