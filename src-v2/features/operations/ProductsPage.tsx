import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, PackageOpen, Search } from "lucide-react";
import { useSearchParams } from "react-router";
import { useAppContext } from "../../app/AppShell";
import { Button } from "../../components/ui/button";
import type { BusinessProduct } from "../../lib/api";
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

function ProductVisual({ product }: { product: BusinessProduct }) {
  const src = product.imageUrl || product.image;
  return src ? (
    <img alt="" className="size-11 rounded-md border border-[var(--line)] object-cover" decoding="async" loading="lazy" src={src} />
  ) : (
    <span className="grid size-11 place-items-center rounded-md bg-[var(--surface-muted)] text-[var(--text-subtle)]">
      <PackageOpen size={18} />
    </span>
  );
}

export function ProductsPage() {
  const { currentStore } = useAppContext();
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("skc") || "");
  const [status, setStatus] = useState("all");
  const [stockRisk, setStockRisk] = useState<StockRiskFilter>("all");
  const [expandedSkc, setExpandedSkc] = useState<string | null>(null);
  const dashboard = useBusinessDashboard(currentStore?.id || "");
  const snapshot = dashboard.data?.snapshot;
  const products = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...(snapshot?.products || [])]
      .sort((a, b) => Number(b.sales?.sales30 || 0) - Number(a.sales?.sales30 || 0))
      .filter((product) => {
        const matchesStatus = status === "all" || product.state === status;
        const matchesQuery = !needle || [product.name, product.title, product.skc, product.spu, product.supplierCode]
          .some((value) => String(value || "").toLowerCase().includes(needle));
        return matchesStatus && matchesQuery && matchesStockRisk(product, stockRisk);
      });
  }, [query, snapshot?.products, status, stockRisk]);

  if (!currentStore) return null;
  const refresh = () => dashboard.refresh.mutate();
  return (
    <>
      <PageHeading
        dashboard={dashboard.data}
        detail={`${currentStore.label} · ${currentStore.businessMode}`}
        eyebrow="经营中心"
        onRefresh={refresh}
        refreshing={dashboard.refresh.isPending}
        title="商品经营"
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
            <Metric detail="当前店铺 SKC" label="商品数" value={snapshot.productCount} />
            <Metric detail="平台精确状态" label="已上架" tone="success" value={snapshot.totals?.activeProductCount} />
            <Metric detail="等待平台上架" label="待上架" value={snapshot.totals?.pendingProductCount} />
            <Metric detail={`售罄 ${formatNumber(snapshot.totals?.soldOutProductCount)}`} label="已下架" value={snapshot.totals?.offShelfProductCount} />
          </section>

          <section className="data-panel">
            <header className="data-toolbar">
              <div>
                <h2>店铺商品</h2>
                <p>共 {formatNumber(products.length)} 个结果，默认按近 30 日销量排序</p>
              </div>
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                <label className="search-field">
                  <Search size={16} />
                  <input
                    aria-label="搜索商品"
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="搜索商品、SKC、SPU"
                    value={query}
                  />
                </label>
                <select
                  aria-label="筛选商品状态"
                  className="select-field"
                  onChange={(event) => setStatus(event.target.value)}
                  value={status}
                >
                  <option value="all">全部状态</option>
                  <option value="待上架">待上架</option>
                  <option value="已上架">已上架</option>
                  <option value="已下架">已下架</option>
                  <option value="已售罄">已售罄</option>
                </select>
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
                <table className="operations-table">
                  <thead>
                    <tr>
                      <th>商品</th>
                      <th>状态</th>
                      <th className="text-right">今日</th>
                      <th className="text-right">7 日</th>
                      <th className="text-right">30 日</th>
                      <th className="text-right">实际库存</th>
                      <th className="text-right">可售天数</th>
                      <th aria-label="操作" />
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((product, index) => {
                      const tone = stockRiskTone(product);
                      return (
                        <Fragment key={product.skc || product.spu || index}>
                        <tr>
                          <td>
                            <div className="flex min-w-[250px] items-center gap-3">
                              <ProductVisual product={product} />
                              <span className="min-w-0">
                                <strong className="block max-w-[340px] truncate text-sm font-medium text-[var(--ink)]">
                                  {product.name || product.title || "未命名商品"}
                                </strong>
                                <small className="mt-1 block text-xs text-[var(--text-subtle)]">
                                  SKC {product.skc || "--"}
                                </small>
                              </span>
                            </div>
                          </td>
                          <td><span className="status-badge">{product.state || "状态未知"}</span></td>
                          <td className="text-right tabular-nums">{formatNumber(product.sales?.today)}</td>
                          <td className="text-right tabular-nums">{formatNumber(product.sales?.sales7)}</td>
                          <td className="text-right font-medium tabular-nums">{formatNumber(product.sales?.sales30)}</td>
                          <td className="text-right tabular-nums">{formatNumber(product.actualInventory)}</td>
                          <td className="text-right">
                            <span className={`stock-state stock-${tone}`}>
                              {product.daysOfCover == null ? "--" : `${formatNumber(product.daysOfCover)} 天`}
                            </span>
                          </td>
                          <td className="text-right">
                            <Button
                              aria-label={`${expandedSkc === product.skc ? "收起" : "查看"} ${product.skc || "商品"} SKU`}
                              onClick={() =>
                                setExpandedSkc((current) =>
                                  current === product.skc ? null : product.skc || null,
                                )
                              }
                              size="icon"
                              title={expandedSkc === product.skc ? "收起 SKU 明细" : "查看 SKU 明细"}
                              variant="ghost"
                            >
                              {expandedSkc === product.skc
                                ? <ChevronDown size={17} />
                                : <ChevronRight size={17} />}
                            </Button>
                          </td>
                        </tr>
                        {expandedSkc === product.skc && (
                          <tr className="bg-[var(--surface-muted)]">
                            <td className="px-4 py-4" colSpan={8}>
                              {product.skus?.length ? (
                                <div className="overflow-x-auto">
                                  <table className="operations-table min-w-[720px]">
                                    <thead>
                                      <tr>
                                        <th>SKU</th>
                                        <th>供应商 SKU</th>
                                        <th>尺寸</th>
                                        <th className="text-right">今日</th>
                                        <th className="text-right">7 日</th>
                                        <th className="text-right">实际库存</th>
                                        <th className="text-right">可售天数</th>
                                        <th className="text-right">建议备货</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {product.skus.map((sku, skuIndex) => (
                                        <tr key={sku.skuCode || sku.supplierSku || skuIndex}>
                                          <td className="font-mono text-xs">{sku.skuCode || "--"}</td>
                                          <td className="text-xs">{sku.supplierSku || "--"}</td>
                                          <td className="text-xs">{sku.size || sku.sizeLabel || "--"}</td>
                                          <td className="text-right tabular-nums">{formatNumber(sku.sales?.today)}</td>
                                          <td className="text-right tabular-nums">{formatNumber(sku.sales?.sales7)}</td>
                                          <td className="text-right tabular-nums">
                                            {formatNumber(sku.actualInventory ?? sku.inventory)}
                                          </td>
                                          <td className="text-right tabular-nums">
                                            {sku.daysOfCover == null ? "--" : `${formatNumber(sku.daysOfCover)} 天`}
                                          </td>
                                          <td className="text-right font-medium tabular-nums text-[var(--danger)]">
                                            {Number(sku.suggestedRestock || 0) > 0
                                              ? formatNumber(sku.suggestedRestock)
                                              : "--"}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              ) : (
                                <p className="text-xs text-[var(--text-subtle)]">
                                  当前缓存没有该 SKC 的 SKU 明细。
                                </p>
                              )}
                            </td>
                          </tr>
                        )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="grid min-h-64 place-items-center px-4 text-center">
                <div>
                  <PackageOpen className="mx-auto text-[var(--text-subtle)]" size={24} />
                  <p className="mt-3 text-sm font-medium text-[var(--ink)]">没有匹配的商品</p>
                  <p className="mt-1 text-xs text-[var(--text-subtle)]">调整搜索词或商品状态后重试</p>
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
