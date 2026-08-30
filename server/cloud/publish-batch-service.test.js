import assert from "node:assert/strict";
import test from "node:test";
import {
  productPublishCandidateFingerprint,
} from "./product-publish-candidate.js";
import {
  productRemotePublishCandidateFingerprint,
} from "./product-remote-preflight.js";
import {
  PostgresPublishBatchRepository,
  WebPublishBatchService,
  summarizeFastPublishAcknowledgement,
} from "./publish-batch-service.js";
import { createRuleFingerprint } from "./rule-snapshot-service.js";

function publishCandidate() {
  const candidate = {
    state: "ready_for_remote_preflight",
    requestBody: {
      category_id: "3155",
      product_type_id: "991",
      skc_list: [{
        supplier_code: "RUG-001",
        sku_list: [
          { supplier_sku: "RUG-40X60" },
          { supplier_sku: "RUG-50X80" },
        ],
      }],
    },
    pendingImageUploads: [],
    audit: { categoryId: "3155" },
    remoteChecks: [
      "check-publish-permission",
      "goods/query-shelf-quota",
      "check-supplierSku-repeated",
    ],
    blockers: [],
  };
  return {
    ...candidate,
    fingerprint: productPublishCandidateFingerprint(candidate),
  };
}

function row(overrides = {}) {
  return {
    id: "batch-1",
    store_id: "store-1",
    name: "首批地毯",
    idempotency_key: "batch:20260731:1",
    state: "queued",
    preflight: {},
    created_at: "2026-07-31T00:00:00.000Z",
    updated_at: "2026-07-31T00:00:00.000Z",
    items: [
      {
        id: "item-1",
        product_draft_id: "draft-1",
        draft_name: "云朵地毯",
        state: "queued",
        attempt_count: 0,
        preflight: {},
        draft_preflight: {
          publishCandidate: publishCandidate(),
        },
        draft_data: {
          skuRows: [
            { supplierSku: "RUG-40X60" },
            { supplierSku: "RUG-50X80" },
          ],
        },
      },
    ],
    ...overrides,
  };
}

function remoteCandidate(source, requestBody = source.requestBody) {
  const remote = {
    state: "ready_for_publish_confirmation",
    sourceCandidateFingerprint: source.fingerprint,
    publishingEnabled: false,
    blockers: [],
    requestBody,
  };
  return {
    ...remote,
    fingerprint: productRemotePublishCandidateFingerprint(remote),
  };
}

function readyRow(overrides = {}) {
  const source = publishCandidate();
  const remote = remoteCandidate(source);
  return row({
    state: "ready",
    preflight: { passed: true, publishingEnabled: false },
    items: [{
      ...row().items[0],
      state: "ready",
      draft_preflight: { publishCandidate: source },
      preflight: {
        passed: true,
        blockers: [],
        publishCandidateFingerprint: source.fingerprint,
        remotePublishCandidate: remote,
      },
    }],
    ...overrides,
  });
}

function confirmedRow(overrides = {}) {
  const existing = readyRow(overrides);
  const items = existing.items
    .map((item) => ({
      itemId: item.id,
      draftId: item.product_draft_id,
      sourceCandidateFingerprint: item.preflight.publishCandidateFingerprint,
      remoteCandidateFingerprint:
        item.preflight.remotePublishCandidate.fingerprint,
    }))
    .sort((left, right) => left.itemId.localeCompare(right.itemId));
  return {
    ...existing,
    preflight: {
      ...existing.preflight,
      confirmation: {
        state: "confirmed",
        confirmedAt: "2026-08-05T06:30:00.000Z",
        confirmedBy: "user-1",
        batchFingerprint: createRuleFingerprint(items),
        items,
        authorizesPublishing: false,
      },
    },
  };
}

test("fast publish acknowledgement waits for every draft and preserves partial outcomes", () => {
  assert.deepEqual(
    summarizeFastPublishAcknowledgement([
      { draftId: "draft-1", jobState: "submitted" },
      { draftId: "draft-2", jobState: "failed_terminal" },
      { draftId: "draft-3", jobState: "queued" },
    ], ["draft-1", "draft-2", "draft-3"]),
    {
      stage: "queued",
      handoffDraftIds: ["draft-1", "draft-2", "draft-3"],
      acceptedDraftIds: ["draft-1"],
      failedDraftIds: ["draft-2"],
      uncertainDraftIds: ["draft-3"],
      partial: true,
    },
  );
  assert.deepEqual(
    summarizeFastPublishAcknowledgement([
      { draftId: "draft-1", jobState: "submitted" },
      { draftId: "draft-2", jobState: "failed_retryable" },
    ], ["draft-1", "draft-2"]),
    {
      stage: "failed",
      handoffDraftIds: ["draft-1", "draft-2"],
      acceptedDraftIds: ["draft-1"],
      failedDraftIds: ["draft-2"],
      uncertainDraftIds: [],
      partial: true,
    },
  );
  assert.deepEqual(
    summarizeFastPublishAcknowledgement([], ["draft-1", "draft-2"]),
    {
      stage: "queued",
      handoffDraftIds: ["draft-1", "draft-2"],
      acceptedDraftIds: [],
      failedDraftIds: [],
      uncertainDraftIds: ["draft-1", "draft-2"],
      partial: false,
    },
  );
});

test("creates idempotent publish batches without enabling SHEIN writes", async () => {
  let received = null;
  let revalidated = null;
  const service = new WebPublishBatchService({
    repository: {
      async create(input) {
        received = input;
        return row();
      },
    },
    revalidateDrafts(input) {
      revalidated = input;
      return { drafts: [], count: 0, skippedCount: 0 };
    },
    async preflightPublish() {},
    async preparePublishCandidate() {},
  });
  const result = await service.create({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    input: {
      name: "首批地毯",
      idempotencyKey: "batch:20260731:1",
      draftIds: ["draft-1", "draft-1"],
    },
  });

  assert.deepEqual(received.draftIds, ["draft-1"]);
  assert.deepEqual(revalidated, {
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    draftIds: ["draft-1"],
    force: true,
  });
  assert.equal(result.publishingEnabled, false);
  assert.equal(result.batch.itemCount, 1);
});

test("direct publish allows only published drafts with a scoped rejected review state", async () => {
  const calls = [];
  const inserted = row({ id: "batch-rejected-relaunch", items: undefined });
  const pool = {
    async connect() {
      return {
        async query(input) {
          calls.push(input);
          if (typeof input === "string") return { rows: [] };
          if (input.text.includes("INSERT INTO publish_batches")) return { rows: [inserted] };
          if (input.text.includes("INSERT INTO publish_batch_items")) return { rowCount: 1, rows: [{ id: "item-1", product_draft_id: "draft-1" }] };
          return { rows: [{ ...row().items[0], batch_id: inserted.id }] };
        },
        release() {},
      };
    },
  };
  const repository = new PostgresPublishBatchRepository({ pool });
  await repository.create({
    tenantId: "tenant-1",
    storeId: "store-1",
    name: "驳回重发",
    idempotencyKey: "direct:rejected-1",
    draftIds: ["draft-1"],
    userId: "user-1",
    allowRejectedPublished: true,
  });

  const itemInsert = calls.find((input) => typeof input !== "string" && input.text.includes("INSERT INTO publish_batch_items"));
  assert.match(itemInsert.text, /d\.status IN \('published', 'archived'\)/);
  assert.match(itemInsert.text, /review_state\.audit_state=3/);
  assert.match(itemInsert.text, /publish_receipts/);
  assert.match(itemInsert.text, /rejected_receipt\.status='failed'/);
  assert.equal(itemInsert.values.at(-1), true);
});

test("direct publish requires a client request key and reuses an in-flight batch", async () => {
  let received = null;
  let prepared = 0;
  const running = row({
    state: "ready",
    idempotency_key: "direct:attempt-1",
    preflight: {
      directPublish: true,
      executionProtocol: { state: "running", executionRunId: "run-1" },
    },
    items: [{ ...row().items[0], state: "ready" }],
  });
  const service = new WebPublishBatchService({
    repository: {
      async create(input) {
        received = input;
        return running;
      },
    },
    async preflightPublish() {},
    async preparePublishCandidate() { prepared += 1; },
    executionQueue: { async add() {} },
    executionEnabled: true,
  });

  const result = await service.publishNow({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    input: {
      draftIds: ["draft-1"],
      idempotencyKey: "attempt-1",
      confirmation: "CONFIRM_SHEIN_PRODUCT_PUBLISH",
    },
  });

  assert.equal(received.idempotencyKey, "direct:attempt-1");
  assert.equal(prepared, 0);
  assert.equal(result.idempotentReplay, true);
  assert.equal(result.executionQueued, true);
  assert.equal(result.executionStage, "queued");
});

test("direct publish returns a fast SHEIN acknowledgement when the queued job is already submitted", async () => {
  const running = row({
    state: "ready",
    idempotency_key: "direct:fast-ack-1",
    preflight: {
      directPublish: true,
      executionProtocol: { state: "running", executionRunId: "run-fast-ack-1" },
    },
    items: [{ ...row().items[0], state: "ready" }],
  });
  const service = new WebPublishBatchService({
    repository: { async create() { return running; } },
    readbackRepository: {
      async listPublishReadbackStatus() {
        return [{ product_draft_id: "draft-1", state: "submitted" }];
      },
    },
    async preflightPublish() {},
    async preparePublishCandidate() {},
    executionQueue: { async add() {} },
    executionEnabled: true,
  });

  const result = await service.publishNow({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    input: {
      draftIds: ["draft-1"],
      idempotencyKey: "fast-ack-1",
      confirmation: "CONFIRM_SHEIN_PRODUCT_PUBLISH",
    },
  });

  assert.equal(result.executionQueued, false);
  assert.equal(result.executionStage, "accepted");
  assert.deepEqual(result.fastAck, {
    stage: "accepted",
    handoffDraftIds: ["draft-1"],
    acceptedDraftIds: ["draft-1"],
    failedDraftIds: [],
    uncertainDraftIds: [],
    partial: false,
    timedOut: false,
  });
});

test("direct publish rejects requests without repeat-submit protection", async () => {
  const service = new WebPublishBatchService({
    repository: { async create() { throw new Error("must not run"); } },
    async preflightPublish() {},
    async preparePublishCandidate() {},
    executionQueue: { async add() {} },
    executionEnabled: true,
  });

  await assert.rejects(
    service.publishNow({
      context: { tenantId: "tenant-1", userId: "user-1" },
      storeId: "store-1",
      input: {
        draftIds: ["draft-1"],
        confirmation: "CONFIRM_SHEIN_PRODUCT_PUBLISH",
      },
    }),
    (error) => error?.code === "PRODUCT_PUBLISH_IDEMPOTENCY_KEY_REQUIRED",
  );
});

test("direct publish performs the real read-only preflight and blocks exhausted quota before candidate preparation", async () => {
  const created = readyRow({
    id: "batch-quota-exhausted",
    state: "queued",
    items: [{
      ...readyRow().items[0],
      state: "queued",
    }],
  });
  let preflightInput = null;
  let prepareCalled = false;
  let recorded = null;
  const service = new WebPublishBatchService({
    repository: {
      async create() {
        return created;
      },
      async recordPreflight(input) {
        recorded = input;
        return row({
          id: created.id,
          state: "failed",
          items: [{ ...created.items[0], state: "failed", last_error: "当前店铺没有可用上架额度" }],
        });
      },
    },
    async preflightPublish(input) {
      preflightInput = input;
      return {
        passed: false,
        blockers: ["当前店铺没有可用上架额度"],
        permission: { canPublishProduct: true },
        shelfQuota: { availability: "available", availableLimit: 0 },
        supplierSkuCheck: { requestedCount: 2, checkedCount: 2, results: [] },
      };
    },
    async preparePublishCandidate() {
      prepareCalled = true;
      throw new Error("额度阻断后不得准备发布载荷");
    },
    executionQueue: { async add() { throw new Error("不得入队"); } },
    executionEnabled: true,
  });

  const result = await service.publishNow({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    input: {
      draftIds: ["draft-1"],
      idempotencyKey: "quota-exhausted-1",
      confirmation: "CONFIRM_SHEIN_PRODUCT_PUBLISH",
    },
  });

  assert.deepEqual(preflightInput.supplierSkuList, ["RUG-40X60", "RUG-50X80"]);
  assert.equal(prepareCalled, false);
  assert.equal(recorded.result.shelfQuota.availableLimit, 0);
  assert.equal(recorded.result.directPublish, true);
  assert.equal(result.batch.state, "failed");
});

test("direct publish refreshes selected draft snapshots before reading publish candidates", async () => {
  const created = readyRow({
    id: "batch-refresh-before-publish",
    state: "queued",
    items: [{ ...readyRow().items[0], state: "queued" }],
  });
  let revalidated = null;
  let refreshed = 0;
  const service = new WebPublishBatchService({
    repository: {
      async create() { return created; },
      async get() {
        refreshed += 1;
        return created;
      },
      async recordPreflight(input) {
        return row({
          id: created.id,
          state: "failed",
          items: [{
            ...created.items[0],
            state: "failed",
            preflight: input.itemResults[0].preflight,
            last_error: input.itemResults[0].lastError,
          }],
        });
      },
    },
    revalidateDrafts(input) {
      revalidated = input;
      return { drafts: [], count: 0, skippedCount: 0 };
    },
    async preflightPublish() {
      return {
        passed: false,
        blockers: ["发布前只读预检阻断"],
      };
    },
    async preparePublishCandidate() {
      throw new Error("预检阻断后不得准备发布载荷");
    },
    executionQueue: { async add() { throw new Error("预检阻断后不得入队"); } },
    executionEnabled: true,
  });

  const result = await service.publishNow({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    input: {
      draftIds: ["draft-1"],
      idempotencyKey: "refresh-before-publish-1",
      confirmation: "CONFIRM_SHEIN_PRODUCT_PUBLISH",
    },
  });

  assert.deepEqual(revalidated, {
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    draftIds: ["draft-1"],
    force: true,
  });
  assert.equal(refreshed, 1);
  assert.equal(result.batch.state, "failed");
});

test("batch reads hydrate each item from the latest scoped product draft", async () => {
  const calls = [];
  const repository = new PostgresPublishBatchRepository({
    pool: {
      async query(input) {
        calls.push(input);
        if (calls.length === 1) {
          return { rows: [{ ...row(), items: undefined }] };
        }
        return {
          rows: [{
            ...row().items[0],
            batch_id: "batch-1",
            draft_data: { marker: "latest-draft-data" },
            draft_preflight: { marker: "latest-draft-preflight" },
          }],
        };
      },
    },
  });

  const result = await repository.get({
    tenantId: "tenant-1",
    storeId: "store-1",
    batchId: "batch-1",
  });

  assert.match(calls[1].text, /JOIN product_drafts d ON d\.id=i\.product_draft_id/);
  assert.match(calls[1].text, /d\.status AS draft_status/);
  assert.match(calls[1].text, /relaunch_parent\.parent_attempt_id AS rejected_parent_attempt_id/);
  assert.deepEqual(result.items[0].draft_data, { marker: "latest-draft-data" });
  assert.deepEqual(result.items[0].draft_preflight, {
    marker: "latest-draft-preflight",
  });
});

test("lists tenant-scoped readback status with explicit audit failure reasons only", async () => {
  let received = null;
  const service = new WebPublishBatchService({
    repository: {
      async listPublishReadbackStatus(input) {
        received = input;
        return [{
          id: "job-1",
          request_key: "request-1",
          state: "submitted",
          request_summary: {},
          effective_spu_name: "SPU-FROM-RECEIPT",
          effective_skc_names: ["SKC-FROM-RECEIPT"],
          shein_document_sn: "DOC-1",
          shein_version: "VERSION-1",
          last_error: {
            code: "20100",
            message: "剩余可发品额度为0，禁止发品",
            traceId: "TRACE-READBACK-1",
            details: [{ location: "店铺额度", messages: ["当前额度为0"] }],
          },
          trace_id: "TRACE-READBACK-1",
          readback: { spu: "completed", skcCount: 2, skuCount: 4 },
          updated_at: "2026-08-07T00:00:00.000Z",
          document_state: {
            status: "passed",
            occurredAt: "2026-08-06T23:00:00.000Z",
            auditState: 2,
            auditStateLabel: "passed",
            failedReasons: [],
          },
          readback_receipt: {
            status: "passed",
            occurredAt: "2026-08-06T23:01:00.000Z",
            summary: { skcCount: 2, skuCount: 4 },
            payload: { forbidden: true },
          },
          compliance_receipt: {
            status: "failed",
            occurredAt: "2026-08-06T23:02:00.000Z",
            summary: { blockers: [{ code: "GCC" }] },
            payload: { forbidden: true },
          },
          compliance_photo_submission: {
            status: "failed",
            occurredAt: "2026-08-06T23:03:00.000Z",
            summary: {
              packageCount: 2,
              bodyCount: 0,
              skcCount: 2,
              message: "图片绑定失败",
              code: "PHOTO_BIND_FAILED",
              traceId: "trace-photo",
            },
          },
        }];
      },
    },
    async preflightPublish() {},
    async preparePublishCandidate() {},
  });

  const result = await service.listReadbackStatus({
    context: { tenantId: "tenant-1" },
    storeId: "store-1",
    batchId: "batch-1",
  });

  assert.deepEqual(received, {
    tenantId: "tenant-1",
    storeId: "store-1",
    batchId: "batch-1",
  });
  assert.deepEqual(result, {
    batchId: "batch-1",
    readOnly: true,
    items: [{
      id: "job-1",
      draftId: null,
      requestKey: "request-1",
      jobState: "submitted",
      submittedAt: null,
      pendingTooLong: false,
      spuName: "SPU-FROM-RECEIPT",
      skcNames: ["SKC-FROM-RECEIPT"],
      version: "VERSION-1",
      documentSn: "DOC-1",
      documentState: {
        status: "passed",
        occurredAt: "2026-08-06T23:00:00.000Z",
        auditState: 2,
        auditStateLabel: "passed",
        failedReasons: [],
        traceId: "TRACE-READBACK-1",
      },
      resolution: {
        code: "official_passed",
        displayLabel: "审核通过",
        tab: "all",
        actionability: "continue_workflow",
        confidence: "high",
        asOf: "2026-08-06T23:00:00.000Z",
      },
      relationship: {
        status: "passed",
        occurredAt: "2026-08-06T23:01:00.000Z",
        skcCount: 2,
        skuCount: 4,
      },
      compliance: {
        status: "blocked",
        occurredAt: "2026-08-06T23:02:00.000Z",
        blockerCount: 1,
      },
      compliancePhotoSubmission: {
        status: "failed",
        occurredAt: "2026-08-06T23:03:00.000Z",
        packageCount: 2,
        bodyCount: 0,
        skcCount: 2,
        message: "图片绑定失败",
        code: "PHOTO_BIND_FAILED",
        traceId: "trace-photo",
      },
      lastError: {
        code: "20100",
        message: "剩余可发品额度为0，禁止发品",
        traceId: "TRACE-READBACK-1",
        details: [{ location: "店铺额度", messages: ["当前额度为0"] }],
      },
      updatedAt: "2026-08-07T00:00:00.000Z",
    }],
  });
  assert.equal(JSON.stringify(result).includes("forbidden"), false);
});

test("reads publish status from the dedicated execution repository", async () => {
  const received = [];
  const service = new WebPublishBatchService({
    repository: {},
    readbackRepository: {
      async listPublishReadbackStatus(input) {
        received.push(input);
        return [];
      },
    },
    async preflightPublish() {},
    async preparePublishCandidate() {},
  });

  const result = await service.listReadbackStatus({
    context: { tenantId: "tenant-1" },
    storeId: "store-1",
    batchId: "batch-1",
  });

  assert.deepEqual(received, [{
    tenantId: "tenant-1",
    storeId: "store-1",
    batchId: "batch-1",
  }]);
  assert.deepEqual(result, {
    batchId: "batch-1",
    readOnly: true,
    items: [],
  });
});

test("keeps an absent audit state absent instead of coercing null to zero", async () => {
  const service = new WebPublishBatchService({
    repository: {
      async listPublishReadbackStatus() {
        return [{
          id: "job-pending",
          request_key: "request-pending",
          state: "submitted",
          request_summary: {},
          document_state: {
            status: "pending",
            auditState: null,
            auditStateLabel: null,
            failedReasons: [],
          },
          readback: {},
          readback_receipt: {},
          compliance_receipt: {},
          compliance_photo_submission: {},
          last_error: null,
          updated_at: "2026-08-07T00:00:00.000Z",
        }];
      },
    },
    async preflightPublish() {},
    async preparePublishCandidate() {},
  });

  const result = await service.listReadbackStatus({
    context: { tenantId: "tenant-1" },
    storeId: "store-1",
    batchId: "batch-pending",
  });

  assert.equal(result.items[0].documentState.auditState, null);
});

test("preflights all multi-size SKUs and records per-draft readiness", async () => {
  const calls = [];
  const repository = {
    async get() {
      return row();
    },
    async setState(input) {
      calls.push(["state", input.batchState, input.itemState]);
      return row({ state: input.batchState });
    },
    async recordPreflight(input) {
      calls.push(["record", input.itemResults]);
      return row({
        state: "ready",
        items: row().items.map((item) => ({
          ...item,
          state: "ready",
          attempt_count: 1,
          preflight: input.itemResults[0].preflight,
        })),
      });
    },
  };
  let skuList = null;
  const service = new WebPublishBatchService({
    repository,
    async preflightPublish(input) {
      skuList = input.supplierSkuList;
      return {
        passed: true,
        blockers: [],
        permission: { canPublishProduct: true, reason: "" },
        shelfQuota: { availableLimit: 5 },
        supplierSkuCheck: { repeatedSkus: [] },
      };
    },
    async preparePublishCandidate(input) {
      return remoteCandidate(input.candidate);
    },
  });
  const result = await service.act({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    batchId: "batch-1",
    action: "preflight",
  });

  assert.deepEqual(skuList, ["RUG-40X60", "RUG-50X80"]);
  assert.deepEqual(calls[0], ["state", "preflighting", "preflighting"]);
  assert.equal(calls[1][1][0].state, "ready");
  assert.equal(
    calls[1][1][0].preflight.publishCandidateFingerprint,
    publishCandidate().fingerprint,
  );
  assert.equal(
    calls[1][1][0].preflight.remotePublishCandidate.state,
    "ready_for_publish_confirmation",
  );
  assert.equal(result.batch.state, "ready");
  assert.equal(result.publishingEnabled, false);
});

test("passes the previous remote candidate into a refreshed batch preflight", async () => {
  const previousRemoteCandidate = {
    state: "blocked",
    blockers: [{ code: "IMAGE_UPLOAD_FAILED", message: "旧图片上传失败" }],
  };
  const existing = row({
    state: "failed",
    items: [{
      ...row().items[0],
      state: "failed",
      preflight: { remotePublishCandidate: previousRemoteCandidate },
    }],
  });
  let receivedPrevious = null;
  const service = new WebPublishBatchService({
    repository: {
      async get() {
        return existing;
      },
      async setState() {
        return existing;
      },
      async recordPreflight(input) {
        return row({
          state: "ready",
          items: [{
            ...existing.items[0],
            state: "ready",
            preflight: input.itemResults[0].preflight,
          }],
        });
      },
    },
    async preflightPublish() {
      return {
        passed: true,
        blockers: [],
        permission: { canPublishProduct: true },
        shelfQuota: { availableLimit: 8 },
        supplierSkuCheck: {
          results: [
            { supplierSku: "RUG-40X60", repeated: false },
            { supplierSku: "RUG-50X80", repeated: false },
          ],
        },
      };
    },
    async preparePublishCandidate(input) {
      receivedPrevious = input.previousRemoteCandidate;
      return remoteCandidate(input.candidate);
    },
  });

  const result = await service.act({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    batchId: "batch-1",
    action: "preflight",
  });

  assert.equal(receivedPrevious, previousRemoteCandidate);
  assert.equal(result.batch.state, "ready");
});

test("blocks an old ready draft without an auditable publish candidate", async () => {
  let upstreamCalled = false;
  const oldDraftRow = row({
    items: [{
      ...row().items[0],
      draft_preflight: {},
    }],
  });
  const service = new WebPublishBatchService({
    repository: {
      async get() {
        return oldDraftRow;
      },
      async setState() {
        return oldDraftRow;
      },
      async recordPreflight(input) {
        return row({
          state: "failed",
          items: input.itemResults.map((item) => ({
            ...oldDraftRow.items[0],
            state: item.state,
            preflight: item.preflight,
            last_error: item.lastError,
          })),
        });
      },
    },
    async preflightPublish() {
      upstreamCalled = true;
    },
    async preparePublishCandidate() {
      throw new Error("must not run");
    },
  });

  const result = await service.act({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    batchId: "batch-1",
    action: "preflight",
  });

  assert.equal(upstreamCalled, false);
  assert.equal(result.batch.state, "failed");
  assert.match(result.batch.items[0].lastError, /可审计发布候选快照/);
});

test("refuses to preflight a paused batch", async () => {
  const service = new WebPublishBatchService({
    repository: {
      async get() {
        return row({ state: "paused" });
      },
    },
    async preflightPublish() {
      throw new Error("must not run");
    },
    async preparePublishCandidate() {
      throw new Error("must not run");
    },
  });

  await assert.rejects(
    service.act({
      context: { tenantId: "tenant-1", userId: "user-1" },
      storeId: "store-1",
      batchId: "batch-1",
      action: "preflight",
    }),
    /请先恢复/,
  );
});

test("does not block batch preflight when a configured rug report is pending", async () => {
  let upstreamCalled = false;
  const blockedRow = row({
    items: [{
      ...row().items[0],
      draft_data: {
        rugReportSources: {
          dimensions: [
            { attributeId: "length", unit: "cm" },
            { attributeId: "width", unit: "cm" },
          ],
        },
        sizeRows: [{ supplierSku: "RUG-40X60" }],
      },
      draft_preflight: {
        publishCandidate: publishCandidate(),
        rugReport: {
          reportType: null,
          blockers: [{
            code: "ATTRIBUTE_VALUE_MISSING",
            message: "商品属性“长度”未填写，无法判定 1630/1631",
          }],
        },
      },
    }],
  });
  const service = new WebPublishBatchService({
    repository: {
      async get() {
        return blockedRow;
      },
      async setState() {
        return blockedRow;
      },
      async recordPreflight(input) {
        return row({
          state: "ready",
          items: input.itemResults.map((item) => ({
            ...blockedRow.items[0],
            state: item.state,
            preflight: item.preflight,
            last_error: item.lastError,
          })),
        });
      },
    },
    async preflightPublish() {
      upstreamCalled = true;
      return { passed: true, blockers: [] };
    },
    async preparePublishCandidate({ candidate }) {
      return remoteCandidate(candidate);
    },
  });

  const result = await service.act({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    batchId: "batch-1",
    action: "preflight",
  });

  assert.equal(upstreamCalled, true);
  assert.equal(result.batch.state, "ready");
  assert.equal(result.batch.items[0].lastError, "");
});

test("does not block batch preflight when a threshold rug report is pending", async () => {
  let upstreamCalled = false;
  const blockedRow = row({
    items: [{
      ...row().items[0],
      draft_data: {
        rugReportSources: {
          thresholds: {
            longestEdge: {
              attributeId: "1001890",
              exceededValueId: "763",
              withinValueId: "459",
            },
            area: {
              attributeId: "1001889",
              exceededValueId: "763",
              withinValueId: "459",
            },
          },
        },
        sizeRows: [{ supplierSku: "RUG-40X60" }],
      },
      draft_preflight: {
        publishCandidate: publishCandidate(),
        rugReport: {
          reportType: null,
          blockers: [{
            code: "ATTRIBUTE_VALUE_MISSING",
            message: "商品属性尚未完成 1630/1631 判定",
          }],
        },
      },
    }],
  });
  const service = new WebPublishBatchService({
    repository: {
      async get() {
        return blockedRow;
      },
      async setState() {
        return blockedRow;
      },
      async recordPreflight(input) {
        return row({
          state: "ready",
          items: input.itemResults.map((item) => ({
            ...blockedRow.items[0],
            state: item.state,
            preflight: item.preflight,
            last_error: item.lastError,
          })),
        });
      },
    },
    async preflightPublish() {
      upstreamCalled = true;
      return { passed: true, blockers: [] };
    },
    async preparePublishCandidate({ candidate }) {
      return remoteCandidate(candidate);
    },
  });

  const result = await service.act({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    batchId: "batch-1",
    action: "preflight",
  });

  assert.equal(upstreamCalled, true);
  assert.equal(result.batch.state, "ready");
  assert.equal(result.batch.items[0].lastError, "");
});

test("confirms only a fully ready frozen batch without authorizing publishing", async () => {
  const existing = readyRow();
  let received = null;
  let upstreamCalled = false;
  const service = new WebPublishBatchService({
    repository: {
      async get() {
        return existing;
      },
      async confirm(input) {
        received = input;
        return readyRow({
          preflight: input.batchPreflight,
          items: existing.items.map((item) => ({
            ...item,
            preflight: input.itemResults[0].preflight,
          })),
        });
      },
    },
    async preflightPublish() {
      upstreamCalled = true;
    },
    async preparePublishCandidate() {
      upstreamCalled = true;
    },
    now: () => new Date("2026-08-05T06:30:00.000Z"),
  });

  const result = await service.act({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    batchId: "batch-1",
    action: "confirm",
  });

  assert.equal(upstreamCalled, false);
  assert.equal(received.batchPreflight.confirmation.confirmedBy, "user-1");
  assert.equal(
    received.batchPreflight.confirmation.confirmedAt,
    "2026-08-05T06:30:00.000Z",
  );
  assert.equal(
    received.batchPreflight.confirmation.authorizesPublishing,
    false,
  );
  assert.equal(received.itemResults[0].preflight.confirmation.state, "confirmed");
  assert.equal(result.batch.state, "ready");
  assert.equal(result.batch.confirmationState, "confirmed");
  assert.equal(result.publishingEnabled, false);
});

test("rejects confirmation when source or remote fingerprints are stale", async () => {
  for (const existing of [
    readyRow({
      items: [{
        ...readyRow().items[0],
        preflight: {
          ...readyRow().items[0].preflight,
          publishCandidateFingerprint: "changed-source",
        },
      }],
    }),
    readyRow({
      items: [{
        ...readyRow().items[0],
        preflight: {
          ...readyRow().items[0].preflight,
          remotePublishCandidate: {
            ...readyRow().items[0].preflight.remotePublishCandidate,
            fingerprint: "",
          },
        },
      }],
    }),
  ]) {
    const service = new WebPublishBatchService({
      repository: {
        async get() {
          return existing;
        },
        async confirm() {
          throw new Error("must not run");
        },
      },
      async preflightPublish() {
        throw new Error("must not run");
      },
      async preparePublishCandidate() {
        throw new Error("must not run");
      },
    });
    await assert.rejects(
      service.act({
        context: { tenantId: "tenant-1", userId: "user-1" },
        storeId: "store-1",
        batchId: "batch-1",
        action: "confirm",
      }),
      /快照已变化/,
    );
  }
});

test("rejects confirmation for paused, failed or partially ready batches", async () => {
  for (const existing of [
    readyRow({ state: "paused" }),
    readyRow({ state: "failed" }),
    readyRow({
      items: [{ ...readyRow().items[0], state: "failed" }],
    }),
  ]) {
    const service = new WebPublishBatchService({
      repository: {
        async get() {
          return existing;
        },
      },
      async preflightPublish() {},
      async preparePublishCandidate() {},
    });
    await assert.rejects(
      service.act({
        context: { tenantId: "tenant-1", userId: "user-1" },
        storeId: "store-1",
        batchId: "batch-1",
        action: "confirm",
      }),
      /仅可确认全部条目/,
    );
  }
});

test("repeating confirmation for the same frozen snapshot is idempotent", async () => {
  const first = readyRow();
  let confirmed = null;
  let confirmCalls = 0;
  const repository = {
    async get() {
      return confirmed || first;
    },
    async confirm(input) {
      confirmCalls += 1;
      confirmed = readyRow({
        preflight: input.batchPreflight,
        items: first.items.map((item) => ({
          ...item,
          preflight: input.itemResults[0].preflight,
        })),
      });
      return confirmed;
    },
  };
  const service = new WebPublishBatchService({
    repository,
    async preflightPublish() {
      throw new Error("must not run");
    },
    async preparePublishCandidate() {
      throw new Error("must not run");
    },
    now: () => new Date("2026-08-05T06:30:00.000Z"),
  });
  const input = {
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    batchId: "batch-1",
    action: "confirm",
  };

  const firstResult = await service.act(input);
  const secondResult = await service.act(input);

  assert.equal(confirmCalls, 1);
  assert.equal(
    secondResult.batch.preflight.confirmation.batchFingerprint,
    firstResult.batch.preflight.confirmation.batchFingerprint,
  );
  assert.equal(secondResult.publishingEnabled, false);
});

test("plans confirmed requests and the documented readback order without publishing", async () => {
  const existingBaseItem = confirmedRow().items[0];
  const existing = confirmedRow({
    items: [{
      ...existingBaseItem,
      draft_status: "published",
      rejected_parent_attempt_id: "job-old",
    }],
  });
  let received = null;
  let upstreamCalled = false;
  const service = new WebPublishBatchService({
    repository: {
      async get() {
        return existing;
      },
      async recordExecutionPlan(input) {
        received = input;
        return confirmedRow({ preflight: input.batchPreflight });
      },
    },
    async preflightPublish() {
      upstreamCalled = true;
    },
    async preparePublishCandidate() {
      upstreamCalled = true;
    },
    now: () => new Date("2026-08-05T07:30:00.000Z"),
  });

  const result = await service.act({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    batchId: "batch-1",
    action: "plan-execution",
  });

  const plan = received.batchPreflight.executionPlan;
  assert.equal(upstreamCalled, false);
  assert.equal(plan.state, "ready_for_execution_confirmation");
  assert.equal(plan.requestCount, 1);
  assert.equal(plan.skcCount, 1);
  assert.equal(plan.skuCount, 2);
  assert.equal(plan.executionEnabled, false);
  assert.equal(plan.authorizesPublishing, false);
  assert.ok(plan.fingerprint);
  assert.ok(plan.requests[0].requestKey);
  assert.equal(plan.requests[0].attemptReason, "rejected_relaunch");
  assert.equal(plan.requests[0].parentAttemptId, "job-old");
  assert.equal("requestBody" in plan.requests[0], false);
  assert.deepEqual(
    plan.readbackPlan.map((step) => step.source),
    [
      "publish_response",
      "/product_document_receive_status_notice",
      "/product_document_audit_status_notice",
      "/open-api/goods/query-document-state",
      "/open-api/goods/spu-info",
      "skc_compliance_revalidation",
    ],
  );
  assert.equal(result.batch.executionState, "planned");
  assert.equal(result.publishingEnabled, false);
});

test("execution planning requires the current confirmed batch fingerprint", async () => {
  const staleConfirmation = confirmedRow();
  staleConfirmation.preflight = {
    ...staleConfirmation.preflight,
    confirmation: {
      ...staleConfirmation.preflight.confirmation,
      batchFingerprint: "stale",
    },
  };
  for (const existing of [
    readyRow(),
    staleConfirmation,
  ]) {
    const service = new WebPublishBatchService({
      repository: {
        async get() {
          return existing;
        },
        async recordExecutionPlan() {
          throw new Error("must not run");
        },
      },
      async preflightPublish() {
        throw new Error("must not run");
      },
      async preparePublishCandidate() {
        throw new Error("must not run");
      },
    });
    await assert.rejects(
      service.act({
        context: { tenantId: "tenant-1", userId: "user-1" },
        storeId: "store-1",
        batchId: "batch-1",
        action: "plan-execution",
      }),
      /必须先确认当前冻结快照/,
    );
  }
});

test("execution planning enforces the official SKC and SKU request limits", async () => {
  const source = publishCandidate();
  const tooManySkcs = Array.from({ length: 41 }, (_, index) => ({
    supplier_code: `RUG-${index}`,
    sku_list: [{ supplier_sku: `RUG-${index}-SKU` }],
  }));
  const tooManySkus = [{
    supplier_code: "RUG-001",
    sku_list: Array.from({ length: 401 }, (_, index) => ({
      supplier_sku: `RUG-SKU-${index}`,
    })),
  }];
  for (const [skcList, message] of [
    [tooManySkcs, /1-40个SKC/],
    [tooManySkus, /1-400个SKU/],
  ]) {
    const requestBody = { ...source.requestBody, skc_list: skcList };
    const item = {
      ...readyRow().items[0],
      preflight: {
        ...readyRow().items[0].preflight,
        remotePublishCandidate: remoteCandidate(source, requestBody),
      },
    };
    const existing = confirmedRow({ items: [item] });
    const service = new WebPublishBatchService({
      repository: {
        async get() {
          return existing;
        },
      },
      async preflightPublish() {},
      async preparePublishCandidate() {},
    });
    await assert.rejects(
      service.act({
        context: { tenantId: "tenant-1", userId: "user-1" },
        storeId: "store-1",
        batchId: "batch-1",
        action: "plan-execution",
      }),
      message,
    );
  }
});

test("repeating execution planning for the same confirmed snapshot is idempotent", async () => {
  const first = confirmedRow();
  let planned = null;
  let planCalls = 0;
  const repository = {
    async get() {
      return planned || first;
    },
    async recordExecutionPlan(input) {
      planCalls += 1;
      planned = confirmedRow({ preflight: input.batchPreflight });
      return planned;
    },
  };
  const service = new WebPublishBatchService({
    repository,
    async preflightPublish() {
      throw new Error("must not run");
    },
    async preparePublishCandidate() {
      throw new Error("must not run");
    },
    now: () => new Date("2026-08-05T07:30:00.000Z"),
  });
  const input = {
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    batchId: "batch-1",
    action: "plan-execution",
  };

  const firstResult = await service.act(input);
  const secondResult = await service.act(input);

  assert.equal(planCalls, 1);
  assert.equal(
    secondResult.batch.preflight.executionPlan.fingerprint,
    firstResult.batch.preflight.executionPlan.fingerprint,
  );
  assert.equal(secondResult.publishingEnabled, false);
});

test("issues an idempotent expiring execution protocol without publishing", async () => {
  let current = confirmedRow();
  let protocolWrites = 0;
  let now = new Date("2026-08-05T08:00:00.000Z");
  const repository = {
    async get() {
      return current;
    },
    async recordExecutionPlan(input) {
      current = confirmedRow({ preflight: input.batchPreflight });
      return current;
    },
    async recordExecutionProtocol(input) {
      protocolWrites += 1;
      current = confirmedRow({ preflight: input.batchPreflight });
      return current;
    },
  };
  const service = new WebPublishBatchService({
    repository,
    async preflightPublish() {
      throw new Error("must not run");
    },
    async preparePublishCandidate() {
      throw new Error("must not run");
    },
    now: () => now,
    randomId: () => `authorization-${protocolWrites + 1}`,
  });
  const input = {
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    batchId: "batch-1",
  };

  await service.act({ ...input, action: "plan-execution" });
  const first = await service.act({ ...input, action: "authorize-execution" });
  const protocol = first.batch.preflight.executionProtocol;
  assert.equal(first.batch.executionState, "authorized");
  assert.equal(protocol.state, "issued");
  assert.equal(protocol.expiresAt, "2026-08-05T08:10:00.000Z");
  assert.equal(protocol.executionEnabled, false);
  assert.equal(protocol.authorizesPublishing, false);
  assert.equal(protocol.requests[0].state, "authorized");
  assert.equal(protocolWrites, 1);

  await service.act({ ...input, action: "authorize-execution" });
  assert.equal(protocolWrites, 1);

  now = new Date("2026-08-05T08:10:01.000Z");
  const renewed = await service.act({
    ...input,
    action: "authorize-execution",
  });
  assert.equal(protocolWrites, 2);
  assert.notEqual(
    renewed.batch.preflight.executionProtocol.authorizationId,
    protocol.authorizationId,
  );
  assert.equal(renewed.publishingEnabled, false);
});

test("execution authorization rejects a stale or missing execution plan", async () => {
  for (const executionPlan of [
    null,
    {
      state: "ready_for_execution_confirmation",
      fingerprint: "stale-plan",
      executionEnabled: false,
      authorizesPublishing: false,
    },
  ]) {
    const existing = confirmedRow({
      preflight: {
        ...confirmedRow().preflight,
        ...(executionPlan ? { executionPlan } : {}),
      },
    });
    const service = new WebPublishBatchService({
      repository: {
        async get() {
          return existing;
        },
        async recordExecutionProtocol() {
          throw new Error("must not run");
        },
      },
      async preflightPublish() {},
      async preparePublishCandidate() {},
    });
    await assert.rejects(
      service.act({
        context: { tenantId: "tenant-1", userId: "user-1" },
        storeId: "store-1",
        batchId: "batch-1",
        action: "authorize-execution",
      }),
      /执行计划已变化/,
    );
  }
});

test("real execution stays unavailable without the server execution gate", async () => {
  const existing = confirmedRow({
    preflight: {
      ...confirmedRow().preflight,
      executionPlan: {
        state: "ready_for_execution_confirmation",
        fingerprint: "plan-1",
        executionEnabled: false,
        authorizesPublishing: false,
      },
      executionProtocol: {
        state: "issued",
        executionRunId: "run-1",
      },
    },
  });
  const service = new WebPublishBatchService({
    repository: { async get() { return existing; } },
    async preflightPublish() {},
    async preparePublishCandidate() {},
    executionEnabled: false,
  });

  await assert.rejects(
    service.act({
      context: { tenantId: "tenant-1", userId: "user-1" },
      storeId: "store-1",
      batchId: "batch-1",
      action: "execute",
      confirmation: "CONFIRM_SHEIN_PRODUCT_PUBLISH",
    }),
    (error) => error?.code === "PRODUCT_PUBLISH_EXECUTION_DISABLED",
  );
});

test("execute consumes the exact one-time protocol and returns after durable handoff", async () => {
  let current = confirmedRow();
  let protocolWrites = 0;
  let consumeCalls = 0;
  let queueCalls = 0;
  const repository = {
    async get() { return current; },
    async recordExecutionPlan(input) {
      current = confirmedRow({ preflight: input.batchPreflight });
      return current;
    },
    async recordExecutionProtocol(input) {
      protocolWrites += 1;
      current = confirmedRow({
        preflight: {
          ...input.batchPreflight,
          executionProtocol: {
            ...input.batchPreflight.executionProtocol,
            executionRunId: "run-1",
          },
        },
      });
      return current;
    },
    async consumeExecutionProtocol(input) {
      consumeCalls += 1;
      current = confirmedRow({ preflight: input.batchPreflight });
      return current;
    },
  };
  const service = new WebPublishBatchService({
    repository,
    async preflightPublish() {},
    async preparePublishCandidate() {},
    executionQueue: {
      async add() {
        queueCalls += 1;
      },
    },
    executionEnabled: true,
    now: () => new Date("2026-08-22T01:00:00.000Z"),
    randomId: () => "authorization-1",
  });
  const input = {
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    batchId: "batch-1",
  };
  await service.act({ ...input, action: "plan-execution" });
  await service.act({ ...input, action: "authorize-execution" });
  await assert.rejects(
    service.act({ ...input, action: "execute" }),
    (error) => error?.code === "PRODUCT_PUBLISH_CONFIRMATION_REQUIRED",
  );
  assert.equal(consumeCalls, 0);
  const first = await service.act({
    ...input,
    action: "execute",
    confirmation: "CONFIRM_SHEIN_PRODUCT_PUBLISH",
  });
  const second = await service.act({
    ...input,
    action: "execute",
    confirmation: "CONFIRM_SHEIN_PRODUCT_PUBLISH",
  });

  assert.equal(protocolWrites, 1);
  assert.equal(consumeCalls, 1);
  assert.equal(queueCalls, 0);
  assert.equal(first.batch.executionState, "running");
  assert.equal(first.executionStage, "queued");
  assert.equal(second.executionQueued, true);
  assert.equal(second.executionStage, "queued");
  assert.equal(second.idempotentReplay, true);
});

test("does not couple durable execution handoff to an inline queue add", async () => {
  let current = confirmedRow();
  let queueCalls = 0;
  const repository = {
    async get() { return current; },
    async recordExecutionPlan(input) {
      current = confirmedRow({ preflight: input.batchPreflight });
      return current;
    },
    async recordExecutionProtocol(input) {
      current = confirmedRow({
        preflight: {
          ...input.batchPreflight,
          executionProtocol: {
            ...input.batchPreflight.executionProtocol,
            executionRunId: "run-queue-failure",
          },
        },
      });
      return current;
    },
    async consumeExecutionProtocol(input) {
      current = confirmedRow({ preflight: input.batchPreflight });
      return current;
    },
  };
  const service = new WebPublishBatchService({
    repository,
    async preflightPublish() {},
    async preparePublishCandidate() {},
    executionQueue: {
      async add() {
        queueCalls += 1;
        throw new Error("inline queue must not be called");
      },
    },
    executionEnabled: true,
    now: () => new Date("2026-08-22T01:00:00.000Z"),
    randomId: () => "authorization-queue-failure",
  });
  const input = {
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    batchId: "batch-1",
  };
  await service.act({ ...input, action: "plan-execution" });
  await service.act({ ...input, action: "authorize-execution" });

  const result = await service.act({
    ...input,
    action: "execute",
    confirmation: "CONFIRM_SHEIN_PRODUCT_PUBLISH",
  });
  assert.equal(queueCalls, 0);
  assert.equal(result.executionQueued, true);
  assert.equal(result.executionStage, "queued");
});
