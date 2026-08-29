import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Database,
  FileCheck2,
  FileImage,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useNavigate, useParams } from "react-router";
import { useAppContext } from "../../app/AppShell";
import { Button } from "../../components/ui/button";
import {
  api,
  type ComplianceRequirementRecord,
} from "../../lib/api";
import { classifyComplianceTemplateOptions } from "../../lib/compliance-template-reuse-contract.js";
import { formatTime } from "../operations/OperationsShared";
import { ComplianceDraftEditor } from "./ComplianceDraftEditor";

const requirementLabels: Record<string, string> = {
  certificate: "证书",
  agency: "代理公司",
  warning: "警示语",
  package_photo: "包装实拍",
  body_photo: "商品实拍",
  unsupported: "平台要求",
};

function dataLabel(record: ComplianceRequirementRecord) {
  const value = record.data.certificateTypeName ?? record.data.labelName ??
    record.data.complianceGroupName ?? record.requirementKey;
  return String(value || record.requirementKey);
}

function needsUserAction(value?: string) {
  return ["需修正", "待补充", "失败"].includes(String(value || ""));
}

function detailStatusClass(value?: string) {
  if (needsUserAction(value)) return "compliance-status-danger";
  if (["审核中", "待同步"].includes(String(value || ""))) return "compliance-status-warning";
  if (["通过", "无需", "审核成功", "审核通过"].includes(String(value || ""))) return "compliance-status-success";
  return "";
}

function SummaryCell({ label, value }: { label: string; value?: string }) {
  const statusClass = detailStatusClass(value);
  return (
    <div className="min-w-0 border-b border-r border-[var(--line)] p-3 last:border-r-0 sm:p-4">
      <span className="block text-[11px] text-[var(--text-subtle)]">{label}</span>
      {statusClass ? (
        <span className={`status-badge ${detailStatusClass(value)}`}>{value}</span>
      ) : (
        <strong className="mt-1.5 block truncate text-sm font-medium text-[var(--ink)]">
          {value || "未同步"}
        </strong>
      )}
    </div>
  );
}

export function ComplianceDetailPage() {
  const { currentStore, session } = useAppContext();
  const { skc = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const storeId = currentStore?.id || "";
  const queryScope = `${session.tenant.id}:${session.user.id}`;
  const detail = useQuery({
    queryKey: ["store", queryScope, storeId, "compliance-workspace", skc],
    queryFn: () => api.complianceWorkspaceItem(storeId, skc),
    enabled: Boolean(storeId && skc),
    refetchOnMount: false,
  });
  const preflight = useMutation({
    mutationFn: () => api.runCompliancePreflight(storeId, skc),
    onSuccess: () => detail.refetch(),
  });
  const rulesRefresh = useMutation({
    mutationFn: () => api.refreshComplianceWorkspaceRules(storeId, skc),
    onSuccess: () => detail.refetch(),
  });
  const photoTemplates = useQuery({
    queryKey: ["store", queryScope, storeId, "compliance-templates"],
    queryFn: () => api.complianceTemplates(storeId),
    enabled: Boolean(storeId && (
      detail.data?.workspaceCapabilities?.photoTemplateApply ||
      detail.data?.workspaceCapabilities?.reportTemplateApply
    )),
    refetchOnMount: false,
  });
  const workspace = useQuery({
    queryKey: ["store", queryScope, storeId, "compliance-workspace", "photo-share-targets"],
    queryFn: () => api.complianceWorkspace(storeId, { page: 1, pageSize: 100 }),
    enabled: Boolean(storeId && detail.data?.workspaceCapabilities?.photoShare),
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
  const [selectedPhotoTemplateId, setSelectedPhotoTemplateId] = useState("");
  const [selectedReportTemplateId, setSelectedReportTemplateId] = useState("");
  const autoRefreshRef = useRef(false);
  const applyPhotoTemplate = useMutation({
    mutationFn: async () => {
      const result = workspaceCapabilities?.mode === "cloud_cached"
        ? await api.applyComplianceTemplate(storeId, selectedPhotoTemplateId, {
          skcNames: [skc],
          sections: ["photos"],
        })
        : await api.applyCompliancePhotoTemplate(storeId, selectedPhotoTemplateId, { skc });
      if ("summary" in result && result.summary.saved < 1) {
        throw new Error(result.items[0]?.blockers?.[0]?.message || "当前实拍图模板不能用于该SKC");
      }
      return result;
    },
    onSuccess: () => {
      void detail.refetch();
      void queryClient.invalidateQueries({ queryKey: ["store", queryScope, storeId, "compliance-draft", skc] });
    },
  });
  const applyReportTemplate = useMutation({
    mutationFn: async () => {
      const result = await api.applyComplianceTemplate(storeId, selectedReportTemplateId, {
        skcNames: [skc],
        sections: ["certificates"],
      });
      if (result.summary.saved < 1) {
        throw new Error(result.items[0]?.blockers?.[0]?.message || "当前报告模板不能用于该SKC");
      }
      return result;
    },
    onSuccess: () => {
      void detail.refetch();
      void queryClient.invalidateQueries({ queryKey: ["store", queryScope, storeId, "compliance-draft", skc] });
    },
  });
  if (!currentStore) return null;
  const item = detail.data?.item;
  const templateOptions = classifyComplianceTemplateOptions({
    templates: photoTemplates.data?.templates || [],
    reportType: item?.reportDecision?.reportType,
  });
  const workspaceCapabilities = detail.data?.workspaceCapabilities;
  useEffect(() => {
    const reportDecision = detail.data?.item?.reportDecision;
    if (
      autoRefreshRef.current ||
      !detail.data ||
      workspaceCapabilities?.refreshCurrentSkc !== true ||
      reportDecision?.reportType ||
      reportDecision?.blockers?.length
    ) {
      return;
    }
    autoRefreshRef.current = true;
    rulesRefresh.mutate();
  }, [detail.data, rulesRefresh, workspaceCapabilities?.refreshCurrentSkc]);
  const staleSnapshots = detail.data?.snapshots.filter((snapshot) => !snapshot.fresh) || [];
  const releaseGate = detail.data?.releaseGate;
  const sourceCoverage = item?.summary.sourceCoverage;
  const incompleteCoverage = Boolean(
    sourceCoverage && (
      sourceCoverage.requirementsReturned !== true ||
      sourceCoverage.photoRequirementsReturned !== true
    ),
  );
  const requirementSnapshot = detail.data?.snapshots.find(
    (snapshot) => snapshot.ruleType === "compliance_requirement",
  ) || null;
  const requirementRecords = detail.data?.records || [];
  const requiredRecords = requirementRecords.filter((record) => record.required === true);
  const requiredTypes = new Set(requiredRecords.map((record) => record.requirementType));
  const requiredSummaryStatuses = item ? [
    requiredTypes.has("certificate") ? item.summary.certificate : undefined,
    requiredTypes.has("agency") ? item.summary.agency : undefined,
    requiredTypes.has("warning") ? item.summary.warning : undefined,
    requiredTypes.has("package_photo") ? item.summary.packagePhoto : undefined,
    requiredTypes.has("body_photo") ? item.summary.bodyPhoto : undefined,
    requiredTypes.has("unsupported") ? item.summary.platformOnly : undefined,
  ].filter(Boolean) : [];
  const hasActionableSummary = requiredSummaryStatuses.some(needsUserAction);
  const hasReviewingSummary = requiredSummaryStatuses.includes("审核中");
  const failedRecords = requiredRecords.filter((record) => record.status === "失败");
  // 官方报告回读是唯一判定来源：类型已返回时必须继续展示对应上传入口，
  // 未返回时也保留同一官方报告区块，明确展示等待状态，避免被误解为“不需要报告”。
  const reportNeedsAttention = Boolean(item);
  const showEditor = hasActionableSummary || Boolean(item?.reportDecision?.reportType);
  return (
    <>
      <header className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          <Button
            className="mb-3"
            onClick={() => navigate(`/app/operations/${encodeURIComponent(storeId)}/compliance`)}
            size="sm"
            variant="ghost"
          >
            <ArrowLeft size={16} />返回合规工作台
          </Button>
          <p className="text-xs font-medium text-[var(--text-subtle)]">单 SKC 合规详情</p>
          <div className="mt-1.5 flex items-center gap-3">
            {item?.imageUrl ? (
              <img
                alt="商品主图"
                className="h-14 w-14 shrink-0 rounded-md border border-[var(--line)] object-cover shadow-sm"
                decoding="async"
                loading="eager"
                src={item.imageUrl}
              />
            ) : (
              <div
                aria-label="暂无商品主图"
                className="grid h-14 w-14 shrink-0 place-items-center rounded-md border border-dashed border-[var(--line)] text-[var(--text-subtle)]"
              >
                <FileImage size={18} />
              </div>
            )}
            <h1 className="min-w-0 break-all text-2xl font-semibold text-[var(--ink)]">{skc}</h1>
          </div>
          <p className="mt-1.5 text-sm text-[var(--text-muted)]">
            {item?.supplierCode || currentStore.label} · 更新于 {formatTime(item?.updatedAt)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={detail.isFetching} onClick={() => detail.refetch()} variant="outline">
            <RefreshCw className={detail.isFetching ? "animate-spin" : ""} size={15} />
            重新读取
          </Button>
          {workspaceCapabilities?.refreshCurrentSkc ? (
            <Button
              disabled={rulesRefresh.isPending || detail.isFetching}
              onClick={() => rulesRefresh.mutate()}
              variant="outline"
            >
              <Database className={rulesRefresh.isPending ? "animate-pulse" : ""} size={15} />
              {rulesRefresh.isPending ? "正在刷新合规数据" : "刷新当前 SKC"}
            </Button>
          ) : workspaceCapabilities?.mode === "cloud_cached" ? (
            <Button
              onClick={() => navigate(`/app/operations/${encodeURIComponent(storeId)}/jobs`)}
              variant="outline"
            >
              <Database size={15} />云端同步合规
            </Button>
          ) : null}
        </div>
      </header>

      {detail.error && (
        <div className="notice notice-danger" role="alert">
          <AlertCircle size={17} />
          <span className="min-w-0 flex-1">{detail.error.message}</span>
          <Button onClick={() => detail.refetch()} size="sm" variant="outline">重试</Button>
        </div>
      )}
      {preflight.error && (
        <div className="notice notice-danger" role="alert">
          <AlertCircle size={17} />
          <span className="min-w-0 flex-1">{preflight.error.message}</span>
        </div>
      )}
      {rulesRefresh.error && (
        <div className="notice notice-danger" role="alert">
          <AlertCircle size={17} />
          <span className="min-w-0 flex-1">{rulesRefresh.error.message}</span>
        </div>
      )}
      {rulesRefresh.isSuccess && (
        <div className="notice notice-success" role="status">
          <CheckCircle2 size={17} />
          <span>已重新读取当前 SKC 的官方合规规则与 1630/1631 要求；以下编辑内容尚未提交。</span>
        </div>
      )}
      {applyPhotoTemplate.error && (
        <div className="notice notice-danger" role="alert">
          <AlertCircle size={17} />
          <span className="min-w-0 flex-1">{applyPhotoTemplate.error.message}</span>
        </div>
      )}
      {applyPhotoTemplate.isSuccess && (
        <div className="notice notice-success" role="status">
          <CheckCircle2 size={17} />
          <span>实拍图模板已引用到当前 SKC，尚未向 SHEIN 提交。</span>
        </div>
      )}
      {staleSnapshots.length > 0 && (
        <div className="notice notice-warning" role="status">
          <AlertCircle size={17} />
          <span>存在过期规则快照，当前缓存不能用于正式合规提交。</span>
        </div>
      )}
      {incompleteCoverage && (
        <div className="notice notice-warning" role="status">
          <AlertCircle size={17} />
          <span>合规要求来源覆盖不完整，当前状态不能视为通过。</span>
        </div>
      )}
      {releaseGate && releaseGate.blockerCount > 0 && (
        <div
          className={`notice ${releaseGate.blockerCount ? "notice-danger" : ""}`}
          role="status"
        >
          {releaseGate.blockerCount
            ? <AlertTriangle size={17} />
            : <FileCheck2 size={17} />}
          <span>
            {releaseGate.blockerCount
              ? `存在 ${releaseGate.blockerCount} 项已知发布阻断`
              : "未发现已知阻断"}
            。实拍图可在有效规则快照下按单 SKC 确认提交；其他合规写入仍受门禁限制。
          </span>
        </div>
      )}

      {failedRecords.length > 0 && (
        <section className="data-panel border border-[var(--danger)]/30 bg-[var(--danger)]/5" role="alert">
          <header className="data-toolbar">
            <div>
              <h2 className="text-[var(--danger-strong)]">需优先处理 · {failedRecords.length} 项</h2>
              <p className="text-[var(--danger-strong)]/80">先处理失败项，再查看已通过资料；失败原因来自 SHEIN 当前回读。</p>
            </div>
            <AlertTriangle className="text-[var(--danger)]" size={19} />
          </header>
          <div className="grid gap-2 px-4 pb-4 sm:grid-cols-2">
            {failedRecords.slice(0, 8).map((record) => (
              <div className="rounded-md border border-[var(--danger)]/20 bg-white px-3 py-2 text-xs" key={record.id}>
                <strong className="block text-[var(--danger-strong)]">{dataLabel(record)}</strong>
                <span className="mt-1 block text-[var(--danger-strong)]/80">{record.requirementType === "body_photo" ? "商品实拍" : record.requirementType === "package_photo" ? "包装实拍" : requirementLabels[record.requirementType] || record.requirementType}</span>
                {Array.isArray(record.data.failReasonList || record.data.failReason) && (
                  <span className="mt-1 block text-[var(--text-muted)]">原因：{(Array.isArray(record.data.failReasonList) ? record.data.failReasonList : record.data.failReason as string[]).join("、")}</span>
                )}
              </div>
            ))}
          </div>
          {failedRecords.length > 8 && <p className="px-4 pb-4 text-xs text-[var(--danger-strong)]">还有 {failedRecords.length - 8} 项，请在下方对应分组处理。</p>}
        </section>
      )}

      {detail.isLoading ? (
        <section className="grid min-h-[360px] place-items-center rounded-lg border border-[var(--line)] bg-white">
          <div className="text-center text-sm text-[var(--text-muted)]">
            <RefreshCw className="mx-auto mb-3 animate-spin" size={22} />
            正在读取合规详情
          </div>
        </section>
      ) : item ? (
        <div className="space-y-4">
          <section className="data-panel">
            <header className="data-toolbar">
              <div><h2>状态摘要</h2><p>当前数据库缓存的合规判断</p></div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`status-badge ${detailStatusClass(item.complianceStatus)}`}>{item.complianceStatus}</span>
              </div>
            </header>
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6">
              {requiredTypes.has("certificate") && <SummaryCell label="证书" value={item.summary.certificate} />}
              {requiredTypes.has("agency") && <SummaryCell label="代理公司" value={item.summary.agency} />}
              {requiredTypes.has("warning") && <SummaryCell label="警示语" value={item.summary.warning} />}
              {requiredTypes.has("package_photo") && <SummaryCell label="包装实拍" value={item.summary.packagePhoto} />}
              {requiredTypes.has("body_photo") && <SummaryCell label="商品实拍" value={item.summary.bodyPhoto} />}
              {requiredTypes.has("unsupported") && <SummaryCell label="平台要求" value={item.summary.platformOnly} />}
              {!requiredTypes.size && <div className="col-span-full p-4 text-xs text-[var(--text-subtle)]">SHEIN 尚未返回当前 SKC 的必填合规项。</div>}
            </div>
          </section>

          {!hasActionableSummary && (
            <div className="notice" role="status">
              <FileCheck2 size={17} />
              <span>
                当前没有需要修改的项目。{hasReviewingSummary ? "审核中的资料请等待 SHEIN 结果。" : "已通过或无需的资料默认隐藏。"}
              </span>
            </div>
          )}

          {reportNeedsAttention && <section className="data-panel">
            <header className="data-toolbar">
              <div>
                <h2>SHEIN 官方报告要求</h2>
                <p>当前 SKC 的 1630/1631 类型仅以 SHEIN 合规要求回读为唯一依据</p>
              </div>
              <ShieldCheck className="text-[var(--text-subtle)]" size={18} />
            </header>
            {item.reportDecision?.blockers.length ? (
              <div className="notice notice-danger m-4" role="status">
                <AlertTriangle size={17} />
                <div className="min-w-0">
                  <strong className="block text-sm">SHEIN 官方要求需分开处理</strong>
                  <ul className="mt-1 space-y-1 text-xs leading-5">
                    {item.reportDecision.blockers.map((blocker) => (
                      <li key={`${blocker.code}:${blocker.message}`}>
                        {blocker.code} · {blocker.message}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : item.reportDecision?.reportType ? (
              <div className="grid grid-cols-2 border-b border-[var(--line)] sm:grid-cols-3">
                <SummaryCell label="官方报告类型" value={item.reportDecision.reportType} />
                <SummaryCell label="状态" value="SHEIN 已返回" />
                <SummaryCell label="下一步" value="上传同类型报告" />
              </div>
            ) : (
              <div className="notice m-4" role="status">
                <RefreshCw size={17} />
                <span>等待 SHEIN 返回 1630/1631 报告类型；返回前不做本地判定，也不允许选错报告类型。</span>
              </div>
            )}
          </section>}

          {showEditor && <ComplianceDraftEditor
            queryScope={queryScope}
            editorModel={detail.data?.editorModel || {
              certificateRulesFresh: false,
              certificateLibraryFresh: false,
              certificateLibrary: [],
              agencyLibraryRequired: false,
              agencyRequirements: [],
              agencyLibraryFresh: false,
              agencyLibrary: [],
              warningRulesRequired: false,
              warningRulesFresh: false,
              warningRules: [],
              certificates: [],
              detectionAgencies: [],
              platformCapabilities: [],
            }}
            workspaceCapabilities={workspaceCapabilities}
            onSaved={() => { void detail.refetch(); }}
            onPreflight={() => preflight.mutate()}
            preflightPending={preflight.isPending}
            records={requiredRecords}
            photoTemplates={templateOptions.photoTemplates}
            reportTemplates={templateOptions.reportTemplates}
            selectedPhotoTemplateId={selectedPhotoTemplateId}
            onSelectedPhotoTemplateId={setSelectedPhotoTemplateId}
            onApplyPhotoTemplate={workspaceCapabilities?.photoTemplateApply ? () => applyPhotoTemplate.mutate() : undefined}
            photoTemplateApplying={applyPhotoTemplate.isPending}
            selectedReportTemplateId={selectedReportTemplateId}
            onSelectedReportTemplateId={setSelectedReportTemplateId}
            onApplyReportTemplate={workspaceCapabilities?.reportTemplateApply ? () => applyReportTemplate.mutate() : undefined}
            reportTemplateApplying={applyReportTemplate.isPending}
            photoTemplateError={applyPhotoTemplate.error?.message || ""}
            reportTemplateError={applyReportTemplate.error?.message || ""}
            availableSkcs={workspace.data?.items.map((candidate) => ({ skc: candidate.skc, packagePhoto: candidate.summary.packagePhoto, bodyPhoto: candidate.summary.bodyPhoto })) || []}
            bodyPhotoStatus={item?.summary.bodyPhoto}
            certificateStatus={item?.summary.certificate}
            agencyStatus={item?.summary.agency}
            warningStatus={item?.summary.warning}
            packagePhotoStatus={item?.summary.packagePhoto}
            platformOnlyStatus={item?.summary.platformOnly}
            officialReportType={item?.reportDecision?.reportType || null}
            requirementSnapshot={requirementSnapshot}
            role={session.user.role}
            skc={skc}
            storeId={storeId}
          />}

        </div>
      ) : null}
    </>
  );
}
