import assert from "node:assert/strict";
import test from "node:test";
import {
  collectProductDraftIssues,
  productDraftSectionAnchor,
  sortProductDraftsByActionPriority,
} from "./product-draft-issue-contract.js";

function draft(overrides = {}) {
  return {
    id: "draft-1",
    name: "测试商品",
    status: "blocked",
    updatedAt: "2026-08-22T10:00:00.000Z",
    preflight: {
      publishCandidate: {
        blockers: [],
      },
    },
    ...overrides,
  };
}

test("draft blockers are grouped into the four editor sections and deduplicated", () => {
  const result = collectProductDraftIssues(draft({
    preflight: {
      publishCandidate: {
        blockers: [
          { source: "content", code: "TITLE_REQUIRED", message: "请填写标题" },
          { source: "attributes", code: "ATTRIBUTE_REQUIRED", message: "请填写必填属性" },
          { source: "images", code: "MAIN_IMAGE_REQUIRED", message: "请上传主图" },
          { source: "sku", code: "SKU_REQUIRED", message: "请生成SKU" },
          { source: "publishSettings", code: "SITE_REQUIRED", message: "请选择站点" },
          { source: "rugReport", code: "RUG_REPORT_UNRESOLVED", message: "请完成1630/1631判定" },
          { source: "images", code: "MAIN_IMAGE_REQUIRED", message: "请上传主图" },
        ],
      },
    },
  }));

  assert.equal(result.total, 5);
  assert.deepEqual(
    result.groups.filter((group) => group.count).map((group) => [group.key, group.count]),
    [["basic", 3], ["images", 1], ["sku", 1]],
  );
  assert.equal(result.firstIssue?.section, "basic");
  assert.equal(result.firstIssue?.anchor, "draft-product-basic");
});

test("unknown server blocker remains visible and routes to the basic section", () => {
  const result = collectProductDraftIssues(draft({
    preflight: {
      publishCandidate: {
        blockers: [{ source: "futureSection", code: "NEW_RULE", message: "新规则待处理" }],
      },
    },
  }));

  assert.equal(result.total, 1);
  assert.equal(result.firstIssue?.message, "新规则待处理");
  assert.equal(result.firstIssue?.section, "basic");
  assert.equal(productDraftSectionAnchor("unknown"), "draft-product-basic");
});

test("ready drafts have no issues and blocked drafts sort before other statuses", () => {
  const ready = draft({ id: "ready", status: "ready", updatedAt: "2026-08-22T12:00:00.000Z" });
  assert.equal(collectProductDraftIssues(ready).total, 0);

  const sorted = sortProductDraftsByActionPriority([
    ready,
    draft({ id: "archived", status: "archived", updatedAt: "2026-08-22T13:00:00.000Z" }),
    draft({
      id: "blocked-newer",
      updatedAt: "2026-08-22T11:00:00.000Z",
      preflight: { publishCandidate: { blockers: [{ source: "images", code: "IMAGE", message: "图片待处理" }] } },
    }),
    draft({
      id: "blocked-older",
      updatedAt: "2026-08-22T09:00:00.000Z",
      preflight: { publishCandidate: { blockers: [{ source: "sku", code: "SKU", message: "SKU待处理" }] } },
    }),
  ]);

  assert.deepEqual(sorted.map((item) => item.id), ["blocked-newer", "blocked-older", "ready", "archived"]);
});

test("legacy compliance reminders do not appear as initial publish blockers", () => {
  const result = collectProductDraftIssues(draft({
    preflight: {
      images: {
        blockers: [{ code: "MAIN_IMAGE_REQUIRED", message: "请上传主图" }],
      },
      compliance: {
        blockers: [{ code: "COMPLIANCE_REQUIRED", message: "请选择合规资料" }],
      },
    },
  }));

  assert.equal(result.total, 1);
  assert.deepEqual(result.groups.filter((group) => group.count).map((group) => group.key), ["images"]);
});
