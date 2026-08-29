import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  FileText,
  FileWarning,
  Image as ImageIcon,
  ListChecks,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { useNavigate } from "react-router";
import { useAppContext } from "../../app/AppShell";
import { Button } from "../../components/ui/button";
import { OpsMetricStrip, OpsPageHeader, OpsTableShell, OpsToolbar } from "../../components/operations/OperationsPrimitives";
import { OperationsDataTable } from "../../components/operations/OperationsDataTable";
import {
  api,
  type ComplianceCertificateAssignment,
  type CompliancePhotoAssignment,
  type ComplianceStatus,
  type ComplianceTemplate,
  type ComplianceWorkspaceItem,
} from "../../lib/api";
import { formatTime } from "../operations/OperationsShared";
import { activeJobRefetchInterval } from "../../lib/refresh-state";

const statuses: Array<ComplianceStatus | ""> = ["", "未同步", "需修正", "待补充", "审核中", "待同步", "通过"];
// virtualized operational list: SHEIN 的“平台状态”仍由真实回读填充，未回读时保持“待同步”。
const complianceTableColumns = [
  { id: "select", header: "" },
  { id: "image", header: "主图" },
  { id: "product", header: "SKC / 商品" },
  { id: "category", header: "类目" },
  { id: "report", header: "官方报告" },
  { id: "shelf", header: "平台状态" },
  { id: "overall", header: "总体" },
  { id: "package", header: "包装实拍" },
  { id: "body", header: "商品实拍" },
  { id: "updated", header: "更新时间" },
  { id: "actions", header: "" },
] satisfies Array<{ id: string; header: string }>;
function statusClass(status: string) {
  if (status === "通过" || status === "无需") return "compliance-status-success";
  if (["需修正", "待补充", "失败"].includes(status)) return "compliance-status-danger";
  if (["审核中", "待同步", "待上架"].includes(status)) return "compliance-status-warning";
  if (["已下架", "已售罄", "售完下架"].includes(status)) return "compliance-status-danger";
  if (status === "已上架") return "compliance-status-success";
  return "";
}

function Status({ value }: { value?: string }) {
  const status = value || "未同步";
  return <span className={`status-badge ${statusClass(status)}`}>{status}</span>;
}

function categoryLabel(item: ComplianceWorkspaceItem) {
  const path = item.categoryPath?.filter(Boolean) || [];
  const top = path[0]?.replace(/&生活$/u, "").trim();
  const leaf = path.at(-1)?.trim();
  if (top && leaf && top !== leaf) return `${top} - ${leaf}`;
  const fallback = String(item.categoryName || "").trim();
  return /^(?:类目\s*)?\d+$/u.test(fallback) ? "未分类" : fallback || "未分类";
}

function templateHasPhotos(template: ComplianceTemplate) {
  return (template.data.defaults?.photos || []).some((photo) => photo.localAssetRef);
}

function templateHasReport(template: ComplianceTemplate) {
  return Boolean(template.data.templateKind === "rug_report" && template.data.reportType && template.data.reportFile?.localAssetRef && template.data.reportDate);
}

function isComplianceSyncRunning(state?: string | null) {
  return state === "queued" || state === "running";
}

function isComplianceSyncTerminal(state?: string | null) {
  return ["succeeded", "completed", "completed_with_errors", "failed", "cancelled"].includes(state || "");
}

function isComplianceSyncSuccessful(state?: string | null) {
  return state === "succeeded" || state === "completed";
}

function complianceSyncMessage(job: { state?: string | null; error?: { message?: string } | null }) {
  if (isComplianceSyncSuccessful(job.state)) return "合规同步完成，已回读 SHEIN 数据";
  if (job.state === "completed_with_errors") {
    return job.error?.message || "合规同步部分完成，部分 SKC 查询失败，请重试";
  }
  return job.error?.message || "合规同步失败，请重试";
}

async function uploadPhotos(storeId: string, files: File[], labelGroup: "1" | "2"): Promise<CompliancePhotoAssignment[]> {
  return Promise.all(files.map(async (file) => {
    const result = await api.uploadComplianceEvidence(storeId, file);
    return {
      labelId: "",
      labelGroup,
      localAssetRef: `media:${result.asset.id}`,
      fileName: file.name,
      mimeType: file.type,
      size: file.size,
      width: result.asset.width,
      height: result.asset.height,
      templateReusable: false,
    } satisfies CompliancePhotoAssignment;
  }));
}

async function uploadReport(storeId: string, file: File, reportType: "1630" | "1631", reportDate: string): Promise<ComplianceCertificateAssignment & { reportType: "1630" | "1631"; reportDate: string }> {
  const result = await api.uploadComplianceEvidence(storeId, file);
  return {
    certificateTypeId: null,
    certificateTypeCode: "",
    certificateTypeName: `16 CFR ${reportType} 检测报告`,
    certificateDimension: null,
    skc: "",
    reportType,
    reportDate,
    files: [{ localAssetRef: `media:${result.asset.id}`, fileName: file.name, mimeType: file.type, size: file.size }],
    fieldValues: {},
  };
}

export function CompliancePage() {
  const { currentStore, session } = useAppContext();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim());
  const [status, setStatus] = useState<ComplianceStatus | "">("");
  const [page, setPage] = useState(1);
  const [selectedSkcs, setSelectedSkcs] = useState<string[]>([]);
  const [photoTemplateId, setPhotoTemplateId] = useState("");
  const [reportTemplateId, setReportTemplateId] = useState("");
  const [packageFiles, setPackageFiles] = useState<File[]>([]);
  const [bodyFiles, setBodyFiles] = useState<File[]>([]);
  const [reportFile, setReportFile] = useState<File | null>(null);
  const [reportDate, setReportDate] = useState("");
  const [batchMessage, setBatchMessage] = useState<string | null>(null);
  const storeId = currentStore?.id || "";
  const queryScope = `${session.tenant.id}:${session.user.id}`;
  const [refreshJobSelection, setRefreshJobSelection] = useState<{ storeId: string; id: string } | null>(null);
  const refreshJobId = refreshJobSelection?.storeId === storeId ? refreshJobSelection.id : "";
  const setRefreshJobId = (id: string) => {
    setRefreshJobSelection(id ? { storeId, id } : null);
  };
  useEffect(() => {
    // The page shell is reused when the store changes. Clear transient
    // selections, uploads and task detail so no SKC/job from the prior store
    // can be submitted or polled under the new store scope.
    setSelectedSkcs([]);
    setPhotoTemplateId("");
    setReportTemplateId("");
    setPackageFiles([]);
    setBodyFiles([]);
    setReportFile(null);
    setReportDate("");
    setBatchMessage(null);
    setRefreshJobSelection(null);
  }, [storeId]);
  const workspace = useQuery({
    queryKey: ["store", queryScope, storeId, "compliance-workspace", { deferredQuery, status, page }],
    queryFn: () => api.complianceWorkspace(storeId, { query: deferredQuery, status, page, pageSize: 50 }),
    enabled: Boolean(storeId),
    refetchOnMount: false,
  });
  const templates = useQuery({
    queryKey: ["store", queryScope, storeId, "compliance-templates"],
    queryFn: () => api.complianceTemplates(storeId),
    enabled: Boolean(storeId),
    refetchOnMount: false,
  });
  const applyTemplate = useMutation({
    mutationFn: ({ templateId, sections }: { templateId: string; sections: Array<"certificates" | "photos"> }) => api.applyComplianceTemplate(storeId, templateId, { skcNames: selectedSkcs, sections }),
    onSuccess: (result) => {
      setBatchMessage(`${result.summary.saved} 个 SKC 已保存模板草稿；请进入单个 SKC 详情执行真实提交。`);
      queryClient.invalidateQueries({ queryKey: ["store", queryScope, storeId, "compliance-workspace"] });
    },
    onError: (error) => setBatchMessage(error.message),
  });
  const saveBatch = useMutation({
    mutationFn: (input: Parameters<typeof api.saveComplianceBatchDraft>[1]) => api.saveComplianceBatchDraft(storeId, input),
    onSuccess: (result) => {
      setBatchMessage(`${result.summary.saved} 个 SKC 已保存批量合规草稿；请进入单个 SKC 详情执行真实提交。`);
      queryClient.invalidateQueries({ queryKey: ["store", queryScope, storeId, "compliance-workspace"] });
    },
    onError: (error) => setBatchMessage(error.message),
  });
  const complianceRefresh = useMutation({
    mutationFn: () => api.refreshCompliance(storeId),
    onSuccess: (result) => {
      setRefreshJobId(result.job?.id || "");
      if (result.refreshControl?.status === "cooldown") {
        setBatchMessage(`合规同步冷却中，请约 ${result.refreshControl.retryAfterSeconds || 0}s 后刷新`);
      } else if (result.refreshControl?.status === "active") {
        setBatchMessage("合规同步已在处理中，完成后会自动回读");
      } else {
        setBatchMessage("合规同步已提交，完成后会自动回读");
      }
    },
    onError: (error) => setBatchMessage(error instanceof Error ? error.message : "合规同步失败，请重试"),
  });
  const complianceJob = useQuery({
    queryKey: ["store", queryScope, storeId, "compliance-sync-job", refreshJobId],
    queryFn: () => api.syncJob(storeId, refreshJobId),
    enabled: Boolean(storeId && refreshJobId),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
    refetchInterval: activeJobRefetchInterval,
    refetchIntervalInBackground: false,
  });
  const activeComplianceJobs = useQuery({
    queryKey: ["store", queryScope, storeId, "jobs", "active", "compliance_sync"],
    queryFn: () => api.syncJobs(storeId, { jobType: "compliance_sync" }),
    enabled: Boolean(storeId),
    staleTime: 10_000,
    gcTime: 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  useEffect(() => {
    if (refreshJobId) return;
    const active = activeComplianceJobs.data?.jobs.find(
      (job) => isComplianceSyncRunning(job.state),
    );
    if (active?.id) setRefreshJobId(active.id);
  }, [activeComplianceJobs.data?.jobs, refreshJobId]);

  useEffect(() => setPage(1), [deferredQuery, status]);
  const items = useMemo(() => workspace.data?.items || [], [workspace.data?.items]);
  const selectedOnPage = items.filter((item) => selectedSkcs.includes(item.skc));
  const selectedReportTypes = Array.from(new Set(
    selectedOnPage.map((item) => item.reportDecision?.reportType).filter(Boolean),
  )) as Array<"1630" | "1631">;
  const selectedWaitingForReportType = selectedOnPage.some(
    (item) => !item.reportDecision?.reportType,
  );
  const selectedReportType = selectedReportTypes.length === 1 && !selectedWaitingForReportType
    ? selectedReportTypes[0]
    : null;
  const allSelected = items.length > 0 && selectedOnPage.length === items.length;
  const complianceSummary = workspace.data?.complianceSummary;
  const pagination = workspace.data?.pagination;
  const hasFilters = Boolean(deferredQuery || status);
  const complianceTemplates = templates.data?.templates || [];
  const photoTemplates = useMemo(() => complianceTemplates.filter(templateHasPhotos), [complianceTemplates]);
  const reportTemplates = useMemo(() => complianceTemplates.filter(templateHasReport), [complianceTemplates]);

  useEffect(() => {
    const visible = new Set(items.map((item) => item.skc));
    setSelectedSkcs((current) => current.filter((skc) => visible.has(skc)));
  }, [items]);

  useEffect(() => {
    const job = complianceJob.data?.job;
    if (!job || isComplianceSyncRunning(job.state) || !isComplianceSyncTerminal(job.state)) return;
    let cancelled = false;
    const readBackWorkspace = async () => {
      await queryClient.refetchQueries({
        queryKey: ["store", queryScope, storeId, "compliance-workspace"],
        type: "active",
      });
      await activeComplianceJobs.refetch();
      if (cancelled) return;
      setBatchMessage(complianceSyncMessage(job));
      setRefreshJobId("");
    };
    void readBackWorkspace();
    return () => {
      cancelled = true;
    };
  }, [activeComplianceJobs.refetch, complianceJob.data, queryClient, queryScope, storeId]);

  if (!currentStore) return null;
  const toggleSkc = (skc: string) => setSelectedSkcs((current) => current.includes(skc) ? current.filter((value) => value !== skc) : [...current, skc]);
  const togglePage = () => setSelectedSkcs((current) => {
    const pageSkcs = items.map((item) => item.skc);
    return allSelected ? current.filter((skc) => !pageSkcs.includes(skc)) : Array.from(new Set([...current, ...pageSkcs]));
  });
  const ensureSelection = () => {
    if (!selectedSkcs.length) {
      setBatchMessage("请先勾选要处理的 SKC");
      return false;
    }
    return true;
  };
  const handleApplyTemplate = (templateId: string, sections: Array<"certificates" | "photos">) => {
    if (!ensureSelection() || !templateId) return;
    setBatchMessage(null);
    applyTemplate.mutate({ templateId, sections });
  };
  const handleCustomPhotos = async () => {
    if (!ensureSelection()) return;
    if (!packageFiles.length && !bodyFiles.length) {
      setBatchMessage("请先选择包装实拍图或商品本体实拍图");
      return;
    }
    setBatchMessage("正在上传并保存批量实拍图，请稍候…");
    try {
      const [packagePhotos, bodyPhotos] = await Promise.all([uploadPhotos(storeId, packageFiles, "2"), uploadPhotos(storeId, bodyFiles.slice(0, 1), "1")]);
      saveBatch.mutate({ skcNames: selectedSkcs, photos: [...packagePhotos, ...bodyPhotos] });
    } catch (error) {
      setBatchMessage(error instanceof Error ? error.message : "实拍图上传失败，请重试");
    }
  };
  const handleCustomReport = async () => {
    if (!ensureSelection()) return;
    if (!selectedReportType) {
      setBatchMessage(selectedWaitingForReportType
        ? "所选 SKC 中有商品仍在等待 SHEIN 返回报告类型"
        : "所选 SKC 包含不同官方报告类型，请分别选择 1630 或 1631 商品后批量上传");
      return;
    }
    if (!reportFile || !reportDate) {
      setBatchMessage("1630/1631 报告必须同时选择文件和报告生效日期");
      return;
    }
    setBatchMessage("正在上传并保存批量检测报告，请稍候…");
    try {
      const report = await uploadReport(storeId, reportFile, selectedReportType, reportDate);
      saveBatch.mutate({ skcNames: selectedSkcs, reports: [report] });
    } catch (error) {
      setBatchMessage(error instanceof Error ? error.message : "检测报告上传失败，请重试");
    }
  };

  const handleComplianceRefresh = async () => {
    if (refreshJobId) {
      const result = await complianceJob.refetch();
      if (!result.data?.job) setRefreshJobId("");
      return;
    }
    complianceRefresh.mutate();
  };

  return <div className="ops-page compliance-page">
    <OpsPageHeader eyebrow="合规中心" title="合规工作台" description={`${currentStore.label} · ${pagination?.total ?? 0} 个缓存 SKC`} action={<div className="flex flex-wrap items-center justify-end gap-2"><span className="cache-chip" title="缓存数据只在手动同步后更新">缓存 {workspace.dataUpdatedAt ? formatTime(new Date(workspace.dataUpdatedAt).toISOString()) : "尚未读取"}</span><Button aria-label="手动刷新合规状态" disabled={complianceRefresh.isPending || complianceJob.isFetching} onClick={() => void handleComplianceRefresh()} variant="outline"><RefreshCw className={complianceRefresh.isPending || complianceJob.isFetching ? "animate-spin" : ""} size={15} />{complianceRefresh.isPending ? "正在创建任务" : complianceJob.isFetching ? "读取任务状态" : refreshJobId ? "刷新任务状态" : "合规同步"}</Button></div>} />
    {workspace.error && <div className="notice notice-danger" role="alert"><AlertCircle size={17} /><span className="min-w-0 flex-1">{workspace.error.message}</span><Button onClick={() => workspace.refetch()} size="sm" variant="outline">重试</Button></div>}
<OpsTableShell><section className="data-panel"><OpsToolbar><div><h2>批量合规资料</h2><p>勾选 SKC 后可引用模板或重新上传资料；批量操作保存到草稿，真实提交请进入单个 SKC 详情。</p></div><strong className="text-sm text-[var(--text-muted)]">已选 {selectedSkcs.length} 个 SKC</strong></OpsToolbar><div className="grid gap-4 border-b border-[var(--line)] p-4 xl:grid-cols-2"><div className="space-y-3"><h3 className="text-sm font-semibold text-[var(--ink)]">实拍图</h3><div className="grid gap-2 sm:grid-cols-2"><select aria-label="选择实拍图模板" className="select-field" value={photoTemplateId} onChange={(event) => setPhotoTemplateId(event.target.value)}><option value="">选择实拍图模板</option>{photoTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select><Button disabled={!photoTemplateId || applyTemplate.isPending} onClick={() => handleApplyTemplate(photoTemplateId, ["photos"])} variant="outline">引用模板</Button></div><div className="grid gap-2 sm:grid-cols-2"><label className="upload-field"><Upload size={15} /><span>包装实拍图（最多2张）</span><input accept="image/png,image/jpeg" multiple type="file" onChange={(event) => setPackageFiles(Array.from(event.target.files || []).slice(0, 2))} /></label><label className="upload-field"><Upload size={15} /><span>商品本体实拍图（最多1张）</span><input accept="image/png,image/jpeg" multiple type="file" onChange={(event) => setBodyFiles(Array.from(event.target.files || []).slice(0, 1))} /></label></div><Button disabled={saveBatch.isPending || (!packageFiles.length && !bodyFiles.length)} onClick={handleCustomPhotos}><ImageIcon size={15} />批量保存实拍图</Button></div><div className="space-y-3"><h3 className="text-sm font-semibold text-[var(--ink)]">1630/1631 检测报告</h3><p className="text-xs leading-5 text-[var(--text-muted)]">{selectedReportType ? `SHEIN 已返回：${selectedReportType}` : selectedWaitingForReportType ? "等待 SHEIN 返回报告类型" : selectedReportTypes.length > 1 ? "已选商品包含 1630 和 1631，请分组处理" : "请先勾选 SKC"}</p><div className="grid gap-2 sm:grid-cols-[1fr_auto]"><select aria-label="选择1630或1631报告模板" className="select-field" value={reportTemplateId} onChange={(event) => setReportTemplateId(event.target.value)}><option value="">选择报告模板（使用模板日期）</option>{reportTemplates.map((template) => <option key={template.id} value={template.id}>{template.name} · {template.data.reportType} · {template.data.reportDate}</option>)}</select><Button disabled={!reportTemplateId || applyTemplate.isPending} onClick={() => handleApplyTemplate(reportTemplateId, ["certificates"])} variant="outline">引用模板</Button></div><div className="grid gap-2 sm:grid-cols-[auto_1fr]"><input aria-label="报告生效日期" className="input-field" type="date" value={reportDate} onChange={(event) => setReportDate(event.target.value)} /><label className="upload-field"><Upload size={15} /><span>{reportFile?.name || "上传报告文件"}</span><input accept="application/pdf,image/png,image/jpeg" type="file" onChange={(event) => setReportFile(event.target.files?.[0] || null)} /></label></div><Button disabled={saveBatch.isPending || !selectedReportType || !reportFile || !reportDate} onClick={handleCustomReport}><FileText size={15} />批量保存报告</Button></div></div>{batchMessage && <div className="notice notice-info m-4" role="status">{batchMessage}</div>}</section></OpsTableShell>
    <OpsTableShell><section className="data-panel mt-4"><OpsToolbar><div><h2>SKC 合规状态</h2><p>列表同时展示合规状态与 SHEIN 平台状态；平台状态仅来自真实回读，未回读时显示“待同步”。</p></div><div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row"><label className="search-field"><Search size={16} /><input aria-label="搜索SKC或供应商编码" maxLength={128} onChange={(event) => setQuery(event.target.value)} placeholder="搜索 SKC、供应商编码" value={query} /></label><select aria-label="筛选合规状态" className="select-field" onChange={(event) => setStatus(event.target.value as ComplianceStatus | "")} value={status}>{statuses.map((value) => <option key={value || "all"} value={value}>{value || "全部状态"}</option>)}</select></div></OpsToolbar>{complianceSummary && <OpsMetricStrip className="grid-cols-2 xl:grid-cols-4"><div className="flex items-center gap-3 border-b border-r border-[var(--line)] px-4 py-3 xl:border-b-0"><ListChecks className="text-[var(--text-subtle)]" size={18} /><div><dt className="text-xs text-[var(--text-subtle)]">全部 SKC</dt><dd className="text-lg font-semibold">{complianceSummary.total}</dd></div></div><div className="flex items-center gap-3 border-b border-[var(--line)] px-4 py-3 xl:border-b-0 xl:border-r"><AlertCircle className="text-[var(--danger)]" size={18} /><div><dt className="text-xs text-[var(--text-subtle)]">需处理</dt><dd className="text-lg font-semibold">{complianceSummary.nonCompliant}</dd></div></div><div className="flex items-center gap-3 border-r border-[var(--line)] px-4 py-3"><RotateCcw className="text-[var(--warning)]" size={18} /><div><dt className="text-xs text-[var(--text-subtle)]">处理中</dt><dd className="text-lg font-semibold">{complianceSummary.inProgress}</dd></div></div><div className="flex items-center gap-3 px-4 py-3"><ShieldCheck className="text-[var(--success-strong)]" size={18} /><div><dt className="text-xs text-[var(--text-subtle)]">已通过</dt><dd className="text-lg font-semibold">{complianceSummary.passed}</dd></div></div></OpsMetricStrip>}{workspace.isLoading ? <div className="ops-loading-state" role="status"><div className="ops-loading-state__bar" /><div className="ops-loading-state__bar ops-loading-state__bar--wide" /><div className="ops-loading-state__bar" /><span>正在读取合规缓存</span></div> : items.length ? <>
      <OperationsDataTable
        ariaLabel="SKC 合规状态列表"
        data={items}
        columns={complianceTableColumns}
        getRowId={(item) => item.id}
        estimateRowHeight={76}
        renderHeader={(columnId) => columnId === "select" ? <input aria-label="选择当前页全部 SKC" checked={allSelected} onChange={togglePage} type="checkbox" /> : null}
        renderRow={(item, _index, rowId, style) => <tr key={rowId} style={style} className="align-middle hover:bg-[var(--surface-muted)]/55">
          <td><input aria-label={`选择 ${item.skc}`} checked={selectedSkcs.includes(item.skc)} onChange={() => toggleSkc(item.skc)} type="checkbox" /></td>
          <td>{item.imageUrl ? <img alt="商品主图" className="h-12 w-12 rounded border border-[var(--line)] object-cover" decoding="async" loading="lazy" src={item.imageUrl} /> : <div className="grid h-12 w-12 place-items-center rounded border border-dashed border-[var(--line)] text-[var(--text-subtle)]"><ImageIcon size={17} /></div>}</td>
          <td className="min-w-0"><button aria-label={`打开 ${item.skc} 合规详情`} className="block min-w-0 max-w-full text-left" onClick={() => navigate(`/app/operations/${encodeURIComponent(storeId)}/compliance/${encodeURIComponent(item.skc)}`)} type="button"><strong title={item.skc} className="block max-w-full truncate text-sm font-medium text-[var(--ink)] hover:text-[var(--focus)]">{item.skc}</strong><small title={item.supplierCode || "无供应商编码"} className="mt-1 block max-w-full truncate text-xs text-[var(--text-subtle)]">{item.supplierCode || "无供应商编码"}</small></button></td>
          <td title={categoryLabel(item)} className="max-w-[170px] truncate text-xs text-[var(--text-muted)]">{categoryLabel(item)}</td>
          <td className="whitespace-nowrap text-xs">
            {item.reportDecision?.reportType ? (
              <span className="status-badge compliance-status-warning">{item.reportDecision.reportType}</span>
            ) : (
              <span className="text-[var(--text-subtle)]">等待 SHEIN 返回</span>
            )}
          </td>
          <td><Status value={item.shelfStatus || undefined} /></td>
          <td><Status value={item.complianceStatus} /></td>
          <td><Status value={item.summary.packagePhoto} /></td>
          <td><Status value={item.summary.bodyPhoto} /></td>
          <td className="whitespace-nowrap">{formatTime(item.updatedAt)}</td>
          <td className="text-right"><Button aria-label={`查看 ${item.skc} 合规详情`} onClick={() => navigate(`/app/operations/${encodeURIComponent(storeId)}/compliance/${encodeURIComponent(item.skc)}`)} size="icon" variant="ghost"><ChevronRight size={17} /></Button></td>
        </tr>}
      />
      {(pagination?.pageCount || 0) > 1 && <footer className="flex items-center justify-between border-t border-[var(--line)] px-4 py-3"><span className="text-xs text-[var(--text-subtle)]">第 {pagination?.page || 1} / {pagination?.pageCount || 1} 页</span><div className="flex gap-2"><Button disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} size="sm" variant="outline"><ChevronLeft size={15} />上一页</Button><Button disabled={page >= (pagination?.pageCount || 1)} onClick={() => setPage((value) => value + 1)} size="sm" variant="outline">下一页<ChevronRight size={15} /></Button></div></footer>}
    </> : <div className="grid min-h-72 place-items-center px-4 text-center"><div>{hasFilters ? <FileWarning className="mx-auto text-[var(--text-subtle)]" size={24} /> : <ShieldCheck className="mx-auto text-[var(--text-subtle)]" size={24} />}<p className="mt-3 text-sm font-medium text-[var(--ink)]">{hasFilters ? "没有匹配的合规记录" : "当前店铺还没有可同步的真实 SKC"}</p><p className="mt-1 text-xs text-[var(--text-subtle)]">{hasFilters ? "调整搜索词或状态后重试" : "请先在经营中心刷新真实商品数据，生成 SKC 缓存后再创建合规同步。"}</p></div></div>}</section></OpsTableShell>
  </div>;
}
