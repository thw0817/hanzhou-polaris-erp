import assert from "node:assert/strict";
import test from "node:test";
import { activeJobRefetchInterval } from "../../src-v2/lib/refresh-state.js";
import {
  buildStoreBusinessRefreshWorkerOptions,
  STORE_BUSINESS_REFRESH_WORKER_LOCK_DURATION_MS,
  STORE_BUSINESS_REFRESH_WORKER_LOCK_RENEW_TIME_MS,
  STORE_BUSINESS_REFRESH_WORKER_STALLED_INTERVAL_MS,
} from "./store-business-refresh-worker.js";
import {
  PostgresStoreBusinessRepository,
  WebStoreBusinessService,
} from "./store-business-service.js";
import { PostgresSyncJobRepository } from "./sync-job-service.js";
import { StoreBusinessRefreshScheduler } from "./store-business-refresh-scheduler.js";

test("SRF-05 does not poll when a refresh job is not present", () => {
  assert.equal(
    activeJobRefetchInterval({ state: { status: "pending", data: null } }, Date.now()),
    false,
  );
});

test("SRF-05 keeps store business workers from being marked stalled", () => {
  const options = buildStoreBusinessRefreshWorkerOptions({ concurrency: 1 });
  assert.equal(options.lockDuration, STORE_BUSINESS_REFRESH_WORKER_LOCK_DURATION_MS);
  assert.equal(options.lockRenewTime, STORE_BUSINESS_REFRESH_WORKER_LOCK_RENEW_TIME_MS);
  assert.equal(options.stalledInterval, STORE_BUSINESS_REFRESH_WORKER_STALLED_INTERVAL_MS);
  assert.ok(options.lockDuration > options.lockRenewTime);
});

test("SRF-05 dashboard reads reconcile orphaned store refresh state", async () => {
  const calls = [];
  const service = new WebStoreBusinessService({
    repository: {
      async reconcileStale(input) { calls.push(input); },
      async get() {
        return { state: "refreshing", snapshot: {}, refresh_started_at: "2026-08-26T23:00:00.000Z" };
      },
    },
    now: () => new Date("2026-08-27T00:00:00.000Z"),
  });

  await service.getDashboard({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
  });

  assert.deepEqual(calls, [{
    tenantId: "tenant-1",
    storeId: "store-1",
    now: new Date("2026-08-27T00:00:00.000Z"),
  }]);
});

test("SRF-05 store snapshot reconciliation expires jobs and repairs orphan snapshots atomically", async () => {
  const queries = [];
  const client = {
    async query(input) {
      queries.push(input);
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  const repository = new PostgresStoreBusinessRepository({
    pool: { async connect() { return client; } },
  });

  await repository.reconcileStale({
    tenantId: "tenant-1",
    storeId: "store-1",
    now: new Date("2026-08-27T00:00:00.000Z"),
  });

  assert.equal(queries[0], "BEGIN");
  assert.match(queries[1].text, /UPDATE sync_jobs/);
  assert.match(queries[1].text, /store_business_refresh/);
  assert.match(queries[1].text, /SYNC_JOB_TIMEOUT/);
  assert.match(queries[2].text, /UPDATE store_business_snapshots/);
  assert.match(queries[2].text, /NOT EXISTS/);
  assert.equal(queries.at(-1), "COMMIT");
});

test("SRF-05 stale reconciliation covers every persisted sync job type", async () => {
  let query = null;
  const repository = new PostgresSyncJobRepository({
    pool: { async query(input) { query = input; return { rows: [], rowCount: 0 }; } },
  });
  await repository.reconcileStale({ tenantId: "tenant-1", storeId: "store-1" });
  for (const type of [
    "store_business_refresh",
    "product_incremental_sync",
    "sales_daily_sync",
    "inventory_sync",
    "compliance_sync",
    "rule_refresh",
    "webhook_reconcile",
  ]) {
    assert.match(query.text, new RegExp(type));
  }
});

test("SRF-05 scheduler limits concurrent store refresh enqueues", async () => {
  const client = {
    async query(input) {
      const text = typeof input === "string" ? input : input.text;
      if (text.includes("pg_try_advisory_lock")) return { rows: [{ acquired: true }] };
      if (text.includes("pg_advisory_unlock")) return { rows: [{ unlocked: true }] };
      return {
        rows: [
          { tenant_id: "tenant-1", store_id: "store-1" },
          { tenant_id: "tenant-1", store_id: "store-2" },
          { tenant_id: "tenant-1", store_id: "store-3" },
          { tenant_id: "tenant-1", store_id: "store-4" },
        ],
      };
    },
    release() {},
  };
  let active = 0;
  let maxActive = 0;
  const scheduler = new StoreBusinessRefreshScheduler({
    pool: { async connect() { return client; } },
    maxConcurrency: 2,
    service: {
      async startRefresh() {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
        return { started: true };
      },
    },
  });

  const result = await scheduler.runOnce();
  assert.equal(result.enqueued, 4);
  assert.equal(maxActive, 2);
});
