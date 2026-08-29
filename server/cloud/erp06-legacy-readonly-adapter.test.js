import assert from "node:assert/strict";
import test from "node:test";

import { PostgresErp06LegacyReadonlyAdapter } from "./erp06-legacy-readonly-adapter.js";

const tenantId = "11111111-1111-4111-8111-111111111111";
const storeId = "22222222-2222-4222-8222-222222222222";
const draftId = "33333333-3333-4333-8333-333333333333";
const jobId = "44444444-4444-4444-8444-444444444444";

class FakePool {
  constructor() {
    this.calls = [];
  }

  async query(input) {
    const sql = typeof input === "string" ? input : input.text;
    this.calls.push({ sql, input });
    if (sql.includes("FROM publish_jobs")) {
      return {
        rows: [{
          id: jobId,
          tenant_id: tenantId,
          store_id: storeId,
          publish_batch_id: "legacy-batch",
          publish_batch_item_id: "legacy-item",
          product_draft_id: draftId,
          request_key: "legacy-request",
          source_candidate_fingerprint: "candidate-fingerprint",
          remote_candidate_fingerprint: "remote-fingerprint",
          state: "result_unknown",
          shein_document_sn: "SN-LEGACY",
          shein_version: "V-LEGACY",
          trace_id: "trace-legacy",
          request_summary: { secretKey: "must-not-leak" },
          receipt: { accessToken: "must-not-leak" },
          readback: { password: "must-not-leak" },
          updated_at: "2026-08-30T00:00:00.000Z",
        }],
        rowCount: 1,
      };
    }
    if (sql.includes("FROM publish_receipts")) {
      return {
        rows: [{
          id: "55555555-5555-4555-8555-555555555555",
          publish_job_id: jobId,
          receipt_type: "readback",
          status: "unknown",
          trace_id: "trace-receipt",
          document: "SN-LEGACY",
          version: "V-LEGACY",
          occurred_at: "2026-08-30T00:00:01.000Z",
        }],
        rowCount: 1,
      };
    }
    throw new Error(`unhandled fake SQL: ${sql}`);
  }
}

test("projects legacy job and receipt as read-only unknown evidence", async () => {
  const pool = new FakePool();
  const result = await new PostgresErp06LegacyReadonlyAdapter({ pool }).getJob({
    tenantId,
    storeId,
    jobId,
  });

  assert.equal(result.source, "legacy_readonly");
  assert.equal(result.legacyDisposition, "legacy_unknown");
  assert.equal(result.currentKind, "legacy_readonly");
  assert.equal(result.productVersionId, null);
  assert.equal(result.publishAttemptId, null);
  assert.equal(result.jobId, jobId);
  assert.equal(result.state, "result_unknown");
  assert.equal(result.platform.document, "SN-LEGACY");
  assert.equal(result.receipts.length, 1);
  assert.doesNotMatch(JSON.stringify(result), /secretKey|accessToken|password|must-not-leak/i);
  assert.equal(pool.calls.some(({ sql }) => /^\s*(INSERT|UPDATE|DELETE|TRUNCATE|DROP)\b/i.test(sql)), false);
});

test("legacy adapter keeps every read scoped to tenant and store", async () => {
  const pool = new FakePool();
  const result = await new PostgresErp06LegacyReadonlyAdapter({ pool }).listForDraft({
    tenantId,
    storeId,
    draftId,
  });

  assert.equal(result.length, 1);
  const jobQuery = pool.calls.find(({ sql }) => sql.includes("FROM publish_jobs"));
  assert.match(jobQuery.sql, /tenant_id=\$1/);
  assert.match(jobQuery.sql, /store_id=\$2/);
  assert.match(jobQuery.sql, /product_draft_id=\$3/);
  assert.equal(
    pool.calls.some(({ sql }) => /^\s*(INSERT|UPDATE|DELETE|TRUNCATE|DROP)\b/i.test(sql)),
    false,
  );
});
