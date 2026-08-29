import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateAreaSquareMeters,
  calculateWeightGrams,
  enrichSizeRows,
  normalizePackagingWorkbook,
} from "./package-template.js";

test("parses each worksheet as one packaging material", () => {
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
  assert.equal(workbook.materials["天鹅绒"][0].key, "40x60");
});

test("rejects worksheets that do not match the required five columns", () => {
  const workbook = normalizePackagingWorkbook([
    { sheet: "错误表", data: [["宽", "长"], [40, 60]] },
  ]);
  assert.equal(workbook.materialCount, 0);
  assert.match(workbook.issues[0], /缺少列/);
});

test("rejects extra columns and lets the last duplicate dimension overwrite", () => {
  const extraColumn = normalizePackagingWorkbook([
    {
      sheet: "天鹅绒",
      data: [
        ["宽", "长", "打包长", "打包宽", "打包高", "备注"],
        [40, 60, 20, 16, 6, "不允许"],
      ],
    },
  ]);
  assert.equal(extraColumn.materialCount, 0);
  assert.match(extraColumn.issues[0], /多余列/);

  const duplicateSize = normalizePackagingWorkbook([
    {
      sheet: "天鹅绒",
      data: [
        ["宽", "长", "打包长", "打包宽", "打包高"],
        [40, 60, 20, 16, 6],
        [60, 40, 21, 17, 7],
      ],
    },
  ]);
  assert.equal(duplicateSize.materialCount, 1);
  assert.equal(duplicateSize.rowCount, 1);
  assert.equal(duplicateSize.overwrittenCount, 1);
  assert.equal(duplicateSize.materials["天鹅绒"][0].packageLengthCm, 21);
});

test("calculates rectangle and user-defined round area rules", () => {
  assert.equal(
    calculateAreaSquareMeters({ shape: "rectangle", widthCm: 80, lengthCm: 120 }),
    0.96,
  );
  assert.equal(
    calculateAreaSquareMeters({ shape: "round", diameterCm: 100 }),
    1,
  );
  assert.equal(
    calculateWeightGrams({ shape: "round", diameterCm: 100 }, 850),
    850,
  );
});

test("matches packaging dimensions independent of width and length orientation", () => {
  const sizes = enrichSizeRows(
    [{ id: "S1", shape: "rectangle", widthCm: 60, lengthCm: 40 }],
    {
      gramsPerSquareMeter: 850,
      materialRows: [
        {
          key: "40x60",
          packageLengthCm: 20,
          packageWidthCm: 16,
          packageHeightCm: 6,
        },
      ],
    },
  );
  assert.equal(sizes[0].packageMatch, "matched");
  assert.equal(sizes[0].packageLengthCm, 20);
  assert.equal(sizes[0].weightGrams, 204);
});

test("calculates an unmatched 80 by 120 SKU but leaves packaging for manual input", () => {
  const sizes = enrichSizeRows(
    [{ id: "S2", shape: "rectangle", widthCm: 80, lengthCm: 120 }],
    {
      gramsPerSquareMeter: 850,
      materialRows: [
        {
          key: "40x60",
          packageLengthCm: 20,
          packageWidthCm: 16,
          packageHeightCm: 6,
        },
      ],
    },
  );

  assert.equal(sizes[0].areaSquareMeters, 0.96);
  assert.equal(sizes[0].weightGrams, 816);
  assert.equal(sizes[0].packageMatch, "missing");
  assert.equal(sizes[0].packageLengthCm, "");
  assert.equal(sizes[0].packageWidthCm, "");
  assert.equal(sizes[0].packageHeightCm, "");
});
