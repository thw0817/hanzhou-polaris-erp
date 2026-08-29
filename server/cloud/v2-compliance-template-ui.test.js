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
  new URL("../../src-v2/features/templates/ComplianceTemplatesPage.tsx", import.meta.url),
  "utf8",
);
const reuseContractSource = readFileSync(
  new URL("../../src-v2/lib/compliance-template-reuse-contract.js", import.meta.url),
  "utf8",
);
const productComplianceSource = readFileSync(
  new URL("../../src-v2/features/publishing/ProductComplianceSection.tsx", import.meta.url),
  "utf8",
);

test("V2 restores the compliance template center as a shared workflow entry", () => {
  assert.match(appSource, /ComplianceTemplatesPage/);
  assert.match(appSource, /path="templates\/:storeId\/compliance"/);
  assert.match(shellSource, /\/app\/templates\/\$\{encodeURIComponent\(storeId\)\}\/compliance/);
  for (const method of [
    "complianceTemplates",
    "saveComplianceTemplate",
    "deleteComplianceTemplate",
    "preflightCompliance",
    "applyComplianceTemplate",
  ]) {
    assert.match(apiSource, new RegExp(`\\b${method}(?=\\s*[:,])`));
  }
});

test("compliance templates are store-wide and do not require a reference SKC", () => {
  assert.doesNotMatch(pageSource, /参照 SKC/);
  assert.doesNotMatch(pageSource, /complianceWorkspaceItem/);
  assert.doesNotMatch(pageSource, /当前类目/);
  assert.match(pageSource, /店铺通用/);
  assert.match(pageSource, /可直接上传通用实拍图后保存/);
});

test("compliance material plans show every dynamic required state and handling boundary", () => {
  assert.match(pageSource, /1630\/1631 报告模板中心/);
  assert.match(pageSource, /报告日期/);
  assert.match(pageSource, /自定义名称/);
  assert.match(pageSource, /商品本体通用实拍图/);
  assert.match(pageSource, /商品包装通用实拍图/);
  assert.match(pageSource, /最多上传 2 张/);
  assert.match(pageSource, /multiple=\{slot\.group === "2"\}/);
  assert.match(pageSource, /photosForGroup/);
  assert.match(pageSource, /不绑定 SKC 或类目/);
});

test("compliance template list remains searchable without changing evidence boundaries", () => {
  assert.match(pageSource, /templateSearch/);
  assert.match(pageSource, /filteredTemplates/);
  assert.match(pageSource, /搜索合规素材方案/);
  assert.match(pageSource, /没有匹配的合规素材方案/);
  assert.doesNotMatch(pageSource, /template\.data\.categoryName/);
  assert.doesNotMatch(pageSource, /template\.data\.referenceSkc/);
});

test("automatic binding and unsupported writes stay outside editable materials", () => {
  assert.match(pageSource, /欧代商/);
  assert.match(pageSource, /制造商/);
  assert.match(pageSource, /上品时直接绑定/);
  assert.doesNotMatch(pageSource, /选择.*代理公司/);
  assert.doesNotMatch(pageSource, /手动警示语.*select/);
});

test("batch reuse is presented as a per-SKC preflight queue", () => {
  assert.match(pageSource, /在售商品批量引用/);
  assert.match(pageSource, /每个 SKC 独立预检/);
  assert.match(pageSource, /生成引用预检/);
  assert.match(pageSource, /正在读取官方要求/);
  assert.match(pageSource, /搜索批量引用商品/);
  assert.match(pageSource, /查看全部 \$\{filteredActiveItems\.length\} 个/);
  assert.match(pageSource, /已选 \{selectedActiveCount\}\/\{activeItems\.length\}/);
  assert.match(pageSource, /请先保存并选中一套合规模板/);
  assert.doesNotMatch(pageSource, /template\?\.data\.ruleFetchedAt/);
  assert.match(pageSource, /setSelectedSkcs\(\(current\) => current\.filter/);
  assert.match(apiSource, /\/compliance\/preflight/);
  assert.match(pageSource, /1630\/1631 必须根据目标商品级属性重新判断/);
  assert.doesNotMatch(reuseContractSource, /目标 SKC 类目与模板类目不一致/);
  assert.match(reuseContractSource, /rulesFresh/);
  assert.match(reuseContractSource, /needs_skc_detail/);
  assert.match(pageSource, /打开合规工作台/);
  assert.match(pageSource, /本区只批量引用通用实拍图/);
  assert.match(apiSource, /\/compliance\/templates\/\$\{encodeURIComponent\(templateId\)\}\/apply/);
  assert.match(pageSource, /复验通过后保存草稿/);
  assert.match(pageSource, /目标 SKC 按官方判定引用同类型报告模板/);
  assert.match(pageSource, /选择批量引用合规素材方案/);
  assert.match(pageSource, /selectedTemplateId/);
});

test("compliance templates use one fixed save action with complete feedback", () => {
  assert.match(pageSource, /validateComplianceTemplateDraft/);
  assert.match(pageSource, /fixed inset-x-0 bottom-0/);
  assert.match(pageSource, /统一保存店铺合规模板/);
  assert.match(pageSource, /aria-live="polite"/);
  assert.match(pageSource, /正在保存店铺合规模板/);
  assert.match(pageSource, /scrollIntoView/);
  assert.match(pageSource, /role="alert"/);
});

test("compliance template UI never invents official write fields", () => {
  assert.doesNotMatch(pageSource, /save-skc-agency/);
  assert.doesNotMatch(pageSource, /update-skc-warning-certificate/);
  assert.doesNotMatch(pageSource, /skc-save-label/);
  assert.doesNotMatch(pageSource, /goods-certificates\/save/);
  assert.doesNotMatch(pageSource, /ProductIdenti.*input/i);
});

test("product publishing only offers templates that contain reusable photos", () => {
  assert.match(productComplianceSource, /const categoryTemplates = options\.photoTemplates/);
  assert.doesNotMatch(productComplianceSource, /const categoryTemplates = options\.complianceTemplates/);
});
