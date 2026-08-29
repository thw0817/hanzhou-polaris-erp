import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(
  new URL("../../src-v2/features/compliance/CompliancePage.tsx", import.meta.url),
  "utf8",
);
const detailPageSource = readFileSync(
  new URL("../../src-v2/features/compliance/ComplianceDetailPage.tsx", import.meta.url),
  "utf8",
);
const draftEditorSource = readFileSync(
  new URL("../../src-v2/features/compliance/ComplianceDraftEditor.tsx", import.meta.url),
  "utf8",
);
const folderImportSource = readFileSync(
  new URL("../../src-v2/features/publishing/ProductFolderImport.tsx", import.meta.url),
  "utf8",
);

test("compliance workspace empty state explains that real SKC cache is required", () => {
  assert.match(pageSource, /当前店铺还没有可同步的真实 SKC/);
  assert.match(pageSource, /请先在经营中心刷新真实商品数据/);
  assert.match(pageSource, /生成 SKC 缓存后再创建合规同步/);
  assert.doesNotMatch(pageSource, /可前往同步任务创建合规同步/);
});

test("compliance workspace exposes one real sync action", () => {
  assert.match(pageSource, /合规同步/);
  assert.doesNotMatch(pageSource, /同步任务/);
  assert.doesNotMatch(pageSource, /真实同步/);
});

test("compliance workspace keeps an empty item list stable across renders", () => {
  assert.match(pageSource, /const items = useMemo\(\(\) => workspace\.data\?\.items \|\| \[\], \[workspace\.data\?\.items\]\)/);
});

test("compliance workspace summary cards use reconciled business result labels", () => {
  assert.match(pageSource, /全部 SKC/);
  assert.match(pageSource, /需处理/);
  assert.doesNotMatch(pageSource, /不合格/);
  assert.match(pageSource, /处理中/);
  assert.match(pageSource, /已通过/);
  assert.doesNotMatch(pageSource, /未运行预检/);
  assert.doesNotMatch(pageSource, /需重新预检/);
  assert.doesNotMatch(pageSource, /待管理员审阅/);
  assert.doesNotMatch(pageSource, /已审阅/);
});

test("compliance workspace uses red for user-action states and amber for platform-processing states", () => {
  const statusClassBody = pageSource.match(/function statusClass\(status: string\) \{([\s\S]*?)\n\}/)?.[1] || "";
  assert.match(statusClassBody, /\["需修正", "待补充", "失败"\]\.includes\(status\)/);
  assert.match(statusClassBody, /\["审核中", "待同步", "待上架"\]\.includes\(status\)/);
});

test("compliance workspace shows truthful SHEIN shelf status and compact category path", () => {
  assert.match(pageSource, /id: "shelf", header: "平台状态"/);
  assert.match(pageSource, /shelfStatus/);
  assert.match(pageSource, /path\.at\(-1\)/);
  assert.match(pageSource, /待上架/);
  assert.doesNotMatch(pageSource, /categoryId[^\n]*<td/);
  assert.match(pageSource, /\^\(\?:类目\\s\*\)\?\\d\+\$/);
});

test("compliance workspace labels the official 1630/1631 decision for every SKC", () => {
  assert.match(pageSource, /官方报告/);
  assert.match(pageSource, /reportDecision\?\.reportType/);
  assert.match(pageSource, /等待 SHEIN 返回/);
});

test("compliance workspace opens a detail from the SKC cell and keeps thumbnail projection", () => {
  assert.match(pageSource, /打开 \$\{item\.skc\} 合规详情/);
  assert.match(pageSource, /item\.imageUrl \? <img/);
});

test("single SKC compliance editor is driven by required SHEIN records only", () => {
  assert.match(detailPageSource, /record\.required/);
  assert.match(detailPageSource, /官方报告类型/);
  assert.match(detailPageSource, /reportDecision/);
  assert.match(draftEditorSource, /rule\.required/);
  assert.match(draftEditorSource, /photoGroupNeedsSubmission/);
  assert.doesNotMatch(draftEditorSource, /fallbackKey/);
  assert.match(draftEditorSource, /仅展示 SHEIN 返回的必填合规项/);
});

test("compliance sync terminal state refetches server workspace and preserves failure details", () => {
  assert.match(pageSource, /await queryClient\.refetchQueries\(\{[\s\S]*?queryKey: \["store", queryScope, storeId, "compliance-workspace"\]/);
  assert.doesNotMatch(pageSource, /void queryClient\.invalidateQueries\(\{ queryKey: \["store", storeId, "compliance-workspace"\]/);
  assert.match(pageSource, /job\.error\?\.message \|\| "合规同步失败，请重试"/);
});

test("compliance and folder-import caches are scoped by tenant and user", () => {
  assert.match(pageSource, /queryKey: \["store", queryScope, storeId, "compliance-workspace"/);
  assert.match(pageSource, /queryKey: \["store", queryScope, storeId, "compliance-templates"/);
  assert.match(folderImportSource, /const queryScope = `\$\{session\.tenant\.id\}:\$\{session\.user\.id\}`/);
  assert.match(folderImportSource, /invalidateQueries\(\{ queryKey: \["store", queryScope, storeId, "product-drafts"\]/);
});

test("compliance workspace does not expose technical audit controls or columns", () => {
  assert.doesNotMatch(pageSource, /showAuditDetails|显示审计信息|隐藏审计信息|筛选预检审阅状态/);
  assert.doesNotMatch(detailPageSource, /showAuditDetails|显示审计信息|隐藏审计信息/);
  assert.doesNotMatch(pageSource, /<th>合规草稿|<th>合规预检|<th>管理员审阅|<th>规则快照/);
  assert.match(detailPageSource, /SHEIN 官方报告要求/);
  assert.doesNotMatch(detailPageSource, /商品属性与 1630\/1631 判定/);
  assert.match(detailPageSource, /失败原因来自 SHEIN 当前回读/);
});
