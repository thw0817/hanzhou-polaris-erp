import assert from "node:assert/strict";
import test from "node:test";
import {
  ERP06_OUTBOX_JOB_CONTRACT_VERSION,
  ERP06_OUTBOX_JOB_NAME,
} from "./erp06-outbox-dispatcher-service.js";
import { ERP06_SHEIN_PUBLISH_ADAPTER_CONTRACT_VERSION } from "./erp06-shein-publish-adapter-contract.js";
import {
  Erp06PublishWorkerError,
  processErp06PublishJob,
} from "./erp06-publish-worker-service.js";

const tenantId = "11111111-1111-4111-8111-111111111111";
const storeId = "22222222-2222-4222-8222-222222222222";
const commandId = "33333333-3333-4333-8333-333333333333";
const attemptId = "44444444-4444-4444-8444-444444444444";
const versionId = "55555555-5555-4555-8555-555555555555";
const batchId = "66666666-6666-4666-8666-666666666666";
const batchItemId = "77777777-7777-4777-8777-777777777777";
const revisionId = "88888888-8888-4888-8888-888888888888";
const versionFingerprint = "version-fingerprint-1";
const claimId = "worker-1:claim-1";

function queueJob(overrides = {}) {
  return {
    id: commandId,
    name: ERP06_OUTBOX_JOB_NAME,
    data: {
      contractVersion: ERP06_OUTBOX_JOB_CONTRACT_VERSION,
      commandId,
      tenantId,
      storeId,
      publishBatchId: batchId,
      publishBatchItemId: batchItemId,
      publishAttemptId: attemptId,
      productVersionId: versionId,
      sourceDraftRevisionId: revisionId,
      versionFingerprint,
      ...overrides,
    },
  };
}

function claimedCommand(overrides = {}) {
  return {
    id: commandId,
    tenant_id: tenantId,
    store_id: storeId,
    publish_attempt_id: attemptId,
    product_version_id: versionId,
    state: "dispatching",
    worker_claim_id: claimId,
    attempt_state: "dispatched",
    payload_summary: {
      publishBatchId: batchId,
      publishBatchItemId: batchItemId,
      publishAttemptId: attemptId,
      productVersionId: versionId,
      sourceDraftRevisionId: revisionId,
      versionFingerprint,
    },
    ...overrides,
  };
}

function acceptedResult() {
  return {
    contractVersion: ERP06_SHEIN_PUBLISH_ADAPTER_CONTRACT_VERSION,
    commandId,
    publishAttemptId: attemptId,
    outcome: "accepted",
    state: "submitted",
    remoteCallMade: true,
    sendStarted: true,
    retryable: false,
    receipt: {
      success: true,
      spuName: "SPU-1",
      version: "VERSION-1",
      skcs: [{
        skcName: "SKC-1",
        skus: [{ skuCode: "SKU-1", supplierSku: "SUPPLIER-1" }],
      }],
    },
  };
}

function fakeDependencies({ command = claimedCommand(), adapterResult = acceptedResult(), failResult = null } = {}) {
  const calls = [];
  const commandRepository = {
    async claimCommand(input) {
      calls.push(["claim", input]);
      return command;
    },
    async releaseCommandDryRun(input) {
      calls.push(["release", input]);
      return { ...command, state: "queued" };
    },
  };
  const resultRepository = {
    async recordSendStarted(input) {
      calls.push(["send_started", input]);
      return { idempotent: false, eventId: "event-send-started" };
    },
    async recordPublishResult(input) {
      calls.push(["result", input]);
      if (failResult) throw new Error(failResult);
      return { idempotent: false, outcome: input.result.outcome, eventId: "event-result" };
    },
  };
  const adapterFactory = ({ onSendStarted }) => ({
    async execute(input) {
      calls.push(["adapter", input]);
      if (adapterResult.outcome !== "not_sent") {
        await onSendStarted({
          commandId,
          publishAttemptId: attemptId,
          productVersionId: versionId,
          versionFingerprint,
          path: "/open-api/goods/product/publishOrEdit",
        });
      }
      return adapterResult;
    },
  });
  return { calls, commandRepository, resultRepository, adapterFactory };
}

test("ERP-06 Worker validates the queue contract, claims one command, and persists send/result in order", async () => {
  const { calls, commandRepository, resultRepository, adapterFactory } = fakeDependencies();
  const result = await processErp06PublishJob({
    job: queueJob(),
    commandRepository,
    resultRepository,
    adapterFactory,
    sourceLoader: async (input) => {
      calls.push(["source", input]);
      return { source: "frozen" };
    },
    executionEnabled: true,
    authorizesPublishing: true,
    workerId: "worker-1",
    claimId,
  });

  assert.equal(result.state, "completed");
  assert.equal(result.outcome, "accepted");
  assert.deepEqual(calls.map(([name]) => name), ["claim", "adapter", "send_started", "result"]);
  assert.equal(calls[0][1].tenantId, tenantId);
  assert.equal(calls[1][1].authorization.claimId, claimId);
  assert.equal(calls[1][1].authorization.executionEnabled, true);
  assert.equal(calls[1][1].authorization.authorizesPublishing, true);
  assert.equal(calls[3][1].productVersionId, versionId);
  assert.deepEqual(calls[3][1].result, acceptedResult());
});

test("disabled or not-sent adapter result is released only in explicit dry-run and never recorded as a platform result", async () => {
  const { calls, commandRepository, resultRepository, adapterFactory } = fakeDependencies({
    adapterResult: {
      contractVersion: ERP06_SHEIN_PUBLISH_ADAPTER_CONTRACT_VERSION,
      commandId,
      publishAttemptId: attemptId,
      outcome: "not_sent",
      state: "not_sent",
      remoteCallMade: false,
      sendStarted: false,
      retryable: false,
      error: { code: "ERP06_DISABLED", message: "disabled" },
    },
  });
  const result = await processErp06PublishJob({
    job: queueJob(),
    commandRepository,
    resultRepository,
    adapterFactory,
    dryRun: true,
    claimId,
  });

  assert.equal(result.state, "not_sent");
  assert.equal(result.released, true);
  assert.equal(calls.map(([name]) => name).join(","), "claim,adapter,release");
  assert.equal(calls.some(([name]) => name === "send_started" || name === "result"), false);
});

test("a missing claim is a safe no-op and does not construct an adapter", async () => {
  const { commandRepository, resultRepository } = fakeDependencies();
  let factoryCalls = 0;
  const result = await processErp06PublishJob({
    job: queueJob(),
    commandRepository: {
      async claimCommand() { return null; },
    },
    resultRepository,
    adapterFactory: () => {
      factoryCalls += 1;
      return {};
    },
    claimId,
  });

  assert.equal(result.state, "not_claimed");
  assert.equal(factoryCalls, 0);
});

test("claimed command identity or scope drift fails closed before adapter execution", async () => {
  const { commandRepository, resultRepository } = fakeDependencies({
    command: claimedCommand({ product_version_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
  });
  let factoryCalls = 0;
  await assert.rejects(
    processErp06PublishJob({
      job: queueJob(),
      commandRepository,
      resultRepository,
      adapterFactory: () => {
        factoryCalls += 1;
        return {};
      },
      claimId,
    }),
    (error) => error instanceof Erp06PublishWorkerError && error.code === "ERP06_WORKER_CLAIM_IDENTITY_MISMATCH",
  );
  assert.equal(factoryCalls, 0);
});

test("result_unknown is persisted without dry-release or a retry path", async () => {
  const unknown = {
    contractVersion: ERP06_SHEIN_PUBLISH_ADAPTER_CONTRACT_VERSION,
    commandId,
    publishAttemptId: attemptId,
    outcome: "unknown",
    state: "result_unknown",
    remoteCallMade: true,
    sendStarted: true,
    retryable: false,
    error: { code: "ETIMEDOUT", message: "timeout" },
  };
  const { calls, commandRepository, resultRepository, adapterFactory } = fakeDependencies({ adapterResult: unknown });
  const result = await processErp06PublishJob({
    job: queueJob(),
    commandRepository,
    resultRepository,
    adapterFactory,
    claimId,
  });

  assert.equal(result.state, "completed");
  assert.equal(result.outcome, "unknown");
  assert.equal(calls.some(([name]) => name === "release"), false);
  assert.equal(calls.at(-1)[0], "result");
  assert.equal(calls.at(-1)[1].result.retryable, false);
});

test("a result persistence failure is surfaced and never converted into a safe retry", async () => {
  const { calls, commandRepository, resultRepository, adapterFactory } = fakeDependencies({
    failResult: "receipt write failed",
  });
  await assert.rejects(
    processErp06PublishJob({
      job: queueJob(),
      commandRepository,
      resultRepository,
      adapterFactory,
      claimId,
    }),
    /receipt write failed/,
  );
  assert.equal(calls.some(([name]) => name === "release"), false);
});

test("result_unknown and superseded claims are rejected before any adapter call", async () => {
  for (const attemptState of ["result_unknown", "superseded_by_new_attempt"]) {
    const { commandRepository, resultRepository } = fakeDependencies({
      command: claimedCommand({ attempt_state: attemptState }),
    });
    await assert.rejects(
      processErp06PublishJob({
        job: queueJob(),
        commandRepository,
        resultRepository,
        adapterFactory: () => ({ execute: async () => acceptedResult() }),
        claimId,
      }),
      (error) => error.code === "ERP06_WORKER_ATTEMPT_NOT_EXECUTABLE",
    );
  }
});
