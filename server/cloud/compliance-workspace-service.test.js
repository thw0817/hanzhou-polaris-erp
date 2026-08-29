import assert from "node:assert/strict";
import test from "node:test";
import {
  PostgresComplianceWorkspaceRepository,
  WebComplianceWorkspaceService,
} from "./compliance-workspace-service.js";

test("lists paged store compliance cache with normalized filters", async () => {
  let received = null;
  const service = new WebComplianceWorkspaceService({
    repository: {
      async listSkcs(input) {
        received = input;
        return {
          rows: [{
            id: "skc-id-1",
            skc_name: "SKC-1",
            supplier_code: "RUG-1",
            shelf_status: "1",
            compliance_status: "待补充",
            compliance_summary: { certificate: "待补充" },
            category_id: "3155",
            category_name: "装饰地毯",
            updated_at: "2026-08-04T01:00:00.000Z",
            snapshot_fetched_at: "2026-08-04T00:00:00.000Z",
            snapshot_expires_at: "2026-08-05T00:00:00.000Z",
            snapshot_trace_id: "trace-1",
            snapshot_fresh: true,
            draft_id: "draft-1",
            draft_status: "blocked",
            draft_preflight: {
              plans: [{
                blockers: [{ code: "CERTIFICATE_REQUIRED", message: "缺少证书" }],
              }],
            },
            draft_updated_at: "2026-08-04T00:30:00.000Z",
            server_preflight_id: "run-1",
            server_preflight_status: "blocked",
            server_preflight_blocker_count: "2",
            server_preflight_created_at: "2026-08-04T00:45:00.000Z",
            server_preflight_current_for_draft: true,
            server_preflight_current_for_rules: true,
            server_preflight_current_for_media: true,
            server_preflight_review_count: "1",
            server_preflight_reviewed_at: "2026-08-04T00:50:00.000Z",
            total_count: "1",
          }],
          total: 1,
          auditSummary: {
            notRun: 3,
            needsRerun: 2,
            pending: 4,
            reviewed: 5,
          },
          complianceSummary: {
            total: 30,
            nonCompliant: 8,
            inProgress: 6,
            passed: 9,
          },
        };
      },
    },
  });

  const result = await service.listSkcs({
    context: { tenantId: "tenant-1" },
    storeId: "store-1",
    filters: {
      query: " rug ",
      status: "待补充",
      reviewStatus: "stale",
      page: "2",
      pageSize: "25",
    },
  });

  assert.deepEqual(received, {
    tenantId: "tenant-1",
    storeId: "store-1",
    query: "rug",
    status: "待补充",
    reviewStatus: "stale",
    limit: 25,
    offset: 25,
  });
  assert.equal(result.items[0].skc, "SKC-1");
  assert.equal(result.items[0].categoryId, "3155");
  assert.equal(result.items[0].categoryName, "装饰地毯");
  assert.equal(result.items[0].shelfStatus, null);
  assert.equal(result.items[0].snapshot.fresh, true);
  assert.equal(result.items[0].draft.status, "blocked");
  assert.equal(result.items[0].draft.blockerCount, 1);
  assert.deepEqual(result.items[0].serverPreflight, {
    id: "run-1",
    status: "blocked",
    blockerCount: 2,
    createdAt: "2026-08-04T00:45:00.000Z",
    currentForDraft: true,
    currentForRules: true,
    currentForMedia: true,
    reviewCount: 1,
    reviewedAt: "2026-08-04T00:50:00.000Z",
  });
  assert.deepEqual(result.auditSummary, {
    notRun: 3,
    needsRerun: 2,
    pending: 4,
    reviewed: 5,
  });
  assert.deepEqual(result.complianceSummary, {
    total: 30,
    nonCompliant: 8,
    inProgress: 6,
    passed: 9,
  });
  assert.deepEqual(result.pagination, { page: 2, pageSize: 25, total: 1, pageCount: 1 });
});

test("only returns an official shelf status label, never a legacy numeric code", async () => {
  const service = new WebComplianceWorkspaceService({
    repository: {
      async listSkcs() {
        return {
          rows: [{
            id: "skc-id-2",
            skc_name: "SKC-2",
            supplier_code: "RUG-2",
            shelf_status: "已上架",
            compliance_status: "已通过",
            compliance_summary: {},
            category_id: "3156",
            category_name: "家居-地毯",
            updated_at: "2026-08-04T01:00:00.000Z",
            total_count: "2",
          }, {
            id: "skc-id-3",
            skc_name: "SKC-3",
            supplier_code: "RUG-3",
            shelf_status: "1",
            compliance_status: "已通过",
            compliance_summary: {},
            category_id: "3157",
            category_name: "家纺-地毯",
            updated_at: "2026-08-04T01:00:00.000Z",
            total_count: "2",
          }],
          total: 2,
        };
      },
    },
  });

  const result = await service.listSkcs({
    context: { tenantId: "tenant-1" },
    storeId: "store-1",
  });

  assert.equal(result.items[0].shelfStatus, "已上架");
  assert.equal(result.items[1].shelfStatus, null);
});

test("projects real category paths and main images from cached SHEIN field variants", async () => {
  const service = new WebComplianceWorkspaceService({
    repository: {
      async listSkcs() {
        return {
          rows: [{
            id: "skc-id-image-1",
            skc_name: "SKC-IMAGE-1",
            category_id: "3155",
            category_name: "类目 3155",
            raw_data: {
              categoryNamePath: ["家用纺织品", "地毯"],
              skcMainPicUrl: "https://img.example/main-1.jpg",
            },
            compliance_summary: {},
          }, {
            id: "skc-id-image-2",
            skc_name: "SKC-IMAGE-2",
            category_id: "8627",
            category_name: "8627",
            raw_data: {
              categoryInfo: { names: ["家居", "门垫"] },
              images: { main: ["https://img.example/main-2.jpg"] },
            },
            compliance_summary: {},
          }],
          total: 2,
        };
      },
    },
  });

  const result = await service.listSkcs({
    context: { tenantId: "tenant-1" },
    storeId: "store-1",
  });

  assert.deepEqual(result.items[0].categoryPath, ["家用纺织品", "地毯"]);
  assert.equal(result.items[0].imageUrl, "https://img.example/main-1.jpg");
  assert.deepEqual(result.items[1].categoryPath, ["家居", "门垫"]);
  assert.equal(result.items[1].imageUrl, "https://img.example/main-2.jpg");
});

test("projects compliance thumbnails from the store business snapshot envelope", async () => {
  const service = new WebComplianceWorkspaceService({
    repository: {
      async listSkcs() {
        return {
          rows: [{
            id: "skc-id-image-envelope",
            skc_name: "SKC-IMAGE-ENVELOPE",
            raw_data: {
              businessSnapshot: {
                imageUrl: "https://img.example/envelope-main.jpg",
              },
            },
            compliance_summary: {},
          }],
          total: 1,
        };
      },
    },
  });

  const result = await service.listSkcs({
    context: { tenantId: "tenant-1" },
    storeId: "store-1",
  });

  assert.equal(result.items[0].imageUrl, "https://img.example/envelope-main.jpg");
});

test("rejects unsupported compliance status before querying", async () => {
  let queried = false;
  const service = new WebComplianceWorkspaceService({
    repository: { async listSkcs() { queried = true; } },
  });
  await assert.rejects(
    service.listSkcs({
      context: { tenantId: "tenant-1" },
      storeId: "store-1",
      filters: { status: "已完成" },
    }),
    (error) => error.code === "INVALID_COMPLIANCE_STATUS",
  );
  assert.equal(queried, false);
});

test("rejects unsupported preflight review status before querying", async () => {
  let queried = false;
  const service = new WebComplianceWorkspaceService({
    repository: { async listSkcs() { queried = true; } },
  });
  await assert.rejects(
    service.listSkcs({
      context: { tenantId: "tenant-1" },
      storeId: "store-1",
      filters: { reviewStatus: "approved" },
    }),
    (error) => error.code === "INVALID_PREFLIGHT_REVIEW_STATUS",
  );
  assert.equal(queried, false);
});

test("returns one cached SKC with records and latest rule snapshots", async () => {
  let historyQuery = null;
  let reviewQuery = null;
  const service = new WebComplianceWorkspaceService({
    now: () => new Date("2026-08-04T02:00:00.000Z"),
    repository: {
      async getSkc() {
        return {
          id: "skc-id-1",
          skc_name: "SKC-1",
          supplier_code: "RUG-1",
          shelf_status: "1",
          compliance_status: "待补充",
          compliance_summary: { certificate: "待补充" },
          updated_at: "2026-08-04T01:00:00.000Z",
        };
      },
      async listRecords() {
        return [{
          id: "record-1",
          requirement_type: "certificate",
          requirement_key: "CE",
          status: "待补充",
          required: true,
          requirement_data: { certificateTypeName: "CE" },
          source_trace_id: "trace-1",
          checked_at: "2026-08-04T00:00:00.000Z",
        }];
      },
      async listSnapshots() {
        return [
          {
            id: "snapshot-1",
            rule_type: "compliance_requirement",
            fingerprint: "requirement-fingerprint",
            payload: {},
            source_trace_id: "trace-1",
            fetched_at: "2026-08-04T00:00:00.000Z",
            expires_at: "2026-08-05T00:00:00.000Z",
            fresh: true,
          },
          {
            id: "snapshot-2",
            rule_type: "certificate_schema",
            fingerprint: "certificate-fingerprint",
            payload: { certificateSchemas: [] },
            source_trace_id: "trace-2",
            fetched_at: "2026-08-04T00:00:00.000Z",
            expires_at: "2026-08-05T00:00:00.000Z",
            fresh: true,
          },
          {
            id: "snapshot-3",
            rule_type: "warning_rules",
            fingerprint: "warning-fingerprint",
            payload: { warningRules: [] },
            source_trace_id: "trace-3",
            fetched_at: "2026-08-04T01:00:00.000Z",
            expires_at: "2026-08-05T01:00:00.000Z",
            fresh: true,
          },
        ];
      },
      async getDraft() {
        return {
          id: "draft-1",
          store_id: "store-1",
          skc_name: "SKC-1",
          template_id: null,
          requirement_snapshot: {},
          inputs: { certificates: [{ secret: "not projected" }] },
          preflight: {
            executable: false,
            plans: [{
              blockers: [{ code: "CERTIFICATE_REQUIRED", message: "缺少证书" }],
              warnings: [{ code: "REVIEW_FIRST", message: "先复核" }],
              waiting: [{ name: "平台审核" }],
            }],
          },
          status: "blocked",
          updated_at: "2026-08-04T00:30:00.000Z",
        };
      },
      async getLatestPreflightRun() {
        return {
          id: "run-1",
          draft_id: "draft-1",
          skc_name: "SKC-1",
          status: "blocked",
          executable: false,
          plan: {
            actions: [{
              type: "photo.upload_and_bind",
              requirementKey: "body:1",
              labelId: 1,
              labelGroup: "body",
              localAssetRef: "media:secret",
              fileName: "rug.jpg",
              size: 1234,
            }, {
              type: "certificate.bind_existing",
              requirementKey: "CERT-7",
              certificateTypeCode: "CERT-7",
              certificateTypeId: 7,
              poolSn: "POOL-7",
              rules: { secret: "certificate schema" },
            }, {
              type: "agency.bind",
              requirementKey: "EuRespPerson",
              certificateTypeCode: "EuRespPerson",
              agencyId: "AGENCY-7",
              agencyType: 0,
            }, {
              type: "warning.update",
              requirementKey: "RUG-WARNING",
              selectedByField: { MATERIAL: ["10"], WARNING: ["20"] },
              autoMappedWarningValueIds: ["20"],
              rules: { secret: "warning rules" },
            }],
            blockers: [{ code: "SERVER_BLOCKER", message: "服务端阻断" }],
            warnings: [],
            waiting: [],
            audit: {
              ruleSnapshots: [
                {
                  id: "snapshot-1",
                  ruleType: "compliance_requirement",
                  fingerprint: "requirement-fingerprint",
                  fetchedAt: "2026-08-04T00:00:00.000Z",
                  expiresAt: "2026-08-05T00:00:00.000Z",
                },
                {
                  id: "snapshot-2",
                  ruleType: "certificate_schema",
                  fingerprint: "certificate-fingerprint",
                  fetchedAt: "2026-08-04T00:00:00.000Z",
                  expiresAt: "2026-08-05T00:00:00.000Z",
                },
                {
                  id: "snapshot-3",
                  ruleType: "warning_rules",
                  fingerprint: "warning-fingerprint",
                  fetchedAt: "2026-08-04T01:00:00.000Z",
                  expiresAt: "2026-08-05T01:00:00.000Z",
                },
              ],
            },
          },
          input_fingerprint: "input-fingerprint",
          rule_fingerprint: "rule-fingerprint",
          media_fingerprint: "media-fingerprint",
          media_assets: [],
          requirement_rule_snapshot_id: "snapshot-1",
          certificate_rule_snapshot_id: null,
          created_at: "2026-08-04T01:30:00.000Z",
        };
      },
      async listPreflightRuns(input) {
        historyQuery = input;
        return [
          await this.getLatestPreflightRun(),
          {
            id: "run-0",
            draft_id: "draft-1",
            skc_name: "SKC-1",
            status: "ready",
            executable: false,
            plan: {
              actions: [],
              blockers: [],
              warnings: [{ code: "PREVIOUS_WARNING", message: "上次预检警告" }],
              waiting: [],
            },
            input_fingerprint: "previous-input-fingerprint",
            rule_fingerprint: "previous-rule-fingerprint",
            media_fingerprint: "previous-media-fingerprint",
            media_assets: [],
            requirement_rule_snapshot_id: "snapshot-0",
            certificate_rule_snapshot_id: null,
            created_at: "2026-08-04T01:00:00.000Z",
          },
        ];
      },
      async listPreflightReviews(input) {
        reviewQuery = input;
        return [{
          id: "review-1",
          preflight_run_id: "run-1",
          skc_name: "SKC-1",
          reviewed_by: "admin-1",
          reviewer_display_name: "管理员",
          reviewed_status: "blocked",
          action_count: 4,
          blocker_count: 1,
          warning_count: 0,
          input_fingerprint: "input-fingerprint",
          rule_fingerprint: "rule-fingerprint",
          media_fingerprint: "media-fingerprint",
          reviewed_at: "2026-08-04T01:45:00.000Z",
          private_note: "not projected",
        }];
      },
    },
  });

  const result = await service.getSkcDetail({
    context: { tenantId: "tenant-1" },
    storeId: "store-1",
    skc: "SKC-1",
  });

  assert.equal(result.item.skc, "SKC-1");
  assert.deepEqual(result.workspaceCapabilities, {
    mode: "cloud_cached",
    refreshCurrentSkc: false,
    directReportStorage: false,
    photoTemplateApply: false,
    reportTemplateApply: false,
    photoShare: false,
    photoBindingDiagnostic: false,
    photoSubmit: false,
    reportSubmit: false,
  });
  assert.equal(result.records[0].requirementType, "certificate");
  assert.equal(result.snapshots[1].ruleType, "certificate_schema");
  assert.equal(result.draft.status, "blocked");
  assert.equal(result.draft.preflight.blockers[0].code, "CERTIFICATE_REQUIRED");
  assert.equal(result.draft.preflight.warningCount, 1);
  assert.equal(result.draft.preflight.waitingCount, 1);
  assert.equal("inputs" in result.draft, false);
  assert.deepEqual(historyQuery, {
    tenantId: "tenant-1",
    storeId: "store-1",
    skc: "SKC-1",
    limit: 5,
  });
  assert.equal(result.latestPreflight.status, "blocked");
  assert.equal(result.latestPreflight.currentForDraft, true);
  assert.equal(result.latestPreflight.currentForRules, true);
  assert.equal(result.latestPreflight.currentForMedia, true);
  assert.deepEqual(result.latestPreflight.actionTypes, [
    "photo.upload_and_bind",
    "certificate.bind_existing",
    "agency.bind",
    "warning.update",
  ]);
  assert.deepEqual(result.latestPreflight.actionSummaries, [
    {
      type: "photo.upload_and_bind",
      requirementKey: "body:1",
      labelId: 1,
      labelGroup: "body",
      fileName: "rug.jpg",
      size: 1234,
    },
    {
      type: "certificate.bind_existing",
      requirementKey: "CERT-7",
      certificateTypeCode: "CERT-7",
      certificateTypeId: 7,
      poolSn: "POOL-7",
    },
    {
      type: "agency.bind",
      requirementKey: "EuRespPerson",
      certificateTypeCode: "EuRespPerson",
      agencyId: "AGENCY-7",
      agencyType: 0,
    },
    {
      type: "warning.update",
      requirementKey: "RUG-WARNING",
      selectedByField: { MATERIAL: ["10"], WARNING: ["20"] },
      autoMappedWarningValueIds: ["20"],
    },
  ]);
  assert.deepEqual(result.latestPreflight.ruleSnapshots, [
    {
      ruleType: "compliance_requirement",
      fingerprint: "requirement-fingerprint",
      fetchedAt: "2026-08-04T00:00:00.000Z",
      expiresAt: "2026-08-05T00:00:00.000Z",
    },
    {
      ruleType: "certificate_schema",
      fingerprint: "certificate-fingerprint",
      fetchedAt: "2026-08-04T00:00:00.000Z",
      expiresAt: "2026-08-05T00:00:00.000Z",
    },
    {
      ruleType: "warning_rules",
      fingerprint: "warning-fingerprint",
      fetchedAt: "2026-08-04T01:00:00.000Z",
      expiresAt: "2026-08-05T01:00:00.000Z",
    },
  ]);
  assert.equal("actions" in result.latestPreflight, false);
  assert.equal("mediaAssets" in result.latestPreflight, false);
  for (const summary of result.latestPreflight.actionSummaries) {
    assert.equal("rules" in summary, false);
    assert.equal("schema" in summary, false);
    assert.equal("files" in summary, false);
    assert.equal("localAssetRef" in summary, false);
  }
  assert.equal(result.preflightHistory.length, 2);
  assert.equal(result.preflightHistory[0].id, result.latestPreflight.id);
  assert.equal(result.preflightHistory[1].status, "ready");
  assert.equal("actions" in result.preflightHistory[1], false);
  assert.deepEqual(reviewQuery, {
    tenantId: "tenant-1",
    storeId: "store-1",
    skc: "SKC-1",
    preflightRunId: "run-1",
  });
  assert.deepEqual(result.latestPreflightReviews, [{
    id: "review-1",
    preflightRunId: "run-1",
    skc: "SKC-1",
    reviewedBy: "admin-1",
    reviewerDisplayName: "管理员",
    reviewedAt: "2026-08-04T01:45:00.000Z",
    snapshot: {
      status: "blocked",
      counts: { actions: 4, blockers: 1, warnings: 0 },
      inputFingerprint: "input-fingerprint",
      ruleFingerprint: "rule-fingerprint",
      mediaFingerprint: "media-fingerprint",
    },
    authorizesPublishing: false,
  }]);
  assert.equal("privateNote" in result.latestPreflightReviews[0], false);
  assert.equal(result.releaseGate.publishingEnabled, false);
  assert.deepEqual(
    result.releaseGate.blockers.map((blocker) => blocker.code),
    ["COMPLIANCE_NOT_PASSED", "DRAFT_NOT_READY", "CERTIFICATE_REQUIRED"],
  );
});

test("refreshes one SKC from the official readback and projects its report type", async () => {
  let saved = null;
  const service = new WebComplianceWorkspaceService({
    now: () => new Date("2026-08-26T02:00:00.000Z"),
    repository: {
      async getSkc() {
        return {
          id: "skc-id-refresh",
          skc_name: "SKC-REFRESH",
          supplier_code: "RUG-REFRESH",
          compliance_status: "待同步",
          compliance_summary: {},
          updated_at: "2026-08-26T01:00:00.000Z",
        };
      },
      async listRecords() {
        return [];
      },
      async listSnapshots() {
        return [{
          id: "snapshot-refresh",
          rule_type: "compliance_requirement",
          fingerprint: "refresh-fingerprint",
          payload: {
            skc: "SKC-REFRESH",
            sourceCoverage: {
              requirementsReturned: true,
              photoRequirementsReturned: true,
            },
            certificateRequirements: [{
              certificateTypeCode: "SmallCarpet1631",
              certificateTypeName: "16 CFR 1631",
              isRequired: 1,
            }],
          },
          source_trace_id: "trace-refresh",
          fetched_at: "2026-08-26T02:00:00.000Z",
          expires_at: "2026-08-27T02:00:00.000Z",
          fresh: true,
        }];
      },
      async getDraft() {
        return null;
      },
      async saveComplianceReadback(input) {
        saved = input;
      },
    },
    readCompliance: async () => ({
      row: {
        skc: "SKC-REFRESH",
        sourceCoverage: {
          requirementsReturned: true,
          photoRequirementsReturned: true,
        },
        certificateRequirements: [{
          certificateTypeCode: "SmallCarpet1631",
          certificateTypeName: "16 CFR 1631",
          isRequired: 1,
        }],
        agencyRequirements: [],
        warningRequirements: [],
        bodyPhotoRequirements: [],
        packagePhotoRequirements: [],
      },
      diagnostics: { traceId: "trace-refresh" },
    }),
  });

  const result = await service.refreshSkc({
    context: { tenantId: "tenant-1" },
    storeId: "store-1",
    skc: "SKC-REFRESH",
  });

  assert.equal(result.refreshed, true);
  assert.equal(saved.row.skc, "SKC-REFRESH");
  assert.equal(saved.traceId, "trace-refresh");
  assert.equal(result.detail.item.reportDecision.reportType, "1631");
});

test("projects the stored product attribute snapshot and server report decision", async () => {
  const service = new WebComplianceWorkspaceService({
    now: () => new Date("2026-08-07T04:00:00.000Z"),
    repository: {
      async getSkc() {
        return {
          id: "skc-id-1",
          skc_name: "SKC-1",
          compliance_status: "待补充",
          compliance_summary: {},
          raw_data: {
            attributeSnapshot: {
              attributeSchemaSnapshot: {
                fetchedAt: "2026-08-07T03:00:00.000Z",
                categoryId: "3155",
                productTypeId: "991",
                fields: [
                  {
                    id: "length",
                    name: "长度",
                    typeCode: 4,
                    dataDimension: 1,
                    values: [],
                  },
                  {
                    id: "width",
                    name: "宽度",
                    typeCode: 4,
                    dataDimension: 1,
                    values: [],
                  },
                ],
              },
              attributeValues: {
                length: { valueIds: [], customValue: "180" },
                width: { valueIds: [], customValue: "120" },
              },
              rugReportSources: {
                dimensions: [
                  { attributeId: "length", unit: "cm" },
                  { attributeId: "width", unit: "cm" },
                ],
              },
              source: {
                endpoint: "/open-api/goods/spu-info",
                traceId: "attribute-trace",
              },
            },
          },
        };
      },
      async listRecords() { return []; },
      async listSnapshots() {
        return [{
          rule_type: "compliance_requirement",
          payload: {
            certificateRequirements: [{
              certificateTypeCode: "1631",
              isRequired: 1,
              reviewState: 0,
            }],
          },
          source_trace_id: "rule-trace",
          fetched_at: "2026-08-07T03:00:00.000Z",
          expires_at: "2026-08-08T03:00:00.000Z",
          fresh: true,
        }];
      },
      async getDraft() { return null; },
    },
  });

  const result = await service.getSkcDetail({
    context: { tenantId: "tenant-1" },
    storeId: "store-1",
    skc: "SKC-1",
  });

  assert.deepEqual(result.item.attributeSnapshot, {
    fetchedAt: "2026-08-07T03:00:00.000Z",
    categoryId: "3155",
    productTypeId: "991",
    fieldCount: 2,
    assignedFieldCount: 2,
    fields: [
      {
        id: "length",
        name: "长度",
        required: false,
        mode: "",
        assigned: true,
        valueIds: [],
        valueLabels: [],
        customValue: "180",
      },
      {
        id: "width",
        name: "宽度",
        required: false,
        mode: "",
        assigned: true,
        valueIds: [],
        valueLabels: [],
        customValue: "120",
      },
    ],
    sourceEndpoint: "/open-api/goods/spu-info",
    traceId: "attribute-trace",
    reportSourcesConfigured: true,
  });
  assert.equal(result.item.reportDecision.reportType, "1631");
  assert.equal(result.item.reportDecision.longestEdgeCm, null);
  assert.equal(result.item.reportDecision.areaM2, null);
  assert.deepEqual(result.item.reportDecision.evidence, []);
  assert.deepEqual(result.item.reportDecision.blockers, []);
});

test("uses the official 1630 requirement even when local attributes would classify 1631", async () => {
  const service = new WebComplianceWorkspaceService({
    now: () => new Date("2026-08-21T04:00:00.000Z"),
    repository: {
      async getSkc() {
        return {
          id: "skc-id-1",
          skc_name: "sf260202145743366071435",
          compliance_status: "需修正",
          compliance_summary: {},
          raw_data: {
            attributeSnapshot: {
              attributeSchemaSnapshot: {
                fetchedAt: "2026-08-21T03:00:00.000Z",
                categoryId: "3155",
                productTypeId: "991",
                fields: [
                  {
                    id: "1001889",
                    name: "是否面积大于2.16m²",
                    typeCode: 4,
                    dataDimension: 1,
                    values: [{ id: "459", label: "否" }, { id: "763", label: "是" }],
                  },
                  {
                    id: "1001890",
                    name: "是否最长边大于1.8m",
                    typeCode: 4,
                    dataDimension: 1,
                    values: [{ id: "459", label: "否" }, { id: "763", label: "是" }],
                  },
                ],
              },
              attributeValues: {
                1001889: { valueIds: ["459"], customValue: "" },
                1001890: { valueIds: ["459"], customValue: "" },
              },
              rugReportSources: {},
              source: { endpoint: "/open-api/goods/spu-info" },
            },
          },
        };
      },
      async listRecords() { return []; },
      async listSnapshots() {
        return [{
          rule_type: "compliance_requirement",
          payload: {
            certificateRequirements: [{
              certificateTypeCode: "RugReport1630",
              isRequired: 1,
              reviewState: 0,
            }],
          },
          fetched_at: "2026-08-21T03:00:00.000Z",
          expires_at: "2026-08-22T03:00:00.000Z",
          fresh: true,
        }];
      },
      async getDraft() { return null; },
    },
  });

  const result = await service.getSkcDetail({
    context: { tenantId: "tenant-1" },
    storeId: "store-1",
    skc: "sf260202145743366071435",
  });

  assert.equal(result.item.reportDecision.reportType, "1630");
  assert.deepEqual(result.item.reportDecision.blockers, []);
});

test("marks the latest preflight stale after its draft changes", async () => {
  const service = new WebComplianceWorkspaceService({
    repository: {
      async getSkc() {
        return {
          id: "skc-id-1",
          skc_name: "SKC-1",
          compliance_status: "待补充",
          compliance_summary: {},
        };
      },
      async listRecords() {
        return [];
      },
      async listSnapshots() {
        return [];
      },
      async getDraft() {
        return {
          id: "draft-1",
          skc_name: "SKC-1",
          inputs: {},
          preflight: {},
          status: "draft",
          updated_at: "2026-08-04T02:00:00.000Z",
        };
      },
      async listPreflightRuns() {
        return [{
          id: "run-1",
          draft_id: "draft-1",
          skc_name: "SKC-1",
          status: "ready",
          executable: false,
          plan: {},
          input_fingerprint: "input-fingerprint",
          rule_fingerprint: "rule-fingerprint",
          media_fingerprint: "media-fingerprint",
          media_assets: [],
          requirement_rule_snapshot_id: "snapshot-1",
          certificate_rule_snapshot_id: null,
          created_at: "2026-08-04T01:00:00.000Z",
        }];
      },
      async listPreflightReviews() {
        return [];
      },
    },
  });

  const result = await service.getSkcDetail({
    context: { tenantId: "tenant-1" },
    storeId: "store-1",
    skc: "SKC-1",
  });

  assert.equal(result.latestPreflight.currentForDraft, false);
  assert.equal(result.latestPreflight.currentForRules, false);
  assert.equal(result.latestPreflight.currentForMedia, true);
});

test("marks the latest preflight stale after its rule snapshot changes", async () => {
  const service = new WebComplianceWorkspaceService({
    now: () => new Date("2026-08-04T02:00:00.000Z"),
    repository: {
      async getSkc() {
        return {
          id: "skc-id-1",
          skc_name: "SKC-1",
          compliance_status: "待补充",
          compliance_summary: {},
        };
      },
      async listRecords() {
        return [];
      },
      async listSnapshots() {
        return [{
          id: "snapshot-new",
          rule_type: "compliance_requirement",
          fingerprint: "requirement-new",
          payload: {},
          fetched_at: "2026-08-04T01:30:00.000Z",
          expires_at: "2026-08-05T01:30:00.000Z",
          fresh: true,
        }];
      },
      async getDraft() {
        return {
          id: "draft-1",
          skc_name: "SKC-1",
          inputs: {},
          preflight: {},
          status: "draft",
          updated_at: "2026-08-04T00:30:00.000Z",
        };
      },
      async listPreflightRuns() {
        return [{
          id: "run-1",
          draft_id: "draft-1",
          skc_name: "SKC-1",
          status: "ready",
          executable: false,
          plan: {
            audit: {
              ruleSnapshots: [{
                id: "snapshot-old",
                ruleType: "compliance_requirement",
                fingerprint: "requirement-old",
                fetchedAt: "2026-08-04T00:00:00.000Z",
                expiresAt: "2026-08-05T00:00:00.000Z",
              }],
            },
          },
          input_fingerprint: "input-fingerprint",
          rule_fingerprint: "rule-fingerprint",
          media_fingerprint: "media-fingerprint",
          media_assets: [],
          requirement_rule_snapshot_id: "snapshot-old",
          certificate_rule_snapshot_id: null,
          created_at: "2026-08-04T01:00:00.000Z",
        }];
      },
      async listPreflightReviews() {
        return [];
      },
    },
  });

  const result = await service.getSkcDetail({
    context: { tenantId: "tenant-1" },
    storeId: "store-1",
    skc: "SKC-1",
  });

  assert.equal(result.latestPreflight.currentForDraft, true);
  assert.equal(result.latestPreflight.currentForRules, false);
  assert.equal(result.latestPreflight.currentForMedia, true);
});

test("marks the latest preflight stale after its media evidence changes", async () => {
  const mediaId = "33333333-3333-4333-8333-333333333333";
  const service = new WebComplianceWorkspaceService({
    now: () => new Date("2026-08-04T02:00:00.000Z"),
    repository: {
      async getSkc() {
        return {
          id: "skc-id-1",
          skc_name: "SKC-1",
          compliance_status: "待补充",
          compliance_summary: {},
        };
      },
      async listRecords() {
        return [];
      },
      async listSnapshots() {
        return [{
          id: "snapshot-1",
          rule_type: "compliance_requirement",
          fingerprint: "requirement-fingerprint",
          payload: {},
          fetched_at: "2026-08-04T00:00:00.000Z",
          expires_at: "2026-08-05T00:00:00.000Z",
          fresh: true,
        }];
      },
      async getDraft() {
        return {
          id: "draft-1",
          skc_name: "SKC-1",
          inputs: {},
          preflight: {},
          status: "draft",
          updated_at: "2026-08-04T00:30:00.000Z",
        };
      },
      async listPreflightRuns() {
        return [{
          id: "run-1",
          draft_id: "draft-1",
          skc_name: "SKC-1",
          status: "ready",
          executable: false,
          plan: {
            audit: {
              ruleSnapshots: [{
                id: "snapshot-1",
                ruleType: "compliance_requirement",
                fingerprint: "requirement-fingerprint",
                fetchedAt: "2026-08-04T00:00:00.000Z",
                expiresAt: "2026-08-05T00:00:00.000Z",
              }],
            },
          },
          input_fingerprint: "input-fingerprint",
          rule_fingerprint: "rule-fingerprint",
          media_fingerprint: "media-fingerprint",
          media_assets: [{
            id: mediaId,
            status: "ready",
            purpose: "compliance_evidence",
            sha256: "old-sha256",
            sizeBytes: 2048,
            contentType: "image/jpeg",
          }],
          requirement_rule_snapshot_id: "snapshot-1",
          certificate_rule_snapshot_id: null,
          created_at: "2026-08-04T01:00:00.000Z",
        }];
      },
      async listPreflightReviews() {
        return [];
      },
      async listMediaAssets(input) {
        assert.deepEqual(input.assetIds, [mediaId]);
        return [{
          id: mediaId,
          status: "ready",
          purpose: "compliance_evidence",
          sha256: "new-sha256",
        }];
      },
    },
  });

  const result = await service.getSkcDetail({
    context: { tenantId: "tenant-1" },
    storeId: "store-1",
    skc: "SKC-1",
  });

  assert.equal(result.latestPreflight.currentForDraft, true);
  assert.equal(result.latestPreflight.currentForRules, true);
  assert.equal(result.latestPreflight.currentForMedia, false);
});

test("cached SKC detail returns 404 when the scoped SKC does not exist", async () => {
  const service = new WebComplianceWorkspaceService({
    repository: { async getSkc() { return null; } },
  });
  await assert.rejects(
    service.getSkcDetail({
      context: { tenantId: "tenant-1" },
      storeId: "store-1",
      skc: "SKC-404",
    }),
    (error) => error.code === "COMPLIANCE_SKC_NOT_FOUND" && error.status === 404,
  );
});

test("compliance cache repository scopes list and detail reads by tenant and store", async () => {
  const queries = [];
  const repository = new PostgresComplianceWorkspaceRepository({
    pool: {
      async query(input) {
        queries.push(input);
        if (queries.length === 1) {
          return {
            rows: [{
              total_count: "0",
              audit_not_run_count: "3",
              audit_needs_rerun_count: "2",
              audit_pending_count: "4",
              audit_reviewed_count: "5",
              compliance_total_count: "30",
              compliance_non_compliant_count: "8",
              compliance_in_progress_count: "6",
              compliance_passed_count: "9",
            }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    },
  });

  const listResult = await repository.listSkcs({
    tenantId: "tenant-1",
    storeId: "store-1",
    query: "SKC",
    status: "待补充",
    reviewStatus: "stale",
    limit: 50,
    offset: 0,
  });
  await repository.getSkc({ tenantId: "tenant-1", storeId: "store-1", skc: "SKC-1" });
  await repository.listRecords({ tenantId: "tenant-1", storeId: "store-1", skcId: "skc-id-1" });
  await repository.listSnapshots({ tenantId: "tenant-1", storeId: "store-1", skc: "SKC-1" });

  assert.equal(queries.length, 4);
  for (const query of queries) {
    assert.match(query.text, /tenant_id\s*=\s*\$1/);
    assert.match(query.text, /store_id\s*=\s*\$2/);
    assert.deepEqual(query.values.slice(0, 2), ["tenant-1", "store-1"]);
  }
  assert.match(queries[0].text, /LEFT JOIN compliance_drafts/);
  assert.match(queries[0].text, /FROM compliance_preflight_runs/);
  assert.match(queries[0].text, /FROM compliance_preflight_reviews/);
  assert.match(queries[0].text, /ORDER BY created_at DESC, id DESC/);
  assert.match(queries[0].text, /\$5 = 'stale'/);
  assert.match(
    queries[0].text,
    /server_preflight_current_for_draft/,
  );
  assert.match(
    queries[0].text,
    /server_preflight_current_for_rules/,
  );
  assert.match(
    queries[0].text,
    /server_preflight_current_for_media/,
  );
  assert.match(queries[0].text, /jsonb_array_elements/);
  assert.match(queries[0].text, /current_snapshot\.expires_at > now\(\)/);
  assert.match(
    queries[0].text,
    /NOT EXISTS[\s\S]*shein_rule_snapshots newer_snapshot/,
  );
  assert.match(
    queries[0].text,
    /count\(\*\) FILTER \(WHERE server_preflight_id IS NULL\) AS not_run_count/,
  );
  assert.match(
    queries[0].text,
    /count\(\*\) FILTER \(\s*WHERE server_preflight_id IS NOT NULL\s*AND \(\s*server_preflight_current_for_draft = false\s*OR server_preflight_current_for_rules = false\s*OR server_preflight_current_for_media = false\s*\)\s*\) AS needs_rerun_count/,
  );
  assert.match(
    queries[0].text,
    /count\(\*\) FILTER \(\s*WHERE server_preflight_current_for_draft = true\s*AND server_preflight_current_for_rules = true\s*AND server_preflight_current_for_media = true\s*AND server_preflight_review_count = 0\s*\) AS pending_count/,
  );
  assert.match(
    queries[0].text,
    /count\(\*\) FILTER \(\s*WHERE server_preflight_current_for_draft = true\s*AND server_preflight_current_for_rules = true\s*AND server_preflight_current_for_media = true\s*AND server_preflight_review_count > 0\s*\) AS reviewed_count/,
  );
  assert.match(queries[0].text, /current_media\.status IN \('ready', 'referenced'\)/);
  assert.match(queries[0].text, /current_media\.purpose = 'compliance_evidence'/);
  assert.match(
    queries[0].text,
    /current_media\.sha256 =\s*audited_media\.value->>'sha256'/,
  );
  assert.match(queries[3].text, /id, rule_type, fingerprint/);
  assert.match(
    queries[0].text,
    /audit_summary AS \([\s\S]*FROM enriched\s*\)/,
  );
  assert.match(
    queries[0].text,
    /compliance_summary AS \([\s\S]*count\(\*\) AS total_count/,
  );
  assert.match(
    queries[0].text,
    /count\(\*\) FILTER \(WHERE compliance_status IN \('需修正', '待补充'\)\) AS non_compliant_count/,
  );
  assert.match(
    queries[0].text,
    /count\(\*\) FILTER \(WHERE compliance_status IN \('审核中', '待同步'\)\) AS in_progress_count/,
  );
  assert.match(
    queries[0].text,
    /count\(\*\) FILTER \(WHERE compliance_status = '通过'\) AS passed_count/,
  );
  assert.match(
    queries[0].text,
    /ORDER BY CASE compliance_status[\s\S]*WHEN '需修正' THEN 0[\s\S]*WHEN '待补充' THEN 1[\s\S]*WHEN '审核中' THEN 2[\s\S]*WHEN '待同步' THEN 3[\s\S]*WHEN '通过' THEN 5[\s\S]*END, skc_name/,
  );
  assert.match(queries[0].text, /compliance_summary\.total_count AS compliance_total_count/);
  assert.match(queries[0].text, /compliance_summary\.in_progress_count AS compliance_in_progress_count/);
  assert.doesNotMatch(queries[0].text, /compliance_summary\.not_synced_count/);
  assert.doesNotMatch(queries[0].text, /compliance_summary\.needs_supplement_count/);
  assert.deepEqual(listResult.auditSummary, {
    notRun: 3,
    needsRerun: 2,
    pending: 4,
    reviewed: 5,
  });
  assert.deepEqual(listResult.complianceSummary, {
    total: 30,
    nonCompliant: 8,
    inProgress: 6,
    passed: 9,
  });
});

test("a clean saved preflight never enables publishing from the read projection", async () => {
  const service = new WebComplianceWorkspaceService({
    repository: {
      async getSkc() {
        return {
          id: "skc-id-1",
          skc_name: "SKC-1",
          compliance_status: "通过",
          compliance_summary: {
            sourceCoverage: {
              requirementsReturned: true,
              photoRequirementsReturned: true,
            },
          },
        };
      },
      async listRecords() { return []; },
      async listSnapshots() {
        return [{
          rule_type: "compliance_requirement",
          payload: {},
          fetched_at: "2026-08-04T00:00:00.000Z",
          expires_at: "2026-08-05T00:00:00.000Z",
          fresh: true,
        }];
      },
      async getDraft() {
        return {
          id: "draft-1",
          store_id: "store-1",
          skc_name: "SKC-1",
          preflight: { executable: true, blockers: [] },
          status: "ready",
          updated_at: "2026-08-04T00:30:00.000Z",
        };
      },
    },
  });

  const result = await service.getSkcDetail({
    context: { tenantId: "tenant-1" },
    storeId: "store-1",
    skc: "SKC-1",
  });

  assert.deepEqual(result.releaseGate.blockers, []);
  assert.equal(result.releaseGate.publishingEnabled, false);
  assert.equal(result.draft.preflight.savedExecutable, true);
});

test("saves collaborative per-SKC compliance drafts", async () => {
  let received = null;
  const service = new WebComplianceWorkspaceService({
    repository: {
      async saveDraft(input) {
        received = input;
        return {
          id: "draft-1",
          store_id: input.storeId,
          skc_name: input.skc,
          template_id: input.templateId,
          requirement_snapshot: input.requirementSnapshot,
          inputs: input.inputs,
          preflight: input.preflight,
          status: input.status,
          updated_at: "2026-07-31T12:00:00.000Z",
        };
      },
    },
  });
  const result = await service.saveDraft({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    skc: "SKC-1",
    input: {
      inputs: { certificates: [{ certificateTypeCode: "1631" }] },
      preflight: { executable: false },
      status: "blocked",
    },
  });

  assert.equal(received.tenantId, "tenant-1");
  assert.equal(received.userId, "user-1");
  assert.equal(result.draft.skc, "SKC-1");
  assert.equal(result.draft.status, "blocked");
});

test("batch template reuse remaps reusable photos without copying an unrelated report", async () => {
  let savedInput = null;
  let readCount = 0;
  const service = new WebComplianceWorkspaceService({
    now: () => new Date("2026-08-07T03:00:00.000Z"),
    repository: {
      async getSkc() {
        return {
          id: "skc-id-1",
          skc_name: "SKC-1",
          category_id: "3155",
        };
      },
      async getDraft() {
        return null;
      },
      async listMediaAssets() {
        return [{
          id: "11111111-1111-4111-8111-111111111111",
          status: "ready",
          purpose: "compliance_evidence",
        }];
      },
      async saveDraft(input) {
        savedInput = input;
        return {
          id: "draft-1",
          store_id: input.storeId,
          skc_name: input.skc,
          template_id: input.templateId,
          requirement_snapshot: input.requirementSnapshot,
          inputs: input.inputs,
          preflight: input.preflight,
          status: input.status,
          updated_at: "2026-08-07T03:00:01.000Z",
        };
      },
    },
  });

  const result = await service.applyTemplate({
    context: { tenantId: "tenant-1", userId: "user-1", role: "operator" },
    storeId: "store-1",
    skcNames: ["SKC-1"],
    template: {
      id: "template-1",
      categoryId: "3155",
      data: {
        defaults: {
          certificates: [{
            certificateTypeCode: "SmallCarpet1631",
            files: [{
              localAssetRef: "media:11111111-1111-4111-8111-111111111111",
            }],
          }],
          photos: [{
            labelId: "template-body-label",
            labelGroup: "1",
            labelName: "商品本体通用实拍图",
            localAssetRef: "media:11111111-1111-4111-8111-111111111111",
            templateReusable: true,
          }],
        },
      },
    },
    async readCompliance() {
      readCount += 1;
      return {
        row: {
          skc: "SKC-1",
          sourceCoverage: {
            requirementsReturned: true,
            photoRequirementsReturned: true,
          },
          certificateRequirements: [],
          agencyRequirements: [],
          warningRequirements: [],
          unsupportedRequirements: [],
          bodyPhotoRequirements: [{
            labelId: 11,
            labelGroup: "1",
            labelName: "商品本体实拍",
            isRequired: 1,
            reviewStatus: 0,
          }],
          packagePhotoRequirements: [],
        },
      };
    },
  });

  assert.equal(readCount, 1);
  assert.equal(result.summary.saved, 1);
  assert.equal(savedInput.inputs.certificates.length, 0);
  assert.equal(savedInput.inputs.photos[0].labelId, "11");
  assert.equal(savedInput.inputs.photos[0].labelGroup, "1");
  assert.equal(savedInput.preflight.passed, true);
  assert.equal(result.items[0].warnings.length, 0);
});

test("batch template reuse classifies 1630 or 1631 from the target product attribute snapshot", async () => {
  let savedInput = null;
  const service = new WebComplianceWorkspaceService({
    now: () => new Date("2026-08-07T03:00:00.000Z"),
    repository: {
      async getSkc() {
        return {
          id: "skc-id-1",
          skc_name: "SKC-1",
          category_id: "3155",
          raw_data: {
            attributeSnapshot: {
              attributeSchemaSnapshot: {
                fetchedAt: "2026-08-07T02:00:00.000Z",
                fields: [
                  {
                    id: "length",
                    name: "长度",
                    typeCode: 3,
                    dataDimension: 1,
                    values: [],
                  },
                  {
                    id: "width",
                    name: "宽度",
                    typeCode: 3,
                    dataDimension: 1,
                    values: [],
                  },
                ],
              },
              attributeValues: {
                length: { customValue: "180" },
                width: { customValue: "120" },
              },
              rugReportSources: {
                dimensions: [
                  { attributeId: "length", unit: "cm" },
                  { attributeId: "width", unit: "cm" },
                ],
              },
            },
          },
        };
      },
      async getDraft() {
        return null;
      },
      async saveDraft(input) {
        savedInput = input;
        return {
          id: "draft-1",
          store_id: input.storeId,
          skc_name: input.skc,
          template_id: input.templateId,
          requirement_snapshot: input.requirementSnapshot,
          inputs: input.inputs,
          preflight: input.preflight,
          status: input.status,
          updated_at: "2026-08-07T03:00:01.000Z",
        };
      },
    },
  });

  const result = await service.applyTemplate({
    context: { tenantId: "tenant-1", userId: "user-1", role: "operator" },
    storeId: "store-1",
    skcNames: ["SKC-1"],
    template: {
      id: "template-1",
      categoryId: "3155",
      data: {
        defaults: {
          photos: [],
          certificates: [{
            certificateTypeCode: "SmallCarpet1631",
            files: [{ localAssetRef: "media:report-not-copied" }],
          }],
        },
      },
    },
    async readCompliance() {
      return {
        row: {
          skc: "SKC-1",
          sourceCoverage: {
            requirementsReturned: true,
            photoRequirementsReturned: true,
          },
          certificateRequirements: [{
            certificateTypeCode: "SmallCarpet1631",
            certificateTypeName: "16 CFR 1631",
            isRequired: 0,
            reviewState: 2,
          }],
          agencyRequirements: [],
          warningRequirements: [],
          unsupportedRequirements: [],
          bodyPhotoRequirements: [],
          packagePhotoRequirements: [],
        },
      };
    },
  });

  assert.equal(result.summary.saved, 1);
  assert.equal(savedInput.preflight.reportTypes[0], "1631");
  assert.equal(
    savedInput.preflight.actions.find(
      (action) => action.type === "certificate.use_official_report_requirement",
    ).source,
    "shein_compliance_requirement",
  );
});

test("report template reuse copies only the matching 1631 material and retargets it to the current SKC", async () => {
  let savedInput = null;
  const service = new WebComplianceWorkspaceService({
    repository: {
      async getSkc() {
        return {
          id: "skc-id-1",
          skc_name: "SKC-1",
          category_id: "3155",
          raw_data: {
            attributeSnapshot: {
              attributeSchemaSnapshot: {
                fetchedAt: "2026-08-21T02:00:00.000Z",
                fields: [
                  { id: "length", name: "长度", typeCode: 3, dataDimension: 1, values: [] },
                  { id: "width", name: "宽度", typeCode: 3, dataDimension: 1, values: [] },
                ],
              },
              attributeValues: {
                length: { customValue: "180" },
                width: { customValue: "120" },
              },
              rugReportSources: {
                dimensions: [
                  { attributeId: "length", unit: "cm" },
                  { attributeId: "width", unit: "cm" },
                ],
              },
            },
          },
        };
      },
      async getDraft() { return null; },
      async listMediaAssets() {
        return [{
          id: "11111111-1111-4111-8111-111111111111",
          status: "ready",
          purpose: "compliance_evidence",
        }];
      },
      async saveDraft(input) {
        savedInput = input;
        return {
          id: "draft-1",
          store_id: input.storeId,
          skc_name: input.skc,
          template_id: input.templateId,
          requirement_snapshot: input.requirementSnapshot,
          inputs: input.inputs,
          preflight: input.preflight,
          status: input.status,
          updated_at: "2026-08-21T03:00:00.000Z",
        };
      },
    },
  });
  const template = {
    id: "template-1",
    categoryId: "3155",
    data: {
      defaults: {
        certificates: [{
          certificateTypeCode: "SmallCarpet1631",
          certificateTypeName: "16 CFR 1631",
          files: [{
            localAssetRef: "media:11111111-1111-4111-8111-111111111111",
            fileName: "1631.pdf",
          }],
          fieldValues: {},
        }],
        photos: [],
      },
    },
  };
  const readCompliance = async () => ({
    row: {
      skc: "SKC-1",
      sourceCoverage: { requirementsReturned: true, photoRequirementsReturned: true },
      certificateRequirements: [{
        certificateTypeCode: "SmallCarpet",
        isRequired: 1,
        reviewState: 0,
      }],
      bodyPhotoRequirements: [],
      packagePhotoRequirements: [],
    },
    bundle: {
      certificateSchemas: [{
        certificateTypeCode: "SmallCarpet",
        presetInfoList: [{ presetId: 175, inputType: 4, isEnabled: 1 }],
        otherPresetInfoList: [],
      }],
    },
  });
  const missingDate = await service.applyTemplate({
    context: { tenantId: "tenant-1", userId: "user-1", role: "operator" },
    storeId: "store-1",
    skcNames: ["SKC-1"],
    sections: ["certificates"],
    template,
    readCompliance,
  });
  assert.equal(missingDate.summary.saved, 0);
  assert.equal(missingDate.items[0].blockers[0].code, "REPORT_TEMPLATE_DATE_MISSING");

  template.data.defaults.certificates[0].fieldValues = {
    175: { value: "2026-08-21" },
  };
  const result = await service.applyTemplate({
    context: { tenantId: "tenant-1", userId: "user-1", role: "operator" },
    storeId: "store-1",
    skcNames: ["SKC-1"],
    sections: ["certificates"],
    template,
    readCompliance,
  });
  assert.equal(result.summary.saved, 1);
  assert.equal(savedInput.inputs.certificates[0].skc, "SKC-1");
  assert.equal(savedInput.inputs.certificates[0].poolSn, "");
  assert.equal(savedInput.inputs.certificates[0].fieldValues[175].value, "2026-08-21");
  assert.equal(
    savedInput.preflight.actions.some((action) => action.type === "certificate.map_report_template"),
    true,
  );

  template.data.templateKind = "rug_report";
  template.data.reportType = "1631";
  template.data.reportDate = "2026-07-30";
  template.data.defaults.certificates[0].fieldValues = {};
  const abstractResult = await service.applyTemplate({
    context: { tenantId: "tenant-1", userId: "user-1", role: "operator" },
    storeId: "store-1",
    skcNames: ["SKC-1"],
    sections: ["certificates"],
    template,
    readCompliance,
  });
  assert.equal(abstractResult.summary.saved, 1);
  assert.equal(savedInput.inputs.certificates[0].fieldValues[175].value, "2026-07-30");
});

test("batch template reuse does not require a local attribute classification", async () => {
  let saved = false;
  const service = new WebComplianceWorkspaceService({
    repository: {
      async getSkc() {
        return { id: "skc-id-1", skc_name: "SKC-1", category_id: "3155" };
      },
      async getDraft() {
        return null;
      },
      async saveDraft(input) {
        saved = true;
        return {
          id: "draft-1",
          store_id: input.storeId,
          skc_name: input.skc,
          template_id: input.templateId,
          requirement_snapshot: input.requirementSnapshot,
          inputs: input.inputs,
          preflight: input.preflight,
          status: input.status,
          updated_at: "2026-08-24T08:00:00.000Z",
        };
      },
    },
  });

  const result = await service.applyTemplate({
    context: { tenantId: "tenant-1", userId: "user-1", role: "operator" },
    storeId: "store-1",
    skcNames: ["SKC-1"],
    template: {
      id: "template-1",
      categoryId: "3155",
      data: { defaults: { photos: [] } },
    },
    async readCompliance() {
      return {
        row: {
          skc: "SKC-1",
          sourceCoverage: {
            requirementsReturned: true,
            photoRequirementsReturned: true,
          },
          certificateRequirements: [{
            certificateTypeCode: "SmallCarpet1631",
            isRequired: 0,
            reviewState: 2,
          }],
          agencyRequirements: [],
          warningRequirements: [],
          unsupportedRequirements: [],
          bodyPhotoRequirements: [],
          packagePhotoRequirements: [],
        },
      };
    },
  });

  assert.equal(saved, true);
  assert.equal(result.summary.saved, 1);
  assert.deepEqual(result.items[0].blockers, []);
});

test("batch template reuse blocks a target that still needs its own 1630 or 1631 report", async () => {
  let saved = false;
  const service = new WebComplianceWorkspaceService({
    repository: {
      async getSkc() {
        return { id: "skc-id-1", skc_name: "SKC-1", category_id: "3155" };
      },
      async getDraft() {
        return null;
      },
      async saveDraft() {
        saved = true;
      },
    },
  });

  const result = await service.applyTemplate({
    context: { tenantId: "tenant-1", userId: "user-1", role: "operator" },
    storeId: "store-1",
    skcNames: ["SKC-1"],
    template: {
      id: "template-1",
      categoryId: "3155",
      data: { defaults: { photos: [] } },
    },
    async readCompliance() {
      return {
        row: {
          skc: "SKC-1",
          sourceCoverage: {
            requirementsReturned: true,
            photoRequirementsReturned: true,
          },
          certificateRequirements: [{
            certificateTypeCode: "SmallCarpet1631",
            certificateTypeName: "16 CFR 1631",
            isRequired: 1,
            reviewState: 0,
          }],
          agencyRequirements: [],
          warningRequirements: [],
          unsupportedRequirements: [],
          bodyPhotoRequirements: [],
          packagePhotoRequirements: [],
        },
      };
    },
  });

  assert.equal(saved, false);
  assert.equal(result.summary.blocked, 1);
  assert.equal(result.items[0].status, "blocked");
  assert.equal(
    result.items[0].blockers.some((blocker) => blocker.code === "ATTRIBUTE_SNAPSHOT_REQUIRED"),
    false,
  );
  assert.equal(
    result.items[0].blockers.some((blocker) => blocker.code === "REPORT_TEMPLATE_MISSING"),
    true,
  );
});

test("viewer cannot save a compliance draft", async () => {
  let saved = false;
  const service = new WebComplianceWorkspaceService({
    repository: {
      async saveDraft() {
        saved = true;
      },
    },
  });

  await assert.rejects(
    service.saveDraft({
      context: { tenantId: "tenant-1", userId: "user-1", role: "viewer" },
      storeId: "store-1",
      skc: "SKC-1",
      input: { inputs: {} },
    }),
    (error) => error.code === "COMPLIANCE_DRAFT_FORBIDDEN" && error.status === 403,
  );
  assert.equal(saved, false);
});

test("rejects malformed compliance draft assignment groups", async () => {
  let saved = false;
  const service = new WebComplianceWorkspaceService({
    repository: {
      async saveDraft() {
        saved = true;
      },
    },
  });

  await assert.rejects(
    service.saveDraft({
      context: { tenantId: "tenant-1", userId: "user-1", role: "operator" },
      storeId: "store-1",
      skc: "SKC-1",
      input: { inputs: { photos: { labelId: 22 } } },
    }),
    (error) => error.code === "INVALID_DRAFT_INPUTS",
  );
  assert.equal(saved, false);
});

test("draft repository guards updates with the expected timestamp", async () => {
  let query = null;
  const repository = new PostgresComplianceWorkspaceRepository({
    pool: {
      async query(input) {
        query = input;
        return { rows: [{ id: "draft-1" }] };
      },
    },
  });
  await repository.saveDraft({
    tenantId: "tenant-1",
    storeId: "store-1",
    skc: "SKC-1",
    templateId: null,
    requirementSnapshot: {},
    inputs: { photos: [] },
    preflight: {},
    status: "draft",
    userId: "user-1",
    expectedUpdatedAt: "2026-08-04T02:00:00.000Z",
  });

  assert.match(query.text, /\$10::timestamptz IS NULL/);
  assert.match(query.text, /compliance_drafts\.updated_at = \$10/);
  assert.equal(query.values[9], "2026-08-04T02:00:00.000Z");
});

test("compliance template repository no longer writes a reference SKC", async () => {
  let query = null;
  const repository = new PostgresComplianceWorkspaceRepository({
    pool: {
      async query(input) {
        query = input;
        return { rows: [{ id: "template-1" }] };
      },
    },
  });

  await repository.saveTemplate({
    tenantId: "tenant-1",
    storeId: "store-1",
    name: "店铺通用实拍图",
    defaults: { photos: [{ localAssetRef: "media:photo-1" }] },
    ruleSnapshot: {},
    ruleSnapshotAt: null,
    userId: "user-1",
  });

  assert.doesNotMatch(query.text, /reference_skc/);
  assert.deepEqual(query.values, [
    "tenant-1",
    "store-1",
    "店铺通用实拍图",
    JSON.stringify({ photos: [{ localAssetRef: "media:photo-1" }] }),
    JSON.stringify({}),
    null,
    "user-1",
  ]);
});

test("keeps rug report sources and reusable body or package photos only", async () => {
  let received = null;
  const service = new WebComplianceWorkspaceService({
    repository: {
      async saveTemplate(input) {
        received = input;
        return {
          id: "template-1",
          store_id: input.storeId,
          name: input.name,
          reference_skc: input.referenceSkc,
          defaults: input.defaults,
          rule_snapshot: input.ruleSnapshot,
          rule_snapshot_at: input.ruleSnapshotAt,
          status: "active",
          version: 1,
          updated_at: "2026-07-31T12:00:00.000Z",
        };
      },
    },
  });
  await service.saveTemplate({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    input: {
      name: "地毯合规素材",
      referenceSkc: "SKC-1",
      defaults: {
        certificates: [
          { certificateTypeName: "16 CFR 1631", skc: "SKC-1" },
          { certificateTypeCode: "REACH", poolSn: "POOL-1" },
        ],
        agencies: [{ certificateTypeCode: "EURespPerson", agencyId: "A-1" }],
        photos: [
          {
            labelId: 11,
            labelGroup: "2",
            templateReusable: true,
            localAssetRef: "media:a",
          },
          {
            labelId: 22,
            labelGroup: "1",
            templateReusable: true,
            localAssetRef: "media:b",
          },
          {
            labelId: 33,
            labelGroup: "3",
            templateReusable: true,
            localAssetRef: "media:c",
          },
        ],
      },
    },
  });

  assert.equal(received.referenceSkc, undefined);
  assert.deepEqual(received.defaults.certificates, [
    { certificateTypeName: "16 CFR 1631", skc: "SKC-1" },
  ]);
  assert.deepEqual(received.defaults.agencies, []);
  assert.deepEqual(received.defaults.warnings, []);
  assert.deepEqual(received.defaults.photos, [
    {
      labelId: 11,
      labelGroup: "2",
      templateReusable: true,
      localAssetRef: "media:a",
    },
    {
      labelId: 22,
      labelGroup: "1",
      templateReusable: true,
      localAssetRef: "media:b",
    },
  ]);
});

test("saves a photo-only compliance template without requiring a reference SKC", async () => {
  let received = null;
  const service = new WebComplianceWorkspaceService({
    repository: {
      async saveTemplate(input) {
        received = input;
        return {
          id: "template-photo-only",
          store_id: input.storeId,
          name: input.name,
          reference_skc: input.referenceSkc,
          defaults: input.defaults,
          rule_snapshot: input.ruleSnapshot,
          rule_snapshot_at: input.ruleSnapshotAt,
          status: "active",
          version: 1,
          updated_at: "2026-08-23T00:00:00.000Z",
        };
      },
    },
  });

  await service.saveTemplate({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    input: {
      name: "店铺通用包装实拍图",
      referenceSkc: "legacy-skc-should-be-ignored",
      defaults: {
        photos: [{
          labelGroup: "2",
          templateReusable: true,
          localAssetRef: "media:package-1",
        }],
      },
    },
  });

  assert.equal(received.referenceSkc, undefined);
  assert.equal(received.defaults.photos.length, 1);
});

test("rejects an empty compliance template without a reference SKC", async () => {
  const service = new WebComplianceWorkspaceService({
    repository: {
      async saveTemplate() {
        throw new Error("repository should not be called");
      },
    },
  });

  await assert.rejects(
    service.saveTemplate({
      context: { tenantId: "tenant-1", userId: "user-1" },
      storeId: "store-1",
      input: { name: "空方案", referenceSkc: "", defaults: {} },
    }),
    (error) => error.code === "INVALID_TEMPLATE_MATERIALS",
  );
});

test("viewer cannot create a server compliance preflight run", async () => {
  let queried = false;
  const service = new WebComplianceWorkspaceService({
    repository: {
      async getSkc() {
        queried = true;
      },
    },
  });

  await assert.rejects(
    service.runPreflight({
      context: { tenantId: "tenant-1", userId: "user-1", role: "viewer" },
      storeId: "store-1",
      skc: "SKC-1",
    }),
    (error) =>
      error.code === "COMPLIANCE_PREFLIGHT_FORBIDDEN" && error.status === 403,
  );
  assert.equal(queried, false);
});

test("only administrators can append a review for the latest preflight", async () => {
  let inserted = null;
  const service = new WebComplianceWorkspaceService({
    now: () => new Date("2026-08-04T03:00:00.000Z"),
    repository: {
      async createPreflightReview(input) {
        inserted = input;
        return {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          preflight_run_id: input.preflightRunId,
          skc_name: input.skc,
          reviewed_by: input.userId,
          reviewer_display_name: "管理员",
          reviewed_status: "ready",
          action_count: 2,
          blocker_count: 0,
          warning_count: 1,
          input_fingerprint: "input-fingerprint",
          rule_fingerprint: "rule-fingerprint",
          media_fingerprint: "media-fingerprint",
          reviewed_at: input.reviewedAt,
        };
      },
    },
  });
  const preflightRunId = "55555555-5555-4555-8555-555555555555";

  await assert.rejects(
    service.reviewPreflight({
      context: { tenantId: "tenant-1", userId: "operator-1", role: "operator" },
      storeId: "store-1",
      skc: "SKC-1",
      preflightRunId,
    }),
    (error) => error.code === "COMPLIANCE_PREFLIGHT_REVIEW_FORBIDDEN",
  );
  assert.equal(inserted, null);

  const result = await service.reviewPreflight({
    context: { tenantId: "tenant-1", userId: "admin-1", role: "admin" },
    storeId: "store-1",
    skc: "SKC-1",
    preflightRunId,
  });

  assert.deepEqual(inserted, {
    tenantId: "tenant-1",
    storeId: "store-1",
    skc: "SKC-1",
    preflightRunId,
    userId: "admin-1",
    reviewedAt: new Date("2026-08-04T03:00:00.000Z"),
  });
  assert.equal(result.review.preflightRunId, preflightRunId);
  assert.equal(result.review.authorizesPublishing, false);
});

test("server compliance preflight requires a fresh requirement snapshot", async () => {
  let inserted = false;
  const service = new WebComplianceWorkspaceService({
    repository: {
      async getSkc() {
        return { id: "11111111-1111-4111-8111-111111111111", skc_name: "SKC-1" };
      },
      async getDraft() {
        return { id: "22222222-2222-4222-8222-222222222222", inputs: {} };
      },
      async listFreshPreflightSnapshots() {
        return [];
      },
      async createPreflightRun() {
        inserted = true;
      },
    },
  });

  await assert.rejects(
    service.runPreflight({
      context: { tenantId: "tenant-1", userId: "user-1", role: "operator" },
      storeId: "store-1",
      skc: "SKC-1",
    }),
    (error) =>
      error.code === "FRESH_RULE_SNAPSHOT_REQUIRED" && error.status === 409,
  );
  assert.equal(inserted, false);
});

test("server compliance preflight fingerprints protected media and appends an audit run", async () => {
  const mediaId = "33333333-3333-4333-8333-333333333333";
  let inserted = null;
  const service = new WebComplianceWorkspaceService({
    now: () => new Date("2026-08-04T02:00:00.000Z"),
    repository: {
      async getSkc() {
        return { id: "11111111-1111-4111-8111-111111111111", skc_name: "SKC-1" };
      },
      async getDraft() {
        return {
          id: "22222222-2222-4222-8222-222222222222",
          inputs: {
            photos: [{
              labelId: 22,
              labelGroup: "BODY",
              localAssetRef: `media:${mediaId}`,
            }],
          },
        };
      },
      async listFreshPreflightSnapshots(input) {
        assert.equal(input.now.toISOString(), "2026-08-04T02:00:00.000Z");
        return [{
          id: "44444444-4444-4444-8444-444444444444",
          rule_type: "compliance_requirement",
          fingerprint: "requirement-fingerprint",
          payload: {
            skc: "SKC-1",
            sourceCoverage: {
              requirementsReturned: true,
              photoRequirementsReturned: true,
            },
            bodyPhotoRequirements: [{
              labelId: 22,
              labelGroup: "BODY",
              labelName: "商品实拍",
              isRequired: 1,
              reviewStatus: 0,
            }],
          },
          fetched_at: "2026-08-04T01:00:00.000Z",
          expires_at: "2026-08-05T01:00:00.000Z",
        }];
      },
      async listMediaAssets(input) {
        assert.deepEqual(input.assetIds, [mediaId]);
        return [{
          id: mediaId,
          status: "ready",
          purpose: "compliance_evidence",
          sha256: "asset-sha256",
          size_bytes: "2048",
          content_type: "image/jpeg",
        }];
      },
      async createPreflightRun(input) {
        inserted = input;
        return {
          id: "55555555-5555-4555-8555-555555555555",
          skc_name: input.skc,
          status: input.plan.status,
          executable: input.plan.executable,
          plan: input.plan,
          input_fingerprint: input.inputFingerprint,
          rule_fingerprint: input.ruleFingerprint,
          media_fingerprint: input.mediaFingerprint,
          requirement_rule_snapshot_id: input.requirementRuleSnapshotId,
          certificate_rule_snapshot_id: null,
          created_at: input.createdAt,
        };
      },
    },
  });

  const result = await service.runPreflight({
    context: { tenantId: "tenant-1", userId: "user-1", role: "operator" },
    storeId: "store-1",
    skc: "SKC-1",
  });

  assert.equal(inserted.plan.status, "ready");
  assert.equal(inserted.plan.executable, true);
  assert.equal(inserted.mediaAssets[0].id, mediaId);
  assert.equal(inserted.mediaAssets[0].sha256, "asset-sha256");
  assert.match(inserted.inputFingerprint, /^[a-f0-9]{64}$/);
  assert.match(inserted.ruleFingerprint, /^[a-f0-9]{64}$/);
  assert.match(inserted.mediaFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(result.preflight.executable, true);
  assert.equal(result.preflight.publishingEnabled, false);
  assert.deepEqual(result.preflight.actionTypes, ["photo.upload_and_bind"]);
});

test("server compliance preflight rejects unprotected local media", async () => {
  let inserted = false;
  const service = new WebComplianceWorkspaceService({
    repository: {
      async getSkc() {
        return { id: "11111111-1111-4111-8111-111111111111", skc_name: "SKC-1" };
      },
      async getDraft() {
        return {
          id: "22222222-2222-4222-8222-222222222222",
          inputs: { photos: [{ labelId: 22, localAssetRef: "blob:browser-only" }] },
        };
      },
      async listFreshPreflightSnapshots() {
        return [{
          id: "44444444-4444-4444-8444-444444444444",
          rule_type: "compliance_requirement",
          fingerprint: "requirement-fingerprint",
          payload: {
            skc: "SKC-1",
            sourceCoverage: {
              requirementsReturned: true,
              photoRequirementsReturned: true,
            },
          },
        }];
      },
      async createPreflightRun() {
        inserted = true;
      },
    },
  });

  await assert.rejects(
    service.runPreflight({
      context: { tenantId: "tenant-1", userId: "user-1", role: "operator" },
      storeId: "store-1",
      skc: "SKC-1",
    }),
    (error) =>
      error.code === "UNPROTECTED_COMPLIANCE_MEDIA" && error.status === 409,
  );
  assert.equal(inserted, false);
});

test("SKC detail projects only enabled certificate schema choices", async () => {
  const service = new WebComplianceWorkspaceService({
    repository: {
      async getSkc() {
        return { id: "skc-id-1", skc_name: "SKC-1", compliance_summary: {} };
      },
      async listRecords() { return []; },
      async getDraft() { return null; },
      async getLatestPreflightRun() { return null; },
      async listSnapshots() {
        return [{
          rule_type: "compliance_requirement",
          payload: {
            skc: "SKC-1",
            certificateRequirements: [{
              certificateTypeCode: "CERT-7",
              certificateTypeId: 7,
              certificateTypeName: "地毯测试报告",
              complianceGroupCode: "ZSZZL",
              isRequired: 1,
            }],
            agencyRequirements: [{
              certificateTypeCode: "EuRespPerson",
              certificateTypeName: "欧盟责任人",
              complianceGroupCode: "GSL",
              isRequired: 1,
            }],
            warningRequirements: [{
              certificateTypeId: 900,
              certificateTypeCode: "RUG-WARNING",
              certificateTypeName: "地毯警示语",
              complianceGroupCode: "HGXXL",
              isManualProductWarning: true,
              isRequired: 1,
            }],
          },
          fresh: true,
        }, {
          rule_type: "certificate_schema",
          payload: {
            certificateSchemas: [{
              certificateTypeId: 7,
              certificateType: "地毯测试报告",
              certificateDimension: 1,
              certificateLabel: 0,
              isEnabled: 1,
              presetInfoList: [{
                presetId: 10,
                presetRemark: "检测结论",
                inputType: 1,
                isRequired: 1,
                isEnabled: 1,
                presetValueList: [
                  { presetValueId: 100, presetValue: "通过", isEnabled: 1 },
                  { presetValueId: 101, presetValue: "停用", isEnabled: 0 },
                ],
              }, {
                presetId: 11,
                inputType: 3,
                isEnabled: 0,
              }],
            }],
            srmDetectionAgencyList: [{
              detectionAgency: {
                detectionAgencyId: 88,
                detectionAgencyName: "检测机构A",
              },
              laboratoryList: [{ laboratoryId: 99, laboratoryName: "实验室A" }],
            }],
          },
          fresh: true,
        }, {
          rule_type: "certificate_library",
          payload: {
            certificates: [{
              poolId: 501,
              poolSn: "POOL-ACTIVE",
              certificateTypeId: 7,
              certificateTypeCode: "CERT-7",
              certificateTypeName: "地毯测试报告",
              status: 2,
              certificateDimension: 1,
              effectiveTime: "2026-01-01 00:00:00",
              invalidTime: "2028-01-01 00:00:00",
              alertTime: "2027-12-01 00:00:00",
              bindSkcFlag: 0,
              lastUpdateTime: "2026-08-04 00:00:00",
              fileNames: ["report.pdf"],
            }, {
              poolId: 502,
              poolSn: "POOL-EXPIRED",
              certificateTypeId: 7,
              certificateTypeCode: "CERT-7",
              certificateTypeName: "地毯测试报告",
              status: 3,
              fileNames: [],
            }],
          },
          fresh: true,
        }, {
          rule_type: "agency_library",
          payload: {
            agencies: [{
              agencyId: 118021903,
              agencyName: "欧盟责任人A",
              agencyType: 0,
              agencySubType: 20,
              agencyStartTime: "2025-11-05",
              agencyEndTime: "2031-11-30",
              agencyStatus: 0,
              applyStatus: 2,
              coveredProductRange: 2,
              updateTime: "2025-11-05 17:48:00",
            }, {
              agencyId: 118021904,
              agencyName: "审核失败公司",
              agencyStatus: 0,
              applyStatus: 3,
              coveredProductRange: 2,
            }],
          },
          fresh: true,
        }, {
          rule_type: "warning_rules",
          payload: {
            warningRules: [{
              certificateTypeId: 900,
              certificateTypeCode: "RUG-WARNING",
              certificateTypeName: "地毯警示语",
              fields: [{
                fieldCode: "MATERIAL",
                fieldName: "商品属性",
                fieldType: 0,
                fieldSort: 0,
                values: [{
                  fieldValueId: 10,
                  fieldValue: "含防滑背衬",
                  exclusionFieldValueIds: [11],
                  mappingPaths: [],
                  valueSort: 0,
                }],
              }, {
                fieldCode: "WARNING",
                fieldName: "警示语",
                fieldType: 2,
                fieldSort: 1,
                values: [{
                  fieldValueId: 20,
                  fieldValue: "注意防滑",
                  exclusionFieldValueIds: [],
                  mappingPaths: [{ fieldValueIds: [10] }],
                  valueSort: 0,
                }],
              }],
            }, {
              certificateTypeId: 901,
              certificateTypeCode: "OTHER-WARNING",
              certificateTypeName: "其他警示语",
              fields: [],
            }],
          },
          fresh: true,
        }];
      },
    },
  });

  const result = await service.getSkcDetail({
    context: { tenantId: "tenant-1" },
    storeId: "store-1",
    skc: "SKC-1",
  });

  assert.equal(result.editorModel.certificateRulesFresh, true);
  assert.equal(result.editorModel.certificates[0].supported, true);
  assert.equal(result.editorModel.certificates[0].fields.length, 1);
  assert.deepEqual(result.editorModel.certificates[0].fields[0].options, [
    { id: "100", label: "通过" },
  ]);
  assert.deepEqual(result.editorModel.detectionAgencies, [{
    id: "88",
    name: "检测机构A",
    laboratories: [{ id: "99", name: "实验室A" }],
  }]);
  assert.equal(result.editorModel.certificateLibraryFresh, true);
  assert.deepEqual(result.editorModel.certificateLibrary, [{
    poolId: "501",
    poolSn: "POOL-ACTIVE",
    certificateTypeId: "7",
    certificateTypeCode: "CERT-7",
    name: "地毯测试报告",
    certificateDimension: 1,
    effectiveTime: "2026-01-01 00:00:00",
    invalidTime: "2028-01-01 00:00:00",
    alertTime: "2027-12-01 00:00:00",
    bindSkcFlag: 0,
    lastUpdateTime: "2026-08-04 00:00:00",
    fileNames: ["report.pdf"],
  }]);
  assert.equal(result.editorModel.agencyLibraryFresh, true);
  assert.deepEqual(result.editorModel.agencyRequirements, [{
    key: "EuRespPerson",
    certificateTypeId: null,
    certificateTypeCode: "EuRespPerson",
    name: "欧盟责任人",
    required: true,
    agencyType: 0,
  }]);
  assert.deepEqual(result.editorModel.agencyLibrary, [{
    agencyId: "118021903",
    name: "欧盟责任人A",
    agencyType: 0,
    agencySubType: 20,
    agencyStartTime: "2025-11-05",
    agencyEndTime: "2031-11-30",
    coveredProductRange: 2,
    updateTime: "2025-11-05 17:48:00",
  }]);
  assert.equal(result.editorModel.warningRulesRequired, true);
  assert.equal(result.editorModel.warningRulesFresh, true);
  assert.deepEqual(result.editorModel.warningRules, [{
    certificateTypeId: "900",
    certificateTypeCode: "RUG-WARNING",
    name: "地毯警示语",
    fields: [{
      fieldCode: "MATERIAL",
      name: "商品属性",
      fieldType: 0,
      fieldSort: 0,
      values: [{
        id: "10",
        label: "含防滑背衬",
        exclusionFieldValueIds: ["11"],
        mappingPaths: [],
      }],
    }, {
      fieldCode: "WARNING",
      name: "警示语",
      fieldType: 2,
      fieldSort: 1,
      values: [{
        id: "20",
        label: "注意防滑",
        exclusionFieldValueIds: [],
        mappingPaths: [["10"]],
      }],
    }],
  }]);
});

test("SKC detail projects official GCC and product identifier read fields", async () => {
  const service = new WebComplianceWorkspaceService({
    repository: {
      async getSkc() {
        return { id: "skc-id-1", skc_name: "SKC-1", compliance_summary: {} };
      },
      async listRecords() { return []; },
      async getDraft() { return null; },
      async getLatestPreflightRun() { return null; },
      async listSnapshots() {
        return [{
          rule_type: "compliance_requirement",
          payload: {
            unsupportedRequirements: [{
              certificateTypeCode: "GCCHGXX",
              certificateTypeId: 1188,
              certificateTypeName: "GCC合规信息",
              complianceGroupCode: "HGXXL",
              isManualProductWarning: false,
              isAutoProductWarning: false,
              isRequired: 1,
              reviewState: 3,
            }, {
              certificateTypeCode: "ProductIdenti",
              certificateTypeId: 844,
              certificateTypeName: "产品标识符",
              complianceGroupCode: "HGXXL",
              isManualProductWarning: false,
              isAutoProductWarning: false,
              isRequired: 0,
              reviewState: 2,
            }, {
              certificateTypeCode: "INSTRUCTION",
              certificateTypeId: 999,
              certificateTypeName: "说明书",
              isRequired: 1,
            }],
          },
          fresh: true,
        }];
      },
    },
  });

  const result = await service.getSkcDetail({
    context: { tenantId: "tenant-1" },
    storeId: "store-1",
    skc: "SKC-1",
  });

  assert.deepEqual(result.editorModel.platformCapabilities, [{
    capabilityKey: "gcc",
    readEndpoint: "/open-api/goods-compliance-requirements/list",
    certificateTypeId: 1188,
    certificateTypeCode: "GCCHGXX",
    certificateTypeName: "GCC合规信息",
    complianceGroupCode: "HGXXL",
    isManualProductWarning: false,
    isAutoProductWarning: false,
    isRequired: 1,
    reviewState: 3,
    editable: false,
    writeStatus: "unsupported_by_official_api",
    writeEndpoint: null,
    writeFields: null,
  }, {
    capabilityKey: "product_identifier",
    readEndpoint: "/open-api/goods-compliance-requirements/list",
    certificateTypeId: 844,
    certificateTypeCode: "ProductIdenti",
    certificateTypeName: "产品标识符",
    complianceGroupCode: "HGXXL",
    isManualProductWarning: false,
    isAutoProductWarning: false,
    isRequired: 0,
    reviewState: 2,
    editable: false,
    writeStatus: "unsupported_by_official_api",
    writeEndpoint: null,
    writeFields: null,
  }]);
});

test("server preflight replaces browser certificate schema and ignores untrusted pool ids", async () => {
  let inserted = null;
  const service = new WebComplianceWorkspaceService({
    repository: {
      async getSkc() {
        return { id: "11111111-1111-4111-8111-111111111111", skc_name: "SKC-1" };
      },
      async getDraft() {
        return {
          id: "22222222-2222-4222-8222-222222222222",
          inputs: { certificates: [{
            certificateTypeCode: "CERT-7",
            certificateTypeId: 7,
            poolSn: "BROWSER-FAKE-POOL",
            status: 2,
            schema: { certificateTypeId: 7, isEnabled: 1, certificateLabel: 0 },
            files: [{
              fileName: "fake.pdf",
              fileUrl: "https://browser.example/fake.pdf",
              fileMd5: "2230eacf3617c2a4604758ea3ae871b9",
            }],
          }] },
        };
      },
      async listFreshPreflightSnapshots() {
        return [{
          id: "44444444-4444-4444-8444-444444444444",
          rule_type: "compliance_requirement",
          fingerprint: "requirement-fingerprint",
          payload: {
            skc: "SKC-1",
            sourceCoverage: {
              requirementsReturned: true,
              photoRequirementsReturned: true,
            },
            certificateRequirements: [{
              certificateTypeCode: "CERT-7",
              certificateTypeId: 7,
              certificateTypeName: "地毯测试报告",
              complianceGroupCode: "ZSZZL",
              isRequired: 1,
              reviewState: 0,
            }],
          },
        }, {
          id: "55555555-5555-4555-8555-555555555555",
          rule_type: "certificate_schema",
          fingerprint: "schema-fingerprint",
          payload: {
            certificateSchemas: [{
              certificateTypeId: 7,
              certificateDimension: 1,
              certificateLabel: 0,
              isEnabled: 1,
            }],
          },
        }];
      },
      async createPreflightRun(input) {
        inserted = input;
        return {
          id: "66666666-6666-4666-8666-666666666666",
          skc_name: input.skc,
          status: input.plan.status,
          executable: input.plan.executable,
          plan: input.plan,
          input_fingerprint: input.inputFingerprint,
          rule_fingerprint: input.ruleFingerprint,
          media_fingerprint: input.mediaFingerprint,
          requirement_rule_snapshot_id: input.requirementRuleSnapshotId,
          certificate_rule_snapshot_id: input.certificateRuleSnapshotId,
          created_at: input.createdAt,
        };
      },
    },
  });

  const result = await service.runPreflight({
    context: { tenantId: "tenant-1", userId: "user-1", role: "operator" },
    storeId: "store-1",
    skc: "SKC-1",
  });

  assert.equal(inserted.plan.executable, false);
  assert.equal(inserted.plan.actions.length, 0);
  assert.ok(inserted.plan.blockers.some((item) => item.code === "CERTIFICATE_FILE_REQUIRED"));
  assert.equal(result.preflight.publishingEnabled, false);
});

test("server preflight trusts only an active same-type certificate pool record", async () => {
  let inserted = null;
  const service = new WebComplianceWorkspaceService({
    repository: {
      async getSkc() {
        return { id: "11111111-1111-4111-8111-111111111111", skc_name: "SKC-1" };
      },
      async getDraft() {
        return {
          id: "22222222-2222-4222-8222-222222222222",
          inputs: { certificates: [{
            certificateTypeCode: "CERT-7",
            certificateTypeId: 7,
            poolSn: "POOL-TRUSTED",
            status: 3,
            certificateDimension: 2,
            schema: { certificateTypeId: 999, isEnabled: 0 },
            files: [],
            fieldValues: {},
          }] },
        };
      },
      async listFreshPreflightSnapshots() {
        return [{
          id: "44444444-4444-4444-8444-444444444444",
          rule_type: "compliance_requirement",
          fingerprint: "requirement-fingerprint",
          payload: {
            skc: "SKC-1",
            sourceCoverage: {
              requirementsReturned: true,
              photoRequirementsReturned: true,
            },
            certificateRequirements: [{
              certificateTypeCode: "CERT-7",
              certificateTypeId: 7,
              certificateTypeName: "地毯测试报告",
              complianceGroupCode: "ZSZZL",
              isRequired: 1,
              reviewState: 0,
            }],
          },
        }, {
          id: "77777777-7777-4777-8777-777777777777",
          rule_type: "certificate_library",
          fingerprint: "library-fingerprint",
          payload: {
            certificates: [{
              poolId: 501,
              poolSn: "POOL-TRUSTED",
              certificateTypeId: 7,
              certificateTypeCode: "CERT-7",
              certificateTypeName: "地毯测试报告",
              status: 2,
              certificateDimension: 1,
            }, {
              poolId: 502,
              poolSn: "POOL-WRONG-TYPE",
              certificateTypeId: 8,
              certificateTypeCode: "CERT-8",
              status: 2,
              certificateDimension: 2,
            }],
          },
        }];
      },
      async createPreflightRun(input) {
        inserted = input;
        return {
          id: "66666666-6666-4666-8666-666666666666",
          skc_name: input.skc,
          status: input.plan.status,
          executable: input.plan.executable,
          plan: input.plan,
          input_fingerprint: input.inputFingerprint,
          rule_fingerprint: input.ruleFingerprint,
          media_fingerprint: input.mediaFingerprint,
          requirement_rule_snapshot_id: input.requirementRuleSnapshotId,
          certificate_rule_snapshot_id: input.certificateRuleSnapshotId,
          created_at: input.createdAt,
        };
      },
    },
  });

  await service.runPreflight({
    context: { tenantId: "tenant-1", userId: "user-1", role: "operator" },
    storeId: "store-1",
    skc: "SKC-1",
  });

  assert.equal(inserted.certificateLibrarySnapshotId, "77777777-7777-4777-8777-777777777777");
  assert.equal(inserted.plan.executable, true);
  assert.deepEqual(inserted.plan.actions, [{
    type: "certificate.bind_existing",
    requirementKey: "CERT-7",
    certificateTypeCode: "CERT-7",
    certificateTypeId: 7,
    poolSn: "POOL-TRUSTED",
  }]);
});

test("server preflight trusts only an approved same-type agency record", async () => {
  let inserted = null;
  let browserAgency = {
    agencyId: "AGENCY-TRUSTED",
    agencyStatus: 1,
    applyStatus: 0,
    agencyType: 4,
    coveredProductRange: 1,
  };
  const service = new WebComplianceWorkspaceService({
    repository: {
      async getSkc() {
        return { id: "11111111-1111-4111-8111-111111111111", skc_name: "SKC-1" };
      },
      async getDraft() {
        return {
          id: "22222222-2222-4222-8222-222222222222",
          inputs: { agencies: [{
            certificateTypeCode: "EuRespPerson",
            certificateTypeId: 201,
            ...browserAgency,
          }] },
        };
      },
      async listFreshPreflightSnapshots() {
        return [{
          id: "44444444-4444-4444-8444-444444444444",
          rule_type: "compliance_requirement",
          fingerprint: "requirement-fingerprint",
          payload: {
            skc: "SKC-1",
            sourceCoverage: {
              requirementsReturned: true,
              photoRequirementsReturned: true,
            },
            agencyRequirements: [{
              certificateTypeCode: "EuRespPerson",
              certificateTypeId: 201,
              certificateTypeName: "欧盟责任人",
              complianceGroupCode: "GSL",
              isRequired: 1,
              reviewState: 0,
            }],
          },
        }, {
          id: "88888888-8888-4888-8888-888888888888",
          rule_type: "agency_library",
          fingerprint: "agency-library-fingerprint",
          payload: {
            agencies: [{
              agencyId: "AGENCY-TRUSTED",
              agencyName: "欧盟责任人A",
              agencyStatus: 0,
              applyStatus: 2,
              agencyType: 0,
              coveredProductRange: 2,
            }, {
              agencyId: "AGENCY-WRONG-TYPE",
              agencyName: "英国代理A",
              agencyStatus: 0,
              applyStatus: 2,
              agencyType: 1,
              coveredProductRange: 2,
            }],
          },
        }];
      },
      async createPreflightRun(input) {
        inserted = input;
        return {
          id: "66666666-6666-4666-8666-666666666666",
          skc_name: input.skc,
          status: input.plan.status,
          executable: input.plan.executable,
          plan: input.plan,
          input_fingerprint: input.inputFingerprint,
          rule_fingerprint: input.ruleFingerprint,
          media_fingerprint: input.mediaFingerprint,
          requirement_rule_snapshot_id: input.requirementRuleSnapshotId,
          certificate_rule_snapshot_id: input.certificateRuleSnapshotId,
          created_at: input.createdAt,
        };
      },
    },
  });

  await service.runPreflight({
    context: { tenantId: "tenant-1", userId: "user-1", role: "operator" },
    storeId: "store-1",
    skc: "SKC-1",
  });

  assert.equal(inserted.agencyLibrarySnapshotId, "88888888-8888-4888-8888-888888888888");
  assert.equal(inserted.plan.executable, true);
  assert.deepEqual(inserted.plan.actions, [{
    type: "agency.bind",
    requirementKey: "EuRespPerson",
    certificateTypeCode: "EuRespPerson",
    certificateTypeId: 201,
    agencyId: "AGENCY-TRUSTED",
    agencyType: 0,
  }]);

  browserAgency = {
    agencyId: "AGENCY-WRONG-TYPE",
    agencyStatus: 0,
    applyStatus: 2,
    agencyType: 0,
    coveredProductRange: 2,
  };
  await service.runPreflight({
    context: { tenantId: "tenant-1", userId: "user-1", role: "operator" },
    storeId: "store-1",
    skc: "SKC-1",
  });
  assert.equal(inserted.plan.executable, false);
  assert.equal(inserted.plan.actions.length, 0);
  assert.ok(inserted.plan.blockers.some(
    (item) => item.code === "AGENCY_ASSIGNMENT_REQUIRED",
  ));
});

test("server preflight rebuilds warning rules and applies mappings and exclusions", async () => {
  let inserted = null;
  let selectedMaterialIds = ["10"];
  const service = new WebComplianceWorkspaceService({
    repository: {
      async getSkc() {
        return { id: "11111111-1111-4111-8111-111111111111", skc_name: "SKC-1" };
      },
      async getDraft() {
        return {
          id: "22222222-2222-4222-8222-222222222222",
          inputs: { warnings: [{
            certificateTypeCode: "RUG-WARNING",
            certificateTypeId: 900,
            selectedByField: { MATERIAL: selectedMaterialIds },
            rules: {
              certificateTypeCode: "FAKE-WARNING",
              presetInfo: {
                presetFields: [{
                  fieldCode: "MATERIAL",
                  isEnabled: 1,
                  presetFieldValues: [{ fieldValueId: 999, isEnabled: 1 }],
                }],
              },
            },
          }] },
        };
      },
      async listFreshPreflightSnapshots() {
        return [{
          id: "44444444-4444-4444-8444-444444444444",
          rule_type: "compliance_requirement",
          fingerprint: "requirement-fingerprint",
          payload: {
            skc: "SKC-1",
            sourceCoverage: {
              requirementsReturned: true,
              photoRequirementsReturned: true,
            },
            warningRequirements: [{
              certificateTypeCode: "RUG-WARNING",
              certificateTypeId: 900,
              certificateTypeName: "地毯警示语",
              complianceGroupCode: "HGXXL",
              isManualProductWarning: true,
              isRequired: 1,
              reviewState: 0,
            }],
          },
        }, {
          id: "99999999-9999-4999-8999-999999999999",
          rule_type: "warning_rules",
          fingerprint: "warning-rules-fingerprint",
          payload: {
            warningRules: [{
              certificateTypeId: 900,
              certificateTypeCode: "RUG-WARNING",
              certificateTypeName: "地毯警示语",
              fields: [{
                fieldCode: "MATERIAL",
                fieldName: "商品属性",
                fieldType: 0,
                fieldSort: 0,
                values: [{
                  fieldValueId: 10,
                  fieldValue: "含防滑背衬",
                  exclusionFieldValueIds: [11],
                  mappingPaths: [],
                  valueSort: 0,
                }, {
                  fieldValueId: 11,
                  fieldValue: "不含防滑背衬",
                  exclusionFieldValueIds: [10],
                  mappingPaths: [],
                  valueSort: 1,
                }],
              }, {
                fieldCode: "WARNING",
                fieldName: "警示语",
                fieldType: 2,
                fieldSort: 1,
                values: [{
                  fieldValueId: 20,
                  fieldValue: "注意防滑",
                  exclusionFieldValueIds: [],
                  mappingPaths: [{ fieldValueIds: [10] }],
                  valueSort: 0,
                }],
              }],
            }],
          },
        }];
      },
      async createPreflightRun(input) {
        inserted = input;
        return {
          id: "66666666-6666-4666-8666-666666666666",
          skc_name: input.skc,
          status: input.plan.status,
          executable: input.plan.executable,
          plan: input.plan,
          input_fingerprint: input.inputFingerprint,
          rule_fingerprint: input.ruleFingerprint,
          media_fingerprint: input.mediaFingerprint,
          requirement_rule_snapshot_id: input.requirementRuleSnapshotId,
          certificate_rule_snapshot_id: input.certificateRuleSnapshotId,
          created_at: input.createdAt,
        };
      },
    },
  });

  await service.runPreflight({
    context: { tenantId: "tenant-1", userId: "user-1", role: "operator" },
    storeId: "store-1",
    skc: "SKC-1",
  });

  assert.equal(inserted.warningRulesSnapshotId, "99999999-9999-4999-8999-999999999999");
  assert.equal(inserted.plan.executable, true);
  assert.equal(inserted.plan.actions[0].type, "warning.update");
  assert.equal(inserted.plan.actions[0].rules.certificateTypeCode, "RUG-WARNING");
  assert.deepEqual(inserted.plan.actions[0].selectedByField, {
    MATERIAL: ["10"],
    WARNING: ["20"],
  });

  selectedMaterialIds = ["10", "11"];
  await service.runPreflight({
    context: { tenantId: "tenant-1", userId: "user-1", role: "operator" },
    storeId: "store-1",
    skc: "SKC-1",
  });
  assert.equal(inserted.plan.executable, false);
  assert.equal(inserted.plan.actions.length, 0);
  assert.ok(inserted.plan.blockers.some(
    (item) => item.code === "WARNING_VALUES_CONFLICT",
  ));
});

test("compliance preflight repository uses scoped append-only queries", async () => {
  const queries = [];
  const repository = new PostgresComplianceWorkspaceRepository({
    pool: {
      async query(input) {
        queries.push(input);
        return { rows: [], rowCount: 0 };
      },
    },
  });

  await repository.listFreshPreflightSnapshots({
    tenantId: "tenant-1",
    storeId: "store-1",
    skc: "SKC-1",
    now: new Date("2026-08-04T02:00:00.000Z"),
  });
  await repository.listMediaAssets({
    tenantId: "tenant-1",
    storeId: "store-1",
    assetIds: ["33333333-3333-4333-8333-333333333333"],
  });
  await repository.listPreflightRuns({
    tenantId: "tenant-1",
    storeId: "store-1",
    skc: "SKC-1",
    limit: 5,
  });
  await repository.createPreflightRun({
    tenantId: "tenant-1",
    storeId: "store-1",
    skcId: "11111111-1111-4111-8111-111111111111",
    skc: "SKC-1",
    draftId: "22222222-2222-4222-8222-222222222222",
    requirementRuleSnapshotId: "44444444-4444-4444-8444-444444444444",
    certificateRuleSnapshotId: null,
    certificateLibrarySnapshotId: "77777777-7777-4777-8777-777777777777",
    agencyLibrarySnapshotId: "88888888-8888-4888-8888-888888888888",
    warningRulesSnapshotId: "99999999-9999-4999-8999-999999999999",
    inputFingerprint: "input-fingerprint",
    ruleFingerprint: "rule-fingerprint",
    mediaFingerprint: "media-fingerprint",
    plan: { status: "compliant", executable: false },
    mediaAssets: [],
    userId: "user-1",
    createdAt: new Date("2026-08-04T02:00:00.000Z"),
  });

  for (const query of queries) {
    assert.match(query.text, /tenant_id\s*=\s*\$1/);
    assert.match(query.text, /store_id\s*=\s*\$2/);
    assert.deepEqual(query.values.slice(0, 2), ["tenant-1", "store-1"]);
  }
  assert.match(queries[2].text, /FROM compliance_preflight_runs/);
  assert.match(queries[2].text, /ORDER BY created_at DESC, id DESC/);
  assert.match(queries[2].text, /LIMIT \$4/);
  assert.deepEqual(queries[2].values, ["tenant-1", "store-1", "SKC-1", 5]);
  assert.match(queries[3].text, /INSERT INTO compliance_preflight_runs/);
  assert.match(queries[0].text, /'certificate_library'/);
  assert.match(queries[0].text, /'agency_library'/);
  assert.match(queries[0].text, /'warning_rules'/);
  assert.match(queries[3].text, /rule_type = 'certificate_library'/);
  assert.match(queries[3].text, /rule_type = 'agency_library'/);
  assert.match(queries[3].text, /rule_type = 'warning_rules'/);
  assert.doesNotMatch(queries[3].text, /ON CONFLICT|UPDATE|DELETE/);
});

test("preflight review repository scopes immutable reads and inserts", async () => {
  const queries = [];
  const repository = new PostgresComplianceWorkspaceRepository({
    pool: {
      async query(input) {
        queries.push(input);
        return { rows: [], rowCount: 0 };
      },
    },
  });

  await repository.listPreflightReviews({
    tenantId: "tenant-1",
    storeId: "store-1",
    skc: "SKC-1",
    preflightRunId: "55555555-5555-4555-8555-555555555555",
  });
  await repository.createPreflightReview({
    tenantId: "tenant-1",
    storeId: "store-1",
    skc: "SKC-1",
    preflightRunId: "55555555-5555-4555-8555-555555555555",
    userId: "66666666-6666-4666-8666-666666666666",
    reviewedAt: new Date("2026-08-04T03:00:00.000Z"),
  });

  for (const query of queries) {
    assert.match(query.text, /tenant_id\s*=\s*\$1/);
    assert.match(query.text, /store_id\s*=\s*\$2/);
    assert.deepEqual(query.values.slice(0, 2), ["tenant-1", "store-1"]);
  }
  assert.match(queries[0].text, /FROM compliance_preflight_reviews/);
  assert.match(queries[1].text, /INSERT INTO compliance_preflight_reviews/);
  assert.match(queries[1].text, /FROM compliance_preflight_runs/);
  assert.match(queries[1].text, /JOIN compliance_drafts current_draft/);
  assert.match(queries[1].text, /current_draft\.id = run\.draft_id/);
  assert.match(queries[1].text, /current_draft\.updated_at <= run\.created_at/);
  assert.match(queries[1].text, /jsonb_array_elements/);
  assert.match(queries[1].text, /current_snapshot\.expires_at > \$6/);
  assert.match(
    queries[1].text,
    /NOT EXISTS[\s\S]*shein_rule_snapshots newer_snapshot/,
  );
  assert.match(queries[1].text, /current_media\.status IN \('ready', 'referenced'\)/);
  assert.match(queries[1].text, /current_media\.purpose = 'compliance_evidence'/);
  assert.match(
    queries[1].text,
    /current_media\.sha256 =\s*audited_media\.value->>'sha256'/,
  );
  assert.match(queries[1].text, /JOIN memberships/);
  assert.match(queries[1].text, /role IN \('owner', 'admin'\)/);
  assert.match(queries[1].text, /NOT EXISTS[\s\S]*compliance_preflight_runs newer/);
  assert.match(queries[1].text, /NOT EXISTS[\s\S]*compliance_preflight_reviews existing_review/);
  assert.doesNotMatch(queries[1].text, /ON CONFLICT|UPDATE|DELETE/);
});
