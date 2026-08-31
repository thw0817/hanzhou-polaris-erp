import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ERP06_PUBLISH_RESULT_EVENT_SCHEMA_VERSION,
  Erp06PublishResultRepositoryError,
  PostgresErp06PublishResultRepository,
} from "./erp06-publish-result-repository.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const draftDirectory = path.join(currentDirectory, "erp06-draft");
const activeMigrationDirectory = path.join(currentDirectory, "migrations");
const packageJsonPath = path.resolve(currentDirectory, "../../package.json");

const tenantId = "11111111-1111-4111-8111-111111111111";
const storeId = "22222222-2222-4222-8222-222222222222";
const commandId = "33333333-3333-4333-8333-333333333333";
const attemptId = "44444444-4444-4444-8444-444444444444";
const versionId = "55555555-5555-4555-8555-555555555555";
const revisionId = "88888888-8888-4888-8888-888888888888";
const claimId = "worker-1:claim-1";
const occurredAt = new Date("2026-08-30T11:00:00.000Z");

function executionContext(overrides = {}) {
  return {
    tenant_id: tenantId,
    store_id: storeId,
    command_id: commandId,
    command_state: "dispatching",
    worker_claim_id: claimId,
    publish_attempt_id: attemptId,
    attempt_state: "created",
    product_version_id: versionId,
    source_draft_revision_id: revisionId,
    send_started_at: null,
    result_recorded_at: null,
    ...overrides,
  };
}

function acceptedResult(overrides = {}) {
  return {
    contractVersion: "erp06-shein-publish-v1",
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
      traceId: "trace-1",
    },
    ...overrides,
  };
}

function fakePool({ context = executionContext(), existingEvent = null, failOn = "" } = {}) {
  const calls = [];
  let currentEvent = existingEvent;
  const client = {
    async query(query) {
      calls.push(query);
      if (typeof query === "string") return { rows: [], rowCount: 0 };
      if (failOn && query.text.includes(failOn)) throw new Error(`forced: ${failOn}`);
      if (query.text.includes("FROM publish_commands AS command")) {
        return { rows: context ? [context] : [], rowCount: context ? 1 : 0 };
      }
      if (query.text.includes("FROM product_events") && query.text.includes("dedupe_key=$4")) {
        return { rows: currentEvent ? [currentEvent] : [], rowCount: currentEvent ? 1 : 0 };
      }
      if (query.text.includes("COALESCE(MAX(event_version)")) {
        return { rows: [{ event_version: 3 }], rowCount: 1 };
      }
      if (query.text.includes("INSERT INTO product_events")) {
        currentEvent = {
          id: "99999999-9999-4999-8999-999999999999",
          event_version: query.values[5],
          event_type: query.values[3],
        };
        return {
          rows: [currentEvent],
          rowCount: 1,
        };
      }
      if (query.text.includes("INSERT INTO product_publish_receipts")) {
        return {
          rows: [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }],
          rowCount: 1,
        };
      }
      if (query.text.includes("UPDATE publish_attempts")) {
        return { rows: [{ ...context }], rowCount: 1 };
      }
      if (query.text.includes("UPDATE publish_commands")) {
        return { rows: [{ ...context }], rowCount: 1 };
      }
      throw new Error(`unhandled query: ${query.text}`);
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

async function readDraft(filename) {
  return fs.readFile(path.join(draftDirectory, filename), "utf8");
}

test("ERP-06 result persistence draft is additive and stays outside active migrations", async () => {
  const activeFiles = await fs.readdir(activeMigrationDirectory);
  assert.equal(activeFiles.includes("048_erp06_publish_result_persistence.sql"), false);
  const sql = await readDraft("048_erp06_publish_result_persistence.sql");
  const preflight = await readDraft("preflight-048.sql");
  const verify = await readDraft("verify-048.sql");
  const rollback = await readDraft("rollback-048_empty.sql");
  assert.match(sql, /ISOLATED DRAFT ONLY/);
  assert.match(sql, /ALTER TABLE publish_commands\s+ADD COLUMN send_started_at/i);
  assert.match(sql, /ADD COLUMN result_recorded_at/i);
  assert.match(sql, /publish_commands_send_started_timing_chk/);
  assert.match(sql, /publish_commands_result_recorded_timing_chk/);
  assert.doesNotMatch(sql.replace(/--[^\n]*/g, ""), /^\s*(DELETE|TRUNCATE|UPDATE)\b/im);
  assert.match(preflight, /target_columns_absent/);
  assert.match(verify, /send_started_timing_constraint/);
  assert.match(verify, /result_recorded_timing_constraint/);
  assert.match(rollback, /ERP06_048_ROLLBACK_REQUIRES_DISPOSABLE_DATABASE/);
  assert.ok(rollback.indexOf("DROP INDEX publish_commands_result_recorded_idx") < rollback.indexOf("ALTER TABLE publish_commands"));
});

test("ERP-06 result persistence has an explicit disposable-database rehearsal entrypoint", async () => {
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));
  assert.equal(
    packageJson.scripts["db:rehearse:erp06-results"],
    "node server/cloud/rehearse-erp06-result-persistence.js",
  );
  const rehearsal = await import("./rehearse-erp06-result-persistence.js");
  assert.equal(
    rehearsal.confirmationValue,
    "REHEARSE_ERP06_RESULT_PERSISTENCE_ON_EMPTY_LOCAL_DATABASE",
  );
});

test("send_started atomically records a sanitized append-only event and command timestamp", async () => {
  const { calls, pool } = fakePool();
  const repository = new PostgresErp06PublishResultRepository({ pool });

  const result = await repository.recordSendStarted({
    tenantId,
    storeId,
    commandId,
    publishAttemptId: attemptId,
    claimId,
    productVersionId: versionId,
    versionFingerprint: "version-fingerprint-1",
    path: "/open-api/goods/product/publishOrEdit",
    occurredAt,
  });

  assert.equal(result.idempotent, false);
  assert.equal(result.attemptState, "dispatched");
  assert.equal(result.commandId, commandId);
  assert.equal(result.eventVersion, 3);
  assert.equal(result.schemaVersion, ERP06_PUBLISH_RESULT_EVENT_SCHEMA_VERSION);
  assert.equal(calls.filter((call) => typeof call !== "string").some((call) =>
    call.text.includes("INSERT INTO product_events") &&
    call.values.includes("publish_send_started"),
  ), true);
  assert.equal(calls.filter((call) => typeof call !== "string").some((call) =>
    call.text.includes("UPDATE publish_commands") &&
    /send_started_at/.test(call.text),
  ), true);
  assert.doesNotMatch(JSON.stringify(calls), /secret|token|password|credential|requestBody|imageUrl/i);
});

test("duplicate send_started is idempotent and cannot create a second event", async () => {
  const existingEvent = {
    id: "99999999-9999-4999-8999-999999999999",
    event_version: 3,
    event_type: "publish_send_started",
  };
  const { calls, pool } = fakePool({ existingEvent });
  const repository = new PostgresErp06PublishResultRepository({ pool });

  const result = await repository.recordSendStarted({
    tenantId,
    storeId,
    commandId,
    publishAttemptId: attemptId,
    claimId,
    productVersionId: versionId,
    versionFingerprint: "version-fingerprint-1",
    path: "/open-api/goods/product/publishOrEdit",
    occurredAt,
  });

  assert.deepEqual(result, {
    idempotent: true,
    commandId,
    publishAttemptId: attemptId,
    eventId: existingEvent.id,
    eventVersion: 3,
    attemptState: "created",
    commandState: "dispatching",
    schemaVersion: ERP06_PUBLISH_RESULT_EVENT_SCHEMA_VERSION,
  });
  assert.equal(calls.some((call) => typeof call !== "string" && call.text.includes("INSERT INTO product_events")), false);
});

test("duplicate accepted result is idempotent after the first transaction commits", async () => {
  const { calls, pool } = fakePool({
    context: executionContext({ attempt_state: "dispatched", send_started_at: occurredAt }),
  });
  const repository = new PostgresErp06PublishResultRepository({ pool });
  const input = {
    tenantId,
    storeId,
    commandId,
    publishAttemptId: attemptId,
    claimId,
    productVersionId: versionId,
    result: acceptedResult(),
    occurredAt,
  };

  const first = await repository.recordPublishResult(input);
  const second = await repository.recordPublishResult(input);

  assert.equal(first.idempotent, false);
  assert.equal(second.idempotent, true);
  assert.equal(second.eventId, first.eventId);
  assert.equal(calls.filter((call) => typeof call !== "string" && call.text.includes("INSERT INTO product_events")).length, 1);
});

test("send_started rejects scope, claim and result_unknown without writing state", async () => {
  for (const overrides of [
    { tenant_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
    { worker_claim_id: "another-claim" },
    { attempt_state: "result_unknown" },
  ]) {
    const { calls, pool } = fakePool({ context: executionContext(overrides) });
    const repository = new PostgresErp06PublishResultRepository({ pool });
    await assert.rejects(
      repository.recordSendStarted({
        tenantId,
        storeId,
        commandId,
        publishAttemptId: attemptId,
        claimId,
        productVersionId: versionId,
        versionFingerprint: "version-fingerprint-1",
        path: "/open-api/goods/product/publishOrEdit",
        occurredAt,
      }),
      Erp06PublishResultRepositoryError,
    );
    assert.equal(calls.some((call) => typeof call !== "string" && call.text.includes("INSERT INTO product_events")), false);
  }
});

test("accepted result atomically inserts the platform receipt and moves command/attempt", async () => {
  const { calls, pool } = fakePool({
    context: executionContext({ attempt_state: "dispatched", send_started_at: occurredAt }),
  });
  const repository = new PostgresErp06PublishResultRepository({ pool });
  const result = await repository.recordPublishResult({
    tenantId,
    storeId,
    commandId,
    publishAttemptId: attemptId,
    claimId,
    productVersionId: versionId,
    result: acceptedResult(),
    occurredAt,
  });

  assert.equal(result.idempotent, false);
  assert.equal(result.outcome, "accepted");
  assert.equal(result.attemptState, "submitted");
  assert.equal(result.commandState, "succeeded");
  assert.equal(result.receiptType, "accepted");
  assert.equal(result.receiptStatus, "accepted");
  assert.equal(result.eventType, "platform_receipt_recorded");
  assert.equal(calls.some((call) => typeof call !== "string" && call.text.includes("INSERT INTO product_publish_receipts")), true);
  assert.equal(calls.some((call) => typeof call !== "string" && call.text.includes("UPDATE publish_attempts") && call.values.includes("submitted")), true);
  assert.equal(calls.some((call) => typeof call !== "string" && call.text.includes("UPDATE publish_commands") && call.values.includes("succeeded")), true);
  assert.doesNotMatch(JSON.stringify(calls), /secret|token|password|credential|requestBody|imageUrl/i);
});

test("accepted result requires a complete SPU/version/SKC/SKU receipt", async () => {
  const { pool } = fakePool({
    context: executionContext({ attempt_state: "dispatched", send_started_at: occurredAt }),
  });
  const repository = new PostgresErp06PublishResultRepository({ pool });
  await assert.rejects(
    repository.recordPublishResult({
      tenantId,
      storeId,
      commandId,
      publishAttemptId: attemptId,
      claimId,
      productVersionId: versionId,
      result: acceptedResult({
        receipt: { spuName: "SPU-1", version: "VERSION-1", skcs: [] },
      }),
      occurredAt,
    }),
    (error) => error.code === "ERP06_ACCEPTED_RECEIPT_MISSING",
  );
});

test("result_unknown is durable, non-retryable and cannot be overwritten by another result", async () => {
  const { calls, pool } = fakePool({
    context: executionContext({ attempt_state: "dispatched", send_started_at: occurredAt }),
  });
  const repository = new PostgresErp06PublishResultRepository({ pool });
  const result = await repository.recordPublishResult({
    tenantId,
    storeId,
    commandId,
    publishAttemptId: attemptId,
    claimId,
    productVersionId: versionId,
    result: {
      contractVersion: "erp06-shein-publish-v1",
      commandId,
      publishAttemptId: attemptId,
      outcome: "unknown",
      state: "result_unknown",
      remoteCallMade: true,
      sendStarted: true,
      retryable: false,
      error: { code: "ETIMEDOUT", message: "network timeout", traceId: "trace-unknown" },
    },
    occurredAt,
  });

  assert.equal(result.attemptState, "result_unknown");
  assert.equal(result.commandState, "result_unknown");
  assert.equal(result.receiptType, "submitted");
  assert.equal(result.receiptStatus, "unknown");
  assert.equal(result.eventType, "attempt_result_unknown");
  assert.equal(calls.some((call) => typeof call !== "string" && call.text.includes("result_unknown_at")), true);
});

test("explicit retryable and terminal failures preserve the adapter error classification", async () => {
  for (const [retryable, expectedAttemptState] of [[true, "known_failed"], [false, "failed_terminal"]]) {
    const { pool } = fakePool({ context: executionContext({ attempt_state: "dispatched", send_started_at: occurredAt }) });
    const repository = new PostgresErp06PublishResultRepository({ pool });
    const result = await repository.recordPublishResult({
      tenantId,
      storeId,
      commandId,
      publishAttemptId: attemptId,
      claimId,
      productVersionId: versionId,
      result: {
        contractVersion: "erp06-shein-publish-v1",
        commandId,
        publishAttemptId: attemptId,
        outcome: "failed",
        state: "failed",
        remoteCallMade: true,
        sendStarted: true,
        retryable,
        error: {
          code: retryable ? "4000004" : "openapi00001",
          message: retryable ? "rate limited" : "signature rejected",
          traceId: "trace-failure",
          ...(retryable ? {} : { requiresReauthorization: true }),
        },
      },
      occurredAt,
    });
    assert.equal(result.attemptState, expectedAttemptState);
    assert.equal(result.commandState, "failed");
    assert.equal(result.retryable, retryable);
  }
});

test("reauthorization stays a classification marker without becoming a credential field", async () => {
  const { calls, pool } = fakePool({
    context: executionContext({ attempt_state: "dispatched", send_started_at: occurredAt }),
  });
  const repository = new PostgresErp06PublishResultRepository({ pool });
  const result = await repository.recordPublishResult({
    tenantId,
    storeId,
    commandId,
    publishAttemptId: attemptId,
    claimId,
    productVersionId: versionId,
    result: {
      contractVersion: "erp06-shein-publish-v1",
      commandId,
      publishAttemptId: attemptId,
      outcome: "failed",
      state: "failed",
      remoteCallMade: true,
      sendStarted: true,
      retryable: false,
      error: {
        code: "openapi00001",
        message: "signature rejected",
        requiresReauthorization: true,
      },
    },
    occurredAt,
  });
  const receiptInsert = calls.find((call) => typeof call !== "string" && call.text.includes("INSERT INTO product_publish_receipts"));
  assert.match(receiptInsert.values[9], /requiresReauthorization/);
});

test("receipt or event persistence failure rolls back the whole result transaction", async () => {
  const { calls, pool } = fakePool({
    context: executionContext({ attempt_state: "dispatched", send_started_at: occurredAt }),
    failOn: "INSERT INTO product_publish_receipts",
  });
  const repository = new PostgresErp06PublishResultRepository({ pool });

  await assert.rejects(
    repository.recordPublishResult({
      tenantId,
      storeId,
      commandId,
      publishAttemptId: attemptId,
      claimId,
      productVersionId: versionId,
      result: acceptedResult(),
      occurredAt,
    }),
    /forced: INSERT INTO product_publish_receipts/,
  );
  assert.equal(calls.filter((call) => call === "COMMIT").length, 0);
  assert.equal(calls.filter((call) => call === "ROLLBACK").length, 1);
});

test("result persistence rejects ProductVersion drift and raw credential fields", async () => {
  const { pool } = fakePool({
    context: executionContext({ attempt_state: "dispatched", send_started_at: occurredAt }),
  });
  const repository = new PostgresErp06PublishResultRepository({ pool });
  await assert.rejects(
    repository.recordPublishResult({
      tenantId,
      storeId,
      commandId,
      publishAttemptId: attemptId,
      claimId,
      productVersionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      result: acceptedResult(),
      occurredAt,
    }),
    (error) => error.code === "ERP06_RESULT_SCOPE_MISMATCH",
  );
  await assert.rejects(
    repository.recordPublishResult({
      tenantId,
      storeId,
      commandId,
      publishAttemptId: attemptId,
      claimId,
      productVersionId: versionId,
      result: acceptedResult({
        receipt: { ...acceptedResult().receipt, accessKeySecret: "must-not-persist" },
      }),
      occurredAt,
    }),
    (error) => error.code === "ERP06_RESULT_SENSITIVE_FIELD",
  );
});
