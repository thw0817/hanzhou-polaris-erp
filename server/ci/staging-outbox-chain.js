import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import {
  BullMqJobQueue,
  PRODUCT_PUBLISH_JOB_NAME,
} from "../cloud/job-queue.js";
import {
  OUTBOX_EVENT_TYPE,
  OUTBOX_JOB_CONTRACT_VERSION,
  PostgresPublishOutboxRepository,
  createPublishOutboxEvents,
  dispatchOutboxOnce,
} from "../cloud/outbox-dispatcher.js";
import {
  productPublishCandidateFingerprint,
} from "../cloud/product-publish-candidate.js";
import {
  productRemotePublishCandidateFingerprint,
} from "../cloud/product-remote-preflight.js";
import { createProductPublishWorker } from "../cloud/product-publish-worker.js";
import { createPostgresPool, withTransaction } from "../cloud/postgres.js";

const STAGING_DATABASE_HOST = "127.0.0.1:55432";
const STAGING_REDIS_HOST = "127.0.0.1:56379";
const MAX_WAIT_MS = 15_000;

function requiredEnvironment() {
  const expected = {
    SHEIN_ENVIRONMENT: "staging",
    SHEIN_RUNTIME_MODE: "cloud",
    SHEIN_PRODUCT_PUBLISH_EXECUTION_ENABLED: "false",
  };
  for (const [name, value] of Object.entries(expected)) {
    if (process.env[name] !== value) {
      throw new Error(`${name} 必须严格为 ${value}`);
    }
  }
  const databaseUrl = String(process.env.DATABASE_URL || "");
  const redisUrl = String(process.env.REDIS_URL || "");
  if (!databaseUrl.includes(STAGING_DATABASE_HOST)) {
    throw new Error(`DATABASE_URL 必须指向独立 staging 端口 ${STAGING_DATABASE_HOST}`);
  }
  if (!redisUrl.includes(STAGING_REDIS_HOST)) {
    throw new Error(`REDIS_URL 必须指向独立 staging 端口 ${STAGING_REDIS_HOST}`);
  }
  return { databaseUrl, redisUrl };
}

function candidates() {
  const sourceSnapshot = {
    state: "ready_for_remote_preflight",
    requestBody: {
      category_id: "3155",
      skc_list: [{
        supplier_code: "STAGING-PROBE",
        sku_list: [{ supplier_sku: "STAGING-PROBE-40X60" }],
      }],
    },
    pendingImageUploads: [],
    audit: { categoryId: "3155" },
    remoteChecks: [],
    blockers: [],
  };
  const source = {
    ...sourceSnapshot,
    fingerprint: productPublishCandidateFingerprint(sourceSnapshot),
  };
  const remoteSnapshot = {
    state: "ready_for_publish_confirmation",
    sourceCandidateFingerprint: source.fingerprint,
    publishingEnabled: false,
    blockers: [],
    requestBody: source.requestBody,
  };
  const remote = {
    ...remoteSnapshot,
    fingerprint: productRemotePublishCandidateFingerprint(remoteSnapshot),
  };
  return { source, remote };
}

async function cleanupDatabase(pool, ids) {
  const deletes = [
    ["DELETE FROM publish_outbox_events WHERE publish_job_id = $1", ids.jobId],
    ["DELETE FROM publish_jobs WHERE id = $1", ids.jobId],
    ["DELETE FROM publish_batch_items WHERE id = $1", ids.batchItemId],
    ["DELETE FROM publish_execution_runs WHERE id = $1", ids.executionRunId],
    ["DELETE FROM publish_batches WHERE id = $1", ids.batchId],
    ["DELETE FROM product_drafts WHERE id = $1", ids.draftId],
    ["DELETE FROM stores WHERE id = $1", ids.storeId],
    ["DELETE FROM tenants WHERE id = $1", ids.tenantId],
  ];
  for (const [text, id] of deletes) {
    await pool.query({ text, values: [id] });
  }
}

async function cleanupRedis(redisUrl, prefix) {
  const redis = new Redis(redisUrl);
  try {
    let cursor = "0";
    do {
      const [nextCursor, keys] = await redis.scan(
        cursor,
        "MATCH",
        `${prefix}:*`,
        "COUNT",
        "1000",
      );
      if (keys.length) await redis.del(...keys);
      cursor = nextCursor;
    } while (cursor !== "0");
  } finally {
    await redis.quit();
  }
}

function waitForWorker(worker) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`staging Worker 在 ${MAX_WAIT_MS}ms 内未完成命令`));
    }, MAX_WAIT_MS);
    worker.once("completed", (job, result) => {
      clearTimeout(timer);
      resolve({ jobId: job.id, result });
    });
    worker.once("failed", (job, error) => {
      clearTimeout(timer);
      reject(error || new Error(`staging Worker 处理命令失败: ${job?.id || "unknown"}`));
    });
  });
}

async function run() {
  const { databaseUrl, redisUrl } = requiredEnvironment();
  const pool = createPostgresPool({ connectionString: databaseUrl, max: 4 });
  const ids = {
    tenantId: randomUUID(),
    storeId: randomUUID(),
    draftId: randomUUID(),
    batchId: randomUUID(),
    batchItemId: randomUUID(),
    executionRunId: randomUUID(),
    jobId: randomUUID(),
  };
  const prefix = `shein-staging-probe-${randomUUID().replaceAll("-", "")}`;
  const queueName = `shein-product-publish-staging-probe-${randomUUID().replaceAll("-", "")}`;
  const { source, remote } = candidates();
  let queue = null;
  let workerService = null;
  let databaseCleaned = false;
  let redisCleaned = false;
  try {
    await withTransaction(pool, async (client) => {
      await client.query({
        text: "INSERT INTO tenants (id, name) VALUES ($1, $2)",
        values: [ids.tenantId, "staging-outbox-chain-probe"],
      });
      await client.query({
        text: `
          INSERT INTO stores (id, tenant_id, open_key_id, label)
          VALUES ($1, $2, $3, $4)
        `,
        values: [
          ids.storeId,
          ids.tenantId,
          `staging-probe-${ids.storeId}`,
          "staging probe store",
        ],
      });
      await client.query({
        text: `
          INSERT INTO product_drafts (id, tenant_id, store_id, name, category_id, status)
          VALUES ($1, $2, $3, $4, $5, 'ready')
        `,
        values: [
          ids.draftId,
          ids.tenantId,
          ids.storeId,
          "staging outbox chain probe",
          "3155",
        ],
      });
      await client.query({
        text: `
          INSERT INTO publish_batches (id, tenant_id, store_id, name, idempotency_key, state)
          VALUES ($1, $2, $3, $4, $5, 'ready')
        `,
        values: [
          ids.batchId,
          ids.tenantId,
          ids.storeId,
          "staging outbox chain probe",
          `staging-probe-${ids.batchId}`,
        ],
      });
      await client.query({
        text: `
          INSERT INTO publish_batch_items (id, batch_id, product_draft_id, state)
          VALUES ($1, $2, $3, 'ready')
        `,
        values: [ids.batchItemId, ids.batchId, ids.draftId],
      });
      await client.query({
        text: `
          INSERT INTO publish_execution_runs (
            id, tenant_id, store_id, publish_batch_id, authorization_id,
            execution_plan_fingerprint, authorization_fingerprint,
            authorized_at, expires_at, state, execution_enabled, authorizes_publishing
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now() + interval '10 minutes', 'issued', false, false)
        `,
        values: [
          ids.executionRunId,
          ids.tenantId,
          ids.storeId,
          ids.batchId,
          `staging-probe-authorization-${ids.executionRunId}`,
          "staging-plan-fingerprint",
          "staging-authorization-fingerprint",
        ],
      });
      await client.query({
        text: `
          INSERT INTO publish_jobs (
            id, tenant_id, store_id, execution_run_id, publish_batch_id,
            publish_batch_item_id, product_draft_id, request_key,
            source_candidate_fingerprint, remote_candidate_fingerprint,
            state, request_summary
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'authorized', $11::jsonb)
        `,
        values: [
          ids.jobId,
          ids.tenantId,
          ids.storeId,
          ids.executionRunId,
          ids.batchId,
          ids.batchItemId,
          ids.draftId,
          `staging-probe-request-${ids.jobId}`,
          source.fingerprint,
          remote.fingerprint,
          JSON.stringify({ requestKey: `staging-probe-request-${ids.jobId}` }),
        ],
      });
      const events = await createPublishOutboxEvents({
        client,
        tenantId: ids.tenantId,
        storeId: ids.storeId,
        executionRunId: ids.executionRunId,
      });
      if (events.length !== 1 || events[0].publish_job_id !== ids.jobId) {
        throw new Error("staging probe 未创建且仅创建一个 PublishCommand Outbox 事件");
      }
    });

    queue = new BullMqJobQueue({ redisUrl, queueName, prefix });
    const repository = {
      claimed: false,
      async markExpiredClaimsUnknown() {
        return [];
      },
      async claimNextJob(input) {
        if (this.claimed) return null;
        this.claimed = true;
        return {
          id: ids.jobId,
          execution_run_id: ids.executionRunId,
          claim_id: input.claimId,
          source_candidate_fingerprint: source.fingerprint,
          remote_candidate_fingerprint: remote.fingerprint,
        };
      },
      async loadClaimedExecutionSource() {
        return {
          job: { id: ids.jobId },
          currentSourceCandidate: source,
          remoteCandidate: remote,
        };
      },
      async recordSubmitted() {
        return { id: ids.jobId, state: "submitted" };
      },
    };
    let executorCalls = 0;

    // The worker path is real, but the executor is deliberately a local no-write stub.
    const localRepository = {
      ...repository,
      async recordSubmitted() {
        return { id: ids.jobId, state: "submitted" };
      },
    };
    const safeExecutor = {
      async execute() {
        executorCalls += 1;
        return {
          outcome: "accepted",
          receipt: { version: "STAGING-PROBE", traceId: "staging-probe" },
        };
      },
    };
    workerService = createProductPublishWorker({
      redisUrl,
      repository: localRepository,
      executor: safeExecutor,
      queueName,
      prefix,
    });
    await workerService.worker.waitUntilReady();
    const completion = waitForWorker(workerService.worker);
    const outboxRepository = new PostgresPublishOutboxRepository({ pool });
    const dispatch = await dispatchOutboxOnce({
      repository: outboxRepository,
      queue,
      dispatcherId: `staging-probe-${ids.tenantId}`,
    });
    const completed = await completion;
    const outboxResult = await pool.query({
      text: `
        SELECT state, queue_job_id, dispatch_attempts, event_type
        FROM publish_outbox_events
        WHERE publish_job_id = $1
      `,
      values: [ids.jobId],
    });
    const outbox = outboxResult.rows[0];
    if (
      dispatch.claimed !== 1 ||
      dispatch.dispatched !== 1 ||
      dispatch.failed !== 0 ||
      completed.jobId !== ids.jobId ||
      completed.result.submittedCount !== 1 ||
      outbox?.state !== "dispatched" ||
      outbox.queue_job_id !== ids.jobId ||
      outbox.dispatch_attempts !== 1 ||
      outbox.event_type !== OUTBOX_EVENT_TYPE ||
      executorCalls !== 1
    ) {
      throw new Error("staging Outbox → BullMQ → Worker 验证结果不满足门禁");
    }
    console.log(JSON.stringify({
      dispatch,
      completion: completed,
      outbox,
      queueName,
      prefix,
      contractVersion: OUTBOX_JOB_CONTRACT_VERSION,
      executorCalls,
      realSHEINCalls: 0,
    }));
  } finally {
    if (workerService) await workerService.close();
    if (queue) await queue.close();
    try {
      await cleanupDatabase(pool, ids);
      databaseCleaned = true;
    } finally {
      await pool.end();
    }
    await cleanupRedis(redisUrl, prefix);
    redisCleaned = true;
    if (!databaseCleaned || !redisCleaned) {
      throw new Error("staging probe 清理未完成");
    }
  }
}

run().catch((error) => {
  console.error(JSON.stringify({
    error: error?.message || String(error),
    code: error?.code || "STAGING_OUTBOX_CHAIN_FAILED",
  }));
  process.exitCode = 1;
});
