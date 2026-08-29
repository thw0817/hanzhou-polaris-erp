import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProductAttributeDraftPreflight,
  buildProductContentDraftPreflight,
  buildProductComplianceDraftPreflight,
  buildProductImageDraftPreflight,
  buildProductPublishCandidateDraftPreflight,
  buildProductPublishSettingsDraftPreflight,
  buildRugReportDraftPreflight,
  buildSkuDraftPreflight,
  collectDraftMediaAssetIds,
  PostgresProductDraftRepository,
  WebProductDraftService,
} from "./product-draft-service.js";

const thresholdAttributeFields = [
  {
    id: "1001889",
    name: "是否面积大于2.16m²",
    typeCode: 4,
    dataDimension: 1,
    values: [
      { id: "459", label: "否" },
      { id: "763", label: "是" },
    ],
  },
  {
    id: "1001890",
    name: "是否最长边大于1.8m",
    typeCode: 4,
    dataDimension: 1,
    values: [
      { id: "459", label: "否" },
      { id: "763", label: "是" },
    ],
  },
];

const thresholdRugReportSources = {
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
};

test("waits for the per-SKC SHEIN report requirement instead of classifying attributes", () => {
  const result = buildRugReportDraftPreflight({
    attributeSchemaSnapshot: {
      fetchedAt: "2026-08-21T00:00:00.000Z",
      fields: thresholdAttributeFields,
    },
    attributeValues: {
      1001889: { valueIds: ["459"], customValue: "" },
      1001890: { valueIds: ["459"], customValue: "" },
    },
    rugReportSources: thresholdRugReportSources,
  });

  assert.equal(result.rugReport.reportType, null);
  assert.deepEqual(result.rugReport.blockers, []);
  assert.equal(result.rugReport.source, "shein_compliance_requirement");
});

test("does not derive a report type from older threshold snapshots", () => {
  const result = buildRugReportDraftPreflight({
    attributeSchemaSnapshot: {
      fetchedAt: "2026-08-21T00:00:00.000Z",
      fields: thresholdAttributeFields,
    },
    attributeValues: {
      1001889: { valueIds: ["763"], customValue: "" },
      1001890: { valueIds: ["459"], customValue: "" },
    },
    rugReportSources: {},
  });

  assert.equal(result.rugReport.reportType, null);
  assert.deepEqual(result.rugReport.blockers, []);
});

const validComplianceSnapshot = {
  id: "compliance-template-1",
  storeId: "store-1",
  name: "装饰地毯合规方案",
  categoryId: "3155",
  version: 1,
  data: {
    referenceSkc: "reference-skc",
    ruleFetchedAt: "2026-08-05T00:00:00.000Z",
    ruleExpiresAt: "2099-01-01T00:00:00.000Z",
    requirements: [],
    storeScoped: true,
    revalidateOnUse: true,
    defaults: {
      certificates: [],
      agencies: [],
      warnings: [],
      photos: [
        { labelGroup: "1", localAssetRef: "media:body-asset" },
        { labelGroup: "2", localAssetRef: "media:package-asset" },
      ],
    },
  },
};

const validReportSnapshot = {
  id: "report-template-1630",
  storeId: "store-1",
  name: "1630报告-2026版",
  version: 1,
  data: {
    templateKind: "rug_report",
    reportType: "1630",
    reportDate: "2026-08-21",
    reportFile: { localAssetRef: "media:report-asset" },
    storeScoped: true,
    revalidateOnUse: true,
    defaults: {
      certificates: [{
        certificateTypeCode: "RUG-1630",
        certificateTypeName: "1630检测报告",
        files: [{ localAssetRef: "media:report-asset" }],
      }],
      photos: [],
    },
  },
};

const validSkuStageData = {
  title: "现代装饰地毯",
  description: "短绒防滑地毯",
  supplierCode: "RUG-001",
  sizeTemplateId: "size-template-1",
  packagingTemplateId: "packaging-template-1",
  packagingMaterial: "天鹅绒",
  colorSaleValue: {
    attributeId: "10",
    valueId: "101",
  },
  skuRows: [{
    id: "row-1",
    sizeText: "40×60",
    supplierSku: "RUG-001-40X60",
    lengthCm: 60,
    widthCm: 40,
    sizeMapping: {
      attributeId: "87",
      valueId: "201",
    },
    packageLengthCm: 20,
    packageWidthCm: 16,
    packageHeightCm: 6,
    packageMatch: "matched",
    costPrice: "2.40",
    inventoryNum: 100,
    weightGrams: 204,
  }],
  currency: "CNY",
  publishSettings: {
    mallState: "1",
    stopPurchase: "1",
    shelfRequire: "1",
    shelfWay: "1",
    hopeOnSaleDate: "",
  },
  complianceTemplateId: validComplianceSnapshot.id,
  complianceTemplateSnapshot: validComplianceSnapshot,
  reportTemplateId: validReportSnapshot.id,
  reportTemplateSnapshot: validReportSnapshot,
  attributeSchemaSnapshot: {
    fetchedAt: "2026-08-05T00:00:00.000Z",
    categoryId: "3155",
    productTypeId: "991",
    fields: [
      {
        id: "length",
        name: "长度 (cm)",
        required: true,
        typeCode: 4,
        dataDimension: 1,
        modeCode: 0,
        maxSelections: 0,
        values: [],
        ruleInfoList: [],
      },
      {
        id: "width",
        name: "宽度 (cm)",
        required: true,
        typeCode: 4,
        dataDimension: 1,
        modeCode: 0,
        maxSelections: 0,
        values: [],
        ruleInfoList: [],
      },
    ],
  },
  attributeValues: {
    length: { valueIds: [], customValue: "181" },
    width: { valueIds: [], customValue: "120" },
  },
  rugReportSources: {
    dimensions: [
      { attributeId: "length", unit: "cm" },
      { attributeId: "width", unit: "cm" },
    ],
  },
  tailImageTemplateId: "",
  tailImagePlacement: "append",
  imageAssets: {
    main: [{ assetId: "asset-main", originalName: "main.jpg" }],
    detail: [{ assetId: "asset-detail", originalName: "detail.jpg" }],
    tail: [],
  },
  salesSchemaSnapshot: {
    fetchedAt: "2026-08-05T00:00:00.000Z",
    mainAttributeStatus: 2,
    fields: [
      {
        id: "10",
        name: "颜色",
        labelCode: 1,
        values: [{ id: "101", label: "多色" }],
      },
      {
        id: "87",
        name: "尺寸",
        labelCode: 0,
        values: [{ id: "201", label: "40×60" }],
      },
    ],
  },
  publishStandardSnapshot: {
    fetchedAt: "2026-08-05T00:00:00.000Z",
    currency: "CNY",
    weightRequired: true,
    weightConfig: { is_required: true, available_units: ["g"] },
    defaultLanguage: "zh-cn",
    titleMaxLength: 250,
    fillInStandard: [{
      field_key: "product_detail_picture",
      show: true,
      required: false,
    }],
    pictureConfig: [
      { field_key: "switch_spu_picture", is_true: false },
      { field_key: "skc_image_detail_show", is_true: true },
      { field_key: "skc_image_detail_required", is_true: true },
    ],
  },
};

test("collects unique media IDs from draft image slots and SKU rows", () => {
  assert.deepEqual(
    collectDraftMediaAssetIds({
      mainAssetId: "asset-main",
      mainAssetIds: ["asset-main", "asset-carousel-2"],
      tailAssetIds: ["asset-tail", "asset-main"],
      sizeRows: [
        { imageAssetId: "asset-sku" },
        { imageAssetId: "asset-sku" },
      ],
      skuRows: [{ imageAssetId: "asset-v2-sku" }],
      skuPreviewImages: [
        { assetId: "asset-sku-candidate" },
        { id: "asset-v2-sku" },
      ],
      imageAssets: {
        main: [{ assetId: "asset-main" }],
        detail: [{ assetId: "asset-detail" }],
        sku: [{ assetId: "asset-sku" }],
      },
    }),
    [
      "asset-main",
      "asset-carousel-2",
      "asset-tail",
      "asset-sku",
      "asset-v2-sku",
      "asset-sku-candidate",
      "asset-detail",
    ],
  );
});

test("collects compliance media references from the saved template snapshot", () => {
  assert.deepEqual(
    collectDraftMediaAssetIds({
      complianceTemplateSnapshot: {
        ...validComplianceSnapshot,
        data: {
          ...validComplianceSnapshot.data,
          defaults: {
            ...validComplianceSnapshot.data.defaults,
            certificates: [{
              certificateTypeName: "旧1630报告",
              files: [{ localAssetRef: "media:legacy-report-asset" }],
            }],
          },
        },
      },
      reportTemplateSnapshot: validReportSnapshot,
    }),
    ["body-asset", "package-asset", "report-asset"],
  );
});

test("collects all manually uploaded body and package photo references", () => {
  assert.deepEqual(
    collectDraftMediaAssetIds({
      compliancePhotoSourceMode: "manual",
      compliancePhotoAssignments: [
        { labelGroup: "1", localAssetRef: "media:manual-body-1" },
        { labelGroup: "1", localAssetRef: "media:manual-body-2" },
        { labelGroup: "2", localAssetRef: "media:manual-package-1" },
        { labelGroup: "2", localAssetRef: "media:manual-package-2" },
      ],
    }),
    [
      "manual-body-1",
      "manual-body-2",
      "manual-package-1",
      "manual-package-2",
    ],
  );
});

test("keeps report work pending until SHEIN returns the SKC requirement", () => {
  const preflight = buildProductComplianceDraftPreflight(
    validSkuStageData,
    { rugReport: { reportType: "1630", blockers: [] } },
    {
      categoryId: "3155",
      storeId: "store-1",
      now: new Date("2026-08-05T12:00:00.000Z"),
    },
  );

  assert.deepEqual(preflight.compliance.blockers, []);
  assert.equal(preflight.compliance.expectedReport, null);
  assert.deepEqual(
    preflight.compliance.assetIds,
    ["body-asset", "package-asset"],
  );
  assert.deepEqual(preflight.compliance.postPublishPhotos.body, [
    { assetId: "body-asset", name: "" },
  ]);
  assert.deepEqual(
    preflight.compliance.manualQueue,
    ["gcc", "product_identifier"],
  );
  assert.equal(preflight.compliance.requiresSkcRevalidation, true);
  assert.equal("gcc" in preflight.compliance, false);
  assert.equal("productIdentifier" in preflight.compliance, false);
});

test("builds post-publish photo groups from manual uploads instead of a selected template", () => {
  const preflight = buildProductComplianceDraftPreflight(
    {
      ...validSkuStageData,
      compliancePhotoSourceMode: "manual",
      compliancePhotoAssignments: [
        { labelGroup: "1", localAssetRef: "media:manual-body-1", fileName: "body-1.jpg" },
        { labelGroup: "1", localAssetRef: "media:manual-body-2", fileName: "body-2.jpg" },
        { labelGroup: "2", localAssetRef: "media:manual-package-1", fileName: "package-1.jpg" },
      ],
    },
    {},
    { categoryId: "3155", storeId: "store-1" },
  );

  assert.deepEqual(preflight.compliance.postPublishPhotos, {
    body: [
      { assetId: "manual-body-1", name: "body-1.jpg" },
      { assetId: "manual-body-2", name: "body-2.jpg" },
    ],
    package: [
      { assetId: "manual-package-1", name: "package-1.jpg" },
    ],
  });
});

test("quarantines forged compliance snapshots without blocking initial publication", () => {
  const preflight = buildProductComplianceDraftPreflight(
    {
      complianceTemplateId: "forged-template",
      complianceTemplateSnapshot: {
        ...validComplianceSnapshot,
        data: {
          ...validComplianceSnapshot.data,
          defaults: {
            ...validComplianceSnapshot.data.defaults,
            photos: [],
          },
        },
      },
      reportTemplateId: validReportSnapshot.id,
      reportTemplateSnapshot: validReportSnapshot,
    },
    { rugReport: { reportType: "1630", blockers: [] } },
    {
      categoryId: "3155",
      storeId: "store-1",
      now: new Date("2026-08-05T12:00:00.000Z"),
    },
  );

  assert.deepEqual(
    preflight.compliance.advisories.map((item) => item.code),
    [
      "COMPLIANCE_TEMPLATE_ID_MISMATCH",
      "COMPLIANCE_TEMPLATE_NOT_SELECTED",
    ],
  );
  assert.deepEqual(preflight.compliance.blockers, []);
  assert.deepEqual(preflight.compliance.assetIds, []);
});

test("quarantines a compliance snapshot from another store as an advisory", () => {
  const preflight = buildProductComplianceDraftPreflight(
    {
      complianceTemplateId: validComplianceSnapshot.id,
      complianceTemplateSnapshot: {
        ...validComplianceSnapshot,
        storeId: "store-2",
      },
    },
    { rugReport: { reportType: "1630", blockers: [] } },
    {
      categoryId: "3155",
      storeId: "store-1",
      now: new Date("2026-08-05T12:00:00.000Z"),
    },
  );

  assert.equal(
    preflight.compliance.advisories[0].code,
    "COMPLIANCE_TEMPLATE_STORE_MISMATCH",
  );
  assert.deepEqual(preflight.compliance.blockers, []);
  assert.deepEqual(preflight.compliance.assetIds, []);
});

test("passes collected media IDs to the draft repository", async () => {
  let received;
  const service = new WebProductDraftService({
    repository: {
      async save(input) {
        received = input;
        return {
          id: "draft-1",
          store_id: "store-1",
          name: input.name,
          category_id: input.categoryId,
          product_type_id: input.productTypeId,
          draft_data: input.data,
          preflight: input.preflight,
          status: input.status,
          updated_at: "2026-07-31T00:00:00.000Z",
        };
      },
    },
    async associatedAttributeRules() {
      return {
        info: {
          data: [{
            group_id: "template",
            link_rule_attribute_list: [],
          }],
        },
        diagnostics: { traceId: "trace-linked" },
      };
    },
    now: () => new Date("2026-08-05T01:00:00.000Z"),
  });

  await service.save({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    input: {
      name: "测试草稿",
      categoryId: "3155",
      productTypeId: "991",
      data: {
        mainAssetId: "asset-main",
        imageAssets: { detail: [{ assetId: "asset-detail" }] },
      },
      preflight: {},
      status: "blocked",
    },
  });

  assert.deepEqual(received.mediaAssetIds, ["asset-main", "asset-detail"]);
});

test("drafts remain isolated by store and reappear after switching back", async () => {
  const rows = [];
  const service = new WebProductDraftService({
    repository: {
      async list({ tenantId, storeId }) {
        return rows.filter((row) =>
          row.tenant_id === tenantId && row.store_id === storeId,
        );
      },
      async save(input) {
        const row = {
          id: input.id || `${input.storeId}-${rows.length + 1}`,
          store_id: input.storeId,
          name: input.name,
          category_id: input.categoryId,
          product_type_id: input.productTypeId,
          draft_data: input.data,
          preflight: input.preflight,
          status: input.status,
          updated_at: "2026-08-23T00:00:00.000Z",
          tenant_id: input.tenantId,
        };
        rows.push(row);
        return row;
      },
    },
  });
  const context = { tenantId: "tenant-1", userId: "user-1" };

  await service.save({
    context,
    storeId: "store-a",
    input: { name: "A店草稿", status: "draft", data: {} },
  });
  await service.save({
    context,
    storeId: "store-b",
    input: { name: "B店草稿", status: "draft", data: {} },
  });

  const storeA = await service.list({ context, storeId: "store-a" });
  const storeB = await service.list({ context, storeId: "store-b" });
  const storeAAfterSwitchBack = await service.list({ context, storeId: "store-a" });

  assert.deepEqual(storeA.drafts.map((draft) => draft.name), ["A店草稿"]);
  assert.deepEqual(storeB.drafts.map((draft) => draft.name), ["B店草稿"]);
  assert.deepEqual(
    storeAAfterSwitchBack.drafts.map((draft) => draft.name),
    ["A店草稿"],
  );
});

test("revalidate refreshes persisted blocked drafts without changing their content", async () => {
  const rows = [{
    id: "draft-stale",
    tenant_id: "tenant-1",
    store_id: "store-1",
    name: "待复核商品",
    category_id: "",
    product_type_id: "",
    draft_data: { title: "待复核商品", skuRows: [] },
    preflight: { publishCandidate: { state: "blocked", blockers: [{ message: "旧状态" }] } },
    status: "blocked",
    updated_at: "2026-08-23T00:00:00.000Z",
  }];
  const service = new WebProductDraftService({
    repository: {
      async list() { return rows; },
      async save(input) {
        rows[0] = {
          ...rows[0],
          draft_data: input.data,
          preflight: input.preflight,
          status: input.status,
        };
        return rows[0];
      },
    },
  });
  const result = await service.revalidate({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    draftIds: ["draft-stale"],
  });
  assert.equal(result.count, 1);
  assert.equal(result.drafts[0].data.title, "待复核商品");
  assert.notEqual(result.drafts[0].preflight.publishCandidate?.generatedAt, undefined);
});

test("revalidate refreshes every explicitly selected draft instead of truncating the handoff", async () => {
  const rows = Array.from({ length: 21 }, (_, index) => ({
    id: `draft-selected-${index + 1}`,
    tenant_id: "tenant-1",
    store_id: "store-1",
    name: `批量商品 ${index + 1}`,
    category_id: "",
    product_type_id: "",
    draft_data: { title: `批量商品 ${index + 1}`, skuRows: [] },
    preflight: { publishCandidate: { generatedAt: "2026-08-01T00:00:00.000Z" } },
    status: "blocked",
  }));
  const service = new WebProductDraftService({
    repository: {
      async list() { return rows; },
      async save(input) {
        const index = rows.findIndex((row) => row.id === input.id);
        rows[index] = {
          ...rows[index],
          draft_data: input.data,
          preflight: input.preflight,
          status: input.status,
        };
        return rows[index];
      },
    },
  });

  const result = await service.revalidate({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    draftIds: rows.map((row) => row.id),
    force: true,
  });

  assert.equal(result.count, 21);
  assert.equal(result.skippedCount, 0);
  assert.equal(new Set(result.drafts.map((draft) => draft.id)).size, 21);
});

test("revalidate backfills the fixed append placement for legacy tail-image drafts", async () => {
  let savedData;
  const service = new WebProductDraftService({
    repository: {
      async list() {
        return [{
          id: "draft-legacy-tail",
          tenant_id: "tenant-1",
          store_id: "store-1",
          name: "旧尾图草稿",
          category_id: "3155",
          product_type_id: "991",
          draft_data: {
            title: "旧尾图草稿",
            tailImageTemplateId: "tail-1",
            imageAssets: { tail: [{ assetId: "asset-tail" }] },
          },
          preflight: { publishCandidate: { generatedAt: "2026-08-01T00:00:00.000Z" } },
          status: "blocked",
        }];
      },
      async save(input) {
        savedData = input.data;
        return {
          id: "draft-legacy-tail",
          store_id: "store-1",
          name: input.name,
          category_id: input.categoryId,
          product_type_id: input.productTypeId,
          draft_data: input.data,
          preflight: input.preflight,
          status: input.status,
          updated_at: "2026-08-25T00:00:00.000Z",
        };
      },
    },
  });
  const result = await service.revalidate({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
  });
  assert.equal(result.count, 1);
  assert.equal(savedData.tailImagePlacement, "append");
});

test("revalidate refreshes packaging matches from the current store template", async () => {
  let savedData;
  const service = new WebProductDraftService({
    repository: {
      async list() {
        return [{
          id: "draft-packaging-stale",
          tenant_id: "tenant-1",
          store_id: "store-1",
          name: "待更新打包体积商品",
          category_id: "",
          product_type_id: "",
          draft_data: {
            ...validSkuStageData,
            skuRows: [{
              ...validSkuStageData.skuRows[0],
              sizeText: "100×150",
              lengthCm: 150,
              widthCm: 100,
              packageLengthCm: "",
              packageWidthCm: "",
              packageHeightCm: "",
              packageMatch: "missing",
            }],
          },
          preflight: { publishCandidate: { generatedAt: "2026-08-01T00:00:00.000Z" } },
          status: "blocked",
        }];
      },
      async save(input) {
        savedData = input.data;
        return {
          id: "draft-packaging-stale",
          store_id: "store-1",
          name: input.name,
          category_id: input.categoryId,
          product_type_id: input.productTypeId,
          draft_data: input.data,
          preflight: input.preflight,
          status: input.status,
          updated_at: "2026-08-25T00:00:00.000Z",
        };
      },
    },
    packagingTemplateProvider: async () => ({
      templates: [{
        id: "packaging-template-1",
        data: {
          materials: {
            天鹅绒: [{
              widthCm: 100,
              lengthCm: 150,
              packageLengthCm: 30,
              packageWidthCm: 20,
              packageHeightCm: 12,
              key: "100x150",
            }],
          },
        },
      }],
    }),
  });
  const result = await service.revalidate({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
  });
  const row = savedData.skuRows[0];
  assert.equal(result.count, 1);
  assert.equal(row.packageMatch, "matched");
  assert.equal(row.packageLengthCm, 30);
  assert.equal(row.packageWidthCm, 20);
  assert.equal(row.packageHeightCm, 12);
});

test("revalidate skips a recently checked draft to protect SHEIN and server capacity", async () => {
  let saves = 0;
  const service = new WebProductDraftService({
    repository: {
      async list() {
        return [{
          id: "draft-fresh",
          tenant_id: "tenant-1",
          store_id: "store-1",
          name: "刚检查商品",
          category_id: "",
          product_type_id: "",
          draft_data: {},
          preflight: { publishCandidate: { generatedAt: "2026-08-05T00:58:00.000Z" } },
          status: "blocked",
        }];
      },
      async save() { saves += 1; return null; },
    },
    now: () => new Date("2026-08-05T01:00:00.000Z"),
  });
  const result = await service.revalidate({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
  });
  assert.equal(result.count, 0);
  assert.equal(saves, 0);
});

test("forced revalidation refreshes a selected draft even when its snapshot is recent", async () => {
  let saves = 0;
  const service = new WebProductDraftService({
    repository: {
      async list() {
        return [{
          id: "draft-force",
          tenant_id: "tenant-1",
          store_id: "store-1",
          name: "提交前强制复核商品",
          category_id: "",
          product_type_id: "",
          draft_data: {},
          preflight: { publishCandidate: { generatedAt: "2026-08-05T00:59:00.000Z" } },
          status: "blocked",
        }];
      },
      async save(input) {
        saves += 1;
        return {
          id: "draft-force",
          store_id: "store-1",
          name: input.name,
          category_id: input.categoryId,
          product_type_id: input.productTypeId,
          draft_data: input.data,
          preflight: input.preflight,
          status: input.status,
          updated_at: "2026-08-05T01:00:00.000Z",
        };
      },
    },
    now: () => new Date("2026-08-05T01:00:00.000Z"),
  });

  const result = await service.revalidate({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    draftIds: ["draft-force"],
    force: true,
  });
  assert.equal(result.count, 1);
  assert.equal(saves, 1);
});

test("blocks a new draft when the current store quota is full", async () => {
  let saveCalled = false;
  const service = new WebProductDraftService({
    repository: {
      async usage() {
        return { storeDraftCount: 100, tenantDraftCount: 100 };
      },
      async save() {
        saveCalled = true;
        return null;
      },
    },
    quota: { draftPerStore: 100, draftPerTenant: 1_000 },
  });

  await assert.rejects(
    service.save({
      context: { tenantId: "tenant-1", userId: "user-1" },
      storeId: "store-1",
      input: { name: "已满额度商品", status: "draft", data: {} },
    }),
    (error) =>
      error?.code === "DRAFT_QUOTA_EXCEEDED" && error?.status === 409,
  );
  assert.equal(saveCalled, false);
});

test("browser saves cannot mark a product draft as published", async () => {
  let saved = false;
  const service = new WebProductDraftService({
    repository: {
      async save() {
        saved = true;
        throw new Error("published status must be rejected before persistence");
      },
    },
  });

  await assert.rejects(
    service.save({
      context: { tenantId: "tenant-1", userId: "user-1" },
      storeId: "store-1",
      input: {
        name: "不能伪造已发布状态",
        status: "published",
        data: {},
      },
    }),
    (error) => error?.code === "PUBLISHED_STATUS_SERVER_MANAGED",
  );
  assert.equal(saved, false);
});

test("the draft repository cannot overwrite an already published draft", async () => {
  const calls = [];
  const client = {
    async query(query) {
      calls.push(query);
      if (typeof query === "string") return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  const repository = new PostgresProductDraftRepository({
    pool: { async connect() { return client; } },
  });

  const result = await repository.save({
    id: "draft-1",
    tenantId: "tenant-1",
    storeId: "store-1",
    name: "已发布商品",
    categoryId: "3155",
    productTypeId: "991",
    data: {},
    preflight: {},
    status: "ready",
    userId: "user-1",
  });

  assert.equal(result, null);
  assert.match(calls[1].text, /product_drafts\.status <> 'published'/);
});

test("the draft-box projection excludes drafts that already entered publishing", async () => {
  const queries = [];
  const repository = new PostgresProductDraftRepository({
    pool: {
      async query(query) {
        queries.push(query);
        return { rows: [], rowCount: 0 };
      },
    },
  });

  await repository.list({ tenantId: "tenant-1", storeId: "store-1" });
  assert.match(queries[0].text, /NOT EXISTS[\s\S]*FROM publish_jobs/i);
  assert.match(queries[0].text, /publish_jobs\.product_draft_id\s*=\s*product_drafts\.id/i);
  assert.match(queries[0].text, /publish_jobs\.tenant_id\s*=\s*product_drafts\.tenant_id/i);
  assert.match(queries[0].text, /publish_jobs\.store_id\s*=\s*product_drafts\.store_id/i);
  assert.doesNotMatch(queries[0].text, /FROM publish_batch_items/i);

  await repository.list({
    tenantId: "tenant-1",
    storeId: "store-1",
    includePublishHistory: true,
  });
  assert.doesNotMatch(queries[1].text, /NOT EXISTS[\s\S]*FROM publish_jobs/i);
});

test("draft quota counts only drafts that are still in the draft box", async () => {
  let query;
  const repository = new PostgresProductDraftRepository({
    pool: {
      async query(input) {
        query = input;
        return { rows: [{ store_draft_count: 0, tenant_draft_count: 0 }] };
      },
    },
  });

  await repository.usage({ tenantId: "tenant-1", storeId: "store-1" });
  assert.match(query.text, /NOT EXISTS[\s\S]*FROM publish_jobs/i);
  assert.match(query.text, /publish_jobs\.product_draft_id\s*=\s*product_drafts\.id/i);
  assert.doesNotMatch(query.text, /FROM publish_batch_items/i);
});

test("draft media accepts only assets from the selected visible shared tail template", async () => {
  const calls = [];
  const draftId = "11111111-1111-4111-8111-111111111111";
  const templateId = "22222222-2222-4222-8222-222222222222";
  const assetIds = [
    "33333333-3333-4333-8333-333333333333",
    "44444444-4444-4444-8444-444444444444",
  ];
  const client = {
    async query(query) {
      calls.push(query);
      if (typeof query === "string") return { rows: [], rowCount: 0 };
      if (query.text.includes("INSERT INTO product_drafts")) {
        return {
          rows: [{ id: draftId }],
          rowCount: 1,
        };
      }
      if (query.text.includes("SELECT asset_id") && query.text.includes("product_draft")) {
        return { rows: [], rowCount: 0 };
      }
      if (query.text.includes("INSERT INTO media_asset_references")) {
        return { rows: [], rowCount: assetIds.length };
      }
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  const repository = new PostgresProductDraftRepository({
    pool: { async connect() { return client; } },
  });

  await repository.save({
    id: draftId,
    tenantId: "55555555-5555-4555-8555-555555555555",
    storeId: "66666666-6666-4666-8666-666666666666",
    name: "共享轮播图草稿",
    categoryId: "3155",
    productTypeId: "991",
    data: { tailImageTemplateId: templateId },
    mediaAssetIds: assetIds,
    preflight: {},
    status: "blocked",
    userId: "77777777-7777-4777-8777-777777777777",
  });

  const referenceInsert = calls.find(
    (query) => typeof query !== "string" && query.text.includes("INSERT INTO media_asset_references"),
  );
  assert.ok(referenceInsert);
  assert.match(referenceInsert.text, /template\.template_type='tail_image'/);
  assert.match(referenceInsert.text, /template\.store_id=m\.store_id/);
  assert.match(referenceInsert.text, /template\.template_data->'assetIds' \? \(m\.id::text\)/);
  assert.match(referenceInsert.text, /template\.scope='tenant'/);
  assert.match(referenceInsert.text, /template\.owner_user_id=\$6/);
  assert.deepEqual(referenceInsert.values.slice(4), [
    templateId,
    "77777777-7777-4777-8777-777777777777",
  ]);
});

test("categoryless local draft shells never call SHEIN associated attribute rules", async () => {
  let associatedCalls = 0;
  let received;
  const service = new WebProductDraftService({
    repository: {
      async save(input) {
        received = input;
        return {
          id: "draft-local-shell",
          store_id: "store-1",
          name: input.name,
          category_id: input.categoryId,
          product_type_id: input.productTypeId,
          draft_data: input.data,
          preflight: input.preflight,
          status: input.status,
          updated_at: "2026-08-22T00:00:00.000Z",
        };
      },
    },
    async associatedAttributeRules() {
      associatedCalls += 1;
      throw new Error("不应调用SHEIN");
    },
  });

  const result = await service.save({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    input: {
      name: "批量素材草稿",
      categoryId: "",
      productTypeId: "",
      data: {
        title: "批量素材草稿",
        imageAssets: { main: [{ assetId: "asset-main" }] },
        skuPreviewImages: [],
        skuRows: [],
      },
      preflight: {},
      status: "blocked",
    },
  });

  assert.equal(associatedCalls, 0);
  assert.equal(received.status, "blocked");
  assert.equal(result.draft.status, "blocked");
});

test("legacy batch clients keep a 250-character product title while the internal draft name is normalized", async () => {
  let received;
  const service = new WebProductDraftService({
    repository: {
      async save(input) {
        received = input;
        return {
          id: "draft-long-title",
          store_id: "store-1",
          name: input.name,
          category_id: "",
          product_type_id: "",
          draft_data: input.data,
          preflight: input.preflight,
          status: input.status,
          updated_at: "2026-08-24T00:00:00.000Z",
        };
      },
    },
  });
  const title = "地".repeat(250);

  const result = await service.save({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    input: {
      name: title,
      data: { title },
      preflight: {},
      status: "blocked",
    },
  });

  assert.equal(received.name.length, 160);
  assert.equal(received.data.title.length, 250);
  assert.equal(result.draft.name.length, 160);
  assert.equal(result.draft.data.title.length, 250);
});

test("recalculates 1630 or 1631 from saved SKC product attributes", async () => {
  let received;
  const service = new WebProductDraftService({
    repository: {
      async save(input) {
        received = input;
        return {
          id: "draft-1",
          store_id: "store-1",
          name: input.name,
          category_id: input.categoryId,
          product_type_id: input.productTypeId,
          draft_data: input.data,
          preflight: input.preflight,
          status: input.status,
          updated_at: "2026-08-05T00:00:00.000Z",
        };
      },
    },
    async associatedAttributeRules() {
      return {
        info: {
          data: [{
            group_id: "template",
            link_rule_attribute_list: [],
          }],
        },
        diagnostics: { traceId: "trace-linked" },
      };
    },
    now: () => new Date("2026-08-05T01:00:00.000Z"),
  });

  const result = await service.save({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    input: {
      name: "装饰地毯草稿",
      categoryId: "3155",
      productTypeId: "991",
      data: {
        ...validSkuStageData,
        attributeSchemaSnapshot: {
          fetchedAt: "2026-08-05T00:00:00.000Z",
          categoryId: "3155",
          productTypeId: "991",
          fields: [
            {
              id: "length",
              name: "长度 (cm)",
              required: true,
              typeCode: 4,
              dataDimension: 1,
              modeCode: 0,
              maxSelections: 0,
              values: [],
              ruleInfoList: [],
            },
            {
              id: "width",
              name: "宽度 (cm)",
              required: true,
              typeCode: 4,
              dataDimension: 1,
              modeCode: 0,
              maxSelections: 0,
              values: [],
              ruleInfoList: [],
            },
          ],
        },
        attributeValues: {
          length: { valueIds: [], customValue: "181" },
          width: { valueIds: [], customValue: "120" },
        },
        rugReportSources: {
          dimensions: [
            { attributeId: "length", unit: "cm" },
            { attributeId: "width", unit: "cm" },
          ],
        },
      },
      preflight: {
        rugReport: { reportType: "1631", blockers: [] },
      },
      status: "ready",
    },
  });

  assert.equal(received.preflight.rugReport.reportType, null);
  assert.equal(received.preflight.rugReport.source, "shein_compliance_requirement");
  assert.equal(received.preflight.rugReport.schemaFetchedAt, "");
  assert.deepEqual(received.preflight.attributes.blockers, []);
  assert.deepEqual(
    received.preflight.attributes.publishPreview.product_attribute_list,
    [
      { attribute_id: "length", attribute_extra_value: "181" },
      { attribute_id: "width", attribute_extra_value: "120" },
    ],
  );
  assert.equal(
    received.preflight.publishCandidate.state,
    "ready_for_remote_preflight",
  );
  assert.ok(received.preflight.publishCandidate.fingerprint);
  assert.equal(result.draft.status, "ready");
});

test("server linked-rule lookup uses only schema-backed attributes and overrides client snapshots", async () => {
  let linkedInput;
  let received;
  const service = new WebProductDraftService({
    repository: {
      async save(input) {
        received = input;
        return {
          id: "draft-1",
          store_id: "store-1",
          name: input.name,
          category_id: input.categoryId,
          product_type_id: input.productTypeId,
          draft_data: input.data,
          preflight: input.preflight,
          status: input.status,
          updated_at: "2026-08-05T01:00:00.000Z",
        };
      },
    },
    async associatedAttributeRules(input) {
      linkedInput = input;
      return {
        info: {
          data: [{
            group_id: "template",
            link_rule_attribute_list: [{
              attribute_id: "width",
              attribute_value_list: [],
              attribute_value_pre_fill_list: [],
            }],
          }],
        },
        diagnostics: { traceId: "server-trace" },
      };
    },
    now: () => new Date("2026-08-05T01:00:00.000Z"),
  });

  await service.save({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    input: {
      name: "服务端关联规则草稿",
      categoryId: "3155",
      productTypeId: "991",
      data: {
        ...validSkuStageData,
        attributeValues: {
          ...validSkuStageData.attributeValues,
          forged: { valueIds: ["forged"], customValue: "" },
        },
        associatedRulesSnapshot: {
          checkedAt: "2099-01-01T00:00:00.000Z",
          rules: [],
        },
      },
      preflight: {},
      status: "ready",
    },
  });

  assert.deepEqual(linkedInput.attributeList, [
    { attributeId: "length" },
    { attributeId: "width" },
  ]);
  assert.equal(
    received.preflight.attributes.associatedRulesTraceId,
    "server-trace",
  );
  assert.equal(
    received.preflight.attributes.blockers[0].code,
    "ATTRIBUTE_ID_INVALID",
  );
  assert.equal(received.status, "blocked");
});

test("attribute and candidate draft helpers never trust saved browser previews", () => {
  const attributes = buildProductAttributeDraftPreflight(
    {
      ...validSkuStageData,
      attributePublishPreview: {
        product_attribute_list: [{
          attribute_id: "forged",
          attribute_value_id: "forged",
        }],
      },
    },
    {},
    {
      categoryId: "3155",
      productTypeId: "991",
      associatedRuleResult: {
        checkedAt: "2026-08-05T01:00:00.000Z",
        rules: [],
      },
    },
  );
  const candidate = buildProductPublishCandidateDraftPreflight(
    validSkuStageData,
    {
      ...attributes,
      content: { blockers: [] },
      images: { blockers: [] },
      sku: { blockers: [] },
      publishSettings: { blockers: [] },
      compliance: { blockers: [] },
      rugReport: { blockers: [], reportType: "1630" },
    },
    {
      categoryId: "3155",
      productTypeId: "991",
      generatedAt: "2026-08-05T01:00:00.000Z",
    },
  );

  assert.equal(
    JSON.stringify(attributes.attributes).includes('"forged"'),
    false,
  );
  assert.equal(candidate.publishCandidate.state, "ready_for_remote_preflight");
});

test("revalidates SKU sale mappings and packaging before accepting ready", () => {
  const preflight = buildSkuDraftPreflight({
    ...validSkuStageData,
    colorSaleValue: {
      attributeId: "10",
      valueId: "forged",
    },
    skuRows: [{
      ...validSkuStageData.skuRows[0],
      packageLengthCm: 0,
      packageMatch: "matched",
    }],
  });

  assert.deepEqual(
    preflight.sku.blockers.map((item) => item.code),
    [
      "COLOR_SALE_VALUE_REQUIRED",
      "PACKAGING_SIZE_NOT_MATCHED",
    ],
  );
});

test("rebuilds the SKU publish preview on the server and keeps image assets outside the API fragment", () => {
  const data = {
    ...validSkuStageData,
    skuRows: [{
      ...validSkuStageData.skuRows[0],
      imageAssetId: "asset-sku-1",
    }],
  };
  const preflight = buildSkuDraftPreflight(
    data,
    buildProductPublishSettingsDraftPreflight(data),
  );

  assert.deepEqual(preflight.sku.blockers, []);
  assert.equal(
    preflight.sku.publishPreview.skc.sku_list[0].supplier_sku,
    "RUG-001-40X60",
  );
  assert.equal(
    "image_info" in preflight.sku.publishPreview.skc.sku_list[0],
    false,
  );
  assert.equal(preflight.sku.publishPreview.skc.sku_list[0].mall_state, 1);
  assert.equal(preflight.sku.publishPreview.skc.sku_list[0].stop_purchase, 1);
  assert.equal(
    preflight.sku.publishPreview.pendingImageUploads[0].assetId,
    "asset-sku-1",
  );
});

test("server publishing settings always apply the four fixed defaults", () => {
  const missing = buildProductPublishSettingsDraftPreflight({
    publishStandardSnapshot: { fetchedAt: "2026-08-05T00:00:00.000Z" },
    publishSettings: {},
  });
  assert.deepEqual(missing.publishSettings.payload, {
    root: { shelf_require: "0" },
    skc: { shelf_way: "1" },
    sku: { mall_state: 1, stop_purchase: 1 },
  });
  assert.equal(missing.publishSettings.blockers.length, 0);

  const hidden = buildProductPublishSettingsDraftPreflight({
    publishStandardSnapshot: {
      fetchedAt: "2026-08-05T00:00:00.000Z",
      fillInStandard: [
        { field_key: "stop_purchase", show: false, required: true },
        { field_key: "shelf_require", show: false, required: true },
      ],
    },
    publishSettings: validSkuStageData.publishSettings,
  });
  assert.deepEqual(hidden.publishSettings.blockers, []);
  assert.deepEqual(hidden.publishSettings.payload, {
    root: { shelf_require: "0" },
    skc: { shelf_way: "1" },
    sku: { mall_state: 1, stop_purchase: 1 },
  });
});

test("rebuilds the image upload plan from the saved SHEIN picture rules", () => {
  const preflight = buildProductImageDraftPreflight({
    ...validSkuStageData,
    tailImageTemplateId: "tail-template-1",
    imageAssets: {
      ...validSkuStageData.imageAssets,
      tail: [{ assetId: "asset-tail", originalName: "tail.jpg" }],
    },
  });

  assert.deepEqual(preflight.images.blockers, []);
  assert.deepEqual(
    preflight.images.uploads.map((item) => [
      item.localId,
      item.targetLevel,
      item.imageType,
      item.imageSort,
      item.source,
    ]),
    [
      ["asset-main", "skc", 1, 1, "product"],
      ["asset-detail", "skc", 2, 2, "product"],
      ["asset-tail", "skc", 2, 3, "tail-template"],
    ],
  );
  assert.equal(JSON.stringify(preflight.images).includes("image_url"), false);
});

test("rebuilds default-language content instead of trusting the saved preview", () => {
  const preflight = buildProductContentDraftPreflight({
    ...validSkuStageData,
    contentPreview: {
      multiLanguageNameList: [{ language: "en", name: "forged" }],
    },
  });

  assert.deepEqual(preflight.content.blockers, []);
  assert.deepEqual(
    preflight.content.publishPreview.multi_language_name_list,
    [{ language: "zh-cn", name: "现代装饰地毯" }],
  );
  assert.deepEqual(
    preflight.content.publishPreview.multi_language_desc_list,
    [{ language: "zh-cn", name: "短绒防滑地毯" }],
  );
});

test("fails content preflight without a timestamped default-language snapshot", () => {
  const preflight = buildProductContentDraftPreflight({
    ...validSkuStageData,
    publishStandardSnapshot: {},
  });
  assert.equal(
    preflight.content.blockers[0].code,
    "CONTENT_STANDARD_SNAPSHOT_MISSING",
  );
});

test("plans type-7 site detail uploads only when the dynamic field allows them", () => {
  const allowed = buildProductImageDraftPreflight({
    ...validSkuStageData,
    imageAssets: {
      ...validSkuStageData.imageAssets,
      description: [{
        assetId: "asset-description",
        originalName: "description.jpg",
      }],
    },
  });
  const upload = allowed.images.uploads.find(
    (item) => item.localId === "asset-description",
  );
  assert.deepEqual(
    [upload.targetLevel, upload.imageType, upload.imageSort],
    ["site-detail", 7, 1],
  );

  const forbidden = buildProductImageDraftPreflight({
    ...validSkuStageData,
    imageAssets: {
      ...validSkuStageData.imageAssets,
      description: [{ assetId: "asset-description" }],
    },
    publishStandardSnapshot: {
      ...validSkuStageData.publishStandardSnapshot,
      fillInStandard: [{
        field_key: "product_detail_picture",
        show: false,
        required: false,
      }],
    },
  });
  assert.equal(
    forbidden.images.blockers.some(
      (item) => item.code === "SITE_DETAIL_IMAGES_NOT_ALLOWED",
    ),
    true,
  );
});

test("blocks missing main images and forged tail-template placement", () => {
  const missingMain = buildProductImageDraftPreflight({
    ...validSkuStageData,
    imageAssets: { main: [], detail: [], tail: [] },
  });
  assert.deepEqual(
    missingMain.images.blockers.map((item) => item.code),
    ["PRODUCT_MAIN_IMAGE_REQUIRED", "PRODUCT_DETAIL_IMAGE_REQUIRED"],
  );

  const forgedTail = buildProductImageDraftPreflight({
    ...validSkuStageData,
    tailImageTemplateId: "tail-template-1",
    tailImagePlacement: "replace",
    imageAssets: {
      ...validSkuStageData.imageAssets,
      tail: [{ assetId: "asset-tail", originalName: "tail.jpg" }],
    },
  });
  assert.equal(
    forgedTail.images.blockers.some(
      (item) => item.code === "TAIL_IMAGE_TEMPLATE_INVALID",
    ),
    true,
  );
});

test("rejects forged SKU price, inventory and required weight", () => {
  const preflight = buildSkuDraftPreflight({
    ...validSkuStageData,
    publishStandardSnapshot: {
      ...validSkuStageData.publishStandardSnapshot,
      weightRequired: false,
    },
    skuRows: [{
      ...validSkuStageData.skuRows[0],
      costPrice: "2.401",
      inventoryNum: -1,
      weightGrams: "",
    }],
  });

  assert.deepEqual(
    preflight.sku.blockers.map((item) => item.code),
    [
      "SKU_COST_PRICE_INVALID",
      "SKU_INVENTORY_INVALID",
      "SKU_WEIGHT_INVALID",
    ],
  );
});

test("does not use incomplete product attributes to classify an SKC report", async () => {
  let received;
  const service = new WebProductDraftService({
    repository: {
      async save(input) {
        received = input;
        return {
          id: "draft-1",
          store_id: "store-1",
          name: input.name,
          category_id: input.categoryId,
          product_type_id: input.productTypeId,
          draft_data: input.data,
          preflight: input.preflight,
          status: input.status,
          updated_at: "2026-08-05T00:00:00.000Z",
        };
      },
    },
  });

  await service.save({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    input: {
      name: "缺尺寸属性草稿",
      categoryId: "3155",
      productTypeId: "991",
      data: {
        attributeSchemaSnapshot: {
          fetchedAt: "2026-08-05T00:00:00.000Z",
          fields: [{
            id: "length",
            name: "长度 (cm)",
            typeCode: 4,
            dataDimension: 1,
            values: [],
          }],
        },
        attributeValues: {},
        rugReportSources: {
          dimensions: [
            { attributeId: "length", unit: "cm" },
            { attributeId: "length", unit: "cm" },
          ],
        },
      },
      preflight: {},
      status: "ready",
    },
  });

  assert.equal(received.status, "blocked");
  assert.equal(received.preflight.rugReport.reportType, null);
  assert.deepEqual(received.preflight.rugReport.blockers, []);
  assert.equal(received.preflight.rugReport.source, "shein_compliance_requirement");
});

test("waits for SHEIN even when no attribute snapshot exists", async () => {
  let received;
  const service = new WebProductDraftService({
    repository: {
      async save(input) {
        received = input;
        return {
          id: "draft-1",
          store_id: "store-1",
          name: input.name,
          category_id: input.categoryId,
          product_type_id: input.productTypeId,
          draft_data: input.data,
          preflight: input.preflight,
          status: input.status,
          updated_at: "2026-08-05T00:00:00.000Z",
        };
      },
    },
  });

  await service.save({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    input: {
      name: "无属性快照草稿",
      data: {
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
      },
      preflight: {},
      status: "ready",
    },
  });

  assert.equal(received.status, "blocked");
  assert.deepEqual(received.preflight.rugReport.blockers, []);
  assert.equal(received.preflight.rugReport.source, "shein_compliance_requirement");
});
