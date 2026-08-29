import assert from "node:assert/strict";
import test from "node:test";
import { processStoreBusinessRefreshJob } from "./store-business-refresh-worker.js";

test("store business worker passes only scoped identifiers to the service", async () => {
  let received = null;
  const result = await processStoreBusinessRefreshJob({
    job: {
      name: "store-business-refresh",
      data: {
        tenantId: "tenant-1",
        storeId: "store-1",
        requestedBy: "user-1",
        jobId: "job-1",
      },
    },
    service: {
      async processRefreshJob(input) { received = input; return { state: "succeeded" }; },
    },
  });

  assert.deepEqual(received, {
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    jobId: "job-1",
  });
  assert.equal(result.state, "succeeded");
});

test("store business worker rejects malformed queue payloads", async () => {
  await assert.rejects(
    processStoreBusinessRefreshJob({
      job: { name: "store-business-refresh", data: { jobId: "job-1" } },
      service: { async processRefreshJob() {} },
    }),
    (error) => error.code === "INVALID_STORE_BUSINESS_REFRESH_JOB",
  );
});
