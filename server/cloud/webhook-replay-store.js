import crypto from "node:crypto";
import Redis from "ioredis";

export class RedisWebhookReplayStore {
  constructor({
    redisUrl,
    prefix = "shein-console:webhook-replay",
  } = {}) {
    if (!redisUrl) {
      throw new Error("RedisWebhookReplayStore 缺少 REDIS_URL");
    }
    this.prefix = prefix;
    this.redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
    });
  }

  redisKey(key) {
    const digest = crypto.createHash("sha256").update(key).digest("hex");
    return `${this.prefix}:${digest}`;
  }

  async claim(key, ttlMs) {
    const result = await this.redis.set(
      this.redisKey(key),
      "1",
      "PX",
      ttlMs,
      "NX",
    );
    return result === "OK";
  }

  async release(key) {
    await this.redis.del(this.redisKey(key));
  }

  async close() {
    await this.redis.quit();
  }
}
