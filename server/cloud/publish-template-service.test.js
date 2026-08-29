import assert from "node:assert/strict";
import test from "node:test";
import {
  PostgresPublishTemplateRepository,
  WebPublishTemplateService,
} from "./publish-template-service.js";

function createRepository() {
  const rows = [];
  return {
    rows,
    async list({ tenantId, storeId, userId, templateType }) {
      return rows.filter(
        (row) =>
          row.tenant_id === tenantId &&
          (
            row.scope === "tenant" ||
            (row.scope === "user" && row.owner_user_id === userId) ||
            (row.scope === "store" && row.store_id === storeId)
          ) &&
          (!templateType || row.template_type === templateType),
      );
    },
    async save(input) {
      const existing = rows.find((row) => row.id === input.id);
      const row = {
        id: input.id || `template-${rows.length + 1}`,
        tenant_id: input.tenantId,
        store_id: input.storeId,
        template_type: input.templateType,
        name: input.name,
        category_id: input.categoryId,
        product_type_id: input.productTypeId,
        schema_fingerprint: input.schemaFingerprint,
        template_data: input.data,
        scope: input.scope,
        owner_user_id: input.userId,
        created_by: existing?.created_by || input.userId,
        version: existing ? existing.version + 1 : 1,
        created_at: existing?.created_at || "2026-08-02T00:00:00.000Z",
        updated_at: "2026-08-02T00:00:00.000Z",
      };
      if (existing) Object.assign(existing, row);
      else rows.push(row);
      return row;
    },
    async remove({ tenantId, storeId, userId, canManageTenantTemplates, id }) {
      const index = rows.findIndex(
        (row) => row.id === id && row.tenant_id === tenantId && (
          (row.scope === "tenant" && canManageTenantTemplates) ||
          (row.scope === "user" && row.owner_user_id === userId) ||
          (row.scope === "store" && row.store_id === storeId &&
            (row.created_by === userId || canManageTenantTemplates))
        ),
      );
      if (index < 0) return false;
      rows.splice(index, 1);
      return true;
    },
  };
}

const context = { tenantId: "tenant-1", userId: "user-1", role: "operator" };

test("postgres template insert binds scope and management parameters in order", async () => {
  let query;
  const repository = new PostgresPublishTemplateRepository({
    pool: {
      async query(input) {
        query = input;
        return { rows: [{ id: "template-1" }] };
      },
    },
  });
  await repository.save({
    id: null,
    tenantId: "tenant-1",
    storeId: "store-1",
    templateType: "size",
    name: "常用尺寸",
    categoryId: "cat-1",
    productTypeId: "type-1",
    schemaFingerprint: "fingerprint",
    data: { rows: [] },
    userId: "user-1",
    scope: "user",
    canManageTenantTemplates: false,
  });
  assert.equal(query.values.length, 12);
  assert.deepEqual(query.values.slice(1, 5), [
    "tenant-1",
    "store-1",
    "size",
    "常用尺寸",
  ]);
  assert.deepEqual(query.values.slice(9), ["user", "user-1", false]);
});

test("saves and deletes an API-bound attribute template", async () => {
  const repository = createRepository();
  const service = new WebPublishTemplateService({ repository });
  const saved = await service.save({
    context,
    storeId: "store-1",
    input: {
      templateType: "attribute",
      name: "地毯商品属性",
      categoryId: "cat-1",
      productTypeId: "type-1",
      schemaSnapshot: {
        fields: [{
          id: 10,
          name: "材质",
          required: true,
          typeCode: 4,
          dataDimension: 1,
          modeCode: 3,
          maxSelections: 1,
          values: [{ id: 20, label: "聚酯纤维" }],
        }, {
          id: 30,
          name: "长度 (cm)",
          required: true,
          typeCode: 4,
          dataDimension: 1,
          modeCode: 0,
          values: [],
        }, {
          id: 31,
          name: "宽度 (cm)",
          required: true,
          typeCode: 4,
          dataDimension: 1,
          modeCode: 0,
          values: [],
        }],
      },
      data: {
        schemaFetchedAt: "2026-08-02T00:00:00.000Z",
        assignments: [
          { attributeId: "10", valueIds: ["20"] },
          { attributeId: "30", customValue: "180" },
          { attributeId: "31", customValue: "120" },
        ],
        rugReportSources: {
          dimensions: [
            { attributeId: "30", unit: "cm" },
            { attributeId: "31", unit: "cm" },
          ],
        },
      },
    },
  });
  assert.equal(saved.template.templateType, "attribute");
  assert.equal(saved.template.schemaFingerprint.length, 64);
  assert.deepEqual(saved.template.data.rugReportSources, {
    dimensions: [
      { attributeId: "30", unit: "cm" },
      { attributeId: "31", unit: "cm" },
    ],
  });
  assert.equal((await service.list({ context, storeId: "store-1" })).count, 1);
  await service.remove({ context, storeId: "store-1", id: saved.template.id });
  assert.equal((await service.list({ context, storeId: "store-1" })).count, 0);
});

test("saves a local-only title rule template without inventing SHEIN fields", async () => {
  const service = new WebPublishTemplateService({ repository: createRepository() });
  const result = await service.save({
    context,
    storeId: "store-1",
    input: {
      templateType: "title_rule",
      name: "现代地毯标题",
      data: {
        fullTitle: "",
        prefix: "现代",
        keywords: "防滑 可机洗",
        suffix: "客厅卧室适用",
        ignored: "must-not-survive",
      },
    },
  });

  assert.equal(result.template.templateType, "title_rule");
  assert.deepEqual(result.template.data, {
    fullTitle: "",
    prefix: "现代",
    keywords: "防滑 可机洗",
    suffix: "客厅卧室适用",
  });
  assert.equal(result.template.categoryId, "");
  assert.equal(result.template.productTypeId, "");
});

test("rejects an empty title rule template", async () => {
  const service = new WebPublishTemplateService({ repository: createRepository() });
  await assert.rejects(
    service.save({
      context,
      storeId: "store-1",
      input: {
        templateType: "title_rule",
        name: "空标题规则",
        data: {},
      },
    }),
    (error) => error.code === "INVALID_TITLE_RULE_TEMPLATE",
  );
});

test("saves a commercial template without retail price fields", async () => {
  const service = new WebPublishTemplateService({ repository: createRepository() });
  const result = await service.save({
    context,
    storeId: "store-1",
    input: {
      templateType: "commercial",
      name: "短绒地毯计价",
      data: {
        pricePerSquareMeter: 25.5,
        gramsPerSquareMeter: 850,
        retailPrice: 99,
      },
    },
  });

  assert.equal(result.template.templateType, "commercial");
  assert.deepEqual(result.template.data, {
    pricePerSquareMeter: 25.5,
    gramsPerSquareMeter: 850,
  });
});

test("commercial templates reject invalid unit price and grams", async () => {
  const service = new WebPublishTemplateService({ repository: createRepository() });
  await assert.rejects(
    service.save({
      context,
      storeId: "store-1",
      input: {
        templateType: "commercial",
        name: "错误计价",
        data: { pricePerSquareMeter: 0, gramsPerSquareMeter: -1 },
      },
    }),
    (error) => error.code === "INVALID_COMMERCIAL_TEMPLATE",
  );
});

test("saves reusable automatic publish settings without a scheduled date", async () => {
  const service = new WebPublishTemplateService({ repository: createRepository() });
  const result = await service.save({
    context,
    storeId: "store-1",
    input: {
      templateType: "publish_settings",
      name: "全托管自动上架",
      data: {
        mallState: "1",
        stopPurchase: "1",
        shelfRequire: "0",
        shelfWay: "1",
        hopeOnSaleDate: "2026-09-01T10:00",
        ignored: true,
      },
    },
  });

  assert.equal(result.template.templateType, "publish_settings");
  assert.deepEqual(result.template.data, {
    mallState: "1",
    stopPurchase: "1",
    shelfRequire: "0",
    shelfWay: "1",
  });
});

test("publish settings templates reject scheduled publication", async () => {
  const service = new WebPublishTemplateService({ repository: createRepository() });
  await assert.rejects(
    service.save({
      context,
      storeId: "store-1",
      input: {
        templateType: "publish_settings",
        name: "定时上架",
        data: {
          mallState: "1",
          stopPurchase: "1",
          shelfRequire: "0",
          shelfWay: "2",
        },
      },
    }),
    (error) => error.code === "INVALID_PUBLISH_SETTINGS_TEMPLATE",
  );
});

test("attribute templates reject rug report mappings outside the current product schema", async () => {
  const service = new WebPublishTemplateService({ repository: createRepository() });
  await assert.rejects(
    service.save({
      context,
      storeId: "store-1",
      input: {
        templateType: "attribute",
        name: "错误尺寸映射",
        categoryId: "cat-1",
        productTypeId: "type-1",
        schemaSnapshot: {
          fields: [{
            id: 10,
            name: "材质",
            required: true,
            typeCode: 4,
            dataDimension: 1,
            modeCode: 3,
            values: [{ id: 20, label: "聚酯纤维" }],
          }],
        },
        data: {
          schemaFetchedAt: "2026-08-02T00:00:00.000Z",
          assignments: [{ attributeId: "10", valueIds: ["20"] }],
          rugReportSources: {
            dimensions: [
              { attributeId: "999", unit: "cm" },
              { attributeId: "10", unit: "cm" },
            ],
          },
        },
      },
    }),
    /判定属性不在当前SHEIN商品属性/,
  );
});

test("attribute templates preserve validated SHEIN yes/no threshold report mappings", async () => {
  const service = new WebPublishTemplateService({ repository: createRepository() });
  const saved = await service.save({
    context,
    storeId: "store-1",
    input: {
      templateType: "attribute",
      name: "装饰地毯阈值判定",
      categoryId: "3155",
      productTypeId: "991",
      schemaSnapshot: {
        fields: [
          {
            id: "1001889",
            name: "是否面积大于2.16m²",
            required: true,
            typeCode: 4,
            dataDimension: 1,
            modeCode: 3,
            values: [{ id: "459", label: "否" }, { id: "763", label: "是" }],
          },
          {
            id: "1001890",
            name: "是否最长边大于1.8m",
            required: true,
            typeCode: 4,
            dataDimension: 1,
            modeCode: 3,
            values: [{ id: "459", label: "否" }, { id: "763", label: "是" }],
          },
        ],
      },
      data: {
        schemaFetchedAt: "2026-08-21T00:00:00.000Z",
        assignments: [
          { attributeId: "1001889", valueIds: ["459"] },
          { attributeId: "1001890", valueIds: ["459"] },
        ],
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
      },
    },
  });

  assert.deepEqual(saved.template.data.rugReportSources, {
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
  });
});

test("attribute templates reject values that are absent from the current API schema", async () => {
  const service = new WebPublishTemplateService({ repository: createRepository() });
  await assert.rejects(
    service.save({
      context,
      storeId: "store-1",
      input: {
        templateType: "attribute",
        name: "过期属性模板",
        categoryId: "cat-1",
        productTypeId: "type-1",
        schemaSnapshot: {
          fields: [{
            id: 10,
            name: "材质",
            required: true,
            typeCode: 4,
            modeCode: 3,
            values: [{ id: 20, label: "聚酯纤维" }],
          }],
        },
        data: {
          schemaFetchedAt: "2026-08-02T00:00:00.000Z",
          assignments: [{ attributeId: "10", valueIds: ["999"] }],
        },
      },
    }),
    /未返回的选项/,
  );
});

test("packaging templates keep the last duplicate material size", async () => {
  const service = new WebPublishTemplateService({ repository: createRepository() });
  const result = await service.save({
      context,
      storeId: "store-1",
      input: {
        templateType: "packaging",
        name: "标准打包体积",
        data: {
          materials: {
            天鹅绒: [
              { widthCm: 40, lengthCm: 60, packageLengthCm: 42, packageWidthCm: 10, packageHeightCm: 10 },
              { widthCm: 60, lengthCm: 40, packageLengthCm: 42, packageWidthCm: 10, packageHeightCm: 10 },
            ],
          },
        },
      },
    });
  assert.equal(result.template.data.materials["天鹅绒"].length, 1);
  assert.equal(result.template.data.materials["天鹅绒"][0].widthCm, 60);
  assert.equal(result.template.data.overwrittenCount, 1);
});

test("size templates contain only color, size, length and width", async () => {
  const service = new WebPublishTemplateService({ repository: createRepository() });
  const result = await service.save({
    context,
    storeId: "store-1",
    input: {
      templateType: "size",
      name: "常用尺寸",
      data: {
        colorText: "多色",
        rows: [{
          sizeText: "40x60",
          lengthCm: 60,
          widthCm: 40,
          costPrice: 999,
          shape: "round",
        }],
      },
    },
  });
  assert.equal(result.template.categoryId, "");
  assert.equal(result.template.data.colorText, "多色");
  assert.equal(result.template.data.matchingPolicy, "match_current_shein_schema_on_publish");
  assert.deepEqual(Object.keys(result.template.data.rows[0]), [
    "sizeText",
    "lengthCm",
    "widthCm",
  ]);
});

test("size templates require one shared color and a custom size label", async () => {
  const service = new WebPublishTemplateService({ repository: createRepository() });
  await assert.rejects(
    service.save({
      context,
      storeId: "store-1",
      input: {
        templateType: "size",
        name: "缺色尺寸",
        data: { rows: [{ sizeText: "", lengthCm: 60, widthCm: 40 }] },
      },
    }),
    /共用颜色/,
  );
});

test("administrator templates are visible to every tenant user and store", async () => {
  const repository = createRepository();
  const service = new WebPublishTemplateService({ repository });
  const saved = await service.save({
    context: { tenantId: "tenant-1", userId: "admin-1", role: "admin" },
    storeId: "store-1",
    input: {
      templateType: "size",
      name: "管理员通用尺寸",
      data: {
        colorText: "多色",
        rows: [{ sizeText: "40*60", lengthCm: 60, widthCm: 40 }],
      },
    },
  });
  assert.equal(saved.template.scope, "tenant");
  assert.equal(saved.template.scopeLabel, "全员通用");

  const visible = await service.list({
    context: { tenantId: "tenant-1", userId: "user-2", role: "operator" },
    storeId: "store-9",
  });
  assert.equal(visible.count, 1);
  assert.equal(visible.templates[0].canManage, false);
});

test("member templates follow the member across stores without leaking to other users", async () => {
  const repository = createRepository();
  const service = new WebPublishTemplateService({ repository });
  const saved = await service.save({
    context,
    storeId: "store-1",
    input: {
      templateType: "size",
      name: "我的通用尺寸",
      data: {
        colorText: "米白色",
        rows: [{ sizeText: "直径140", lengthCm: 140, widthCm: 140 }],
      },
    },
  });
  assert.equal(saved.template.scope, "user");
  assert.equal((await service.list({ context, storeId: "store-2" })).count, 1);
  assert.equal((await service.list({
    context: { tenantId: "tenant-1", userId: "user-2", role: "operator" },
    storeId: "store-2",
  })).count, 0);
});

test("compliance templates remain isolated to their source store", async () => {
  const repository = createRepository();
  const service = new WebPublishTemplateService({ repository });
  const admin = { tenantId: "tenant-1", userId: "admin-1", role: "admin" };
  const saved = await service.save({
    context: admin,
    storeId: "store-1",
    input: {
      templateType: "compliance",
      name: "一店欧代",
      data: { agencyId: "agency-1" },
    },
  });
  assert.equal(saved.template.scope, "store");
  assert.equal((await service.list({ context: admin, storeId: "store-2" })).count, 0);
});

test("compliance templates preserve rug report sources and both reusable photo groups", async () => {
  const service = new WebPublishTemplateService({ repository: createRepository() });
  const result = await service.save({
    context,
    storeId: "store-1",
    input: {
      templateType: "compliance",
      name: "地毯店铺合规",
      categoryId: "3155",
      schemaSnapshot: {
        referenceSkc: "SKC-001",
        fetchedAt: "2026-08-05T00:00:00.000Z",
        requirements: [{ key: "EuRespPerson", isRequired: 1 }],
      },
      data: {
        referenceSkc: "SKC-001",
        categoryName: "装饰地毯",
        ruleFetchedAt: "2026-08-05T00:00:00.000Z",
        ruleExpiresAt: "2026-08-06T00:00:00.000Z",
        requirements: [
          {
            key: "SmallCarpet1630",
            type: "certificate",
            name: "小地毯 1630 检测报告",
            certificateTypeCode: "SmallCarpet1630",
            isRequired: 1,
            reusable: true,
          },
          {
            key: "OEKO",
            type: "certificate",
            name: "OEKO-TEX",
            certificateTypeCode: "OEKO",
            isRequired: 0,
            reusable: false,
          },
          {
            key: "EuRespPerson",
            type: "agency",
            name: "欧盟责任人",
            certificateTypeCode: "EuRespPerson",
            isRequired: 1,
            reusable: false,
          },
          {
            key: "11",
            type: "package_photo",
            name: "EU responsible person",
            labelId: "11",
            labelGroup: "2",
            isRequired: 1,
            reusable: true,
          },
          {
            key: "8",
            type: "body_photo",
            name: "Manufacturer",
            labelId: "8",
            labelGroup: "1",
            isRequired: 0,
            reusable: true,
          },
          {
            key: "ProductIdenti",
            type: "unsupported",
            name: "产品标识符",
            certificateTypeCode: "ProductIdenti",
            isRequired: 10,
            reusable: false,
          },
        ],
        defaults: {
          certificates: [
            {
              certificateTypeCode: "SmallCarpet1630",
              certificateTypeName: "小地毯 1630 检测报告",
              files: [{
                localAssetRef: "media:report-1",
                fileName: "1630.pdf",
                mimeType: "application/pdf",
                size: 1234,
                dataUrl: "data:application/pdf;base64,not-allowed",
              }],
              fieldValues: {},
            },
            {
              certificateTypeCode: "OEKO",
              poolSn: "POOL-1",
              fieldValues: {},
            },
          ],
          agencies: [{
            certificateTypeCode: "EuRespPerson",
            agencyId: "agency-1",
            secret: "not-allowed",
          }],
          warnings: [],
          photos: [
            {
              labelId: 11,
              labelGroup: "2",
              localAssetRef: "media:asset-1",
              fileName: "eu-rep.jpg",
              mimeType: "image/jpeg",
              size: 1234,
              templateReusable: true,
              base64: "not-allowed",
            },
            {
              labelId: 8,
              labelGroup: "1",
              localAssetRef: "media:asset-2",
              fileName: "body.jpg",
              templateReusable: true,
            },
          ],
        },
      },
    },
  });

  assert.equal(result.template.scope, "store");
  assert.equal(result.template.categoryId, undefined);
  assert.equal(result.template.data.referenceSkc, undefined);
  assert.equal(result.template.data.ruleFetchedAt, undefined);
  assert.equal(result.template.data.storeScoped, true);
  assert.equal(result.template.data.revalidateOnUse, true);
  assert.deepEqual(
    result.template.data.requirements.map((item) => item.isRequired),
    [1, 0, 1, 1, 0, 10],
  );
  assert.deepEqual(
    result.template.data.defaults.certificates.map((item) => item.certificateTypeCode),
    ["SmallCarpet1630"],
  );
  assert.deepEqual(
    result.template.data.defaults.photos.map((item) => item.labelGroup),
    ["2", "1"],
  );
  assert.deepEqual(result.template.data.defaults.agencies, []);
  assert.deepEqual(result.template.data.defaults.warnings, []);
  assert.equal("dataUrl" in result.template.data.defaults.certificates[0].files[0], false);
  assert.equal("base64" in result.template.data.defaults.photos[0], false);
});

test("saves an independent 1630 or 1631 report template without a reference SKC", async () => {
  const service = new WebPublishTemplateService({ repository: createRepository() });
  const result = await service.save({
    context,
    storeId: "store-1",
    input: {
      templateType: "compliance",
      name: "地毯1631报告-2026版",
      data: {
        templateKind: "rug_report",
        reportType: "1631",
        reportDate: "2026-08-21",
        reportFile: {
          localAssetRef: "media:11111111-1111-4111-8111-111111111111",
          fileName: "1631.pdf",
          mimeType: "application/pdf",
          size: 2048,
        },
      },
    },
  });

  assert.equal(result.template.categoryId, undefined);
  assert.equal(result.template.data.templateKind, "rug_report");
  assert.equal(result.template.data.reportType, "1631");
  assert.equal(result.template.data.reportDate, "2026-08-21");
  assert.equal(
    result.template.data.defaults.certificates[0].certificateTypeId,
    null,
  );
  assert.equal(
    result.template.data.defaults.certificates[0].fieldValues &&
      Object.keys(result.template.data.defaults.certificates[0].fieldValues).length,
    0,
  );
});

test("rejects a report template without a valid type, date or protected file", async () => {
  const service = new WebPublishTemplateService({ repository: createRepository() });
  await assert.rejects(
    service.save({
      context,
      storeId: "store-1",
      input: {
        templateType: "compliance",
        name: "无效报告",
        data: {
          templateKind: "rug_report",
          reportType: "1632",
          reportDate: "",
          reportFile: { localAssetRef: "https://example.com/report.pdf" },
        },
      },
    }),
    (error) => error.code === "INVALID_RUG_REPORT_TYPE",
  );
});

test("visible global image templates authorize only their referenced media", async () => {
  const repository = createRepository();
  const service = new WebPublishTemplateService({ repository });
  const admin = { tenantId: "tenant-1", userId: "admin-1", role: "admin" };
  const assetId = "11111111-1111-4111-8111-111111111111";
  const saved = await service.save({
    context: admin,
    storeId: "store-1",
    input: {
      templateType: "tail_image",
      name: "全员尾图",
      data: { assetIds: [assetId] },
    },
  });
  const visible = await service.resolveVisibleMedia({
    context: { tenantId: "tenant-1", userId: "user-2", role: "operator" },
    storeId: "store-9",
    id: saved.template.id,
    assetId,
  });
  assert.equal(visible.originStoreId, "store-1");
  await assert.rejects(
    service.resolveVisibleMedia({
      context: { tenantId: "tenant-1", userId: "user-2", role: "operator" },
      storeId: "store-9",
      id: saved.template.id,
      assetId: "22222222-2222-4222-8222-222222222222",
    }),
    /不属于当前账号可见/,
  );
});

test("tail image templates preserve order and remove embedded image payloads", async () => {
  const service = new WebPublishTemplateService({ repository: createRepository() });
  const result = await service.save({
    context: { tenantId: "tenant-1", userId: "admin-1", role: "admin" },
    storeId: "store-1",
    input: {
      templateType: "tail_image",
      name: "材质说明尾图",
      data: {
        placement: "replace",
        assetIds: ["asset-2", "asset-1"],
        dataUrl: "data:image/jpeg;base64,not-allowed",
        assets: [
          {
            id: "asset-2",
            storeId: "store-1",
            originalName: "care.jpg",
            contentType: "image/jpeg",
            width: 1340,
            height: 1785,
            base64: "not-allowed",
            crop: {
              mode: "cropped",
              presetId: "portrait",
              sourceWidth: 1600,
              sourceHeight: 2000,
              outputWidth: 1340,
              outputHeight: 1785,
              cropPixels: { x: 1, y: 2, width: 3, height: 4 },
            },
          },
          {
            id: "asset-1",
            storeId: "store-1",
            originalName: "backing.png",
            contentType: "image/png",
            width: 1200,
            height: 1200,
            crop: {
              mode: "original",
              presetId: "square",
              sourceWidth: 1200,
              sourceHeight: 1200,
              outputWidth: 1200,
              outputHeight: 1200,
            },
          },
        ],
      },
    },
  });

  assert.equal(result.template.data.placement, "append");
  assert.deepEqual(result.template.data.assetIds, ["asset-2", "asset-1"]);
  assert.deepEqual(
    result.template.data.assets.map((asset) => asset.id),
    ["asset-2", "asset-1"],
  );
  assert.equal(result.template.data.assets[0].crop.presetId, "portrait");
  assert.equal("cropPixels" in result.template.data.assets[0].crop, false);
  assert.equal("dataUrl" in result.template.data, false);
  assert.equal("base64" in result.template.data.assets[0], false);
});
