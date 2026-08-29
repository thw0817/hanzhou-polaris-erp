import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRuleRefreshWorkerOptions,
  processRuleRefreshJob,
  RULE_REFRESH_WORKER_LOCK_DURATION_MS,
  RULE_REFRESH_WORKER_LOCK_RENEW_TIME_MS,
  RULE_REFRESH_WORKER_STALLED_INTERVAL_MS,
} from "./rule-refresh-worker.js";

test("rule refresh worker keeps long SHEIN reads from being marked stalled", () => {
  const options = buildRuleRefreshWorkerOptions({ concurrency: 1 });
  assert.equal(options.concurrency, 1);
  assert.equal(options.lockDuration, RULE_REFRESH_WORKER_LOCK_DURATION_MS);
  assert.equal(options.lockRenewTime, RULE_REFRESH_WORKER_LOCK_RENEW_TIME_MS);
  assert.equal(options.stalledInterval, RULE_REFRESH_WORKER_STALLED_INTERVAL_MS);
  assert.ok(options.lockDuration > options.lockRenewTime);
});

test("rule refresh worker passes only scoped queue identifiers", async () => {
  let received = null;
  const result = await processRuleRefreshJob({
    job: {
      name: "rule-refresh",
      data: {
        tenantId: "tenant-1",
        storeId: "store-1",
        requestedBy: "user-1",
        jobId: "job-1",
        scope: "all",
      },
    },
    service: {
      async processRefreshJob(input) { received = input; return { state: "succeeded" }; },
    },
  });

  assert.deepEqual(received, {
    context: { tenantId: "tenant-1", userId: "user-1", role: "admin" },
    storeId: "store-1",
    jobId: "job-1",
    scope: "all",
  });
  assert.equal(result.state, "succeeded");
});

test("rule refresh worker forwards server-owned retry targets", async () => {
  let received = null;
  await processRuleRefreshJob({
    job: {
      name: "rule-refresh",
      data: {
        tenantId: "tenant-1",
        storeId: "store-1",
        jobId: "job-retry",
        scope: "all",
        retryTargets: [
          { category_id: "101", product_type_id: "201" },
        ],
      },
    },
    service: {
      async processRefreshJob(input) {
        received = input;
        return { state: "succeeded" };
      },
    },
  });

  assert.deepEqual(received.retryTargets, [
    { category_id: "101", product_type_id: "201" },
  ]);
});

test("rule refresh worker rejects malformed jobs", async () => {
  await assert.rejects(
    processRuleRefreshJob({
      job: { name: "rule-refresh", data: { jobId: "job-1" } },
      service: { async processRefreshJob() {} },
    }),
    (error) => error.code === "INVALID_RULE_REFRESH_JOB",
  );
  await assert.rejects(
    processRuleRefreshJob({
      job: {
        name: "rule-refresh",
        data: {
          tenantId: "tenant-1",
          storeId: "store-1",
          jobId: "job-1",
          retryTargets: "not-an-array",
        },
      },
      service: { async processRefreshJob() {} },
    }),
    (error) => error.code === "INVALID_RULE_REFRESH_JOB",
  );
});
