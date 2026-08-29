import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProductContentStage,
  resolveProductDetailPictureRule,
} from "./product-content-contract.js";

test("builds title and optional description with the live default language", () => {
  const result = buildProductContentStage({
    title: "  现代装饰地毯  ",
    description: "  短绒防滑地毯  ",
    defaultLanguage: "zh-cn",
    titleMaxLength: 250,
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.multiLanguageNameList, [
    { language: "zh-cn", name: "现代装饰地毯" },
  ]);
  assert.deepEqual(result.multiLanguageDescList, [
    { language: "zh-cn", name: "短绒防滑地毯" },
  ]);
});

test("fails closed for missing language, dynamic title limits and emoji", () => {
  const result = buildProductContentStage({
    title: "地毯🎉",
    description: "描述🎉",
    defaultLanguage: "",
    titleMaxLength: 2,
  });

  assert.deepEqual(
    result.blockers.map((item) => item.code),
    [
      "PRODUCT_TITLE_TOO_LONG",
      "PRODUCT_TITLE_EMOJI_NOT_ALLOWED",
      "DEFAULT_LANGUAGE_MISSING",
      "PRODUCT_DESCRIPTION_EMOJI_NOT_ALLOWED",
    ],
  );
});

test("recognizes both documented detail-picture keys returned by SHEIN", () => {
  assert.deepEqual(
    resolveProductDetailPictureRule([{
      field_key: "product_detail_picture",
      show: true,
      required: true,
    }]),
    {
      returned: true,
      show: true,
      required: true,
      fieldKey: "product_detail_picture",
    },
  );
  assert.deepEqual(
    resolveProductDetailPictureRule([{
      field_key: "product_detail_pic",
      show: true,
      required: false,
    }]),
    {
      returned: true,
      show: true,
      required: false,
      fieldKey: "product_detail_pic",
    },
  );
});
