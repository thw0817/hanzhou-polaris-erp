import assert from "node:assert/strict";
import test from "node:test";
import {
  PostgresRuleRefreshRepository,
  WebRuleRefreshService,
} from "./rule-refresh-service.js";

test("rule refresh API enqueues one persisted job without calling SHEIN", async () => {
  const added = [];
  let reads = 0;
  const service = new WebRuleRefreshService({
    repository: {
      async claimRefresh() {
        return { claimed: true, job: { id: "job-1", jobType: "rule_refresh", state: "queued" } };
      },
      async saveFailure() {},
    },
    queue: {
      async add(name, data, options) { added.push({ name, data, options }); },
    },
    ruleReader: {
      async getPublishCategories() { reads += 1; },
      async getPublishSchema() { reads += 1; },
    },
  });

  const result = await service.startRefresh({
    context: { tenantId: "tenant-1", userId: "user-1", role: "operator" },
    storeId: "store-1",
  });

  assert.equal(result.started, true);
  assert.equal(reads, 0);
  assert.equal(added[0].name, "rule-refresh");
  assert.equal(added[0].data.jobId, "job-1");
  assert.equal(added[0].data.scope, "referenced");
  assert.deepEqual(added[0].options, {
    jobId: "job-1",
    attempts: 2,
    backoff: { type: "exponential", delay: 2_000 },
  });
});

test("all-category refresh records its scope before the worker starts", async () => {
  let claimed = null;
  const service = new WebRuleRefreshService({
    repository: {
      async claimRefresh(input) {
        claimed = input;
        return { claimed: true, job: { id: "job-all", jobType: "rule_refresh", state: "queued" } };
      },
      async saveFailure() {},
    },
    queue: { async add() {} },
  });

  await service.startRefresh({
    context: { tenantId: "tenant-1", userId: "user-1", role: "operator" },
    storeId: "store-1",
    scope: "all",
  });

  assert.equal(claimed.scope, "all");
});

test("rule refresh repository persists the scope marker in the initial job row", async () => {
  const queries = [];
  const repository = new PostgresRuleRefreshRepository({
    pool: {
      async query(input) {
        queries.push(input);
        return {
          rows: [{
            claimed: true,
            id: "job-all",
            job_type: "rule_refresh",
            state: "queued",
          }],
        };
      },
    },
  });

  const result = await repository.claimRefresh({
    tenantId: "tenant-1",
    storeId: "store-1",
    requestedBy: null,
    scope: "all",
  });

  assert.equal(result.claimed, true);
  assert.match(queries[0].text, /jsonb_build_object\('scope', \$4::text\)/);
  assert.deepEqual(queries[0].values, ["tenant-1", "store-1", null, "all"]);
});

test("rule refresh rejects viewers before claiming a job", async () => {
  let claims = 0;
  const service = new WebRuleRefreshService({
    repository: { async claimRefresh() { claims += 1; } },
    queue: { async add() {} },
  });

  await assert.rejects(
    service.startRefresh({
      context: { tenantId: "tenant-1", userId: "user-1", role: "viewer" },
      storeId: "store-1",
    }),
    (error) => error.code === "RULE_REFRESH_FORBIDDEN" && error.status === 403,
  );
  assert.equal(claims, 0);
});

test("rule refresh marks the database job failed when Redis enqueue fails", async () => {
  const failures = [];
  const service = new WebRuleRefreshService({
    repository: {
      async claimRefresh() {
        return { claimed: true, job: { id: "job-1", jobType: "rule_refresh", state: "queued" } };
      },
      async saveFailure(input) { failures.push(input); },
    },
    queue: { async add() { throw new Error("redis unavailable"); } },
  });

  await assert.rejects(
    service.startRefresh({
      context: { tenantId: "tenant-1", userId: "user-1", role: "operator" },
      storeId: "store-1",
    }),
    (error) => error.code === "RULE_REFRESH_QUEUE_UNAVAILABLE" && error.status === 503,
  );
  assert.equal(failures[0].jobId, "job-1");
  assert.equal(failures[0].error.code, "RULE_REFRESH_QUEUE_UNAVAILABLE");
});

test("rule refresh records a queue-level failure in the database", async () => {
  let saved = null;
  const service = new WebRuleRefreshService({
    repository: {
      async saveFailure(input) { saved = input; },
    },
  });

  await service.recordQueueFailure({
    tenantId: "tenant-1",
    storeId: "store-1",
    jobId: "job-stalled",
    error: Object.assign(new Error("job stalled more than allowable limit"), {
      code: "JOB_STALLED",
    }),
  });

  assert.equal(saved.tenantId, "tenant-1");
  assert.equal(saved.storeId, "store-1");
  assert.equal(saved.jobId, "job-stalled");
  assert.equal(saved.progress, null);
  assert.equal(saved.error.code, "JOB_STALLED");
});

test("rule refresh retry queues only failed targets from the scoped previous job", async () => {
  let queued = null;
  let reads = 0;
  const service = new WebRuleRefreshService({
    repository: {
      async getFailedTargets() {
        return {
          jobType: "rule_refresh",
          state: "failed",
          progress: {
            scope: "all",
            failedTargets: [
              { categoryId: "101", productTypeId: "201" },
              { categoryId: "101", productTypeId: "201" },
              { categoryId: "102", productTypeId: "202", secret: "drop" },
            ],
          },
        };
      },
      async claimRefresh() {
        return { claimed: true, job: { id: "job-retry", jobType: "rule_refresh", state: "queued" } };
      },
      async saveFailure() {},
    },
    queue: {
      async add(name, data, options) { queued = { name, data, options }; },
    },
    ruleReader: {
      async getPublishCategories() { reads += 1; },
      async getPublishSchema() { reads += 1; },
    },
  });

  const result = await service.startRefresh({
    context: { tenantId: "tenant-1", userId: "user-1", role: "operator" },
    storeId: "store-1",
    retryJobId: "job-failed",
  });

  assert.equal(result.started, true);
  assert.equal(reads, 0);
  assert.deepEqual(queued.data.retryTargets, [
    { category_id: "101", product_type_id: "201" },
    { category_id: "102", product_type_id: "202" },
  ]);
  assert.equal(queued.data.scope, "all");
  assert.deepEqual(queued.options, {
    jobId: "job-retry",
    attempts: 2,
    backoff: { type: "exponential", delay: 2_000 },
  });
});

test("rule refresh worker refreshes categories and only referenced schema pairs", async () => {
  const reads = [];
  const progress = [];
  const service = new WebRuleRefreshService({
    repository: {
      async markRunning() { return true; },
      async listTargets() {
        return [
          { category_id: "3155", product_type_id: "991" },
          { category_id: "3156", product_type_id: "992" },
        ];
      },
      async updateProgress(input) { progress.push(input.progress); },
      async saveSuccess(input) { progress.push(input.progress); },
      async saveFailure() {},
    },
    ruleReader: {
      async getPublishCategories(input) { reads.push(["categories", input]); },
      async getPublishSchema(input) { reads.push(["schema", input]); },
    },
  });

  const result = await service.processRefreshJob({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    jobId: "job-1",
  });

  assert.deepEqual(result, { state: "succeeded", total: 2 });
  assert.equal(reads[0][0], "categories");
  assert.equal(reads[0][1].forceRefresh, true);
  assert.deepEqual(reads.slice(1).map((entry) => [
    entry[1].categoryId,
    entry[1].productTypeId,
    entry[1].forceRefresh,
  ]), [["3155", "991", true], ["3156", "992", true]]);
  assert.deepEqual(progress.at(-1), {
    scope: "referenced",
    total: 2,
    processed: 2,
    succeeded: 2,
    failed: 0,
  });
});

test("all-category rule refresh uses every SHEIN leaf category", async () => {
  const reads = [];
  const service = new WebRuleRefreshService({
    repository: {
      async markRunning() { return true; },
      async updateProgress() {},
      async saveSuccess() {},
      async saveFailure() {},
    },
    ruleReader: {
      async getPublishCategories() {
        return {
          info: {
            data: [{
              category_id: "100",
              category_name: "家居",
              last_category: false,
              children: [{
                category_id: "101",
                product_type_id: "201",
                category_name: "被套",
                last_category: true,
              }],
            }],
          },
        };
      },
      async getPublishSchema(input) { reads.push(input); },
    },
  });

  const result = await service.processRefreshJob({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    jobId: "job-all",
    scope: "all",
  });

  assert.deepEqual(result, { state: "succeeded", total: 1 });
  assert.deepEqual(reads.map((input) => [
    input.categoryId,
    input.productTypeId,
    input.forceRefresh,
  ]), [["101", "201", true]]);
});

test("all-category rule refresh deduplicates repeated category targets", async () => {
  const reads = [];
  const progress = [];
  const service = new WebRuleRefreshService({
    repository: {
      async markRunning() { return true; },
      async updateProgress(input) { progress.push({ ...input.progress }); },
      async saveSuccess(input) { progress.push({ ...input.progress }); },
      async saveFailure() {},
    },
    ruleReader: {
      async getPublishCategories() {
        return {
          info: {
            data: [{
              category_id: "100",
              category_name: "家居",
              last_category: false,
              children: [{
                category_id: "101",
                product_type_id: "201",
                category_name: "被套",
                last_category: true,
              }],
            }, {
              category_id: "200",
              category_name: "重复分支",
              last_category: false,
              children: [{
                category_id: "101",
                product_type_id: "201",
                category_name: "被套",
                last_category: true,
              }],
            }],
          },
        };
      },
      async getPublishSchema(input) { reads.push(input); },
    },
  });

  const result = await service.processRefreshJob({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    jobId: "job-dedup",
    scope: "all",
  });

  assert.deepEqual(result, { state: "succeeded", total: 1 });
  assert.deepEqual(reads.map((input) => [
    input.categoryId,
    input.productTypeId,
  ]), [["101", "201"]]);
  assert.deepEqual(progress.at(-1), {
    scope: "all",
    total: 1,
    processed: 1,
    succeeded: 1,
    failed: 0,
  });
});

test("all-category rule refresh uses bounded target concurrency", async () => {
  let active = 0;
  let maxActive = 0;
  const service = new WebRuleRefreshService({
    targetConcurrency: 2,
    repository: {
      async markRunning() { return true; },
      async updateProgress() {},
      async saveSuccess() {},
      async saveFailure() {},
    },
    ruleReader: {
      async getPublishCategories() {
        return {
          info: {
            data: [{
              category_id: "100",
              category_name: "家居",
              last_category: false,
              children: Array.from({ length: 5 }, (_, index) => ({
                category_id: String(101 + index),
                product_type_id: String(201 + index),
                category_name: `类目${index + 1}`,
                last_category: true,
              })),
            }],
          },
        };
      },
      async getPublishSchema() {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
      },
    },
  });

  const result = await service.processRefreshJob({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    jobId: "job-concurrent",
    scope: "all",
  });

  assert.deepEqual(result, { state: "succeeded", total: 5 });
  assert.equal(maxActive, 2);
});

test("rule refresh retry validates targets against the current official tree", async () => {
  const reads = [];
  const service = new WebRuleRefreshService({
    repository: {
      async markRunning() { return true; },
      async updateProgress() {},
      async saveSuccess() {},
      async saveFailure() {},
    },
    ruleReader: {
      async getPublishCategories() {
        return {
          info: {
            data: [{
              category_id: "100",
              category_name: "家居",
              last_category: false,
              children: [{
                category_id: "101",
                product_type_id: "201",
                category_name: "被套",
                last_category: true,
              }],
            }],
          },
        };
      },
      async getPublishSchema(input) { reads.push(input); },
    },
  });

  const result = await service.processRefreshJob({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    jobId: "job-retry",
    scope: "all",
    retryTargets: [{ category_id: "101", product_type_id: "201" }],
  });

  assert.deepEqual(result, { state: "succeeded", total: 1 });
  assert.deepEqual(reads.map((input) => [
    input.categoryId,
    input.productTypeId,
  ]), [["101", "201"]]);
});

test("rule refresh continues other categories and records partial failure", async () => {
  const progress = [];
  const failures = [];
  const reads = [];
  const service = new WebRuleRefreshService({
    repository: {
      async markRunning() { return true; },
      async updateProgress(input) { progress.push({ ...input.progress }); },
      async saveSuccess() {
        throw new Error("partial refresh must not be marked successful");
      },
      async saveFailure(input) { failures.push(input); },
    },
    ruleReader: {
      async getPublishCategories() {
        return {
          info: {
            data: [{
              category_id: "100",
              category_name: "家居",
              last_category: false,
              children: [
                {
                  category_id: "101",
                  product_type_id: "201",
                  category_name: "被套",
                  last_category: true,
                },
                {
                  category_id: "102",
                  product_type_id: "202",
                  category_name: "地毯",
                  last_category: true,
                },
              ],
            }],
          },
        };
      },
      async getPublishSchema(input) {
        reads.push(input.categoryId);
        if (input.categoryId === "101") throw new Error("SHEIN schema unavailable");
      },
    },
  });

  await assert.rejects(
    service.processRefreshJob({
      context: { tenantId: "tenant-1", userId: "user-1" },
      storeId: "store-1",
      jobId: "job-partial",
      scope: "all",
    }),
    (error) => error.code === "RULE_REFRESH_PARTIAL" && error.status === 503,
  );

  assert.deepEqual(reads, ["101", "102"]);
  assert.deepEqual(progress.at(-1), {
    scope: "all",
    total: 2,
    processed: 2,
    succeeded: 1,
    failed: 1,
    failedTargets: [{
      categoryId: "101",
      productTypeId: "201",
    }],
  });
  assert.equal(failures.length, 1);
  assert.deepEqual(failures[0].progress, progress.at(-1));
  assert.equal(failures[0].error.code, "RULE_REFRESH_PARTIAL");
});

test("rule refresh worker skips a database job that already ended", async () => {
  let reads = 0;
  const service = new WebRuleRefreshService({
    repository: { async markRunning() { return false; } },
    ruleReader: { async getPublishCategories() { reads += 1; } },
  });

  assert.deepEqual(await service.processRefreshJob({
    context: { tenantId: "tenant-1" },
    storeId: "store-1",
    jobId: "job-1",
  }), { skipped: true });
  assert.equal(reads, 0);
});

test("rule refresh target query is tenant scoped and deduplicates drafts and visible templates", async () => {
  let query = null;
  const repository = new PostgresRuleRefreshRepository({
    pool: {
      async query(input) { query = input; return { rows: [] }; },
    },
  });

  await repository.listTargets({ tenantId: "tenant-1", storeId: "store-1" });

  assert.deepEqual(query.values, ["tenant-1", "store-1"]);
  assert.match(query.text, /FROM product_drafts/);
  assert.match(query.text, /status <> 'archived'/);
  assert.match(query.text, /FROM publish_templates/);
  assert.match(query.text, /scope IN \('tenant', 'user'\)/);
  assert.match(query.text, /tenant_id = \$1/);
  assert.match(query.text, /store_id = \$2/);
  assert.match(query.text, /SELECT DISTINCT category_id, product_type_id/);
});

test("rule refresh failed-target lookup stays tenant and store scoped", async () => {
  let query = null;
  const repository = new PostgresRuleRefreshRepository({
    pool: {
      async query(input) {
        query = input;
        return {
          rows: [{
            job_type: "rule_refresh",
            state: "failed",
            progress: { failedTargets: [] },
          }],
        };
      },
    },
  });

  const result = await repository.getFailedTargets({
    tenantId: "tenant-1",
    storeId: "store-1",
    jobId: "job-1",
  });

  assert.deepEqual(query.values, ["job-1", "tenant-1", "store-1"]);
  assert.match(query.text, /FROM sync_jobs/);
  assert.match(query.text, /tenant_id=\$2/);
  assert.match(query.text, /store_id=\$3/);
  assert.deepEqual(result, {
    jobType: "rule_refresh",
    state: "failed",
    progress: { failedTargets: [] },
  });
});

test("rule refresh failure persists the final progress and sanitized error", async () => {
  let query = null;
  const repository = new PostgresRuleRefreshRepository({
    pool: {
      async query(input) {
        query = input;
        return { rows: [], rowCount: 1 };
      },
    },
  });

  await repository.saveFailure({
    tenantId: "tenant-1",
    storeId: "store-1",
    jobId: "job-1",
    progress: {
      scope: "all",
      total: 2,
      processed: 2,
      succeeded: 1,
      failed: 1,
    },
    error: {
      code: "RULE_REFRESH_PARTIAL",
      message: "1个类目规则同步失败",
      secretKey: "must not persist",
    },
  });

  assert.match(query.text, /progress=COALESCE\(\$4::jsonb, progress\)/);
  assert.deepEqual(query.values, [
    "job-1",
    "tenant-1",
    "store-1",
    JSON.stringify({
      scope: "all",
      total: 2,
      processed: 2,
      succeeded: 1,
      failed: 1,
    }),
    JSON.stringify({
      code: "RULE_REFRESH_PARTIAL",
      message: "1个类目规则同步失败",
    }),
  ]);
});
