import assert from "node:assert/strict";
import test from "node:test";

import {
  ERP06_OFFICIAL_READBACK_EVENT_SCHEMA_VERSION,
  Erp06OfficialReadbackRepositoryError,
  PostgresErp06OfficialReadbackRepository,
} from "./erp06-official-readback-repository.js";

const tenantId = "11111111-1111-4111-8111-111111111111";
const storeId = "22222222-2222-4222-8222-222222222222";
const commandId = "33333333-3333-4333-8333-333333333333";
const attemptId = "44444444-4444-4444-8444-444444444444";
const versionId = "55555555-5555-4555-8555-555555555555";
const revisionId = "88888888-8888-4888-8888-888888888888";
const versionFingerprint = "version-fingerprint-1";
const occurredAt = new Date("2026-08-30T12:00:00.000Z");

function context(overrides = {}) {
  return {
    tenant_id: tenantId,
    store_id: storeId,
    command_id: commandId,
    command_state: "result_unknown",
    publish_attempt_id: attemptId,
    attempt_state: "result_unknown",
    product_version_id: versionId,
    source_draft_revision_id: revisionId,
    version_fingerprint: versionFingerprint,
    ...overrides,
  };
}

function documentResult(overrides = {}) {
  return {
    contractVersion: "erp06-shein-remote-v1",
    commandId,
    publishAttemptId: attemptId,
    productVersionId: versionId,
    stage: "document_state",
    path: "/open-api/goods/query-document-state",
    method: "POST",
    status: "read",
    externalRead: true,
    resolvesResultUnknown: true,
    projection: {
      projectionVersion: "product-document-state-v1",
      mode: "dry-run",
      externalWrite: false,
      projection: {
        eventFamily: "query-document-state",
        records: [{
          spuName: "SPU-1",
          skcName: "SKC-1",
          skuCodes: ["SKU-1"],
          documentSn: "DOC-1",
          version: "VERSION-1",
          auditState: 2,
          auditStateLabel: "passed",
          status: "passed",
          failedReasons: [],
          occurredAt: "2026-08-30T12:00:00.000Z",
        }],
      },
      summary: {
        disposition: "read-only-document-state-projection",
        recordCount: 1,
        states: ["passed"],
        passedRecordCount: 1,
        failedRecordCount: 0,
      },
    },
    diagnostics: { status: 200, code: "0", traceId: "readback-trace-1" },
    ...overrides,
  };
}

function emptyDocumentResult() {
  return documentResult({
    resolvesResultUnknown: false,
    projection: {
      projectionVersion: "product-document-state-v1",
      mode: "dry-run",
      externalWrite: false,
      empty: true,
      projection: { eventFamily: "query-document-state", records: [] },
      summary: {
        disposition: "read-only-document-state-empty",
        recordCount: 0,
        states: [],
        passedRecordCount: 0,
        failedRecordCount: 0,
      },
    },
  });
}

function spuResult(overrides = {}) {
  return {
    contractVersion: "erp06-shein-remote-v1",
    commandId,
    publishAttemptId: attemptId,
    productVersionId: versionId,
    stage: "spu_info",
    path: "/open-api/goods/spu-info",
    method: "POST",
    status: "read",
    externalRead: true,
    resolvesResultUnknown: true,
    projection: {
      projectionVersion: "spu-readback-v1",
      mode: "dry-run",
      externalWrite: false,
      projection: {
        eventFamily: "goods/spu-info",
        spuName: "SPU-1",
        categoryId: 3155,
        productTypeId: 991,
        supplierCode: "SUPPLIER-1",
        skcs: [{
          skcName: "SKC-1",
          supplierCode: "SUPPLIER-1",
          skuList: [{ skuCode: "SKU-1", supplierSku: "SUPPLIER-SKU-1" }],
        }],
      },
      summary: {
        disposition: "read-only-spu-relationship-readback",
        spuName: "SPU-1",
        skcCount: 1,
        skuCount: 1,
      },
    },
    diagnostics: { status: 200, code: "0", traceId: "spu-trace-1" },
    ...overrides,
  };
}

function fakePool({ currentContext = context(), existingEvent = null, failOn = "" } = {}) {
  const calls = [];
  const client = {
    async query(query) {
      calls.push(query);
      if (typeof query === "string") return { rows: [], rowCount: 0 };
      if (failOn && query.text.includes(failOn)) throw new Error(`forced: ${failOn}`);
      if (query.text.includes("FROM publish_commands AS command")) {
        return { rows: currentContext ? [currentContext] : [], rowCount: currentContext ? 1 : 0 };
      }
      if (query.text.includes("FROM product_events") && query.text.includes("dedupe_key=$4")) {
        return { rows: existingEvent ? [existingEvent] : [], rowCount: existingEvent ? 1 : 0 };
      }
      if (query.text.includes("COALESCE(MAX(event_version)")) {
        return { rows: [{ event_version: 4 }], rowCount: 1 };
      }
      if (query.text.includes("INSERT INTO official_event_inbox")) {
        return {
          rows: [{ id: "99999999-9999-4999-8999-999999999999" }],
          rowCount: 1,
        };
      }
      if (query.text.includes("INSERT INTO product_publish_receipts")) {
        return {
          rows: [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }],
          rowCount: 1,
        };
      }
      if (query.text.includes("INSERT INTO product_events")) {
        return {
          rows: [{ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", event_version: 5 }],
          rowCount: 1,
        };
      }
      if (query.text.includes("UPDATE publish_attempts")) {
        return { rows: [{ state: "resolved_by_official_readback" }], rowCount: 1 };
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

function input(result, overrides = {}) {
  return {
    tenantId,
    storeId,
    commandId,
    publishAttemptId: attemptId,
    productVersionId: versionId,
    version: "VERSION-1",
    versionFingerprint,
    result,
    occurredAt,
    ...overrides,
  };
}

test("official readback repository records immutable inbox, receipt and event atomically", async () => {
  const { calls, pool } = fakePool();
  const repository = new PostgresErp06OfficialReadbackRepository({ pool });

  const result = await repository.recordReadback(input(documentResult()));

  assert.equal(result.idempotent, false);
  assert.equal(result.stage, "document_state");
  assert.equal(result.receiptStatus, "accepted");
  assert.equal(result.attemptState, "resolved_by_official_readback");
  assert.equal(result.resolvesResultUnknown, true);
  assert.equal(result.eventSchemaVersion, ERP06_OFFICIAL_READBACK_EVENT_SCHEMA_VERSION);
  assert.equal(calls.filter((call) => typeof call !== "string" && call.text.includes("INSERT INTO official_event_inbox")).length, 1);
  assert.equal(calls.filter((call) => typeof call !== "string" && call.text.includes("INSERT INTO product_publish_receipts")).length, 1);
  assert.equal(calls.filter((call) => typeof call !== "string" && call.text.includes("INSERT INTO product_events")).length, 1);
  assert.equal(calls.filter((call) => typeof call !== "string" && call.text.includes("UPDATE publish_attempts")).length, 1);
  assert.doesNotMatch(JSON.stringify(calls), /secret|token|password|credential|authorization|signature/i);
});

test("empty official document readback is durable evidence but never resolves result_unknown", async () => {
  const { calls, pool } = fakePool();
  const repository = new PostgresErp06OfficialReadbackRepository({ pool });

  const result = await repository.recordReadback(input(emptyDocumentResult()));

  assert.equal(result.receiptStatus, "unknown");
  assert.equal(result.attemptState, "result_unknown");
  assert.equal(result.resolvesResultUnknown, false);
  assert.equal(calls.some((call) => typeof call !== "string" && call.text.includes("UPDATE publish_attempts")), false);
  assert.equal(calls.filter((call) => typeof call !== "string" && call.text.includes("INSERT INTO official_event_inbox")).length, 1);
  assert.equal(calls.filter((call) => typeof call !== "string" && call.text.includes("INSERT INTO product_events")).length, 1);
});

test("submitted SPU relationship readback records evidence without pretending the product is completed", async () => {
  const { calls, pool } = fakePool({
    currentContext: context({ command_state: "succeeded", attempt_state: "submitted" }),
  });
  const repository = new PostgresErp06OfficialReadbackRepository({ pool });

  const result = await repository.recordReadback(input(spuResult()));

  assert.equal(result.receiptStatus, "accepted");
  assert.equal(result.attemptState, "submitted");
  assert.equal(result.resolvesResultUnknown, true);
  assert.equal(calls.some((call) => typeof call !== "string" && call.text.includes("UPDATE publish_attempts")), false);
  assert.doesNotMatch(JSON.stringify(calls), /platform_product_links|completed|effective/i);
});

test("the same readback projection is idempotent and cannot create a second fact", async () => {
  const first = await new PostgresErp06OfficialReadbackRepository({ pool: fakePool().pool })
    .recordReadback(input(documentResult()));
  const existingEvent = {
    id: first.eventId,
    event_version: first.eventVersion,
    event_type: "official_document_state_readback",
  };
  const { calls, pool } = fakePool({ existingEvent });
  const repository = new PostgresErp06OfficialReadbackRepository({ pool });

  const second = await repository.recordReadback(input(documentResult()));

  assert.equal(second.idempotent, true);
  assert.equal(second.eventId, existingEvent.id);
  assert.equal(calls.some((call) => typeof call !== "string" && call.text.includes("INSERT INTO official_event_inbox")), false);
  assert.equal(calls.some((call) => typeof call !== "string" && call.text.includes("INSERT INTO product_publish_receipts")), false);
  assert.equal(calls.some((call) => typeof call !== "string" && call.text.includes("UPDATE publish_attempts")), false);
});

test("scope, version fingerprint and attempt state drift fail closed before writes", async () => {
  for (const overrides of [
    { storeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
    { versionFingerprint: "different-version" },
  ]) {
    const { calls, pool } = fakePool();
    const repository = new PostgresErp06OfficialReadbackRepository({ pool });
    await assert.rejects(
      repository.recordReadback(input(documentResult(), overrides)),
      (error) => error.code === "ERP06_READBACK_SCOPE_MISMATCH",
    );
    assert.equal(calls.filter((call) => typeof call !== "string" && call.text.includes("INSERT INTO")).length, 0);
  }

  const { calls, pool } = fakePool({
    currentContext: context({ attempt_state: "failed_terminal", command_state: "failed" }),
  });
  const repository = new PostgresErp06OfficialReadbackRepository({ pool });
  await assert.rejects(
    repository.recordReadback(input(documentResult())),
    (error) => error.code === "ERP06_READBACK_ATTEMPT_NOT_READABLE",
  );
  assert.equal(calls.filter((call) => typeof call !== "string" && call.text.includes("INSERT INTO")).length, 0);
});

test("raw credentials or non-readback payloads are rejected and never persisted", async () => {
  const { calls, pool } = fakePool();
  const repository = new PostgresErp06OfficialReadbackRepository({ pool });

  await assert.rejects(
    repository.recordReadback(input(documentResult({ secretKey: "never-persist" }))),
    (error) => error.code === "ERP06_READBACK_SENSITIVE_FIELD",
  );
  await assert.rejects(
    repository.recordReadback(input(documentResult({ externalRead: false }))),
    (error) => error.code === "ERP06_READBACK_RESULT_INVALID",
  );
  assert.equal(calls.length, 0);
});

test("readback repository stays outside formal migrations and never performs destructive SQL", async () => {
  const { calls, pool } = fakePool();
  const repository = new PostgresErp06OfficialReadbackRepository({ pool });
  await repository.recordReadback(input(documentResult()));
  const sql = calls
    .filter((call) => typeof call !== "string")
    .map((call) => call.text)
    .join("\n");
  assert.doesNotMatch(sql, /\b(DELETE|TRUNCATE|DROP|ALTER)\b/i);
});

test("repository errors expose controlled codes without leaking evidence payload", async () => {
  const { pool } = fakePool({ currentContext: null });
  const repository = new PostgresErp06OfficialReadbackRepository({ pool });
  await assert.rejects(
    repository.recordReadback(input(documentResult())),
    (error) => {
      assert.equal(error instanceof Erp06OfficialReadbackRepositoryError, true);
      assert.equal(error.code, "ERP06_READBACK_CONTEXT_NOT_FOUND");
      assert.doesNotMatch(error.message, /SPU-1|DOC-1|secret/i);
      return true;
    },
  );
});
