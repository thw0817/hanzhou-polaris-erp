import assert from "node:assert/strict";
import test from "node:test";
import {
  formatDiscussionMoney,
  pricePerSquareMeter,
  skuSizeLabel,
} from "./price-discussion-contract.js";

test("核价 SKU 使用销售属性中的尺寸并反算每平方米单价", () => {
  assert.equal(skuSizeLabel(["40*60"]), "40 × 60 cm");
  assert.equal(pricePerSquareMeter(9.71, ["40*60"]), 40.46);
  assert.equal(formatDiscussionMoney(9.71, "CNY"), "9.71 元");
});

test("无法可靠解析尺寸时不猜测反算单价", () => {
  assert.equal(skuSizeLabel(["蓝色"]), "蓝色");
  assert.equal(pricePerSquareMeter(9.71, ["蓝色"]), null);
  assert.equal(formatDiscussionMoney(null, "CNY"), "—");
});
