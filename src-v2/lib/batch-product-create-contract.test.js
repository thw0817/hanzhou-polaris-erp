import test from "node:test";
import assert from "node:assert/strict";
import {
  applyBatchAttributeTemplate,
  applyBatchSkuSettings,
  buildBatchDraftName,
  buildBatchSkuStage,
  buildBatchSkuRows,
  buildDefaultBatchSupplierCode,
  mapBatchSkuPreviews,
  reorderBatchImages,
  summarizeBatchProduct,
} from "./batch-product-create-contract.js";

test("批量草稿内部名称不截断 SHEIN 商品标题", () => {
  const title = "地".repeat(250);
  assert.equal(buildBatchDraftName(title).length, 160);
  assert.equal(title.length, 250);
});

test("批量建品按尺寸模板生成独立 SKU 行并统一生成价格克重", () => {
  const rows = buildBatchSkuRows({ data: { rows: [
    { sizeText: "1pc 40cm*60cm", lengthCm: 60, widthCm: 40 },
    { sizeText: "1pc 50cm*80cm", lengthCm: 80, widthCm: 50 },
  ] } }, "folder-1");
  const result = applyBatchSkuSettings(rows, {
    pricePerSquareMeter: 42,
    gramsPerSquareMeter: 950,
    inventory: 1000,
  });
  assert.equal(result[0].costPrice, "10.08");
  assert.equal(result[0].weightGrams, 228);
  assert.equal(result[1].costPrice, "16.80");
  assert.equal(result[1].inventoryNum, 1000);
  assert.equal(buildDefaultBatchSupplierCode(0, new Date("2026-08-22T00:00:00Z")), "家居-地毯-0822001");
});

test("批量建品保留尺寸模板的官方多色映射", () => {
  const result = buildBatchSkuStage({
    id: "size-1",
    data: {
      colorText: "多色",
      rows: [{ sizeText: "40*60", lengthCm: 60, widthCm: 40 }],
    },
  }, "folder-1", {
    mainAttributeStatus: 2,
    fields: [
      { id: "color", name: "颜色", required: true, labelCode: 1, attributeType: 1, modeCode: 1, customValueAllowed: false, values: [{ id: "multi", label: "多色" }] },
      { id: "size", name: "尺寸", required: true, labelCode: 0, attributeType: 1, modeCode: 0, customValueAllowed: true, values: [] },
    ],
    sizeFields: [
      { id: "size", name: "尺寸", required: true, labelCode: 0, attributeType: 1, modeCode: 0, customValueAllowed: true, values: [] },
    ],
  });

  assert.equal(result.colorMapping.valueId, "multi");
  assert.equal(result.colorMapping.valueLabel, "多色");
  assert.equal(result.rows[0].sizeMapping.customValue, "1pc 40cm*60cm");
});

test("批量 SKU 预览图可明确选择轮播图或主图，不做隐式猜测", () => {
  const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const images = [{ id: "main" }, { id: "carousel-1" }, { id: "carousel-2" }];
  assert.deepEqual(
    mapBatchSkuPreviews(rows, images.slice(1), "carousel").map((row) => row.imageAssetId),
    ["carousel-1", "carousel-2", "carousel-1"],
  );
  assert.deepEqual(
    mapBatchSkuPreviews(rows, images, "main").map((row) => row.imageAssetId),
    ["main", "main", "main"],
  );
});

test("批量图片可按鼠标拖动结果稳定重排", () => {
  const images = [{ id: "main-1" }, { id: "main-2" }, { id: "carousel-1" }];
  assert.deepEqual(
    reorderBatchImages(images, "carousel-1", "main-1").map((image) => image.id),
    ["carousel-1", "main-1", "main-2"],
  );
  assert.deepEqual(reorderBatchImages(images, "missing", "main-1"), images);
});

test("属性模板能转换为单品页可直接使用的赋值结构", () => {
  assert.deepEqual(
    applyBatchAttributeTemplate({ data: { assignments: [
      { attributeId: "color", valueIds: ["red"], customValue: "" },
      { attributeId: "material", valueIds: [], customValue: "cotton" },
    ] } }),
    {
      color: { valueIds: ["red"], customValue: "" },
      material: { valueIds: [], customValue: "cotton" },
    },
  );
});

test("批量总表只在真正缺数据时显示阻断", () => {
  const base = {
    title: "客厅地毯",
    attributeTemplateId: "attr-1",
    sizeTemplateId: "size-1",
    skuRows: [{ costPrice: "10.08", weightGrams: 228, imageAssetId: "" }],
  };
  assert.equal(summarizeBatchProduct(base).readyForDetail, true);
  assert.match(summarizeBatchProduct({ ...base, skuRows: [{ ...base.skuRows[0], imageAssetId: "a" }, { costPrice: "" }] }).blockers.join(" "), /价格/);
});
