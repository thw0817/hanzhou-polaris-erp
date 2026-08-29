import assert from "node:assert/strict";
import test from "node:test";
import {
  buildComplianceTemplateCatalog,
  complianceTemplatePaths,
  validateComplianceTemplateDraft,
} from "./compliance-template-contract.js";

const records = [
  {
    requirementType: "certificate",
    requirementKey: "SmallCarpet1630",
    required: true,
    status: "待补充",
    data: {
      certificateTypeId: 1630,
      certificateTypeCode: "SmallCarpet1630",
      certificateTypeName: "小地毯 1630 检测报告",
      complianceGroupCode: "ZSZZL",
      isRequired: 1,
      siteList: ["SHEIN欧盟站"],
    },
  },
  {
    requirementType: "certificate",
    requirementKey: "OEKO",
    required: false,
    status: "未审核",
    data: {
      certificateTypeId: 77,
      certificateTypeCode: "OEKO",
      certificateTypeName: "OEKO-TEX",
      complianceGroupCode: "ZSZZL",
      isRequired: 0,
    },
  },
  {
    requirementType: "agency",
    requirementKey: "EuRespPerson",
    required: true,
    status: "待补充",
    data: {
      certificateTypeId: 501,
      certificateTypeCode: "EuRespPerson",
      certificateTypeName: "欧盟责任人",
      complianceGroupCode: "GSL",
      isRequired: 1,
    },
  },
  {
    requirementType: "warning",
    requirementKey: "RugWarning",
    required: false,
    status: "未审核",
    data: {
      certificateTypeId: 601,
      certificateTypeCode: "RugWarning",
      certificateTypeName: "地毯警示语",
      complianceGroupCode: "HGXXL",
      isManualProductWarning: true,
      isRequired: 0,
    },
  },
  {
    requirementType: "package_photo",
    requirementKey: "11",
    required: true,
    status: "待提交",
    data: {
      labelId: 11,
      labelName: "EU responsible person (EU|REP or EC|REP)",
      labelGroup: "2",
      isRequired: 1,
      siteList: ["SHEIN德国站"],
    },
  },
  {
    requirementType: "body_photo",
    requirementKey: "8",
    required: false,
    status: "待提交",
    data: {
      labelId: 8,
      labelName: "Manufacturer",
      labelGroup: "1",
      isRequired: 0,
    },
  },
  {
    requirementType: "unsupported",
    requirementKey: "ProductIdenti",
    required: false,
    status: "规则确认中",
    data: {
      certificateTypeId: 844,
      certificateTypeCode: "ProductIdenti",
      certificateTypeName: "产品标识符",
      complianceGroupCode: "HGXXL",
      isRequired: 10,
    },
  },
];

test("builds encoded compliance template paths", () => {
  assert.deepEqual(
    complianceTemplatePaths("store / 1", "template / 1"),
    {
      templates:
        "/v1/web/stores/store%20%2F%201/publish-templates?type=compliance",
      template:
        "/v1/web/stores/store%20%2F%201/publish-templates/template%20%2F%201",
    },
  );
});

test("compliance catalog keeps every official requirement and three required states", () => {
  const catalog = buildComplianceTemplateCatalog(records);

  assert.equal(catalog.length, records.length);
  assert.deepEqual(
    catalog.map((item) => [item.key, item.isRequired, item.reusable]),
    [
      ["SmallCarpet1630", 1, true],
      ["OEKO", 0, false],
      ["EuRespPerson", 1, false],
      ["RugWarning", 0, false],
      ["11", 1, true],
      ["8", 0, true],
      ["ProductIdenti", 10, false],
    ],
  );
  assert.deepEqual(catalog[0].siteList, ["SHEIN欧盟站"]);
  assert.deepEqual(catalog[4].siteList, ["SHEIN德国站"]);
});

test("combined compliance plans keep reusable photos while reports use their own template center", () => {
  const result = validateComplianceTemplateDraft({
    name: "  地毯店铺合规  ",
    referenceSkc: "  SKC-001  ",
    categoryId: "3155",
    categoryName: "装饰地毯",
    ruleFetchedAt: "2026-08-05T00:00:00.000Z",
    ruleExpiresAt: "2026-08-06T00:00:00.000Z",
    catalog: buildComplianceTemplateCatalog(records.filter(
      (record) => record.data.isRequired !== 10,
    )),
    defaults: {
      certificates: [
        {
          certificateTypeId: 1630,
          certificateTypeCode: "SmallCarpet1630",
          certificateTypeName: "小地毯 1630 检测报告",
          files: [{
            localAssetRef: "media:report-1",
            fileName: "1630.pdf",
            mimeType: "application/pdf",
            size: 1024,
            dataUrl: "data:application/pdf;base64,not-allowed",
          }],
          fieldValues: {},
        },
        {
          certificateTypeId: 77,
          certificateTypeCode: "OEKO",
          poolSn: "POOL-1",
          files: [],
          fieldValues: {},
        },
      ],
      agencies: [{
        certificateTypeId: 501,
        certificateTypeCode: "EuRespPerson",
        agencyId: "agency-1",
      }],
      warnings: [{
        certificateTypeId: 601,
        certificateTypeCode: "RugWarning",
        selectedByField: { Material: ["10"] },
      }],
      photos: [
        {
          labelId: 11,
          labelGroup: "2",
          localAssetRef: "media:asset-1",
          fileName: "eu-rep.jpg",
          mimeType: "image/jpeg",
          size: 1000,
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
  });

  assert.equal(result.valid, true);
  assert.equal(result.data.name, "地毯店铺合规");
  assert.equal(result.data.referenceSkc, undefined);
  assert.deepEqual(
    result.data.defaults.certificates.map((item) => item.certificateTypeCode),
    [],
  );
  assert.deepEqual(
    result.data.defaults.photos.map((item) => item.labelGroup),
    ["2", "1"],
  );
  assert.deepEqual(result.data.defaults.agencies, []);
  assert.deepEqual(result.data.defaults.warnings, []);
  assert.equal("base64" in result.data.defaults.photos[0], false);
});

test("store-wide compliance templates only require reusable photos", () => {
  const result = validateComplianceTemplateDraft({
    name: "地毯店铺合规",
    referenceSkc: "SKC-001",
    ruleFetchedAt: "2026-08-05T00:00:00.000Z",
    catalog: buildComplianceTemplateCatalog(records),
    defaults: {},
  });

  assert.equal(result.valid, false);
  assert.equal(result.errors.rules, undefined);
  assert.deepEqual(result.errors.requirements, [
    "至少上传一张通用实拍图",
  ]);
});

test("combined plans do not retain report files or SKC-specific report fields", () => {
  const catalog = buildComplianceTemplateCatalog(records.filter(
    (record) => record.requirementKey === "SmallCarpet1630",
  ));
  const base = {
    name: "地毯店铺合规",
    referenceSkc: "SKC-001",
    ruleFetchedAt: "2026-08-05T00:00:00.000Z",
    catalog,
    defaults: {
      certificates: [{
        certificateTypeId: 1630,
        certificateTypeCode: "SmallCarpet1630",
        certificateTypeName: "小地毯 1630 检测报告",
        files: [{
          localAssetRef: "media:report-1",
          fileName: "1630.pdf",
          mimeType: "application/pdf",
          size: 1024,
        }],
        fieldValues: {},
      }],
      photos: [{ labelGroup: "2", localAssetRef: "media:package-1" }],
    },
    reportRules: [{
      key: "1630",
      certificateTypeId: 1630,
      certificateTypeCode: "SmallCarpet1630",
      fields: [{
        id: "length",
        name: "最长边",
        inputType: 3,
        required: true,
        sourceFrom: "",
      }, {
        id: "report-date",
        name: "报告日期",
        inputType: 4,
        required: false,
        sourceFrom: "",
      }],
    }],
  };

  const missing = validateComplianceTemplateDraft(base);
  assert.equal(missing.valid, true);
  assert.deepEqual(missing.data.defaults.certificates, []);

  const complete = validateComplianceTemplateDraft({
    ...base,
    defaults: {
      certificates: [{
        ...base.defaults.certificates[0],
        fieldValues: {
          length: { value: "180" },
          "report-date": { value: "2026-08-21" },
        },
      }],
      photos: [{ labelGroup: "2", localAssetRef: "media:package-1" }],
    },
  });
  assert.equal(complete.valid, true);
  assert.deepEqual(complete.data.defaults.certificates, []);
});

test("compliance templates keep up to two package photos but only one body photo", () => {
  const result = validateComplianceTemplateDraft({
    name: "包装实拍图模板",
    referenceSkc: "SKC-001",
    ruleFetchedAt: "2026-08-05T00:00:00.000Z",
    catalog: buildComplianceTemplateCatalog(records.filter(
      (record) => record.requirementKey !== "ProductIdenti",
    )),
    defaults: {
      photos: [
        { labelGroup: "2", localAssetRef: "media:package-1", fileName: "package-1.jpg" },
        { labelGroup: "2", localAssetRef: "media:package-2", fileName: "package-2.jpg" },
        { labelGroup: "2", localAssetRef: "media:package-3", fileName: "package-3.jpg" },
        { labelGroup: "1", localAssetRef: "media:body-1", fileName: "body-1.jpg" },
        { labelGroup: "1", localAssetRef: "media:body-2", fileName: "body-2.jpg" },
      ],
    },
  });

  assert.equal(result.valid, true);
  assert.deepEqual(
    result.data.defaults.photos.map((photo) => photo.localAssetRef),
    ["media:package-1", "media:package-2", "media:body-1"],
  );
});

test("photo-only compliance templates can save without a reference SKC", () => {
  const result = validateComplianceTemplateDraft({
    name: "店铺通用包装实拍图",
    referenceSkc: "",
    defaults: {
      photos: [{
        labelGroup: "2",
        localAssetRef: "media:package-1",
        fileName: "package-1.jpg",
      }],
    },
  });

  assert.equal(result.valid, true);
  assert.equal(result.data.referenceSkc, undefined);
  assert.equal(result.errors.referenceSkc, undefined);
});

test("empty compliance templates still require a reusable photo", () => {
  const result = validateComplianceTemplateDraft({
    name: "空方案",
    referenceSkc: "",
    defaults: {},
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.errors.requirements, ["至少上传一张通用实拍图"]);
});
