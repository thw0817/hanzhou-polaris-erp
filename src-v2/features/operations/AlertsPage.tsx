import { AlertTriangle, BellRing, ChevronRight, PackageOpen, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useAppContext } from "../../app/AppShell";
import { useNavigate } from "react-router";
import { Button } from "../../components/ui/button";
import {
  DashboardLoading,
  EmptyDashboard,
  Metric,
  PageHeading,
  QueryNotice,
  formatNumber,
} from "./OperationsShared";
import { useBusinessDashboard } from "./use-business-dashboard";

function WarningVisual({ src }: { src?: string }) {
  return src ? (
    <img alt="" className="size-11 rounded-md border border-[var(--line)] object-cover" src={src} />
  ) : (
    <span className="grid size-11 shrink-0 place-items-center rounded-md bg-[var(--surface-muted)] text-[var(--text-subtle)]">
      <PackageOpen size={18} />
    </span>
  );
}

function warningToneMeta(tone?: string) {
  if (tone === "high") {
    return {
      label: "高优先级",
      iconClass: "bg-[var(--danger-soft)] text-[var(--danger)]",
      badgeClass: "bg-[var(--danger-soft)] text-[var(--danger-strong)]",
    };
  }
  if (tone === "medium") {
    return {
      label: "中优先级",
      iconClass: "bg-[var(--warning-soft)] text-[var(--warning-strong)]",
      badgeClass: "bg-[var(--warning-soft)] text-[var(--warning-strong)]",
    };
  }
  if (tone === "low") {
    return {
      label: "低优先级",
      iconClass: "bg-[var(--success-soft)] text-[var(--success-strong)]",
      badgeClass: "bg-[var(--success-soft)] text-[var(--success-strong)]",
    };
  }
  return {
    label: "优先级待确认",
    iconClass: "bg-[var(--surface-muted)] text-[var(--text-subtle)]",
    badgeClass: "bg-[var(--surface-muted)] text-[var(--text-subtle)]",
  };
}

export function AlertsPage() {
  const { currentStore } = useAppContext();
  const navigate = useNavigate();
  const dashboard = useBusinessDashboard(currentStore?.id || "");
  const snapshot = dashboard.data?.snapshot;
  const [warningTone, setWarningTone] = useState("all");
  const [warningSearch, setWarningSearch] = useState("");
  const warnings = snapshot?.warnings || [];
  const filteredWarnings = useMemo(() => {
    const query = warningSearch.trim().toLocaleLowerCase();
    return warnings.filter((warning) => {
      if (warningTone !== "all" && warning.tone !== warningTone) return false;
      if (!query) return true;
      const linkedProduct = snapshot?.products?.find((product) => product.skc === warning.skc);
      return [
        warning.skc,
        warning.name,
        warning.title,
        warning.message,
        linkedProduct?.name,
        linkedProduct?.title,
        linkedProduct?.supplierCode,
      ].some((value) => String(value || "").toLocaleLowerCase().includes(query));
    });
  }, [snapshot?.products, warningSearch, warningTone, warnings]);
  if (!currentStore) return null;
  const refresh = () => dashboard.refresh.mutate();
  return (
    <>
      <PageHeading
        dashboard={dashboard.data}
        detail={`${currentStore.label} · 基于真实销量、库存和上架状态`}
        eyebrow="经营中心"
        onRefresh={refresh}
        refreshing={dashboard.refresh.isPending}
        title="经营预警"
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
            <Metric detail="按商品逐条计算" label="全部预警" value={warnings.length} />
            <Metric detail="建议优先处理" label="高优先级" tone="danger" value={snapshot.totals?.highWarningCount} />
            <Metric detail="当前平台状态" label="在售商品" tone="success" value={snapshot.totals?.activeProductCount} />
            <Metric detail="店铺实物可用库存" label="实际库存" value={snapshot.totals?.actualInventory} />
          </section>
          <section className="data-panel">
            <header className="data-toolbar">
              <div>
                <h2>需要关注的商品</h2>
                <p>显示 {formatNumber(filteredWarnings.length)} 条，告警不会改变商品或库存</p>
              </div>
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                <label className="search-field sm:w-60">
                  <Search size={15} />
                  <input
                    aria-label="搜索经营预警"
                    onChange={(event) => setWarningSearch(event.target.value)}
                    placeholder="搜索商品、SKC 或预警内容"
                    value={warningSearch}
                  />
                </label>
                <select
                  aria-label="筛选预警优先级"
                  className="select-field"
                  onChange={(event) => setWarningTone(event.target.value)}
                  value={warningTone}
                >
                  <option value="all">全部优先级</option>
                  <option value="high">高优先级</option>
                  <option value="medium">中优先级</option>
                  <option value="low">低优先级</option>
                </select>
              </div>
            </header>
            {filteredWarnings.length ? (
              <div className="divide-y divide-[var(--line)]">
                {filteredWarnings.map((warning, index) => {
                  const linkedProduct = snapshot.products?.find((product) => product.skc === warning.skc);
                  const image = warning.image || linkedProduct?.imageUrl || linkedProduct?.image;
                  const tone = warningToneMeta(warning.tone);
                  return (
                  <article className="flex gap-3 px-4 py-4 sm:px-5" key={warning.id || `${warning.skc}-${index}`}>
                    <span className={`grid size-9 shrink-0 place-items-center rounded-md ${tone.iconClass}`}>
                      <AlertTriangle size={17} />
                    </span>
                    <WarningVisual src={image} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <h3 className="text-sm font-medium text-[var(--ink)]">{warning.title || warning.name || "经营预警"}</h3>
                        <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${tone.badgeClass}`}>
                          {tone.label}
                        </span>
                        <span className="text-xs text-[var(--text-subtle)]">SKC {warning.skc || "--"}</span>
                      </div>
                      <p className="mt-1.5 text-sm leading-6 text-[var(--text-muted)]">{warning.message || "请核对该商品的销量和库存。"}</p>
                      <p className="mt-1.5 text-xs text-[var(--text-subtle)]">
                        上架 {formatNumber(linkedProduct?.listingDays)} 天
                        <span className="mx-1.5">·</span>
                        今日 {formatNumber(linkedProduct?.sales?.today)}
                        <span className="mx-1.5">·</span>
                        7 日 {formatNumber(linkedProduct?.sales?.sales7)}
                        <span className="mx-1.5">·</span>
                        30 日 {formatNumber(linkedProduct?.sales?.sales30)}
                      </p>
                    </div>
                    <span className="hidden text-right text-xs text-[var(--text-subtle)] sm:block">
                      实际库存<br /><strong className="mt-1 block text-sm text-[var(--ink)]">{formatNumber(warning.inventory ?? linkedProduct?.actualInventory)}</strong>
                    </span>
                    <Button
                      aria-label={`查看商品 ${warning.skc || ""}`}
                      onClick={() => navigate(
                        `/app/operations/${encodeURIComponent(currentStore.id)}/products/${encodeURIComponent(warning.skc || "")}`,
                      )}
                      size="icon"
                      title="查看商品"
                      variant="ghost"
                  >
                      <ChevronRight size={17} />
                    </Button>
                  </article>
                  );
                })}
              </div>
            ) : (
              <div className="grid min-h-72 place-items-center px-4 text-center">
                <div>
                  <BellRing className="mx-auto text-[var(--success)]" size={25} />
                  <p className="mt-3 text-sm font-medium text-[var(--ink)]">
                    {warnings.length ? "没有匹配的经营预警" : "当前没有经营预警"}
                  </p>
                  <p className="mt-1 text-xs text-[var(--text-subtle)]">
                    {warnings.length
                      ? "调整预警搜索或优先级筛选后重试"
                      : "最近一次缓存未发现需要处理的商品"}
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
