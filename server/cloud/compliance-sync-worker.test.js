import assert from "node:assert/strict";
import test from "node:test";
import { processComplianceSyncJob } from "./compliance-sync-worker.js";

test("compliance worker passes only scoped queue identifiers", async () => {
  let received = null;
  const result = await processComplianceSyncJob({
    job: {
      name: "compliance-sync",
      data: {
        tenantId: "tenant-1",
        storeId: "store-1",
        requestedBy: "user-1",
        jobId: "job-1",
      },
    },
    service: {
      async processSyncJob(input) { received = input; return { state: "succeeded" }; },
    },
  });

  assert.deepEqual(received, {
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    jobId: "job-1",
  });
  assert.equal(result.state, "succeeded");
});

test("compliance worker rejects malformed jobs", async () => {
  await assert.rejects(
    processComplianceSyncJob({
      job: { name: "compliance-sync", data: { jobId: "job-1" } },
      service: { async processSyncJob() {} },
    }),
    (error) => error.code === "INVALID_COMPLIANCE_SYNC_JOB",
  );
});
