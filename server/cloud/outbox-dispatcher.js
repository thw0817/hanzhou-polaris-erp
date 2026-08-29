import { pathToFileURL } from "node:url";
import { BullMqJobQueue, PRODUCT_PUBLISH_JOB_NAME, PRODUCT_PUBLISH_QUEUE_NAME } from "./job-queue.js";
import { createPostgresPool, withTransaction } from "./postgres.js";
import { loadConfig } from "../config.js";

export const OUTBOX_EVENT_TYPE = "publish_command_requested";
export const OUTBOX_JOB_CONTRACT_VERSION = "publish-command-v1";
export const OUTBOX_DEFAULT_BATCH_SIZE = 50;
export const OUTBOX_DEFAULT_LEASE_SECONDS = 60;
export const OUTBOX_DEFAULT_POLL_INTERVAL_MS = 1_000;

function text(value) {
  return String(value || "").trim();
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function positiveInteger(value, fallback, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

function normalizedError(error) {
  return {
    code: text(error?.code) || "OUTBOX_DISPATCH_FAILED",
    message: text(error?.message) || "发布命令 Outbox 投递失败",
    traceId: text(error?.traceId) || null,
  };
}

function queuePayload(event) {
  const payload = asObject(event?.payload);
  const commandId = text(event?.publish_job_id || payload.commandId);
  const tenantId = text(event?.tenant_id || payload.tenantId);
  const storeId = text(event?.store_id || payload.storeId);
  const contractVersion = text(payload.contractVersion);
  if (text(event?.event_type) !== OUTBOX_EVENT_TYPE) {
    throw Object.assign(new Error("Outbox 事件类型不受支持"), {
      code: "OUTBOX_EVENT_TYPE_UNSUPPORTED",
    });
  }
  if (!commandId || !tenantId || !storeId) {
    throw Object.assign(new Error("Outbox 事件缺少 command、tenant 或 store 作用域"), {
      code: "OUTBOX_EVENT_INVALID",
    });
  }
  if (contractVersion !== OUTBOX_JOB_CONTRACT_VERSION) {
    throw Object.assign(new Error("Outbox command contract version 不受支持"), {
      code: "OUTBOX_CONTRACT_UNSUPPORTED",
    });
  }
  if (text(payload.commandId) && text(payload.commandId) !== commandId) {
    throw Object.assign(new Error("Outbox commandId 与持久化命令不一致"), {
      code: "OUTBOX_EVENT_COMMAND_MISMATCH",
    });
  }
  if (text(payload.tenantId) && text(payload.tenantId) !== tenantId) {
    throw Object.assign(new Error("Outbox tenantId 与事件作用域不一致"), {
      code: "OUTBOX_EVENT_TENANT_MISMATCH",
    });
  }
  if (text(payload.storeId) && text(payload.storeId) !== storeId) {
    throw Object.assign(new Error("Outbox storeId 与事件作用域不一致"), {
      code: "OUTBOX_EVENT_STORE_MISMATCH",
    });
  }
  return {
    commandId,
    tenantId,
    storeId,
    contractVersion,
  };
}

export async function createPublishOutboxEvents({
  client,
  tenantId,
  storeId,
  executionRunId,
  availableAt = new Date(),
} = {}) {
  if (!client) throw new Error("createPublishOutboxEvents缺少client");
  if (!tenantId || !storeId || !executionRunId) {
    throw new Error("发布 Outbox 缺少 tenant、store 或 execution run");
  }
  const result = await client.query({
    text: `
      INSERT INTO publish_outbox_events (
        tenant_id,
        store_id,
        publish_job_id,
        event_type,
        dedupe_key,
        payload,
        available_at
      )
      SELECT
        job.tenant_id,
        job.store_id,
        job.id,
        $4,
        'publish-command-requested:' || job.id::text,
        jsonb_build_object(
          'commandId', job.id::text,
          'tenantId', job.tenant_id::text,
          'storeId', job.store_id::text,
          'contractVersion', $5
        ),
        $6::timestamptz
      FROM publish_jobs AS job
      WHERE job.tenant_id = $1
        AND job.store_id = $2
        AND job.execution_run_id = $3
        AND job.state IN ('authorized', 'failed_retryable')
      ON CONFLICT (tenant_id, store_id, publish_job_id, event_type)
      DO NOTHING
      RETURNING *
    `,
    values: [
      tenantId,
      storeId,
      executionRunId,
      OUTBOX_EVENT_TYPE,
      OUTBOX_JOB_CONTRACT_VERSION,
      availableAt,
    ],
  });
  return result.rows || [];
}

export class PostgresPublishOutboxRepository {
  constructor({ pool } = {}) {
    if (!pool) throw new Error("PostgresPublishOutboxRepository 缺少 pool");
    this.pool = pool;
  }

  async claimPending({
    dispatcherId = `outbox-dispatcher-${process.pid}`,
    limit = OUTBOX_DEFAULT_BATCH_SIZE,
    leaseSeconds = OUTBOX_DEFAULT_LEASE_SECONDS,
    now = new Date(),
  } = {}) {
    const result = await withTransaction(this.pool, async (client) => client.query({
      text: `
        WITH claimable AS (
          SELECT outbox.id
          FROM publish_outbox_events AS outbox
          WHERE (
            (
              outbox.state = 'pending'
              AND outbox.available_at <= $2::timestamptz
            )
            OR (
              outbox.state = 'dispatching'
              AND outbox.lease_expires_at <= $2::timestamptz
            )
          )
          ORDER BY outbox.created_at, outbox.id
          FOR UPDATE OF outbox SKIP LOCKED
          LIMIT $3
        )
        UPDATE publish_outbox_events AS outbox
        SET state = 'dispatching',
            dispatch_attempts = outbox.dispatch_attempts + 1,
            lease_id = $1 || ':' || outbox.id::text,
            lease_expires_at =
              $2::timestamptz + ($4::text || ' seconds')::interval,
            updated_at = $2::timestamptz
        FROM claimable
        WHERE outbox.id = claimable.id
        RETURNING outbox.*
      `,
      values: [
        text(dispatcherId) || `outbox-dispatcher-${process.pid}`,
        now,
        positiveInteger(limit, OUTBOX_DEFAULT_BATCH_SIZE, 500),
        positiveInteger(leaseSeconds, OUTBOX_DEFAULT_LEASE_SECONDS, 3_600),
      ],
    }));
    return result.rows || [];
  }

  async markDispatched({
    eventId,
    leaseId,
    queueJobId,
    dispatchedAt = new Date(),
  } = {}) {
    const result = await this.pool.query({
      text: `
        UPDATE publish_outbox_events
        SET state = 'dispatched',
            queue_job_id = $3,
            dispatched_at = $4::timestamptz,
            lease_id = NULL,
            lease_expires_at = NULL,
            updated_at = $4::timestamptz
        WHERE id = $1
          AND lease_id = $2
          AND state = 'dispatching'
        RETURNING *
      `,
      values: [eventId, leaseId, queueJobId, dispatchedAt],
    });
    return result.rows[0] || null;
  }

  async markDispatchFailure({
    eventId,
    leaseId,
    error,
    nextAvailableAt = new Date(),
  } = {}) {
    const result = await this.pool.query({
      text: `
        UPDATE publish_outbox_events
        SET state = 'pending',
            available_at = $4::timestamptz,
            last_error = $3::jsonb,
            lease_id = NULL,
            lease_expires_at = NULL,
            updated_at = $4::timestamptz
        WHERE id = $1
          AND lease_id = $2
          AND state = 'dispatching'
        RETURNING *
      `,
      values: [eventId, leaseId, JSON.stringify(normalizedError(error)), nextAvailableAt],
    });
    return result.rows[0] || null;
  }
}

function retryAt(now, dispatchAttempts) {
  const exponent = Math.max(0, Math.min(Number(dispatchAttempts || 1) - 1, 6));
  return new Date(now.getTime() + Math.min(60_000, 1_000 * (2 ** exponent)));
}

export async function dispatchOutboxOnce({
  repository,
  queue,
  dispatcherId = `outbox-dispatcher-${process.pid}`,
  limit = OUTBOX_DEFAULT_BATCH_SIZE,
  leaseSeconds = OUTBOX_DEFAULT_LEASE_SECONDS,
  now = () => new Date(),
  logger = null,
} = {}) {
  if (!repository || typeof repository.claimPending !== "function") {
    throw new Error("Outbox Dispatcher 缺少 repository");
  }
  if (!queue || typeof queue.add !== "function") {
    throw new Error("Outbox Dispatcher 缺少 queue");
  }
  const claimed = await repository.claimPending({
    dispatcherId,
    limit,
    leaseSeconds,
    now: now(),
  });
  const summary = { claimed: claimed.length, dispatched: 0, failed: 0 };
  for (const event of claimed) {
    const eventId = text(event.id);
    const leaseId = text(event.lease_id);
    try {
      const payload = queuePayload(event);
      await queue.add(PRODUCT_PUBLISH_JOB_NAME, payload, {
        jobId: payload.commandId,
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: true,
      });
      const marked = await repository.markDispatched({
        eventId,
        leaseId,
        queueJobId: payload.commandId,
      });
      if (!marked) {
        throw Object.assign(new Error("Outbox lease 已失效，队列任务将由确定性 jobId 安全复核"), {
          code: "OUTBOX_LEASE_LOST",
        });
      }
      summary.dispatched += 1;
    } catch (error) {
      summary.failed += 1;
      await repository.markDispatchFailure({
        eventId,
        leaseId,
        error,
        nextAvailableAt: retryAt(now(), event.dispatch_attempts),
      });
      if (typeof logger?.error === "function") {
        logger.error("[outbox-dispatcher] dispatch-failed", {
          eventId,
          commandId: text(event.publish_job_id),
          code: text(error?.code) || "OUTBOX_DISPATCH_FAILED",
        });
      }
    }
  }
  return summary;
}

export async function startOutboxDispatcherServer(
  config = loadConfig(),
  { logger = console } = {},
) {
  if (config.runtimeMode !== "cloud") {
    throw new Error("Outbox Dispatcher 要求 SHEIN_RUNTIME_MODE=cloud");
  }
  if (config.outboxDispatcher?.enabled !== true) {
    throw new Error("Outbox Dispatcher 总开关未启用；Dispatcher拒绝启动");
  }
  if (!config.databaseUrl || !config.redisUrl) {
    throw new Error("Outbox Dispatcher 缺少 PostgreSQL 或 Redis 配置");
  }
  const pool = createPostgresPool({ connectionString: config.databaseUrl, max: 4 });
  const queue = new BullMqJobQueue({
    redisUrl: config.redisUrl,
    queueName: PRODUCT_PUBLISH_QUEUE_NAME,
  });
  const repository = new PostgresPublishOutboxRepository({ pool });
  const dispatcherId = `outbox-dispatcher-${process.pid}`;
  const options = {
    dispatcherId,
    limit: config.outboxDispatcher.batchSize,
    leaseSeconds: config.outboxDispatcher.leaseSeconds,
    logger,
  };
  await queue.queue.waitUntilReady();
  let closed = false;
  let ticking = false;
  const tick = async () => {
    if (closed || ticking) return { claimed: 0, dispatched: 0, failed: 0 };
    ticking = true;
    try {
      return await dispatchOutboxOnce({ repository, queue, ...options });
    } finally {
      ticking = false;
    }
  };
  const interval = setInterval(() => {
    tick().catch((error) => {
      if (typeof logger?.error === "function") {
        logger.error("[outbox-dispatcher] tick-failed", {
          code: text(error?.code) || "OUTBOX_TICK_FAILED",
          message: text(error?.message),
        });
      }
    });
  }, config.outboxDispatcher.pollIntervalMs);
  interval.unref?.();
  await tick();
  if (typeof logger?.info === "function") {
    logger.info("[outbox-dispatcher] ready", {
      dispatcherId,
      batchSize: config.outboxDispatcher.batchSize,
      leaseSeconds: config.outboxDispatcher.leaseSeconds,
      pollIntervalMs: config.outboxDispatcher.pollIntervalMs,
    });
  }
  return {
    async tick() {
      return tick();
    },
    async close() {
      if (closed) return;
      closed = true;
      clearInterval(interval);
      await queue.close();
      await pool.end();
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startOutboxDispatcherServer()
    .then((service) => {
      let closing = false;
      const close = async (signal) => {
        if (closing) return;
        closing = true;
        console.info("[outbox-dispatcher] shutdown", { signal });
        await service.close();
      };
      for (const signal of ["SIGINT", "SIGTERM"]) {
        process.once(signal, () => {
          close(signal)
            .then(() => { process.exitCode = 0; })
            .catch((error) => {
              console.error("[outbox-dispatcher] shutdown-error", error);
              process.exitCode = 1;
            });
        });
      }
    })
    .catch((error) => {
      console.error("[outbox-dispatcher] startup-error", error);
      process.exitCode = 1;
    });
}
