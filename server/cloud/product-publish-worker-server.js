import { pathToFileURL } from "node:url";
import { loadConfig } from "../config.js";
import { CloudCredentialCipher } from "./credential-cipher.js";
import { createPostgresPool } from "./postgres.js";
import { ProductPublishExecutorError, WebProductPublishExecutor } from "./product-publish-executor.js";
import { PostgresMediaRepository, WebMediaService } from "./media-service.js";
import { PostgresPublishExecutionRepository } from "./publish-execution-repository.js";
import { createProductPublishWorker } from "./product-publish-worker.js";
import { S3ObjectStorage } from "./s3-object-storage.js";
import { PostgresStoreRepository } from "./store-repository.js";

function writeLog(logger, level, event, fields) {
  const write = logger?.[level];
  if (typeof write !== "function") return;
  write.call(logger, `[product-publish-worker] ${event} ${JSON.stringify(fields)}`);
}

export async function startProductPublishWorkerServer(
  config = loadConfig(),
  { logger = console } = {},
) {
  if (config.runtimeMode !== "cloud") {
    throw new Error("商品发布 Worker 要求 SHEIN_RUNTIME_MODE=cloud");
  }
  if (config.productPublish?.executionEnabled !== true) {
    throw new Error("商品发布执行总开关未启用；Worker拒绝启动");
  }
  if (config.outboxDispatcher?.enabled !== true) {
    throw new Error("Outbox Dispatcher 总开关未启用；Worker拒绝启动");
  }
  if (!config.databaseUrl || !config.redisUrl || !config.cloudEncryptionKey) {
    throw new Error("商品发布 Worker 缺少 PostgreSQL、Redis 或店铺凭证解密配置");
  }
  const concurrency = Number(config.productPublish.workerConcurrency || 1);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 2) {
    throw new Error("商品发布 Worker 并发数必须为1或2");
  }
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
  const repository = new PostgresPublishExecutionRepository({ pool });
  const mediaService = config.mediaStorage
    ? new WebMediaService({
        repository: new PostgresMediaRepository({ pool }),
        storage: new S3ObjectStorage({
          endpoint: config.mediaStorage.endpoint,
          region: config.mediaStorage.region,
          bucket: config.mediaStorage.bucket,
          accessKeyId: config.mediaStorage.accessKeyId,
          secretAccessKey: config.mediaStorage.secretAccessKey,
          allowInsecureEndpoint: config.mediaStorage.allowInsecureEndpoint,
        }),
        provider: config.mediaStorage.provider,
        bucket: config.mediaStorage.bucket,
        maxUploadBytes: config.mediaStorage.maxUploadBytes,
        quota: config.workspaceQuota,
      })
    : null;
  const executor = new WebProductPublishExecutor({
    storeRepository,
    apiBaseUrl: config.apiBaseUrl,
    executionEnabled: true,
    mediaService,
    complianceWritesEnabled: config.complianceWritesEnabled === true,
  });
  const workerService = createProductPublishWorker({
    redisUrl: config.redisUrl,
    repository,
    executor,
    concurrency,
  });
  workerService.worker.on("completed", (job, result) => {
    writeLog(logger, "info", "completed", {
      queueJobId: String(job.id || ""),
      commandId: String(job.data?.commandId || ""),
      executionRunId: String(job.data?.executionRunId || ""),
      submittedCount: Number(result?.submittedCount || 0),
      retryableFailureCount: Number(result?.retryableFailureCount || 0),
      terminalFailureCount: Number(result?.terminalFailureCount || 0),
      unknownCount: Number(result?.unknownCount || 0),
    });
  });
  workerService.worker.on("failed", (job, error) => {
    writeLog(logger, "error", "failed", {
      queueJobId: String(job?.id || ""),
      commandId: String(job?.data?.commandId || ""),
      executionRunId: String(job?.data?.executionRunId || ""),
      errorCode: String(error?.code || "PRODUCT_PUBLISH_PROCESSING_FAILED"),
      executorError: error instanceof ProductPublishExecutorError,
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
    concurrency,
    executionPolicy: "single-use-authorization-no-automatic-publish-retry",
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
  startProductPublishWorkerServer()
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
              console.error("[product-publish-worker] shutdown-error", error);
              process.exitCode = 1;
            });
        });
      }
    })
    .catch((error) => {
      console.error("[product-publish-worker] startup-error", error);
      process.exitCode = 1;
    });
}
