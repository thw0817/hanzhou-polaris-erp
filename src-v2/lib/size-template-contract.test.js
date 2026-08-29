import assert from "node:assert/strict";
import test from "node:test";
import { validateSizeTemplateDraft } from "./size-template-contract.js";

test("normalizes a size template to shared color, size text, length and width", () => {
  const result = validateSizeTemplateDraft({
    name: "  常用地毯尺寸  ",
    colorText: " 多色 ",
    rows: [{
      id: "row-1",
      sizeText: " 40*60cm ",
      lengthCm: "60",
      widthCm: "40",
      price: 99,
      stock: 20,
      weight: 500,
    }],
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.data, {
    name: "常用地毯尺寸",
    colorText: "多色",
    rows: [{ sizeText: "40 × 60 cm", lengthCm: 40, widthCm: 60 }],
  });
});

test("normalizes the home-textile unit prefix from 件 to pc", () => {
  const result = validateSizeTemplateDraft({
    name: "地毯尺寸",
    colorText: "多色",
    rows: [{ sizeText: "1件 60*40cm", lengthCm: 60, widthCm: 40 }],
  });

  assert.equal(result.data.rows[0].sizeText, "1pc 40 × 60 cm");
});

test("reports every missing size template field", () => {
  const result = validateSizeTemplateDraft({
    name: "",
    colorText: "",
    rows: [
      { id: "row-1", sizeText: "", lengthCm: "0", widthCm: "" },
      { id: "row-2", sizeText: "80*120cm", lengthCm: "abc", widthCm: "80" },
    ],
  });

  assert.equal(result.valid, false);
  assert.equal(result.errors.name, "请填写模板名称");
  assert.equal(result.errors.colorText, "请填写共享颜色");
  assert.deepEqual(result.errors.rows, [
    {
      sizeText: "请填写尺寸显示名",
      lengthCm: "长必须是大于 0 的数字",
      widthCm: "宽必须是大于 0 的数字",
    },
    {
      lengthCm: "长必须是大于 0 的数字",
    },
  ]);
});

test("requires at least one size row", () => {
  const result = validateSizeTemplateDraft({
    name: "常用尺寸",
    colorText: "蓝色",
    rows: [],
  });

  assert.equal(result.valid, false);
  assert.equal(result.errors.rowsMessage, "至少添加一行尺寸");
});
