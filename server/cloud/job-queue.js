import { Queue } from "bullmq";
import Redis from "ioredis";

export const WEBHOOK_QUEUE_NAME = "shein-webhook-events";
export const STORE_BUSINESS_REFRESH_QUEUE_NAME = "shein-store-business-refresh";
export const STORE_BUSINESS_REFRESH_JOB_NAME = "store-business-refresh";
export const RULE_REFRESH_QUEUE_NAME = "shein-rule-refresh";
export const RULE_REFRESH_JOB_NAME = "rule-refresh";
export const COMPLIANCE_SYNC_QUEUE_NAME = "shein-compliance-sync";
export const COMPLIANCE_SYNC_JOB_NAME = "compliance-sync";
export const PRODUCT_PUBLISH_QUEUE_NAME = "shein-product-publish";
export const PRODUCT_PUBLISH_JOB_NAME = "product-publish-run";

export class MemoryJobQueue {
  constructor() {
    this.jobs = [];
  }

  async add(name, data, options = {}) {
    const existing = options.jobId
      ? this.jobs.find((job) => job.id === options.jobId)
      : null;
    if (existing) return existing;
    const job = {
      id: options.jobId || String(this.jobs.length + 1),
      name,
      data,
      options,
    };
    this.jobs.push(job);
    return job;
  }

  async close() {}
}

export class BullMqJobQueue {
  constructor({
    redisUrl,
    queueName = WEBHOOK_QUEUE_NAME,
    prefix = "shein-console",
  } = {}) {
    if (!redisUrl) throw new Error("cloud 模式缺少 REDIS_URL");
    this.connection = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    });
    this.queue = new Queue(queueName, {
      connection: this.connection,
      prefix,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 2_000 },
        removeOnComplete: 1_000,
        removeOnFail: 5_000,
      },
    });
  }

  add(name, data, options = {}) {
    return this.queue.add(name, data, options);
  }

  async close() {
    await this.queue.close();
    await this.connection.quit();
  }
}
