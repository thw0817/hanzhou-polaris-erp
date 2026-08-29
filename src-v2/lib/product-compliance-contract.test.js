import assert from "node:assert/strict";
import test from "node:test";
import { buildProductComplianceStage } from "./product-compliance-contract.js";

const template = {
  id: "compliance-template-1",
  categoryId: "3155",
  data: {
    storeScoped: true,
    revalidateOnUse: true,
    ruleFetchedAt: "2026-08-05T00:00:00.000Z",
    ruleExpiresAt: "2026-08-07T00:00:00.000Z",
    defaults: {
      certificates: [{
        certificateTypeCode: "RUG-1630",
        certificateTypeName: "1630报告",
        files: [{ localAssetRef: "media:report-asset" }],
      }],
      photos: [
        { labelGroup: "1", localAssetRef: "media:body-asset" },
        { labelGroup: "2", localAssetRef: "media:package-asset" },
      ],
    },
  },
};

const reportTemplate = {
  id: "rug-report-template-1",
  storeId: "store-1",
  data: {
    templateKind: "rug_report",
    reportType: "1630",
    reportDate: "2026-08-01",
    storeScoped: true,
    revalidateOnUse: true,
    defaults: {
      certificates: template.data.defaults.certificates,
      photos: [],
    },
  },
};

test("waits for the official per-SKC report requirement and keeps manual API gaps pending", () => {
  const result = buildProductComplianceStage({
    template,
    reportTemplate,
    categoryId: "3155",
    report: { reportType: "1630" },
    now: "2026-08-06T00:00:00.000Z",
  });

  assert.equal(result.valid, true);
  assert.equal(result.expectedReport, null);
  assert.deepEqual(result.assetIds, [
    "body-asset",
    "package-asset",
  ]);
  assert.equal(result.photos.body?.localAssetRef, "media:body-asset");
  assert.equal(result.photos.package?.localAssetRef, "media:package-asset");
  assert.deepEqual(result.manualQueue, ["gcc", "product_identifier"]);
  assert.equal(result.requiresSkcRevalidation, true);
});

test("keeps store-wide compliance templates independent from category and rule snapshots", () => {
  const result = buildProductComplianceStage({
    template: {
      ...template,
      categoryId: "",
      data: {
        ...template.data,
        ruleFetchedAt: "",
        ruleExpiresAt: "",
      },
    },
    reportTemplate: {
      ...reportTemplate,
      data: { ...reportTemplate.data, reportType: "1631" },
    },
    categoryId: "1954",
    report: { reportType: "1631" },
    now: "2026-08-08T00:00:00.000Z",
  });

  assert.deepEqual(
    result.blockers.map((item) => item.code),
    [],
  );
  assert.deepEqual(
    result.postPublishTasks.map((item) => item.code),
    ["WAITING_FOR_SHEIN_REPORT_REQUIREMENT"],
  );
});

test("keeps missing packaging photos as a post-publish advisory", () => {
  const result = buildProductComplianceStage({
    template: {
      ...template,
      data: {
        ...template.data,
        defaults: {
          certificates: template.data.defaults.certificates,
          photos: [{ labelGroup: "1", localAssetRef: "data:image/png;base64,abc" }],
        },
      },
    },
    reportTemplate,
    categoryId: "3155",
    report: { reportType: "1630" },
    now: "2026-08-06T00:00:00.000Z",
  });

  assert.deepEqual(
    result.advisories.map((item) => item.code),
    ["PACKAGE_PHOTO_MISSING"],
  );
  assert.equal(result.photos.body, null);
  assert.equal(result.photos.package, null);
  assert.equal(result.valid, true);
  assert.deepEqual(result.blockers, []);
});

test("does not require a compliance template for initial product publication", () => {
  const result = buildProductComplianceStage({ template: null, categoryId: "3155" });
  assert.equal(result.valid, true);
  assert.deepEqual(result.blockers, []);
  assert.deepEqual(result.advisories.map((item) => item.code), [
    "COMPLIANCE_TEMPLATE_NOT_SELECTED",
  ]);
});

test("retains both reusable packaging photos for the post-publish SHEIN bind", () => {
  const result = buildProductComplianceStage({
    template: {
      ...template,
      data: {
        ...template.data,
        defaults: {
          ...template.data.defaults,
          photos: [
            { labelGroup: "2", localAssetRef: "media:package-1" },
            { labelGroup: "2", localAssetRef: "media:package-2" },
          ],
        },
      },
    },
    reportTemplate,
    categoryId: "3155",
    report: { reportType: "1630" },
  });

  assert.deepEqual(result.photos.packageList.map((photo) => photo.localAssetRef), [
    "media:package-1",
    "media:package-2",
  ]);
  assert.deepEqual(result.assetIds, [
    "package-1",
    "package-2",
  ]);
});

test("manual compliance photo mode keeps multiple body and package photos and ignores the template photos", () => {
  const result = buildProductComplianceStage({
    template,
    photoSourceMode: "manual",
    manualPhotos: [
      { labelGroup: "1", localAssetRef: "media:manual-body-1" },
      { labelGroup: "1", localAssetRef: "media:manual-body-2" },
      { labelGroup: "2", localAssetRef: "media:manual-package-1" },
      { labelGroup: "2", localAssetRef: "media:manual-package-2" },
    ],
    categoryId: "3155",
  });

  assert.deepEqual(result.photos.bodyList.map((photo) => photo.localAssetRef), [
    "media:manual-body-1",
    "media:manual-body-2",
  ]);
  assert.deepEqual(result.photos.packageList.map((photo) => photo.localAssetRef), [
    "media:manual-package-1",
    "media:manual-package-2",
  ]);
  assert.deepEqual(result.assetIds, [
    "manual-body-1",
    "manual-body-2",
    "manual-package-1",
    "manual-package-2",
  ]);
  assert.equal(result.assetIds.includes("package-asset"), false);
});

test("ignores preselected report templates until SHEIN returns the SKC requirement", () => {
  const missing = buildProductComplianceStage({
    template,
    categoryId: "3155",
    report: { reportType: "1630" },
    now: "2026-08-06T00:00:00.000Z",
  });
  assert.equal(missing.valid, true);
  assert.equal(missing.blockers.length, 0);
  assert.equal(
    missing.postPublishTasks.some(
      (item) => item.code === "WAITING_FOR_SHEIN_REPORT_REQUIREMENT",
    ),
    true,
  );

  const selected = buildProductComplianceStage({
    template,
    reportTemplate,
    categoryId: "3155",
    report: { reportType: "1630" },
    now: "2026-08-06T00:00:00.000Z",
  });
  assert.equal(selected.reportDate, null);
  assert.equal(selected.reportMaterial, null);
});

test("keeps an unresolved 1630/1631 decision out of initial publish blockers", () => {
  const result = buildProductComplianceStage({
    template,
    categoryId: "11932",
    report: { reportType: null },
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.blockers, []);
  assert.equal(
    result.postPublishTasks.some(
      (item) => item.code === "WAITING_FOR_SHEIN_REPORT_REQUIREMENT",
    ),
    true,
  );
});
