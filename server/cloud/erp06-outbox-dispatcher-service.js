import { withTransaction } from "./postgres.js";

export const ERP06_OUTBOX_EVENT_TYPE = "publish_command_requested";
export const ERP06_OUTBOX_JOB_CONTRACT_VERSION = "erp06-publish-command-v1";
export const ERP06_OUTBOX_JOB_NAME = "erp06-publish-command";
export const ERP06_OUTBOX_DEFAULT_BATCH_SIZE = 50;
export const ERP06_OUTBOX_DEFAULT_LEASE_SECONDS = 60;
export const ERP06_WORKER_DEFAULT_LEASE_SECONDS = 60;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function text(value) {
  return String(value ?? "").trim();
}

function ensureUuid(value, name) {
  const normalized = text(value);
  if (!UUID_PATTERN.test(normalized)) {
    throw new Erp06OutboxError(
      "ERP06_OUTBOX_INPUT_INVALID",
      `${name} 不是有效 UUID`,
    );
  }
  return normalized;
}

function ensureScope({ tenantId, storeId } = {}) {
  return {
    tenantId: ensureUuid(tenantId, "tenantId"),
    storeId: ensureUuid(storeId, "storeId"),
  };
}

function positiveInteger(value, fallback, maximum) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function normalizedError(error) {
  return {
    code: text(error?.code) || "ERP06_OUTBOX_DISPATCH_FAILED",
    message: text(error?.message) || "ERP-06 Outbox 投递失败",
    traceId: text(error?.traceId) || null,
  };
}

function retryAt(now, attemptCount) {
  const exponent = Math.max(0, Math.min(Number(attemptCount || 1) - 1, 6));
  return new Date(now.getTime() + Math.min(60_000, 1_000 * (2 ** exponent)));
}

function requireMatchingUuid(summary, key, expected) {
  const actual = ensureUuid(summary[key], key);
  if (actual !== expected) {
    throw new Erp06OutboxError(
      "ERP06_OUTBOX_PAYLOAD_MISMATCH",
      `Outbox payload 的 ${key} 与持久化关联不一致`,
      409,
    );
  }
  return actual;
}

function buildDispatchPayload(row) {
  if (text(row?.event_type) !== ERP06_OUTBOX_EVENT_TYPE) {
    throw new Erp06OutboxError(
      "ERP06_OUTBOX_EVENT_UNSUPPORTED",
      "ERP-06 Outbox 事件类型不受支持",
      409,
    );
  }
  const tenantId = ensureUuid(row?.tenant_id, "tenant_id");
  const storeId = ensureUuid(row?.store_id, "store_id");
  const commandId = ensureUuid(row?.publish_command_id, "publish_command_id");
  const summary = asObject(row?.payload_summary);
  const versionFingerprint = text(summary.versionFingerprint);
  if (!versionFingerprint) {
    throw new Erp06OutboxError(
      "ERP06_OUTBOX_PAYLOAD_INVALID",
      "ERP-06 Outbox 缺少不可变版本指纹",
      409,
    );
  }
  return {
    commandId,
    tenantId,
    storeId,
    contractVersion: ERP06_OUTBOX_JOB_CONTRACT_VERSION,
    publishBatchId: requireMatchingUuid(summary, "publishBatchId", text(summary.publishBatchId)),
    publishBatchItemId: requireMatchingUuid(summary, "publishBatchItemId", text(summary.publishBatchItemId)),
    publishAttemptId: requireMatchingUuid(summary, "publishAttemptId", text(summary.publishAttemptId)),
    productVersionId: requireMatchingUuid(summary, "productVersionId", text(summary.productVersionId)),
    sourceDraftRevisionId: requireMatchingUuid(
      summary,
      "sourceDraftRevisionId",
      text(summary.sourceDraftRevisionId),
    ),
    versionFingerprint,
  };
}

export class Erp06OutboxError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.name = "Erp06OutboxError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class PostgresErp06OutboxRepository {
  constructor({ pool } = {}) {
    if (!pool) throw new Error("PostgresErp06OutboxRepository 缺少 pool");
    this.pool = pool;
  }

  async claimOutbox({
    tenantId,
    storeId,
    dispatcherId = `erp06-outbox-dispatcher-${process.pid}`,
    limit = ERP06_OUTBOX_DEFAULT_BATCH_SIZE,
    leaseSeconds = ERP06_OUTBOX_DEFAULT_LEASE_SECONDS,
    now = new Date(),
  } = {}) {
    const scope = ensureScope({ tenantId, storeId });
    const result = await withTransaction(this.pool, async (client) => client.query({
      text: `
        WITH claimable AS (
          SELECT outbox.id
          FROM product_publish_outbox AS outbox
          JOIN publish_commands AS command
            ON command.tenant_id=outbox.tenant_id
           AND command.store_id=outbox.store_id
           AND command.id=outbox.publish_command_id
          JOIN publish_attempts AS attempt
            ON attempt.tenant_id=command.tenant_id
           AND attempt.store_id=command.store_id
           AND attempt.id=command.publish_attempt_id
          WHERE outbox.tenant_id=$1
            AND outbox.store_id=$2
            AND command.state='queued'
            AND attempt.state NOT IN ('result_unknown', 'superseded_by_new_attempt')
            AND (
              (
                outbox.state IN ('pending', 'failed')
                AND outbox.available_at <= $3::timestamptz
              )
              OR (
                outbox.state='dispatching'
                AND outbox.lease_expires_at <= $3::timestamptz
              )
            )
          ORDER BY outbox.created_at, outbox.id
          FOR UPDATE OF outbox SKIP LOCKED
          LIMIT $4
        )
        UPDATE product_publish_outbox AS outbox
        SET state='dispatching',
            attempt_count=outbox.attempt_count + 1,
            lease_id=$5 || ':' || outbox.id::text || ':' || (outbox.attempt_count + 1)::text,
            lease_expires_at=$3::timestamptz + ($6::text || ' seconds')::interval,
            updated_at=$3::timestamptz
        FROM claimable
        WHERE outbox.id=claimable.id
          AND outbox.tenant_id=$1
          AND outbox.store_id=$2
        RETURNING outbox.*
      `,
      values: [
        scope.tenantId,
        scope.storeId,
        now,
        positiveInteger(limit, ERP06_OUTBOX_DEFAULT_BATCH_SIZE, 500),
        text(dispatcherId) || `erp06-outbox-dispatcher-${process.pid}`,
        positiveInteger(leaseSeconds, ERP06_OUTBOX_DEFAULT_LEASE_SECONDS, 3_600),
      ],
    }));
    return result.rows || [];
  }

  async markOutboxDispatched({
    tenantId,
    storeId,
    outboxId,
    leaseId,
    queueJobId,
    dispatchedAt = new Date(),
  } = {}) {
    const scope = ensureScope({ tenantId, storeId });
    const result = await this.pool.query({
      text: `
        UPDATE product_publish_outbox
        SET state='dispatched',
            queue_job_id=$5,
            dispatched_at=$6::timestamptz,
            lease_id=NULL,
            lease_expires_at=NULL,
            updated_at=$6::timestamptz
        WHERE tenant_id=$1
          AND store_id=$2
          AND id=$3
          AND lease_id=$4
          AND state='dispatching'
        RETURNING *
      `,
      values: [scope.tenantId, scope.storeId, outboxId, leaseId, queueJobId, dispatchedAt],
    });
    return result.rows[0] || null;
  }

  async markOutboxFailure({
    tenantId,
    storeId,
    outboxId,
    leaseId,
    error,
    nextAvailableAt = new Date(),
  } = {}) {
    const scope = ensureScope({ tenantId, storeId });
    const result = await this.pool.query({
      text: `
        UPDATE product_publish_outbox
        SET state='failed',
            available_at=$5::timestamptz,
            last_error=$6::jsonb,
            lease_id=NULL,
            lease_expires_at=NULL,
            updated_at=$5::timestamptz
        WHERE tenant_id=$1
          AND store_id=$2
          AND id=$3
          AND lease_id=$4
          AND state='dispatching'
        RETURNING *
      `,
      values: [
        scope.tenantId,
        scope.storeId,
        outboxId,
        leaseId,
        nextAvailableAt,
        JSON.stringify(normalizedError(error)),
      ],
    });
    return result.rows[0] || null;
  }

  async claimCommand({
    tenantId,
    storeId,
    commandId,
    workerId = `erp06-publish-worker-${process.pid}`,
    claimId,
    leaseSeconds = ERP06_WORKER_DEFAULT_LEASE_SECONDS,
    now = new Date(),
  } = {}) {
    const scope = ensureScope({ tenantId, storeId });
    const normalizedCommandId = ensureUuid(commandId, "commandId");
    const normalizedClaimId = text(claimId);
    if (!normalizedClaimId) {
      throw new Erp06OutboxError("ERP06_WORKER_CLAIM_INVALID", "Worker claimId 不能为空");
    }
    const result = await withTransaction(this.pool, async (client) => client.query({
      text: `
        WITH claimable AS (
          SELECT command.id
          FROM publish_commands AS command
          JOIN product_publish_outbox AS outbox
            ON outbox.tenant_id=command.tenant_id
           AND outbox.store_id=command.store_id
           AND outbox.publish_command_id=command.id
          JOIN publish_attempts AS attempt
            ON attempt.tenant_id=command.tenant_id
           AND attempt.store_id=command.store_id
           AND attempt.id=command.publish_attempt_id
          WHERE command.tenant_id=$1
            AND command.store_id=$2
            AND command.id=$3
            AND outbox.state='dispatched'
            AND attempt.state NOT IN ('result_unknown', 'superseded_by_new_attempt')
            AND (
              command.state='queued'
              OR (
                command.state='dispatching'
                AND command.worker_lease_expires_at <= $4::timestamptz
              )
            )
          ORDER BY command.created_at, command.id
          FOR UPDATE OF command SKIP LOCKED
          LIMIT 1
        )
        UPDATE publish_commands AS command
        SET state='dispatching',
            worker_id=$5,
            worker_claim_id=$6,
            worker_claimed_at=$4::timestamptz,
            worker_lease_expires_at=$4::timestamptz + ($7::text || ' seconds')::interval,
            updated_at=$4::timestamptz
        FROM claimable
        WHERE command.id=claimable.id
          AND command.tenant_id=$1
          AND command.store_id=$2
        RETURNING command.*
      `,
      values: [
        scope.tenantId,
        scope.storeId,
        normalizedCommandId,
        now,
        text(workerId) || `erp06-publish-worker-${process.pid}`,
        normalizedClaimId,
        positiveInteger(leaseSeconds, ERP06_WORKER_DEFAULT_LEASE_SECONDS, 3_600),
      ],
    }));
    return result.rows[0] || null;
  }

  async releaseCommandDryRun({
    tenantId,
    storeId,
    commandId,
    claimId,
    releasedAt = new Date(),
  } = {}) {
    const scope = ensureScope({ tenantId, storeId });
    const result = await this.pool.query({
      text: `
        UPDATE publish_commands
        SET state='queued',
            worker_id=NULL,
            worker_claim_id=NULL,
            worker_claimed_at=NULL,
            worker_lease_expires_at=NULL,
            updated_at=$5::timestamptz
        WHERE tenant_id=$1
          AND store_id=$2
          AND id=$3
          AND worker_claim_id=$4
          AND state='dispatching'
        RETURNING *
      `,
      values: [scope.tenantId, scope.storeId, commandId, claimId, releasedAt],
    });
    return result.rows[0] || null;
  }
}

export async function dispatchErp06OutboxOnce({
  repository,
  queue,
  tenantId,
  storeId,
  dispatcherId,
  limit = ERP06_OUTBOX_DEFAULT_BATCH_SIZE,
  leaseSeconds = ERP06_OUTBOX_DEFAULT_LEASE_SECONDS,
  now = () => new Date(),
  logger = null,
} = {}) {
  if (!repository || typeof repository.claimOutbox !== "function") {
    throw new Error("ERP-06 Outbox Dispatcher 缺少 repository");
  }
  if (!queue || typeof queue.add !== "function") {
    throw new Error("ERP-06 Outbox Dispatcher 缺少 queue");
  }
  const scope = ensureScope({ tenantId, storeId });
  const claimed = await repository.claimOutbox({
    ...scope,
    dispatcherId,
    limit,
    leaseSeconds,
    now: now(),
  });
  const summary = { claimed: claimed.length, dispatched: 0, failed: 0 };
  for (const event of claimed) {
    const outboxId = text(event.id);
    const leaseId = text(event.lease_id);
    let payload;
    try {
      payload = buildDispatchPayload(event);
      await queue.add(ERP06_OUTBOX_JOB_NAME, payload, {
        jobId: payload.commandId,
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: true,
      });
      const marked = await repository.markOutboxDispatched({
        ...scope,
        outboxId,
        leaseId,
        queueJobId: payload.commandId,
      });
      if (!marked) {
        throw Object.assign(new Error("ERP-06 Outbox lease 已失效，确定性 jobId 将安全复核"), {
          code: "ERP06_OUTBOX_LEASE_LOST",
        });
      }
      summary.dispatched += 1;
    } catch (error) {
      summary.failed += 1;
      await repository.markOutboxFailure({
        ...scope,
        outboxId,
        leaseId,
        error,
        nextAvailableAt: retryAt(now(), event.attempt_count),
      });
      if (typeof logger?.error === "function") {
        logger.error("[erp06-outbox-dispatcher] dispatch-failed", {
          outboxId,
          commandId: text(event.publish_command_id),
          code: text(error?.code) || "ERP06_OUTBOX_DISPATCH_FAILED",
        });
      }
    }
  }
  return summary;
}

function validateQueueJob(job) {
  if (job?.name !== ERP06_OUTBOX_JOB_NAME) {
    throw new Erp06OutboxError("ERP06_OUTBOX_JOB_INVALID", "ERP-06 Worker 队列名称不受支持");
  }
  const data = asObject(job.data);
  if (text(data.contractVersion) !== ERP06_OUTBOX_JOB_CONTRACT_VERSION) {
    throw new Erp06OutboxError("ERP06_OUTBOX_JOB_INVALID", "ERP-06 Worker contract version 不受支持");
  }
  const scope = ensureScope(data);
  const commandId = ensureUuid(data.commandId, "commandId");
  for (const key of [
    "publishBatchId",
    "publishBatchItemId",
    "publishAttemptId",
    "productVersionId",
    "sourceDraftRevisionId",
  ]) {
    ensureUuid(data[key], key);
  }
  if (!text(data.versionFingerprint)) {
    throw new Erp06OutboxError("ERP06_OUTBOX_JOB_INVALID", "ERP-06 Worker 缺少版本指纹");
  }
  return { data, scope, commandId };
}

export async function processErp06PublishQueueJob({
  job,
  repository,
  workerId = `erp06-publish-worker-${process.pid}`,
  randomId = () => `${workerId}:${Date.now()}`,
  now = () => new Date(),
} = {}) {
  const { data, scope, commandId } = validateQueueJob(job);
  if (!repository || typeof repository.claimCommand !== "function") {
    throw new Error("ERP-06 Worker 缺少 repository");
  }
  if (typeof repository.releaseCommandDryRun !== "function") {
    throw new Error("ERP-06 Worker 缺少 dry-run release boundary");
  }
  const claimId = text(randomId());
  if (!claimId) {
    throw new Erp06OutboxError("ERP06_WORKER_CLAIM_INVALID", "ERP-06 Worker claimId 不能为空");
  }
  const claimed = await repository.claimCommand({
    ...scope,
    commandId,
    workerId,
    claimId,
    now: now(),
  });
  if (!claimed) {
    return {
      claimed: false,
      remoteCallMade: false,
      reason: "not_claimable",
      commandId,
    };
  }
  if (
    text(claimed.id) !== commandId
    || text(claimed.tenant_id) !== scope.tenantId
    || text(claimed.store_id) !== scope.storeId
  ) {
    throw new Erp06OutboxError(
      "ERP06_WORKER_COMMAND_SCOPE_MISMATCH",
      "Worker 领取的 Command 与队列作用域不一致",
      409,
    );
  }
  const released = await repository.releaseCommandDryRun({
    ...scope,
    commandId,
    claimId,
    releasedAt: now(),
  });
  if (!released) {
    throw new Erp06OutboxError(
      "ERP06_WORKER_LEASE_LOST",
      "ERP-06 Worker lease 已失效，隔离演练拒绝猜测性推进",
      409,
    );
  }
  return {
    claimed: true,
    remoteCallMade: false,
    mode: "isolated_no_remote",
    commandId,
    attemptId: text(data.publishAttemptId),
    commandState: text(released.state) || "queued",
  };
}
