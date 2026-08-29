import { BarChart3, Boxes, CircleAlert, DatabaseZap, PackageCheck, RefreshCw, Store as StoreIcon, TrendingUp } from "lucide-react";
import { useNavigate } from "react-router";
import { useAppContext } from "../../app/AppShell";
import { Button } from "../../components/ui/button";
import { ApiError, type BusinessProduct, type BusinessSnapshot } from "../../lib/api";
import { formatNumber, formatSourceDate, formatTime } from "../operations/OperationsShared";
import { useRefreshCooldown } from "../operations/refresh-state";
import { useBusinessDashboard } from "../operations/use-business-dashboard";

function metricValue(value: number | null | undefined) {
  return value == null ? "--" : formatNumber(value);
}

function productTotal(snapshot: BusinessSnapshot | null, selector: (product: BusinessProduct) => number | undefined) {
  let total = 0;
  let known = 0;
  for (const product of snapshot?.products || []) {
    const value = selector(product);
    if (value != null && Number.isFinite(Number(value))) {
      total += Number(value);
      known += 1;
    }
  }
  return known ? total : null;
}

function stockRiskCount(snapshot: BusinessSnapshot | null) {
  if (!snapshot) return null;
  return (snapshot.products || []).filter(
    (product) => product.state === "已上架" && product.daysOfCover != null && Number(product.daysOfCover) <= 5,
  ).length;
}

function OverviewMetric({ label, value, detail, tone = "default", icon: Icon }: {
  label: string;
  value: number | null;
  detail: string;
  tone?: "default" | "success" | "danger";
  icon: typeof Boxes;
}) {
  return (
    <article className="metric">
      <div className="flex items-center justify-between gap-2"><span>{label}</span><Icon className="text-[var(--text-subtle)]" size={16} /></div>
      <strong className={tone === "success" ? "text-[var(--success-strong)]" : tone === "danger" ? "text-[var(--danger)]" : ""}>{metricValue(value)}</strong>
      <small>{detail}</small>
    </article>
  );
}

function SalesComparison({ periods }: { periods: Array<{ label: string; value: number | null }> }) {
  const knownValues = periods.map((period) => period.value).filter((value): value is number => value != null);
  const max = Math.max(...knownValues, 1);
  const points = periods.map((period, index) => {
    if (period.value == null) return null;
    return { x: 70 + index * 290, y: 142 - (period.value / max) * 96 };
  });
  const lineSegments: string[][] = [];
  let currentSegment: string[] = [];
  for (const point of points) {
    if (!point) {
      if (currentSegment.length) lineSegments.push(currentSegment);
      currentSegment = [];
      continue;
    }
    currentSegment.push(`${point.x},${point.y}`);
  }
  if (currentSegment.length) lineSegments.push(currentSegment);

  return (
    <section className="data-panel">
      <header className="data-toolbar"><div><h2>销量周期对比</h2><p>当前经营快照的周期聚合对比，不代表连续历史曲线</p></div><BarChart3 className="text-[var(--text-subtle)]" size={18} /></header>
      {knownValues.length ? (
        <div className="px-4 pb-4 sm:px-5">
          <svg aria-label="当日、近7日、近30日销量周期对比图" className="h-56 w-full text-[var(--ink)]" role="img" viewBox="0 0 650 205">
            {[46, 94, 142].map((y) => <line key={y} stroke="var(--line)" strokeDasharray="3 5" x1="40" x2="620" y1={y} y2={y} />)}
            {lineSegments.map((segment, index) => <polyline key={index} fill="none" points={segment.join(" ")} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />)}
            {points.map((point, index) => point && <g key={periods[index].label}><circle cx={point.x} cy={point.y} fill="white" r="6" stroke="currentColor" strokeWidth="3" /><text fill="currentColor" fontSize="12" textAnchor="middle" x={point.x} y={point.y - 14}>{formatNumber(periods[index].value)}</text></g>)}
            {periods.map((period, index) => <text fill="var(--text-subtle)" fontSize="12" textAnchor="middle" x={70 + index * 290} y="181" key={period.label}>{period.label}</text>)}
          </svg>
        </div>
      ) : <div className="grid min-h-56 place-items-center px-4 text-sm text-[var(--text-subtle)]">等待当前店铺的经营快照</div>}
    </section>
  );
}

export function OverviewPage() {
  const { currentStore } = useAppContext();
  const navigate = useNavigate();
  const storeId = currentStore?.id || "";
  const dashboard = useBusinessDashboard(storeId);
  const snapshot = dashboard.data?.snapshot || null;
  const cooldownSeconds = useRefreshCooldown(
    dashboard.data?.refreshControl?.status === "cooldown" ? dashboard.data.refreshControl.retryAfterSeconds || 0 : 0,
    dashboard.data?.lastManualRefreshAt,
  );
  const salesPeriods = [
    { label: "当日", value: snapshot?.totals?.today ?? null },
    { label: "近 7 日", value: snapshot?.totals?.sales7 ?? null },
    { label: "近 30 日", value: snapshot?.totals?.sales30 ?? null },
  ];
  const restockTotal = productTotal(snapshot, (product) => product.replenishmentGap);
  const riskProducts = stockRiskCount(snapshot);
  const restockItems = (snapshot?.products || []).map((product) => ({ product, gap: Number(product.replenishmentGap) }))
    .filter((item) => Number.isFinite(item.gap) && item.gap > 0)
    .sort((left, right) => right.gap - left.gap)
    .slice(0, 8);

  const refreshCurrent = () => dashboard.refresh.mutate();
  const refreshing = dashboard.refresh.isPending;
  const refreshError = dashboard.refreshError;

  if (!currentStore) {
    return <section className="empty-panel min-h-[420px]"><span className="empty-icon"><StoreIcon size={22} /></span><h2>还没有可访问的店铺</h2><p>管理员完成 SHEIN 授权或店铺分配后，这里会显示经营数据。</p></section>;
  }

  const sourceDetail = dashboard.data ? `同步 ${formatTime(dashboard.data.syncedAt)} · 截止 ${formatSourceDate(dashboard.data.sourceCutoff)}` : "尚未取得经营快照";
  const dataStatus = dashboard.error
    ? { label: "读取失败", detail: dashboard.error.message, tone: "text-[var(--danger)]" }
    : dashboard.data?.lastError
      ? { label: "部分失败", detail: dashboard.data.lastError.message || sourceDetail, tone: "text-[var(--danger)]" }
      : dashboard.data?.stale
        ? { label: "数据过期", detail: sourceDetail, tone: "text-[var(--warning-strong)]" }
        : snapshot
          ? { label: "已同步", detail: sourceDetail, tone: "text-[var(--success-strong)]" }
          : { label: "待同步", detail: sourceDetail, tone: "text-[var(--text-subtle)]" };

  return (
    <>
      <header className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0"><p className="text-xs font-medium text-[var(--text-subtle)]">经营中心</p><h1 className="mt-1.5 text-2xl font-semibold text-[var(--ink)]">总览</h1><p className="mt-1.5 text-sm text-[var(--text-muted)]">{currentStore.label} · {dataStatus.label} · {dataStatus.detail}{dashboard.data?.webhookPending ? " · 有平台变更待回读" : ""}</p></div>
        <Button disabled={dashboard.isPending || refreshing || cooldownSeconds > 0} onClick={() => void refreshCurrent()} variant="outline"><RefreshCw className={dashboard.isPending || refreshing ? "animate-spin" : ""} size={15} />{dashboard.isPending ? "读取中" : refreshing ? "刷新中" : cooldownSeconds > 0 ? `约 ${cooldownSeconds}s 后刷新` : "刷新总览"}</Button>
      </header>

      {refreshError && <div className="notice notice-danger mb-5" role="alert"><CircleAlert size={17} /><span className="min-w-0 flex-1">{refreshError.message}</span>{refreshError instanceof ApiError && refreshError.code === "SHEIN_REAUTHORIZATION_REQUIRED" && <Button onClick={() => navigate("/app/settings/stores")} size="sm" variant="outline">重新授权</Button>}</div>}
      {dashboard.error && <div className="notice notice-danger mb-5" role="alert"><CircleAlert size={17} /><span>{dashboard.error.message}</span></div>}

      <div className="space-y-5">
        <section className="metric-grid">
          <OverviewMetric detail={currentStore.label} icon={StoreIcon} label="经营商品" value={snapshot ? snapshot.products?.length || 0 : null} />
          <OverviewMetric detail="当前店铺快照" icon={TrendingUp} label="当日销量" value={salesPeriods[0].value} />
          <OverviewMetric detail="当前店铺快照" icon={BarChart3} label="30 日销量" value={salesPeriods[2].value} />
          <OverviewMetric detail="SHEIN stock-query 官方回读" icon={PackageCheck} label="实际库存" value={snapshot?.totals?.actualInventory ?? null} />
          <OverviewMetric detail="SHEIN stock-query 官方回读" icon={Boxes} label="在途库存" value={snapshot?.totals?.transitInventory ?? null} />
          <OverviewMetric detail="已上架且可售天数 ≤ 5 天" icon={CircleAlert} label="库存风险商品" tone="danger" value={riskProducts} />
        </section>
        <SalesComparison periods={salesPeriods} />
        <section className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)]">
          <section className="data-panel">
            <header className="data-toolbar"><div><h2>备货分析</h2><p>按当前店铺快照的建议备货量排序，仅展示有明确正数缺口的商品</p></div><Boxes className="text-[var(--text-subtle)]" size={18} /></header>
            {restockItems.length ? <div className="divide-y divide-[var(--line)]">{restockItems.map(({ product, gap }, index) => <div className="flex items-center gap-3 px-4 py-3 sm:px-5" key={product.skc || product.spu || index}><span className="grid size-8 shrink-0 place-items-center rounded-sm bg-[var(--danger-soft)] text-xs font-semibold text-[var(--danger-strong)]">{index + 1}</span><div className="min-w-0 flex-1"><strong className="block truncate text-sm font-medium text-[var(--ink)]">{product.name || product.title || "未命名商品"}</strong><span className="mt-1 block truncate text-xs text-[var(--text-subtle)]">SKC {product.skc || "--"} · 可售 {product.daysOfCover == null ? "--" : `${formatNumber(product.daysOfCover)} 天`}</span></div><span className="shrink-0 text-right"><strong className="block text-sm font-semibold text-[var(--danger)]">{formatNumber(gap)}</strong><small className="text-xs text-[var(--text-subtle)]">建议备货</small></span></div>)}</div> : <div className="grid min-h-48 place-items-center px-5 text-center text-sm text-[var(--text-subtle)]">{restockTotal == null ? "等待商品级备货快照" : "当前快照没有明确的备货缺口"}</div>}
          </section>
          <section className="data-panel">
            <header className="data-toolbar"><div><h2>数据边界</h2><p>当前店铺分析结果的来源状态</p></div><DatabaseZap className="text-[var(--text-subtle)]" size={18} /></header>
            <div className="divide-y divide-[var(--line)]"><div className="flex items-start gap-3 px-4 py-4"><TrendingUp className="mt-0.5 text-[var(--text-subtle)]" size={17} /><div><strong className="text-sm font-medium text-[var(--ink)]">周期对比</strong><p className="mt-1 text-xs leading-5 text-[var(--text-subtle)]">使用当前店铺返回的当日、7 日、30 日聚合值，不生成历史日序列。</p></div></div><div className="flex items-start gap-3 px-4 py-4"><Boxes className="mt-0.5 text-[var(--text-subtle)]" size={17} /><div><strong className="text-sm font-medium text-[var(--ink)]">备货分析</strong><p className="mt-1 text-xs leading-5 text-[var(--text-subtle)]">只读取商品快照中的 `replenishmentGap`，缺失时保持待同步。</p></div></div><div className="flex items-start gap-3 px-4 py-4"><CircleAlert className={`mt-0.5 ${dataStatus.tone}`} size={17} /><div><strong className={`text-sm font-medium ${dataStatus.tone}`}>{dataStatus.label}</strong><p className="mt-1 text-xs leading-5 text-[var(--text-subtle)]">{dataStatus.detail}</p></div></div></div>
          </section>
        </section>
      </div>
    </>
  );
}
