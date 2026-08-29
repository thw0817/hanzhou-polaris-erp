import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeBusinessSnapshot,
  PostgresStoreBusinessRepository,
  WebStoreBusinessService,
} from "./store-business-service.js";

function createTransactionalPool(handler) {
  const queries = [];
  const client = {
    async query(input) {
      queries.push(input);
      if (typeof handler === "function") {
        return handler(input, queries);
      }
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  return {
    queries,
    pool: {
      async connect() {
        return client;
      },
    },
  };
}

test("returns stale cached snapshot without refreshing on page entry", async () => {
  let syncs = 0;
  const repository = {
    async get() {
      return {
        state: "ready",
        snapshot: { totals: { today: 2 }, products: [] },
        source_cutoff: "20260801",
        synced_at: "2026-08-01T00:00:00.000Z",
      };
    },
    async claimRefresh() { return true; },
    async saveSuccess() {},
    async saveFailure() {},
  };
  const service = new WebStoreBusinessService({
    repository,
    now: () => new Date("2026-08-02T00:00:00.000Z"),
    syncStore: async () => { syncs += 1; return {}; },
  });

  const result = await service.getDashboard({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
  });
  assert.equal(result.snapshot.totals.today, 2);
  assert.equal(result.stale, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(syncs, 0);
});

test("returns an empty idle view without refreshing when V2 opts out", async () => {
  let claims = 0;
  const service = new WebStoreBusinessService({
    repository: {
      async get() { return null; },
      async claimRefresh() { claims += 1; return true; },
      async saveSuccess() {},
      async saveFailure() {},
    },
    syncStore: async () => ({ products: [], totals: {} }),
  });

  const result = await service.getDashboard({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    refreshIfEmpty: false,
  });

  assert.equal(result.state, "idle");
  assert.equal(result.snapshot, null);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(claims, 0);
});

test("does not refresh an empty cache on a default dashboard read", async () => {
  let claims = 0;
  const service = new WebStoreBusinessService({
    repository: {
      async get() { return null; },
      async claimRefresh() { claims += 1; return true; },
      async saveSuccess() {},
      async saveFailure() {},
    },
    syncStore: async () => ({ products: [], totals: {} }),
  });

  const result = await service.getDashboard({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
  });

  assert.equal(result.state, "idle");
  assert.equal(result.snapshot, null);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(claims, 0);
});

test("downgrades legacy inferred shelf states until exact SHEIN readback exists", () => {
  const snapshot = normalizeBusinessSnapshot({
    products: [
      { skc: "SKC-LEGACY", state: "在售" },
      {
        skc: "SKC-EXACT",
        state: "已售罄",
        statusCode: 3,
        statusSource: "shein_skc_label_list",
      },
    ],
  });

  assert.deepEqual(snapshot.products.map((product) => ({
    skc: product.skc,
    state: product.state,
    statusCode: product.statusCode,
    statusSource: product.statusSource,
  })), [
    {
      skc: "SKC-LEGACY",
      state: "待同步",
      statusCode: null,
      statusSource: "unavailable",
    },
    {
      skc: "SKC-EXACT",
      state: "已售罄",
      statusCode: 3,
      statusSource: "shein_skc_label_list",
    },
  ]);
});

test("derives product and store transit totals from cached SKU snapshots", () => {
  const snapshot = normalizeBusinessSnapshot({
    products: [{
      skc: "SKC-1",
      state: "已上架",
      statusCode: 1,
      statusSource: "shein_skc_label_list",
      skus: [
        { skuCode: "SKU-1", transitInventory: 3 },
        { skuCode: "SKU-2", transitInventory: 4 },
      ],
    }],
    totals: {},
  });

  assert.equal(snapshot.products[0].transitInventory, 7);
  assert.equal(snapshot.totals.transitInventory, 7);
});

test("merges SKU-level out-of-stock webhook facts into the trusted snapshot", () => {
  const snapshot = normalizeBusinessSnapshot({
    products: [{
      skc: "SKC-1",
      skus: [{ skuCode: "SKU-1", actualInventory: 5 }],
    }],
    outOfStock: {
      "SKU-1": { outOfStockQty: 2, receivedAt: "2026-08-25T00:00:00.000Z" },
    },
    totals: {},
  });
  assert.equal(snapshot.products[0].skus[0].outOfStockQty, 2);
  assert.equal(snapshot.products[0].skus[0].outOfStockUpdatedAt, "2026-08-25T00:00:00.000Z");
});

test("starts only one refresh for concurrent requests", async () => {
  let claims = 0;
  let syncs = 0;
  let resolveSync;
  const service = new WebStoreBusinessService({
    repository: {
      async get() { return null; },
      async claimRefresh() { claims += 1; return true; },
      async saveSuccess() {},
      async saveFailure() {},
    },
    syncStore: async () => {
      syncs += 1;
      return new Promise((resolve) => { resolveSync = resolve; });
    },
  });
  const context = { tenantId: "tenant-1", userId: "user-1" };
  await Promise.all([
    service.startRefresh({ context, storeId: "store-1" }),
    service.startRefresh({ context, storeId: "store-1" }),
  ]);
  assert.equal(claims, 1);
  assert.equal(syncs, 1);
  resolveSync({ products: [], totals: {} });
});

test("concurrent refresh requests return the same persisted sync job", async () => {
  let resolveSync;
  const saved = [];
  const refreshJob = {
    id: "job-1",
    jobType: "store_business_refresh",
    state: "running",
  };
  const service = new WebStoreBusinessService({
    repository: {
      async get() { return null; },
      async claimRefresh() { return { claimed: true, job: refreshJob }; },
      async saveSuccess(input) { saved.push(input); },
      async saveFailure() {},
    },
    syncStore: async () => new Promise((resolve) => { resolveSync = resolve; }),
  });
  const input = {
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
  };

  const [first, duplicate] = await Promise.all([
    service.startRefresh(input),
    service.startRefresh(input),
  ]);

  assert.equal(first.started, true);
  assert.equal(duplicate.started, false);
  assert.equal(first.job.id, "job-1");
  assert.equal(duplicate.job.id, "job-1");
  resolveSync({ products: [], totals: {} });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(saved[0].jobId, "job-1");
});

test("PostgreSQL refresh claim creates the sync job with the snapshot lock", async () => {
  let query = null;
  const repository = new PostgresStoreBusinessRepository({
    pool: {
      async query(input) {
        query = input;
        return {
          rows: [{
            claimed: true,
            refresh_job_id: "job-1",
            refresh_job_type: "store_business_refresh",
            refresh_job_state: "running",
            refresh_job_requested_by: "user-1",
            refresh_job_started_at: "2026-08-04T00:00:00.000Z",
            refresh_job_created_at: "2026-08-04T00:00:00.000Z",
          }],
        };
      },
    },
  });

  const result = await repository.claimRefresh({
    tenantId: "tenant-1",
    storeId: "store-1",
    requestedBy: "user-1",
  });

  assert.equal(result.claimed, true);
  assert.equal(result.job.id, "job-1");
  assert.match(query.text, /INSERT INTO sync_jobs/);
  assert.match(query.text, /store_business_refresh/);
  assert.match(query.text, /'store_business_refresh', 'queued'/);
  assert.match(query.text, /'trigger', \$8::text/);
  assert.deepEqual(query.values.slice(0, 3), ["tenant-1", "store-1", "user-1"]);
  assert.deepEqual(query.values.slice(4, 8), [
    "web.store_business.refresh",
    "POST",
    "/v1/web/stores/:storeId/business-dashboard",
    "web",
  ]);
  assert.equal(query.values[8] instanceof Date, true);
  assert.equal(query.values[9], false);

  await repository.claimRefresh({
    tenantId: "tenant-1",
    storeId: "store-1",
    requestedBy: null,
    trigger: "scheduler",
  });
  assert.deepEqual(query.values.slice(4, 8), [
    "scheduler.store_business.refresh",
    null,
    null,
    "scheduler",
  ]);
  assert.equal(query.values[9], true);
});

test("manual refresh reports the persisted cooldown instead of starting another job", async () => {
  const service = new WebStoreBusinessService({
    repository: {
      async claimRefresh() {
        return {
          claimed: false,
          job: null,
          cooldown: true,
          retryAfterSeconds: 37,
        };
      },
    },
    syncStore: async () => {},
    executionEnabled: true,
  });

  const result = await service.startRefresh({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
  });

  assert.equal(result.started, false);
  assert.deepEqual(result.refreshControl, {
    status: "cooldown",
    retryAfterSeconds: 37,
  });
});

test("PostgreSQL refresh completion updates the persisted sync job", async () => {
  const tx = createTransactionalPool();
  const repository = new PostgresStoreBusinessRepository({
    pool: tx.pool,
  });

  await repository.saveSuccess({
    tenantId: "tenant-1",
    storeId: "store-1",
    snapshot: { dataDate: "20260804", totals: { today: 3 } },
    jobId: "job-1",
  });
  const successUpdate = tx.queries.find((query) =>
    typeof query?.text === "string" && query.text.includes("SET state = 'succeeded'"));
  assert.deepEqual(successUpdate.values, ["job-1", "tenant-1", "store-1", 0]);
  assert.equal(tx.queries[0], "BEGIN");
  assert.equal(tx.queries.at(-1), "COMMIT");

  const queries = [];
  const failureRepository = new PostgresStoreBusinessRepository({
    pool: {
      async query(input) {
        queries.push(input);
        return { rows: [], rowCount: 1 };
      },
    },
  });
  await failureRepository.saveFailure({
    tenantId: "tenant-1",
    storeId: "store-1",
    error: Object.assign(new Error("平台超时"), { code: "UPSTREAM_TIMEOUT" }),
    jobId: "job-2",
  });
  const failureUpdate = queries.find((query) =>
    query.text.includes("SET state = 'failed'"));
  assert.deepEqual(failureUpdate.values.slice(0, 3), ["job-2", "tenant-1", "store-1"]);
  assert.match(failureUpdate.values[3], /UPSTREAM_TIMEOUT/);

  queries.length = 0;
  await failureRepository.saveFailure({
    tenantId: "tenant-1",
    storeId: "store-1",
    error: Object.assign(new Error("请求被限流"), { code: "832213" }),
    jobId: "job-3",
  });
  const rateLimitFailure = queries.find((query) =>
    query.text.includes("SET state = 'failed'"));
  assert.match(rateLimitFailure.values[3], /SHEIN_RATE_LIMITED/);
  assert.match(rateLimitFailure.values[3], /SHEIN接口暂时限流，请稍后再次刷新/);

  queries.length = 0;
  assert.equal(await failureRepository.markRefreshRunning({
    tenantId: "tenant-1",
    storeId: "store-1",
    jobId: "job-3",
  }), true);
  await failureRepository.touchRefreshJob({
    tenantId: "tenant-1",
    storeId: "store-1",
    jobId: "job-3",
  });
  assert.deepEqual(queries[0].values, ["job-3", "tenant-1", "store-1"]);
  assert.deepEqual(queries[1].values, ["job-3", "tenant-1", "store-1"]);
});

test("PostgreSQL refresh success projects real business products into SPUs and SKCs", async () => {
  const tx = createTransactionalPool();
  const repository = new PostgresStoreBusinessRepository({ pool: tx.pool });

  await repository.saveSuccess({
    tenantId: "tenant-1",
    storeId: "store-1",
    jobId: "job-1",
    snapshot: {
      dataDate: "20260808",
      totals: { today: 1, yesterday: 2, sales7: 3, sales30: 4 },
      products: [
        {
          spu: "SPU-1",
          skc: "SKC-1",
          name: "装饰地毯",
          categoryId: "3155",
          categoryName: "装饰地毯",
          supplierCode: "RUG-001",
          state: "已上架",
          statusCode: 1,
          statusSource: "shein_skc_label_list",
          skus: [{ skuCode: "SKU-1", supplierSku: "RUG-001-40X60" }],
        },
        {
          spu: "SPU-IGNORED",
          name: "缺少 SKC 的商品",
          categoryId: "3155",
        },
      ],
    },
  });

  const projection = tx.queries.find((query) =>
    typeof query?.text === "string" && query.text.includes("INSERT INTO spus"));
  assert.ok(projection);
  assert.match(projection.text, /INSERT INTO skcs/);
  assert.match(projection.text, /ON CONFLICT \(store_id, spu_name\) DO UPDATE/);
  assert.match(projection.text, /ON CONFLICT \(store_id, skc_name\) DO UPDATE/);
  assert.match(projection.text, /spu_id = COALESCE\(EXCLUDED\.spu_id, skcs\.spu_id\)/);
  assert.match(projection.text, /WHERE skcs\.tenant_id = EXCLUDED\.tenant_id/);
  assert.deepEqual(projection.values.slice(0, 2), ["tenant-1", "store-1"]);
  const projectedRows = JSON.parse(projection.values[2]);
  assert.equal(projectedRows.length, 1);
  assert.deepEqual(projectedRows[0], {
    skc_name: "SKC-1",
    spu_name: "SPU-1",
    title: "装饰地毯",
    category_id: "3155",
    category_name: "装饰地毯",
    supplier_code: "RUG-001",
    shelf_status: "已上架",
    raw_data: {
      spu: "SPU-1",
      skc: "SKC-1",
      name: "装饰地毯",
      categoryId: "3155",
      categoryName: "装饰地毯",
      supplierCode: "RUG-001",
      state: "已上架",
      statusCode: 1,
      statusSource: "shein_skc_label_list",
      skus: [{ skuCode: "SKU-1", supplierSku: "RUG-001-40X60" }],
      transitInventory: null,
    },
  });
  const successUpdate = tx.queries.find((query) =>
    typeof query?.text === "string" && query.text.includes("productProjectionCount"));
  const snapshotUpdate = tx.queries.find((query) =>
    typeof query?.text === "string" && query.text.includes("productQuota"));
  assert.match(snapshotUpdate.text, /snapshot->'productQuota'/);
  assert.match(snapshotUpdate.text, /NOT \(\$3::jsonb \? 'productQuota'\)/);
  assert.deepEqual(successUpdate.values, ["job-1", "tenant-1", "store-1", 1]);
});

test("store refresh fails instead of marking success when product projection fails", async () => {
  const tx = createTransactionalPool((input) => {
    if (typeof input?.text === "string" && input.text.includes("INSERT INTO spus")) {
      throw Object.assign(new Error("permission denied for table skcs"), { code: "42501" });
    }
    return { rows: [], rowCount: 1 };
  });
  const repository = new PostgresStoreBusinessRepository({ pool: tx.pool });

  await assert.rejects(
    repository.saveSuccess({
      tenantId: "tenant-1",
      storeId: "store-1",
      jobId: "job-1",
      snapshot: {
        dataDate: "20260808",
        products: [{ spu: "SPU-1", skc: "SKC-1" }],
      },
    }),
    /permission denied for table skcs/,
  );

  assert.equal(tx.queries.includes("ROLLBACK"), true);
  assert.equal(tx.queries.some((query) =>
    typeof query?.text === "string" && query.text.includes("SET state = 'succeeded'")),
  false);
});

test("queued refresh returns immediately without calling SHEIN in the API process", async () => {
  let syncs = 0;
  const added = [];
  const service = new WebStoreBusinessService({
    repository: {
      async claimRefresh() {
        return {
          claimed: true,
          job: { id: "job-1", jobType: "store_business_refresh", state: "queued" },
        };
      },
      async saveFailure() {},
    },
    queue: {
      async add(name, data, options) { added.push({ name, data, options }); },
    },
    syncStore: async () => { syncs += 1; return {}; },
  });

  const result = await service.startRefresh({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
  });

  assert.equal(result.started, true);
  assert.equal(syncs, 0);
  assert.equal(added[0].data.jobId, "job-1");
  assert.equal(added[0].options.jobId, "job-1");
  assert.equal(added[0].options.attempts, 2);
  assert.deepEqual(added[0].options.backoff, { type: "exponential", delay: 2_000 });
});

test("scheduled refresh preserves its non-user trigger when claiming the task", async () => {
  let claim = null;
  const service = new WebStoreBusinessService({
    repository: {
      async claimRefresh(input) {
        claim = input;
        return { claimed: false, job: { id: "job-1", state: "queued" } };
      },
    },
    queue: { async add() {} },
  });

  await service.startRefresh({
    context: { tenantId: "tenant-1", userId: null, trigger: "scheduler" },
    storeId: "store-1",
  });

  assert.equal(claim.trigger, "scheduler");
});

test("queue failure marks the claimed refresh failed", async () => {
  const failures = [];
  const service = new WebStoreBusinessService({
    repository: {
      async claimRefresh() {
        return {
          claimed: true,
          job: { id: "job-1", jobType: "store_business_refresh", state: "queued" },
        };
      },
      async saveFailure(input) { failures.push(input); },
    },
    queue: { async add() { throw new Error("redis unavailable"); } },
  });

  await assert.rejects(
    service.startRefresh({
      context: { tenantId: "tenant-1", userId: "user-1" },
      storeId: "store-1",
    }),
    (error) => error.code === "SYNC_QUEUE_UNAVAILABLE" && error.status === 503,
  );
  assert.equal(failures[0].jobId, "job-1");
  assert.equal(failures[0].error.code, "SYNC_QUEUE_UNAVAILABLE");
});

test("disabled worker rejects refresh before claiming a database task", async () => {
  let claims = 0;
  const service = new WebStoreBusinessService({
    repository: {
      async claimRefresh() { claims += 1; return false; },
      async get() { return null; },
    },
    executionEnabled: false,
  });

  await assert.rejects(
    service.startRefresh({
      context: { tenantId: "tenant-1", userId: "user-1" },
      storeId: "store-1",
    }),
    (error) => error.code === "SYNC_WORKER_UNAVAILABLE" && error.status === 503,
  );
  assert.equal(claims, 0);
});

test("worker execution transitions a queued refresh before syncing", async () => {
  const calls = [];
  const service = new WebStoreBusinessService({
    repository: {
      async markRefreshRunning(input) { calls.push(["running", input.jobId]); return true; },
      async touchRefreshJob() { calls.push(["heartbeat"]); },
      async get() { calls.push(["get"]); return { snapshot: { old: true } }; },
      async saveSuccess(input) { calls.push(["success", input.jobId]); },
      async saveFailure() {},
    },
    syncStore: async ({ previousSnapshot }) => {
      calls.push(["sync", previousSnapshot.old]);
      return { products: [], totals: {} };
    },
  });

  const result = await service.processRefreshJob({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    jobId: "job-1",
  });

  assert.equal(result.state, "succeeded");
  assert.deepEqual(calls.filter((call) => call[0] !== "heartbeat"), [
    ["running", "job-1"],
    ["get"],
    ["sync", true],
    ["success", "job-1"],
  ]);
});

test("worker skips a refresh whose database job already ended", async () => {
  let syncs = 0;
  const service = new WebStoreBusinessService({
    repository: {
      async markRefreshRunning() { return false; },
      async get() { return null; },
      async saveSuccess() {},
      async saveFailure() {},
    },
    syncStore: async () => { syncs += 1; return {}; },
  });

  const result = await service.processRefreshJob({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    jobId: "job-1",
  });

  assert.deepEqual(result, { skipped: true });
  assert.equal(syncs, 0);
});

test("worker heartbeats while a store refresh is running", async () => {
  let heartbeats = 0;
  const service = new WebStoreBusinessService({
    repository: {
      async markRefreshRunning() { return true; },
      async touchRefreshJob() { heartbeats += 1; },
      async get() { return null; },
      async saveSuccess() {},
      async saveFailure() {},
    },
    heartbeatIntervalMs: 2,
    syncStore: async () => {
      await new Promise((resolve) => setTimeout(resolve, 12));
      return { products: [], totals: {} };
    },
  });

  await service.processRefreshJob({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    jobId: "job-1",
  });

  assert.ok(heartbeats >= 1);
});
