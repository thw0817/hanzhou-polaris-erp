import { pathToFileURL } from "node:url";
import { loadConfig } from "../config.js";
import { CloudCredentialCipher } from "./credential-cipher.js";
import {
  BullMqJobQueue,
  RULE_REFRESH_QUEUE_NAME,
} from "./job-queue.js";
import { createPostgresPool } from "./postgres.js";
import {
  PostgresRuleRefreshRepository,
  WebRuleRefreshService,
} from "./rule-refresh-service.js";
import { createRuleRefreshWorker } from "./rule-refresh-worker.js";
import { PostgresRuleSnapshotRepository } from "./rule-snapshot-service.js";
import { PostgresStoreRepository } from "./store-repository.js";
import { SheinWebReadService } from "./web-business-service.js";
import {
  RuleRefreshScheduler,
  startRuleRefreshScheduleLoop,
} from "./rule-refresh-scheduler.js";

function writeLog(logger, level, event, fields) {
  const write = logger?.[level];
  if (typeof write !== "function") return;
  write.call(logger, `[rule-refresh-worker] ${event} ${JSON.stringify(fields)}`);
}

export async function startRuleRefreshWorkerServer(
  config = loadConfig(),
  { logger = console } = {},
) {
  if (config.runtimeMode !== "cloud") {
    throw new Error("规则刷新 Worker 要求 SHEIN_RUNTIME_MODE=cloud");
  }
  if (
    !config.databaseUrl ||
    !config.redisUrl ||
    !config.appId ||
    !config.appSecret ||
    !config.cloudEncryptionKey
  ) {
    throw new Error("规则刷新 Worker 缺少 PostgreSQL、Redis 或 SHEIN 凭证配置");
  }
  if (
    config.ruleRefresh?.scheduleEnabled &&
    !config.ruleRefresh?.executionEnabled
  ) {
    throw new Error("规则刷新定时调度必须同时启用规则刷新");
  }
  const concurrency = Number(config.ruleRefresh?.workerConcurrency || 1);
  const pool = createPostgresPool({
    connectionString: config.databaseUrl,
    max: Math.max(4, concurrency + 2),
  });
  const storeRepository = new PostgresStoreRepository({
    pool,
    credentialCipher: new CloudCredentialCipher({
      base64Key: config.cloudEncryptionKey,
    }),
  });
  const ruleReader = new SheinWebReadService({
    storeRepository,
    ruleSnapshotRepository: new PostgresRuleSnapshotRepository({ pool }),
    apiBaseUrl: config.apiBaseUrl,
  });
  const service = new WebRuleRefreshService({
    repository: new PostgresRuleRefreshRepository({ pool }),
    ruleReader,
    queue: config.ruleRefresh?.scheduleEnabled
      ? new BullMqJobQueue({
          redisUrl: config.redisUrl,
          queueName: RULE_REFRESH_QUEUE_NAME,
        })
      : null,
    executionEnabled: config.ruleRefresh?.executionEnabled === true,
    targetConcurrency: config.ruleRefresh?.targetConcurrency,
  });
  const workerService = createRuleRefreshWorker({
    redisUrl: config.redisUrl,
    service,
    concurrency,
  });
  workerService.worker.on("completed", (job, result) => {
    writeLog(logger, "info", "completed", {
      queueJobId: String(job.id || ""),
      syncJobId: String(job.data?.jobId || ""),
      state: String(result?.state || (result?.skipped ? "skipped" : "completed")),
    });
  });
  workerService.worker.on("failed", (job, error) => {
    const data = job?.data || {};
    void service.recordQueueFailure({
      tenantId: data.tenantId ? String(data.tenantId) : "",
      storeId: data.storeId ? String(data.storeId) : "",
      jobId: data.jobId ? String(data.jobId) : "",
      error,
    }).catch((persistError) => {
      writeLog(logger, "error", "failure-persist-error", {
        queueJobId: String(job?.id || ""),
        syncJobId: String(data.jobId || ""),
        errorCode: String(persistError?.code || "RULE_REFRESH_FAILURE_PERSIST_FAILED"),
      });
    });
    writeLog(logger, "error", "failed", {
      queueJobId: String(job?.id || ""),
      syncJobId: String(job?.data?.jobId || ""),
      errorCode: String(error?.code || "RULE_REFRESH_FAILED"),
    });
  });
  workerService.worker.on("error", (error) => {
    writeLog(logger, "error", "worker-error", {
      errorCode: String(error?.code || "WORKER_ERROR"),
      errorName: String(error?.name || "Error"),
    });
  });
  await workerService.worker.waitUntilReady();
  const scheduleLoop = config.ruleRefresh?.scheduleEnabled
    ? startRuleRefreshScheduleLoop({
        scheduler: new RuleRefreshScheduler({
          pool,
          service,
          day: config.ruleRefresh.scheduleDay,
          startHour: config.ruleRefresh.scheduleStartHour,
          endHour: config.ruleRefresh.scheduleEndHour,
          timeZone: config.ruleRefresh.scheduleTimeZone,
        }),
        intervalMs: config.ruleRefresh.scheduleIntervalMs,
        onResult: (summary) => writeLog(logger, "info", "schedule", summary),
        onError: (error) => writeLog(logger, "error", "schedule-error", {
          errorCode: String(error?.code || "RULE_REFRESH_SCHEDULE_FAILED"),
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
      await service.queue?.close();
      await pool.end();
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startRuleRefreshWorkerServer()
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
              console.error("[rule-refresh-worker] shutdown-error", error);
              process.exitCode = 1;
            });
        });
      }
    })
    .catch((error) => {
      console.error("[rule-refresh-worker] startup-error", error);
      process.exitCode = 1;
    });
}
