import { Worker } from "bullmq";
import Redis from "ioredis";
import { WEBHOOK_QUEUE_NAME } from "./job-queue.js";

export async function processWebhookJob({ job, eventStore, processor }) {
  const event = await eventStore.claim(job.data.eventId);
  if (!event) return { skipped: true };
  try {
    const result = await processor(event);
    if (
      result?.projection &&
      typeof eventStore.saveProjection === "function"
    ) {
      await eventStore.saveProjection(event.id, {
        projectionVersion: result.projectionVersion,
        projection: result.projection,
      });
    }
    await eventStore.markProcessed(event.id);
    if (!result || typeof result !== "object") return result;
    const { projection: _projection, ...summary } = result;
    return summary;
  } catch (error) {
    await eventStore.markFailed(event.id, error);
    throw error;
  }
}

export function createWebhookWorker({
  redisUrl,
  eventStore,
  processor,
  concurrency = 4,
  queueName = WEBHOOK_QUEUE_NAME,
  prefix = "shein-console",
} = {}) {
  if (!redisUrl) throw new Error("Webhook worker 缺少 REDIS_URL");
  if (!eventStore) throw new Error("Webhook worker 缺少 eventStore");
  if (!processor) throw new Error("Webhook worker 缺少业务 processor");

  const connection = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
  const worker = new Worker(
    queueName,
    (job) => processWebhookJob({ job, eventStore, processor }),
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
