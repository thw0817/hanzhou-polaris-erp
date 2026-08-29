import assert from "node:assert/strict";
import test from "node:test";

import {
  Erp06PublishHandoffError,
  PostgresErp06PublishHandoffRepository,
} from "./erp06-publish-handoff-service.js";

const tenantId = "11111111-1111-4111-8111-111111111111";
const storeId = "22222222-2222-4222-8222-222222222222";
const draftId = "33333333-3333-4333-8333-333333333333";
const catalogProductId = "44444444-4444-4444-8444-444444444444";
const userId = "55555555-5555-4555-8555-555555555555";
const revisionId = "77777777-7777-4777-8777-777777777777";
const versionId = "88888888-8888-4888-8888-888888888888";
const attemptId = "99999999-9999-4999-8999-999999999999";
const commandId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const outboxId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const otherDraftId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function draft(overrides = {}) {
  return {
    id: draftId,
    tenant_id: tenantId,
    store_id: storeId,
    catalog_product_id: catalogProductId,
    status: "ready",
    lock_version: 0,
    editing_status: "ready",
    ...overrides,
  };
}

function version(overrides = {}) {
  return {
    id: versionId,
    tenant_id: tenantId,
    store_id: storeId,
    catalog_product_id: catalogProductId,
    source_draft_revision_id: revisionId,
    source_product_draft_id: draftId,
    source_catalog_product_id: catalogProductId,
    source_revision_no: 1,
    version_no: 1,
    schema_version: "erp06.v1",
    version_fingerprint: "version-fingerprint",
    ...overrides,
  };
}

function attempt(overrides = {}) {
  return {
    id: attemptId,
    tenant_id: tenantId,
    store_id: storeId,
    product_version_id: versionId,
    attempt_no: 1,
    request_key: "publish-request-1",
    reason: "initial_publish",
    state: "created",
    ...overrides,
  };
}

function command(overrides = {}) {
  return {
    id: commandId,
    tenant_id: tenantId,
    store_id: storeId,
    publish_attempt_id: attemptId,
    request_key: "publish-request-1:command",
    command_fingerprint: "command-fingerprint",
    capability: "product.publish",
    state: "queued",
    ...overrides,
  };
}

function outbox(overrides = {}) {
  return {
    id: outboxId,
    tenant_id: tenantId,
    store_id: storeId,
    publish_command_id: commandId,
    dedupe_key: "publish-request-1:command:outbox",
    state: "pending",
    ...overrides,
  };
}

class FakeClient {
  constructor({ failOn = "", existingAttempt = null } = {}) {
    this.failOn = failOn;
    this.calls = [];
    this.committed = false;
    this.rolledBack = false;
    this.draftRow = draft();
    this.versionRow = version();
    this.productRow = {
      id: catalogProductId,
      tenant_id: tenantId,
      store_id: storeId,
      current_version_id: null,
      current_attempt_id: null,
    };
    this.attempts = existingAttempt ? [existingAttempt] : [];
    this.commands = existingAttempt ? [command()] : [];
    this.outboxes = existingAttempt ? [outbox()] : [];
    this.events = [];
  }

  async query(input) {
    const sql = typeof input === "string" ? input : input.text;
    this.calls.push({ sql, input });
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
      if (sql === "COMMIT") this.committed = true;
      if (sql === "ROLLBACK") this.rolledBack = true;
      return { rows: [], rowCount: 0 };
    }
    if (this.failOn && sql.includes(this.failOn)) {
      throw new Error(`forced failure: ${this.failOn}`);
    }

    if (sql.includes("FROM publish_attempts") && sql.includes("request_key=$3")) {
      const requestKey = input.values[2];
      return {
        rows: this.attempts.filter((row) => row.request_key === requestKey),
        rowCount: this.attempts.filter((row) => row.request_key === requestKey).length,
      };
    }
    if (sql.includes("FROM publish_commands") && sql.includes("publish_attempt_id=$3")) {
      const row = this.commands.find((item) => item.publish_attempt_id === input.values[2]);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (sql.includes("FROM product_publish_outbox") && sql.includes("publish_command_id=$3")) {
      const row = this.outboxes.find((item) => item.publish_command_id === input.values[2]);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (sql.includes("SELECT catalog_product_id") && sql.includes("FROM product_versions")) {
      return { rows: [this.versionRow], rowCount: 1 };
    }
    if (sql.includes("SELECT current_version_id, current_attempt_id")) {
      return { rows: [this.productRow], rowCount: 1 };
    }
    if (sql.includes("SELECT editing_status, lock_version")) {
      return { rows: [this.draftRow], rowCount: 1 };
    }
    if (sql.includes("FROM product_drafts") && sql.includes("FOR UPDATE")) {
      return { rows: [this.draftRow], rowCount: 1 };
    }
    if (sql.includes("JOIN draft_revisions")) {
      return { rows: [this.versionRow], rowCount: 1 };
    }
    if (sql.includes("FROM catalog_products") && sql.includes("FOR UPDATE")) {
      return { rows: [this.productRow], rowCount: 1 };
    }
    if (
      sql.includes("FROM publish_attempts") &&
      sql.includes("product_version_id=$3") &&
      !sql.includes("MAX(attempt_no)")
    ) {
      return { rows: this.attempts.slice(-1), rowCount: this.attempts.length ? 1 : 0 };
    }
    if (sql.includes("MAX(attempt_no)")) {
      return { rows: [{ attempt_no: this.attempts.length ? 2 : 1 }], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO publish_attempts")) {
      const row = attempt({
        id: attemptId,
        request_key: input.values[4],
        product_version_id: input.values[2],
        attempt_no: input.values[3],
        reason: input.values[5],
      });
      this.attempts.push(row);
      return { rows: [row], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO publish_commands")) {
      const row = command({
        id: commandId,
        publish_attempt_id: input.values[2],
        request_key: input.values[3],
        command_fingerprint: input.values[4],
        capability: input.values[5],
      });
      this.commands.push(row);
      return { rows: [row], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO product_publish_outbox")) {
      const row = outbox({
        id: outboxId,
        publish_command_id: input.values[2],
        dedupe_key: input.values[3],
      });
      this.outboxes.push(row);
      return { rows: [row], rowCount: 1 };
    }
    if (sql.includes("UPDATE catalog_products")) {
      this.productRow.current_version_id = input.values[0];
      this.productRow.current_attempt_id = input.values[1];
      return { rows: [{ ...this.productRow }], rowCount: 1 };
    }
    if (sql.includes("UPDATE product_drafts")) {
      this.draftRow.editing_status = "handed_off";
      this.draftRow.lock_version += 1;
      return {
        rows: [{
          editing_status: this.draftRow.editing_status,
          lock_version: this.draftRow.lock_version,
        }],
        rowCount: 1,
      };
    }
    if (sql.includes("MAX(event_version)")) {
      return { rows: [{ event_version: 1 }], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO product_events")) {
      this.events.push(input.values);
      return { rows: [{ id: `event-${this.events.length}` }], rowCount: 1 };
    }
    throw new Error(`unhandled fake SQL: ${sql}`);
  }

  release() {}
}

class FakePool {
  constructor(options = {}) {
    this.client = new FakeClient(options);
  }

  async connect() {
    return this.client;
  }
}

async function handoff(pool, overrides = {}) {
  const repository = new PostgresErp06PublishHandoffRepository({ pool });
  return repository.createPublishHandoff({
    tenantId,
    storeId,
    draftId,
    productVersionId: versionId,
    expectedLockVersion: 0,
    requestKey: "publish-request-1",
    userId,
    ...overrides,
  });
}

test("creates one durable attempt, command, outbox, projection, and handoff event set atomically", async () => {
  const pool = new FakePool();
  const result = await handoff(pool);

  assert.equal(result.idempotent, false);
  assert.equal(result.stage, "queued_for_dispatch");
  assert.equal(result.publishAttemptId, attemptId);
  assert.equal(result.publishCommandId, commandId);
  assert.equal(result.publishOutboxId, outboxId);
  assert.equal(result.attemptState, "created");
  assert.equal(result.commandState, "queued");
  assert.equal(result.outboxState, "pending");
  assert.equal(result.currentVersionId, versionId);
  assert.equal(result.currentAttemptId, attemptId);
  assert.equal(result.draftEditingStatus, "handed_off");
  assert.equal(result.draftLockVersion, 1);
  assert.equal(result.remoteCallMade, false);
  assert.equal(pool.client.committed, true);
  assert.equal(pool.client.events.length, 4);
});

test("same requestKey returns the completed handoff idempotently even after lockVersion changed", async () => {
  const pool = new FakePool();
  const first = await handoff(pool);
  const callCountAfterFirst = pool.client.calls.length;
  const repeat = await handoff(pool, { expectedLockVersion: 0 });

  assert.equal(repeat.idempotent, true);
  assert.equal(repeat.publishAttemptId, first.publishAttemptId);
  assert.equal(repeat.publishCommandId, first.publishCommandId);
  assert.equal(repeat.publishOutboxId, first.publishOutboxId);
  assert.equal(repeat.draftLockVersion, 1);
  assert.equal(pool.client.attempts.length, 1);
  assert.equal(pool.client.commands.length, 1);
  assert.equal(pool.client.outboxes.length, 1);
  assert.equal(
    pool.client.calls.slice(callCountAfterFirst).some(({ sql }) => sql.includes("INSERT INTO")),
    false,
  );
});

test("requestKey cannot be reused for another ProductVersion", async () => {
  const pool = new FakePool({
    existingAttempt: attempt({
      product_version_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    }),
  });
  await assert.rejects(
    () => handoff(pool),
    (error) => {
      assert(error instanceof Erp06PublishHandoffError);
      assert.equal(error.code, "REQUEST_KEY_REUSE_CONFLICT");
      assert.equal(error.status, 409);
      return true;
    },
  );
  assert.equal(pool.client.committed, false);
  assert.equal(pool.client.rolledBack, true);
});

test("same requestKey cannot idempotently cross into another source draft", async () => {
  const pool = new FakePool({ existingAttempt: attempt() });
  await assert.rejects(
    () => handoff(pool, { draftId: otherDraftId }),
    (error) => {
      assert(error instanceof Erp06PublishHandoffError);
      assert.equal(error.code, "VERSION_DRAFT_MISMATCH");
      assert.equal(error.status, 409);
      return true;
    },
  );
  assert.equal(pool.client.committed, false);
  assert.equal(pool.client.rolledBack, true);
});

test("a ProductVersion with any existing attempt cannot be resent with a new requestKey", async () => {
  const pool = new FakePool({ existingAttempt: attempt() });
  await assert.rejects(
    () => handoff(pool, { requestKey: "publish-request-2" }),
    (error) => {
      assert(error instanceof Erp06PublishHandoffError);
      assert.equal(error.code, "PRODUCT_VERSION_ATTEMPT_ALREADY_EXISTS");
      assert.equal(error.status, 409);
      return true;
    },
  );
  assert.equal(pool.client.calls.some(({ sql }) => sql.includes("INSERT INTO publish_attempts")), false);
});

test("result_unknown remains idempotent for its original request and cannot create a resend", async () => {
  const pool = new FakePool();
  const first = await handoff(pool);
  pool.client.attempts[0].state = "result_unknown";
  pool.client.commands[0].state = "result_unknown";

  const repeat = await handoff(pool);
  assert.equal(repeat.idempotent, true);
  assert.equal(repeat.attemptState, "result_unknown");
  await assert.rejects(
    () => handoff(pool, {
      requestKey: "publish-request-unknown-resend",
      expectedLockVersion: 1,
    }),
    (error) => {
      assert.equal(error.code, "PRODUCT_VERSION_ATTEMPT_ALREADY_EXISTS");
      return true;
    },
  );
  assert.equal(pool.client.attempts.length, 1);
  assert.equal(first.publishAttemptId, attemptId);
});

test("stale draft lock fails before any publish fact is inserted", async () => {
  const pool = new FakePool();
  pool.client.draftRow.lock_version = 3;
  await assert.rejects(
    () => handoff(pool),
    (error) => {
      assert(error instanceof Erp06PublishHandoffError);
      assert.equal(error.code, "DRAFT_VERSION_CONFLICT");
      assert.equal(error.status, 409);
      return true;
    },
  );
  assert.equal(pool.client.committed, false);
  assert.equal(pool.client.rolledBack, true);
  assert.equal(pool.client.attempts.length, 0);
});

test("failure while building the outbox rolls the whole handoff back", async () => {
  const pool = new FakePool({ failOn: "INSERT INTO product_publish_outbox" });
  await assert.rejects(() => handoff(pool), /forced failure/);
  assert.equal(pool.client.committed, false);
  assert.equal(pool.client.rolledBack, true);
  assert.equal(pool.client.events.length, 0);
});

test("command and event payloads contain only identifiers and fingerprints, never raw snapshot credentials", async () => {
  const pool = new FakePool();
  pool.client.versionRow.version_fingerprint = "safe-fingerprint";
  pool.client.versionRow.product_snapshot = { secretKey: "must-not-persist" };
  await handoff(pool);

  const commandInsert = pool.client.calls.find(({ sql }) => sql.includes("INSERT INTO publish_commands"));
  const outboxInsert = pool.client.calls.find(({ sql }) => sql.includes("INSERT INTO product_publish_outbox"));
  assert(commandInsert);
  assert(outboxInsert);
  assert.doesNotMatch(JSON.stringify(commandInsert.input.values), /must-not-persist/);
  assert.doesNotMatch(JSON.stringify(outboxInsert.input.values), /must-not-persist/);
  for (const event of pool.client.events) {
    assert.doesNotMatch(JSON.stringify(event), /must-not-persist/);
  }
});
