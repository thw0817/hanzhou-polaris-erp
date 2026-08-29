import assert from "node:assert/strict";
import test from "node:test";
import {
  PostgresSyncJobRepository,
  WebSyncJobService,
} from "./sync-job-service.js";

test("lists store-scoped sync jobs with sanitized progress and errors", async () => {
  let received = null;
  const service = new WebSyncJobService({
    repository: {
      async list(input) {
        received = input;
        return [{
          id: "job-1",
          job_type: "store_business_refresh",
          state: "failed",
          progress: {
            processed: 7,
            scope: "all",
            failedTargets: [
              { categoryId: "101", productTypeId: "201" },
              { categoryId: "102", productTypeId: "202", secret: "do-not-return" },
            ],
            secretInternalCursor: "do-not-return",
          },
          error: { code: "UPSTREAM_TIMEOUT", message: "平台超时", stack: "private" },
          requested_by: "user-1",
          requested_by_name: "地毯运营",
          started_at: "2026-08-04T00:00:00.000Z",
          completed_at: "2026-08-04T00:01:00.000Z",
          created_at: "2026-08-04T00:00:00.000Z",
          updated_at: "2026-08-04T00:01:00.000Z",
        }];
      },
    },
  });

  const result = await service.list({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    filters: { state: "failed", jobType: "store_business_refresh", limit: "20" },
  });

  assert.deepEqual(received, {
    tenantId: "tenant-1",
    storeId: "store-1",
    state: "failed",
    jobType: "store_business_refresh",
    limit: 20,
  });
  assert.deepEqual(result.jobs[0].progress, {
    processed: 7,
    scope: "all",
    failedTargets: [
      { categoryId: "101", productTypeId: "201" },
      { categoryId: "102", productTypeId: "202" },
    ],
  });
  assert.deepEqual(result.jobs[0].error, {
    code: "UPSTREAM_TIMEOUT",
    message: "平台超时",
  });
  assert.equal("cursor" in result.jobs[0], false);
  assert.equal("stack" in result.jobs[0].error, false);
  assert.equal(result.jobs[0].requestedBy.me, true);
});

test("rejects unsupported sync job filters before querying", async () => {
  let calls = 0;
  const service = new WebSyncJobService({
    repository: { async list() { calls += 1; return []; } },
  });
  const input = {
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
  };

  await assert.rejects(
    service.list({ ...input, filters: { state: "unknown" } }),
    (error) => error.code === "INVALID_SYNC_JOB_STATE" && error.status === 400,
  );
  await assert.rejects(
    service.list({ ...input, filters: { jobType: "publish_everything" } }),
    (error) => error.code === "INVALID_SYNC_JOB_TYPE" && error.status === 400,
  );
  await assert.rejects(
    service.list({ ...input, filters: { limit: "500" } }),
    (error) => error.code === "INVALID_LIMIT" && error.status === 400,
  );
  assert.equal(calls, 0);
});

test("returns one scoped sync job detail without raw item results", async () => {
  const service = new WebSyncJobService({
    repository: {
      async get() {
        return {
          job: {
            id: "job-1",
            job_type: "inventory_sync",
            state: "succeeded",
            progress: { total: 2, succeeded: 2 },
            error: null,
            requested_by: null,
            requested_by_name: null,
            started_at: "2026-08-04T00:00:00.000Z",
            completed_at: "2026-08-04T00:00:10.000Z",
            created_at: "2026-08-04T00:00:00.000Z",
            updated_at: "2026-08-04T00:00:10.000Z",
          },
          items: [{
            id: "item-1",
            item_key: "SKC-1",
            state: "succeeded",
            attempt_count: 1,
            trace_id: "trace-1",
            result: { rawPlatformPayload: "private" },
            error: null,
            started_at: "2026-08-04T00:00:00.000Z",
            completed_at: "2026-08-04T00:00:10.000Z",
          }],
        };
      },
    },
  });

  const result = await service.get({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    jobId: "job-1",
  });

  assert.equal(result.job.items[0].itemKey, "SKC-1");
  assert.equal("result" in result.job.items[0], false);
});

test("PostgreSQL sync job reads always scope tenant and store", async () => {
  const queries = [];
  const repository = new PostgresSyncJobRepository({
    pool: {
      async query(input) {
        queries.push(input);
        if (queries.length === 1) return { rows: [] };
        return { rows: [] };
      },
    },
  });

  await repository.list({
    tenantId: "tenant-1",
    storeId: "store-1",
    state: null,
    jobType: null,
    limit: 30,
  });
  await repository.get({
    tenantId: "tenant-1",
    storeId: "store-1",
    jobId: "job-1",
  });

  for (const query of queries) {
    if (!query.text.includes("sync_jobs")) continue;
    assert.match(query.text, /tenant_id = \$1/);
    assert.match(query.text, /store_id = \$2/);
  }
});
