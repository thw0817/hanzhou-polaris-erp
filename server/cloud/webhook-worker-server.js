import { pathToFileURL } from "node:url";
import { loadConfig } from "../config.js";
import { createPostgresPool } from "./postgres.js";
import { PostgresWebhookEventStore } from "./webhook-event-store.js";
import { createWebhookEventProcessor } from "./webhook-event-processor.js";
import { createDefaultWebhookProductionHandlers } from "./webhook-production-projections.js";
import { PostgresPublishExecutionRepository } from "./publish-execution-repository.js";
import { PostgresProductReviewRepository } from "./product-review-service.js";
import { PostgresWebhookBusinessStateRepository } from "./webhook-business-state-repository.js";
import { createWebhookWorker } from "./webhook-worker.js";

function writeLog(logger, level, event, fields) {
  const write = logger?.[level];
  if (typeof write !== "function") return;
  write.call(
    logger,
    `[shein-webhook-worker] ${event} ${JSON.stringify(fields)}`,
  );
}

export async function startWebhookWorkerServer(
  config = loadConfig(),
  { logger = console } = {},
) {
  if (config.runtimeMode !== "cloud") {
    throw new Error("Webhook Worker 要求 SHEIN_RUNTIME_MODE=cloud");
  }
  if (!config.databaseUrl || !config.redisUrl) {
    throw new Error("Webhook Worker 缺少 DATABASE_URL 或 REDIS_URL");
  }

  const pool = createPostgresPool({
    connectionString: config.databaseUrl,
    max: 5,
  });
  const service = createWebhookWorker({
    redisUrl: config.redisUrl,
    eventStore: new PostgresWebhookEventStore({ pool }),
    processor: createWebhookEventProcessor({
      logger,
      productionHandlers: createDefaultWebhookProductionHandlers({
        publishExecutionRepository: new PostgresPublishExecutionRepository({ pool }),
        productReviewRepository: new PostgresProductReviewRepository({ pool }),
        stateRepository: new PostgresWebhookBusinessStateRepository({ pool }),
      }),
    }),
  });

  service.worker.on("completed", (job, result) => {
    writeLog(logger, "info", "completed", {
      jobId: String(job.id || ""),
      eventId: String(job.data?.eventId || ""),
      eventType: String(job.data?.eventType || ""),
      source: String(job.data?.source || ""),
      disposition: String(result?.disposition || "completed"),
    });
  });
  service.worker.on("failed", (job, error) => {
    writeLog(logger, "error", "failed", {
      jobId: String(job?.id || ""),
      eventId: String(job?.data?.eventId || ""),
      eventType: String(job?.data?.eventType || ""),
      source: String(job?.data?.source || ""),
      errorCode: String(error?.code || "WEBHOOK_PROCESSING_FAILED"),
      errorName: String(error?.name || "Error"),
    });
  });
  service.worker.on("error", (error) => {
    writeLog(logger, "error", "worker-error", {
      errorName: String(error?.name || "Error"),
      errorCode: String(error?.code || "WORKER_ERROR"),
    });
  });

  await service.worker.waitUntilReady();
  writeLog(logger, "info", "ready", {
    queue: service.worker.name,
    concurrency: service.worker.opts.concurrency,
    productionPolicy: "fail-closed",
  });

  return {
    worker: service.worker,
    async close() {
      await service.close();
      await pool.end();
    },
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  startWebhookWorkerServer()
    .then((service) => {
      let closing = false;
      const close = async (signal) => {
        if (closing) return;
        closing = true;
        console.info(
          `[shein-webhook-worker] shutdown ${JSON.stringify({ signal })}`,
        );
        await service.close();
      };
      for (const signal of ["SIGINT", "SIGTERM"]) {
        process.once(signal, () => {
          close(signal)
            .then(() => {
              process.exitCode = 0;
            })
            .catch((error) => {
              console.error("[shein-webhook-worker] shutdown-error", error);
              process.exitCode = 1;
            });
        });
      }
    })
    .catch((error) => {
      console.error("[shein-webhook-worker] startup-error", error);
      process.exitCode = 1;
    });
}
