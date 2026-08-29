import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  ClipboardCheck,
  PackageCheck,
  RefreshCw,
  Store as StoreIcon,
} from "lucide-react";
import { useAppContext } from "../../app/AppShell";
import { Button } from "../../components/ui/button";
import { api } from "../../lib/api";
import { formatNumber, formatTime } from "../operations/OperationsShared";

function todayInChina() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date()).replaceAll("/", "-");
}

function Metric({ label, value, detail, icon: Icon, tone = "default" }: {
  label: string;
  value: number;
  detail: string;
  icon: typeof PackageCheck;
  tone?: "default" | "success" | "danger";
}) {
  return (
    <article className={`metric today-work-metric ${tone === "success" ? "today-work-metric--success" : tone === "danger" ? "today-work-metric--danger" : ""}`}>
      <div className="flex items-center justify-between gap-2"><span>{label}</span><Icon className="text-[var(--text-subtle)]" size={16} /></div>
      <strong className={tone === "success" ? "text-[var(--success-strong)]" : tone === "danger" ? "text-[var(--danger)]" : ""}>{formatNumber(value)}</strong>
      <small>{detail}</small>
    </article>
  );
}

export function TodayWorkPage() {
  const { session, stores } = useAppContext();
  const [date, setDate] = useState(todayInChina);
  const [storeId, setStoreId] = useState("");
  const isAdmin = ["owner", "admin"].includes(session.user.role);
  const queryScope = `${session.tenant.id}:${session.user.id}`;
  const query = useQuery({
    queryKey: ["today-work", queryScope, date, storeId],
    queryFn: () => api.todayWork({ date, storeId: storeId || undefined }),
    staleTime: Infinity,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  });
  const snapshot = query.data;
  const visibleStores = useMemo(() => stores.filter((store) => !storeId || store.id === storeId), [stores, storeId]);

  return (
    <div className="ops-page today-work-page">
      <header className="ops-page__header today-work-header">
        <div className="min-w-0">
          <p className="ops-page__eyebrow">经营中心</p>
          <h1 className="ops-page__title">今日工作</h1>
          <p className="ops-page__description">{isAdmin ? "全站店铺" : "仅显示当前账号名下店铺"} · 数据仅在手动刷新时更新</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex h-9 items-center gap-2 rounded-md border border-[var(--line)] bg-white px-2.5 text-sm text-[var(--text-muted)]">
            <CalendarDays size={15} />
            <span className="sr-only">工作日期</span>
            <input className="w-[132px] bg-transparent text-sm text-[var(--ink)] outline-none" onChange={(event) => setDate(event.target.value)} type="date" value={date} />
          </label>
          <select aria-label="筛选店铺" className="h-9 rounded-md border border-[var(--line)] bg-white px-2.5 text-sm text-[var(--ink)] outline-none focus:border-[var(--focus)]" onChange={(event) => setStoreId(event.target.value)} value={storeId}>
            <option value="">{isAdmin ? "全站店铺" : "全部我的店铺"}</option>
            {stores.map((store) => <option key={store.id} value={store.id}>{store.label}</option>)}
          </select>
          <span className="cache-chip" title="今日工作只在手动刷新时读取，期间使用当前缓存快照">{snapshot?.refreshedAt ? `缓存 ${formatTime(snapshot.refreshedAt)}` : "尚未刷新"}</span>
          <Button aria-label="刷新今日工作" disabled={query.isFetching} onClick={() => void query.refetch()} size="icon" variant="outline"><RefreshCw className={query.isFetching ? "animate-spin" : ""} size={15} /></Button>
        </div>
      </header>

      {query.error && <div className="notice notice-danger today-work-error mb-5" role="alert"><CircleAlert size={17} /><div className="min-w-0 flex-1"><p>今日工作数据读取失败：{query.error instanceof Error ? query.error.message : "请稍后重试"}</p>{snapshot && <small>当前仍展示上次成功读取的缓存数据</small>}</div><Button disabled={query.isFetching} onClick={() => void query.refetch()} size="sm" variant="outline">重新读取</Button></div>}
      <div className="space-y-5">
        <section className="metric-grid">
          <Metric detail="已提交 SHEIN 的商品" icon={PackageCheck} label="今日提交" value={snapshot?.totals.published || 0} />
          <Metric detail="已完成接受核价" icon={CheckCircle2} label="核价通过" tone="success" value={snapshot?.totals.priceAccepted || 0} />
          <Metric detail="平台回读的驳回记录" icon={CircleAlert} label="商品驳回" tone="danger" value={snapshot?.totals.rejected || 0} />
          <Metric detail="平台寄样事件" icon={ClipboardCheck} label="寄样" value={snapshot?.totals.sampled || 0} />
        </section>

        <section className="data-panel">
          <header className="data-toolbar"><div><h2>店铺工作量</h2><p>{date} · 数据时区 Asia/Shanghai · 最近刷新 {formatTime(snapshot?.refreshedAt)}</p></div><StoreIcon className="text-[var(--text-subtle)]" size={18} /></header>
          {snapshot?.stores.length ? <div className="overflow-x-auto"><table className="today-work-table w-full min-w-[760px] text-sm"><thead><tr className="border-b border-[var(--line)] text-left text-xs text-[var(--text-subtle)]"><th className="px-5 py-3 font-medium">店铺</th><th className="px-3 py-3 font-medium">今日提交</th><th className="px-3 py-3 font-medium">核价通过</th><th className="px-3 py-3 font-medium">驳回</th><th className="px-3 py-3 font-medium">寄样</th><th className="px-5 py-3 font-medium">类目分布</th></tr></thead><tbody>{snapshot.stores.map((store) => <tr className="border-b border-[var(--line)] last:border-0" key={store.storeId}><td className="px-5 py-4"><div className="flex items-center gap-2.5"><span className="grid size-8 place-items-center rounded-sm bg-[var(--surface-muted)] text-xs font-semibold text-[var(--ink)]">{store.storeName.slice(0, 1)}</span><span className="font-medium text-[var(--ink)]">{store.storeName}</span></div></td><td className="px-3 py-4 font-semibold text-[var(--ink)]">{formatNumber(store.published)}</td><td className="px-3 py-4 text-[var(--success-strong)]">{formatNumber(store.priceAccepted)}</td><td className="px-3 py-4 text-[var(--danger)]">{formatNumber(store.rejected)}</td><td className="px-3 py-4 text-[var(--ink)]">{formatNumber(store.sampled)}</td><td className="max-w-[360px] px-5 py-4"><div className="flex flex-wrap gap-1.5">{store.categories.length ? store.categories.slice(0, 4).map((category) => <span className="rounded bg-[var(--surface-muted)] px-2 py-1 text-xs text-[var(--text-muted)]" key={category.name}>{category.name} {category.published + category.rejected}</span>) : <span className="text-xs text-[var(--text-subtle)]">暂无类目活动</span>}</div></td></tr>)}</tbody></table></div> : <div className="grid min-h-40 place-items-center px-5 text-sm text-[var(--text-subtle)]">{query.isPending ? "正在汇总今日活动" : visibleStores.length ? "今天还没有已记录的工作活动" : "当前账号没有可访问的店铺"}</div>}
        </section>

        <section className="data-panel">
          <header className="data-toolbar"><div><h2>实时动态</h2><p>只展示当前权限范围内的发布、核价与审核变化</p></div><Activity className="text-[var(--text-subtle)]" size={18} /></header>
          {snapshot?.activity.length ? <div className="today-work-activity divide-y divide-[var(--line)]">{snapshot.activity.map((item, index) => <div className="flex items-start gap-3 px-4 py-3.5 sm:px-5" key={`${item.storeId}-${item.occurredAt}-${index}`}><span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-[var(--surface-muted)] text-[var(--text-subtle)]"><Activity size={14} /></span><div className="min-w-0 flex-1"><p className="text-sm text-[var(--ink)]"><strong className="font-medium">{item.storeName}</strong><span className="mx-1.5 text-[var(--text-subtle)]">·</span>{item.type}<span className="mx-1.5 text-[var(--text-subtle)]">·</span><span className="text-[var(--text-muted)]">{item.title}</span></p><p className="mt-1 text-xs text-[var(--text-subtle)]">{formatTime(item.occurredAt)}</p></div></div>)}</div> : <div className="grid min-h-36 place-items-center px-5 text-sm text-[var(--text-subtle)]">暂无实时动态</div>}
        </section>
      </div>
    </div>
  );
}
