import assert from "node:assert/strict";
import test from "node:test";
import {
  buildComplianceReusePlan,
  classifyComplianceTemplateOptions,
} from "./compliance-template-reuse-contract.js";

const template = { id: "template-1", categoryId: "3155" };

function item(overrides = {}) {
  return {
    id: "item-1",
    skc: "SKC-1",
    categoryId: "3155",
    shelfStatus: "1",
    snapshot: { fresh: true },
    summary: {
      sourceCoverage: {
        requirementsReturned: true,
        photoRequirementsReturned: true,
      },
    },
    ...overrides,
  };
}

test("batch compliance reuse keeps every selected SKC behind detail revalidation", () => {
  const result = buildComplianceReusePlan({
    template,
    items: [item()],
    selectedSkcs: ["SKC-1"],
  });

  assert.equal(result.valid, true);
  assert.equal(result.summary.needsSkcDetail, 1);
  assert.equal(result.items[0].state, "needs_skc_detail");
  assert.match(result.items[0].nextStep, /商品级属性/);
});

test("batch compliance reuse blocks mismatched, stale or incomplete targets", () => {
  const result = buildComplianceReusePlan({
    template,
    items: [
      item({ id: "item-2", skc: "SKC-2", categoryId: "1941" }),
      item({
        id: "item-3",
        skc: "SKC-3",
        snapshot: { fresh: false },
      }),
      item({
        id: "item-4",
        skc: "SKC-4",
        summary: { sourceCoverage: { requirementsReturned: true } },
      }),
    ],
  });

  assert.equal(result.summary.blocked, 2);
  assert.equal(result.summary.needsSkcDetail, 1);
  assert.equal(result.items[0].categoryMatch, true);
  assert.equal(result.items[0].state, "needs_skc_detail");
  assert.deepEqual(result.items[1].blockers, ["目标 SKC 的合规规则快照需要先同步"]);
  assert.deepEqual(result.items[2].blockers, ["目标 SKC 的合规来源覆盖不完整"]);
});

test("batch compliance reuse ignores non-sale items and supports a selected subset", () => {
  const result = buildComplianceReusePlan({
    template,
    items: [
      item(),
      item({ id: "item-2", skc: "SKC-2", shelfStatus: "下架" }),
      item({ id: "item-3", skc: "SKC-3" }),
    ],
    selectedSkcs: ["SKC-3"],
  });

  assert.deepEqual(result.items.map((item) => item.skc), ["SKC-3"]);
});

test("separates photo templates from the report type required by the current SKC", () => {
  const templates = [
    {
      id: "photos-only",
      data: { defaults: { photos: [{ labelGroup: "2" }], certificates: [] } },
    },
    {
      id: "report-1630",
      data: {
        defaults: {
          photos: [],
          certificates: [{ certificateTypeCode: "SmallCarpet1630" }],
        },
      },
    },
    {
      id: "report-1631-with-photos",
      data: {
        defaults: {
          photos: [{ labelGroup: "2" }],
          certificates: [{ certificateTypeName: "16 CFR 1631 检测报告" }],
        },
      },
    },
  ];

  const result = classifyComplianceTemplateOptions({ templates, reportType: "1631" });

  assert.deepEqual(result.photoTemplates.map((item) => item.id), [
    "photos-only",
    "report-1631-with-photos",
  ]);
  assert.deepEqual(result.reportTemplates.map((item) => item.id), [
    "report-1631-with-photos",
  ]);
});

test("keeps store-wide photo templates available without a category", () => {
  const result = classifyComplianceTemplateOptions({
    templates: [{
      id: "store-wide-photos",
      categoryId: "",
      data: {
        referenceSkc: "",
        defaults: { photos: [{ labelGroup: "2" }] },
      },
    }],
    reportType: null,
  });

  assert.deepEqual(result.complianceTemplates.map((item) => item.id), [
    "store-wide-photos",
  ]);
  assert.deepEqual(result.photoTemplates.map((item) => item.id), [
    "store-wide-photos",
  ]);
});

test("does not offer report templates before the current SKC has a 1630/1631 decision", () => {
  const result = classifyComplianceTemplateOptions({
    templates: [{
      id: "report-1631",
      data: { defaults: { certificates: [{ certificateTypeCode: "SmallCarpet1631" }] } },
    }],
    reportType: null,
  });

  assert.deepEqual(result.reportTemplates, []);
});
