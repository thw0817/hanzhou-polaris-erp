import assert from "node:assert/strict";
import test from "node:test";
import {
  ERP06_OUTBOX_EVENT_TYPE,
  ERP06_OUTBOX_JOB_CONTRACT_VERSION,
  PostgresErp06OutboxRepository,
  dispatchErp06OutboxOnce,
  processErp06PublishQueueJob,
} from "./erp06-outbox-dispatcher-service.js";

const tenantId = "11111111-1111-4111-8111-111111111111";
const storeId = "22222222-2222-4222-8222-222222222222";
const commandId = "33333333-3333-4333-8333-333333333333";
const attemptId = "44444444-4444-4444-8444-444444444444";
const versionId = "55555555-5555-4555-8555-555555555555";
const batchId = "66666666-6666-4666-8666-666666666666";
const batchItemId = "77777777-7777-4777-8777-777777777777";
const revisionId = "88888888-8888-4888-8888-888888888888";

function outboxRow(overrides = {}) {
  return {
    id: "99999999-9999-4999-8999-999999999999",
    tenant_id: tenantId,
    store_id: storeId,
    publish_command_id: commandId,
    event_type: ERP06_OUTBOX_EVENT_TYPE,
    state: "pending",
    lease_id: "dispatcher-1:outbox-1:1",
    attempt_count: 1,
    payload_summary: {
      publishBatchId: batchId,
      publishBatchItemId: batchItemId,
      publishAttemptId: attemptId,
      publishCommandId: commandId,
      productVersionId: versionId,
      sourceDraftRevisionId: revisionId,
      versionFingerprint: "version-fingerprint-1",
    },
    ...overrides,
  };
}

function commandRow(overrides = {}) {
  return {
    id: commandId,
    tenant_id: tenantId,
    store_id: storeId,
    publish_attempt_id: attemptId,
    state: "queued",
    worker_claim_id: "worker-1:claim-1",
    worker_lease_expires_at: "2026-08-30T10:01:00.000Z",
    ...overrides,
  };
}

function transactionPool(queryResults) {
  const calls = [];
  const client = {
    async query(query) {
      calls.push(query);
      if (typeof query === "string") return { rows: [], rowCount: 0 };
      return queryResults.shift() || { rows: [], rowCount: 0 };
    },
    release() {},
  };
  return {
    calls,
    pool: {
      async connect() {
        return client;
      },
    },
  };
}

test("claims scoped pending and expired ERP-06 outbox rows with a lease", async () => {
  const { calls, pool } = transactionPool([{ rows: [outboxRow()], rowCount: 1 }]);
  const repository = new PostgresErp06OutboxRepository({ pool });

  const rows = await repository.claimOutbox({
    tenantId,
    storeId,
    dispatcherId: "dispatcher-1",
    limit: 10,
    leaseSeconds: 30,
    now: new Date("2026-08-30T10:00:00.000Z"),
  });

  assert.equal(rows.length, 1);
  const claimQuery = calls.find((call) => typeof call !== "string");
  assert.match(claimQuery.text, /FROM product_publish_outbox AS outbox/);
  assert.match(claimQuery.text, /FOR UPDATE OF outbox SKIP LOCKED/);
  assert.match(claimQuery.text, /outbox\.tenant_id=\$1/);
  assert.match(claimQuery.text, /outbox\.state IN \('pending', 'failed'\)/);
  assert.match(claimQuery.text, /attempt_count=outbox\.attempt_count \+ 1/);
  assert.equal(claimQuery.values[0], tenantId);
  assert.equal(claimQuery.values[1], storeId);
});

test("dispatches an ERP-06 outbox row once with deterministic minimal job data", async () => {
  const added = [];
  const marked = [];
  const repository = {
    async claimOutbox() {
      return [outboxRow()];
    },
    async markOutboxDispatched(input) {
      marked.push(input);
      return { id: "outbox-1", state: "dispatched", ...input };
    },
  };
  const queue = {
    async add(name, data, options) {
      added.push({ name, data, options });
      return { id: options.jobId };
    },
  };

  const result = await dispatchErp06OutboxOnce({
    repository,
    queue,
    tenantId,
    storeId,
    dispatcherId: "dispatcher-1",
  });

  assert.deepEqual(result, { claimed: 1, dispatched: 1, failed: 0 });
  assert.equal(added.length, 1);
  assert.deepEqual(added[0], {
    name: "erp06-publish-command",
    data: {
      commandId,
      tenantId,
      storeId,
      contractVersion: ERP06_OUTBOX_JOB_CONTRACT_VERSION,
      publishBatchId: batchId,
      publishBatchItemId: batchItemId,
      publishAttemptId: attemptId,
      productVersionId: versionId,
      sourceDraftRevisionId: revisionId,
      versionFingerprint: "version-fingerprint-1",
    },
    options: {
      jobId: commandId,
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: true,
    },
  });
  assert.deepEqual(marked, [{
    tenantId,
    storeId,
    outboxId: outboxRow().id,
    leaseId: outboxRow().lease_id,
    queueJobId: commandId,
  }]);
  assert.doesNotMatch(JSON.stringify(added), /secret|token|password|requestBody|imageUrl/i);
});

test("queue failure marks only the leased ERP-06 outbox row failed", async () => {
  const failures = [];
  const repository = {
    async claimOutbox() {
      return [outboxRow({ attempt_count: 2 })];
    },
    async markOutboxFailure(input) {
      failures.push(input);
      return { state: "failed", ...input };
    },
  };
  const queue = {
    async add() {
      throw Object.assign(new Error("local queue unavailable"), { code: "QUEUE_DOWN" });
    },
  };

  const result = await dispatchErp06OutboxOnce({
    repository,
    queue,
    tenantId,
    storeId,
    now: () => new Date("2026-08-30T10:00:00.000Z"),
  });

  assert.deepEqual(result, { claimed: 1, dispatched: 0, failed: 1 });
  assert.equal(failures.length, 1);
  assert.equal(failures[0].tenantId, tenantId);
  assert.equal(failures[0].storeId, storeId);
  assert.equal(failures[0].outboxId, outboxRow().id);
  assert.equal(failures[0].leaseId, outboxRow().lease_id);
  assert.equal(failures[0].error.code, "QUEUE_DOWN");
});

test("worker dry-run claims a dispatched command, performs no remote call, and releases its lease", async () => {
  const calls = [];
  const repository = {
    async claimCommand(input) {
      calls.push({ type: "claim", input });
      return commandRow();
    },
    async releaseCommandDryRun(input) {
      calls.push({ type: "release", input });
      return { ...commandRow(), state: "queued", worker_claim_id: null, worker_lease_expires_at: null };
    },
  };

  const result = await processErp06PublishQueueJob({
    job: {
      name: "erp06-publish-command",
      data: {
        commandId,
        tenantId,
        storeId,
        contractVersion: ERP06_OUTBOX_JOB_CONTRACT_VERSION,
        publishBatchId: batchId,
        publishBatchItemId: batchItemId,
        publishAttemptId: attemptId,
        productVersionId: versionId,
        sourceDraftRevisionId: revisionId,
        versionFingerprint: "version-fingerprint-1",
      },
    },
    repository,
    workerId: "worker-1",
    randomId: () => "claim-1",
    now: () => new Date("2026-08-30T10:00:00.000Z"),
  });

  assert.equal(result.claimed, true);
  assert.equal(result.remoteCallMade, false);
  assert.equal(result.commandState, "queued");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].input.commandId, commandId);
  assert.equal(calls[0].input.workerId, "worker-1");
  assert.equal(calls[0].input.claimId, "claim-1");
  assert.equal(calls[1].input.claimId, "claim-1");
});

test("worker rejects a result_unknown attempt before claiming it", async () => {
  let claimCalled = false;
  const repository = {
    async claimCommand() {
      claimCalled = true;
      return null;
    },
    async releaseCommandDryRun() {
      throw new Error("must not release an unclaimed command");
    },
  };

  const result = await processErp06PublishQueueJob({
    job: {
      name: "erp06-publish-command",
      data: {
        commandId,
        tenantId,
        storeId,
        contractVersion: ERP06_OUTBOX_JOB_CONTRACT_VERSION,
        publishBatchId: batchId,
        publishBatchItemId: batchItemId,
        publishAttemptId: attemptId,
        productVersionId: versionId,
        sourceDraftRevisionId: revisionId,
        versionFingerprint: "version-fingerprint-1",
      },
    },
    repository,
  });

  assert.equal(result.claimed, false);
  assert.equal(result.remoteCallMade, false);
  assert.equal(claimCalled, true);
});

test("worker rejects a queue job whose scope does not match the command identity", async () => {
  let claimCalled = false;
  const repository = {
    async claimCommand() {
      claimCalled = true;
      return commandRow({ tenant_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
    },
    async releaseCommandDryRun() {
      throw new Error("must not release a mismatched command");
    },
  };

  await assert.rejects(
    () => processErp06PublishQueueJob({
      job: {
        name: "erp06-publish-command",
        data: {
          commandId,
          tenantId,
          storeId,
          contractVersion: ERP06_OUTBOX_JOB_CONTRACT_VERSION,
          publishBatchId: batchId,
          publishBatchItemId: batchItemId,
          publishAttemptId: attemptId,
          productVersionId: versionId,
          sourceDraftRevisionId: revisionId,
          versionFingerprint: "version-fingerprint-1",
        },
      },
      repository,
    }),
    (error) => error.code === "ERP06_WORKER_COMMAND_SCOPE_MISMATCH",
  );
  assert.equal(claimCalled, true);
});
