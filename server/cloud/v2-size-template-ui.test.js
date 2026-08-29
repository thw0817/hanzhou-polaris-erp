import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(
  new URL("../../src-v2/features/templates/SizeTemplatesPage.tsx", import.meta.url),
  "utf8",
);

test("size templates edit one shared color and repeatable size rows", () => {
  assert.match(pageSource, /共享颜色/);
  assert.match(pageSource, /尺寸显示名/);
  assert.match(pageSource, /小边（cm）/);
  assert.match(pageSource, /大边（cm）/);
  assert.match(pageSource, /addSizeRow/);
  assert.match(pageSource, /removeSizeRow/);
});

test("size templates validate and locate every missing field", () => {
  assert.match(pageSource, /validateSizeTemplateDraft/);
  assert.match(pageSource, /saveAttempted/);
  assert.match(pageSource, /scrollIntoView/);
  assert.match(pageSource, /role="alert"/);
});

test("size templates use one fixed save action with visible feedback", () => {
  assert.match(pageSource, /fixed inset-x-0 bottom-0/);
  assert.match(pageSource, /统一保存颜色与尺寸/);
  assert.match(pageSource, /aria-live="polite"/);
  assert.match(pageSource, /正在保存颜色与尺寸模板/);
});

test("size template list remains searchable without changing its sales-attribute scope", () => {
  assert.match(pageSource, /templateSearch/);
  assert.match(pageSource, /filteredTemplates/);
  assert.match(pageSource, /搜索颜色与尺寸模板/);
  assert.match(pageSource, /没有匹配的颜色与尺寸模板/);
  assert.match(pageSource, /template\.data\.colorText/);
});

test("size templates do not mix unrelated SKU or packaging fields", () => {
  assert.doesNotMatch(pageSource, /costPrice/);
  assert.doesNotMatch(pageSource, /stockInfo/);
  assert.doesNotMatch(pageSource, /weight/);
  assert.doesNotMatch(pageSource, /packageLength/);
  assert.doesNotMatch(pageSource, /categoryId/);
  assert.doesNotMatch(pageSource, /productTypeId/);
});
