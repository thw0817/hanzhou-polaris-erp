import assert from "node:assert/strict";
import test from "node:test";
import {
  createDefaultWebhookProductionHandlers,
  projectProductDocumentReceiveStatusNotice,
  projectProductDocumentAuditStatusNotice,
  projectProductQuotaChangeNotice,
  projectProductComplianceChangeNotice,
  projectAuthorizationChangeNotice,
  projectOutOfStockNotice,
  projectUndocumentedWebhookEvent,
} from "./webhook-production-projections.js";

test("projects the documented product receive event into one record per document detail", () => {
  const result = projectProductDocumentReceiveStatusNotice({
    spu_name: "SPU-1",
    received_success: 1,
    document_details: [{
      document_sn: "DOC-1",
      version: "7",
      skc_name: "SKC-1",
      sku_list: [
        { seller_sku: "SUP-1", sku_code: "SKU-1" },
        { seller_sku: "SUP-2", sku_code: "SKU-2" },
      ],
    }],
  });

  assert.equal(result.projectionVersion, "product-document-receive-v1");
  assert.equal(result.summary.disposition, "read-only-receive-projection");
  assert.equal(result.summary.acceptedRecordCount, 1);
  assert.deepEqual(result.projection.records[0], {
    spuName: "SPU-1",
    skcName: "SKC-1",
    skuCodes: ["SKU-1", "SKU-2"],
    supplierSkus: ["SUP-1", "SUP-2"],
    documentSn: "DOC-1",
    version: "7",
    receivedSuccess: true,
    status: "accepted",
    failedReasons: [],
    detailIndex: 0,
  });
});

test("accepts documented JSON-string data wrappers", () => {
  const result = projectProductDocumentReceiveStatusNotice({
    data: JSON.stringify({
      received_success: false,
      document_details: [{ document_sn: "DOC-STRING" }],
    }),
  });

  assert.equal(result.projection.records[0].documentSn, "DOC-STRING");
  assert.equal(result.projection.records[0].status, "failed");
});

test("projects the documented product audit event without external writes", () => {
  const result = projectProductDocumentAuditStatusNotice({
    spu_name: "SPU-1",
    skc_name: "SKC-1",
    sku_list: [{ sku_code: "SKU-1" }, { sku_code: "SKU-2" }],
    document_sn: "DOC-1",
    version: "3",
    audit_time: "2026-07-31 15:00:00",
    audit_state: 3,
    failed_reason: [{ language: "en", content: "Missing material label" }],
  });

  assert.equal(result.projectionVersion, "product-document-audit-v1");
  assert.equal(result.mode, "dry-run");
  assert.equal(result.externalWrite, false);
  assert.equal(result.summary.disposition, "read-only-audit-projection");
  assert.equal(result.summary.failedRecordCount, 1);
  assert.deepEqual(result.projection.records[0].skuCodes, ["SKU-1", "SKU-2"]);
});

test("preserves an explicit SHEIN workflow stage in the audit projection", () => {
  const result = projectProductDocumentAuditStatusNotice({
    version: "VERSION-STAGE",
    skc_name: "SKC-STAGE",
    audit_state: 1,
    workflow_stage: "awaiting_final_review",
  });

  assert.equal(result.projection.records[0].workflowStage, "awaiting_final_review");
});

test("unwraps the documented data object and maps audit states", () => {
  const result = projectProductDocumentAuditStatusNotice({
    data: {
      document_sn: "DOC-2",
      audit_state: 2,
    },
  });

  assert.equal(result.projection.records[0].auditStateLabel, "passed");
  assert.equal(result.summary.recordCount, 1);
});

test("rejects unknown audit states and untraceable records", async () => {
  assert.throws(
    () =>
      projectProductDocumentAuditStatusNotice({
        audit_state: 99,
        skc_name: "SKC-1",
      }),
    /audit_state 不受支持/,
  );
  assert.throws(
    () =>
      projectProductDocumentAuditStatusNotice({
        audit_state: 2,
      }),
    /缺少可追踪的商品标识/,
  );
});

test("registers the subscribed production handlers and keeps unrelated events closed", () => {
  const handlers = createDefaultWebhookProductionHandlers();
  assert.equal(typeof handlers.product_document_receive_status_notice, "function");
  assert.equal(typeof handlers.product_document_audit_status_notice, "function");
  assert.equal(typeof handlers.product_quota_change_notice, "function");
  assert.equal(typeof handlers.product_compliance_change_notice, "function");
  assert.equal(typeof handlers.authorization_change_notice, "function");
  assert.equal(typeof handlers.out_of_stock_notice, "function");
  assert.equal(typeof handlers.product_video_conversion_completed, "function");
  assert.equal(
    typeof handlers.product_document_audit_status_notice_all_channels,
    "function",
  );
  assert.equal(handlers.order_push_notice, undefined);
});

test("projects the documented quota change event through a data wrapper", () => {
  const result = projectProductQuotaChangeNotice({
    data: JSON.stringify({
      supplierId: "SUP-1",
      reason: "quota replenished",
      availableLimit: 12,
      sendTimeStamp: 1751008118526,
    }),
  });

  assert.equal(result.projectionVersion, "product-quota-change-v1");
  assert.equal(result.summary.disposition, "read-only-quota-projection");
  assert.deepEqual(result.projection.records[0], {
    supplierId: "SUP-1",
    reason: "quota replenished",
    availableLimit: "12",
    sendTimestamp: "1751008118526",
  });
});

test("projects compliance invalidation and authorization change events without writes", () => {
  const compliance = projectProductComplianceChangeNotice({
    skc: "SKC-1",
    complianceTypeId: 3,
    isMiss: 1,
    isRequired: 1,
    updateTime: "2026-08-22 14:00:00",
    supplierId: "SUP-1",
  });
  assert.equal(compliance.summary.invalidationCount, 1);
  assert.equal(compliance.projection.records[0].complianceTypeId, "3");
  assert.equal(compliance.externalWrite, false);

  const authorization = projectAuthorizationChangeNotice({
    data: { type: 2, srmSupplierId: "SUP-1", message: "key reset" },
  });
  assert.equal(
    authorization.summary.disposition,
    "read-only-authorization-change-projection",
  );
  assert.deepEqual(authorization.projection.records[0], {
    type: "2",
    srmSupplierId: "SUP-1",
    message: "key reset",
  });
});

test("projects out-of-stock notices with SKU-level quantities", () => {
  const result = projectOutOfStockNotice({
    skcName: "SKC-1",
    skuCode: "SKU-1",
    outOfStockQty: 4,
    tempLockExceptionQty: 1,
    sendTimestamp: 1751008118526,
  });

  assert.equal(result.projectionVersion, "out-of-stock-v1");
  assert.equal(result.summary.disposition, "local-out-of-stock-projection");
  assert.deepEqual(result.projection.records[0], {
    skcName: "SKC-1",
    skuCode: "SKU-1",
    outOfStockQty: 4,
    tempLockExceptionQty: 1,
    sendTimestamp: "1751008118526",
  });
});

test("stores the all-channel audit event without guessing undocumented fields", () => {
  const result = projectUndocumentedWebhookEvent({
    arbitrary_platform_field: "value",
  });

  assert.equal(result.mode, "stored-only");
  assert.equal(result.externalWrite, false);
  assert.deepEqual(result.projection.records, []);
  assert.equal(result.summary.disposition, "stored-only-undocumented-payload");
});

test("persists only scoped normalized receipt summaries when a repository is provided", async () => {
  let input = null;
  const handlers = createDefaultWebhookProductionHandlers({
    publishExecutionRepository: {
      async appendWebhookReceipts(value) {
        input = value;
        return {
          matchedCount: 1,
          persistedCount: 1,
          ambiguousCount: 0,
          unmatchedCount: [],
        };
      },
    },
  });

  const result = await handlers.product_document_receive_status_notice(
    {
      received_success: true,
      document_details: [{ document_sn: "DOC-1", version: "7" }],
    },
    {
      id: "event-1",
      tenant_id: "tenant-1",
      store_id: "store-1",
    },
  );

  assert.equal(result.summary.persistedCount, 1);
  assert.equal(input.tenantId, "tenant-1");
  assert.equal(input.storeId, "store-1");
  assert.equal(input.webhookEventId, "event-1");
  assert.equal(input.receiptType, "received");
  assert.equal(input.records[0].documentSn, "DOC-1");
});

test("projects all-channel audit notices into the review state repository", async () => {
  let persisted = null;
  const handlers = createDefaultWebhookProductionHandlers({
    productReviewRepository: {
      async saveDocumentStates(input) {
        persisted = input;
        return { savedCount: input.records.length };
      },
    },
  });

  const result = await handlers.product_document_audit_status_notice_all_channels(
    {
      data: {
        version: "VERSION-ALL-CHANNEL",
        skc_name: "SKC-ALL-CHANNEL",
        audit_state: 3,
        audit_time: "2026-08-26 10:00:00",
        failed_reason: [{ language: "zh-cn", content: "平台驳回" }],
      },
    },
    { id: "event-all-channel", tenant_id: "tenant-1", store_id: "store-1" },
  );

  assert.equal(result.projectionVersion, "product-document-audit-v1");
  assert.equal(result.projection.reviewStatePersistence.savedCount, 1);
  assert.equal(persisted.tenantId, "tenant-1");
  assert.equal(persisted.storeId, "store-1");
  assert.equal(persisted.records[0].auditState, 3);
});

test("keeps application-level document events processed when store scope is unavailable", async () => {
  let called = false;
  const handlers = createDefaultWebhookProductionHandlers({
    publishExecutionRepository: {
      async appendWebhookReceipts() {
        called = true;
        throw new Error("must not persist without event scope");
      },
    },
  });

  const result = await handlers.product_document_receive_status_notice(
    {
      received_success: true,
      document_details: [{ document_sn: "DOC-APP" }],
    },
    { id: "event-app-level" },
  );

  assert.equal(called, false);
  assert.equal(result.summary.persistenceSkipped, true);
  assert.equal(result.projection.persistence.reason, "WEBHOOK_EVENT_SCOPE_UNAVAILABLE");
  assert.equal(result.summary.unmatchedCount, 1);
});

test("uses a unique platform identity fallback for an unscoped document event", async () => {
  let input = null;
  const handlers = createDefaultWebhookProductionHandlers({
    publishExecutionRepository: {
      async appendUnscopedWebhookReceipts(value) {
        input = value;
        return {
          matchedCount: 1,
          persistedCount: 1,
          ambiguousCount: 0,
          unmatchedCount: [],
        };
      },
    },
  });

  const result = await handlers.product_document_receive_status_notice(
    {
      received_success: true,
      document_details: [{
        document_sn: "DOC-UNSCOPED",
        version: "VERSION-UNSCOPED",
      }],
    },
    { id: "event-unscoped" },
  );

  assert.equal(input.webhookEventId, "event-unscoped");
  assert.equal(input.receiptType, "received");
  assert.equal(result.summary.persistedCount, 1);
  assert.equal(result.summary.persistenceSkipped, false);
  assert.equal(result.projection.persistence.scopeFallback, true);
});

test("projects subscribed business events into local state when a repository is provided", async () => {
  const calls = [];
  const handlers = createDefaultWebhookProductionHandlers({
    stateRepository: {
      async saveQuotaProjection(input) {
        calls.push(["quota", input]);
        return { matchedCount: 2, storeIds: ["store-1", "store-2"] };
      },
      async markComplianceInvalidated(input) {
        calls.push(["compliance", input]);
        return { matchedCount: 1, skcIds: ["skc-1"] };
      },
      async requireReauthorizationBySupplierId(input) {
        calls.push(["authorization", input]);
        return ["store-3"];
      },
    },
  });

  const quota = await handlers.product_quota_change_notice(
    { supplierId: "SUP-1", reason: "limit changed", availableLimit: 0, sendTimeStamp: 7 },
    { id: "event-quota", tenant_id: "tenant-1", store_id: "store-1" },
  );
  const compliance = await handlers.product_compliance_change_notice(
    { skc: "SKC-1", supplierId: "SUP-1", complianceTypeId: 3, isMiss: 1 },
    { id: "event-compliance", tenant_id: "tenant-1", store_id: "store-1" },
  );
  const authorization = await handlers.authorization_change_notice(
    { type: 1, srmSupplierId: "SUP-1", message: "unbound" },
    { id: "event-auth", tenant_id: "tenant-1", store_id: "store-1" },
  );

  assert.equal(quota.summary.quotaStoreCount, 2);
  assert.equal(compliance.summary.complianceSkcCount, 1);
  assert.equal(authorization.summary.reauthorizationStoreCount, 1);
  assert.deepEqual(calls.map(([name]) => name), ["quota", "compliance", "authorization"]);
  assert.equal(calls[0][1].webhookEventId, "event-quota");
  assert.equal(calls[1][1].webhookEventId, "event-compliance");
  assert.equal(calls[0][1].tenantId, "tenant-1");
  assert.equal(calls[0][1].storeId, "store-1");
  assert.equal(calls[1][1].tenantId, "tenant-1");
  assert.equal(calls[1][1].storeId, "store-1");
  assert.deepEqual(calls[2][1], {
    supplierId: "SUP-1",
    tenantId: "tenant-1",
    storeId: "store-1",
    webhookEventId: "event-auth",
  });
});

test("does not mutate business state for an unscoped production event", async () => {
  const calls = [];
  const handlers = createDefaultWebhookProductionHandlers({
    stateRepository: {
      async saveQuotaProjection(input) { calls.push(input); return { matchedCount: 1 }; },
    },
  });
  const result = await handlers.product_quota_change_notice(
    { supplierId: "SUP-1", reason: "limit changed", availableLimit: 8, sendTimeStamp: 7 },
    { id: "event-unscoped" },
  );
  assert.equal(calls.length, 0);
  assert.equal(result.summary.quotaStoreCount, 0);
  assert.equal(result.summary.scopeRequired, true);
});
