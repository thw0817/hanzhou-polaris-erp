import assert from "node:assert/strict";
import test from "node:test";
import {
  PostgresSyncJobRepository,
  WebSyncJobService,
} from "./sync-job-service.js";

test("SRF-04 reconciles stale store-business refresh jobs before task reads", async () => {
  let query = null;
  const repository = new PostgresSyncJobRepository({
    pool: {
      async query(input) {
        query = input;
        return { rowCount: 0, rows: [] };
      },
    },
  });

  await repository.reconcileStale({
    tenantId: "tenant-1",
    storeId: "store-1",
    now: new Date("2026-08-27T00:00:00.000Z"),
  });

  assert.match(query.text, /store_business_refresh/);
  assert.match(query.text, /SYNC_JOB_TIMEOUT/);
});

test("SRF-04 allows filtering completed-with-errors terminal jobs", async () => {
  let received = null;
  const service = new WebSyncJobService({
    repository: {
      async list(input) {
        received = input;
        return [];
      },
    },
  });

  const result = await service.list({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    filters: { state: "completed_with_errors" },
  });

  assert.deepEqual(result, { jobs: [], count: 0 });
  assert.equal(received.state, "completed_with_errors");
});
