import { ArrowLeft, PackageOpen, RefreshCw } from "lucide-react";
import { useNavigate, useParams } from "react-router";
import { useAppContext } from "../../app/AppShell";
import { Button } from "../../components/ui/button";
import type { BusinessProduct } from "../../lib/api";
import {
  DashboardLoading,
  Metric,
  QueryNotice,
  formatNumber,
  formatTime,
  stockRiskTone,
} from "./OperationsShared";
import { useBusinessDashboard } from "./use-business-dashboard";
import { useRefreshCooldown } from "./refresh-state";

function ProductVisual({ product }: { product: BusinessProduct }) {
  const src = product.imageUrl || product.image;
  return src ? (
    <img alt="" className="size-20 rounded-md border border-[var(--line)] object-cover" src={src} />
  ) : (
    <span className="grid size-20 place-items-center rounded-md bg-[var(--surface-muted)] text-[var(--text-subtle)]">
      <PackageOpen size={25} />
    </span>
  );
}

export function ProductDetailPage() {
  const { currentStore } = useAppContext();
  const { skc = "" } = useParams();
  const navigate = useNavigate();
  const dashboard = useBusinessDashboard(currentStore?.id || "");
  const snapshot = dashboard.data?.snapshot;
  const product = snapshot?.products?.find((item) => String(item.skc || "") === String(skc));
  const refresh = () => dashboard.refresh.mutate();
  const cooldownSeconds = useRefreshCooldown(
    dashboard.data?.refreshControl?.retryAfterSeconds || 0,
    dashboard.data?.lastManualRefreshAt,
  );

  if (!currentStore) return null;
  const tone = product ? stockRiskTone(product) : "neutral";

  return (
    <>
      <header className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          <Button
            className="mb-3"
            onClick={() => navigate(`/app/operations/${encodeURIComponent(currentStore.id)}/alerts`)}
            size="sm"
            variant="ghost"
          >
            <ArrowLeft size={16} />返回经营预警
          </Button>
          <p className="text-xs font-medium text-[var(--text-subtle)]">经营中心 · 商品详情</p>
          <h1 className="mt-1.5 break-all text-2xl font-semibold text-[var(--ink)]">
            {product?.name || product?.title || skc || "商品详情"}
          </h1>
          <p className="mt-1.5 break-all text-sm text-[var(--text-muted)]">
            {currentStore.label} · SKC {skc || "--"}
          </p>
        </div>
        <Button
          disabled={dashboard.refresh.isPending || dashboard.data?.state === "refreshing" || cooldownSeconds > 0}
          onClick={refresh}
          variant="outline"
        >
          <RefreshCw className={dashboard.refresh.isPending ? "animate-spin" : ""} size={15} />
          {dashboard.refresh.isPending || dashboard.data?.state === "refreshing"
            ? "刷新中"
            : cooldownSeconds > 0
              ? `约 ${cooldownSeconds}s 后刷新`
              : "立即刷新"}
        </Button>
      </header>

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
        <section className="empty-panel min-h-[360px]">
          <span className="empty-icon"><PackageOpen size={22} /></span>
          <h2>当前没有经营快照</h2>
          <p>请先刷新店铺经营数据，再查看商品详情。</p>
          <Button disabled={dashboard.refresh.isPending || cooldownSeconds > 0} onClick={refresh}>
            <RefreshCw className={dashboard.refresh.isPending ? "animate-spin" : ""} size={16} />
            {dashboard.refresh.isPending
              ? "正在创建任务"
              : cooldownSeconds > 0
                ? `约 ${cooldownSeconds}s 后刷新`
                : "立即刷新"}
          </Button>
        </section>
      ) : !product ? (
        <section className="empty-panel min-h-[360px]">
          <span className="empty-icon"><PackageOpen size={22} /></span>
          <h2>快照中没有这个 SKC</h2>
          <p>当前页面只展示现有经营快照返回的商品，不会补造商品详情。</p>
          <Button onClick={() => navigate(`/app/operations/${encodeURIComponent(currentStore.id)}/alerts`)}>
            <ArrowLeft size={16} />返回经营预警
          </Button>
        </section>
      ) : (
        <>
          <section className="metric-grid">
            <Metric detail="经营快照口径" label="今日销量" value={product.sales?.today} />
            <Metric detail="滚动统计" label="近 7 日" value={product.sales?.sales7} />
            <Metric detail="滚动统计" label="近 30 日" value={product.sales?.sales30} />
            <Metric detail="店铺实物可用库存" label="实际库存" value={product.actualInventory} />
          </section>

          <section className="data-panel mb-5">
            <header className="data-toolbar">
              <div>
                <h2>商品概览</h2>
                <p>数据来自当前店铺经营快照，更新时间 {formatTime(dashboard.data?.syncedAt)}</p>
              </div>
              <span className={`stock-state stock-${tone}`}>
                {product.daysOfCover == null ? "可售天数未知" : `可售 ${formatNumber(product.daysOfCover)} 天`}
              </span>
            </header>
            <div className="grid gap-5 p-4 sm:grid-cols-[auto_1fr] sm:p-5">
              <ProductVisual product={product} />
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div><dt className="text-xs text-[var(--text-subtle)]">商品状态</dt><dd className="mt-1 font-medium text-[var(--ink)]">{product.state || "状态未知"}</dd></div>
                <div><dt className="text-xs text-[var(--text-subtle)]">SPU</dt><dd className="mt-1 break-all font-mono text-xs text-[var(--ink)]">{product.spu || "--"}</dd></div>
                <div><dt className="text-xs text-[var(--text-subtle)]">商家货号</dt><dd className="mt-1 break-all font-mono text-xs text-[var(--ink)]">{product.supplierCode || "--"}</dd></div>
                <div><dt className="text-xs text-[var(--text-subtle)]">上架天数</dt><dd className="mt-1 font-medium text-[var(--ink)]">{formatNumber(product.listingDays)} 天</dd></div>
                <div><dt className="text-xs text-[var(--text-subtle)]">建议备货缺口</dt><dd className="mt-1 font-medium text-[var(--danger)]">{Number(product.replenishmentGap || 0) > 0 ? formatNumber(product.replenishmentGap) : "--"}</dd></div>
                <div><dt className="text-xs text-[var(--text-subtle)]">数据截止</dt><dd className="mt-1 font-medium text-[var(--ink)]">{dashboard.data?.sourceCutoff || "以平台返回为准"}</dd></div>
              </dl>
            </div>
          </section>

          <section className="data-panel">
            <header className="data-toolbar">
              <div>
                <h2>SKU 明细</h2>
                <p>{product.skus?.length ? `当前快照返回 ${formatNumber(product.skus.length)} 个 SKU` : "当前缓存没有 SKU 明细"}</p>
              </div>
            </header>
            {product.skus?.length ? (
              <div className="table-scroll">
                <table className="operations-table min-w-[760px]">
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
                    {product.skus.map((sku, index) => (
                      <tr key={sku.skuCode || sku.supplierSku || index}>
                        <td className="font-mono text-xs">{sku.skuCode || "--"}</td>
                        <td className="text-xs">{sku.supplierSku || "--"}</td>
                        <td className="text-xs">{sku.size || sku.sizeLabel || "--"}</td>
                        <td className="text-right tabular-nums">{formatNumber(sku.sales?.today)}</td>
                        <td className="text-right tabular-nums">{formatNumber(sku.sales?.sales7)}</td>
                        <td className="text-right tabular-nums">{formatNumber(sku.actualInventory ?? sku.inventory)}</td>
                        <td className="text-right tabular-nums">{sku.daysOfCover == null ? "--" : `${formatNumber(sku.daysOfCover)} 天`}</td>
                        <td className="text-right font-medium tabular-nums text-[var(--danger)]">{Number(sku.suggestedRestock || 0) > 0 ? formatNumber(sku.suggestedRestock) : "--"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="grid min-h-40 place-items-center px-4 text-center">
                <p className="text-sm text-[var(--text-subtle)]">当前缓存没有该 SKC 的 SKU 明细。</p>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
