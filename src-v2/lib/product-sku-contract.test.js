import assert from "node:assert/strict";
import test from "node:test";
import {
  applyGramsPerSquareMeter,
  applyInventoryToAll,
  applyPackagingTemplate,
  applyPricePerSquareMeter,
  applySharedSkuImage,
  applySupplierSkuPrefix,
  assignSkuPreviewImage,
  autoMapSkuPreviewImages,
  buildSaleAttributeSchema,
  buildSkuPublishPreview,
  buildSkuStageFromSizeTemplate,
  formatHomeTextileCustomSize,
  ensureSupplierSkuRows,
  resolveMainSaleAttributeValue,
  validateSkuStage,
} from "./product-sku-contract.js";

const saleSchema = buildSaleAttributeSchema({
  data: [{
    product_type_id: "991",
    main_attribute_status: 2,
    attribute_infos: [
      {
        attribute_id: 10,
        attribute_name: "颜色",
        attribute_type: 1,
        attribute_label: 1,
        attribute_status: 3,
        attribute_is_show: 1,
        attribute_value_info_list: [
          { attribute_value_id: 101, attribute_value: "多色", is_show: 1 },
        ],
      },
      {
        attribute_id: 87,
        attribute_name: "尺寸",
        attribute_type: 1,
        attribute_label: 0,
        attribute_status: 3,
        attribute_is_show: 1,
        attribute_mode: 4,
        attribute_value_info_list: [
          { attribute_value_id: 201, attribute_value: "40×60", is_show: 1 },
          { attribute_value_id: 202, attribute_value: "80×120", is_show: 1 },
        ],
      },
    ],
  }],
}, "991");

test("maps one shared color and every size only to current SHEIN sale values", () => {
  const result = buildSkuStageFromSizeTemplate({
    id: "size-template-1",
    data: {
      colorText: "多色",
      rows: [
        { sizeText: "40*60", lengthCm: 60, widthCm: 40 },
        { sizeText: "80x120", lengthCm: 120, widthCm: 80 },
      ],
    },
  }, saleSchema);

  assert.deepEqual(result.colorMapping, {
    attributeId: "10",
    attributeName: "颜色",
    valueId: "101",
    valueLabel: "多色",
  });
  assert.equal(result.rows[0].sizeMapping.valueId, "201");
  assert.equal(result.rows[0].sizeText, "40 × 60 cm");
  assert.equal(result.rows[1].sizeMapping.valueId, "202");
});

test("maps home textile template dimensions to a SHEIN value with 1pc and cm text", () => {
  const result = buildSkuStageFromSizeTemplate({
    id: "size-template-home-textile-preset",
    data: {
      rows: [{ sizeText: "60 × 40 cm", lengthCm: 60, widthCm: 40 }],
    },
  }, {
    mainAttributeStatus: 2,
    fields: [{
      id: "87",
      name: "尺寸",
      required: true,
      labelCode: 0,
      customValueAllowed: false,
      values: [{ id: "201", label: "1pc 60cm*40cm" }],
    }],
  });

  assert.equal(result.rows[0].sizeMapping.valueId, "201");
});

test("converts a legacy 件 size label to SHEIN's 1pc custom value", () => {
  assert.equal(
    formatHomeTextileCustomSize("1件 60*40cm", 60, 40),
    "1pc 40cm*60cm",
  );
});

test("uses a real sale attribute field with custom_attribute_value when SHEIN has no preset size", () => {
  const result = buildSkuStageFromSizeTemplate({
    id: "size-template-custom",
    data: {
      colorText: "多色",
      rows: [{ sizeText: "120x180", lengthCm: 180, widthCm: 120 }],
    },
  }, {
    mainAttributeStatus: 2,
    fields: [
      {
        id: "10",
        name: "颜色",
        required: true,
        labelCode: 1,
        values: [{ id: "101", label: "多色" }],
      },
      {
        id: "87",
        name: "尺寸",
        required: true,
        labelCode: 0,
        customValueAllowed: true,
        values: [{ id: "201", label: "40×60" }],
      },
    ],
  });

  assert.equal(result.rows[0].sizeMapping.attributeId, "87");
  assert.equal(result.rows[0].sizeMapping.valueId, "");
  assert.equal(result.rows[0].sizeMapping.customValue, "1pc 120cm*180cm");
  const preview = buildSkuPublishPreview({
    supplierCode: "RUG-20260822",
    colorMapping: result.colorMapping,
    rows: ensureSupplierSkuRows(result.rows, "RUG-20260822").map((row) => ({
      ...row,
      costPrice: "10",
      inventoryNum: 1,
      packageLengthCm: 20,
      packageWidthCm: 16,
      packageHeightCm: 6,
    })),
    currency: "CNY",
    weightConfig: { is_required: false },
    dimensionConfig: { is_required: false },
  });
  assert.deepEqual(preview.skc.sku_list[0].sale_attribute_list, [{
    attribute_id: 87,
    custom_attribute_value: "1pc 120cm*180cm",
  }]);
});

test("matches an official color first and uses an allowed custom main sale value otherwise", () => {
  const customColorSchema = {
    mainAttributeStatus: 2,
    fields: [{
      id: "27",
      name: "颜色",
      required: true,
      labelCode: 1,
      customValueAllowed: true,
      values: [{ id: "101", label: "蓝色" }],
    }],
    sizeFields: [],
  };

  assert.deepEqual(resolveMainSaleAttributeValue(customColorSchema, "蓝色"), {
    attributeId: "27",
    attributeName: "颜色",
    valueId: "101",
    valueLabel: "蓝色",
  });
  const customMapping = resolveMainSaleAttributeValue(customColorSchema, "多色");
  assert.deepEqual(customMapping, {
    attributeId: "27",
    attributeName: "颜色",
    valueId: "",
    valueLabel: "多色",
    customValue: "多色",
  });

  const preview = buildSkuPublishPreview({
    supplierCode: "RUG-CUSTOM-COLOR",
    colorMapping: customMapping,
    rows: [{
      id: "sku-1",
      sizeText: "40 × 60 cm",
      lengthCm: 60,
      widthCm: 40,
      sizeMapping: null,
      supplierSku: "RUG-CUSTOM-COLOR-1",
      costPrice: "10",
      inventoryNum: 1,
    }],
    currency: "CNY",
  });
  assert.deepEqual(preview.skc.sale_attribute, {
    attribute_id: 27,
    custom_attribute_value: "多色",
  });
  const validation = validateSkuStage({
    saleSchema: customColorSchema,
    supplierCode: "RUG-CUSTOM-COLOR",
    sizeTemplateId: "size-template-1",
    colorMapping: customMapping,
    rows: preview.skc.sku_list.map(() => ({
      id: "sku-1",
      sizeText: "40 × 60 cm",
      lengthCm: 60,
      widthCm: 40,
      sizeMapping: null,
      supplierSku: "RUG-CUSTOM-COLOR-1",
      costPrice: "10",
      inventoryNum: 1,
      packageLengthCm: 20,
      packageWidthCm: 16,
      packageHeightCm: 6,
    })),
    packagingTemplateId: "packaging-1",
    packagingMaterial: "天鹅绒",
    currency: "CNY",
  });
  assert.equal(validation.blockers.some((item) => item.code === "COLOR_SALE_VALUE_REQUIRED"), false);
});

test("does not create a custom main sale value without current SHEIN permission", () => {
  assert.equal(resolveMainSaleAttributeValue({
    mainAttributeStatus: 2,
    fields: [{
      id: "27",
      name: "颜色",
      required: true,
      labelCode: 1,
      customValueAllowed: false,
      values: [{ id: "101", label: "蓝色" }],
    }],
    sizeFields: [],
  }, "多色"), null);
});

test("does not invent a custom size when the category has no custom permission", () => {
  const result = buildSkuStageFromSizeTemplate({
    id: "size-template-no-custom",
    data: {
      colorText: "多色",
      rows: [{ sizeText: "1pc 60*40", lengthCm: 60, widthCm: 40 }],
    },
  }, {
    mainAttributeStatus: 2,
    fields: [
      { id: "10", name: "颜色", required: true, labelCode: 1, customValueAllowed: false, values: [{ id: "101", label: "多色" }] },
      { id: "87", name: "尺寸", required: true, labelCode: 0, customValueAllowed: false, values: [] },
    ],
  });

  assert.equal(result.rows[0].sizeMapping, null);
  assert.equal(formatHomeTextileCustomSize("1pc 60*40", 60, 40), "1pc 40cm*60cm");
});

test("uses the official custom-attribute permission for a preset-only size field", () => {
  const schema = buildSaleAttributeSchema({
    data: [{
      product_type_id: "8658",
      main_attribute_status: 2,
      attribute_infos: [{
        attribute_id: 87,
        attribute_name: "尺寸",
        attribute_type: 1,
        attribute_label: 0,
        attribute_status: 3,
        attribute_is_show: 1,
        attribute_mode: 2,
        attribute_value_info_list: [{
          attribute_value_id: 201,
          attribute_value: "均码",
          is_show: 1,
        }],
      }],
    }],
  }, "8658", {
    data: [{
      last_category_id: 11932,
      attribute_id: 87,
      has_permission: 1,
    }],
  });

  const result = buildSkuStageFromSizeTemplate({
    id: "size-template-live-category",
    data: {
      rows: [{ sizeText: "40*60", lengthCm: 60, widthCm: 40 }],
    },
  }, schema);

  assert.equal(schema.fields[0].customValueAllowed, true);
  assert.equal(result.rows[0].sizeMapping.customValue, "1pc 40cm*60cm");
});

test("selects the official size field when another type-1 field is present", () => {
  const schema = buildSaleAttributeSchema({
    data: [{
      product_type_id: "8658",
      main_attribute_status: 3,
      attribute_infos: [
        {
          attribute_id: 1001211,
          attribute_name: "件数",
          attribute_type: 1,
          attribute_label: 0,
          attribute_status: 3,
          attribute_is_show: 1,
          attribute_mode: 2,
          attribute_value_info_list: [],
        },
        {
          attribute_id: 27,
          attribute_name: "颜色",
          attribute_type: 1,
          attribute_label: 1,
          attribute_status: 3,
          attribute_is_show: 1,
          attribute_mode: 2,
          attribute_value_info_list: [],
        },
        {
          attribute_id: 87,
          attribute_name: "尺寸",
          attribute_type: 1,
          attribute_label: 0,
          attribute_status: 3,
          attribute_is_show: 1,
          attribute_mode: 2,
          attribute_value_info_list: [{
            attribute_value_id: 201,
            attribute_value: "均码",
            is_show: 1,
          }],
        },
      ],
    }],
  }, "8658", {
    data: [{ attribute_id: 87, has_permission: 1 }],
  });

  const result = buildSkuStageFromSizeTemplate({
    id: "size-template-with-quantity",
    data: { rows: [{ sizeText: "40*60", lengthCm: 60, widthCm: 40 }] },
  }, schema);

  assert.equal(result.rows[0].sizeMapping.attributeId, "87");
  assert.equal(result.rows[0].sizeMapping.customValue, "1pc 40cm*60cm");
});

test("formats permitted home textile custom sizes with SHEIN half-width syntax", () => {
  const result = buildSkuStageFromSizeTemplate({
    id: "size-template-home-textile",
    data: {
      colorText: "多色",
      rows: [{ sizeText: "1pc 60×40", lengthCm: 60, widthCm: 40 }],
    },
  }, {
    mainAttributeStatus: 2,
    fields: [
      { id: "10", name: "颜色", required: true, labelCode: 1, customValueAllowed: false, values: [{ id: "101", label: "多色" }] },
      { id: "87", name: "尺寸", required: true, labelCode: 0, customValueAllowed: true, values: [] },
    ],
  });

  assert.equal(result.rows[0].sizeMapping.customValue, "1pc 40cm*60cm");
});

test("maps type-2 dimensions to the official size_attribute_list payload", () => {
  const schema = buildSaleAttributeSchema({
    data: [{
      product_type_id: "991",
      main_attribute_status: 2,
      attribute_infos: [
        {
          attribute_id: 10,
          attribute_name: "颜色",
          attribute_type: 1,
          attribute_label: 1,
          attribute_status: 3,
          attribute_is_show: 1,
          attribute_value_info_list: [
            { attribute_value_id: 101, attribute_value: "多色", is_show: 1 },
          ],
        },
        {
          attribute_id: 87,
          attribute_name: "尺寸",
          attribute_type: 1,
          attribute_label: 0,
          attribute_status: 3,
          attribute_is_show: 1,
          attribute_value_info_list: [
            { attribute_value_id: 201, attribute_value: "40×60", is_show: 1 },
          ],
        },
        {
          attribute_id: 118,
          attribute_name: "宽度",
          attribute_type: 2,
          attribute_mode: 0,
          attribute_status: 3,
          attribute_is_show: 1,
        },
        {
          attribute_id: 55,
          attribute_name: "长度",
          attribute_type: 2,
          attribute_mode: 0,
          attribute_status: 3,
          attribute_is_show: 1,
        },
      ],
    }],
  }, "991");
  const stage = buildSkuStageFromSizeTemplate({
    id: "size-template-type-2",
    data: {
      colorText: "多色",
      rows: [{ sizeText: "60×40", lengthCm: 60, widthCm: 40 }],
    },
  }, schema);

  assert.deepEqual(stage.rows[0].sizeAttributeValues, {
    "118": "40",
    "55": "60",
  });
  const preview = buildSkuPublishPreview({
    supplierCode: "RUG-20260822",
    colorMapping: stage.colorMapping,
    rows: ensureSupplierSkuRows(stage.rows, "RUG-20260822").map((row) => ({
      ...row,
      costPrice: "10",
      inventoryNum: 1,
      packageLengthCm: 20,
      packageWidthCm: 16,
      packageHeightCm: 6,
    })),
    sizeAttributeFields: schema.sizeFields,
    currency: "CNY",
    weightConfig: { is_required: false },
    dimensionConfig: { is_required: false },
  });

  assert.deepEqual(preview.size_attribute_list, [
    {
      attribute_id: 118,
      attribute_extra_value: "40",
      relate_sale_attribute_id: 87,
      relate_sale_attribute_value_id: 201,
    },
    {
      attribute_id: 55,
      attribute_extra_value: "60",
      relate_sale_attribute_id: 87,
      relate_sale_attribute_value_id: 201,
    },
  ]);
  assert.deepEqual(preview.skc.sku_list[0].sale_attribute_list, [{
    attribute_id: 87,
    attribute_value_id: 201,
  }]);
});

test("applies packaging only by selected material and finished dimensions", () => {
  const stage = buildSkuStageFromSizeTemplate({
    id: "size-template-1",
    data: {
      colorText: "多色",
      rows: [{ sizeText: "40*60", lengthCm: 60, widthCm: 40 }],
    },
  }, saleSchema);
  const rows = applyPackagingTemplate(stage.rows, {
    data: {
      materials: {
        天鹅绒: [{
          key: "40x60",
          packageLengthCm: 20,
          packageWidthCm: 16,
          packageHeightCm: 6,
        }],
      },
    },
  }, "天鹅绒");

  assert.equal(rows[0].packageMatch, "matched");
  assert.equal(rows[0].packageLengthCm, 20);
  assert.equal(rows[0].areaSquareMeters, 0.24);
});

test("preserves manual package dimensions until an explicit template re-apply", () => {
  const rows = [{
    id: "row-1",
    sizeText: "40×60",
    lengthCm: 60,
    widthCm: 40,
    packageLengthCm: 31,
    packageWidthCm: 21,
    packageHeightCm: 8,
    packageMatch: "manual",
  }];
  const template = {
    data: {
      materials: {
        天鹅绒: [{
          key: "40x60",
          packageLengthCm: 20,
          packageWidthCm: 16,
          packageHeightCm: 6,
        }],
      },
    },
  };

  const preserved = applyPackagingTemplate(rows, template, "天鹅绒");
  assert.equal(preserved[0].packageLengthCm, 31);
  assert.equal(preserved[0].packageMatch, "manual");

  const reapplied = applyPackagingTemplate(rows, template, "天鹅绒", { overwrite: true });
  assert.equal(reapplied[0].packageLengthCm, 20);
  assert.equal(reapplied[0].packageWidthCm, 16);
  assert.equal(reapplied[0].packageHeightCm, 6);
  assert.equal(reapplied[0].packageMatch, "matched");

  const refreshed = applyPackagingTemplate([{
    ...rows[0],
    packageMatch: "matched",
    packageLengthCm: 99,
    packageWidthCm: 99,
    packageHeightCm: 99,
  }], template, "天鹅绒");
  assert.equal(refreshed[0].packageLengthCm, 20);
});

test("preserves partial manual package input while the user fills the row", () => {
  const rows = applyPackagingTemplate([{
    id: "partial",
    sizeText: "60×160",
    packageLengthCm: "23",
    packageWidthCm: "",
    packageHeightCm: "",
    packageMatch: "manual",
  }], {
    data: {
      materials: {
        天鹅绒: [{ minArea: 0, maxArea: 10, lengthCm: 30, widthCm: 20, heightCm: 12 }],
      },
    },
  }, "天鹅绒");

  assert.equal(rows[0].packageLengthCm, "23");
  assert.equal(rows[0].packageWidthCm, "");
  assert.equal(rows[0].packageHeightCm, "");
  assert.equal(rows[0].packageMatch, "manual");
});

test("applies square-meter price, weight and one inventory value to every SKU", () => {
  const rows = [{
    id: "row-1",
    sizeText: "40×60",
    lengthCm: 60,
    widthCm: 40,
    sizeMapping: null,
  }];
  const priced = applyPricePerSquareMeter(rows, "10");
  const weighed = applyGramsPerSquareMeter(priced, "850");
  const stocked = applyInventoryToAll(weighed, "100");

  assert.equal(stocked[0].costPrice, "2.40");
  assert.equal(stocked[0].weightGrams, 204);
  assert.equal(stocked[0].weightSource, "area_estimate");
  assert.equal(stocked[0].inventoryNum, 100);
});

test("generates unique supplier SKUs and shares one image across all size rows", () => {
  const rows = applySupplierSkuPrefix([
    { id: "row-1", sizeText: "40×60" },
    { id: "row-2", sizeText: "40*60" },
  ], "RUG-001");
  const imaged = applySharedSkuImage(rows, "asset-sku-1");

  assert.deepEqual(
    imaged.map((row) => row.supplierSku),
    ["RUG-001-40X60", "RUG-001-40X60-2"],
  );
  assert.ok(imaged.every((row) => row.imageAssetId === "asset-sku-1"));
  assert.ok(imaged.every((row) => row.imageAssetSource === "shared_sku"));
});

test("maps SKU preview images by exact supplier SKU or unique size token", () => {
  const rows = [
    {
      id: "row-1",
      sizeText: "40×60 cm",
      supplierSku: "RUG-001-40X60",
      sizeMapping: { valueLabel: "40×60" },
    },
    {
      id: "row-2",
      sizeText: "80×120 cm",
      supplierSku: "RUG-001-80X120",
      sizeMapping: { valueLabel: "80×120" },
    },
  ];
  const result = autoMapSkuPreviewImages(rows, [
    { id: "asset-1", originalName: "RUG-001-40X60_front.jpg" },
    { id: "asset-2", originalName: "sku_80x120.png" },
  ]);

  assert.deepEqual(result.rows.map((row) => row.imageAssetId), ["asset-1", "asset-2"]);
  assert.ok(result.rows.every((row) => row.imageAssetSource === "per_sku_filename"));
  assert.deepEqual(result.unmatchedAssetIds, []);
  assert.deepEqual(result.ambiguousAssetIds, []);
});

test("does not map ambiguous or unmarked SKU preview images by upload order", () => {
  const rows = [
    { id: "row-1", sizeText: "40×60", supplierSku: "RUG-A" },
    { id: "row-2", sizeText: "40×60", supplierSku: "RUG-B" },
  ];
  const result = autoMapSkuPreviewImages(rows, [
    { id: "asset-1", originalName: "sku_40x60.jpg" },
    { id: "asset-2", originalName: "preview.jpg" },
  ]);

  assert.ok(result.rows.every((row) => !row.imageAssetId));
  assert.deepEqual(result.ambiguousAssetIds, ["asset-1"]);
  assert.deepEqual(result.unmatchedAssetIds, ["asset-2"]);
});

test("manual SKU preview mapping records an explicit row assignment", () => {
  const rows = assignSkuPreviewImage([
    { id: "row-1", sizeText: "40×60" },
    { id: "row-2", sizeText: "80×120" },
  ], "row-2", "asset-2");

  assert.equal(rows[0].imageAssetId, undefined);
  assert.equal(rows[1].imageAssetId, "asset-2");
  assert.equal(rows[1].imageAssetSource, "per_sku_manual");
});

test("blocks stale mappings and unmatched packaging without guessing", () => {
  const result = validateSkuStage({
    saleSchema,
    supplierCode: "RUG-001",
    sizeTemplateId: "size-template-1",
    colorMapping: null,
    rows: [{
      id: "row-1",
      sizeText: "自定义尺寸",
      supplierSku: "RUG-001-CUSTOM",
      lengthCm: 90,
      widthCm: 50,
      sizeMapping: null,
      packageMatch: "missing",
    }],
    packagingTemplateId: "packaging-template-1",
    packagingMaterial: "天鹅绒",
    currency: "CNY",
  });

  assert.equal(result.valid, false);
  assert.deepEqual(
    result.blockers.map((item) => item.code),
    [
      "COLOR_SALE_VALUE_REQUIRED",
      "SIZE_SALE_VALUE_REQUIRED",
      "SKU_COST_PRICE_INVALID",
      "SKU_INVENTORY_INVALID",
      "PACKAGING_SIZE_NOT_MATCHED",
    ],
  );
});

test("accepts complete commercial fields and enforces dynamic weight requirements", () => {
  const result = validateSkuStage({
    saleSchema,
    supplierCode: "RUG-001",
    sizeTemplateId: "size-template-1",
    colorMapping: {
      attributeId: "10",
      attributeName: "颜色",
      valueId: "101",
      valueLabel: "多色",
    },
    rows: [{
      id: "row-1",
      sizeText: "40×60",
      supplierSku: "RUG-001-40X60",
      lengthCm: 60,
      widthCm: 40,
      sizeMapping: {
        attributeId: "87",
        attributeName: "尺寸",
        valueId: "201",
        valueLabel: "40×60",
      },
      costPrice: "2.40",
      inventoryNum: 100,
      weightGrams: 204,
      packageLengthCm: 20,
      packageWidthCm: 16,
      packageHeightCm: 6,
      packageMatch: "matched",
    }],
    packagingTemplateId: "packaging-template-1",
    packagingMaterial: "天鹅绒",
    currency: "CNY",
    weightRequired: true,
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.blockers, []);
});

test("builds a server-safe SKU publish preview without treating asset IDs as SHEIN URLs", () => {
  const result = buildSkuPublishPreview({
    supplierCode: "RUG-001",
    colorMapping: {
      attributeId: "10",
      attributeName: "颜色",
      valueId: "101",
      valueLabel: "多色",
    },
    rows: [{
      id: "row-1",
      sizeText: "40×60",
      supplierSku: "RUG-001-40X60",
      sizeMapping: {
        attributeId: "87",
        attributeName: "尺寸",
        valueId: "201",
        valueLabel: "40×60",
      },
      costPrice: "2.40",
      inventoryNum: 100,
      weightGrams: 204,
      packageLengthCm: 20,
      packageWidthCm: 16,
      packageHeightCm: 6,
      imageAssetId: "asset-sku-1",
    }],
    currency: "CNY",
    skuSettings: { mall_state: 1, stop_purchase: 1 },
    weightConfig: { available_units: ["g"] },
    dimensionConfig: { available_units: ["cm"] },
  });

  assert.deepEqual(result.blockers, []);
  assert.equal(result.skc.supplier_code, "RUG-001");
  assert.equal(result.skc.sale_attribute.attribute_id, 10);
  assert.equal(result.skc.sku_list[0].supplier_sku, "RUG-001-40X60");
  assert.deepEqual(result.skc.sku_list[0].cost_info, {
    cost_price: "2.40",
    currency: "CNY",
  });
  assert.equal(result.skc.sku_list[0].mall_state, 1);
  assert.equal(result.skc.sku_list[0].stop_purchase, 1);
  assert.equal("image_info" in result.skc.sku_list[0], false);
  assert.deepEqual(result.pendingImageUploads, [{
    rowId: "row-1",
    assetId: "asset-sku-1",
    supplierSku: "RUG-001-40X60",
    targetLevel: "sku",
    imageType: 1,
    imageSort: 1,
  }]);
});

test("does not invent SKU sale or purchase states in a publish preview", () => {
  const result = buildSkuPublishPreview({
    supplierCode: "RUG-001",
    colorMapping: null,
    rows: [],
    currency: "CNY",
  });

  assert.equal("mall_state" in (result.skc.sku_list[0] || {}), false);
  assert.equal("stop_purchase" in (result.skc.sku_list[0] || {}), false);
});

test("blocks duplicate supplier SKUs and partial SKU image assignment", () => {
  const baseRow = {
    lengthCm: 60,
    widthCm: 40,
    costPrice: "2.40",
    inventoryNum: 100,
    weightGrams: 204,
    packageLengthCm: 20,
    packageWidthCm: 16,
    packageHeightCm: 6,
    packageMatch: "matched",
  };
  const result = validateSkuStage({
    saleSchema,
    supplierCode: "RUG-001",
    sizeTemplateId: "size-template-1",
    colorMapping: {
      attributeId: "10",
      attributeName: "颜色",
      valueId: "101",
      valueLabel: "多色",
    },
    rows: [
      {
        ...baseRow,
        id: "row-1",
        sizeText: "40×60",
        supplierSku: "RUG-001-SAME",
        imageAssetId: "asset-sku-1",
        sizeMapping: {
          attributeId: "87",
          attributeName: "尺寸",
          valueId: "201",
          valueLabel: "40×60",
        },
      },
      {
        ...baseRow,
        id: "row-2",
        sizeText: "80×120",
        supplierSku: "RUG-001-SAME",
        sizeMapping: {
          attributeId: "87",
          attributeName: "尺寸",
          valueId: "202",
          valueLabel: "80×120",
        },
      },
    ],
    packagingTemplateId: "packaging-template-1",
    packagingMaterial: "天鹅绒",
    currency: "CNY",
    weightRequired: true,
  });

  assert.deepEqual(
    result.blockers.map((item) => item.code),
    ["SUPPLIER_SKU_DUPLICATE", "SKU_IMAGE_INCOMPLETE"],
  );
});
