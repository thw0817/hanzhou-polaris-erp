import { ChevronDown, ChevronRight, PackageOpen, Search } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { useAppContext } from "../../app/AppShell";
import {
  DashboardLoading,
  EmptyDashboard,
  matchesStockRisk,
  Metric,
  PageHeading,
  QueryNotice,
  formatNumber,
  stockRiskTone,
  type StockRiskFilter,
} from "./OperationsShared";
import { useBusinessDashboard } from "./use-business-dashboard";

function ProductVisual({ product }: { product: { imageUrl?: string; image?: string; skc?: string } }) {
  const src = product.imageUrl || product.image;
  return src ? (
    <img
      alt={`${product.skc || "商品"}商品主图`}
      className="size-11 shrink-0 rounded-md border border-[var(--line)] object-cover"
      decoding="async"
      loading="lazy"
      src={src}
    />
  ) : (
    <span
      aria-label={`${product.skc || "商品"}暂无商品主图`}
      className="grid size-11 shrink-0 place-items-center rounded-md bg-[var(--surface-muted)] text-[var(--text-subtle)]"
      role="img"
    >
      <PackageOpen size={18} />
    </span>
  );
}

function shelfStatusClass(state?: string) {
  if (state === "已上架") return "compliance-status-success";
  if (state === "已下架" || state === "已售罄") return "compliance-status-danger";
  return "compliance-status-warning";
}

function formatInventory(value: unknown) {
  return value === null || value === undefined ? "--" : formatNumber(value);
}

export function SalesInventoryPage() {
  const { currentStore } = useAppContext();
  const dashboard = useBusinessDashboard(currentStore?.id || "");
  const snapshot = dashboard.data?.snapshot;
  const [stockRisk, setStockRisk] = useState<StockRiskFilter>("all");
  const [productSearch, setProductSearch] = useState("");
  const [expandedSkcs, setExpandedSkcs] = useState<Set<string>>(new Set());
  const toggleExpanded = (skc: string) => {
    setExpandedSkcs((current) => {
      const next = new Set(current);
      if (next.has(skc)) next.delete(skc);
      else next.add(skc);
      return next;
    });
  };
  const products = useMemo(
    () => [...(snapshot?.products || [])]
      .sort((a, b) => Number(b.sales?.sales30 || 0) - Number(a.sales?.sales30 || 0))
      .filter((product) => {
        if (!matchesStockRisk(product, stockRisk)) return false;
        const query = productSearch.trim().toLocaleLowerCase();
        if (!query) return true;
        return [
          product.name,
          product.title,
          product.skc,
          product.spu,
          product.supplierCode,
        ].some((value) => String(value || "").toLocaleLowerCase().includes(query));
      }),
    [productSearch, snapshot?.products, stockRisk],
  );
  const hasProducts = Boolean(snapshot?.products?.length);
  if (!currentStore) return null;
  const refresh = () => dashboard.refresh.mutate();
  return (
    <>
      <PageHeading
        dashboard={dashboard.data}
        detail={`${currentStore.label} · 销量与实际库存口径`}
        eyebrow="经营中心"
        onRefresh={refresh}
        refreshing={dashboard.refresh.isPending}
        title="销量与库存"
      />
      <QueryNotice
        error={dashboard.refreshError || dashboard.error}
        lastError={dashboard.data?.lastError}
        onRetry={() => dashboard.refetch()}
        stale={dashboard.data?.stale && Boolean(snapshot)}
        webhookPending={dashboard.data?.webhookPending}
      />
      {dashboard.isLoading ? (
        <DashboardLoading />
      ) : !snapshot ? (
        <EmptyDashboard
          failed={dashboard.data?.state === "failed"}
          onRefresh={refresh}
          refreshing={dashboard.refresh.isPending}
          retryAfterSeconds={dashboard.data?.refreshControl?.retryAfterSeconds || 0}
          lastManualRefreshAt={dashboard.data?.lastManualRefreshAt}
          store={currentStore}
        />
      ) : (
        <>
          <section className="metric-grid">
            <Metric detail="SHEIN 返回口径" label="今日销量" value={snapshot.totals?.today} />
            <Metric detail="自然日口径" label="昨日销量" value={snapshot.totals?.yesterday} />
            <Metric detail="滚动统计" label="近 7 日" value={snapshot.totals?.sales7} />
            <Metric detail="店铺实物可用库存" label="实际库存" value={snapshot.totals?.actualInventory} />
            <Metric
              detail={snapshot.productQuota?.receivedAt ? "Webhook 最新同步" : "尚未收到额度事件"}
              label="可发布额度"
              value={snapshot.productQuota?.availableLimit}
            />
          </section>
          <section className="data-panel">
            <header className="data-toolbar">
              <div>
                <h2>商品销量与库存</h2>
                <p>SHEIN 状态来自 SKC 实时回读；未成功回读时显示“待同步”</p>
              </div>
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                <label className="search-field sm:w-60">
                  <Search size={15} />
                  <input
                    aria-label="搜索销量与库存商品"
                    onChange={(event) => setProductSearch(event.target.value)}
                    placeholder="搜索商品、SKC、SPU"
                    value={productSearch}
                  />
                </label>
                <select
                  aria-label="筛选库存风险"
                  className="select-field"
                  onChange={(event) => setStockRisk(event.target.value as StockRiskFilter)}
                  value={stockRisk}
                >
                  <option value="all">全部库存</option>
                  <option value="danger">库存风险（≤5天）</option>
                  <option value="healthy">库存健康（&gt;5天）</option>
                  <option value="unknown">无可售天数</option>
                </select>
              </div>
            </header>
            {products.length ? (
              <div className="table-scroll">
                <table className="operations-table min-w-[1280px]">
                  <thead>
                    <tr>
                      <th>SKC</th>
                      <th>平台状态</th>
                      <th className="text-right">今日</th>
                      <th className="text-right">昨日</th>
                      <th className="text-right">7 日</th>
                      <th className="text-right">30 日</th>
                      <th className="text-right">实际库存</th>
                      <th className="text-right">在途库存</th>
                      <th className="text-right">可售天数</th>
                      <th className="text-right">建议备货</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((product, index) => {
                      const rowKey = product.skc || String(index);
                      const expanded = expandedSkcs.has(rowKey);
                      const skus = product.skus || [];
                      return (
                      <Fragment key={rowKey}>
                      <tr>
                        <td>
                          <div className="flex min-w-0 items-center gap-3">
                            <button
                              aria-label={expanded ? `收起 ${product.skc || "商品"} SKU 明细` : `展开 ${product.skc || "商品"} SKU 明细`}
                              className="grid size-7 shrink-0 place-items-center rounded text-[var(--text-subtle)] hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-30"
                              disabled={!skus.length}
                              onClick={() => toggleExpanded(rowKey)}
                              type="button"
                            >
                              {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                            </button>
                            <ProductVisual product={product} />
                            <div className="min-w-0">
                              <strong className="block text-sm font-medium text-[var(--ink)]">{product.skc || "--"}</strong>
                              <small className="mt-1 block max-w-[280px] truncate text-xs text-[var(--text-subtle)]">
                                {product.name || product.title || "未命名商品"}
                              </small>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className={`status-badge ${shelfStatusClass(product.state)}`}>
                            {product.state || "待同步"}
                          </span>
                          {product.statusSource === "unavailable" && (
                            <small className="mt-1 block text-xs text-[var(--text-subtle)]">等待 SHEIN 回读</small>
                          )}
                        </td>
                        <td className="text-right tabular-nums">{formatNumber(product.sales?.today)}</td>
                        <td className="text-right tabular-nums">{formatNumber(product.sales?.yesterday)}</td>
                        <td className="text-right tabular-nums">{formatNumber(product.sales?.sales7)}</td>
                        <td className="text-right font-medium tabular-nums">{formatNumber(product.sales?.sales30)}</td>
                        <td className="text-right tabular-nums">{formatNumber(product.actualInventory)}</td>
                        <td className="text-right tabular-nums">{formatInventory(product.transitInventory)}</td>
                        <td className="text-right">
                          <span className={`stock-state stock-${stockRiskTone(product)}`}>
                            {product.daysOfCover == null ? "--" : `${formatNumber(product.daysOfCover)} 天`}
                          </span>
                        </td>
                        <td className="text-right font-medium tabular-nums text-[var(--danger)]">
                          {Number(product.replenishmentGap || 0) > 0 ? formatNumber(product.replenishmentGap) : "--"}
                        </td>
                      </tr>
                      {expanded && skus.map((sku, skuIndex) => {
                        const skuGap = sku.replenishmentGap ?? sku.suggestedRestock;
                        return (
                          <tr className="bg-[var(--surface-muted)]/45" key={sku.skuCode || `${rowKey}-${skuIndex}`}>
                            <td>
                              <div className="pl-10">
                                <strong className="block text-xs font-medium text-[var(--ink)]">{sku.size || sku.sizeLabel || "未返回规格"}</strong>
                                <small className="mt-1 block text-xs text-[var(--text-subtle)]">
                                  SKU {sku.skuCode || "--"} · 商家 SKU {sku.supplierSku || "--"}
                                </small>
                              </div>
                            </td>
                            <td><span className="text-xs text-[var(--text-subtle)]">SKU 明细</span></td>
                            <td className="text-right tabular-nums">{formatNumber(sku.sales?.today)}</td>
                            <td className="text-right tabular-nums">{formatNumber(sku.sales?.yesterday)}</td>
                            <td className="text-right tabular-nums">{formatNumber(sku.sales?.sales7)}</td>
                            <td className="text-right font-medium tabular-nums">{formatNumber(sku.sales?.sales30)}</td>
                            <td className="text-right tabular-nums">{formatNumber(sku.actualInventory ?? sku.inventory)}</td>
                            <td className="text-right tabular-nums">{formatInventory(sku.transitInventory)}</td>
                            <td className="text-right">
                              <span className={`stock-state stock-${stockRiskTone({ state: product.state, daysOfCover: sku.daysOfCover })}`}>
                                {sku.daysOfCover == null ? "--" : `${formatNumber(sku.daysOfCover)} 天`}
                              </span>
                            </td>
                            <td className="text-right font-medium tabular-nums text-[var(--danger)]">
                              {Number(skuGap || 0) > 0 ? formatNumber(skuGap) : "--"}
                            </td>
                          </tr>
                        );
                      })}
                      </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="grid min-h-64 place-items-center text-center">
                <div>
                  <PackageOpen className="mx-auto text-[var(--text-subtle)]" size={24} />
                  <p className="mt-3 text-sm">{hasProducts ? "没有匹配的商品" : "暂无商品销量数据"}</p>
                  <p className="mt-1 text-xs text-[var(--text-subtle)]">
                    {hasProducts
                      ? "调整商品搜索或库存风险筛选后重试"
                      : "当前经营快照没有商品记录"}
                  </p>
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
