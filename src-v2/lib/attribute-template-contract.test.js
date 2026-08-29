import assert from "node:assert/strict";
import test from "node:test";
import {
  attributeTemplatePaths,
  buildAttributeFields,
  flattenLeafCategories,
  isCompositionPercentageField,
  normalizeCategoryTree,
  validateAttributeAssignments,
} from "./attribute-template-contract.js";

test("V2 attribute templates use the existing store-scoped web endpoints", () => {
  assert.deepEqual(attributeTemplatePaths("store / 1", "template / 1"), {
    categories: "/v1/web/stores/store%20%2F%201/publish/categories",
    schema: "/v1/web/stores/store%20%2F%201/publish/schema",
    schemaCoverage:
      "/v1/web/stores/store%20%2F%201/publish/schema-coverage",
    schemaSync:
      "/v1/web/stores/store%20%2F%201/publish/schema-sync",
    associatedRules:
      "/v1/web/stores/store%20%2F%201/publish/associated-rules",
    templates:
      "/v1/web/stores/store%20%2F%201/publish-templates?type=attribute",
    template:
      "/v1/web/stores/store%20%2F%201/publish-templates/template%20%2F%201",
  });
});

test("V2 category options contain only SHEIN leaf categories", () => {
  assert.deepEqual(
    flattenLeafCategories({
      data: [{
        category_id: 3000,
        category_name: "家居纺织",
        last_category: false,
        children: [{
          category_id: 3155,
          category_name: "区域地毯",
          product_type_id: 991,
          last_category: true,
          children: [],
        }],
      }],
    }),
    [{
      categoryId: "3155",
      productTypeId: "991",
      name: "区域地毯",
      path: ["家居纺织", "区域地毯"],
    }],
  );
});

test("V2 category tree preserves SHEIN hierarchy for cascaded selection", () => {
  assert.deepEqual(
    normalizeCategoryTree({
      data: [{
        category_id: 3000,
        category_name: "家用纺织品",
        last_category: false,
        children: [{
          category_id: 3100,
          category_name: "地毯和地垫",
          last_category: false,
          children: [{
            category_id: 3155,
            category_name: "门垫",
            product_type_id: 991,
            last_category: true,
            children: [],
          }],
        }],
      }],
    }),
    [{
      categoryId: "3000",
      productTypeId: "",
      name: "家用纺织品",
      lastCategory: false,
      children: [{
        categoryId: "3100",
        productTypeId: "",
        name: "地毯和地垫",
        lastCategory: false,
        children: [{
          categoryId: "3155",
          productTypeId: "991",
          name: "门垫",
          lastCategory: true,
          children: [],
        }],
      }],
    }],
  );
});

test("V2 attribute fields keep only editable product attributes", () => {
  const fields = buildAttributeFields({
    data: [{
      product_type_id: "991",
      attribute_infos: [
        {
          attribute_id: "10",
          attribute_name: "颜色",
          attribute_status: 3,
          attribute_type: 1,
          attribute_mode: 2,
          attribute_is_show: 1,
        },
        {
          attribute_id: "87",
          attribute_name: "尺寸",
          attribute_status: 3,
          attribute_type: 1,
          attribute_label: 0,
          attribute_mode: 2,
          attribute_is_show: 1,
        },
        {
          attribute_id: "118",
          attribute_name: "宽度",
          attribute_status: 3,
          attribute_type: 2,
          attribute_mode: 0,
          attribute_is_show: 1,
        },
        {
          attribute_id: "300",
          attribute_name: "主要材质",
          attribute_status: 3,
          attribute_type: 4,
          data_dimension: 1,
          attribute_mode: 3,
          attribute_input_num: 1,
          attribute_is_show: 1,
          attribute_remark_list: [1, 2, 4],
          attribute_value_info_list: [{
            attribute_value_id: "301",
            attribute_value: "聚酯纤维",
            is_show: 1,
          }],
        },
        {
          attribute_id: "301",
          attribute_name: "填充物",
          attribute_status: 3,
          attribute_type: 3,
          data_dimension: 2,
          attribute_mode: 1,
          attribute_is_show: 1,
          attribute_value_info_list: [{
            attribute_value_id: "302",
            attribute_value: "聚酯纤维",
            is_show: 1,
          }],
        },
        {
          attribute_id: "900",
          attribute_name: "SKU 成分",
          attribute_status: 2,
          attribute_type: 3,
          data_dimension: 3,
          attribute_mode: 4,
          attribute_is_show: 1,
        },
      ],
    }],
  }, "991");

  assert.equal(fields.length, 2);
  assert.equal(fields[0].id, "300");
  assert.equal(fields[0].required, true);
  assert.equal(fields[0].dataDimension, 1);
  assert.deepEqual(fields[0].values, [{
    id: "301",
    label: "聚酯纤维",
  }]);
  assert.deepEqual(fields[0].remarks, ["重要", "合规", "关务"]);
  assert.equal(fields[1].id, "301");
  assert.equal(fields[1].name, "填充物");
});

test("V2 attribute fields preserve every required and optional product attribute", () => {
  const fields = buildAttributeFields({
    data: [{
      product_type_id: "991",
      attribute_infos: [
        {
          attribute_id: "300",
          attribute_name: "主要材质",
          attribute_status: 3,
          attribute_type: 4,
          data_dimension: 1,
          attribute_mode: 3,
          attribute_is_show: 1,
        },
        {
          attribute_id: "310",
          attribute_name: "商品形状",
          attribute_status: 3,
          attribute_type: 4,
          data_dimension: 1,
          attribute_mode: 3,
          attribute_is_show: 1,
        },
        {
          attribute_id: "320",
          attribute_name: "风格",
          attribute_status: 2,
          attribute_type: 3,
          data_dimension: 1,
          attribute_mode: 1,
          attribute_is_show: 1,
        },
        {
          attribute_id: "330",
          attribute_name: "内部停用字段",
          attribute_status: 1,
          attribute_type: 4,
          data_dimension: 1,
          attribute_mode: 3,
          attribute_is_show: 1,
        },
      ],
    }],
  }, "991");

  assert.deepEqual(
    fields.map((field) => ({ name: field.name, required: field.required })),
    [
      { name: "主要材质", required: true },
      { name: "商品形状", required: true },
      { name: "风格", required: false },
    ],
  );
});

test("V2 attribute validation lists every missing required field", () => {
  const result = validateAttributeAssignments([
    { id: "300", name: "主要材质", required: true },
    { id: "301", name: "风格", required: true },
    { id: "302", name: "场景", required: false },
  ], {
    300: { valueIds: ["301"], customValue: "" },
  });

  assert.deepEqual(result.missingFieldIds, ["301"]);
  assert.deepEqual(result.missingFieldNames, ["风格"]);
});

test("V2 attribute validation requires the numeric suffix for customs fields", () => {
  const result = validateAttributeAssignments([
    {
      id: "62",
      name: "成分",
      required: true,
      dataDimension: 2,
      modeCode: 4,
    },
    {
      id: "1000411",
      name: "数量",
      required: true,
      dataDimension: 2,
      modeCode: 4,
    },
  ], {
    62: { valueIds: ["526"], customValue: "" },
    1000411: { valueIds: ["1002451"], customValue: "1" },
  });

  assert.deepEqual(result.invalidFieldIds, ["62"]);
  assert.equal(result.missingReasons["62"], "选择官方值后还需要填写数字附加值");
});

test("only composition customs fields use percentage input semantics", () => {
  assert.equal(isCompositionPercentageField({
    id: "62",
    name: "成分",
    dataDimension: 2,
    modeCode: 4,
  }), true);
  assert.equal(isCompositionPercentageField({
    id: "1000411",
    name: "数量",
    dataDimension: 2,
    modeCode: 4,
  }), false);
});
