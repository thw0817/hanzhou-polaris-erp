import assert from "node:assert/strict";
import test from "node:test";
import {
  isExecutionClaimQuery,
  PostgresPublishExecutionRepository,
  PUBLISH_REQUEST_CLAIM_TTL_SECONDS,
  projectPublishExecutionAuthorization,
} from "./publish-execution-repository.js";

function queryPool(responses = []) {
  const calls = [];
  return {
    calls,
    async query(query) {
      calls.push(query);
      return responses.shift() || { rows: [], rowCount: 0 };
    },
    async connect() {
      throw new Error("test does not need a transaction client");
    },
  };
}

function transactionPool(responses = []) {
  const calls = [];
  const client = {
    async query(query) {
      calls.push(query);
      return responses.shift() || { rows: [], rowCount: 0 };
    },
    release() {},
  };
  return {
    calls,
    async query(query) {
      calls.push(query);
      return responses.shift() || { rows: [], rowCount: 0 };
    },
    async connect() {
      return client;
    },
  };
}

function executionProjection() {
  const executionPlan = {
    fingerprint: "plan-1",
    requests: [{
      requestKey: "request-1",
      itemId: "item-1",
      draftId: "draft-1",
      sourceCandidateFingerprint: "source-1",
      remoteCandidateFingerprint: "remote-1",
      categoryId: "3155",
      supplierCode: "RUG-001",
      skcCount: 1,
      skuCount: 2,
      attemptReason: "rejected_relaunch",
      parentAttemptId: "job-old",
    }],
  };
  const protocol = {
    authorizationId: "authorization-1",
    fingerprint: "authorization-fingerprint-1",
    executionPlanFingerprint: "plan-1",
    authorizedBy: "user-1",
    authorizedAt: "2026-08-06T01:00:00.000Z",
    expiresAt: "2026-08-06T01:10:00.000Z",
    executionEnabled: false,
    authorizesPublishing: false,
    requests: [{ requestKey: "request-1" }],
  };
  return { executionPlan, protocol };
}

test("projects one authorization into idempotent run and job facts without raw payloads", async () => {
  const { executionPlan, protocol } = executionProjection();
  const calls = [];
  const client = {
    async query(query) {
      calls.push(query);
      if (calls.length === 1) {
        return {
          rows: [{
            id: "run-1",
            publish_batch_id: "batch-1",
            execution_plan_fingerprint: "plan-1",
            authorization_fingerprint: "authorization-fingerprint-1",
          }],
          rowCount: 1,
        };
      }
      return {
        rows: [{
          id: "job-1",
          execution_run_id: "run-1",
          source_candidate_fingerprint: "source-1",
          remote_candidate_fingerprint: "remote-1",
        }],
        rowCount: 1,
      };
    },
  };

  const run = await projectPublishExecutionAuthorization({
    client,
    tenantId: "tenant-1",
    storeId: "store-1",
    publishBatchId: "batch-1",
    protocol,
    executionPlan,
  });

  assert.equal(run.id, "run-1");
  assert.equal(calls.length, 2);
  assert.match(calls[0].text, /ON CONFLICT \(tenant_id, store_id, authorization_id\)/);
  assert.match(calls[1].text, /ON CONFLICT \(tenant_id, store_id, request_key\)/);
  assert.match(calls[1].text, /request_summary/);
  assert.doesNotMatch(calls[1].text, /request_body|image_url|secret|signature/i);
  assert.deepEqual(JSON.parse(calls[1].values.at(-1)), {
    categoryId: "3155",
    supplierCode: "RUG-001",
    skcNames: [],
    skuCodes: [],
    supplierSkus: [],
    skcCount: 1,
    skuCount: 2,
    attemptReason: "rejected_relaunch",
    parentAttemptId: "job-old",
    supersedesAttemptId: "job-old",
  });
  assert.match(calls[0].text, /execution_enabled, authorizes_publishing/);
  assert.match(calls[0].text, /false, false/);
});

test("projection reuses matching existing run and job after a retry", async () => {
  const { executionPlan, protocol } = executionProjection();
  const client = {
    calls: [],
    async query(query) {
      if (typeof query === "string") return { rows: [], rowCount: 0 };
      this.calls.push(query);
      if (this.calls.length === 1) return { rows: [], rowCount: 0 };
      if (this.calls.length === 2) {
        return {
          rows: [{
            id: "run-1",
            publish_batch_id: "batch-1",
            execution_plan_fingerprint: "plan-1",
            authorization_fingerprint: "authorization-fingerprint-1",
          }],
          rowCount: 1,
        };
      }
      if (this.calls.length === 3) return { rows: [], rowCount: 0 };
      return {
        rows: [{
          id: "job-1",
          execution_run_id: "run-1",
          source_candidate_fingerprint: "source-1",
          remote_candidate_fingerprint: "remote-1",
        }],
        rowCount: 1,
      };
    },
  };

  const run = await projectPublishExecutionAuthorization({
    client,
    tenantId: "tenant-1",
    storeId: "store-1",
    publishBatchId: "batch-1",
    protocol,
    executionPlan,
  });

  assert.equal(run.id, "run-1");
  assert.equal(client.calls.length, 4);
  assert.match(client.calls[1].text, /FROM publish_execution_runs/);
  assert.match(client.calls[3].text, /FROM publish_jobs/);
});

test("appendWebhookReceipts matches one scoped job, recovers unknown results and deduplicates receipts", async () => {
  const client = {
    calls: [],
    async query(query) {
      if (typeof query === "string") return { rows: [], rowCount: 0 };
      this.calls.push(query);
      if (this.calls.length === 1) {
        return { rows: [{ id: "job-1" }], rowCount: 1 };
      }
      if (this.calls.length === 2) {
        return { rows: [{ id: "receipt-1" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  const repository = new PostgresPublishExecutionRepository({
    pool: {
      async connect() {
        return {
          query: client.query.bind(client),
          release() {},
        };
      },
    },
  });

  const result = await repository.appendWebhookReceipts({
    tenantId: "tenant-1",
    storeId: "store-1",
    webhookEventId: "event-1",
    receiptType: "audited",
    records: [{
      documentSn: "DOC-1",
      version: "7",
      skcName: "SKC-1",
      skuCodes: ["SKU-1"],
      status: "passed",
      occurredAt: "2026-08-06T01:05:00.000Z",
    }],
  });

  assert.deepEqual(result, {
    matchedCount: 1,
    persistedCount: 1,
    ambiguousCount: 0,
    unmatchedCount: [],
  });
  assert.match(client.calls[0].text, /job\.tenant_id = \$1::uuid/);
  assert.match(client.calls[0].text, /job\.store_id = \$2::uuid/);
  assert.match(client.calls[0].text, /CASE[\s\S]*request_summary->'skuCodes'[\s\S]*jsonb_array_elements[\s\S]*\? \$7/);
  assert.match(client.calls[1].text, /ON CONFLICT \(publish_job_id, receipt_type, dedupe_key\)/);
  assert.match(client.calls[2].text, /state = 'result_unknown'/);
  assert.match(client.calls[2].text, /state <> 'completed'/);
});

test("appendWebhookReceipts fails closed on ambiguous or untraceable records", async () => {
  const client = {
    calls: 0,
    async query(query) {
      if (typeof query === "string") return { rows: [], rowCount: 0 };
      this.calls += 1;
      if (this.calls === 1) {
        return { rows: [{ id: "job-1" }, { id: "job-2" }], rowCount: 2 };
      }
      throw new Error("untraceable record must not query the database");
    },
  };
  const repository = new PostgresPublishExecutionRepository({
    pool: {
      async connect() {
        return {
          query: client.query.bind(client),
          release() {},
        };
      },
    },
  });

  const result = await repository.appendWebhookReceipts({
    tenantId: "tenant-1",
    storeId: "store-1",
    webhookEventId: "event-2",
    receiptType: "received",
    records: [
      { version: "7", status: "accepted" },
      { skcName: "SKC-ONLY", status: "accepted" },
    ],
  });

  assert.deepEqual(result, {
    matchedCount: 0,
    persistedCount: 0,
    ambiguousCount: 1,
    unmatchedCount: [0, 1],
  });
  assert.equal(client.calls, 1);
});

test("appendUnscopedWebhookReceipts only matches a globally unique strong platform identity", async () => {
  const client = {
    calls: [],
    async query(query) {
      if (typeof query === "string") return { rows: [], rowCount: 0 };
      this.calls.push(query);
      if (this.calls.length === 1) {
        return {
          rows: [{
            id: "job-unique",
            tenant_id: "tenant-1",
            store_id: "store-1",
          }],
          rowCount: 1,
        };
      }
      if (this.calls.length === 2) return { rows: [{ id: "receipt-unique" }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
  };
  const repository = new PostgresPublishExecutionRepository({
    pool: {
      async connect() {
        return { query: client.query.bind(client), release() {} };
      },
    },
  });

  const result = await repository.appendUnscopedWebhookReceipts({
    webhookEventId: "event-unscoped",
    receiptType: "audited",
    records: [{
      documentSn: "DOC-UNIQUE",
      version: "VERSION-UNIQUE",
      status: "passed",
    }],
  });

  assert.deepEqual(result, {
    matchedCount: 1,
    persistedCount: 1,
    ambiguousCount: 0,
    unmatchedCount: [],
  });
  assert.match(client.calls[0].text, /job\.shein_document_sn = \$3/);
  assert.match(client.calls[1].text, /tenant_id, store_id, publish_job_id/);
  assert.deepEqual(client.calls[1].values.slice(0, 3), [
    "tenant-1",
    "store-1",
    "job-unique",
  ]);
});

test("appendDocumentStateReceipts uses a deterministic document-state receipt key without a webhook event", async () => {
  const client = {
    calls: [],
    async query(query) {
      if (typeof query === "string") return { rows: [], rowCount: 0 };
      this.calls.push(query);
      if (this.calls.length === 1) {
        return { rows: [{ id: "job-1" }], rowCount: 1 };
      }
      if (this.calls.length === 2) {
        return { rows: [{ id: "receipt-1" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  const repository = new PostgresPublishExecutionRepository({
    pool: {
      async connect() {
        return {
          query: client.query.bind(client),
          release() {},
        };
      },
    },
  });
  const record = {
    documentSn: "DOC-1",
    version: "VERSION-1",
    spuName: "SPU-1",
    skcName: "SKC-1",
    skuCodes: ["SKU-1"],
    status: "passed",
    auditState: 2,
  };

  const result = await repository.appendDocumentStateReceipts({
    tenantId: "tenant-1",
    storeId: "store-1",
    records: [record],
  });

  assert.deepEqual(result, {
    matchedCount: 1,
    persistedCount: 1,
    ambiguousCount: 0,
    unmatchedCount: [],
  });
  assert.match(client.calls[1].text, /receipt_type, dedupe_key/);
  assert.equal(client.calls[1].values[3], null);
  assert.equal(client.calls[1].values[4], "document_state");
  assert.match(client.calls[1].values[6], /^document-state:/);
  assert.match(client.calls[2].text, /tenant_id = \$4/);
  assert.match(client.calls[2].text, /state = 'result_unknown'/);
});

test("findApprovedReadbackJob requires scoped version, SPU and passed audit receipt", async () => {
  const pool = queryPool([{
    rows: [{ id: "job-1", state: "submitted", shein_version: "VERSION-1" }],
  }]);
  const repository = new PostgresPublishExecutionRepository({ pool });

  const result = await repository.findApprovedReadbackJob({
    tenantId: "tenant-1",
    storeId: "store-1",
    spuName: "SPU-1",
    version: "VERSION-1",
  });

  assert.equal(result.id, "job-1");
  assert.match(pool.calls[0].text, /job\.tenant_id = \$1/);
  assert.match(pool.calls[0].text, /job\.shein_version = \$3/);
  const findQuery = pool.calls[0].text.replace(/\s+/g, " ");
  assert.match(
    findQuery,
    /COALESCE\( NULLIF\(job\.request_summary->>'spuName', ''\), NULLIF\(job\.receipt->>'spuName', ''\) \) = \$4/,
  );
  assert.match(pool.calls[0].text, /receipt_type IN \('audited', 'document_state'\)/);
  assert.match(pool.calls[0].text, /receipt\.status = 'passed'/);
  assert.match(pool.calls[0].text, /LIMIT 2/);
});

test("listPublishReadbackStatus scopes the batch and projects audit failure reasons without raw payloads", async () => {
  const pool = queryPool([{
    rows: [{
      id: "job-1",
      request_key: "request-1",
      state: "submitted",
      last_error: {
        code: "20100",
        message: "剩余可发品额度为0，禁止发品",
        traceId: "TRACE-PUBLISH-1",
        details: [{ location: "SHEIN", messages: ["额度不足"] }],
      },
      trace_id: "TRACE-PUBLISH-1",
      request_summary: { spuName: "SPU-1" },
      shein_document_sn: "DOC-1",
      shein_version: "VERSION-1",
      readback: { spu: "completed" },
      document_state: { status: "passed" },
      readback_receipt: { status: "passed", summary: { skuCount: 2 } },
      compliance_receipt: { status: "failed", summary: { blockers: [] } },
      compliance_photo_submission: {
        status: "failed",
        occurredAt: "2026-08-07T00:00:00.000Z",
        summary: {
          packageCount: 2,
          bodyCount: 0,
          skcCount: 1,
          message: "图片绑定失败",
          code: "PHOTO_BIND_FAILED",
          traceId: "trace-photo",
        },
      },
      updated_at: "2026-08-07T00:00:00.000Z",
    }],
  }]);
  const repository = new PostgresPublishExecutionRepository({ pool });

  const result = await repository.listPublishReadbackStatus({
    tenantId: "tenant-1",
    storeId: "store-1",
    batchId: "batch-1",
  });

  assert.equal(result[0].id, "job-1");
  assert.deepEqual(result[0].last_error, {
    code: "20100",
    message: "剩余可发品额度为0，禁止发品",
    traceId: "TRACE-PUBLISH-1",
    details: [{ location: "SHEIN", messages: ["额度不足"] }],
  });
  assert.equal(result[0].trace_id, "TRACE-PUBLISH-1");
  assert.deepEqual(pool.calls[0].values, [
    "tenant-1",
    "store-1",
    "batch-1",
  ]);
  assert.match(pool.calls[0].text, /job\.publish_batch_id = \$3/);
  assert.match(pool.calls[0].text, /receipt_type = 'readback'/);
  assert.match(pool.calls[0].text, /receipt_type = 'compliance'/);
  assert.match(pool.calls[0].text, /payload->'summary'/);
  assert.match(pool.calls[0].text, /payload->'failedReasons'/);
  assert.match(pool.calls[0].text, /payload->>'auditStateLabel'/);
  assert.match(pool.calls[0].text, /compliance_photo_submission/);
  assert.match(pool.calls[0].text, /job\.receipt->'compliancePhotoSubmission'/);
  assert.match(pool.calls[0].text, /job\.product_draft_id/);
  assert.match(pool.calls[0].text, /job\.last_error/);
  assert.match(pool.calls[0].text, /job\.trace_id/);
  assert.doesNotMatch(pool.calls[0].text, /receipt\.payload,|job\.receipt,/);
  assert.match(pool.calls[0].text, /AS effective_spu_name/);
  assert.match(pool.calls[0].text, /AS effective_skc_names/);
});

test("recordSubmitted persists accepted platform identifiers into the request summary", async () => {
  const calls = [];
  const client = {
    async query(query) {
      calls.push(query);
      if (typeof query === "string") return { rows: [], rowCount: 0 };
      if (calls.length === 2) {
        return {
          rows: [{
            id: "job-1",
            state: "submitted",
            attempt_count: 1,
          }],
          rowCount: 1,
        };
      }
      if (calls.length === 3) return { rows: [{ id: "receipt-1" }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  const repository = new PostgresPublishExecutionRepository({
    pool: { async connect() { return client; } },
  });

  await repository.recordSubmitted({
    tenantId: "tenant-1",
    storeId: "store-1",
    executionRunId: "run-1",
    jobId: "job-1",
    claimId: "claim-1",
    receipt: {
      spuName: "SPU-FROM-SHEIN",
      version: "VERSION-1",
      skcs: [{
        skcName: "SKC-1",
        skus: [{ skuCode: "SKU-1", supplierSku: "SUP-1" }],
      }],
    },
  });

  assert.match(calls[1].text, /request_summary =/);
  assert.match(calls[1].text, /request_summary->>'spuName'/);
  assert.match(calls[1].text, /request_summary->'skcNames'/);
  assert.equal(calls[1].values[10], "SPU-FROM-SHEIN");
  assert.deepEqual(JSON.parse(calls[1].values[11]), ["SKC-1"]);
  assert.deepEqual(JSON.parse(calls[1].values[12]), ["SKU-1"]);
  assert.deepEqual(JSON.parse(calls[1].values[13]), ["SUP-1"]);
});

test("appendSpuReadbackReceipt is approval-gated, tenant-scoped and idempotent", async () => {
  const calls = [];
  const client = {
    async query(query) {
      calls.push(query);
      if (typeof query === "string") return { rows: [], rowCount: 0 };
      if (calls.length === 2) return { rows: [{ id: "receipt-1" }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
  };
  const repository = new PostgresPublishExecutionRepository({
    pool: {
      async connect() {
        return { query: client.query.bind(client), release() {} };
      },
    },
  });

  const result = await repository.appendSpuReadbackReceipt({
    tenantId: "tenant-1",
    storeId: "store-1",
    jobId: "job-1",
    version: "VERSION-1",
    projection: {
      spuName: "SPU-1",
      categoryId: 3155,
      productTypeId: 991,
      skcs: [{
        skcName: "SKC-1",
        skuList: [{ skuCode: "SKU-1", supplierSku: "SUP-1" }],
      }],
    },
    occurredAt: "2026-08-06T02:00:00.000Z",
  });

  assert.equal(result.id, "receipt-1");
  assert.equal(result.deduplicated, false);
  assert.match(calls[1].text, /receipt_type, status/);
  assert.match(calls[1].text, /receipt_type IN \('audited', 'document_state'\)/);
  assert.match(calls[1].text, /job\.tenant_id = \$1/);
  assert.match(calls[1].text, /ON CONFLICT \(publish_job_id, receipt_type, dedupe_key\)/);
  assert.match(calls[2].text, /readback = COALESCE/);
  assert.match(calls[2].text, /tenant_id = \$6/);
});

test("getComplianceRevalidationSource loads only scoped draft, readback and current rule snapshots", async () => {
  const pool = queryPool([
    {
      rows: [{
        id: "job-1",
        shein_version: "VERSION-1",
        request_summary: { skcNames: ["SKC-1"] },
        draft_data: { attributeValues: {} },
        preflight: {},
        readback_payload: {
          spuName: "SPU-1",
          skcs: [{ skcName: "SKC-1", skuList: [{ skuCode: "SKU-1" }] }],
        },
      }],
    },
    {
      rows: [{
        subject_key: "SKC-1",
        payload: { skc: "SKC-1", sourceCoverage: {} },
        fetched_at: "2026-08-06T01:00:00.000Z",
        expires_at: "2026-08-07T01:00:00.000Z",
        fresh: true,
      }],
    },
  ]);
  const repository = new PostgresPublishExecutionRepository({ pool });

  const result = await repository.getComplianceRevalidationSource({
    tenantId: "tenant-1",
    storeId: "store-1",
    jobId: "job-1",
    now: "2026-08-06T02:00:00.000Z",
  });

  assert.equal(result.job.id, "job-1");
  assert.equal(result.readback.spuName, "SPU-1");
  assert.equal(result.requirementRows[0].skc, "SKC-1");
  assert.equal(result.ruleSnapshotsBySkc["SKC-1"].fresh, true);
  assert.match(pool.calls[0].text, /job\.tenant_id = \$2/);
  assert.match(pool.calls[0].text, /receipt_type = 'readback'/);
  assert.match(pool.calls[0].text, /receipt\.version = job\.shein_version/);
  const sourceQuery = pool.calls[0].text.replace(/\s+/g, " ");
  assert.match(
    sourceQuery,
    /receipt\.spu_name = COALESCE\( NULLIF\(job\.request_summary->>'spuName', ''\), NULLIF\(job\.receipt->>'spuName', ''\) \)/,
  );
  assert.match(pool.calls[1].text, /rule_type = 'compliance_requirement'/);
  assert.match(pool.calls[1].text, /subject_key = ANY\(\$3::text\[\]\)/);
});

test("appendComplianceRevalidationReceipt is readback-gated, idempotent and completes only when passed", async () => {
  const calls = [];
  const client = {
    async query(query) {
      calls.push(query);
      if (typeof query === "string") return { rows: [], rowCount: 0 };
      if (calls.length === 2) return { rows: [{ id: "receipt-1" }], rowCount: 1 };
      if (calls.length === 3) {
        return {
          rows: [{
            state: "completed",
            publish_batch_item_id: "item-1",
            product_draft_id: "draft-1",
            publish_batch_id: "batch-1",
            execution_run_id: "run-1",
          }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  const repository = new PostgresPublishExecutionRepository({
    pool: {
      async connect() {
        return { query: client.query.bind(client), release() {} };
      },
    },
  });

  const result = await repository.appendComplianceRevalidationReceipt({
    tenantId: "tenant-1",
    storeId: "store-1",
    jobId: "job-1",
    version: "VERSION-1",
    projection: {
      projectionVersion: "compliance-revalidation-v1",
      status: "passed",
      completionEligible: true,
      spuName: "SPU-1",
      skcs: [{
        skcName: "SKC-1",
        skuCodes: ["SKU-1"],
        report: { reportType: "1631" },
        capabilities: {
          gcc: {
            editable: false,
            writeStatus: "unsupported_by_official_api",
          },
        },
      }],
      blockers: [],
      summary: { disposition: "compliance-revalidation-passed" },
    },
    occurredAt: "2026-08-06T02:00:00.000Z",
  });

  assert.equal(result.id, "receipt-1");
  assert.equal(result.deduplicated, false);
  assert.match(calls[1].text, /receipt_type, status/);
  assert.match(calls[1].text, /receipt_type = 'readback'/);
  assert.match(calls[1].text, /readback\.version = job\.shein_version/);
  const complianceQuery = calls[1].text.replace(/\s+/g, " ");
  assert.match(
    complianceQuery,
    /readback\.spu_name = COALESCE\( NULLIF\(job\.request_summary->>'spuName', ''\), NULLIF\(job\.receipt->>'spuName', ''\) \)/,
  );
  assert.match(calls[1].text, /'compliance'/);
  assert.match(calls[2].text, /state IN \('submitted', 'result_unknown'\)/);
  assert.match(calls[2].text, /'completed'/);
  assert.match(calls[2].text, /RETURNING/);
  assert.match(calls[3].text, /UPDATE publish_batch_items/);
  assert.match(calls[3].text, /state = 'completed'/);
  assert.match(calls[4].text, /UPDATE product_drafts/);
  assert.match(calls[4].text, /status = 'published'/);
  assert.match(calls[5].text, /DELETE FROM media_asset_references/);
  assert.match(calls[5].text, /THEN 'pending_delete'/);
  assert.match(calls[6].text, /UPDATE publish_batches AS batch/);
  assert.match(calls[6].text, /job\.state <> 'completed'/);
  assert.match(calls[6].text, /executionProtocol,state/);
  assert.match(calls[6].text, /executionProtocol,completedAt/);
  assert.match(calls[7].text, /UPDATE publish_execution_runs AS run/);
  assert.match(calls[7].text, /execution_enabled = false/);
  assert.match(calls[7].text, /authorizes_publishing = false/);
});

test("claimNextJob uses one atomic SKIP LOCKED update and only retryable states", async () => {
  const pool = queryPool([{
    rows: [{
      id: "job-1",
      state: "claimed",
      attempt_count: 2,
      execution_enabled: true,
      authorizes_publishing: true,
    }],
  }]);
  const repository = new PostgresPublishExecutionRepository({ pool });
  const result = await repository.claimNextJob({
    tenantId: "tenant-1",
    storeId: "store-1",
    executionRunId: "run-1",
    workerId: "worker-1",
    claimId: "claim-1",
    claimedAt: "2026-08-06T01:00:00.000Z",
  });

  assert.equal(result.id, "job-1");
  assert.equal(result.attemptCount, 2);
  assert.equal(result.executionEnabled, true);
  assert.equal(result.authorizesPublishing, true);
  assert.equal(isExecutionClaimQuery(pool.calls[0].text), true);
  assert.match(pool.calls[0].text, /state IN \('authorized', 'failed_retryable'\)/);
  assert.match(pool.calls[0].text, /run\.state = 'running'/);
  assert.match(pool.calls[0].text, /run\.execution_enabled = true/);
  assert.match(pool.calls[0].text, /run\.authorizes_publishing = true/);
  assert.doesNotMatch(pool.calls[0].text, /run\.expires_at/);
  assert.deepEqual(pool.calls[0].values.slice(0, 6), [
    "tenant-1",
    "store-1",
    "run-1",
    "worker-1",
    "claim-1",
    "2026-08-06T01:00:00.000Z",
  ]);
  assert.equal(pool.calls[0].values[6], PUBLISH_REQUEST_CLAIM_TTL_SECONDS);
});

test("consumeAuthorization atomically consumes one unexpired issued authorization", async () => {
  const pool = queryPool([{
    rows: [{
      id: "run-1",
      state: "running",
      execution_enabled: true,
      authorizes_publishing: true,
      consumed_at: "2026-08-06T01:02:00.000Z",
    }],
    rowCount: 1,
  }]);
  const repository = new PostgresPublishExecutionRepository({ pool });

  const result = await repository.consumeAuthorization({
    tenantId: "tenant-1",
    storeId: "store-1",
    executionRunId: "run-1",
    authorizationId: "authorization-1",
    authorizationFingerprint: "authorization-fingerprint-1",
    executionPlanFingerprint: "plan-1",
    consumedAt: "2026-08-06T01:02:00.000Z",
  });

  assert.equal(result.id, "run-1");
  assert.equal(result.executionEnabled, true);
  assert.equal(result.authorizesPublishing, true);
  assert.match(pool.calls[0].text, /state = 'running'/);
  assert.match(pool.calls[0].text, /execution_enabled = true/);
  assert.match(pool.calls[0].text, /authorizes_publishing = true/);
  assert.match(pool.calls[0].text, /state = 'issued'/);
  assert.match(pool.calls[0].text, /expires_at > \$7::timestamptz/);
  assert.match(pool.calls[0].text, /consumed_at IS NULL/);
  assert.deepEqual(pool.calls[0].values, [
    "tenant-1",
    "store-1",
    "run-1",
    "authorization-1",
    "authorization-fingerprint-1",
    "plan-1",
    "2026-08-06T01:02:00.000Z",
  ]);
});

test("settleExecutionRun revokes write flags while submitted jobs await readback", async () => {
  const pool = queryPool([{
    rows: [{
      id: "run-1",
      state: "running",
      execution_enabled: false,
      authorizes_publishing: false,
    }],
  }]);
  const repository = new PostgresPublishExecutionRepository({ pool });

  const result = await repository.settleExecutionRun({
    tenantId: "tenant-1",
    storeId: "store-1",
    executionRunId: "run-1",
    settledAt: "2026-08-06T01:03:00.000Z",
  });

  assert.equal(result.executionEnabled, false);
  assert.equal(result.authorizesPublishing, false);
  assert.match(pool.calls[0].text, /state IN \('authorized', 'claimed', 'failed_retryable'\)/);
  assert.match(pool.calls[0].text, /state IN \('submitted', 'result_unknown'\)/);
  assert.match(pool.calls[0].text, /execution_enabled = CASE/);
  assert.match(pool.calls[0].text, /THEN 'failed'/);
  assert.deepEqual(pool.calls[0].values, [
    "tenant-1",
    "store-1",
    "run-1",
    "2026-08-06T01:03:00.000Z",
  ]);
});

test("loadClaimedExecutionSource returns only the exact claimed job and frozen batch candidate", async () => {
  const remoteCandidate = {
    state: "ready_for_publish_confirmation",
    fingerprint: "remote-1",
    sourceCandidateFingerprint: "source-1",
    requestBody: { source_system: "OpenAPI" },
  };
  const pool = queryPool([{
    rows: [{
      id: "job-1",
      tenant_id: "tenant-1",
      store_id: "store-1",
      execution_run_id: "run-1",
      publish_batch_item_id: "item-1",
      product_draft_id: "draft-1",
      state: "claimed",
      claim_id: "claim-1",
      source_candidate_fingerprint: "source-1",
      remote_candidate_fingerprint: "remote-1",
      execution_enabled: true,
      authorizes_publishing: true,
      remote_candidate: remoteCandidate,
      current_source_candidate: { fingerprint: "source-1" },
    }],
  }]);
  const repository = new PostgresPublishExecutionRepository({ pool });

  const result = await repository.loadClaimedExecutionSource({
    tenantId: "tenant-1",
    storeId: "store-1",
    executionRunId: "run-1",
    jobId: "job-1",
    claimId: "claim-1",
  });

  assert.equal(result.job.id, "job-1");
  assert.deepEqual(result.remoteCandidate, remoteCandidate);
  assert.equal(result.currentSourceCandidate.fingerprint, "source-1");
  assert.match(pool.calls[0].text, /JOIN publish_execution_runs AS run/);
  assert.match(pool.calls[0].text, /JOIN publish_batch_items AS item/);
  assert.match(pool.calls[0].text, /JOIN product_drafts AS draft/);
  assert.match(pool.calls[0].text, /item\.preflight->'remotePublishCandidate'/);
  assert.match(pool.calls[0].text, /draft\.preflight->'publishCandidate'/);
  assert.match(pool.calls[0].text, /job\.claim_id = \$5/);
});

test("claimNextJob returns null when another worker already owns every row", async () => {
  const pool = queryPool([{ rows: [] }]);
  const repository = new PostgresPublishExecutionRepository({ pool });
  const result = await repository.claimNextJob({
    tenantId: "tenant-1",
    storeId: "store-1",
    executionRunId: "run-1",
    workerId: "worker-2",
    claimId: "claim-2",
  });

  assert.equal(result, null);
});

test("expired claims become result_unknown and are never returned as claimable", async () => {
  const pool = queryPool([{
    rows: [{
      id: "job-1",
      state: "result_unknown",
      attempt_count: 1,
      execution_enabled: false,
      authorizes_publishing: false,
    }],
  }]);
  const repository = new PostgresPublishExecutionRepository({ pool });
  const result = await repository.markExpiredClaimsUnknown({
    tenantId: "tenant-1",
    storeId: "store-1",
    executionRunId: "run-1",
    expiredAt: "2026-08-06T01:03:00.000Z",
    limit: 20,
  });

  assert.equal(result[0].state, "result_unknown");
  assert.match(pool.calls[0].text, /state = 'claimed'/);
  assert.match(pool.calls[0].text, /state = 'result_unknown'/);
  assert.match(pool.calls[0].text, /FOR UPDATE SKIP LOCKED/);
  assert.doesNotMatch(pool.calls[0].text, /state = 'failed_retryable'/);
});

test("recordSubmitted atomically stores the accepted job state and submitted receipt", async () => {
  const calls = [];
  const client = {
    async query(query) {
      calls.push(query);
      if (typeof query === "string") return { rows: [], rowCount: 0 };
      if (calls.length === 2) {
        return {
          rows: [{
            id: "job-1",
            state: "submitted",
            attempt_count: 1,
            execution_enabled: true,
            authorizes_publishing: true,
          }],
          rowCount: 1,
        };
      }
      if (calls.length === 3) {
        return { rows: [{ id: "receipt-1" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  const pool = { async connect() { return client; } };
  const repository = new PostgresPublishExecutionRepository({ pool });
  const result = await repository.recordSubmitted({
    tenantId: "tenant-1",
    storeId: "store-1",
    executionRunId: "run-1",
    jobId: "job-1",
    claimId: "claim-1",
    receipt: {
      documentSn: "DOC-1",
      version: "VERSION-1",
      traceId: "TRACE-1",
    },
    submittedAt: "2026-08-06T01:01:00.000Z",
  });

  assert.equal(result.state, "submitted");
  assert.match(calls[1].text, /claim_id = \$5/);
  assert.match(calls[1].text, /receipt = \$7::jsonb/);
  assert.match(calls[1].text, /shein_document_sn/);
  assert.doesNotMatch(calls[1].text, /request_body|publishOrEdit/i);
  assert.match(calls[2].text, /INSERT INTO publish_receipts/);
  assert.match(calls[2].text, /'submitted', 'accepted'/);
  assert.match(calls[2].text, /ON CONFLICT \(publish_job_id, receipt_type, dedupe_key\)/);
  assert.match(calls[3].text, /localConsumedThisMonth/);
  assert.match(calls[3].text, /platformAvailableLimit/);
  assert.match(calls[3].text, /availableLimit/);
});

test("recordExecutionFailure separates retryable, terminal and unknown outcomes", async () => {
  const pool = transactionPool([
    { rows: [], rowCount: 0 },
    { rows: [{ id: "job-1", state: "failed_retryable", attempt_count: 1 }] },
    { rows: [], rowCount: 0 },
    { rows: [], rowCount: 0 },
    { rows: [{ id: "job-2", state: "failed_terminal", attempt_count: 1 }] },
    { rows: [], rowCount: 0 },
    { rows: [], rowCount: 0 },
    { rows: [{ id: "job-3", state: "result_unknown", attempt_count: 1 }] },
    { rows: [], rowCount: 0 },
  ]);
  const repository = new PostgresPublishExecutionRepository({ pool });

  await repository.recordExecutionFailure({
    tenantId: "tenant-1",
    storeId: "store-1",
    executionRunId: "run-1",
    jobId: "job-1",
    claimId: "claim-1",
    outcome: "failed",
    retryable: true,
    error: { code: "4000004", message: "限流", traceId: "TRACE-1" },
  });
  await repository.recordExecutionFailure({
    tenantId: "tenant-1",
    storeId: "store-1",
    executionRunId: "run-1",
    jobId: "job-2",
    claimId: "claim-2",
    outcome: "failed",
    retryable: false,
    error: { code: "0108", message: "校验失败" },
  });
  await repository.recordExecutionFailure({
    tenantId: "tenant-1",
    storeId: "store-1",
    executionRunId: "run-1",
    jobId: "job-3",
    claimId: "claim-3",
    outcome: "unknown",
    retryable: false,
    error: { message: "网络中断" },
  });

  const jobUpdates = pool.calls.filter((call) => call && typeof call === "object" && /UPDATE publish_jobs/.test(call.text));
  assert.equal(jobUpdates.length, 3);
  assert.match(jobUpdates[0].text, /THEN 'result_unknown'/);
  assert.match(jobUpdates[0].text, /THEN 'failed_retryable'/);
  assert.match(jobUpdates[0].text, /ELSE 'failed_terminal'/);
  assert.equal(jobUpdates[0].values[6], "failed");
  assert.equal(jobUpdates[0].values[7], true);
  assert.equal(jobUpdates[2].values[6], "unknown");
});

test("recordExecutionFailure projects terminal failure to its batch item and batch", async () => {
  const pool = transactionPool([
    { rows: [], rowCount: 0 },
    {
      rows: [{
        id: "job-1",
        state: "failed_terminal",
        publish_batch_id: "batch-1",
        publish_batch_item_id: "item-1",
        attempt_count: 1,
      }],
      rowCount: 1,
    },
    { rows: [], rowCount: 1 },
    { rows: [], rowCount: 1 },
    { rows: [], rowCount: 0 },
  ]);
  const repository = new PostgresPublishExecutionRepository({ pool });

  await repository.recordExecutionFailure({
    tenantId: "tenant-1",
    storeId: "store-1",
    executionRunId: "run-1",
    jobId: "job-1",
    claimId: "claim-1",
    outcome: "failed",
    retryable: false,
    error: {
      code: "20100",
      message: "剩余可发品额度为0，禁止发品",
      traceId: "TRACE-QUOTA-1",
      details: [{ location: "店铺额度", messages: ["当前额度为0"] }],
    },
  });

  assert.equal(pool.calls[0], "BEGIN");
  assert.match(pool.calls[1].text, /UPDATE publish_jobs/);
  assert.match(pool.calls[2].text, /UPDATE publish_batch_items/);
  assert.match(pool.calls[2].text, /WHERE id = \$1/);
  assert.deepEqual(JSON.parse(pool.calls[2].values[2]), {
    code: "20100",
    message: "剩余可发品额度为0，禁止发品",
    traceId: "TRACE-QUOTA-1",
    details: [{ source: "SHEIN字段校验", location: "店铺额度", messages: ["当前额度为0"] }],
  });
  assert.match(pool.calls[3].text, /UPDATE publish_batches/);
  assert.match(pool.calls[3].text, /state = CASE/);
  const batchUpdate = pool.calls[3];
  const usedParameters = [...batchUpdate.text.matchAll(/\$(\d+)/g)]
    .map((match) => Number(match[1]));
  assert.deepEqual(
    [...new Set(usedParameters)].sort((left, right) => left - right),
    [1, 2, 3, 4, 5, 6],
  );
  assert.equal(batchUpdate.values.length, 6);
  assert.equal(pool.calls.at(-1), "COMMIT");
});

test("appendReceipt is tenant-scoped and idempotent by job, type and dedupe key", async () => {
  const calls = [];
  const client = {
    async query(query) {
      calls.push(query);
      if (query === "BEGIN" || query === "COMMIT") {
        return { rows: [], rowCount: 0 };
      }
      if (calls.length === 2) {
        return { rows: [{ id: "receipt-1" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  const pool = {
    async connect() {
      return client;
    },
  };
  const repository = new PostgresPublishExecutionRepository({ pool });
  const result = await repository.appendReceipt({
    tenantId: "tenant-1",
    storeId: "store-1",
    jobId: "job-1",
    webhookEventId: "event-1",
    receiptType: "audited",
    status: "passed",
    dedupeKey: "event-1",
    payload: { auditState: 2 },
  });

  assert.equal(result.id, "receipt-1");
  assert.match(calls[1].text, /ON CONFLICT \(publish_job_id, receipt_type, dedupe_key\)/);
  assert.match(calls[1].text, /job\.tenant_id = \$1/);
  assert.match(calls[1].text, /payload, occurred_at/);
  assert.deepEqual(calls[1].values.slice(0, 7), [
    "tenant-1",
    "store-1",
    "job-1",
    "event-1",
    "audited",
    "passed",
    "event-1",
  ]);
});
