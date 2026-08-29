import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const productsSource = readFileSync(
  new URL("../../src-v2/features/operations/ProductsPage.tsx", import.meta.url),
  "utf8",
);
const productDetailSource = readFileSync(
  new URL("../../src-v2/features/operations/ProductDetailPage.tsx", import.meta.url),
  "utf8",
);
const operationsSharedSource = readFileSync(
  new URL("../../src-v2/features/operations/OperationsShared.tsx", import.meta.url),
  "utf8",
);
const salesInventorySource = readFileSync(
  new URL("../../src-v2/features/operations/SalesInventoryPage.tsx", import.meta.url),
  "utf8",
);
const alertsSource = readFileSync(
  new URL("../../src-v2/features/operations/AlertsPage.tsx", import.meta.url),
  "utf8",
);
const apiSource = readFileSync(
  new URL("../../src-v2/lib/api.ts", import.meta.url),
  "utf8",
);

test("product operations expands one SKC into its trusted SKU snapshot", () => {
  assert.match(productsSource, /useSearchParams/);
  assert.match(productsSource, /searchParams\.get\("skc"\)/);
  assert.match(productsSource, /expandedSkc/);
  assert.match(productsSource, /setExpandedSkc/);
  assert.match(productsSource, /product\.skus/);
  assert.match(productsSource, /供应商 SKU/);
  assert.match(productsSource, /可售天数/);
  assert.match(apiSource, /actualInventory\?: number/);
  assert.match(apiSource, /daysOfCover\?: number \| null/);
});

test("operations alerts open the matching product detail route", () => {
  assert.match(alertsSource, /useNavigate/);
  assert.match(alertsSource, /\/products\/\$\{encodeURIComponent\(warning\.skc \|\| ""\)\}/);
  assert.doesNotMatch(alertsSource, /\/products\?skc=/);
  assert.match(alertsSource, /查看商品/);
  assert.match(alertsSource, /WarningVisual/);
  assert.match(alertsSource, /warning\.image \|\| linkedProduct\?\.imageUrl/);
  assert.match(alertsSource, /linkedProduct\?\.listingDays/);
  assert.match(alertsSource, /linkedProduct\?\.sales\?\.today/);
  assert.match(alertsSource, /linkedProduct\?\.sales\?\.sales7/);
  assert.match(alertsSource, /linkedProduct\?\.sales\?\.sales30/);
  assert.match(alertsSource, /warning\.inventory \?\? linkedProduct\?\.actualInventory/);
  assert.match(alertsSource, /筛选预警优先级/);
  assert.match(alertsSource, /warningSearch/);
  assert.match(alertsSource, /搜索经营预警/);
  assert.match(alertsSource, /linkedProduct\?\.supplierCode/);
  assert.match(alertsSource, /调整预警搜索或优先级筛选后重试/);
  assert.match(alertsSource, /warningTone/);
  assert.match(alertsSource, /warningTone !== "all" && warning\.tone !== warningTone/);
  assert.match(alertsSource, /高优先级/);
  assert.match(alertsSource, /中优先级/);
  assert.match(alertsSource, /低优先级/);
  assert.match(alertsSource, /优先级待确认/);
});

test("product detail reads only the trusted business snapshot", () => {
  assert.match(productDetailSource, /useParams/);
  assert.match(productDetailSource, /snapshot\?\.products\?\.find/);
  assert.match(productDetailSource, /经营快照/);
  assert.match(productDetailSource, /商品概览/);
  assert.match(productDetailSource, /SKU 明细/);
  assert.match(productDetailSource, /不会补造商品详情/);
  assert.match(productDetailSource, /product\.actualInventory/);
  assert.match(productDetailSource, /product\.daysOfCover/);
  assert.match(productDetailSource, /product\.listingDays/);
});

test("app routes SKC detail separately from the product list", () => {
  const appSource = readFileSync(new URL("../../src-v2/app/App.tsx", import.meta.url), "utf8");
  assert.match(appSource, /ProductDetailPage/);
  assert.match(appSource, /operations\/\:storeId\/products\/\:skc/);
});

test("product operations filters stock risk from the trusted coverage snapshot", () => {
  assert.match(productsSource, /stockRisk/);
  assert.match(productsSource, /筛选库存风险/);
  assert.match(productsSource, /库存风险（≤5天）/);
  assert.match(productsSource, /库存健康（&gt;5天）/);
  assert.match(productsSource, /无可售天数/);
  assert.match(productsSource, /matchesStockRisk/);
  assert.match(operationsSharedSource, /Number\(product\.daysOfCover\) <= 5/);
  assert.match(operationsSharedSource, /Number\(product\.daysOfCover\) > 5/);
  assert.match(operationsSharedSource, /product\.state !== "已上架"/);
});

test("sales and inventory keeps the same trusted stock-risk presentation", () => {
  assert.match(salesInventorySource, /useMemo/);
  assert.match(salesInventorySource, /productSearch/);
  assert.match(salesInventorySource, /搜索销量与库存商品/);
  assert.match(salesInventorySource, /product\.supplierCode/);
  assert.match(salesInventorySource, /matchesStockRisk/);
  assert.match(salesInventorySource, /筛选库存风险/);
  assert.match(salesInventorySource, /可售天数/);
  assert.match(salesInventorySource, /stockRiskTone/);
  assert.match(salesInventorySource, /daysOfCover == null/);
  assert.match(salesInventorySource, /const hasProducts = Boolean/);
  assert.match(salesInventorySource, /没有匹配的商品/);
  assert.match(salesInventorySource, /调整商品搜索或库存风险筛选后重试/);
  assert.match(salesInventorySource, /平台状态/);
  assert.match(salesInventorySource, /product\.state \|\| "待同步"/);
  assert.match(salesInventorySource, /等待 SHEIN 回读/);
});

test("sales and inventory identifies each SKC with its trusted product image", () => {
  assert.match(salesInventorySource, /function ProductVisual/);
  assert.match(salesInventorySource, /product\.imageUrl \|\| product\.image/);
  assert.match(salesInventorySource, /商品主图/);
  assert.match(salesInventorySource, /暂无商品主图/);
  assert.match(salesInventorySource, /<ProductVisual product=\{product\} \/>/);
});

test("sales and inventory shows SHEIN transit stock and expandable SKU rows", () => {
  assert.match(apiSource, /transitInventory\?: number/);
  assert.match(salesInventorySource, /expandedSkcs/);
  assert.match(salesInventorySource, /toggleExpanded/);
  assert.match(salesInventorySource, /展开 .* SKU 明细/);
  assert.match(salesInventorySource, /收起 .* SKU 明细/);
  assert.match(salesInventorySource, /product\.skus/);
  assert.match(salesInventorySource, /sku\.skuCode/);
  assert.match(salesInventorySource, /sku\.supplierSku/);
  assert.match(salesInventorySource, /sku\.transitInventory/);
  assert.match(salesInventorySource, /product\.transitInventory/);
  assert.match(salesInventorySource, /在途库存/);
});
