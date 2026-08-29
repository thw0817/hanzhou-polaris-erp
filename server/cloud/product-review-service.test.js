import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeProductReviewEvents,
  normalizeWorkflowStageValue,
  PostgresProductReviewRepository,
  WebProductReviewService,
} from "./product-review-service.js";

test("normalizes SHEIN workflow aliases before review-center classification", () => {
  assert.equal(normalizeWorkflowStageValue("pending_price"), "awaiting_price");
  assert.equal(normalizeWorkflowStageValue("待核价"), "awaiting_price");
  assert.equal(normalizeWorkflowStageValue("已接收，待审核"), "awaiting_review");
  assert.equal(normalizeWorkflowStageValue("unknown-platform-stage"), null);
});

test("generic status cannot move an audit record into another workflow stage", () => {
  const items = normalizeProductReviewEvents([{
    id: "event-generic-status",
    event_type: "product_document_audit_status_notice_all_channels",
    received_at: "2026-08-26T02:00:00.000Z",
    payload: {
      data: JSON.stringify({
        version: "VERSION-GENERIC-STATUS",
        skc_name: "SKC-GENERIC-STATUS",
        audit_state: 1,
        status: "待核价",
      }),
    },
  }]);

  assert.equal(items[0].workflowStage, "awaiting_review");
});

test("normalizes all-channel audit events without changing webhook projection rules", () => {
  const items = normalizeProductReviewEvents([{
    id: "event-1",
    event_type: "product_document_audit_status_notice_all_channels",
    received_at: "2026-08-24T06:00:00.000Z",
    payload: {
      data: JSON.stringify({
        version: "VERSION-1",
        document_sn: "DOC-1",
        spu_name: "SPU-1",
        skc_name: "SKC-1",
        sku_list: [{ sku_code: "SKU-1" }],
        audit_state: 3,
        audit_time: "2026-08-24 14:00:00",
      }),
    },
  }]);

  assert.equal(items.length, 1);
  assert.equal(items[0].reviewKey, "version:VERSION-1");
  assert.equal(items[0].auditStateLabel, "failed");
  assert.deepEqual(items[0].skuCodes, ["SKU-1"]);
  assert.deepEqual(items[0].failedReasons, []);
});

test("normalizes accepted product receive events as traceable review-center rows", () => {
  const items = normalizeProductReviewEvents([{
    id: "event-received",
    event_type: "product_document_receive_status_notice",
    received_at: "2026-08-24T06:00:00.000Z",
    projection: {
      records: [{
        version: "VERSION-RECEIVED",
        documentSn: "DOC-RECEIVED",
        spuName: "SPU-RECEIVED",
        skcName: "SKC-RECEIVED",
        receivedSuccess: true,
        status: "accepted",
        failedReasons: [],
      }],
    },
  }]);

  assert.equal(items.length, 1);
  assert.equal(items[0].reviewKey, "version:VERSION-RECEIVED");
  assert.equal(items[0].reviewStage, "received");
  assert.equal(items[0].receiveStatus, "accepted");
  assert.equal(items[0].auditStateLabel, "unknown");
});

test("official rejection always wins over a conflicting raw workflow label", () => {
  const items = normalizeProductReviewEvents([{
    id: "event-conflict",
    event_type: "product_document_audit_status_notice_all_channels",
    received_at: "2026-08-25T06:00:00.000Z",
    payload: {
      data: JSON.stringify({
        version: "VERSION-CONFLICT",
        skc_name: "SKC-CONFLICT",
        audit_state: 3,
        status: "passed",
      }),
    },
  }]);

  assert.equal(items[0].workflowStage, "rejected");
  assert.equal(items[0].auditStateLabel, "failed");
});

test("snake-case failed audit label wins when the numeric audit state is absent", () => {
  const items = normalizeProductReviewEvents([{
    id: "event-label-only-failure",
    event_type: "product_document_audit_status_notice_all_channels",
    received_at: "2026-08-25T06:00:00.000Z",
    payload: {
      data: JSON.stringify({
        version: "VERSION-LABEL-ONLY",
        skc_name: "SKC-LABEL-ONLY",
        status: "pending_review",
        audit_state_label: "failed",
      }),
    },
  }]);

  assert.equal(items[0].workflowStage, "rejected");
  assert.equal(items[0].auditStateLabel, "failed");
});

test("review center uses persisted document state, hides archived and listed products", async () => {
  const service = new WebProductReviewService({
    repository: {
      async listSources() {
        return {
          events: [
            {
              id: "event-failed",
              event_type: "product_document_audit_status_notice_all_channels",
              received_at: "2026-08-24T06:00:00.000Z",
              payload: { data: JSON.stringify({ version: "VERSION-FAILED", skc_name: "SKC-FAILED", audit_state: 3 }) },
            },
            {
              id: "event-listed",
              event_type: "product_document_audit_status_notice_all_channels",
              received_at: "2026-08-24T06:01:00.000Z",
              payload: { data: JSON.stringify({ version: "VERSION-LISTED", skc_name: "SKC-LISTED", audit_state: 2 }) },
            },
            {
              id: "event-archived",
              event_type: "product_document_audit_status_notice_all_channels",
              received_at: "2026-08-24T06:02:00.000Z",
              payload: { data: JSON.stringify({ version: "VERSION-ARCHIVED", skc_name: "SKC-ARCHIVED", audit_state: 1 }) },
            },
          ],
          states: [{
            review_key: "version:VERSION-FAILED",
            version: "VERSION-FAILED",
            audit_state: 3,
            audit_state_label: "failed",
            failed_reasons: [{ language: "zh-cn", content: "主图不符合要求" }],
            occurred_at: "2026-08-24T06:03:00.000Z",
          }],
          products: [
            { skc_name: "SKC-FAILED", shelf_status: null, title: "待修正地毯", raw_data: { businessSnapshot: { imageUrl: "https://img.example/failed.jpg", sampleInfo: { reserveSampleFlag: 1, sampleCode: "SAMPLE-1" } } } },
            { skc_name: "SKC-LISTED", shelf_status: "已上架", title: "已上架地毯", raw_data: {} },
          ],
          archivedKeys: ["version:VERSION-ARCHIVED", "draft:DRAFT-HIDDEN"],
          localDrafts: [{
            review_key: "version:VERSION-FAILED",
            product_draft_id: "DRAFT-1",
            draft_title: "本地草稿标题",
            main_asset_id: "ASSET-MAIN-1",
          }],
        };
      },
    },
  });

  const result = await service.list({
    context: { tenantId: "tenant-1" },
    storeId: "store-1",
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].skcName, "SKC-FAILED");
  assert.equal(result.items[0].failedReasons[0].content, "主图不符合要求");
  assert.equal(result.items[0].localDraftId, "DRAFT-1");
  assert.equal(result.items[0].localMainAssetId, "ASSET-MAIN-1");
  assert.equal(result.items[0].imageUrl, "https://img.example/failed.jpg");
  assert.equal(result.items[0].sample.sampleCode, "SAMPLE-1");
  assert.equal(result.items[0].resolution.code, "official_rejected");
  assert.equal(result.items[0].resolution.tab, "rejected");
  assert.deepEqual(result.archivedKeys, ["version:VERSION-ARCHIVED", "draft:DRAFT-HIDDEN"]);
});

test("review center falls back to the local draft title and main asset before an SKC cache exists", async () => {
  const service = new WebProductReviewService({
    repository: {
      async listSources() {
        return {
          events: [],
          states: [{
            review_key: "version:VERSION-PENDING",
            version: "VERSION-PENDING",
            skc_name: "SKC-PENDING",
            sku_codes: [],
            audit_state: 1,
            audit_state_label: "pending",
            failed_reasons: [],
          }],
          products: [],
          archivedKeys: [],
          localDrafts: [{
            review_key: "version:VERSION-PENDING",
            product_draft_id: "DRAFT-PENDING",
            draft_title: "待审核地毯",
            main_asset_id: "ASSET-PENDING",
          }],
        };
      },
    },
  });

  const result = await service.list({
    context: { tenantId: "tenant-1" },
    storeId: "store-1",
  });

  assert.equal(result.items[0].title, "待审核地毯");
  assert.equal(result.items[0].imageUrl, "");
  assert.equal(result.items[0].localMainAssetId, "ASSET-PENDING");
  assert.equal(result.items[0].resolution.code, "official_awaiting_review");
  assert.equal(result.items[0].resolution.tab, "awaiting_review");
});

test("review center includes persisted document states even when an audit webhook was missed", async () => {
  const service = new WebProductReviewService({
    repository: {
      async listSources() {
        return {
          events: [],
          states: [{
            review_key: "version:VERSION-HISTORICAL",
            version: "VERSION-HISTORICAL",
            document_sn: "DOC-HISTORICAL",
            spu_name: "SPU-HISTORICAL",
            skc_name: "SKC-HISTORICAL",
            sku_codes: [],
            audit_state: 3,
            audit_state_label: "failed",
            failed_reasons: [{ language: "zh-cn", content: "商品属性不完整" }],
            occurred_at: "2026-08-24T06:03:00.000Z",
            updated_at: "2026-08-24T06:03:00.000Z",
          }],
          products: [],
          archivedKeys: [],
          localDrafts: [],
        };
      },
    },
  });

  const result = await service.list({
    context: { tenantId: "tenant-1" },
    storeId: "store-1",
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].reviewStage, "document_state");
  assert.equal(result.items[0].auditStateLabel, "failed");
  assert.equal(result.items[0].failedReasons[0].content, "商品属性不完整");
});

test("persisted stale workflow stage cannot override the official rejection state", async () => {
  const service = new WebProductReviewService({
    repository: {
      async listSources() {
        return {
          events: [],
          states: [{
            review_key: "version:VERSION-STALE-STAGE",
            version: "VERSION-STALE-STAGE",
            skc_name: "SKC-STALE-STAGE",
            audit_state: 3,
            audit_state_label: "failed",
            workflow_stage: "awaiting_review",
            failed_reasons: [{ language: "zh-cn", content: "平台驳回" }],
          }],
          products: [],
          archivedKeys: [],
          localDrafts: [],
        };
      },
    },
  });

  const result = await service.list({
    context: { tenantId: "tenant-1" },
    storeId: "store-1",
  });

  assert.equal(result.items[0].workflowStage, "rejected");
});

test("a relaunch makes the newest SHEIN version current for the SKC", async () => {
  const service = new WebProductReviewService({
    repository: {
      async listSources() {
        return {
          events: [{
            id: "event-old-rejection",
            event_type: "product_document_audit_status_notice_all_channels",
            received_at: "2026-08-25T06:00:00.000Z",
            payload: { data: JSON.stringify({
              version: "VERSION-OLD",
              skc_name: "SKC-RELAUNCHED",
              audit_state: 3,
              audit_time: "2026-08-25T06:00:00.000Z",
            }) },
          }],
          states: [{
            review_key: "version:VERSION-NEW",
            version: "VERSION-NEW",
            skc_name: "SKC-RELAUNCHED",
            audit_state: 1,
            audit_state_label: "pending",
            failed_reasons: [],
            occurred_at: "2026-08-25T06:05:00.000Z",
          }],
          products: [],
          archivedKeys: [],
          localDrafts: [
            {
              review_key: "version:VERSION-NEW",
              product_draft_id: "DRAFT-RELAUNCHED",
              draft_status: "published",
              draft_title: "重新发起的地毯",
              main_asset_id: "ASSET-RELAUNCHED",
              publish_job_id: "JOB-NEW",
              version: "VERSION-NEW",
              job_updated_at: "2026-08-25T06:04:00.000Z",
              request_skc_names: ["SKC-RELAUNCHED"],
            },
            {
              review_key: "version:VERSION-OLD",
              product_draft_id: "DRAFT-OLD",
              draft_status: "published",
              publish_job_id: "JOB-OLD",
              version: "VERSION-OLD",
              job_updated_at: "2026-08-25T05:00:00.000Z",
              request_skc_names: ["SKC-RELAUNCHED"],
            },
          ],
        };
      },
    },
  });

  const result = await service.list({
    context: { tenantId: "tenant-1" },
    storeId: "store-1",
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].version, "VERSION-NEW");
  assert.equal(result.items[0].workflowStage, "awaiting_review");
  assert.equal(result.items[0].launchCount, 2);
  assert.equal(result.items[0].rejectionCount, 1);
});

test("a new local attempt without a SHEIN version supersedes an old rejected version", async () => {
  const service = new WebProductReviewService({
    repository: {
      async listSources() {
        return {
          events: [{
            id: "event-old-no-version-rejection",
            event_type: "product_document_audit_status_notice_all_channels",
            received_at: "2026-08-25T06:00:00.000Z",
            payload: { data: JSON.stringify({
              version: "VERSION-OLD-NO-VERSION",
              skc_name: "SKC-NO-VERSION-RELAUNCH",
              audit_state: 3,
              audit_time: "2026-08-25T06:00:00.000Z",
            }) },
          }],
          states: [],
          products: [],
          archivedKeys: [],
          localDrafts: [
            {
              review_key: "version:VERSION-OLD-NO-VERSION",
              product_draft_id: "DRAFT-OLD-NO-VERSION",
              draft_status: "published",
              publish_job_id: "JOB-OLD-NO-VERSION",
              version: "VERSION-OLD-NO-VERSION",
              job_created_at: "2026-08-25T06:00:00.000Z",
              job_updated_at: "2026-08-25T06:00:00.000Z",
              request_skc_names: ["SKC-NO-VERSION-RELAUNCH"],
            },
            {
              review_key: "job:JOB-NEW-NO-VERSION",
              product_draft_id: "DRAFT-NEW-NO-VERSION",
              draft_status: "ready",
              publish_job_id: "JOB-NEW-NO-VERSION",
              request_key: "request-new-no-version",
              version: null,
              publish_job_state: "submitted",
              job_created_at: "2026-08-25T06:05:00.000Z",
              job_updated_at: "2026-08-25T06:05:00.000Z",
              request_skc_names: ["SKC-NO-VERSION-RELAUNCH"],
            },
          ],
        };
      },
    },
  });

  const result = await service.list({ context: { tenantId: "tenant-1" }, storeId: "store-1" });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].reviewKey, "job:JOB-NEW-NO-VERSION");
  assert.equal(result.items[0].version, null);
  assert.equal(result.items[0].attempt.current, true);
  assert.equal(result.items[0].attempt.localAttemptId, "JOB-NEW-NO-VERSION");
  assert.equal(result.items[0].attempt.requestKey, "request-new-no-version");
  assert.equal(result.items[0].attemptHistory.length, 2);
  assert.equal(result.items[0].attemptHistory[1].localAttemptId, "JOB-OLD-NO-VERSION");
  assert.equal(result.items[0].auditStateLabel, "unknown");
  assert.equal(result.items[0].submissionState, "awaiting_readback");
});

test("a versionless terminal local failure keeps the old official rejection actionable", async () => {
  const service = new WebProductReviewService({
    repository: {
      async listSources() {
        return {
          events: [{
            id: "event-old-terminal-failure-rejection",
            event_type: "product_document_audit_status_notice_all_channels",
            received_at: "2026-08-25T06:00:00.000Z",
            payload: { data: JSON.stringify({
              version: "VERSION-OLD-TERMINAL-FAILURE",
              skc_name: "SKC-TERMINAL-FAILURE-RELAUNCH",
              audit_state: 3,
              audit_time: "2026-08-25T06:00:00.000Z",
            }) },
          }],
          states: [],
          products: [],
          archivedKeys: [],
          localDrafts: [
            {
              review_key: "version:VERSION-OLD-TERMINAL-FAILURE",
              product_draft_id: "DRAFT-OLD-TERMINAL-FAILURE",
              draft_status: "published",
              publish_job_id: "JOB-OLD-TERMINAL-FAILURE",
              version: "VERSION-OLD-TERMINAL-FAILURE",
              job_created_at: "2026-08-25T06:00:00.000Z",
              job_updated_at: "2026-08-25T06:00:00.000Z",
              request_skc_names: ["SKC-TERMINAL-FAILURE-RELAUNCH"],
            },
            {
              review_key: "job:JOB-NEW-TERMINAL-FAILURE",
              product_draft_id: "DRAFT-NEW-TERMINAL-FAILURE",
              draft_status: "ready",
              publish_job_id: "JOB-NEW-TERMINAL-FAILURE",
              request_key: "request-new-terminal-failure",
              version: null,
              publish_job_state: "failed_terminal",
              job_created_at: "2026-08-25T06:05:00.000Z",
              job_updated_at: "2026-08-25T06:05:00.000Z",
              request_skc_names: ["SKC-TERMINAL-FAILURE-RELAUNCH"],
            },
          ],
        };
      },
    },
  });

  const result = await service.list({ context: { tenantId: "tenant-1" }, storeId: "store-1" });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].reviewKey, "version:VERSION-OLD-TERMINAL-FAILURE");
  assert.equal(result.items[0].workflowStage, "rejected");
  assert.equal(result.items[0].resolution.code, "official_rejected");
  assert.equal(result.items[0].attempt.localAttemptId, "JOB-NEW-TERMINAL-FAILURE");
  assert.equal(result.items[0].attempt.executionState, "failed_terminal");
});

test("two versionless jobs for one SKC use the newest job as current without merging identities", async () => {
  const service = new WebProductReviewService({
    repository: {
      async listSources() {
        return {
          events: [],
          states: [],
          products: [],
          archivedKeys: [],
          localDrafts: [
            {
              review_key: "job:JOB-VERSIONLESS-1",
              product_draft_id: "DRAFT-VERSIONLESS-1",
              draft_status: "ready",
              publish_job_id: "JOB-VERSIONLESS-1",
              request_key: "request-versionless-1",
              publish_job_state: "result_unknown",
              job_updated_at: "2026-08-25T06:00:00.000Z",
              request_skc_names: ["SKC-VERSIONLESS"],
            },
            {
              review_key: "job:JOB-VERSIONLESS-2",
              product_draft_id: "DRAFT-VERSIONLESS-2",
              draft_status: "ready",
              publish_job_id: "JOB-VERSIONLESS-2",
              request_key: "request-versionless-2",
              publish_job_state: "submitted",
              job_updated_at: "2026-08-25T06:01:00.000Z",
              request_skc_names: ["SKC-VERSIONLESS"],
            },
          ],
        };
      },
    },
  });

  const result = await service.list({ context: { tenantId: "tenant-1" }, storeId: "store-1" });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].attempt.localAttemptId, "JOB-VERSIONLESS-2");
  assert.equal(result.items[0].attemptHistory[0].localAttemptId, "JOB-VERSIONLESS-2");
  assert.equal(result.items[0].attemptHistory[1].localAttemptId, "JOB-VERSIONLESS-1");
  assert.equal(result.items[0].submissionState, "awaiting_readback");
});

test("relaunch with a JSON encoded SKC list hides the previous rejected attempt", async () => {
  const service = new WebProductReviewService({
    repository: {
      async listSources() {
        return {
          events: [{
            id: "event-old-json-rejection",
            event_type: "product_document_audit_status_notice_all_channels",
            received_at: "2026-08-25T06:00:00.000Z",
            payload: { data: JSON.stringify({
              version: "VERSION-OLD-JSON",
              skc_name: "SKC-JSON-RELAUNCH",
              audit_state: 3,
              audit_time: "2026-08-25T06:00:00.000Z",
            }) },
          }],
          states: [],
          products: [],
          archivedKeys: [],
          localDrafts: [{
            review_key: "version:VERSION-NEW-JSON",
            product_draft_id: "DRAFT-NEW-JSON",
            draft_status: "published",
            draft_title: "JSON 重发地毯",
            publish_job_id: "JOB-NEW-JSON",
            version: "VERSION-NEW-JSON",
            publish_job_state: "submitted",
            job_updated_at: "2026-08-25T06:05:00.000Z",
            request_skc_names: JSON.stringify(["SKC-JSON-RELAUNCH"]),
          }],
        };
      },
    },
  });

  const result = await service.list({
    context: { tenantId: "tenant-1" },
    storeId: "store-1",
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].version, "VERSION-NEW-JSON");
  assert.equal(result.items[0].workflowStage, null);
  assert.equal(result.items[0].submissionState, "awaiting_readback");
  assert.equal(result.items[0].launchCount, 1);
});

test("same-version relaunch keeps the SKC out of rejected while readback is pending", async () => {
  const service = new WebProductReviewService({
    repository: {
      async listSources() {
        return {
          events: [{
            id: "event-same-version-rejection",
            event_type: "product_document_audit_status_notice_all_channels",
            received_at: "2026-08-25T06:00:00.000Z",
            payload: { data: JSON.stringify({
              version: "VERSION-SAME",
              skc_name: "SKC-SAME-RELAUNCH",
              audit_state: 3,
              audit_time: "2026-08-25T06:00:00.000Z",
            }) },
          }],
          states: [],
          products: [],
          archivedKeys: [],
          localDrafts: [{
            review_key: "version:VERSION-SAME",
            product_draft_id: "DRAFT-SAME",
            draft_status: "published",
            draft_title: "同版本重发地毯",
            publish_job_id: "JOB-SAME",
            version: "VERSION-SAME",
            publish_job_state: "submitted",
            job_updated_at: "2026-08-25T06:05:00.000Z",
            request_skc_names: ["SKC-SAME-RELAUNCH"],
          }],
        };
      },
    },
  });

  const result = await service.list({ context: { tenantId: "tenant-1" }, storeId: "store-1" });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].workflowStage, null);
  assert.equal(result.items[0].auditStateLabel, "unknown");
  assert.equal(result.items[0].submissionState, "awaiting_readback");
});

test("same-version submitted job with an official rejection receipt stays relaunchable", async () => {
  const service = new WebProductReviewService({
    repository: {
      async listSources() {
        return {
          events: [{
            id: "event-rejection-receipt",
            event_type: "product_document_audit_status_notice_all_channels",
            received_at: "2026-08-25T06:00:00.000Z",
            payload: { data: JSON.stringify({
              version: "VERSION-RECEIPT-REJECTION",
              skc_name: "SKC-RECEIPT-REJECTION",
              audit_state: 3,
              audit_time: "2026-08-25T06:00:00.000Z",
            }) },
          }],
          states: [],
          products: [],
          archivedKeys: [],
          localDrafts: [{
            review_key: "version:VERSION-RECEIPT-REJECTION",
            product_draft_id: "DRAFT-RECEIPT-REJECTION",
            draft_status: "published",
            draft_title: "官方驳回回执地毯",
            publish_job_id: "JOB-RECEIPT-REJECTION",
            version: "VERSION-RECEIPT-REJECTION",
            publish_job_state: "submitted",
            job_submitted_at: "2026-08-25T05:55:00.000Z",
            job_updated_at: "2026-08-25T06:05:00.000Z",
            request_skc_names: ["SKC-RECEIPT-REJECTION"],
            publish_audit_version: "VERSION-RECEIPT-REJECTION",
            publish_audit_state: "3",
            publish_audit_state_label: "failed",
            publish_audit_receipt_status: "failed",
            publish_audit_received_at: "2026-08-25T06:04:00.000Z",
          }],
        };
      },
    },
  });

  const result = await service.list({ context: { tenantId: "tenant-1" }, storeId: "store-1" });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].workflowStage, "rejected");
  assert.equal(result.items[0].auditStateLabel, "failed");
  assert.equal(result.items[0].resolution.code, "official_rejected");
  assert.equal(result.items[0].submissionState, null);
});

test("a current failed snapshot without an official event time overrides an older submission", async () => {
  const service = new WebProductReviewService({
    repository: {
      async listSources() {
        return {
          events: [],
          states: [{
            review_key: "version:VERSION-REFRESHED-FAILURE",
            version: "VERSION-REFRESHED-FAILURE",
            skc_name: "SKC-REFRESHED-FAILURE",
            audit_state: 3,
            audit_state_label: "failed",
            failed_reasons: [{ language: "zh-cn", content: "旧驳回原因" }],
            occurred_at: null,
            updated_at: "2026-08-26T15:58:00.000Z",
          }],
          products: [],
          archivedKeys: [],
          localDrafts: [{
            review_key: "version:VERSION-REFRESHED-FAILURE",
            product_draft_id: "DRAFT-REFRESHED-FAILURE",
            draft_status: "published",
            draft_title: "重新提交的地毯",
            publish_job_id: "JOB-REFRESHED-FAILURE",
            version: "VERSION-REFRESHED-FAILURE",
            publish_job_state: "submitted",
            job_submitted_at: "2026-08-25T09:41:13.000Z",
            job_updated_at: "2026-08-25T09:41:13.000Z",
            request_skc_names: ["SKC-REFRESHED-FAILURE"],
          }],
        };
      },
    },
  });

  const result = await service.list({ context: { tenantId: "tenant-1" }, storeId: "store-1" });
  assert.equal(result.items[0].workflowStage, "rejected");
  assert.equal(result.items[0].auditStateLabel, "failed");
  assert.equal(result.items[0].submissionState, "awaiting_readback");
});

test("an official rejection is retained when both event and ingestion timestamps are absent", async () => {
  const service = new WebProductReviewService({
    repository: {
      async listSources() {
        return {
          events: [],
          states: [{
            review_key: "version:VERSION-NO-TIME-FAILURE",
            version: "VERSION-NO-TIME-FAILURE",
            skc_name: "SKC-NO-TIME-FAILURE",
            audit_state: 3,
            audit_state_label: "failed",
            failed_reasons: [{ language: "zh-cn", content: "官方驳回" }],
            occurred_at: null,
            updated_at: null,
          }],
          products: [],
          archivedKeys: [],
          localDrafts: [{
            review_key: "version:VERSION-NO-TIME-FAILURE",
            product_draft_id: "DRAFT-NO-TIME-FAILURE",
            draft_status: "published",
            publish_job_id: "JOB-NO-TIME-FAILURE",
            version: "VERSION-NO-TIME-FAILURE",
            publish_job_state: "submitted",
            job_submitted_at: null,
            job_updated_at: null,
            request_skc_names: ["SKC-NO-TIME-FAILURE"],
          }],
        };
      },
    },
  });

  const result = await service.list({ context: { tenantId: "tenant-1" }, storeId: "store-1" });
  assert.equal(result.items[0].workflowStage, "rejected");
  assert.equal(result.items[0].auditStateLabel, "failed");
  assert.equal(result.items[0].failedReasons[0].content, "官方驳回");
});

test("archive is store scoped and only hides the review item", async () => {
  let archived = null;
  const service = new WebProductReviewService({
    repository: {
      async archive(input) {
        archived = input;
        return { review_key: input.reviewKey, archived_at: "2026-08-24T06:10:00.000Z" };
      },
    },
  });
  const result = await service.archive({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    reviewKey: "version:VERSION-1",
  });

  assert.deepEqual(archived, {
    tenantId: "tenant-1",
    storeId: "store-1",
    userId: "user-1",
    reviewKey: "version:VERSION-1",
  });
  assert.equal(result.externalWrite, false);
  assert.equal(result.archived, true);
});

test("archiveMany validates and archives each selected review without crossing stores", async () => {
  const archived = [];
  const service = new WebProductReviewService({
    repository: {
      async archive(input) {
        archived.push(input);
        return { review_key: input.reviewKey, archived_at: "2026-08-25T06:10:00.000Z" };
      },
    },
  });

  const result = await service.archiveMany({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    reviewKeys: ["version:VERSION-1", "skc:SKC-2"],
  });

  assert.equal(result.archived, true);
  assert.equal(result.count, 2);
  assert.deepEqual(archived.map((row) => [row.tenantId, row.storeId, row.reviewKey]), [
    ["tenant-1", "store-1", "version:VERSION-1"],
    ["tenant-1", "store-1", "skc:SKC-2"],
  ]);
});

test("postgres review queries bind tenant and store scope", async () => {
  const calls = [];
  const repository = new PostgresProductReviewRepository({
    pool: {
      async query(input) {
        calls.push(input);
        return { rows: [], rowCount: 0 };
      },
    },
  });

  await repository.listSources({ tenantId: "tenant-1", storeId: "store-1" });
  assert.ok(calls.length >= 4);
  for (const call of calls) {
    assert.equal(call.values[0], "tenant-1");
    assert.equal(call.values[1], "store-1");
  }
  assert.match(calls[0].text, /product_document_receive_status_notice/);
  assert.match(calls.at(-1).text, /JOIN product_drafts/);
  assert.match(calls.at(-1).text, /main_asset_id/);
  const localDraftQuery = calls.at(-1).text.replace(/\s+/g, " ");
  assert.match(
    localDraftQuery,
    /COALESCE\( NULLIF\(job\.request_summary->>'spuName', ''\), NULLIF\(job\.receipt->>'spuName', ''\) \) AS request_spu_name/,
  );
  assert.match(localDraftQuery, /jsonb_array_elements\(COALESCE\(job\.receipt->'skcs'/);
  assert.match(localDraftQuery, /LEFT JOIN LATERAL/);
  assert.match(localDraftQuery, /publish_audit_state/);
});

test("document state writes ignore an older official event", async () => {
  let call = null;
  const repository = new PostgresProductReviewRepository({
    pool: {
      async query(input) {
        call = input;
        return { rows: [], rowCount: 0 };
      },
    },
  });

  await repository.saveDocumentStates({
    tenantId: "tenant-1",
    storeId: "store-1",
    records: [{
      version: "VERSION-ORDERED",
      skcName: "SKC-ORDERED",
      auditState: 3,
      auditStateLabel: "failed",
      occurredAt: "2026-08-26T10:00:00.000Z",
    }],
  });

  assert.match(call.text, /EXCLUDED\.occurred_at >= product_review_states\.occurred_at/);
  assert.equal(call.values[0], "tenant-1");
  assert.equal(call.values[1], "store-1");
});
