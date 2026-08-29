import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeProductSearch,
  summarizeProductDetail,
} from "./shein-product.js";

test("normalizes the exact SKC from SHEIN searchProduct data", () => {
  const products = normalizeProductSearch(
    {
      data: [
        {
          spuName: "spu-1",
          categoryId: "2001",
          skcList: [
            {
              skcName: "skc-1",
              skcShelfStatus: 1,
              supplierCode: "merchant-style",
              skcMainPicUrl: "https://example.test/main.jpg",
              skcTitle: [
                { language: "en", title: "English title" },
                { language: "zh-cn", title: "中文标题" },
              ],
              skuList: [
                {
                  skuCode: "sku-1",
                  supplierSku: "merchant-sku",
                  inventoryList: [
                    { warehouseId: "w1", inventoryNum: 3 },
                    { warehouseId: "w2", inventoryNum: 2 },
                  ],
                },
              ],
            },
            { skcName: "skc-other", skuList: [] },
          ],
        },
      ],
    },
    "skc-1",
  );

  assert.equal(products.length, 1);
  assert.deepEqual(products[0], {
    id: "skc-1",
    type: "product",
    skc: "skc-1",
    spu: "spu-1",
    name: "中文标题",
    image: "https://example.test/main.jpg",
    categoryId: "2001",
    category: "类目 2001",
    categoryName: "",
    categoryPath: [],
    imageUrl: "https://example.test/main.jpg",
    variants: "1 个 SKU",
    skuCount: 1,
    supplierCode: "merchant-style",
    supplierSkus: ["merchant-sku"],
    skuCodes: ["sku-1"],
    skuItems: [{
      skuCode: "sku-1",
      supplierSku: "merchant-sku",
      size: "merchant-sku",
      cost: null,
    }],
    inventory: 5,
    statusCode: null,
    state: "待同步",
    statusSource: "unavailable",
    compliance: "待同步",
    template: "未建立",
    sales7: "—",
  });
});

test("preserves category path and image candidates returned by product search", () => {
  const [product] = normalizeProductSearch({
    data: [{
      spuName: "spu-2",
      categoryId: "3155",
      categoryNamePath: ["家用纺织品", "地毯"],
      skcList: [{
        skcName: "skc-2",
        supplierCode: "rug-2",
        mainPicUrl: "https://example.test/rug-2.jpg",
        sampleInfo: {
          reserveSampleFlag: 1,
          spotFlag: 2,
          sampleJudgeType: 2,
          sampleCode: "SAMPLE-SKU-2",
        },
        skuList: [],
      }],
    }],
  });

  assert.deepEqual(product.categoryPath, ["家用纺织品", "地毯"]);
  assert.equal(product.categoryName, "地毯");
  assert.equal(product.imageUrl, "https://example.test/rug-2.jpg");
  assert.deepEqual(product.sampleInfo, {
    reserveSampleFlag: 1,
    spotFlag: 2,
    sampleJudgeType: 2,
    sampleCode: "SAMPLE-SKU-2",
  });
});

test("summarizes SPU detail fields used by recognition", () => {
  const summary = summarizeProductDetail(
    {
      categoryId: 2001,
      productTypeId: 3002,
      brandCode: "brand-a",
      productMultiNameList: [{ language: "en", productName: "Rug" }],
      productAttributeInfoList: [{ attributeId: 1 }, { attributeId: 2 }],
      dimensionAttributeInfoList: [{ attributeId: 3 }],
      skcInfoList: [
        { skcName: "skc-1", skuInfoList: [{ skuCode: "sku-1" }] },
      ],
    },
    "skc-1",
  );

  assert.deepEqual(summary, {
    categoryId: 2001,
    productTypeId: 3002,
    brandCode: "brand-a",
    productName: "Rug",
    productAttributeCount: 2,
    dimensionAttributeCount: 1,
    skcCount: 1,
    skuCount: 1,
  });
});
