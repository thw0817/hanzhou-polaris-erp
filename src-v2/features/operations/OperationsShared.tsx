import {
  AlertCircle,
  CalendarClock,
  DatabaseZap,
  LoaderCircle,
  PackagePlus,
  RefreshCw,
} from "lucide-react";
import type { ReactNode } from "react";
import type { BusinessDashboard, BusinessProduct, ProductQuotaSnapshot, Store } from "../../lib/api";
import { Button } from "../../components/ui/button";
import { useRefreshCooldown } from "./refresh-state";

export type StockRiskFilter = "all" | "danger" | "healthy" | "unknown";

export function stockRiskTone(
  product: Pick<BusinessProduct, "state" | "daysOfCover">,
) {
  if (product.state !== "已上架" || product.daysOfCover == null) return "neutral";
  return Number(product.daysOfCover) <= 5 ? "danger" : "success";
}

export function matchesStockRisk(
  product: Pick<BusinessProduct, "state" | "daysOfCover">,
  stockRisk: StockRiskFilter,
) {
  if (stockRisk === "all") return true;
  if (stockRisk === "unknown") return product.daysOfCover == null;
  if (product.state !== "已上架" || product.daysOfCover == null) return false;
  return stockRisk === "danger"
    ? Number(product.daysOfCover) <= 5
    : Number(product.daysOfCover) > 5;
}

export function formatNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? new Intl.NumberFormat("zh-CN").format(number) : "--";
}

export function formatTime(value?: string | null) {
  if (!value) return "尚未同步";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatSourceDate(value?: string) {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(String(value || ""));
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "以平台返回为准";
}

export function PublishQuotaNotice({
  quota,
  loading = false,
  compact = false,
}: {
  quota?: ProductQuotaSnapshot | null;
  loading?: boolean;
  compact?: boolean;
}) {
  const available = Number(quota?.availableLimit);
  const hasValue = Number.isFinite(available) && available >= 0;
  return (
    <section
      aria-label="本月剩余发品额度"
      className={compact
        ? "mb-4 flex items-center justify-between gap-3 rounded-lg border border-[var(--line)] bg-white px-4 py-3"
        : "mb-4 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[var(--line)] bg-white px-5 py-4 shadow-sm"}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--surface-muted)] text-[var(--text-muted)]">
          <PackagePlus size={17} />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-medium text-[var(--text-muted)]">本月剩余发品额度</p>
          <p className="mt-0.5 text-xs text-[var(--text-subtle)]">
            {loading
              ? "正在读取商家发品额度…"
              : quota?.localQuotaUpdatedAt
                ? "已包含最近成功提交的商品扣减"
                : "以 SHEIN 官方额度回读为准"}
          </p>
        </div>
      </div>
      <div className="text-right">
        <p className={compact ? "text-lg font-semibold text-[var(--ink)]" : "text-2xl font-semibold text-[var(--ink)]"}>
          {loading ? "…" : hasValue ? formatNumber(available) : "待同步"}
        </p>
        {!loading && !hasValue ? (
          <p className="mt-0.5 text-[11px] text-[var(--text-subtle)]">暂未收到商家发品额度事件</p>
        ) : null}
      </div>
    </section>
  );
}

export function PageHeading({
  eyebrow,
  title,
  detail,
  dashboard,
  refreshing,
  onRefresh,
  primaryAction,
}: {
  eyebrow: string;
  title: string;
  detail: string;
  dashboard?: BusinessDashboard;
  refreshing: boolean;
  onRefresh: () => void;
  primaryAction?: ReactNode;
}) {
  const retryAfterSeconds = useRefreshCooldown(dashboard?.refreshControl?.status === "cooldown"
    ? dashboard.refreshControl.retryAfterSeconds || 0
    : 0, dashboard?.lastManualRefreshAt);
  const refreshDisabled = refreshing || dashboard?.state === "refreshing" || retryAfterSeconds > 0;
  return (
    <header className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
      <div className="min-w-0">
        <p className="text-xs font-medium text-[var(--text-subtle)]">{eyebrow}</p>
        <h1 className="mt-1.5 text-2xl font-semibold text-[var(--ink)]">{title}</h1>
        <p className="mt-1.5 text-sm text-[var(--text-muted)]">{detail}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-4 text-xs text-[var(--text-subtle)]">
          <span className="flex items-center gap-1.5">
            <CalendarClock size={14} />
            {formatTime(dashboard?.syncedAt)}
          </span>
          <span className="hidden items-center gap-1.5 sm:flex">
            <DatabaseZap size={14} />
            截止 {formatSourceDate(dashboard?.sourceCutoff)}
          </span>
          {dashboard?.state === "refreshing" && dashboard.refreshJob && (
            <span title={dashboard.refreshJob.id}>
              任务 {dashboard.refreshJob.id.slice(0, 8)}
            </span>
          )}
          {dashboard?.webhookPending && (
            <span className="status-badge status-warning">SHEIN 待回读</span>
          )}
        </div>
        {primaryAction}
        <Button
          disabled={refreshDisabled}
          onClick={onRefresh}
          variant="outline"
        >
          <RefreshCw
            className={refreshing || dashboard?.state === "refreshing" ? "animate-spin" : ""}
            size={15}
          />
          {refreshing || dashboard?.state === "refreshing"
            ? "刷新中"
            : retryAfterSeconds > 0
              ? `约 ${retryAfterSeconds}s 后刷新`
              : "立即刷新"}
        </Button>
      </div>
    </header>
  );
}

export function QueryNotice({
  error,
  stale,
  lastError,
  webhookPending,
  onRetry,
}: {
  error?: Error | null;
  stale?: boolean;
  lastError?: BusinessDashboard["lastError"];
  webhookPending?: boolean;
  onRetry: () => void;
}) {
  if (error) {
    return (
      <div className="notice notice-danger" role="alert">
        <AlertCircle size={17} />
        <span className="min-w-0 flex-1">{error.message}</span>
        <Button onClick={onRetry} size="sm" variant="outline">重试</Button>
      </div>
    );
  }
  if (lastError) {
    return (
      <div className="notice notice-warning" role="status">
        <AlertCircle size={17} />
        <span>上次刷新未完整成功：{lastError.message || "部分数据可能仍是旧缓存"}</span>
      </div>
    );
  }
  if (webhookPending) {
    return (
      <div className="notice notice-info" role="status">
        <DatabaseZap size={17} />
        <span>SHEIN 已推送数据变更，当前缓存待回读；点击刷新后会调用一次真实同步。</span>
      </div>
    );
  }
  if (stale) {
    return (
      <div className="notice" role="status">
        <CalendarClock size={17} />
        <span>当前展示的是过期缓存，可手动刷新获取最新数据。</span>
      </div>
    );
  }
  return null;
}

export function DashboardLoading() {
  return (
    <section className="grid min-h-[360px] place-items-center rounded-lg border border-[var(--line)] bg-white">
      <div className="text-center text-sm text-[var(--text-muted)]">
        <LoaderCircle className="mx-auto mb-3 animate-spin" size={22} />
        正在读取店铺缓存
      </div>
    </section>
  );
}

export function EmptyDashboard({
  store,
  failed,
  onRefresh,
  refreshing,
  retryAfterSeconds = 0,
  lastManualRefreshAt = null,
}: {
  store: Store;
  failed?: boolean;
  onRefresh: () => void;
  refreshing: boolean;
  retryAfterSeconds?: number;
  lastManualRefreshAt?: string | null;
}) {
  const remainingCooldown = useRefreshCooldown(retryAfterSeconds, lastManualRefreshAt);
  const coolingDown = remainingCooldown > 0;
  return (
    <section className="empty-panel min-h-[420px]">
      <span className="empty-icon">
        {failed ? <AlertCircle size={22} /> : <DatabaseZap size={22} />}
      </span>
      <h2>{failed ? "经营数据刷新失败" : "当前店铺还没有经营缓存"}</h2>
      <p>
        {failed
          ? "旧数据不会被清空，请检查店铺授权后重新刷新。"
          : `${store.label} 尚未同步商品、销量和库存。`}
      </p>
      <Button disabled={refreshing || coolingDown} onClick={onRefresh}>
        <RefreshCw className={refreshing ? "animate-spin" : ""} size={16} />
        {refreshing ? "正在创建任务" : coolingDown ? `约 ${remainingCooldown}s 后刷新` : "立即刷新"}
      </Button>
    </section>
  );
}

export function Metric({
  label,
  value,
  detail,
  tone = "default",
}: {
  label: string;
  value: unknown;
  detail: string;
  tone?: "default" | "success" | "danger";
}) {
  return (
    <article className="metric">
      <span>{label}</span>
      <strong className={tone === "success" ? "text-[var(--success-strong)]" : tone === "danger" ? "text-[var(--danger)]" : ""}>
        {formatNumber(value)}
      </strong>
      <small>{detail}</small>
    </article>
  );
}
