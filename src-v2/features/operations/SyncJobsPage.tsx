import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  DatabaseZap,
  ListChecks,
  LoaderCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { useAppContext } from "../../app/AppShell";
import { Button } from "../../components/ui/button";
import {
  api,
  type SyncJobState,
  type SyncJobSummary,
  type SyncJobType,
} from "../../lib/api";
import { cn } from "../../lib/cn";
import { formatTime } from "./OperationsShared";
import { activeJobRefetchInterval } from "../../lib/refresh-state";

const jobTypeLabels: Record<SyncJobType, string> = {
  store_business_refresh: "经营数据刷新",
  product_incremental_sync: "商品增量同步",
  sales_daily_sync: "销量同步",
  inventory_sync: "库存同步",
  compliance_sync: "合规同步",
  rule_refresh: "规则刷新",
  webhook_reconcile: "Webhook 对账",
};

const stateLabels: Record<SyncJobState, string> = {
  queued: "等待中",
  running: "运行中",
  succeeded: "已完成",
  completed: "已完成",
  completed_with_errors: "部分完成",
  failed: "失败",
  cancelled: "已取消",
};

const terminalJobStates: SyncJobState[] = ["succeeded", "completed", "completed_with_errors", "failed", "cancelled"];

function JobState({ state }: { state: SyncJobState | "skipped" }) {
  const icon = state === "succeeded" || state === "completed" || state === "skipped"
    ? <CheckCircle2 size={14} />
    : state === "failed" || state === "completed_with_errors" || state === "cancelled"
      ? <XCircle size={14} />
      : state === "running"
        ? <LoaderCircle className="animate-spin" size={14} />
        : <CircleDashed size={14} />;
  const label = state === "skipped" ? "已跳过" : stateLabels[state];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium",
        (state === "succeeded" || state === "completed" || state === "skipped") && "text-[var(--success-strong)]",
        (state === "failed" || state === "completed_with_errors" || state === "cancelled") && "text-[var(--danger)]",
        (state === "queued" || state === "running") && "text-[var(--warning)]",
      )}
    >
      {icon}{label}
    </span>
  );
}

function progressText(job: SyncJobSummary) {
  const { processed, total, succeeded, failed } = job.progress;
  if (processed != null && total != null) return `${processed}/${total}`;
  if (succeeded != null || failed != null) {
    return `成功 ${succeeded || 0} · 失败 ${failed || 0}`;
  }
  return job.progress.snapshotStored ? "快照已保存" : "--";
}

function jobLabel(job: Pick<SyncJobSummary, "jobType" | "progress">) {
  if (job.jobType === "rule_refresh" && job.progress.scope === "all") {
    return "全类目 schema 同步";
  }
  return jobTypeLabels[job.jobType];
}

export function SyncJobsPage() {
  const { currentStore, session } = useAppContext();
  const [state, setState] = useState<SyncJobState | "">("");
  const [jobType, setJobType] = useState<SyncJobType | "">("");
  const [jobSearch, setJobSearch] = useState("");
  const [selectedJob, setSelectedJob] = useState<{ storeId: string; id: string } | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const storeId = currentStore?.id || "";
  const queryScope = `${session.tenant.id}:${session.user.id}`;
  const selectedJobId = selectedJob?.storeId === storeId ? selectedJob.id : null;
  useEffect(() => {
    // Keep the selected task detail strictly bound to the current store.
    // AppShell reuses this route component during store switching.
    setSelectedJob(null);
    setFeedback(null);
  }, [storeId]);
  const jobsQuery = useQuery({
    queryKey: ["store", queryScope, storeId, "jobs", { state, jobType }],
    queryFn: () => api.syncJobs(storeId, { state, jobType }),
    enabled: Boolean(storeId),
    refetchOnMount: false,
  });
  const detailQuery = useQuery({
    queryKey: ["store", queryScope, storeId, "jobs", selectedJobId],
    queryFn: () => api.syncJob(storeId, selectedJobId!),
    enabled: Boolean(storeId && selectedJobId),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
    refetchInterval: activeJobRefetchInterval,
    refetchIntervalInBackground: false,
  });
  const ruleRefresh = useMutation({
    mutationFn: () => api.refreshRules(storeId),
    onSuccess: (result) => {
      setFeedback("规则刷新任务已创建，任务列表已切换到规则刷新。");
      setJobType("rule_refresh");
      if (result.job?.id) setSelectedJob({ storeId, id: result.job.id });
      void jobsQuery.refetch();
    },
  });
  const complianceRefresh = useMutation({
    mutationFn: () => api.refreshCompliance(storeId),
    onSuccess: (result) => {
      setFeedback("合规刷新任务已创建，任务列表已切换到合规同步。");
      setJobType("compliance_sync");
      if (result.job?.id) setSelectedJob({ storeId, id: result.job.id });
      void jobsQuery.refetch();
    },
  });
  const retryRuleRefresh = useMutation({
    mutationFn: (jobId: string) => api.retryRuleRefresh(storeId, jobId),
    onSuccess: (result) => {
      setFeedback("失败类目重试任务已创建，已打开新任务详情。");
      setJobType("rule_refresh");
      setSelectedJob({ storeId, id: result.job.id });
      void jobsQuery.refetch();
    },
  });

  useEffect(() => {
    if (
      selectedJobId &&
      jobsQuery.data &&
      !jobsQuery.isFetching &&
      !jobsQuery.data.jobs.some((job) => job.id === selectedJobId)
    ) {
      setSelectedJob(null);
    }
  }, [jobsQuery.data, jobsQuery.isFetching, selectedJobId]);

  useEffect(() => {
    const state = detailQuery.data?.job?.state;
    if (selectedJobId && state && terminalJobStates.includes(state)) {
      void jobsQuery.refetch();
    }
  }, [detailQuery.data?.job?.state, jobsQuery.refetch, selectedJobId]);

  if (!currentStore) return null;
  const detail = detailQuery.data?.job;
  const jobs = jobsQuery.data?.jobs || [];
  const visibleJobs = jobs.filter((job) => {
    const query = jobSearch.trim().toLocaleLowerCase();
    if (!query) return true;
    return [
      job.id,
      jobLabel(job),
      stateLabels[job.state],
      job.requestedBy?.name,
      job.error?.code,
      job.error?.message,
    ].some((value) => String(value || "").toLocaleLowerCase().includes(query));
  });
  const hasJobFilter = Boolean(state || jobType || jobSearch.trim());
  return (
    <>
      <header className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium text-[var(--text-subtle)]">任务中心</p>
          <h1 className="mt-1.5 text-2xl font-semibold text-[var(--ink)]">同步任务</h1>
          <p className="mt-1.5 text-sm text-[var(--text-muted)]">
            {currentStore.label} · 最近 {jobsQuery.data?.count ?? 0} 条记录
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {["owner", "admin"].includes(session.user.role) && (
            <Button
              disabled={complianceRefresh.isPending}
              onClick={() => complianceRefresh.mutate()}
              title="同步店铺SKC合规要求"
              variant="outline"
            >
              <ShieldCheck size={15} />
              {complianceRefresh.isPending ? "正在创建任务" : "刷新合规"}
            </Button>
          )}
          {session.user.role !== "viewer" && (
            <Button
              disabled={ruleRefresh.isPending}
              onClick={() => ruleRefresh.mutate()}
              title="刷新店铺发布规则"
            >
              <DatabaseZap size={15} />
              {ruleRefresh.isPending ? "正在创建任务" : "刷新规则"}
            </Button>
          )}
          <Button
            aria-label="刷新任务列表"
            disabled={jobsQuery.isFetching}
            onClick={() => jobsQuery.refetch()}
            title="刷新任务列表"
            variant="outline"
          >
            <RefreshCw className={jobsQuery.isFetching ? "animate-spin" : ""} size={15} />
            刷新
          </Button>
        </div>
      </header>

      {feedback && (
        <div aria-live="polite" className="notice notice-success" role="status">
          <CheckCircle2 size={17} />
          <span>{feedback}</span>
        </div>
      )}
      {jobsQuery.error && (
        <div className="notice notice-danger" role="alert">
          <AlertCircle size={17} />
          <span className="min-w-0 flex-1">{jobsQuery.error.message}</span>
          <Button onClick={() => jobsQuery.refetch()} size="sm" variant="outline">重试</Button>
        </div>
      )}
      {ruleRefresh.error && (
        <div className="notice notice-danger" role="alert">
          <AlertCircle size={17} />
          <span className="min-w-0 flex-1">{ruleRefresh.error.message}</span>
        </div>
      )}
      {complianceRefresh.error && (
        <div className="notice notice-danger" role="alert">
          <AlertCircle size={17} />
          <span className="min-w-0 flex-1">{complianceRefresh.error.message}</span>
        </div>
      )}
      {retryRuleRefresh.error && (
        <div className="notice notice-danger" role="alert">
          <AlertCircle size={17} />
          <span className="min-w-0 flex-1">{retryRuleRefresh.error.message}</span>
        </div>
      )}

      <section className="data-panel">
        <header className="data-toolbar">
          <div><h2>任务记录</h2><p>仅显示当前账号有权访问的店铺任务</p></div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <label className="search-field sm:w-60">
              <Search size={15} />
              <input
                aria-label="搜索同步任务"
                onChange={(event) => setJobSearch(event.target.value)}
                placeholder="搜索任务 ID、类型或错误"
                value={jobSearch}
              />
            </label>
            <select
              aria-label="筛选任务类型"
              className="select-field"
              onChange={(event) => setJobType(event.target.value as SyncJobType | "")}
              value={jobType}
            >
              <option value="">全部类型</option>
              {Object.entries(jobTypeLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <select
              aria-label="筛选任务状态"
              className="select-field"
              onChange={(event) => setState(event.target.value as SyncJobState | "")}
              value={state}
            >
              <option value="">全部状态</option>
              {Object.entries(stateLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
        </header>

        {jobsQuery.isLoading && (
          <div className="grid min-h-72 place-items-center text-sm text-[var(--text-muted)]">
            <span className="flex items-center gap-2"><LoaderCircle className="animate-spin" size={18} />正在读取任务</span>
          </div>
        )}
        {jobsQuery.data && visibleJobs.length === 0 && (
          <div className="grid min-h-72 place-items-center text-center">
            <div>
              <ListChecks className="mx-auto text-[var(--text-subtle)]" size={25} />
              <p className="mt-3 text-sm font-medium text-[var(--ink)]">
                {jobs.length && hasJobFilter ? "没有匹配的同步任务" : "暂无同步任务"}
              </p>
              <p className="mt-1 text-xs text-[var(--text-subtle)]">
                {jobs.length && hasJobFilter
                  ? "调整任务搜索、类型或状态筛选后重试"
                  : "经营页面手动刷新后会产生任务记录"}
              </p>
            </div>
          </div>
        )}
        {jobsQuery.data && visibleJobs.length > 0 && (
          <div className="table-scroll">
            <table className="operations-table">
              <thead><tr><th>任务</th><th>状态</th><th>进度</th><th>发起人</th><th>创建时间</th><th><span className="sr-only">查看</span></th></tr></thead>
              <tbody>
                {visibleJobs.map((job) => (
                  <tr className={selectedJobId === job.id ? "bg-[var(--surface-muted)]" : ""} key={job.id}>
                    <td>
                      <strong className="block text-sm font-medium text-[var(--ink)]">{jobLabel(job)}</strong>
                      <small className="mt-1 block font-mono text-xs text-[var(--text-subtle)]">{job.id.slice(0, 8)}</small>
                    </td>
                    <td><JobState state={job.state} /></td>
                    <td className="text-sm text-[var(--text-muted)]">{progressText(job)}</td>
                    <td className="text-sm text-[var(--text-muted)]">{job.requestedBy?.me ? "当前账号" : job.requestedBy?.name || "系统"}</td>
                    <td className="whitespace-nowrap text-xs text-[var(--text-subtle)]">{formatTime(job.createdAt)}</td>
                    <td className="text-right">
                      <Button
                        aria-label={`查看任务 ${job.id.slice(0, 8)}`}
                        onClick={() => setSelectedJob({ storeId, id: job.id })}
                        size="icon"
                        title="查看任务详情"
                        variant="ghost"
                      >
                        <ChevronRight size={16} />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {selectedJobId && (
          <div className="border-t border-[var(--line)] bg-[var(--surface-muted)] px-4 py-5 sm:px-5">
            {detailQuery.isLoading ? (
              <div className="flex min-h-32 items-center justify-center gap-2 text-sm text-[var(--text-muted)]">
                <LoaderCircle className="animate-spin" size={17} />正在读取任务详情
              </div>
            ) : detailQuery.error ? (
              <div className="notice notice-danger mb-0" role="alert">
                <AlertCircle size={17} />{detailQuery.error.message}
              </div>
            ) : detail ? (
              <div>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-[var(--ink)]">{jobLabel(detail)}</h3>
                      <p className="mt-1 break-all font-mono text-xs text-[var(--text-subtle)]">{detail.id}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {["owner", "admin"].includes(session.user.role) &&
                      detail.state === "failed" &&
                      detail.progress.failedTargets?.length ? (
                        <Button
                          disabled={retryRuleRefresh.isPending}
                          onClick={() => retryRuleRefresh.mutate(detail.id)}
                          size="sm"
                          title="只重新读取本次任务失败的官方类目 schema"
                          variant="outline"
                        >
                          {retryRuleRefresh.isPending
                            ? <LoaderCircle className="animate-spin" size={14} />
                            : <RefreshCw size={14} />}
                          {retryRuleRefresh.isPending ? "正在创建重试" : "仅重试失败类目"}
                        </Button>
                      ) : null}
                      <JobState state={detail.state} />
                    </div>
                  </div>
                <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
                  <div><dt className="text-xs text-[var(--text-subtle)]">发起人</dt><dd className="mt-1 text-[var(--ink)]">{detail.requestedBy?.me ? "当前账号" : detail.requestedBy?.name || "系统"}</dd></div>
                  <div><dt className="text-xs text-[var(--text-subtle)]">开始时间</dt><dd className="mt-1 text-[var(--ink)]">{formatTime(detail.startedAt)}</dd></div>
                  <div><dt className="text-xs text-[var(--text-subtle)]">完成时间</dt><dd className="mt-1 text-[var(--ink)]">{formatTime(detail.completedAt)}</dd></div>
                  <div><dt className="text-xs text-[var(--text-subtle)]">任务进度</dt><dd className="mt-1 text-[var(--ink)]">{progressText(detail)}</dd></div>
                </dl>
                {detail.error && (
                  <div className="mt-5 flex gap-2 rounded-md border border-[var(--danger-line)] bg-[var(--danger-soft)] px-3 py-2.5 text-sm text-[var(--danger-strong)]" role="alert">
                    <AlertCircle className="mt-0.5 shrink-0" size={16} />
                    <span>{detail.error.message} <span className="font-mono text-xs">({detail.error.code})</span></span>
                  </div>
                )}
                {detail.progress.failedTargets?.length ? (
                  <div className="mt-5 border-t border-[var(--line)] pt-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h4 className="text-xs font-semibold text-[var(--ink)]">失败类目</h4>
                      <span className="text-xs text-[var(--text-subtle)]">
                        已展示 {detail.progress.failedTargets.length}
                        {detail.progress.failed != null
                          ? ` / ${detail.progress.failed}`
                          : ""}
                      </span>
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {detail.progress.failedTargets.map((target) => (
                        <div
                          className="rounded-md border border-[var(--danger-line)] bg-[var(--surface)] px-3 py-2 text-xs"
                          key={`${target.categoryId}-${target.productTypeId}`}
                        >
                          <span className="font-medium text-[var(--ink)]">
                            Category {target.categoryId}
                          </span>
                          <span className="ml-2 font-mono text-[var(--text-subtle)]">
                            Product Type {target.productTypeId}
                          </span>
                        </div>
                      ))}
                    </div>
                    {detail.progress.failed != null &&
                    detail.progress.failed > detail.progress.failedTargets.length && (
                      <p className="mt-2 text-xs text-[var(--text-subtle)]">
                        仅展示前 500 个失败类目，请重新同步后查看最新结果。
                      </p>
                    )}
                  </div>
                ) : null}
                <div className="mt-5 border-t border-[var(--line)] pt-4">
                  <h4 className="text-xs font-semibold text-[var(--ink)]">分批明细</h4>
                  {detail.items.length ? (
                    <div className="mt-3 divide-y divide-[var(--line)]">
                      {detail.items.map((item) => (
                        <div className="flex flex-col gap-2 py-3 text-sm sm:flex-row sm:items-center" key={item.id}>
                          <span className="min-w-0 flex-1 truncate font-medium text-[var(--ink)]">{item.itemKey}</span>
                          <span className="text-xs text-[var(--text-subtle)]">尝试 {item.attemptCount} 次</span>
                          <JobState state={item.state} />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 flex items-center gap-2 text-sm text-[var(--text-subtle)]"><DatabaseZap size={15} />该任务没有分批明细</p>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </section>
    </>
  );
}
