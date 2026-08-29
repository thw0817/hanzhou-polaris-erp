import assert from "node:assert/strict";
import test from "node:test";
import {
  buildComplianceRevalidation,
} from "./compliance-revalidation-projections.js";

const draftData = {
  attributeSchemaSnapshot: {
    fetchedAt: "2026-08-06T00:00:00.000Z",
    fields: [
      {
        id: "length",
        name: "最长边",
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
    length: { customValue: "200" },
    width: { customValue: "100" },
  },
  rugReportSources: {
    dimensions: [
      { attributeId: "length", unit: "cm" },
      { attributeId: "width", unit: "cm" },
    ],
  },
  complianceTemplateSnapshot: {
    data: {
      ruleFetchedAt: "2026-08-06T00:00:00.000Z",
      defaults: {
        certificates: [{
          certificateTypeName: "1630检测报告",
          files: [{ localAssetRef: "media:asset-1630" }],
        }],
        agencies: [],
        warnings: [],
        photos: [
          { labelGroup: "1", localAssetRef: "media:body-photo" },
          { labelGroup: "2", localAssetRef: "media:package-photo" },
        ],
      },
    },
  },
};

const readback = {
  spuName: "SPU-1",
  skcs: [
    {
      skcName: "SKC-1",
      skuList: [{ skuCode: "SKU-1", supplierSku: "SUP-1" }],
    },
  ],
};

function requirements(overrides = {}) {
  return [{
    skc: "SKC-1",
    sourceCoverage: {
      requirementsReturned: true,
      photoRequirementsReturned: true,
    },
    certificateRequirements: [{
      certificateTypeCode: "SMALLCARPET1630",
      certificateTypeName: "1630检测报告",
      isRequired: 1,
      reviewState: 2,
    }],
    agencyRequirements: [],
    warningRequirements: [],
    unsupportedRequirements: [
      {
        certificateTypeCode: "GCCHGXX",
        certificateTypeName: "GCC合规信息",
        isRequired: 1,
        reviewState: 2,
      },
      {
        certificateTypeId: 844,
        certificateTypeName: "产品标识符",
        isRequired: 1,
        reviewState: 2,
      },
    ],
    ...overrides,
  }];
}

test("revalidates each read-back SKC and recalculates 1630/1631", () => {
  const result = buildComplianceRevalidation({
    readback,
    draftData,
    requirementRows: requirements(),
    ruleSnapshot: {
      fetchedAt: "2026-08-06T00:00:00.000Z",
      expiresAt: "2026-08-07T00:00:00.000Z",
      fresh: true,
    },
    now: "2026-08-06T02:00:00.000Z",
  });

  assert.equal(result.projectionVersion, "compliance-revalidation-v1");
  assert.equal(result.status, "passed");
  assert.equal(result.completionEligible, true);
  assert.equal(result.skcs[0].report.reportType, "1630");
  assert.equal(result.skcs[0].capabilities.gcc.status, "passed");
  assert.equal(
    result.skcs[0].capabilities.gcc.writeStatus,
    "unsupported_by_official_api",
  );
  assert.equal(result.skcs[0].capabilities.product_identifier.editable, false);
});

test("revalidates against the independently selected report template", () => {
  const result = buildComplianceRevalidation({
    readback,
    draftData: {
      ...draftData,
      complianceTemplateSnapshot: {
        ...draftData.complianceTemplateSnapshot,
        data: {
          ...draftData.complianceTemplateSnapshot.data,
          defaults: {
            ...draftData.complianceTemplateSnapshot.data.defaults,
            certificates: [],
          },
        },
      },
      reportTemplateSnapshot: {
        data: {
          templateKind: "rug_report",
          reportType: "1630",
          reportDate: "2026-08-21",
          reportFile: { localAssetRef: "media:asset-1630" },
          storeScoped: true,
          revalidateOnUse: true,
          defaults: {
            certificates: [{
              certificateTypeName: "1630检测报告",
              files: [{ localAssetRef: "media:asset-1630" }],
            }],
          },
        },
      },
    },
    requirementRows: requirements(),
    ruleSnapshot: {
      fetchedAt: "2026-08-06T00:00:00.000Z",
      expiresAt: "2026-08-07T00:00:00.000Z",
      fresh: true,
    },
    now: "2026-08-06T02:00:00.000Z",
  });

  assert.equal(result.status, "passed");
  assert.equal(result.skcs[0].report.reportType, "1630");
  assert.equal(
    result.skcs[0].blockers.some(
      (item) => item.code === "REPORT_MATERIAL_MISSING",
    ),
    false,
  );
});

test("does not trust an old report type and blocks missing current material", () => {
  const result = buildComplianceRevalidation({
    readback,
    draftData: {
      ...draftData,
      complianceTemplateSnapshot: {
        data: {
          ruleFetchedAt: "2026-08-06T00:00:00.000Z",
          defaults: {
            certificates: [{
              certificateTypeName: "1631检测报告",
              files: [{ localAssetRef: "media:asset-1631" }],
            }],
            photos: [
              { labelGroup: "1", localAssetRef: "media:body-photo" },
              { labelGroup: "2", localAssetRef: "media:package-photo" },
            ],
          },
        },
      },
    },
    requirementRows: requirements({
      certificateRequirements: [{
        certificateTypeCode: "SMALLCARPET1630",
        certificateTypeName: "1630检测报告",
        isRequired: 1,
        reviewState: 2,
      }],
    }),
    ruleSnapshot: {
      fetchedAt: "2026-08-06T00:00:00.000Z",
      expiresAt: "2026-08-07T00:00:00.000Z",
      fresh: true,
    },
    now: "2026-08-06T02:00:00.000Z",
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.skcs[0].report.reportType, "1630");
  assert.ok(
    result.skcs[0].blockers.some(
      (item) => item.code === "REPORT_MATERIAL_MISSING",
    ),
  );
});

test("uses the per-SKC official requirement instead of local attribute classification", () => {
  const result = buildComplianceRevalidation({
    readback,
    draftData: {
      ...draftData,
      attributeValues: {
        length: { customValue: "100" },
        width: { customValue: "100" },
      },
    },
    requirementRows: requirements(),
    ruleSnapshot: {
      fetchedAt: "2026-08-06T00:00:00.000Z",
      expiresAt: "2026-08-07T00:00:00.000Z",
      fresh: true,
    },
    now: "2026-08-06T02:00:00.000Z",
  });

  assert.equal(result.status, "passed");
  assert.equal(result.skcs[0].report.reportType, "1630");
  assert.equal(
    result.skcs[0].blockers.some((item) => item.code === "RUG_REPORT_UNRESOLVED"),
    false,
  );
});

test("blocks incomplete SKC coverage and unresolved official capability states", () => {
  const result = buildComplianceRevalidation({
    readback: {
      ...readback,
      skcs: [
        ...readback.skcs,
        { skcName: "SKC-2", skuList: [{ skuCode: "SKU-2" }] },
      ],
    },
    draftData,
    requirementRows: requirements({
      skc: "SKC-1",
      unsupportedRequirements: [{
        certificateTypeCode: "GCCHGXX",
        certificateTypeName: "GCC合规信息",
        isRequired: 1,
        reviewState: 0,
      }],
    }),
    expectedSkcNames: ["SKC-1", "SKC-2", "SKC-3"],
    ruleSnapshot: {
      fetchedAt: "2026-08-06T00:00:00.000Z",
      expiresAt: "2026-08-07T00:00:00.000Z",
      fresh: true,
    },
    now: "2026-08-06T02:00:00.000Z",
  });

  assert.equal(result.status, "blocked");
  assert.ok(
    result.skcs.some((item) =>
      item.blockers.some((blocker) => blocker.code === "REQUIREMENTS_MISSING"),
    ),
  );
  assert.ok(
    result.blockers.some(
      (item) =>
        item.code === "SPU_READBACK_SKC_COVERAGE_INCOMPLETE" &&
        item.skcName === "SKC-3",
    ),
  );
  assert.ok(
    result.skcs[0].blockers.some(
      (item) => item.code === "OFFICIAL_CAPABILITY_NOT_PASSED",
    ),
  );
});

test("fails closed when current compliance rules are stale", () => {
  const result = buildComplianceRevalidation({
    readback,
    draftData,
    requirementRows: requirements(),
    ruleSnapshot: {
      fetchedAt: "2026-08-05T00:00:00.000Z",
      expiresAt: "2026-08-06T01:00:00.000Z",
      fresh: false,
    },
    now: "2026-08-06T02:00:00.000Z",
  });

  assert.equal(result.status, "blocked");
  assert.ok(
    result.skcs[0].blockers.some(
      (item) => item.code === "RULE_SNAPSHOT_STALE",
    ),
  );
});
