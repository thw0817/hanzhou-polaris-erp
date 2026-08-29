import { pathToFileURL } from "node:url";
import { loadConfig } from "../config.js";
import {
  PostgresComplianceSyncRepository,
  WebComplianceSyncService,
} from "./compliance-sync-service.js";
import { createComplianceSyncWorker } from "./compliance-sync-worker.js";
import { CloudCredentialCipher } from "./credential-cipher.js";
import { createPostgresPool } from "./postgres.js";
import { PostgresRuleSnapshotRepository } from "./rule-snapshot-service.js";
import { PostgresStoreRepository } from "./store-repository.js";
import { SheinWebReadService } from "./web-business-service.js";

function writeLog(logger, level, event, fields) {
  const write = logger?.[level];
  if (typeof write !== "function") return;
  write.call(logger, `[compliance-sync-worker] ${event} ${JSON.stringify(fields)}`);
}

export async function startComplianceSyncWorkerServer(
  config = loadConfig(),
  { logger = console } = {},
) {
  if (config.runtimeMode !== "cloud") {
    throw new Error("合规同步 Worker 要求 SHEIN_RUNTIME_MODE=cloud");
  }
  if (
    !config.databaseUrl ||
    !config.redisUrl ||
    !config.appId ||
    !config.appSecret ||
    !config.cloudEncryptionKey
  ) {
    throw new Error("合规同步 Worker 缺少 PostgreSQL、Redis 或 SHEIN 凭证配置");
  }
  const concurrency = Number(config.complianceSync?.workerConcurrency || 1);
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
  const complianceReader = new SheinWebReadService({
    storeRepository,
    ruleSnapshotRepository: new PostgresRuleSnapshotRepository({ pool }),
    apiBaseUrl: config.apiBaseUrl,
  });
  const service = new WebComplianceSyncService({
    repository: new PostgresComplianceSyncRepository({ pool }),
    complianceReader,
  });
  const workerService = createComplianceSyncWorker({
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
    writeLog(logger, "error", "failed", {
      queueJobId: String(job?.id || ""),
      syncJobId: String(job?.data?.jobId || ""),
      errorCode: String(error?.code || "COMPLIANCE_SYNC_FAILED"),
    });
  });
  workerService.worker.on("error", (error) => {
    writeLog(logger, "error", "worker-error", {
      errorCode: String(error?.code || "WORKER_ERROR"),
      errorName: String(error?.name || "Error"),
    });
  });
  await workerService.worker.waitUntilReady();
  writeLog(logger, "info", "ready", {
    queue: workerService.worker.name,
    concurrency: workerService.worker.opts.concurrency,
    executionPolicy: "read-only-idempotent-retry",
  });
  return {
    worker: workerService.worker,
    async close() {
      await workerService.close();
      await pool.end();
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startComplianceSyncWorkerServer()
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
              console.error("[compliance-sync-worker] shutdown-error", error);
              process.exitCode = 1;
            });
        });
      }
    })
    .catch((error) => {
      console.error("[compliance-sync-worker] startup-error", error);
      process.exitCode = 1;
    });
}
