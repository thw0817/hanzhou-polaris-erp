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
  new URL("../../src-v2/features/templates/TitleRuleTemplatesPage.tsx", import.meta.url),
  "utf8",
);
const editorSource = readFileSync(
  new URL("../../src-v2/features/publishing/NewProductPage.tsx", import.meta.url),
  "utf8",
);

test("V2 exposes title rule templates in routing, navigation and API", () => {
  assert.match(appSource, /TitleRuleTemplatesPage/);
  assert.match(appSource, /path="templates\/:storeId\/title-rules"/);
  assert.match(shellSource, /标题规则/);
  assert.match(shellSource, /\/title-rules/);
  for (const method of [
    "titleRuleTemplates",
    "saveTitleRuleTemplate",
    "deleteTitleRuleTemplate",
  ]) {
    assert.match(apiSource, new RegExp(`${method}:`));
  }
});

test("title rule templates preview and save reusable title fragments", () => {
  assert.match(pageSource, /完整替换标题/);
  assert.match(pageSource, /标题前缀/);
  assert.match(pageSource, /固定关键词/);
  assert.match(pageSource, /标题后缀/);
  assert.match(pageSource, /标题预览/);
  assert.match(pageSource, /统一保存标题规则/);
  assert.match(pageSource, /validateTitleRuleTemplateDraft/);
});

test("new product applies a title rule without bypassing SHEIN title validation", () => {
  assert.match(editorSource, /titleRuleTemplates/);
  assert.match(editorSource, /applyTitleRule/);
  assert.match(editorSource, /标题规则模板/);
  assert.match(editorSource, /buildProductContentStage/);
});

test("new product exposes a four-stage guided workflow", () => {
  for (const label of [
    "基础与类目",
    "图片与素材",
    "SKU与包装",
    "合规（发布后处理）",
  ]) {
    assert.match(editorSource, new RegExp(label));
  }
  assert.match(editorSource, /scrollToProductStage/);
  assert.match(editorSource, /draft-product-images/);
  assert.match(editorSource, /draft-product-compliance/);
});
