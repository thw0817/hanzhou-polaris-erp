import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSpuInfo } from "./spu-readback-projections.js";

test("normalizes the official SPU, SKC and SKU relationship fields", () => {
  const result = normalizeSpuInfo(
    {
      spuName: "SPU-1",
      categoryId: 3155,
      productTypeId: 991,
      supplierCode: "SPU-MERCHANT",
      skcInfoList: [{
        skcName: "SKC-1",
        supplierCode: "SKC-MERCHANT",
        skuInfoList: [{
          skuCode: "SKU-1",
          supplierSku: "SKU-MERCHANT",
          length: "11.00",
          width: "11.00",
          height: "11.00",
          weight: 222,
          saleAttributeList: [
            { attributeId: 87, attributeValueId: 756 },
          ],
          imageUrl: "https://private.example/image.jpg",
          priceInfoList: [{ site: "shein-mx", basePrice: 23 }],
          costInfoList: [{ costPrice: 12 }],
        }],
      }],
    },
    { expectedSpuName: "SPU-1" },
  );

  assert.deepEqual(result.projection, {
    eventFamily: "goods/spu-info",
    spuName: "SPU-1",
    categoryId: 3155,
    productTypeId: 991,
    supplierCode: "SPU-MERCHANT",
    skcs: [{
      skcName: "SKC-1",
      supplierCode: "SKC-MERCHANT",
      skuList: [{
        skuCode: "SKU-1",
        supplierSku: "SKU-MERCHANT",
      }],
    }],
  });
  assert.equal(JSON.stringify(result).includes("private.example"), false);
  assert.equal(JSON.stringify(result).includes("saleAttributeList"), false);
  assert.equal(JSON.stringify(result).includes("priceInfoList"), false);
  assert.equal(JSON.stringify(result).includes("weight"), false);
  assert.equal(JSON.stringify(result).includes("costPrice"), false);
});

test("fails closed when the returned SPU relationship is incomplete or mismatched", () => {
  assert.throws(
    () =>
      normalizeSpuInfo(
        {
          spuName: "SPU-2",
          skcInfoList: [{ skcName: "SKC-2", skuInfoList: [] }],
        },
        { expectedSpuName: "SPU-1" },
      ),
    /SPU回读编码与请求不一致/,
  );
  assert.throws(
    () =>
      normalizeSpuInfo({
        spuName: "SPU-1",
        skcInfoList: [{ skcName: "SKC-1", skuInfoList: [{}] }],
      }),
    /缺少 skuCode/,
  );
});
