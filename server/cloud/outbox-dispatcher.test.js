import assert from "node:assert/strict";
import test from "node:test";
import {
  OUTBOX_EVENT_TYPE,
  OUTBOX_JOB_CONTRACT_VERSION,
  PostgresPublishOutboxRepository,
  createPublishOutboxEvents,
  dispatchOutboxOnce,
} from "./outbox-dispatcher.js";

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

test("claims pending and expired outbox rows with SKIP LOCKED and a lease", async () => {
  const { calls, pool } = transactionPool([{
    rows: [{
      id: "event-1",
      tenant_id: "tenant-1",
      store_id: "store-1",
      publish_job_id: "job-1",
      payload: {
        commandId: "job-1",
        tenantId: "tenant-1",
        storeId: "store-1",
        contractVersion: OUTBOX_JOB_CONTRACT_VERSION,
      },
      lease_id: "dispatcher-1:event-1",
      dispatch_attempts: 1,
    }],
    rowCount: 1,
  }]);
  const repository = new PostgresPublishOutboxRepository({ pool });

  const events = await repository.claimPending({
    dispatcherId: "dispatcher-1",
    limit: 10,
    now: new Date("2026-08-29T08:00:00.000Z"),
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].publish_job_id, "job-1");
  const claimQuery = calls.find((call) => typeof call !== "string");
  assert.match(claimQuery.text, /FOR UPDATE OF outbox SKIP LOCKED/);
  assert.match(claimQuery.text, /state = 'dispatching'/);
  assert.match(claimQuery.text, /lease_expires_at/);
  assert.equal(claimQuery.values[0], "dispatcher-1");
});

test("dispatches one deterministic queue job per command and marks the outbox only after add succeeds", async () => {
  const added = [];
  const marked = [];
  const repository = {
    async claimPending() {
      return [{
        id: "event-1",
        tenant_id: "tenant-1",
        store_id: "store-1",
        publish_job_id: "job-1",
        event_type: OUTBOX_EVENT_TYPE,
        lease_id: "lease-1",
        dispatch_attempts: 1,
        payload: {
          commandId: "job-1",
          tenantId: "tenant-1",
          storeId: "store-1",
          contractVersion: OUTBOX_JOB_CONTRACT_VERSION,
        },
      }];
    },
    async markDispatched(input) {
      marked.push(input);
      return input;
    },
  };
  const queue = {
    async add(name, data, options) {
      added.push({ name, data, options });
      return { id: options.jobId };
    },
  };

  const result = await dispatchOutboxOnce({
    repository,
    queue,
    dispatcherId: "dispatcher-1",
  });

  assert.deepEqual(result, { claimed: 1, dispatched: 1, failed: 0 });
  assert.deepEqual(added, [{
    name: "product-publish-run",
    data: {
      commandId: "job-1",
      tenantId: "tenant-1",
      storeId: "store-1",
      contractVersion: OUTBOX_JOB_CONTRACT_VERSION,
    },
    options: {
      jobId: "job-1",
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: true,
    },
  }]);
  assert.deepEqual(marked, [{
    eventId: "event-1",
    leaseId: "lease-1",
    queueJobId: "job-1",
  }]);
});

test("queue failure leaves the outbox retryable and never reports a dispatched command", async () => {
  const failures = [];
  const repository = {
    async claimPending() {
      return [{
        id: "event-1",
        tenant_id: "tenant-1",
        store_id: "store-1",
        publish_job_id: "job-1",
        event_type: OUTBOX_EVENT_TYPE,
        lease_id: "lease-1",
        dispatch_attempts: 2,
        payload: {
          commandId: "job-1",
          tenantId: "tenant-1",
          storeId: "store-1",
          contractVersion: OUTBOX_JOB_CONTRACT_VERSION,
        },
      }];
    },
    async markDispatchFailure(input) {
      failures.push(input);
      return input;
    },
  };
  const queue = {
    async add() {
      throw Object.assign(new Error("Redis unavailable"), {
        code: "ECONNREFUSED",
      });
    },
  };

  const result = await dispatchOutboxOnce({ repository, queue });

  assert.deepEqual(result, { claimed: 1, dispatched: 0, failed: 1 });
  assert.equal(failures.length, 1);
  assert.equal(failures[0].eventId, "event-1");
  assert.equal(failures[0].leaseId, "lease-1");
  assert.match(failures[0].error.message, /Redis unavailable/);
});

test("rejects an Outbox event without the exact contract version", async () => {
  const failures = [];
  const repository = {
    async claimPending() {
      return [{
        id: "event-1",
        tenant_id: "tenant-1",
        store_id: "store-1",
        publish_job_id: "job-1",
        event_type: OUTBOX_EVENT_TYPE,
        lease_id: "lease-1",
        dispatch_attempts: 1,
        payload: {
          commandId: "job-1",
          tenantId: "tenant-1",
          storeId: "store-1",
        },
      }];
    },
    async markDispatchFailure(input) {
      failures.push(input);
      return input;
    },
  };

  const result = await dispatchOutboxOnce({
    repository,
    queue: { async add() { throw new Error("must not enqueue"); } },
  });

  assert.deepEqual(result, { claimed: 1, dispatched: 0, failed: 1 });
  assert.equal(failures[0].error.code, "OUTBOX_CONTRACT_UNSUPPORTED");
});

test("creates one minimal publish outbox event per durable command", async () => {
  const calls = [];
  const client = {
    async query(query) {
      calls.push(query);
      return {
        rows: [{ id: "event-1", publish_job_id: "job-1" }],
        rowCount: 1,
      };
    },
  };

  const result = await createPublishOutboxEvents({
    client,
    tenantId: "tenant-1",
    storeId: "store-1",
    executionRunId: "run-1",
    availableAt: new Date("2026-08-29T08:00:00.000Z"),
  });

  assert.deepEqual(result, [{ id: "event-1", publish_job_id: "job-1" }]);
  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /INSERT INTO publish_outbox_events/);
  assert.match(calls[0].text, /ON CONFLICT.*DO NOTHING/s);
  assert.match(calls[0].text, /job\.state IN \('authorized', 'failed_retryable'\)/);
  assert.match(calls[0].text, /jsonb_build_object/);
  assert.doesNotMatch(calls[0].text, /request_body|image_url|secret|signature/i);
  assert.deepEqual(calls[0].values.slice(0, 3), [
    "tenant-1",
    "store-1",
    "run-1",
  ]);
  assert.equal(calls[0].values[3], OUTBOX_EVENT_TYPE);
});
