import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizePackagingWorkbook,
  packagingTemplatePaths,
  validatePackagingTemplateDraft,
} from "./packaging-template-contract.js";

test("builds encoded packaging template paths", () => {
  assert.deepEqual(
    packagingTemplatePaths("store / 1", "template / 1"),
    {
      templates:
        "/v1/web/stores/store%20%2F%201/publish-templates?type=packaging",
      template:
        "/v1/web/stores/store%20%2F%201/publish-templates/template%20%2F%201",
    },
  );
});

test("reuses the strict packaging workbook parser", () => {
  const workbook = normalizePackagingWorkbook([
    {
      sheet: "天鹅绒",
      data: [
        ["宽", "长", "打包长", "打包宽", "打包高"],
        [40, 60, 20, 16, 6],
      ],
    },
  ]);

  assert.equal(workbook.materialCount, 1);
  assert.equal(workbook.rowCount, 1);
  assert.equal(workbook.issues.length, 0);
});

test("packaging template draft keeps only the standard workbook fields", () => {
  const result = validatePackagingTemplateDraft({
    name: "  标准打包体积  ",
    workbook: {
      fileName: "哇噻地毯_打包体积标准模板.xlsx",
      importedAt: "2026-08-05T00:00:00.000Z",
      issues: [],
      materials: {
        天鹅绒: [{
          widthCm: 40,
          lengthCm: 60,
          packageLengthCm: 20,
          packageWidthCm: 16,
          packageHeightCm: 6,
          weightGrams: 500,
          note: "不应保存",
        }],
      },
    },
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.data, {
    name: "标准打包体积",
    workbook: {
      fileName: "哇噻地毯_打包体积标准模板.xlsx",
      importedAt: "2026-08-05T00:00:00.000Z",
      materials: {
        天鹅绒: [{
          widthCm: 40,
          lengthCm: 60,
          packageLengthCm: 20,
          packageWidthCm: 16,
          packageHeightCm: 6,
        }],
      },
      overwrittenCount: 0,
    },
  });
});

test("packaging template draft reports missing name and invalid workbook", () => {
  const result = validatePackagingTemplateDraft({
    name: "",
    workbook: {
      issues: ["短绒 表头不正确"],
      materials: {},
    },
  });

  assert.equal(result.valid, false);
  assert.equal(result.errors.name, "请填写模板名称");
  assert.equal(result.errors.workbook, "请修正工作簿错误后重新上传");
});
