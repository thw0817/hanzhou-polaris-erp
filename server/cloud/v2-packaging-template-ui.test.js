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
  new URL("../../src-v2/features/templates/PackagingTemplatesPage.tsx", import.meta.url),
  "utf8",
);

test("V2 exposes the packaging template route, navigation and API", () => {
  assert.match(appSource, /PackagingTemplatesPage/);
  assert.match(appSource, /path="templates\/:storeId\/packaging"/);
  assert.match(shellSource, /打包体积/);
  assert.match(
    shellSource,
    /\/app\/templates\/\$\{encodeURIComponent\(storeId\)\}\/packaging/,
  );
  for (const method of [
    "packagingTemplates",
    "savePackagingTemplate",
    "deletePackagingTemplate",
  ]) {
    assert.match(apiSource, new RegExp(`${method}:`));
  }
});

test("packaging templates accept only a standard xlsx workbook", () => {
  assert.match(pageSource, /read-excel-file\/browser/);
  assert.match(pageSource, /normalizePackagingWorkbook/);
  assert.match(pageSource, /accept="\.xlsx,application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet"/);
  assert.match(pageSource, /每个工作表名称作为材质/);
  assert.match(pageSource, /宽、长、打包长、打包宽、打包高/);
});

test("packaging templates show concise summaries without an editable spreadsheet", () => {
  assert.match(pageSource, /材质数/);
  assert.match(pageSource, /尺寸数/);
  assert.match(pageSource, /有效记录/);
  assert.match(pageSource, /重复覆盖/);
  assert.match(pageSource, /issues\.slice\(0, 5\)/);
  assert.doesNotMatch(pageSource, /<table/);
  assert.doesNotMatch(pageSource, /contentEditable/);
  assert.doesNotMatch(pageSource, /添加尺寸/);
});

test("packaging templates use one fixed save action with visible feedback", () => {
  assert.match(pageSource, /fixed inset-x-0 bottom-0/);
  assert.match(pageSource, /统一保存打包体积/);
  assert.match(pageSource, /aria-live="polite"/);
  assert.match(pageSource, /正在保存打包体积模板/);
  assert.match(pageSource, /scrollIntoView/);
});

test("packaging template list remains searchable without changing workbook rules", () => {
  assert.match(pageSource, /templateSearch/);
  assert.match(pageSource, /filteredTemplates/);
  assert.match(pageSource, /搜索打包体积模板/);
  assert.match(pageSource, /没有匹配的打包体积模板/);
  assert.match(pageSource, /PackagingWorkbook\)\.fileName/);
});

test("packaging templates do not introduce product weight fields", () => {
  assert.doesNotMatch(pageSource, /weightGrams/);
  assert.doesNotMatch(pageSource, /产品重量/);
  assert.doesNotMatch(pageSource, /包装重量/);
});
