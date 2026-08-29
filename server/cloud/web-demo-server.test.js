import assert from "node:assert/strict";
import test from "node:test";
import {
  acceptDemoMemberInvitation,
  applyDemoBatchAction,
  createDemoMemberInvitation,
  getDemoCorsOrigin,
  getDemoMemberInvitation,
  getDemoPublishCategories,
  getDemoPublishSchema,
  getDemoPublishSchemaCoverage,
  getDemoSyncJob,
  isDemoDraftBatchEligible,
  listDemoSyncJobs,
  normalizeDemoPublishTemplateData,
  normalizeDemoStoreLabel,
  readDemoBusinessDashboard,
  retryDemoRuleRefresh,
  startDemoBusinessRefresh,
  startDemoComplianceSync,
  startDemoRuleRefresh,
  updateDemoManagedMember,
  updateDemoMemberStoreAccess,
} from "./web-demo-server.js";

test("normalizes demo rug report templates to the production compliance contract", () => {
  const reportFile = {
    localAssetRef: "media:report-1631",
    fileName: "1631-report.pdf",
    mimeType: "application/pdf",
    size: 470437,
  };

  assert.deepEqual(
    normalizeDemoPublishTemplateData("compliance", {
      templateKind: "rug_report",
      reportType: "1631",
      reportDate: "2026-06-23",
      reportFile,
    }),
    {
      templateKind: "rug_report",
      reportType: "1631",
      reportDate: "2026-06-23",
      reportFile,
      requirements: [],
      defaults: {
        certificates: [{
          certificateTypeId: null,
          certificateTypeCode: "RugReport1631",
          certificateTypeName: "16 CFR 1631 检测报告",
          certificateDimension: null,
          poolSn: "",
          status: null,
          files: [reportFile],
          fieldValues: {},
        }],
        agencies: [],
        warnings: [],
        photos: [],
      },
      storeScoped: true,
      revalidateOnUse: true,
    },
  );
});

test("demo publish settings templates never retain scheduled dates", () => {
  assert.deepEqual(
    normalizeDemoPublishTemplateData("publish_settings", {
      mallState: "1",
      stopPurchase: "1",
      shelfRequire: "0",
      shelfWay: "2",
      hopeOnSaleDate: "2026-09-01T10:00",
    }),
    {
      mallState: "1",
      stopPurchase: "1",
      shelfRequire: "0",
      shelfWay: "1",
    },
  );
});

function demoBatch(overrides = {}) {
  return {
    id: "batch-1",
    state: "queued",
    preflight: {},
    lastError: "",
    updatedAt: "2026-07-31T00:00:00.000Z",
    items: [
      {
        id: "item-1",
        draftId: "draft-1",
        state: "queued",
        attemptCount: 0,
        preflight: {},
        lastError: "",
      },
    ],
    ...overrides,
  };
}

const readyDraft = {
  id: "draft-1",
  data: {
    supplierSku: "RUG-40X60",
    sizeRows: [
      { supplierSku: "RUG-40X60" },
      { supplierSku: "RUG-50X80" },
    ],
  },
};

function officialSchemaRecords() {
  return [
    {
      storeId: "official-store",
      kind: "categories",
      key: "default",
      cachedAt: "2026-07-29T13:33:10.294Z",
      value: {
        info: {
          data: [{
            category_id: 3978,
            product_type_id: 0,
            category_name: "家用纺织品",
            last_category: false,
            children: [{
              category_id: 3152,
              product_type_id: 0,
              category_name: "地毯和地垫",
              last_category: false,
              children: [
                {
                  category_id: 1954,
                  product_type_id: 209,
                  category_name: "门垫",
                  last_category: true,
                  children: [],
                },
                {
                  category_id: 3155,
                  product_type_id: 991,
                  category_name: "装饰地毯",
                  last_category: true,
                  children: [],
                },
              ],
            }],
          }],
        },
      },
    },
    {
      storeId: "official-store",
      kind: "attributes",
      key: "991",
      cachedAt: "2026-07-29T12:57:00.399Z",
      value: {
        data: [{
          product_type_id: 991,
          attribute_infos: [
            {
              attribute_id: 27,
              attribute_name: "颜色",
              attribute_status: 3,
              attribute_type: 1,
              data_dimension: 1,
              attribute_is_show: 1,
            },
            {
              attribute_id: 1000627,
              attribute_name: "细化图案",
              attribute_status: 3,
              attribute_type: 4,
              data_dimension: 1,
              attribute_is_show: 1,
            },
            {
              attribute_id: 1000067,
              attribute_name: "填充物",
              attribute_status: 3,
              attribute_type: 3,
              data_dimension: 2,
              attribute_is_show: 1,
            },
            {
              attribute_id: 160,
              attribute_name: "材质",
              attribute_status: 3,
              attribute_type: 4,
              data_dimension: 2,
              attribute_is_show: 1,
            },
            {
              attribute_id: 900,
              attribute_name: "SKU 成分",
              attribute_status: 2,
              attribute_type: 3,
              data_dimension: 3,
              attribute_is_show: 1,
            },
          ],
        }],
      },
    },
    {
      storeId: "official-store",
      kind: "publish-standard",
      key: "3155",
      cachedAt: "2026-07-29T12:57:00.338Z",
      value: {
        default_language: "zh-cn",
        currency: "CNY",
      },
    },
  ];
}

test("demo API allows loopback web origins without hard-coding a Vite port", () => {
  assert.equal(
    getDemoCorsOrigin("http://127.0.0.1:5175"),
    "http://127.0.0.1:5175",
  );
  assert.equal(
    getDemoCorsOrigin("http://localhost:4173"),
    "http://localhost:4173",
  );
  assert.equal(getDemoCorsOrigin("https://example.com"), "");
});

test("demo store rename matches the production label contract", () => {
  assert.equal(normalizeDemoStoreLabel("  地毯   主店  "), "地毯 主店");
  assert.throws(() => normalizeDemoStoreLabel("   "), /1至40个字符/);
  assert.throws(() => normalizeDemoStoreLabel("店".repeat(41)), /1至40个字符/);
});

test("demo publish categories preserve the SHEIN rug category hierarchy", () => {
  const categories = getDemoPublishCategories({
    records: officialSchemaRecords(),
  });
  const homeTextiles = categories.info.data[0];
  const rugCategory = homeTextiles.children.find(
    (item) => item.category_name === "地毯和地垫",
  );
  const rugLeaves = rugCategory.children;

  assert.equal(homeTextiles.category_name, "家用纺织品");
  assert.deepEqual(
    rugLeaves.map((item) => ({
      categoryId: item.category_id,
      productTypeId: item.product_type_id,
      name: item.category_name,
    })),
    [
      { categoryId: 1954, productTypeId: 209, name: "门垫" },
      { categoryId: 3155, productTypeId: 991, name: "装饰地毯" },
    ],
  );
  assert.ok(rugLeaves.every((item) => item.last_category));
});

test("demo publish schema follows the selected official leaf category", () => {
  const records = officialSchemaRecords();
  const schema = getDemoPublishSchema({
    categoryId: "3155",
    productTypeId: "991",
    records,
  });
  const productAttributes = schema.attributes.data[0].attribute_infos.filter(
    (item) =>
      [3, 4].includes(Number(item.attribute_type)) &&
      Number(item.data_dimension) !== 3 &&
      item.attribute_status !== 1 &&
      item.attribute_is_show !== 0,
  );

  assert.deepEqual(
    productAttributes.map((item) => item.attribute_name),
    ["细化图案", "填充物", "材质"],
  );
  assert.equal(schema.publishStandard.default_language, "zh-cn");
  assert.throws(
    () => getDemoPublishSchema({
      categoryId: "1954",
      productTypeId: "991",
      records,
    }),
    /类目与产品类型不匹配/,
  );
});

test("demo schema coverage includes every cached and uncached leaf category", () => {
  const coverage = getDemoPublishSchemaCoverage({
    records: officialSchemaRecords(),
  });
  assert.equal(coverage.summary.total, 2);
  assert.equal(coverage.summary.ready, 1);
  assert.deepEqual(
    coverage.categories.map((item) => ({
      categoryId: item.categoryId,
      productTypeId: item.productTypeId,
      ready: item.ready,
    })),
    [
      { categoryId: "1954", productTypeId: "209", ready: false },
      { categoryId: "3155", productTypeId: "991", ready: true },
    ],
  );
});

test("demo member access rejects administrators and unknown stores", () => {
  const members = [
    { id: "owner-1", role: "owner", storeIds: [] },
    { id: "member-1", role: "operator", storeIds: [] },
  ];
  const updated = updateDemoMemberStoreAccess(
    members,
    "member-1",
    ["store-1", "store-1"],
    ["store-1"],
  );

  assert.deepEqual(updated.storeIds, ["store-1"]);
  assert.throws(
    () => updateDemoMemberStoreAccess(members, "owner-1", [], ["store-1"]),
    /默认拥有全部店铺/,
  );
  assert.throws(
    () => updateDemoMemberStoreAccess(members, "member-1", ["store-2"], ["store-1"]),
    /部分店铺不存在/,
  );
});

test("demo managed members change only ordinary roles and status", () => {
  const members = [
    { id: "owner-1", role: "owner", status: "active", storeIds: [] },
    { id: "member-1", role: "operator", status: "active", storeIds: [] },
  ];
  const updated = updateDemoManagedMember(members, "member-1", {
    role: "viewer",
    status: "disabled",
  });

  assert.equal(updated.role, "viewer");
  assert.equal(updated.status, "disabled");
  assert.throws(
    () => updateDemoManagedMember(members, "owner-1", { status: "disabled" }),
    /不能在此修改/,
  );
  assert.throws(
    () => updateDemoManagedMember(members, "member-1", { role: "admin" }),
    /角色无效/,
  );
});

test("demo member invitation creates a one-time 24-hour link", () => {
  const invitations = [];
  const members = [];
  const currentTime = new Date("2026-08-03T10:00:00.000Z");
  const result = createDemoMemberInvitation(
    invitations,
    members,
    {
      email: "new@example.com",
      displayName: "新成员",
      role: "operator",
      storeIds: ["store-1"],
    },
    ["store-1"],
    {
      now: () => currentTime,
      randomBytes: (size) => Buffer.alloc(size, 7),
      randomUUID: () => "invitation-1",
    },
  );

  assert.match(result.token, /^swi_[A-Za-z0-9_-]{43}$/);
  assert.equal(result.invitation.expiresAt, "2026-08-04T10:00:00.000Z");
  assert.equal(
    getDemoMemberInvitation(invitations, result.token, currentTime).invitation.storeCount,
    1,
  );
});

test("demo invitation acceptance creates one member then fails closed", () => {
  const invitations = [];
  const members = [];
  const currentTime = new Date("2026-08-03T10:00:00.000Z");
  const created = createDemoMemberInvitation(
    invitations,
    members,
    {
      email: "viewer@example.com",
      displayName: "查看成员",
      role: "viewer",
      storeIds: ["store-1"],
    },
    ["store-1"],
    {
      now: () => currentTime,
      randomBytes: (size) => Buffer.alloc(size, 8),
      randomUUID: () => "invitation-1",
    },
  );
  const accepted = acceptDemoMemberInvitation(
    invitations,
    members,
    created.token,
    "StrongPassword!2026",
    ["store-1"],
    {
      now: () => currentTime,
      randomUUID: () => "member-1",
    },
  );

  assert.equal(accepted.user.role, "viewer");
  assert.equal(members.length, 1);
  assert.deepEqual(members[0].storeIds, ["store-1"]);
  assert.throws(
    () => getDemoMemberInvitation(invitations, created.token, currentTime),
    /已失效或已被使用/,
  );
});

test("demo business refresh reuses one job and completes through polling", () => {
  const state = { job: null, jobs: [], snapshot: null };
  const startedAt = new Date("2026-08-04T00:00:00.000Z");
  const first = startDemoBusinessRefresh(state, {
    now: () => startedAt,
    randomUUID: () => "job-1",
  });
  const duplicate = startDemoBusinessRefresh(state, {
    now: () => startedAt,
    randomUUID: () => "job-2",
  });

  assert.equal(first.started, true);
  assert.equal(duplicate.started, false);
  assert.equal(duplicate.job.id, "job-1");
  assert.equal(
    readDemoBusinessDashboard(state, { now: () => startedAt }).state,
    "refreshing",
  );
  const completed = readDemoBusinessDashboard(state, {
    now: () => new Date("2026-08-04T00:00:01.000Z"),
  });
  assert.equal(completed.state, "ready");
  assert.equal(completed.refreshJob, null);
  assert.equal(completed.snapshot.productCount, 0);
  assert.equal(listDemoSyncJobs(state).jobs[0].state, "succeeded");
  assert.deepEqual(getDemoSyncJob(state, "job-1").job.items, []);
});

test("demo rule refresh creates only a task summary without fake rule payloads", () => {
  const state = { job: null, jobs: [], snapshot: null };
  const result = startDemoRuleRefresh(state, {
    now: () => new Date("2026-08-04T00:00:00.000Z"),
    randomUUID: () => "rule-job-1",
  });

  assert.equal(result.started, true);
  assert.equal(result.job.jobType, "rule_refresh");
  assert.equal(result.job.state, "succeeded");
  assert.deepEqual(result.job.progress, {
    total: 1,
    processed: 1,
    succeeded: 1,
    failed: 0,
  });
  assert.equal("rules" in result, false);
  assert.equal(listDemoSyncJobs(state, { jobType: "rule_refresh" }).count, 1);
});

test("demo rule refresh retry fails clearly without inventing failed category targets", () => {
  assert.throws(
    () => retryDemoRuleRefresh("failed-job-1"),
    (error) => {
      assert.equal(error.code, "DEMO_RULE_REFRESH_RETRY_UNAVAILABLE");
      assert.equal(error.status, 503);
      assert.match(error.message, /本地演示环境/);
      return true;
    },
  );
});

test("demo server module remains importable without a script path", () => {
  assert.equal(typeof retryDemoRuleRefresh, "function");
});

test("demo compliance sync refuses to create a zero-target job without fake SKCs", () => {
  const state = { job: null, jobs: [], snapshot: null };
  assert.throws(
    () => startDemoComplianceSync(state),
    (error) => {
      assert.equal(error.code, "COMPLIANCE_SYNC_NO_TARGETS");
      assert.equal(error.status, 409);
      return true;
    },
  );
  assert.deepEqual(state.jobs, []);
});

test("demo preflight keeps real SKU inputs but fails closed without SHEIN", () => {
  const batch = applyDemoBatchAction(demoBatch(), "preflight", [readyDraft]);

  assert.equal(batch.state, "failed");
  assert.equal(batch.items[0].attemptCount, 1);
  assert.deepEqual(batch.items[0].preflight.supplierSkus, [
    "RUG-40X60",
    "RUG-50X80",
  ]);
  assert.match(batch.items[0].lastError, /未连接真实SHEIN店铺/);
  assert.equal(
    batch.items[0].preflight.remotePublishCandidate.state,
    "blocked",
  );
  assert.equal(batch.preflight.publishingEnabled, false);
});

test("demo preflight fails closed for missing SKU and paused batches", () => {
  const missingSkuBatch = applyDemoBatchAction(
    demoBatch(),
    "preflight",
    [{ id: "draft-1", data: { sizeRows: [] } }],
  );
  assert.equal(missingSkuBatch.state, "failed");
  assert.match(missingSkuBatch.lastError, /没有可预检的商家SKU/);

  assert.throws(
    () =>
      applyDemoBatchAction(
        demoBatch({ state: "paused" }),
        "preflight",
        [readyDraft],
      ),
    /请先恢复/,
  );
  assert.throws(
    () => applyDemoBatchAction(demoBatch(), "publish", [readyDraft]),
    /仅支持/,
  );
});

test("demo confirmation always fails closed without a real remote snapshot", () => {
  assert.throws(
    () => applyDemoBatchAction(demoBatch({ state: "failed" }), "confirm"),
    /仅可确认全部条目/,
  );
  assert.throws(
    () => applyDemoBatchAction(demoBatch({ state: "ready" }), "confirm"),
    /未连接真实SHEIN店铺/,
  );
});

test("demo execution planning never invents a publishable request", () => {
  assert.throws(
    () => applyDemoBatchAction(demoBatch({ state: "ready" }), "plan-execution"),
    /必须先确认当前冻结快照/,
  );
  assert.throws(
    () =>
      applyDemoBatchAction(
        demoBatch({
          state: "ready",
          preflight: { confirmation: { state: "confirmed" } },
        }),
        "plan-execution",
      ),
    /没有真实远程发布候选/,
  );
});

test("demo execution authorization always fails closed", () => {
  assert.throws(
    () => applyDemoBatchAction(demoBatch({ state: "ready" }), "authorize-execution"),
    /必须先生成并核对/,
  );
  assert.throws(
    () =>
      applyDemoBatchAction(
        demoBatch({
          state: "ready",
          preflight: {
            executionPlan: { state: "ready_for_execution_confirmation" },
          },
        }),
        "authorize-execution",
      ),
    /演示环境不能生成/,
  );
});

test("demo publish batches accept only fully preflighted drafts", () => {
  assert.equal(
    isDemoDraftBatchEligible({
      status: "ready",
      preflight: { passed: true },
    }),
    true,
  );
  assert.equal(
    isDemoDraftBatchEligible({
      status: "blocked",
      preflight: { passed: true },
    }),
    false,
  );
  assert.equal(
    isDemoDraftBatchEligible({
      status: "ready",
      preflight: { passed: false },
    }),
    false,
  );
});
