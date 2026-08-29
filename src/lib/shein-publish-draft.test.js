import test from "node:test";
import assert from "node:assert/strict";
import {
  buildNewProductDraft,
  buildProductAttributeList,
  buildPublishImagePlan,
  buildSkuDrafts,
} from "./shein-publish-draft.js";

test("builds only documented product attribute rows and blocks missing per-product values", () => {
  const result = buildProductAttributeList({
    fields: [
      { id: 77, name: "季节", typeCode: 4, modeCode: 3, required: true },
      { id: 128, name: "场合", typeCode: 4, modeCode: 4, required: true },
      { id: 87, name: "尺寸", typeCode: 1, modeCode: 2, required: true },
    ],
    templateValues: {
      77: { valueIds: ["284"] },
      128: { valueIds: ["992"], customValue: "客厅" },
    },
    perProductFieldIds: ["128"],
  });

  assert.deepEqual(result.items, [
    { attribute_id: 77, attribute_value_id: 284 },
  ]);
  assert.deepEqual(result.unresolved, [
    {
      fieldId: "128",
      fieldName: "场合",
      reason: "需要为当前商品单独填写",
    },
  ]);
});

test("uses the real picture switch to choose SPU or legacy SKC gallery placement", () => {
  const product = {
    main: [{ id: "main", file: { name: "main.jpg" } }],
    detail: [{ id: "detail", file: { name: "detail.jpg" } }],
  };
  const legacy = buildPublishImagePlan({
    product,
    tailTemplate: {
      id: "tail",
      name: "材质尾图",
      images: [{ id: "tail-1", originalName: "tail.jpg" }],
    },
    pictureConfig: [
      { field_key: "switch_spu_picture", is_true: false },
      { field_key: "skc_image_detail_show", is_true: true },
      { field_key: "skc_image_detail_required", is_true: true },
    ],
  });
  assert.equal(legacy.scheme, "legacy-skc");
  assert.deepEqual(
    legacy.uploads.slice(0, 3).map((item) => [
      item.targetLevel,
      item.imageType,
      item.imageSort,
      item.source,
    ]),
    [
      ["skc", 1, 1, "product"],
      ["skc", 2, 2, "product"],
      ["skc", 2, 3, "tail-template"],
    ],
  );

  const modern = buildPublishImagePlan({
    product,
    pictureConfig: [
      { field_key: "switch_spu_picture", is_true: true },
      { field_key: "spu_image_detail_show", is_true: true },
    ],
  });
  assert.equal(modern.scheme, "new-spu");
  assert.equal(modern.uploads[0].targetLevel, "spu");
});

test("builds one documented SKU payload per size and reports missing supplier data", () => {
  const result = buildSkuDrafts({
    rows: [
      {
        id: "40x60",
        sheinValueLabel: "40*60",
        sheinAttributeId: 87,
        sheinAttributeValueId: 474,
        packageLengthCm: 42,
        packageWidthCm: 8,
        packageHeightCm: 8,
        weightGrams: 240,
      },
    ],
    skuInputs: {
      "40x60": {
        supplierSku: "RUG-40X60",
        costPrice: "12.50",
        inventoryNum: 0,
      },
    },
    businessMode: "full",
    currency: "CNY",
  });
  assert.deepEqual(result.blockers, []);
  assert.deepEqual(result.items[0].payload, {
    supplier_sku: "RUG-40X60",
    length: "42",
    width: "8",
    height: "8",
    length_width_height_unit: "cm",
    weight: 240,
    weight_unit: "g",
    mall_state: 1,
    stock_info_list: [{ inventory_num: 0 }],
    sale_attribute_list: [
      { attribute_id: 87, attribute_value_id: 474 },
    ],
    cost_info: { cost_price: "12.50", currency: "CNY" },
    stop_purchase: 1,
  });
});

test("honors category-specific optional SKU measurements and converts supported units", () => {
  const optional = buildSkuDrafts({
    rows: [{ id: "one" }],
    skuInputs: {
      one: { supplierSku: "RUG-ONE", costPrice: "10", inventoryNum: 0 },
    },
    currency: "CNY",
    weightConfig: { is_required: false, available_units: ["g"] },
    dimensionConfig: { is_required: "false", available_units: ["cm"] },
  });
  assert.deepEqual(optional.blockers, []);
  assert.equal("weight" in optional.items[0].payload, false);
  assert.equal("length" in optional.items[0].payload, false);

  const converted = buildSkuDrafts({
    rows: [{
      id: "converted",
      packageLengthCm: 30.48,
      packageWidthCm: 30.48,
      packageHeightCm: 30.48,
      weightGrams: 453.59237,
    }],
    skuInputs: {
      converted: { supplierSku: "RUG-IMPERIAL", costPrice: "10", inventoryNum: 0 },
    },
    currency: "CNY",
    weightConfig: { is_required: true, available_units: ["lb"] },
    dimensionConfig: { is_required: true, available_units: ["Ft"] },
  });
  assert.deepEqual(converted.blockers, []);
  assert.equal(converted.items[0].payload.weight, 1);
  assert.equal(converted.items[0].payload.weight_unit, "lb");
  assert.equal(converted.items[0].payload.length, "1");
  assert.equal(converted.items[0].payload.length_width_height_unit, "Ft");
});

test("composes a new product skeleton but keeps local images outside the API payload", () => {
  const draft = buildNewProductDraft({
    categoryId: 3155,
    productTypeId: 991,
    defaultLanguage: "zh-cn",
    currency: "CNY",
    product: {
      id: "rug-1",
      name: "装饰地毯",
      main: [{ id: "main", file: { name: "main.jpg" } }],
      detail: [{ id: "detail", file: { name: "detail.jpg" } }],
    },
    productFields: {
      supplierCode: "RUG-001",
      skcSaleAttributeId: 27,
      skcSaleAttributeValueId: 100,
    },
    attributeFields: [],
    sizeRows: [
      {
        id: "size",
        sheinAttributeId: 87,
        sheinAttributeValueId: 474,
        packageLengthCm: 40,
        packageWidthCm: 8,
        packageHeightCm: 8,
        weightGrams: 300,
      },
    ],
    skuInputs: {
      size: {
        supplierSku: "RUG-001-40X60",
        costPrice: "15",
        inventoryNum: 0,
      },
    },
    pictureConfig: [
      { field_key: "switch_spu_picture", is_true: false },
      { field_key: "skc_image_detail_required", is_true: true },
    ],
    fillStandardList: [
      { field_key: "shelf_require", show: false, required: false },
      { field_key: "sample_spec", show: true, required: true },
    ],
  });

  assert.equal(draft.blockers.length, 0);
  assert.equal(draft.payload.is_spu_pic, false);
  assert.equal("image_info" in draft.payload.skc_list[0], false);
  assert.equal(draft.pendingUploadCount, 2);
  assert.equal(draft.readyForPreflight, true);
  assert.equal("shelf_require" in draft.payload, false);
  assert.deepEqual(draft.payload.sample_info, {
    sample_spec: {
      main_spec: {
        attribute_id: 27,
        attribute_value_id: 100,
      },
      sub_spec_list: [
        {
          attribute_id: "87",
          attribute_value_id: "474",
        },
      ],
    },
    sample_judge_type: 2,
    reserve_sample_flag: 2,
    spot_flag: 1,
  });
});
