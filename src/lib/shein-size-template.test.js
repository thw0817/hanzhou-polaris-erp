import test from "node:test";
import assert from "node:assert/strict";
import {
  applySheinSizeOption,
  buildSizeAttributeList,
  filterSheinSizeOptions,
  parseSheinSizeLabel,
  validateSizeTemplate,
} from "./shein-size-template.js";

const sizeFields = [
  { id: 118, name: "宽度 (cm)", required: true },
  { id: 55, name: "长度 (cm)", required: true },
  { id: 32, name: "直径 (cm)", required: false },
];

test("filters SHEIN sizes with common multiplication symbols", () => {
  const options = [
    { id: 1, label: "40*60", fieldName: "尺寸" },
    { id: 2, label: "50×80", fieldName: "尺寸" },
  ];
  assert.equal(filterSheinSizeOptions(options, "40x60")[0].id, 1);
  assert.equal(filterSheinSizeOptions(options, "50*80")[0].id, 2);
});

test("parses rectangle and round dimensions from SHEIN labels", () => {
  assert.deepEqual(parseSheinSizeLabel("40*60 · 尺寸", "rectangle"), {
    widthCm: 40,
    lengthCm: 60,
    diameterCm: null,
  });
  assert.deepEqual(parseSheinSizeLabel("圆形 80cm", "round"), {
    diameterCm: 80,
    widthCm: 80,
    lengthCm: 80,
  });
});

test("selection creates documented size_attribute_list associations", () => {
  const row = applySheinSizeOption(
    { id: "row-1" },
    { id: 100, fieldId: 87, label: "40*60" },
    { sizeAttributeFields: sizeFields },
  );
  assert.equal(row.sizeAttributeValues["118"], "40");
  assert.equal(row.sizeAttributeValues["55"], "60");
  assert.deepEqual(buildSizeAttributeList([row], sizeFields), [
    {
      attribute_id: 118,
      attribute_extra_value: "40",
      relate_sale_attribute_id: 87,
      relate_sale_attribute_value_id: 100,
    },
    {
      attribute_id: 55,
      attribute_extra_value: "60",
      relate_sale_attribute_id: 87,
      relate_sale_attribute_value_id: 100,
    },
  ]);
});

test("validates required SHEIN mappings and chart fields", () => {
  const invalid = validateSizeTemplate({
    name: "矩形地毯",
    rows: [{ id: "row-1", sizeAttributeValues: {} }],
    sizeAttributeFields: sizeFields,
  });
  assert.equal(invalid.valid, false);
  assert.match(invalid.issues.join("\n"), /SHEIN尺寸值/);
  assert.match(invalid.issues.join("\n"), /宽度/);
});
