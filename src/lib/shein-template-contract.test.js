import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAttributeFields,
  buildComplianceRequirements,
  canBindAgency,
  findCategoryTrail,
  flattenLeafCategories,
  toCategorySelection,
  validateAttributeAssignments,
  validateTemplateSync,
} from "./shein-template-contract.js";

test("flattens only SHEIN leaf categories and preserves product_type_id", () => {
  const leaves = flattenLeafCategories({
    data: [
      {
        category_id: 1,
        category_name: "A",
        last_category: false,
        children: [
          {
            category_id: 2,
            product_type_id: 99,
            category_name: "B",
            last_category: true,
            children: [],
          },
        ],
      },
    ],
  });
  assert.deepEqual(leaves, [
    { categoryId: 2, productTypeId: 99, name: "B", path: ["A", "B"] },
  ]);
});

test("finds a category trail for the cascading SHEIN picker", () => {
  const info = {
    data: [
      {
        category_id: 1,
        category_name: "家用纺织品",
        children: [
          {
            category_id: 2,
            category_name: "地毯和地垫",
            children: [
              {
                category_id: 3,
                product_type_id: 991,
                category_name: "装饰地毯",
                last_category: true,
              },
            ],
          },
        ],
      },
    ],
  };
  const trail = findCategoryTrail(info, 3);
  assert.deepEqual(trail.map((node) => node.category_id), [1, 2, 3]);
  assert.deepEqual(toCategorySelection(trail), {
    categoryId: 3,
    productTypeId: 991,
    name: "装饰地毯",
    path: ["家用纺织品", "地毯和地垫", "装饰地毯"],
  });
});

test("builds controls from attribute_status, attribute_type and attribute_mode", () => {
  const fields = buildAttributeFields(
    {
      data: [
        {
          product_type_id: 99,
          attribute_infos: [
            {
              attribute_id: 87,
              attribute_name: "尺寸",
              attribute_status: 3,
              attribute_type: 1,
              attribute_mode: 2,
              attribute_input_num: 1,
              attribute_value_info_list: [
                {
                  attribute_value_id: 474,
                  attribute_value: "单一尺寸",
                  is_show: 1,
                  is_custom_attribute_value: false,
                },
              ],
            },
          ],
        },
      ],
    },
    99,
  );
  assert.equal(fields[0].required, true);
  assert.equal(fields[0].type, "销售属性");
  assert.equal(fields[0].mode, "销售属性下拉单选");
  assert.deepEqual(fields[0].values, [
    { id: 474, label: "单一尺寸", labelEn: "", custom: false },
  ]);
});

test("required attributes accept a template value or an explicit per-product policy", () => {
  const fields = [
    { id: 77, name: "季节", required: true },
    { id: 128, name: "场合", required: true },
    { id: 217, name: "特征", required: false },
  ];
  assert.deepEqual(
    validateAttributeAssignments(fields, { 77: { valueIds: ["284"] } }, []).issues,
    ["必填属性“场合”需要填写模板值或设为单品填写"],
  );
  assert.equal(
    validateAttributeAssignments(
      fields,
      { 77: { valueIds: ["284"] } },
      ["128"],
    ).valid,
    true,
  );
});

test("classifies compliance support only from documented response fields", () => {
  const rows = buildComplianceRequirements({
    data: [
      {
        skcName: "S1",
        items: [
          { complianceGroupCode: "ZSZZL" },
          { complianceGroupCode: "HGXXL", isManualProductWarning: true },
          { complianceGroupCode: "HGXXL", isAutoProductWarning: true },
          { complianceGroupCode: "SPTL" },
        ],
      },
    ],
  });
  assert.deepEqual(rows.map((row) => row.support), [
    "api",
    "api",
    "platform-auto",
    "unsupported",
  ]);
});

test("uses the documented agency binding condition", () => {
  assert.equal(canBindAgency({ agencyStatus: 0, applyStatus: 1 }), true);
  assert.equal(canBindAgency({ agencyStatus: 0, applyStatus: 2 }), true);
  assert.equal(canBindAgency({ agencyStatus: 1, applyStatus: 2 }), false);
});

test("blocks template save before SHEIN data is synchronized", () => {
  const result = validateTemplateSync({
    type: "compliance",
    name: "合规模板",
    referenceSkc: "S1",
    syncStatus: "idle",
  });
  assert.equal(result.valid, false);
  assert.ok(result.issues.includes("尚未读取SHEIN接口数据"));
});
