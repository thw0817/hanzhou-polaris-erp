import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { createV2LocalRealServer } from "./v2-local-real-server.js";

process.env.SHEIN_V2_REAL_DISABLE_PERSISTENCE = "true";

async function invoke(server, { method = "GET", url = "/", body } = {}) {
  const request = Readable.from(body === undefined ? [] : [Buffer.from(body)]);
  Object.assign(request, {
    method,
    url,
    headers: { host: "127.0.0.1", "content-type": "application/json" },
  });
  return new Promise((resolve) => {
    const response = {
      status: null,
      body: "",
      headers: {},
      writeHead(status, headers = {}) {
        this.status = status;
        for (const [name, value] of Object.entries(headers)) {
          this.headers[String(name).toLowerCase()] = value;
        }
      },
      setHeader(name, value) {
        this.headers[String(name).toLowerCase()] = value;
      },
      end(payload = "") {
        this.body = payload;
        const raw = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload));
        let parsed = raw;
        try {
          parsed = JSON.parse(raw.toString() || "{}");
        } catch {}
        resolve({ status: this.status, body: parsed, raw, headers: this.headers });
      },
    };
    server.emit("request", request, response);
  });
}

test("local V2 bridge exposes real business products and compliance targets", async () => {
  const previousFetch = globalThis.fetch;
  let signatureFailure = false;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    const payload = signatureFailure && (url.pathname.endsWith("/data") || url.pathname.endsWith("/sync"))
      ? { message: "签名错误:生成的签名不正确，请检查", code: "openapi00001", traceId: "trace-test" }
      : url.pathname === "/api/shein/stores"
      ? {
          stores: [
            { id: "store-real", supplierId: "SUP-1", label: "真实店铺", businessMode: "全托管", source: "authorization", status: signatureFailure ? "reauthorization_required" : "active" },
            { id: "store-cloud", supplierId: "SUP-2", label: "云端历史店铺", businessMode: "全托管", source: "cloud-authorization" },
          ],
        }
      : url.pathname.endsWith("/store-real")
        ? {
            store: { id: "store-real", supplierId: "SUP-1", label: "圣锐达1店", businessMode: "全托管" },
          }
      : url.pathname.endsWith("/data")
        ? {
            synced: true,
            syncedAt: "2026-08-08T12:00:00.000Z",
            data: {
              productCount: 1,
              products: [{ skc: "SKC-1", spu: "SPU-1", name: "地垫", supplierCode: "SUP-1", state: "已上架" }],
              totals: { today: 3 },
              warnings: [],
            },
          }
        : url.pathname.endsWith("/compliance/sync")
          ? {
              started: true,
              job: {
                id: "compliance-real-1",
                state: "running",
                total: 1,
                processed: 0,
                success: 0,
                failed: 0,
                startedAt: "2026-08-08T12:01:00.000Z",
                updatedAt: "2026-08-08T12:01:00.000Z",
              },
            }
          : url.pathname.endsWith("/compliance/sync/status")
            ? {
                job: {
                  id: "compliance-real-1",
                  state: "completed",
                  total: 1,
                  processed: 1,
                  success: 1,
                  failed: 0,
                  startedAt: "2026-08-08T12:01:00.000Z",
                  updatedAt: "2026-08-08T12:02:00.000Z",
                  completedAt: "2026-08-08T12:02:00.000Z",
                },
              }
            : url.pathname.endsWith("/compliance")
              ? {
                  data: {
                    rows: [{ skc: "SKC-1", state: "待补充", certificate: "待补充", agency: "无需" }],
                    syncedAt: "2026-08-08T12:02:00.000Z",
                  },
                }
              : {};
    return new Response(JSON.stringify(payload), {
      status: signatureFailure && (url.pathname.endsWith("/data") || url.pathname.endsWith("/sync")) ? 502 : 200,
    });
  };
  const bridge = createV2LocalRealServer();

  try {
    const stores = await invoke(bridge, { url: "/v1/web/stores" });
    assert.equal(stores.body.count, 1);
    assert.equal(stores.body.stores[0].environment, "production");

    const workspace = await invoke(bridge, {
      url: "/v1/web/stores/store-real/compliance-workspace",
    });
    assert.equal(workspace.body.pagination.total, 1);
    assert.equal(workspace.body.items[0].skc, "SKC-1");
    assert.equal(workspace.body.items[0].complianceStatus, "待补充");
    assert.deepEqual(workspace.body.complianceSummary, {
      total: 1,
      nonCompliant: 1,
      inProgress: 0,
      passed: 0,
    });

    const filteredDetail = await invoke(bridge, {
      url: "/v1/web/stores/store-real/compliance-workspace/SKC-1?status=%E9%9C%80%E4%BF%AE%E6%AD%A3",
    });
    assert.equal(filteredDetail.status, 200);
    assert.deepEqual(filteredDetail.body.workspaceCapabilities, {
      mode: "local_direct",
      refreshCurrentSkc: true,
      directReportStorage: true,
      photoTemplateApply: true,
      reportTemplateApply: false,
      photoShare: true,
      photoBindingDiagnostic: true,
      photoSubmit: true,
      reportSubmit: false,
    });
    assert.deepEqual(filteredDetail.body.editorModel, {
      certificateRulesFresh: false,
      certificateLibraryFresh: false,
      certificateLibrary: [],
      agencyLibraryRequired: false,
      agencyRequirements: [],
      agencyLibraryFresh: false,
      agencyLibrary: [],
      warningRulesRequired: false,
      warningRulesFresh: false,
      warningRules: [],
      certificates: [],
      detectionAgencies: [],
      platformCapabilities: [],
    });

    const refresh = await invoke(bridge, {
      method: "POST",
      url: "/v1/web/stores/store-real/compliance/refresh",
      body: "{}",
    });
    assert.equal(refresh.body.started, true);
    assert.equal(refresh.body.job.jobType, "compliance_sync");
    assert.equal(refresh.body.job.progress.total, 1);

    const jobs = await invoke(bridge, {
      url: "/v1/web/stores/store-real/sync-jobs?jobType=compliance_sync",
    });
    assert.equal(jobs.body.count, 1);
    assert.equal(jobs.body.jobs[0].state, "succeeded");

    const businessRefresh = await invoke(bridge, {
      method: "POST",
      url: "/v1/web/stores/store-real/business-dashboard",
      body: "{}",
    });
    assert.equal(businessRefresh.status, 200);
    const businessJobs = await invoke(bridge, {
      url: "/v1/web/stores/store-real/sync-jobs?jobType=store_business_refresh",
    });
    const businessDetail = await invoke(bridge, {
      url: `/v1/web/stores/store-real/sync-jobs/${encodeURIComponent(businessJobs.body.jobs[0].id)}`,
    });
    assert.deepEqual(businessDetail.body.job.items, []);

    const renamed = await invoke(bridge, {
      method: "PATCH",
      url: "/v1/web/stores/store-real",
      body: JSON.stringify({ label: "圣锐达1店" }),
    });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.store.label, "圣锐达1店");

    const cloudStore = await invoke(bridge, {
      url: "/v1/web/stores/store-cloud/business-dashboard",
    });
    assert.equal(cloudStore.status, 404);
    assert.equal(cloudStore.body.code, "STORE_NOT_FOUND");

    signatureFailure = true;
    const refreshFailure = await invoke(bridge, {
      method: "POST",
      url: "/v1/web/stores/store-real/business-dashboard",
      body: "{}",
    });
    assert.equal(refreshFailure.status, 401);
    assert.equal(refreshFailure.body.code, "SHEIN_REAUTHORIZATION_REQUIRED");
    assert.match(refreshFailure.body.msg, /重新授权/);
    assert.equal(refreshFailure.body.sourceCode, "openapi00001");
    assert.equal(refreshFailure.body.traceId, "trace-test");

    const storesAfterFailure = await invoke(bridge, { url: "/v1/web/stores" });
    assert.equal(storesAfterFailure.body.stores[0].status, "reauthorization_required");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("local V2 compliance workspace prioritizes actionable and in-progress SKCs", async () => {
  const previousFetch = globalThis.fetch;
  const products = ["PASS", "REVIEW", "FIX", "SUPPLEMENT", "SYNC"].map((skc) => ({
    skc,
    spu: `SPU-${skc}`,
    supplierCode: `SUP-${skc}`,
    state: "已上架",
  }));
  const states = {
    PASS: "通过",
    REVIEW: "审核中",
    FIX: "需修正",
    SUPPLEMENT: "待补充",
    SYNC: "待同步",
  };
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    const payload = url.pathname === "/api/shein/stores"
      ? { stores: [{ id: "store-priority", label: "排序测试店铺", source: "authorization", status: "active" }] }
      : url.pathname.endsWith("/data")
        ? {
            synced: true,
            syncedAt: "2026-08-21T03:00:00.000Z",
            data: { products, totals: {}, warnings: [] },
          }
        : url.pathname.endsWith("/compliance")
          ? {
              data: {
                rows: products.map(({ skc }) => ({ skc, state: states[skc] })),
                syncedAt: "2026-08-21T03:01:00.000Z",
              },
            }
          : {};
    return new Response(JSON.stringify(payload), { status: 200 });
  };
  const bridge = createV2LocalRealServer();

  try {
    const workspace = await invoke(bridge, {
      url: "/v1/web/stores/store-priority/compliance-workspace?pageSize=100",
    });
    assert.deepEqual(
      workspace.body.items.map((item) => item.skc),
      ["FIX", "SUPPLEMENT", "REVIEW", "SYNC", "PASS"],
    );
    assert.deepEqual(workspace.body.complianceSummary, {
      total: 5,
      nonCompliant: 2,
      inProgress: 2,
      passed: 1,
    });

    const passed = await invoke(bridge, {
      url: "/v1/web/stores/store-priority/compliance-workspace?status=%E9%80%9A%E8%BF%87&pageSize=100",
    });
    assert.deepEqual(passed.body.items.map((item) => item.skc), ["PASS"]);
    assert.equal(passed.body.pagination.total, 1);
  } finally {
    bridge.close();
    globalThis.fetch = previousFetch;
  }
});

test("local V2 bridge refreshes truthful detail data for one SKC", async () => {
  const previousFetch = globalThis.fetch;
  const paths = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    paths.push(url.pathname);
    const payload = url.pathname === "/api/shein/stores"
      ? { stores: [{ id: "store-detail", supplierId: "SUP-DETAIL", label: "圣锐达1店" }] }
      : url.pathname === "/api/shein/stores/store-detail"
        ? { store: { id: "store-detail", supplierId: "SUP-DETAIL", label: "圣锐达1店" } }
      : url.pathname === "/api/shein/stores/store-detail/data"
        ? { syncedAt: "2026-08-12T00:00:00.000Z", data: { products: [{
            skc: "SKC-DETAIL", spu: "SPU-DETAIL", categoryId: "3155", supplierCode: "SUP-DETAIL",
          }] } }
      : url.pathname === "/api/shein/stores/store-detail/compliance"
        ? { data: { syncedAt: "2026-08-12T00:00:00.000Z", rows: [{
            skc: "SKC-DETAIL", state: "需修正", certificate: "通过", agency: "无需",
            warning: "无需", platformOnly: "通过", packagePhoto: "通过", bodyPhoto: "失败",
            sourceCoverage: { requirementsReturned: true, photoRequirementsReturned: true },
            certificateRequirements: [{ certificateTypeId: 531, certificateTypeCode: "SmallCarpet", certificateTypeName: "16 CFR 1631 检测报告", isRequired: 1 }],
            agencyRequirements: [], warningRequirements: [], unsupportedRequirements: [],
            bodyPhotoRequirements: [{ labelId: 8, labelGroup: "1", labelName: "商品实拍", isRequired: 1 }],
            packagePhotoRequirements: [],
          }] } }
      : url.pathname === "/api/shein/stores/store-detail/compliance/rules"
        ? { data: {
            skc: "SKC-DETAIL",
            requirements: {
              certificates: [{ certificateTypeId: 531, certificateTypeCode: "SmallCarpet", certificateTypeName: "16 CFR 1631 检测报告", isRequired: 1 }],
              agencies: [], warnings: [],
              bodyPhotos: [{ labelId: 8, labelGroup: "1", labelName: "商品实拍", isRequired: 1 }],
              packagePhotos: [], unsupported: [],
            },
            certificateSchemas: [{ certificateTypeId: 531, certificateType: "16 CFR 1631 检测报告", isEnabled: 1, certificateLabel: 0, presetInfoList: [], otherPresetInfoList: [] }],
            certificates: [], agencies: [], bindableAgencies: [], srmDetectionAgencyList: [], warningRules: [],
            sourceCoverage: { certificateSchemas: true, certificateLibrary: true, agencies: true, warningRules: true },
            diagnostics: [{ endpoint: "/open-api/goods-certificate-schemas/detail", traceId: "rules-trace" }],
            errors: [], fetchedAt: "2026-08-12T00:01:00.000Z",
          } }
      : url.pathname === "/api/shein/stores/store-detail/products/identify"
        ? { product: { skc: "SKC-DETAIL", spu: "SPU-DETAIL" }, detail: {
            categoryId: "3155", productTypeId: "991", spuName: "SPU-DETAIL",
            productAttributeInfoList: [
              { attributeId: "101", attributeValue: "否" },
              { attributeId: "102", attributeValue: "否" },
            ],
          }, diagnostics: { detail: { traceId: "attribute-trace" } } }
      : url.pathname === "/api/shein/stores/store-detail/template/attributes"
        ? { info: { data: [{ product_type_id: "991", attribute_infos: [
            { attribute_id: "101", attribute_name: "是否最长边大于1.8m", attribute_status: 2, attribute_type: 3, attribute_mode: 0, data_dimension: 1, attribute_value_info_list: [{ attribute_value_id: "否", attribute_value: "否" }, { attribute_value_id: "是", attribute_value: "是" }] },
            { attribute_id: "102", attribute_name: "是否面积大于2.16m²", attribute_status: 2, attribute_type: 3, attribute_mode: 0, data_dimension: 1, attribute_value_info_list: [{ attribute_value_id: "否", attribute_value: "否" }, { attribute_value_id: "是", attribute_value: "是" }] },
          ] }] }, diagnostics: { traceId: "schema-trace" } }
      : url.pathname === "/api/attribute-templates"
        ? { templates: [] }
      : {};
    return new Response(JSON.stringify(payload), { status: 200 });
  };
  const bridge = createV2LocalRealServer();
  try {
    const initial = await invoke(bridge, {
      url: "/v1/web/stores/store-detail/compliance-workspace/SKC-DETAIL",
    });
    assert.equal(initial.status, 200);
    assert.deepEqual(initial.body.records, []);
    assert.deepEqual(initial.body.snapshots, []);

    const refreshed = await invoke(bridge, {
      method: "POST",
      url: "/v1/web/stores/store-detail/compliance-workspace/SKC-DETAIL/rules/refresh",
      body: "{}",
    });
    assert.equal(refreshed.status, 200);
    assert.equal(refreshed.body.detail.records.length, 2);
    assert.deepEqual(refreshed.body.detail.snapshots.map((item) => item.ruleType), [
      "compliance_requirement", "certificate_schema", "certificate_library", "agency_library", "warning_rules",
    ]);
    assert.equal(refreshed.body.detail.item.attributeSnapshot.fieldCount, 2);
    assert.equal(refreshed.body.detail.item.attributeSnapshot.assignedFieldCount, 2);
    assert.equal(refreshed.body.detail.item.reportDecision.reportType, "1631");
    assert.deepEqual(refreshed.body.detail.item.reportDecision.blockers, []);
    assert.equal(refreshed.body.detail.editorModel.certificates[0].supported, true);
    assert.match(paths.join("\n"), /compliance\/rules/);
    assert.match(paths.join("\n"), /products\/identify/);
    assert.match(paths.join("\n"), /template\/attributes/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("local V2 rule refresh preserves upstream IP whitelist errors", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const path = new URL(String(input)).pathname;
    const payload = path === "/api/shein/stores"
      ? { stores: [{ id: "store-ip", supplierId: "SUP-IP", label: "IP测试店" }] }
      : path === "/api/shein/stores/store-ip"
        ? { store: { id: "store-ip", supplierId: "SUP-IP", label: "IP测试店" } }
      : path === "/api/shein/stores/store-ip/data"
        ? { data: { products: [{ skc: "SKC-IP", spu: "SPU-IP" }] } }
      : path === "/api/shein/stores/store-ip/compliance"
        ? { data: { syncedAt: "2026-08-12T00:00:00.000Z", rows: [{ skc: "SKC-IP" }] } }
      : path === "/api/shein/stores/store-ip/compliance/rules"
        ? { code: "SYSTEM_ERROR", msg: "IP is not in the whitelist: 27.45.212.46", traceId: "ip-trace" }
      : {};
    return new Response(JSON.stringify(payload), { status: path.endsWith("/compliance/rules") ? 403 : 200 });
  };
  const bridge = createV2LocalRealServer();
  try {
    const result = await invoke(bridge, {
      method: "POST",
      url: "/v1/web/stores/store-ip/compliance-workspace/SKC-IP/rules/refresh",
      body: "{}",
    });
    assert.equal(result.status, 403);
    assert.equal(result.body.code, "SHEIN_IP_NOT_ALLOWED");
    assert.equal(result.body.traceId, "ip-trace");
    assert.match(result.body.msg, /白名单/);
    assert.match(result.body.msg, /27\.45\.212\.46/);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("local V2 compliance workspace stores drafts, media and template references locally", async () => {
  const previousFetch = globalThis.fetch;
  let templateAssetId = "";
  let photoUploadCalls = 0;
  const photoBindBodies = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const payload = url.pathname === "/api/shein/stores"
      ? { stores: [{ id: "store-local-edit-regression", supplierId: "SUP-EDIT", label: "本地编辑店" }] }
      : url.pathname === "/api/shein/stores/store-local-edit-regression"
        ? { store: { id: "store-local-edit-regression", supplierId: "SUP-EDIT", label: "本地编辑店" } }
      : url.pathname === "/api/shein/stores/store-local-edit-regression/data"
        ? { data: { products: [{ skc: "SKC-EDIT", spu: "SPU-EDIT" }, { skc: "SKC-EDIT-2", spu: "SPU-EDIT-2" }] } }
      : url.pathname === "/api/shein/stores/store-local-edit-regression/compliance"
        ? { data: { rows: [{ skc: "SKC-EDIT", state: "需修正", packagePhoto: "失败", bodyPhoto: "通过" }] } }
      : url.pathname === "/api/shein/stores/store-local-edit-regression/compliance/rules"
        ? { data: { skc: "SKC-EDIT", requirements: { certificates: [], agencies: [], warnings: [], bodyPhotos: [], packagePhotos: [], unsupported: [] }, sourceCoverage: { certificateSchemas: true, certificateLibrary: true, agencies: true, warningRules: true }, certificateSchemas: [], certificates: [], agencies: [], bindableAgencies: [], srmDetectionAgencyList: [], warningRules: [], fetchedAt: "2026-08-12T00:00:00.000Z" } }
      : url.pathname === "/api/shein/stores/store-local-edit-regression/products/identify"
        ? { detail: { productTypeId: "991", productAttributeInfoList: [] } }
      : url.pathname === "/api/shein/stores/store-local-edit-regression/template/attributes"
        ? { info: { data: [] } }
      : url.pathname === "/api/templates"
        ? { templates: [{ id: "template-1", storeId: "store-local-edit", templateType: "compliance", name: "地垫实拍模板", data: { defaults: { certificates: [], agencies: [], warnings: [], photos: [
          { labelId: "package-inner", labelGroup: "2", localAssetRef: templateAssetId ? `media:${templateAssetId}` : "media:template-inner", fileName: "inner.jpg", mimeType: "image/jpeg", size: 12 },
          { labelId: "package-outer", labelGroup: "2", localAssetRef: templateAssetId ? `media:${templateAssetId}` : "media:template-outer", fileName: "outer.jpg", mimeType: "image/jpeg", size: 12 },
        ] } } }] }
      : url.pathname === "/api/local/shein/stores/store-local-edit-regression/upload-compliance-photo"
        ? (() => {
            photoUploadCalls += 1;
            return { ok: true, info: { imageUrl: "https://image.example/package.jpg", imageMd5: "package-md5" }, diagnostics: { traceId: "upload-trace" } };
          })()
      : url.pathname === "/api/shein/stores/store-local-edit-regression/compliance/photos/bind"
        ? (() => {
            const requestBody = JSON.parse(String(init.body || "{}"));
            photoBindBodies.push(requestBody);
            return requestBody.execute === true
              ? { ok: true, externalWrite: true, info: { totalCount: 1, successCount: 1, faildCount: 0, faildList: [] }, traceId: "bind-trace" }
              : { ok: true, mode: "dry-run", confirmationToken: "photo-confirmation-token", payload: requestBody.payload };
          })()
      : url.pathname === "/api/shein/stores/store-local-edit-regression/compliance/sync"
        ? { started: true, job: { id: "sync-after-photo", state: "running" } }
      : {};
    return new Response(JSON.stringify(payload), { status: 200 });
  };
  const bridge = createV2LocalRealServer();
  try {
    const emptyDraft = await invoke(bridge, {
      url: "/v1/web/stores/store-local-edit-regression/compliance/drafts/SKC-EDIT",
    });
    assert.equal(emptyDraft.status, 200);
    assert.equal(emptyDraft.body.draft, null);

    const ticket = await invoke(bridge, {
      method: "POST",
      url: "/v1/web/stores/store-local-edit-regression/media/upload-ticket",
      body: JSON.stringify({ originalName: "rug.jpg", contentType: "image/jpeg", sizeBytes: 12, purpose: "compliance_evidence" }),
    });
    assert.equal(ticket.status, 200);
    assert.equal(ticket.body.asset.status, "pending_upload");

    const uploaded = await invoke(bridge, {
      method: "PUT",
      url: `/v1/web/stores/store-local-edit-regression/media/${ticket.body.asset.id}/content`,
      body: "local-image-bytes",
    });
    assert.equal(uploaded.status, 200);

    const completed = await invoke(bridge, {
      method: "POST",
      url: `/v1/web/stores/store-local-edit-regression/media/${ticket.body.asset.id}/complete`,
      body: JSON.stringify({ width: 100, height: 100 }),
    });
    assert.equal(completed.status, 200);
    assert.equal(completed.body.asset.status, "ready");
    templateAssetId = ticket.body.asset.id;

    const preview = await invoke(bridge, {
      url: `/v1/web/stores/store-local-edit-regression/media/${ticket.body.asset.id}/content`,
    });
    assert.equal(preview.status, 200);
    assert.equal(preview.headers["content-type"], "image/jpeg");
    assert.equal(preview.raw.toString(), "local-image-bytes");

    const saved = await invoke(bridge, {
      method: "PUT",
      url: "/v1/web/stores/store-local-edit-regression/compliance/drafts/SKC-EDIT",
      body: JSON.stringify({ expectedUpdatedAt: null, requirementSnapshot: { fetchedAt: "2026-08-12" }, inputs: { certificates: [], agencies: [], warnings: [], photos: [
        { labelId: "package-1", labelGroup: "2", localAssetRef: `media:${ticket.body.asset.id}`, fileName: "package-1.jpg", mimeType: "image/jpeg", size: 12 },
      ], platformPhotoActions: [
        { photoSlot: "product", action: "replace_requested", replacementMediaRef: `media:${ticket.body.asset.id}`, replacementFileName: "body-new.jpg" },
        { photoSlot: "outer_package", action: "delete_requested" },
      ] }, preflight: {}, status: "draft" }),
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.draft.inputs.photos.length, 1);
    assert.deepEqual(saved.body.draft.inputs.platformPhotoActions, [
      { photoSlot: "product", action: "replace_requested", replacementMediaRef: `media:${ticket.body.asset.id}`, replacementFileName: "body-new.jpg" },
      { photoSlot: "outer_package", action: "delete_requested" },
    ]);

    const detail = await invoke(bridge, {
      url: "/v1/web/stores/store-local-edit-regression/compliance-workspace/SKC-EDIT",
    });
    assert.equal(detail.status, 200);
    const detailRules = await invoke(bridge, {
      method: "POST",
      url: "/v1/web/stores/store-local-edit-regression/compliance-workspace/SKC-EDIT/rules/refresh",
      body: "{}",
    });
    assert.equal(detailRules.status, 200);

    const bindCheck = await invoke(bridge, {
      method: "POST",
      url: "/v1/web/stores/store-local-edit-regression/compliance-workspace/SKC-EDIT/photos/bind-contract-check",
      body: JSON.stringify({ photos: saved.body.draft.inputs.photos }),
    });
    assert.equal(bindCheck.status, 200);
    assert.equal(bindCheck.body.externalWrite, false);
    assert.equal(bindCheck.body.requestPath, "/open-api/goods-compliance/skc-save-label");
    assert.equal(bindCheck.body.status, "candidate_only");
    assert.deepEqual(bindCheck.body.checks.map((check) => check.officialGroup), ["product", "package"]);
    assert.equal(bindCheck.body.checks.length, 2);
    assert.equal(bindCheck.body.checks[0].localPhotoCount, 0);
    assert.equal(bindCheck.body.checks[1].localPhotoCount, 1);
    assert.ok(bindCheck.body.missingOfficialFields.some((field) => field.includes("覆盖/删除")));
    assert.equal(bindCheck.body.missingOfficialFields.some((field) => field.includes("skc-save-label")), false);

    const submitted = await invoke(bridge, {
      method: "POST",
      url: "/v1/web/stores/store-local-edit-regression/compliance-workspace/SKC-EDIT/photos/submit",
      body: JSON.stringify({ confirmation: "提交当前SKC实拍图" }),
    });
    assert.equal(submitted.status, 200);
    assert.equal(submitted.body.externalWrite, true);
    assert.equal(submitted.body.info.successCount, 1);
    assert.equal(photoUploadCalls, 1);
    assert.equal(photoBindBodies.length, 2);
    assert.deepEqual(photoBindBodies[0].payload, {
      skcList: ["SKC-EDIT"],
      packageLableList: [
        { imageUrl: "https://image.example/package.jpg", imageMd5: "package-md5" },
      ],
    });
    assert.equal(photoBindBodies[1].execute, true);
    assert.equal(photoBindBodies[1].confirmationToken, "photo-confirmation-token");

    const detailAfterPhotoSubmit = await invoke(bridge, {
      url: "/v1/web/stores/store-local-edit-regression/compliance-workspace/SKC-EDIT",
    });
    assert.equal(detailAfterPhotoSubmit.status, 200);
    assert.equal(detailAfterPhotoSubmit.body.snapshots.length, 0);

    const directReport = await invoke(bridge, {
      method: "PUT",
      url: "/v1/web/stores/store-local-edit-regression/compliance/reports/SKC-EDIT",
      body: JSON.stringify({ assignment: {
        certificateTypeId: 531,
        certificateTypeCode: "SmallCarpet",
        certificateTypeName: "16 CFR 1631 检测报告",
        certificateDimension: "SmallCarpet",
        skc: "SKC-EDIT",
        files: [{ localAssetRef: `media:${ticket.body.asset.id}`, fileName: "1631.pdf", mimeType: "application/pdf", size: 12 }],
        fieldValues: {},
      } }),
    });
    assert.equal(directReport.status, 200);
    assert.equal(directReport.body.report.assignment.skc, "SKC-EDIT");

    const shared = await invoke(bridge, {
      method: "POST",
      url: "/v1/web/stores/store-local-edit-regression/compliance-workspace/SKC-EDIT/photos/share",
      body: JSON.stringify({ targetSkcs: ["SKC-EDIT-2"], photos: saved.body.draft.inputs.photos }),
    });
    assert.equal(shared.status, 200);
    assert.equal(shared.body.externalWrite, false);
    const sharedDraft = await invoke(bridge, {
      url: "/v1/web/stores/store-local-edit-regression/compliance/drafts/SKC-EDIT-2",
    });
    assert.equal(sharedDraft.body.draft.inputs.photos.length, 1);
    assert.deepEqual(sharedDraft.body.draft.inputs.photos.map((photo) => photo.labelGroup), ["2"]);

    const readBack = await invoke(bridge, {
      url: "/v1/web/stores/store-local-edit-regression/compliance/drafts/SKC-EDIT",
    });
    assert.equal(readBack.body.draft.id, saved.body.draft.id);

    const templates = await invoke(bridge, {
      url: "/v1/web/stores/store-local-edit-regression/publish-templates?type=compliance",
    });
    assert.equal(templates.body.templates[0].id, "template-1");

    const appliedPhotoTemplate = await invoke(bridge, {
      method: "POST",
      url: "/v1/web/stores/store-local-edit-regression/compliance/photo-templates/template-1/apply",
      body: JSON.stringify({ skc: "SKC-EDIT" }),
    });
    assert.equal(appliedPhotoTemplate.status, 200);
    assert.equal(appliedPhotoTemplate.body.externalWrite, false);
    assert.deepEqual(appliedPhotoTemplate.body.photos.map((photo) => photo.labelGroup), ["2", "2"]);
    assert.deepEqual(appliedPhotoTemplate.body.photos.map((photo) => photo.photoSlot), [undefined, undefined]);
    const photoTemplateDraft = await invoke(bridge, {
      url: "/v1/web/stores/store-local-edit-regression/compliance/drafts/SKC-EDIT",
    });
    assert.deepEqual(photoTemplateDraft.body.draft.inputs.photos.map((photo) => photo.labelGroup), ["2", "2"]);

    const applied = await invoke(bridge, {
      method: "POST",
      url: "/v1/web/stores/store-local-edit-regression/compliance/templates/template-1/apply",
      body: JSON.stringify({ skcNames: ["SKC-EDIT"] }),
    });
    assert.equal(applied.status, 200);
    assert.equal(applied.body.summary.saved, 1);
    assert.equal(applied.body.items[0].draft.templateId, "template-1");

    const refreshed = await invoke(bridge, {
      method: "POST",
      url: "/v1/web/stores/store-local-edit-regression/compliance-workspace/SKC-EDIT/rules/refresh",
      body: "{}",
    });
    assert.equal(refreshed.status, 200);

    const preflight = await invoke(bridge, {
      method: "POST",
      url: "/v1/web/stores/store-local-edit-regression/compliance-workspace/SKC-EDIT/preflight",
      body: "{}",
    });
    assert.equal(preflight.status, 200);
    assert.equal(preflight.body.preflight.publishingEnabled, false);
    const detailAfterPreflight = await invoke(bridge, {
      url: "/v1/web/stores/store-local-edit-regression/compliance-workspace/SKC-EDIT",
    });
    assert.equal(detailAfterPreflight.body.latestPreflight.status, "blocked");

    const latestDraftBeforeClear = await invoke(bridge, {
      url: "/v1/web/stores/store-local-edit-regression/compliance/drafts/SKC-EDIT",
    });
    const cleared = await invoke(bridge, {
      method: "PUT",
      url: "/v1/web/stores/store-local-edit-regression/compliance/drafts/SKC-EDIT",
      body: JSON.stringify({
        expectedUpdatedAt: latestDraftBeforeClear.body.draft.updatedAt,
        requirementSnapshot: {},
        inputs: { certificates: [], agencies: [], warnings: [], photos: [] },
        preflight: {},
        status: "draft",
      }),
    });
    assert.equal(cleared.status, 200);
    const missingRequiredGroup = await invoke(bridge, {
      method: "POST",
      url: "/v1/web/stores/store-local-edit-regression/compliance-workspace/SKC-EDIT/photos/submit",
      body: JSON.stringify({ confirmation: "提交当前SKC实拍图" }),
    });
    assert.equal(missingRequiredGroup.status, 422);
    assert.equal(missingRequiredGroup.body.code, "PHOTO_REQUIRED_GROUP_MISSING");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("local V2 rule refresh accepts the legacy single-SKC compliance response", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const path = new URL(String(input)).pathname;
    const payload = path === "/api/shein/stores"
      ? { stores: [{ id: "store-single-row", supplierId: "SUP-ROW" }] }
      : path === "/api/shein/stores/store-single-row/data"
        ? { data: { products: [{ skc: "SKC-ROW" }] } }
      : path === "/api/shein/stores/store-single-row/compliance"
        ? { data: { skc: "SKC-ROW", state: "需修正", bodyPhoto: "失败", sourceCoverage: { requirementsReturned: true, photoRequirementsReturned: true }, certificateRequirements: [], agencyRequirements: [], warningRequirements: [], packagePhotoRequirements: [], bodyPhotoRequirements: [] } }
      : path === "/api/shein/stores/store-single-row/compliance/rules"
        ? { data: { skc: "SKC-ROW", requirements: { certificates: [], agencies: [], warnings: [], bodyPhotos: [], packagePhotos: [], unsupported: [] }, sourceCoverage: { certificateSchemas: true, certificateLibrary: true, agencies: true, warningRules: true }, certificateSchemas: [], certificates: [], agencies: [], bindableAgencies: [], srmDetectionAgencyList: [], warningRules: [], fetchedAt: "2026-08-12T00:00:00.000Z" } }
      : {};
    return new Response(JSON.stringify(payload), { status: 200 });
  };
  try {
    const result = await invoke(createV2LocalRealServer(), {
      method: "POST",
      url: "/v1/web/stores/store-single-row/compliance-workspace/SKC-ROW/rules/refresh",
      body: "{}",
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.detail.item.skc, "SKC-ROW");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("photo submission does not invent a body-photo requirement when SHEIN returns no photo group", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    const payload = url.pathname === "/api/shein/stores"
      ? { stores: [{ id: "store-optional-photo", source: "authorization" }] }
      : url.pathname === "/api/shein/stores/store-optional-photo/data"
      ? { data: { products: [{ skc: "SKC-OPTIONAL-PHOTO", name: "无需实拍图商品" }] } }
      : url.pathname === "/api/shein/stores/store-optional-photo/compliance"
        ? { data: { rows: [{ skc: "SKC-OPTIONAL-PHOTO", state: "通过", sourceCoverage: { requirementsReturned: true, photoRequirementsReturned: true } }] } }
        : url.pathname === "/api/shein/stores/store-optional-photo/compliance/rules"
          ? { data: { skc: "SKC-OPTIONAL-PHOTO", requirements: { certificates: [], agencies: [], warnings: [], bodyPhotos: [], packagePhotos: [], unsupported: [] }, sourceCoverage: { certificateSchemas: true, certificateLibrary: true, agencies: true, warningRules: true }, certificateSchemas: [], certificates: [], agencies: [], bindableAgencies: [], srmDetectionAgencyList: [], warningRules: [], fetchedAt: "2026-08-21T00:00:00.000Z" } }
          : url.pathname === "/api/shein/stores/store-optional-photo/products/identify"
            ? { detail: {} }
            : {};
    return new Response(JSON.stringify(payload), { status: 200 });
  };
  const bridge = createV2LocalRealServer();
  try {
    const refreshed = await invoke(bridge, {
      method: "POST",
      url: "/v1/web/stores/store-optional-photo/compliance-workspace/SKC-OPTIONAL-PHOTO/rules/refresh",
      body: "{}",
    });
    assert.equal(refreshed.status, 200);

    const saved = await invoke(bridge, {
      method: "PUT",
      url: "/v1/web/stores/store-optional-photo/compliance/drafts/SKC-OPTIONAL-PHOTO",
      body: JSON.stringify({ expectedUpdatedAt: null, requirementSnapshot: { fetchedAt: "2026-08-21T00:00:00.000Z" }, inputs: { certificates: [], agencies: [], warnings: [], photos: [] }, preflight: {}, status: "draft" }),
    });
    assert.equal(saved.status, 200);

    const submitted = await invoke(bridge, {
      method: "POST",
      url: "/v1/web/stores/store-optional-photo/compliance-workspace/SKC-OPTIONAL-PHOTO/photos/submit",
      body: JSON.stringify({ confirmation: "提交当前SKC实拍图" }),
    });
    assert.equal(submitted.status, 409);
    assert.equal(submitted.body.code, "PHOTO_NO_FAILED_GROUP");
  } finally {
    globalThis.fetch = previousFetch;
  }
});
