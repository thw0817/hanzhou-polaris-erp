import assert from "node:assert/strict";
import test from "node:test";
import {
  productPublishCandidateFingerprint,
} from "./product-publish-candidate.js";
import {
  productRemotePublishCandidateFingerprint,
} from "./product-remote-preflight.js";
import { PRODUCT_PUBLISH_JOB_NAME } from "./job-queue.js";
import { processProductPublishRun } from "./product-publish-worker.js";

function candidates() {
  const sourceSnapshot = {
    state: "ready_for_remote_preflight",
    requestBody: {
      category_id: "3155",
      skc_list: [{
        supplier_code: "RUG-001",
        sku_list: [{ supplier_sku: "RUG-001-40X60" }],
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

test("product publish worker rejects queue messages without scoped run identifiers", async () => {
  await assert.rejects(
    processProductPublishRun({
      job: { name: PRODUCT_PUBLISH_JOB_NAME, data: {} },
      repository: {},
      executor: {},
    }),
    /队列消息无效/,
  );
});

test("product publish worker rejects an unknown Outbox queue contract", async () => {
  await assert.rejects(
    processProductPublishRun({
      job: {
        name: PRODUCT_PUBLISH_JOB_NAME,
        data: {
          commandId: "job-1",
          tenantId: "tenant-1",
          storeId: "store-1",
          contractVersion: "unknown",
        },
      },
      repository: {},
      executor: {},
    }),
    /队列消息无效/,
  );
});

test("product publish worker processes only the command named by an Outbox queue message", async () => {
  const { source, remote } = candidates();
  const calls = [];
  const repository = {
    async markExpiredClaimsUnknown(input) {
      calls.push(["expire", input]);
      return [];
    },
    async claimNextJob(input) {
      calls.push(["claim", input]);
      return {
        id: "job-1",
        execution_run_id: "run-1",
        claim_id: input.claimId,
        source_candidate_fingerprint: source.fingerprint,
        remote_candidate_fingerprint: remote.fingerprint,
      };
    },
    async loadClaimedExecutionSource(input) {
      calls.push(["load", input]);
      return {
        job: { id: "job-1" },
        currentSourceCandidate: source,
        remoteCandidate: remote,
      };
    },
    async recordSubmitted(input) {
      calls.push(["submitted", input]);
      return { id: "job-1", state: "submitted" };
    },
  };
  const executor = {
    async execute(input) {
      calls.push(["execute", input]);
      return { outcome: "accepted", receipt: { version: "VERSION-1" } };
    },
  };

  const result = await processProductPublishRun({
    job: {
      name: PRODUCT_PUBLISH_JOB_NAME,
      data: {
        commandId: "job-1",
        tenantId: "tenant-1",
        storeId: "store-1",
        contractVersion: "publish-command-v1",
      },
    },
    repository,
    executor,
    randomId: () => "claim-1",
  });

  assert.equal(result.submittedCount, 1);
  assert.equal(calls[0][1].jobId, "job-1");
  assert.equal(calls[1][1].commandId, "job-1");
  assert.equal(calls[2][1].executionRunId, "run-1");
  assert.equal(calls.filter(([name]) => name === "settle").length, 0);
});

test("product publish worker executes a verified frozen candidate once and persists submission", async () => {
  const { source, remote } = candidates();
  const calls = [];
  let claimCount = 0;
  const repository = {
    async markExpiredClaimsUnknown(input) {
      calls.push(["expire", input]);
      return [];
    },
    async claimNextJob(input) {
      calls.push(["claim", input]);
      claimCount += 1;
      if (claimCount > 1) return null;
      return {
        id: "job-1",
        tenant_id: "tenant-1",
        store_id: "store-1",
        state: "claimed",
        claim_id: input.claimId,
        executionEnabled: true,
        authorizesPublishing: true,
        source_candidate_fingerprint: source.fingerprint,
        remote_candidate_fingerprint: remote.fingerprint,
      };
    },
    async loadClaimedExecutionSource(input) {
      calls.push(["load", input]);
      return {
        job: {
          id: "job-1",
          tenant_id: "tenant-1",
          store_id: "store-1",
          state: "claimed",
          claim_id: input.claimId,
          executionEnabled: true,
          authorizesPublishing: true,
          source_candidate_fingerprint: source.fingerprint,
          remote_candidate_fingerprint: remote.fingerprint,
        },
        currentSourceCandidate: source,
        remoteCandidate: remote,
      };
    },
    async recordSubmitted(input) {
      calls.push(["submitted", input]);
      return { id: "job-1", state: "submitted" };
    },
    async settleExecutionRun(input) {
      calls.push(["settle", input]);
      return { id: "run-1", state: "running", executionEnabled: false };
    },
  };
  const executor = {
    async execute(input) {
      calls.push(["execute", input]);
      return {
        outcome: "accepted",
        retryable: false,
        receipt: {
          spuName: "SPU-1",
          version: "VERSION-1",
          traceId: "TRACE-1",
        },
      };
    },
  };

  const result = await processProductPublishRun({
    job: {
      name: PRODUCT_PUBLISH_JOB_NAME,
      data: {
        tenantId: "tenant-1",
        storeId: "store-1",
        executionRunId: "run-1",
      },
    },
    repository,
    executor,
    randomId: () => "claim-1",
    now: () => new Date("2026-08-22T01:00:00.000Z"),
  });

  assert.equal(result.submittedCount, 1);
  assert.equal(calls.filter(([name]) => name === "execute").length, 1);
  assert.equal(calls.filter(([name]) => name === "submitted").length, 1);
  assert.deepEqual(
    calls.filter(([name]) => name === "claim").at(-1)[1].excludedJobIds,
    ["job-1"],
  );
  assert.equal(calls.filter(([name]) => name === "settle").length, 1);
});

test("product publish worker records an unknown result without retrying the same request", async () => {
  const { source, remote } = candidates();
  let claimCount = 0;
  let executeCount = 0;
  let failure = null;
  const repository = {
    async markExpiredClaimsUnknown() { return []; },
    async claimNextJob(input) {
      claimCount += 1;
      if (claimCount > 1) {
        assert.deepEqual(input.excludedJobIds, ["job-1"]);
        return null;
      }
      return {
        id: "job-1",
        source_candidate_fingerprint: source.fingerprint,
        remote_candidate_fingerprint: remote.fingerprint,
      };
    },
    async loadClaimedExecutionSource(input) {
      return {
        job: {
          id: "job-1",
          tenant_id: "tenant-1",
          store_id: "store-1",
          state: "claimed",
          claim_id: input.claimId,
          executionEnabled: true,
          authorizesPublishing: true,
          source_candidate_fingerprint: source.fingerprint,
          remote_candidate_fingerprint: remote.fingerprint,
        },
        currentSourceCandidate: source,
        remoteCandidate: remote,
      };
    },
    async recordExecutionFailure(input) { failure = input; },
    async settleExecutionRun() {
      return { id: "run-1", state: "running", executionEnabled: false };
    },
  };
  const executor = {
    async execute() {
      executeCount += 1;
      return {
        outcome: "unknown",
        retryable: false,
        error: { message: "连接中断" },
      };
    },
  };

  const result = await processProductPublishRun({
    job: {
      name: PRODUCT_PUBLISH_JOB_NAME,
      data: {
        tenantId: "tenant-1",
        storeId: "store-1",
        executionRunId: "run-1",
      },
    },
    repository,
    executor,
    randomId: () => "claim-1",
  });

  assert.equal(executeCount, 1);
  assert.equal(result.unknownCount, 1);
  assert.equal(failure.outcome, "unknown");
  assert.equal(failure.retryable, false);
});
