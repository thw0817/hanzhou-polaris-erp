import assert from "node:assert/strict";
import test from "node:test";
import { planBulkDraftTemplateApplication } from "./product-draft-bulk-template-contract.js";

function draft(overrides = {}) {
  return {
    id: "draft-1",
    storeId: "store-1",
    name: "几何地毯",
    categoryId: "3155",
    productTypeId: "991",
    status: "ready",
    preflight: {},
    updatedAt: "2026-08-22T00:00:00.000Z",
    data: {
      title: "几何地毯",
      skuRows: [{
        id: "row-1",
        sizeText: "40×60",
        widthCm: 40,
        lengthCm: 60,
      }],
    },
    ...overrides,
  };
}

function liveSchema() {
  return {
    checkedAt: "2026-08-22T08:00:00.000Z",
    attributes: {
      data: [{
        product_type_id: "991",
        main_attribute_status: 1,
        attribute_infos: [
          {
            attribute_id: "material",
            attribute_name: "材质",
            attribute_status: 3,
            attribute_is_show: 1,
            attribute_type: 3,
            attribute_mode: 3,
            data_dimension: 0,
            attribute_input_num: 1,
            attribute_value_info_list: [
              { attribute_value_id: "polyester", attribute_value: "聚酯纤维", is_show: 1 },
            ],
          },
          {
            attribute_id: "color",
            attribute_name: "颜色",
            attribute_status: 3,
            attribute_is_show: 1,
            attribute_type: 1,
            attribute_label: 1,
            attribute_value_info_list: [
              { attribute_value_id: "black", attribute_value: "黑色", is_show: 1 },
            ],
          },
          {
            attribute_id: "size",
            attribute_name: "尺寸",
            attribute_status: 3,
            attribute_is_show: 1,
            attribute_type: 1,
            attribute_label: 0,
            attribute_value_info_list: [
              { attribute_value_id: "40x60", attribute_value: "40×60", is_show: 1 },
            ],
          },
        ],
      }],
    },
    publishStandard: {
      currency: "CNY",
      weight_config: { is_required: true },
      length_width_height_config: { is_required: true },
      picture_config_list: [],
      fill_in_standard_list: [],
      default_language: "zh-cn",
      default_language_title_max_length: 255,
    },
  };
}

test("empty draft shells safely receive attribute and size templates from the current SHEIN schema", () => {
  const result = planBulkDraftTemplateApplication({
    drafts: [draft({
      categoryId: "",
      productTypeId: "",
      status: "blocked",
      data: { title: "几何地毯", imageAssets: { main: [{ assetId: "asset-1" }] }, skuRows: [] },
    })],
    attributeTemplate: {
      id: "attribute-1",
      categoryId: "3155",
      productTypeId: "991",
      data: {
        categoryName: "装饰地毯",
        categoryPath: ["家居", "地毯", "装饰地毯"],
        assignments: [{ attributeId: "material", valueIds: ["polyester"], customValue: "" }],
      },
    },
    sizeTemplate: {
      id: "size-1",
      data: { colorText: "黑色", rows: [{ sizeText: "40×60", lengthCm: 60, widthCm: 40 }] },
    },
    schemaByCategory: { "3155:991": liveSchema() },
  });

  assert.equal(result.readyCount, 1);
  assert.deepEqual(result.items[0].changes, ["商品属性", "颜色与尺寸"]);
  assert.equal(result.items[0].input.categoryId, "3155");
  assert.equal(result.items[0].input.productTypeId, "991");
  assert.deepEqual(result.items[0].input.data.attributeValues.material.valueIds, ["polyester"]);
  assert.equal(result.items[0].input.data.colorSaleValue.valueId, "black");
  assert.equal(result.items[0].input.data.skuRows[0].sizeMapping.valueId, "40x60");
  assert.equal(result.items[0].input.data.publishStandardSnapshot.currency, "CNY");
  assert.equal(result.items[0].input.data.imageAssets.main[0].assetId, "asset-1");
  assert.equal(result.externalWrite, false);
});

test("attribute and size batch templates never overwrite edited category fields or SKU rows", () => {
  const result = planBulkDraftTemplateApplication({
    drafts: [draft({
      data: {
        title: "已编辑商品",
        attributeValues: { material: { valueIds: ["polyester"] } },
        skuRows: [{ id: "existing", sizeText: "80×120", widthCm: 80, lengthCm: 120 }],
      },
    })],
    attributeTemplate: {
      id: "attribute-1",
      categoryId: "3155",
      productTypeId: "991",
      data: { assignments: [{ attributeId: "material", valueIds: ["polyester"], customValue: "" }] },
    },
    sizeTemplate: {
      id: "size-1",
      data: { colorText: "黑色", rows: [{ sizeText: "40×60", lengthCm: 60, widthCm: 40 }] },
    },
    schemaByCategory: { "3155:991": liveSchema() },
  });

  assert.equal(result.readyCount, 0);
  assert.equal(result.blockedCount, 1);
  assert.match(result.items[0].blockers.join("；"), /已有类目或商品属性/);
  assert.match(result.items[0].blockers.join("；"), /已有 SKU/);
  assert.equal(result.items[0].input, null);
});

test("explicit re-reference mode replaces selected attribute and size templates", () => {
  const result = planBulkDraftTemplateApplication({
    replaceExistingTemplates: true,
    drafts: [draft({
      data: {
        title: "旧商品",
        attributeTemplateId: "attribute-old",
        attributeValues: { material: { valueIds: ["polyester"] } },
        sizeTemplateId: "size-old",
        colorSaleValue: { attributeId: "color", valueId: "black", valueLabel: "黑色" },
        skuRows: [{ id: "old-row", sizeText: "40×60", widthCm: 40, lengthCm: 60 }],
      },
    })],
    attributeTemplate: {
      id: "attribute-new",
      categoryId: "3155",
      productTypeId: "991",
      data: {
        assignments: [{ attributeId: "material", valueIds: ["polyester"], customValue: "" }],
      },
    },
    sizeTemplate: {
      id: "size-new",
      data: { colorText: "黑色", rows: [{ sizeText: "40×60", lengthCm: 60, widthCm: 40 }] },
    },
    schemaByCategory: { "3155:991": liveSchema() },
  });

  assert.equal(result.replaceExistingTemplates, true);
  assert.equal(result.readyCount, 1);
  assert.deepEqual(result.items[0].changes, ["商品属性", "颜色与尺寸"]);
  assert.equal(result.items[0].input.data.attributeTemplateId, "attribute-new");
  assert.equal(result.items[0].input.data.sizeTemplateId, "size-new");
  assert.equal(result.items[0].input.data.skuRows[0].sizeText, "40 × 60 cm");
});

test("same size template repairs a missing color mapping without overwriting SKU commercial data", () => {
  const result = planBulkDraftTemplateApplication({
    drafts: [draft({
      status: "blocked",
      data: {
        title: "几何地毯",
        sizeTemplateId: "size-1",
        skuRows: [{
          id: "existing",
          sizeText: "40×60",
          widthCm: 40,
          lengthCm: 60,
          costPrice: "10.08",
          weightGrams: 228,
          inventoryNum: 1000,
          imageAssetId: "asset-sku",
        }],
      },
    })],
    sizeTemplate: {
      id: "size-1",
      data: { colorText: "黑色", rows: [{ sizeText: "40×60", lengthCm: 60, widthCm: 40 }] },
    },
    schemaByCategory: { "3155:991": liveSchema() },
  });

  assert.equal(result.readyCount, 1);
  assert.deepEqual(result.items[0].changes, ["修复颜色与尺寸映射"]);
  assert.equal(result.items[0].input.data.colorSaleValue.valueId, "black");
  assert.equal(result.items[0].input.data.skuRows[0].costPrice, "10.08");
  assert.equal(result.items[0].input.data.skuRows[0].weightGrams, 228);
  assert.equal(result.items[0].input.data.skuRows[0].imageAssetId, "asset-sku");
});

test("batch attribute and size reuse fails closed when the live SHEIN schema no longer matches", () => {
  const schema = liveSchema();
  schema.attributes.data[0].attribute_infos[0].attribute_value_info_list = [];
  const result = planBulkDraftTemplateApplication({
    drafts: [draft({ categoryId: "", productTypeId: "", data: { title: "空草稿", skuRows: [] } })],
    attributeTemplate: {
      id: "attribute-1",
      categoryId: "3155",
      productTypeId: "991",
      data: { assignments: [{ attributeId: "material", valueIds: ["polyester"], customValue: "" }] },
    },
    schemaByCategory: { "3155:991": schema },
  });

  assert.equal(result.readyCount, 0);
  assert.match(result.items[0].blockers[0], /当前 SHEIN Schema/);
  assert.equal(result.items[0].input, null);
});

test("batch SKU initialization creates unique local codes, fills empty inventory and shares one explicit candidate image", () => {
  const first = draft({
    id: "draft-1",
    data: {
      title: "云朵地毯",
      sizeTemplateId: "size-1",
      skuPreviewImages: [{ assetId: "sku-image-1", originalName: "sku-common.jpg" }],
      skuRows: [{ id: "row-1", sizeText: "40×60", widthCm: 40, lengthCm: 60 }],
    },
  });
  const second = draft({
    id: "draft-2",
    name: "几何地毯",
    data: {
      title: "几何地毯",
      sizeTemplateId: "size-1",
      skuRows: [{ id: "row-2", sizeText: "50×80", widthCm: 50, lengthCm: 80 }],
    },
  });
  const result = planBulkDraftTemplateApplication({
    drafts: [first, second],
    generateSupplierCodes: true,
    supplierCodePrefix: "RUG-20260822",
    inventoryValue: "0",
    autoMapSkuImages: true,
    reservedSupplierCodes: ["RUG-20260822-001"],
  });

  assert.equal(result.readyCount, 2);
  assert.equal(result.items[0].input.data.supplierCode, "RUG-20260822-002");
  assert.equal(result.items[1].input.data.supplierCode, "RUG-20260822-003");
  assert.equal(result.items[0].input.data.skuRows[0].supplierSku, "RUG-20260822-002-40X60");
  assert.equal(result.items[0].input.data.skuRows[0].inventoryNum, 0);
  assert.equal(result.items[0].input.data.skuRows[0].imageAssetId, "sku-image-1");
  assert.equal(result.items[0].input.data.skuRows[0].imageAssetSource, "shared_sku");
  assert.deepEqual(result.items[0].changes, ["商家货号", "统一库存", "SKU预览图"]);
});

test("batch SKU initialization refuses to overwrite existing codes, inventory or image assignments", () => {
  const result = planBulkDraftTemplateApplication({
    drafts: [draft({
      data: {
        title: "已编辑SKU",
        supplierCode: "EXISTING",
        skuRows: [{
          id: "row-1",
          sizeText: "40×60",
          widthCm: 40,
          lengthCm: 60,
          supplierSku: "EXISTING-40X60",
          inventoryNum: 20,
          imageAssetId: "existing-image",
        }],
        skuPreviewImages: [{ assetId: "new-image", originalName: "40x60.jpg" }],
      },
    })],
    generateSupplierCodes: true,
    supplierCodePrefix: "NEW",
    inventoryValue: "10",
    autoMapSkuImages: true,
  });

  assert.equal(result.readyCount, 0);
  assert.equal(result.blockedCount, 1);
  assert.match(result.items[0].blockers.join("；"), /已有商家货号/);
  assert.match(result.items[0].blockers.join("；"), /已有库存/);
  assert.match(result.items[0].blockers.join("；"), /已有 SKU 图片映射/);
  assert.equal(result.items[0].input, null);
});

test("bulk draft templates update only safe local draft fields", () => {
  const result = planBulkDraftTemplateApplication({
    drafts: [draft()],
    titleRuleTemplate: {
      id: "title-1",
      data: { fullTitle: "现代简约几何地毯" },
    },
    commercialTemplate: {
      id: "commercial-1",
      data: { pricePerSquareMeter: 10, gramsPerSquareMeter: 850 },
    },
    packagingTemplate: {
      id: "packaging-1",
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
    },
    packagingMaterial: "天鹅绒",
    tailImageTemplate: {
      id: "tail-1",
      storeId: "store-1",
      data: {
        placement: "append",
        assets: [{
          id: "asset-1",
          originalName: "tail.jpg",
          contentType: "image/jpeg",
          width: 1340,
          height: 1785,
        }],
      },
    },
  });

  assert.equal(result.readyCount, 1);
  assert.equal(result.blockedCount, 0);
  assert.deepEqual(result.items[0].changes, [
    "标题规则",
    "计价与克重",
    "打包体积",
    "通用商品图片",
  ]);
  assert.equal(result.items[0].input.data.title, "现代简约几何地毯");
  assert.equal(result.items[0].input.data.skuRows[0].costPrice, "2.40");
  assert.equal(result.items[0].input.data.skuRows[0].weightGrams, 204);
  assert.equal(result.items[0].input.data.skuRows[0].packageMatch, "matched");
  assert.equal(result.items[0].input.data.imageAssets.tail[0].assetId, "asset-1");
  assert.equal(result.externalWrite, false);
});

test("bulk packaging fails closed when any SKU has no exact dimension match", () => {
  const result = planBulkDraftTemplateApplication({
    drafts: [draft({
      data: {
        title: "几何地毯",
        skuRows: [
          { id: "row-1", sizeText: "40×60", widthCm: 40, lengthCm: 60 },
          { id: "row-2", sizeText: "80×120", widthCm: 80, lengthCm: 120 },
        ],
      },
    })],
    packagingTemplate: {
      id: "packaging-1",
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
    },
    packagingMaterial: "天鹅绒",
  });

  assert.equal(result.readyCount, 0);
  assert.equal(result.blockedCount, 1);
  assert.match(result.items[0].blockers[0], /80×120/);
  assert.equal(result.items[0].input, null);
});

test("publish settings template fills only empty drafts after current-rule validation", () => {
  const result = planBulkDraftTemplateApplication({
    drafts: [draft()],
    publishSettingsTemplate: {
      id: "publish-settings-1",
      data: {
        mallState: "1",
        stopPurchase: "1",
        shelfRequire: "0",
        shelfWay: "1",
      },
    },
    businessMode: "全托管",
    schemaByCategory: { "3155:991": liveSchema() },
  });

  assert.equal(result.readyCount, 1);
  assert.deepEqual(result.items[0].changes, ["发布设置"]);
  assert.equal(result.items[0].input.data.publishSettingsTemplateId, "publish-settings-1");
  assert.deepEqual(result.items[0].input.data.publishSettings, {
    mallState: "1",
    stopPurchase: "1",
    shelfRequire: "0",
    shelfWay: "1",
    hopeOnSaleDate: "",
  });
  assert.equal(result.externalWrite, false);
});

test("publish settings batch application never overwrites edited settings", () => {
  const result = planBulkDraftTemplateApplication({
    drafts: [draft({
      data: {
        title: "已设置商品",
        publishSettings: { mallState: "2" },
        skuRows: [{ id: "row-1", sizeText: "40×60", widthCm: 40, lengthCm: 60 }],
      },
    })],
    publishSettingsTemplate: {
      id: "publish-settings-1",
      data: { mallState: "1", stopPurchase: "1", shelfRequire: "0", shelfWay: "1" },
    },
    businessMode: "全托管",
    schemaByCategory: { "3155:991": liveSchema() },
  });

  assert.equal(result.blockedCount, 1);
  assert.match(result.items[0].blockers[0], /已有发布设置/);
  assert.equal(result.items[0].input, null);
});

test("bulk templates never mutate published drafts and replace prior title fragments", () => {
  const published = planBulkDraftTemplateApplication({
    drafts: [draft({ status: "published" })],
    commercialTemplate: {
      id: "commercial-1",
      data: { pricePerSquareMeter: 10, gramsPerSquareMeter: 850 },
    },
  });
  assert.equal(published.blockedCount, 1);
  assert.match(published.items[0].blockers[0], /已发布/);

  const repeated = planBulkDraftTemplateApplication({
    drafts: [draft({
      data: {
        title: "前缀 几何地毯 旧词",
        titleRuleTemplateId: "title-1",
        skuRows: [{ id: "row-1", sizeText: "40×60", widthCm: 40, lengthCm: 60 }],
      },
    })],
    titleRuleTemplate: {
      id: "title-2",
      data: { prefix: "新前缀", keywords: "新词" },
    },
    titleRuleTemplates: [{
      id: "title-1",
      data: { prefix: "前缀", keywords: "旧词" },
    }],
  });
  assert.equal(repeated.readyCount, 1);
  assert.equal(repeated.items[0].input.data.title, "新前缀 几何地毯 新词");
  assert.equal(repeated.items[0].input.data.titleRuleBaseTitle, "几何地毯");
});
