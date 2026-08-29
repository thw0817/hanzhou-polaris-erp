import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(
  new URL("../../src-v2/app/App.tsx", import.meta.url),
  "utf8",
);
const shellSource = readFileSync(
  new URL("../../src-v2/app/AppShell.tsx", import.meta.url),
  "utf8",
);
const apiSource = readFileSync(
  new URL("../../src-v2/lib/api.ts", import.meta.url),
  "utf8",
);
const pageSource = readFileSync(
  new URL("../../src-v2/features/templates/AttributeTemplatesPage.tsx", import.meta.url),
  "utf8",
);
const newProductPageSource = readFileSync(
  new URL("../../src-v2/features/publishing/NewProductPage.tsx", import.meta.url),
  "utf8",
);

test("V2 exposes the attribute template route and navigation", () => {
  assert.match(
    appSource,
    /path="templates\/:storeId\/attributes"/,
  );
  assert.match(shellSource, /模板中心/);
  assert.match(shellSource, /商品属性/);
  assert.match(
    shellSource,
    /\/app\/templates\/\$\{encodeURIComponent\(storeId\)\}\/attributes/,
  );
});

test("V2 store switching recognizes template routes", () => {
  assert.match(
    shellSource,
    /\^\\\/app\\\/\(\?:operations\|templates\)\\\/\(\[\^\/\]\+\)/,
  );
});

test("V2 API exposes attribute template reads and mutations", () => {
  for (const method of [
    "publishCategories",
    "publishSchema",
    "publishSchemaCoverage",
    "syncPublishSchemas",
    "associatedAttributeRules",
    "attributeTemplates",
    "saveAttributeTemplate",
    "deleteAttributeTemplate",
  ]) {
    assert.match(apiSource, new RegExp(`${method}:`));
  }
});

test("V2 exposes the color and size template route and API", () => {
  assert.match(appSource, /SizeTemplatesPage/);
  assert.match(appSource, /path="templates\/:storeId\/sizes"/);
  assert.match(shellSource, /颜色与尺寸/);
  assert.match(
    shellSource,
    /\/app\/templates\/\$\{encodeURIComponent\(storeId\)\}\/sizes/,
  );
  for (const method of [
    "sizeTemplates",
    "saveSizeTemplate",
    "deleteSizeTemplate",
  ]) {
    assert.match(apiSource, new RegExp(`${method}:`));
  }
});

test("attribute templates derive category columns from the SHEIN tree depth", () => {
  assert.match(pageSource, /categoryPickerOpen/);
  assert.match(pageSource, /更换类目/);
  assert.match(pageSource, /categoryColumns/);
  assert.match(pageSource, /categoryColumns\.map/);
  assert.match(pageSource, /第\$\{index \+ 1\}级类目/);
  assert.match(pageSource, /ChevronRight/);
  assert.match(pageSource, /flattenLeafCategories/);
  assert.match(pageSource, /categorySearch/);
  assert.match(pageSource, /visibleLeafCategories/);
  assert.match(pageSource, /搜索商品末级类目/);
  assert.match(pageSource, /Category ID 或 Product Type ID/);
  assert.match(pageSource, /没有匹配的末级类目/);
  assert.doesNotMatch(pageSource, /secondLevelCategories/);
});

test("attribute templates expand both required and optional product attributes", () => {
  assert.match(pageSource, /requiredFields\.map/);
  assert.match(pageSource, /optionalFields\.map/);
  assert.doesNotMatch(pageSource, /<details className="border-t/);
});

test("large multi-select attributes remain searchable in templates", () => {
  assert.match(pageSource, /field\.values\.length >= 20/);
  assert.match(pageSource, /搜索属性值/);
  assert.match(pageSource, /visibleOptions = normalizedQuery/);
  assert.match(pageSource, /当前显示 \{visibleOptions\.length\} \/ \{field\.values\.length\} 个官方值/);
  assert.match(pageSource, /没有匹配的属性值/);
});

test("quantity attributes keep numeric units instead of composition percentages", () => {
  for (const source of [pageSource, newProductPageSource]) {
    assert.match(source, /isCompositionPercentageField/);
    assert.match(source, /填写数量，如 1/);
    assert.match(source, /percentageComposition \? 100 : undefined/);
  }
});

test("attribute templates render only product-level SHEIN attributes", () => {
  assert.match(pageSource, /buildAttributeFields/);
  assert.doesNotMatch(pageSource, /buildAttributeSchema/);
  assert.doesNotMatch(pageSource, /主销售属性/);
  assert.doesNotMatch(pageSource, /次销售属性/);
  assert.doesNotMatch(pageSource, /尺码属性/);
  assert.doesNotMatch(pageSource, /SKU 级商品属性/);
  assert.doesNotMatch(pageSource, /当前商品属性模板只保存商品级属性/);
});

test("attribute templates keep one visible unified save action", () => {
  assert.match(pageSource, /fixed inset-x-0 bottom-0/);
  assert.match(pageSource, /lg:left-\[236px\]/);
  assert.match(pageSource, /pb-24/);
  assert.match(pageSource, /统一保存全部属性/);
  assert.doesNotMatch(pageSource, /单项保存/);
});

test("attribute template list remains searchable without changing permissions", () => {
  assert.match(pageSource, /templateSearch/);
  assert.match(pageSource, /filteredTemplates/);
  assert.match(pageSource, /搜索属性模板/);
  assert.match(pageSource, /没有匹配的属性模板/);
  assert.match(pageSource, /template\.data\.categoryName/);
});

test("attribute templates show dynamic required completion in the save bar", () => {
  assert.match(pageSource, /completedRequiredCount/);
  assert.match(pageSource, /必填 \$\{completedRequiredCount\}\/\$\{requiredFields\.length\}/);
  assert.match(pageSource, /还差 \$\{validation\.missingFieldIds\.length\} 项/);
});

test("attribute templates explain category schema cache blockers without inventing fields", () => {
  assert.match(pageSource, /当前类目没有可用的官方属性缓存/);
  assert.match(pageSource, /Category \{category\.categoryId\}/);
  assert.match(pageSource, /Product Type/);
  assert.match(pageSource, /系统不会猜测或补造商品属性/);
  assert.match(pageSource, /更换类目/);
});

test("attribute templates show coverage for every leaf category", () => {
  assert.match(pageSource, /publishSchemaCoverage/);
  assert.match(pageSource, /全部末级类目属性覆盖/);
  assert.match(pageSource, /已同步 \$\{schemaCoverage\.data\.summary\.ready\}/);
  assert.match(pageSource, /不会借用其他类目属性/);
});

test("attribute templates explain unavailable category rules without exposing deployment details", () => {
  assert.match(pageSource, /类目规则暂时不可用/);
  assert.match(pageSource, /当前类目规则服务暂时不可用/);
  assert.match(pageSource, /attributeApiMissing/);
  assert.match(pageSource, /disabled=\{busy \|\| attributeApiMissing\}/);
});

test("attribute templates bind rug report dimensions or SHEIN threshold fields only to real product attributes", () => {
  assert.match(pageSource, /1630\/1631 判定属性/);
  assert.match(pageSource, /SHEIN 是\/否阈值属性/);
  assert.match(pageSource, /是否最长边大于1\.8m/);
  assert.match(pageSource, /是否面积大于2\.16m²/);
  assert.match(pageSource, /exceededValueId/);
  assert.match(pageSource, /withinValueId/);
  assert.match(pageSource, /成品长度或直径/);
  assert.match(pageSource, /成品宽度/);
  assert.match(pageSource, /rugReportSources/);
  assert.match(pageSource, /dataDimension === 1/);
  assert.doesNotMatch(pageSource, /sizeRows/);
  assert.doesNotMatch(pageSource, /packageLength/);
});

test("attribute templates announce saving and results beside the save action", () => {
  assert.match(pageSource, /aria-live="polite"/);
  assert.match(pageSource, /正在校验 SHEIN 规则并保存/);
  assert.match(pageSource, /feedback\?\.message/);
});

test("attribute templates make missing required fields visible and locatable", () => {
  assert.match(pageSource, /保存前检查未通过/);
  assert.match(pageSource, /定位：\{field\.name\}/);
  assert.match(pageSource, /focusAttribute/);
  assert.match(pageSource, /aria-invalid=\{invalid\}/);
});

test("attribute templates show all-category schema sync progress", () => {
  assert.match(pageSource, /全量类目 schema 同步/);
  assert.match(pageSource, /正在读取任务状态/);
  assert.match(pageSource, /progress\.processed/);
  assert.match(pageSource, /schemaSyncTerminalStates\.includes\(schemaSyncState\)/);
  assert.match(pageSource, /查看任务详情/);
  assert.match(pageSource, /api\.syncJob\(storeId, schemaSyncJobId\)/);
  assert.match(apiSource, /syncJob: \(storeId: string, jobId: string\)/);
  assert.match(apiSource, /scope\?: "referenced" \| "all"/);
});

test("attribute templates keep coverage as a concise summary without a full category table", () => {
  assert.match(pageSource, /全部末级类目属性覆盖/);
  assert.match(pageSource, /刷新覆盖状态/);
  assert.match(pageSource, /同步全部类目/);
  assert.match(pageSource, /const canManageTenantTemplates = \["owner", "admin"\]/);
  assert.match(pageSource, /canManageTenantTemplates \? \(/);
  assert.match(pageSource, /类目与商品属性由管理员统一同步/);
  assert.match(pageSource, /canManageTenantTemplates && schemaSyncJobId/);
    assert.doesNotMatch(pageSource, /查看全部末级类目/);
    assert.doesNotMatch(pageSource, /搜索末级类目/);
    assert.doesNotMatch(pageSource, /visibleCoverageCategories/);
  });

test("attribute templates block editing and saving until category coverage is complete", () => {
  assert.match(pageSource, /const coverageReady = selectedCoverage\?\.ready === true/);
  assert.match(pageSource, /当前类目的官方 schema 尚未完整同步/);
  assert.match(pageSource, /category && schema\.data && coverageReady/);
  assert.match(pageSource, /disabled=\{busy \|\| schema\.isFetching \|\| !coverageReady\}/);
});

test("new product blocks incomplete category coverage before saving a draft", () => {
  assert.match(newProductPageSource, /publishSchemaCoverage/);
  assert.match(newProductPageSource, /const coverageReady = selectedCoverage\?\.ready === true/);
  assert.match(newProductPageSource, /当前类目的官方 schema 尚未完整同步/);
  assert.match(newProductPageSource, /category && schema\.data && coverageReady/);
  assert.match(newProductPageSource, /当前类目官方 schema 尚未完整同步/);
});
