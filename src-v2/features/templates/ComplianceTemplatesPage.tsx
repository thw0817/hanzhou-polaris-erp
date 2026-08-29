import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Image,
  LoaderCircle,
  ListChecks,
  PackageCheck,
  Pencil,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Store,
  Trash2,
  Upload,
} from "lucide-react";
import { useNavigate } from "react-router";
import { useAppContext } from "../../app/AppShell";
import { Button } from "../../components/ui/button";
import {
  api,
  type ComplianceDraftInputs,
  type CompliancePhotoAssignment,
  type ComplianceRemotePreflight,
  type ComplianceTemplate,
  type ComplianceWorkspaceItem,
  type SaveComplianceTemplateInput,
} from "../../lib/api";
import {
  validateComplianceTemplateDraft,
} from "../../lib/compliance-template-contract.js";
import { buildComplianceReusePlan } from "../../lib/compliance-template-reuse-contract.js";
import { formatTime } from "../operations/OperationsShared";

const EMPTY_DEFAULTS: ComplianceDraftInputs = {
  certificates: [],
  agencies: [],
  warnings: [],
  photos: [],
};

const PHOTO_SLOTS = [
  {
    group: "1",
    title: "商品本体通用实拍图",
    description: "引用时映射到目标 SKC 实时返回的商品本体 labelId",
    icon: Image,
  },
  {
    group: "2",
    title: "商品包装通用实拍图",
    description: "最多上传 2 张，引用时映射到目标 SKC 实时返回的包装 labelId",
    icon: PackageCheck,
  },
] as const;

function photosForGroup(photos: CompliancePhotoAssignment[], group: string) {
  return photos.filter((photo) => String(photo.labelGroup) === group);
}

function isActiveProduct(item: ComplianceWorkspaceItem) {
  const status = String(item.shelfStatus ?? "");
  return status === "1" || status.includes("上架") || status.includes("在售");
}

function TemplateList({
  templates,
  loading,
  busy,
  onEdit,
  onDelete,
}: {
  templates: ComplianceTemplate[];
  loading: boolean;
  busy: boolean;
  onEdit: (template: ComplianceTemplate) => void;
  onDelete: (template: ComplianceTemplate) => void;
}) {
  const [templateSearch, setTemplateSearch] = useState("");
  const filteredTemplates = useMemo(() => {
    const query = templateSearch.trim().toLocaleLowerCase();
    if (!query) return templates;
    return templates.filter((template) => [
      template.name,
    ].some((value) => String(value || "").toLocaleLowerCase().includes(query)));
  }, [templateSearch, templates]);

  return (
    <section className="data-panel self-start">
      <header className="data-toolbar">
        <div>
          <h2>合规素材方案</h2>
          <p>当前店铺独立保存，商品创建和批量处理均可复用</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <label className="search-field sm:w-60">
            <Search size={15} />
            <input
              aria-label="搜索合规素材方案"
              onChange={(event) => setTemplateSearch(event.target.value)}
              placeholder="搜索方案名"
              value={templateSearch}
            />
          </label>
          <span className="shrink-0 text-xs text-[var(--text-subtle)]">
            {templateSearch.trim()
              ? `${filteredTemplates.length} / ${templates.length} 个`
              : `${templates.length} 个`}
          </span>
        </div>
      </header>
      {loading ? (
        <div className="grid min-h-52 place-items-center text-[var(--text-muted)]">
          <LoaderCircle className="animate-spin" size={20} />
        </div>
      ) : filteredTemplates.length ? (
        <div className="divide-y divide-[var(--line)]">
          {filteredTemplates.map((template) => (
            <article className="flex items-start gap-2 px-4 py-4" key={template.id}>
              <button
                className="min-w-0 flex-1 text-left disabled:cursor-default"
                disabled={!template.canManage || busy}
                onClick={() => onEdit(template)}
                type="button"
              >
                <span className="flex items-center gap-2">
                  <strong className="truncate text-sm font-medium text-[var(--ink)]">
                    {template.name}
                  </strong>
                  <span className="status-badge">{template.scopeLabel}</span>
                </span>
                <span className="mt-1.5 block text-xs leading-5 text-[var(--text-subtle)]">
                  报告 {template.data.defaults?.certificates.length || 0} 份 · 通用图{" "}
                  {template.data.defaults?.photos.length || 0} 张
                </span>
                <span className="mt-0.5 block text-xs text-[var(--text-subtle)]">
              店铺通用 · v{template.version} · {formatTime(template.updatedAt)}
                </span>
              </button>
              {template.canManage && (
                <div className="flex shrink-0 gap-1">
                  <Button
                    aria-label={`编辑${template.name}`}
                    disabled={busy}
                    onClick={() => onEdit(template)}
                    size="icon"
                    title="编辑素材方案"
                    variant="ghost"
                  >
                    <Pencil size={15} />
                  </Button>
                  <Button
                    aria-label={`删除${template.name}`}
                    disabled={busy}
                    onClick={() => onDelete(template)}
                    size="icon"
                    title="删除素材方案"
                    variant="ghost"
                  >
                    <Trash2 size={15} />
                  </Button>
                </div>
              )}
            </article>
          ))}
        </div>
      ) : (
        <div className="grid min-h-64 place-items-center px-6 text-center">
          <div>
            <ShieldCheck className="mx-auto text-[var(--text-subtle)]" size={24} />
            <p className="mt-3 text-sm font-medium text-[var(--ink)]">
              {templates.length ? "没有匹配的合规素材方案" : "还没有合规素材方案"}
            </p>
            <p className="mt-1 text-xs text-[var(--text-subtle)]">
              {templates.length ? "调整搜索词后重试" : "上传通用实拍图后保存第一套资料"}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

function AutomaticBindings() {
  return (
    <section className="data-panel">
      <header className="data-toolbar">
        <div>
          <h2>发布流程自动处理</h2>
          <p>不进入素材方案，不复用历史审核状态</p>
        </div>
      </header>
      <div className="grid sm:grid-cols-2">
        {[
          { title: "欧代商", detail: "上品时直接绑定，发布前重新校验平台有效记录" },
          { title: "制造商", detail: "上品时直接绑定，发布前重新校验平台有效记录" },
        ].map((item, index) => (
          <div
            className={`flex items-start gap-3 p-4 ${index === 0 ? "border-b border-[var(--line)] sm:border-b-0 sm:border-r" : ""}`}
            key={item.title}
          >
            <Store className="mt-0.5 shrink-0 text-[var(--text-subtle)]" size={18} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <strong className="text-sm font-medium text-[var(--ink)]">{item.title}</strong>
                <span className="status-badge">发布流程</span>
              </div>
              <p className="mt-1.5 text-xs leading-5 text-[var(--text-subtle)]">{item.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function BatchReusePanel({
  items,
  template,
  templateOptions,
  selectedTemplateId,
  environment,
  storeId,
  queryScope,
  onTemplateChange,
  onOpenWorkspace,
}: {
  items: ComplianceWorkspaceItem[];
  template: ComplianceTemplate | null;
  templateOptions: ComplianceTemplate[];
  selectedTemplateId: string;
  environment?: string;
  storeId: string;
  queryScope: string;
  onTemplateChange: (templateId: string) => void;
  onOpenWorkspace: () => void;
}) {
  const queryClient = useQueryClient();
  const [selectedSkcs, setSelectedSkcs] = useState<string[]>([]);
  const [batchSearch, setBatchSearch] = useState("");
  const [showAllItems, setShowAllItems] = useState(false);
  const [plan, setPlan] = useState<ReturnType<typeof buildComplianceReusePlan> | null>(null);
  const [remotePlan, setRemotePlan] = useState<ComplianceRemotePreflight | null>(null);
  const [applyResult, setApplyResult] = useState<Awaited<ReturnType<typeof api.applyComplianceTemplate>> | null>(null);
  const activeItems = useMemo(() => items.filter(isActiveProduct), [items]);
  const filteredActiveItems = useMemo(() => {
    const query = batchSearch.trim().toLocaleLowerCase();
    if (!query) return activeItems;
    return activeItems.filter((item) => [
      item.skc,
      item.categoryId,
      item.categoryName,
    ].some((value) => String(value || "").toLocaleLowerCase().includes(query)));
  }, [activeItems, batchSearch]);
  const visibleItems = showAllItems
    ? filteredActiveItems
    : filteredActiveItems.slice(0, 8);
  const freshCount = activeItems.filter((item) => item.snapshot?.fresh).length;
  const syncCount = activeItems.length - freshCount;
  const selected = new Set(selectedSkcs);
  const selectedActiveCount = activeItems.filter((item) => selected.has(item.skc)).length;

  useEffect(() => {
    const activeSkcs = new Set(activeItems.map((item) => item.skc));
    setSelectedSkcs((current) => current.filter((skc) => activeSkcs.has(skc)));
  }, [activeItems]);

  useEffect(() => {
    setPlan(null);
    setRemotePlan(null);
    setApplyResult(null);
  }, [template?.id, template?.version]);

  const toggleSkc = (skc: string) => {
    setSelectedSkcs((current) =>
      current.includes(skc)
        ? current.filter((value) => value !== skc)
        : [...current, skc],
    );
    setPlan(null);
    setRemotePlan(null);
    setApplyResult(null);
  };
  const remotePreflight = useMutation({
    mutationFn: () => {
      if (!template) {
        throw new Error("请先保存并选中一套合规模板");
      }
      return api.preflightCompliance(storeId, {
        skcNames: selectedSkcs,
        template: {
          defaults: template.data.defaults || EMPTY_DEFAULTS,
        },
      });
    },
    onSuccess: setRemotePlan,
  });
  const applyTemplate = useMutation({
    mutationFn: () => {
      if (!template) throw new Error("请先保存并选中一套合规模板");
      return api.applyComplianceTemplate(storeId, template.id, {
        skcNames: selectedSkcs,
        sections: ["photos"],
      });
    },
    onSuccess: async (result) => {
      setApplyResult(result);
      await queryClient.invalidateQueries({
        queryKey: ["store", queryScope, storeId, "compliance-workspace"],
      });
    },
  });
  const runPlan = () => {
    setPlan(
      buildComplianceReusePlan({
        template,
        items,
        selectedSkcs,
      }),
    );
    setRemotePlan(null);
    setApplyResult(null);
    if (environment !== "demo" && template) {
      remotePreflight.mutate();
    }
  };
  return (
    <section className="data-panel">
      <header className="data-toolbar">
        <div>
          <h2>在售商品批量引用</h2>
          <p>先批量生成引用预检清单，每个 SKC 独立预检并复验</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <label className="min-w-0 sm:w-64">
            <span className="sr-only">选择批量引用合规素材方案</span>
            <select
              aria-label="选择批量引用合规素材方案"
              className="field h-9 w-full px-2.5 text-xs"
              onChange={(event) => onTemplateChange(event.target.value)}
              value={selectedTemplateId}
            >
              <option value="">选择合规实拍图模板</option>
              {templateOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name} · {(option.data.defaults?.photos || []).length} 张
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
          <Button
            disabled={!activeItems.length || !template}
            onClick={() =>
              setSelectedSkcs(
                selectedActiveCount === activeItems.length
                  ? []
                  : activeItems.map((item) => item.skc),
              )
            }
            size="sm"
            variant="outline"
          >
            <ListChecks size={14} />
            {selectedActiveCount === activeItems.length ? "取消全选" : "全选在售 SKC"}
          </Button>
          <Button onClick={onOpenWorkspace} size="sm" variant="outline">
            <ExternalLink size={14} />
            打开合规工作台
          </Button>
          </div>
        </div>
      </header>
      <div className="grid grid-cols-3 border-b border-[var(--line)]">
        {[
          ["在售 SKC", activeItems.length],
          ["规则有效", freshCount],
          ["需先同步", syncCount],
          ].map(([label, value], index) => (
          <div
            className={`p-3 ${index < 2 ? "border-r border-[var(--line)]" : ""}`}
            key={String(label)}
          >
            <span className="block text-[11px] text-[var(--text-subtle)]">{label}</span>
            <strong className="mt-1 block text-sm font-medium text-[var(--ink)]">{value}</strong>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-3 border-b border-[var(--line)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="search-field min-w-0 sm:max-w-[360px]">
          <Search size={15} />
          <input
            aria-label="搜索批量引用商品"
            onChange={(event) => setBatchSearch(event.target.value)}
            placeholder="搜索 SKC、类目或 Category ID"
            value={batchSearch}
          />
        </label>
        <span className="text-xs text-[var(--text-subtle)]">
          已选 {selectedActiveCount}/{activeItems.length} 个在售 SKC
        </span>
      </div>
      {!template && (
        <div className="notice notice-warning m-4" role="status">
          <AlertCircle size={16} />
          <span>请先保存并选中一套合规模板，再选择目标 SKC 进行预检。</span>
        </div>
      )}
      {activeItems.length ? (
        filteredActiveItems.length ? (
          <div className="overflow-x-auto">
            <table className="data-table min-w-[700px]">
              <thead>
                <tr>
                  <th aria-label="选择" />
                  <th>SKC</th>
                  <th>规则快照</th>
                  <th>当前合规</th>
                <th>平台人工项</th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.map((item) => (
                <tr key={item.id}>
                  <td>
                    <input
                      aria-label={`选择 ${item.skc}`}
                      checked={selected.has(item.skc)}
                      disabled={!template}
                      onChange={() => toggleSkc(item.skc)}
                      type="checkbox"
                    />
                  </td>
                  <td className="font-medium text-[var(--ink)]">{item.skc}</td>
                  <td>{item.snapshot?.fresh ? "有效" : "需同步"}</td>
                  <td>{item.complianceStatus}</td>
                  <td>{item.summary.platformOnly || "未同步"}</td>
                </tr>
              ))}
            </tbody>
          </table>
            {filteredActiveItems.length > 8 && (
              <div className="flex justify-center border-t border-[var(--line)] px-4 py-3">
                <Button
                  onClick={() => setShowAllItems((current) => !current)}
                  size="sm"
                  variant="ghost"
                >
                  {showAllItems ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  {showAllItems ? "收起列表" : `查看全部 ${filteredActiveItems.length} 个`}
                </Button>
              </div>
            )}
          </div>
        ) : (
          <p className="px-4 py-8 text-center text-sm text-[var(--text-subtle)]">
            没有匹配的在售 SKC
          </p>
        )
      ) : (
        <p className="px-4 py-8 text-center text-sm text-[var(--text-subtle)]">
          当前缓存没有可识别的在售 SKC
        </p>
      )}
      <div className="flex flex-col gap-3 border-t border-[var(--line)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-5 text-[var(--text-subtle)]">
          预检使用当前店铺缓存，不会保存目标 SKC。1630/1631 必须根据目标商品级属性重新判断。
        </p>
          <Button
          disabled={!template || !selectedSkcs.length || remotePreflight.isPending || applyTemplate.isPending}
          onClick={runPlan}
          size="sm"
        >
          {remotePreflight.isPending ? (
            <LoaderCircle className="animate-spin" size={14} />
          ) : (
            <ListChecks size={14} />
          )}
          {remotePreflight.isPending ? "正在读取官方要求" : "生成引用预检"}
        </Button>
      </div>
      {remotePreflight.error && (
        <div className="notice notice-danger m-4" role="alert">
          <AlertCircle size={16} />
          <span>{remotePreflight.error.message}</span>
        </div>
      )}
      {remotePlan && (
        <div className="border-t border-[var(--line)] bg-white px-4 py-4" role="status">
          <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-[var(--ink)]">
            <CheckCircle2 className="text-[var(--success-strong)]" size={16} />
            合规预检已完成：{remotePlan.summary.ready} 个待处理、{" "}
            {remotePlan.summary.compliant} 个已满足当前条件、{" "}
            {remotePlan.summary.blocked} 个阻断
          </div>
          <div className="mt-3 divide-y divide-[var(--line)] border border-[var(--line)]">
            {remotePlan.plans.map((item) => (
              <div className="flex flex-col gap-1 px-3 py-3 sm:flex-row sm:items-start sm:justify-between" key={item.skc}>
                <div className="min-w-0">
                  <strong className="text-sm font-medium text-[var(--ink)]">{item.skc}</strong>
                  <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
                    {item.blockers.length
                      ? item.blockers.map((blocker) => blocker.message).join("；")
                      : "已按当前官方要求完成复核，仍不会自动保存目标 SKC。"}
                  </p>
                </div>
                <span className={`shrink-0 text-xs font-medium ${
                  item.blockers.length
                    ? "text-[var(--danger)]"
                    : "text-[var(--success-strong)]"
                }`}>
                  {item.blockers.length ? "已阻断" : item.status}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-col gap-3 border-t border-[var(--line)] pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-5 text-[var(--text-subtle)]">
              保存动作会再次逐个读取官方要求；本区只批量引用通用实拍图，1630/1631 报告在目标 SKC 按官方判定引用同类型报告模板。
            </p>
            <Button
              disabled={
                environment === "demo" ||
                !selectedSkcs.length ||
                applyTemplate.isPending ||
                remotePreflight.isPending
              }
              onClick={() => applyTemplate.mutate()}
              size="sm"
            >
              {applyTemplate.isPending ? (
                <LoaderCircle className="animate-spin" size={14} />
              ) : (
                <Save size={14} />
              )}
              {environment === "demo"
                ? "真实模式可保存草稿"
                : applyTemplate.isPending
                  ? "正在逐个复验并保存"
                  : "复验通过后保存草稿"}
            </Button>
          </div>
        </div>
      )}
      {applyTemplate.error && (
        <div className="notice notice-danger m-4" role="alert">
          <AlertCircle size={16} />
          <span>{applyTemplate.error.message}</span>
        </div>
      )}
      {applyResult && (
        <div className="border-t border-[var(--line)] bg-white px-4 py-4" role="status">
          <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-[var(--ink)]">
            <CheckCircle2 className="text-[var(--success-strong)]" size={16} />
            已完成逐 SKC 处理：保存 {applyResult.summary.saved} 个，阻断{" "}
            {applyResult.summary.blocked} 个，失败 {applyResult.summary.failed} 个
          </div>
          <div className="mt-3 divide-y divide-[var(--line)] border border-[var(--line)]">
            {applyResult.items.map((item) => (
              <div className="flex flex-col gap-1 px-3 py-3 sm:flex-row sm:items-start sm:justify-between" key={item.skc}>
                <div className="min-w-0">
                  <strong className="text-sm font-medium text-[var(--ink)]">{item.skc}</strong>
                  <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
                    {item.blockers.length
                      ? item.blockers.map((blocker) => blocker.message).join("；")
                      : item.status === "saved"
                        ? "合规草稿已保存，尚未向 SHEIN 提交"
                        : "未产生可保存的合规草稿"}
                  </p>
                </div>
                <span className={`shrink-0 text-xs font-medium ${
                  item.status === "saved"
                    ? "text-[var(--success-strong)]"
                    : "text-[var(--danger)]"
                }`}>
                  {item.status === "saved" ? "已保存" : item.status === "blocked" ? "已阻断" : "失败"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {plan && (
        <div className="border-t border-[var(--line)] bg-[var(--surface-muted)] px-4 py-4" role="status">
          {!plan.valid ? (
            <div className="flex items-start gap-2 text-sm text-[var(--danger)]">
              <AlertCircle className="mt-0.5 shrink-0" size={16} />
              <span>{plan.blockers.join("；")}</span>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-[var(--ink)]">
                <CheckCircle2 className="text-[var(--success-strong)]" size={16} />
                已生成 {plan.summary?.requested || 0} 个 SKC 的引用预检清单
              </div>
              <div className="mt-3 divide-y divide-[var(--line)] border border-[var(--line)] bg-white">
                {plan.items.map((item) => (
                  <div className="flex flex-col gap-1 px-3 py-3 sm:flex-row sm:items-start sm:justify-between" key={item.id}>
                    <div className="min-w-0">
                      <strong className="text-sm font-medium text-[var(--ink)]">{item.skc}</strong>
                      <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
                        {item.blockers.length ? item.blockers.join("；") : item.nextStep}
                      </p>
                    </div>
                    <span className={`shrink-0 text-xs font-medium ${
                      item.state === "blocked"
                        ? "text-[var(--danger)]"
                        : "text-[var(--warning)]"
                    }`}>
                      {item.state === "blocked" ? "已阻断" : "待 SKC 复验"}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function RugReportTemplateLibrary({
  storeId,
  queryScope,
  canEdit,
  templates,
}: {
  storeId: string;
  queryScope: string;
  canEdit: boolean;
  templates: ComplianceTemplate[];
}) {
  const queryClient = useQueryClient();
  const reportTemplates = templates.filter(
    (template) => template.data.templateKind === "rug_report",
  );
  const [editingId, setEditingId] = useState("");
  const [name, setName] = useState("");
  const [reportType, setReportType] = useState<"1630" | "1631">("1631");
  const [reportDate, setReportDate] = useState("");
  const [reportFile, setReportFile] = useState<NonNullable<
    ComplianceTemplate["data"]["reportFile"]
  > | null>(null);
  const [feedback, setFeedback] = useState("");
  const [uploading, setUploading] = useState(false);

  const reset = () => {
    setEditingId("");
    setName("");
    setReportType("1631");
    setReportDate("");
    setReportFile(null);
    setFeedback("");
  };
  const edit = (template: ComplianceTemplate) => {
    setEditingId(template.id);
    setName(template.name);
    setReportType(template.data.reportType === "1630" ? "1630" : "1631");
    setReportDate(template.data.reportDate || "");
    setReportFile(template.data.reportFile || null);
    setFeedback("");
  };
  const save = useMutation({
    mutationFn: () => {
      if (!name.trim()) throw new Error("请填写报告模板名称");
      if (!reportDate) throw new Error("请填写报告日期");
      if (!reportFile) throw new Error("请先上传报告文件");
      return api.saveComplianceTemplate(storeId, {
        name: name.trim(),
        data: {
          templateKind: "rug_report",
          reportType,
          reportDate,
          reportFile,
        },
      }, editingId);
    },
    onSuccess: async (result) => {
      edit(result.template);
      setFeedback(`“${result.template.name}”已保存，可在建品和SKC合规页引用`);
      await queryClient.invalidateQueries({
        queryKey: ["store", queryScope, storeId, "publish-templates", "compliance"],
      });
    },
    onError: (error) => setFeedback(
      error instanceof Error ? error.message : "报告模板保存失败",
    ),
  });
  const remove = useMutation({
    mutationFn: (template: ComplianceTemplate) =>
      api.deleteComplianceTemplate(storeId, template.id),
    onSuccess: async (_, template) => {
      if (editingId === template.id) reset();
      setFeedback(`“${template.name}”已删除`);
      await queryClient.invalidateQueries({
        queryKey: ["store", queryScope, storeId, "publish-templates", "compliance"],
      });
    },
  });
  const busy = uploading || save.isPending || remove.isPending;

  return (
    <section className="data-panel">
      <header className="data-toolbar">
        <div>
          <h2>1630/1631 报告模板中心</h2>
          <p>报告文件、报告日期和自定义名称统一保存；报告模板独立于商品素材模板</p>
        </div>
        {editingId && (
          <Button disabled={busy} onClick={reset} size="sm" variant="outline">
            新建报告模板
          </Button>
        )}
      </header>
      <div className="grid gap-4 border-b border-[var(--line)] p-4 md:grid-cols-3">
        <label>
          <span className="mb-1.5 block text-xs font-medium text-[var(--ink)]">
            模板名称<span className="ml-1 text-[var(--danger)]">*</span>
          </span>
          <input
            className="field px-3"
            disabled={!canEdit || busy}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如：地毯1631报告-2026版"
            value={name}
          />
        </label>
        <label>
          <span className="mb-1.5 block text-xs font-medium text-[var(--ink)]">
            报告类型<span className="ml-1 text-[var(--danger)]">*</span>
          </span>
          <select
            className="field px-3"
            disabled={!canEdit || busy}
            onChange={(event) => setReportType(event.target.value as "1630" | "1631")}
            value={reportType}
          >
            <option value="1631">16 CFR 1631</option>
            <option value="1630">16 CFR 1630</option>
          </select>
        </label>
        <label>
          <span className="mb-1.5 block text-xs font-medium text-[var(--ink)]">
            报告日期<span className="ml-1 text-[var(--danger)]">*</span>
          </span>
          <input
            className="field px-3"
            disabled={!canEdit || busy}
            onChange={(event) => setReportDate(event.target.value)}
            type="date"
            value={reportDate}
          />
        </label>
      </div>
      <div className="flex flex-col gap-3 border-b border-[var(--line)] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <strong className="text-sm font-medium text-[var(--ink)]">报告文件</strong>
          <p className={`mt-1 truncate text-xs ${reportFile ? "text-[var(--success-strong)]" : "text-[var(--text-subtle)]"}`}>
            {reportFile?.fileName || "尚未上传"}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <label className={`inline-flex h-8 items-center justify-center gap-2 rounded-md border border-[var(--line-strong)] bg-white px-2.5 text-xs font-medium text-[var(--ink)] ${busy ? "cursor-not-allowed opacity-45" : "cursor-pointer hover:bg-[var(--surface-muted)]"}`}>
            {uploading ? <LoaderCircle className="animate-spin" size={14} /> : <Upload size={14} />}
            {reportFile ? "替换报告" : "上传报告"}
            <input
              accept="application/pdf,image/png,image/jpeg"
              className="sr-only"
              disabled={!canEdit || busy}
              onChange={async (event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                setUploading(true);
                setFeedback("");
                try {
                  const result = await api.uploadComplianceEvidence(storeId, file);
                  setReportFile({
                    localAssetRef: `media:${result.asset.id}`,
                    fileName: result.asset.originalName,
                    mimeType: result.asset.contentType,
                    size: result.asset.sizeBytes,
                  });
                } catch (error) {
                  setFeedback(error instanceof Error ? error.message : "报告上传失败");
                } finally {
                  setUploading(false);
                }
              }}
              type="file"
            />
          </label>
          <Button disabled={!canEdit || busy} onClick={() => save.mutate()} size="sm">
            {save.isPending ? <LoaderCircle className="animate-spin" size={14} /> : <Save size={14} />}
            {editingId ? "更新模板" : "保存模板"}
          </Button>
        </div>
      </div>
      {feedback && (
        <p className="border-b border-[var(--line)] px-4 py-3 text-xs text-[var(--text-muted)]" role="status">
          {feedback}
        </p>
      )}
      {reportTemplates.length ? (
        <div className="divide-y divide-[var(--line)]">
          {reportTemplates.map((template) => (
            <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between" key={template.id}>
              <div className="min-w-0">
                <strong className="text-sm font-medium text-[var(--ink)]">{template.name}</strong>
                <p className="mt-1 truncate text-xs text-[var(--text-subtle)]">
                  {template.data.reportType} · 报告日期 {template.data.reportDate} · {template.data.reportFile?.fileName}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button disabled={busy} onClick={() => edit(template)} size="sm" variant="outline">
                  <Pencil size={14} />编辑
                </Button>
                <Button disabled={busy} onClick={() => remove.mutate(template)} size="icon" variant="ghost">
                  <Trash2 size={14} />
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="px-4 py-6 text-center text-sm text-[var(--text-subtle)]">
          尚未建立1630或1631报告模板
        </p>
      )}
    </section>
  );
}

export function ComplianceTemplatesPage() {
  const { currentStore, session } = useAppContext();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const storeId = currentStore?.id || "";
  const queryScope = `${session.tenant.id}:${session.user.id}`;
  const canEdit = session.user.role !== "viewer";
  const [editingId, setEditingId] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [name, setName] = useState("");
  const [defaults, setDefaults] = useState<ComplianceDraftInputs>(EMPTY_DEFAULTS);
  const [saveAttempted, setSaveAttempted] = useState(false);
  const [busyKey, setBusyKey] = useState("");
  const [feedback, setFeedback] = useState<{
    tone: "success" | "danger";
    message: string;
  } | null>(null);

  const resetEditor = () => {
    setEditingId("");
    setSelectedTemplateId("");
    setName("");
    setDefaults(EMPTY_DEFAULTS);
    setSaveAttempted(false);
    setBusyKey("");
    setFeedback(null);
  };

  useEffect(() => {
    resetEditor();
  }, [storeId]);

  const templates = useQuery({
    queryKey: ["store", queryScope, storeId, "publish-templates", "compliance"],
    queryFn: () => api.complianceTemplates(storeId),
    enabled: Boolean(storeId),
    refetchOnMount: false,
  });
  const complianceWorkspace = useQuery({
    queryKey: ["store", queryScope, storeId, "compliance-workspace", "template-reference"],
    queryFn: () => api.complianceWorkspace(storeId, { page: 1, pageSize: 100 }),
    enabled: Boolean(storeId),
    refetchOnMount: false,
  });
  const validation = useMemo(
    () => validateComplianceTemplateDraft({
      name,
      defaults,
    }),
    [defaults, name],
  );

  const editTemplate = (template: ComplianceTemplate) => {
    setEditingId(template.id);
    if ((template.data.defaults?.photos || []).length > 0) {
      setSelectedTemplateId(template.id);
    }
    setName(template.name);
    setDefaults({
      certificates: template.data.defaults?.certificates || [],
      agencies: [],
      warnings: [],
      photos: template.data.defaults?.photos || [],
    });
    setSaveAttempted(false);
    setFeedback(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const saveTemplate = useMutation({
    mutationFn: async () => {
      setSaveAttempted(true);
      if (!validation.valid) {
        const targetId = validation.errors.name
          ? "compliance-template-name"
          : "compliance-template-defaults";
        const target = document.getElementById(targetId);
        target?.scrollIntoView({ behavior: "smooth", block: "center" });
        if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) {
          target.focus({ preventScroll: true });
        }
        throw new Error(
          validation.errors.requirements[0] ||
          validation.errors.name ||
          "保存前请补齐必填合规素材",
        );
      }
      const input: SaveComplianceTemplateInput = {
        name: validation.data.name,
        data: {
          defaults: validation.data.defaults,
        },
      };
      return api.saveComplianceTemplate(storeId, input, editingId);
    },
    onSuccess: async (result) => {
      setEditingId(result.template.id);
      if ((result.template.data.defaults?.photos || []).length > 0) {
        setSelectedTemplateId(result.template.id);
      }
      setName(result.template.name);
      setDefaults(result.template.data.defaults || EMPTY_DEFAULTS);
      setFeedback({
        tone: "success",
        message: `“${result.template.name}”已保存，可在商品创建中直接引用`,
      });
      await queryClient.invalidateQueries({
        queryKey: ["store", queryScope, storeId, "publish-templates", "compliance"],
      });
    },
    onError: (error) => {
      setFeedback({
        tone: "danger",
        message: error instanceof Error ? error.message : "合规素材方案保存失败",
      });
    },
  });

  const deleteTemplate = useMutation({
    mutationFn: (template: ComplianceTemplate) =>
      api.deleteComplianceTemplate(storeId, template.id),
    onSuccess: async (_, template) => {
      if (editingId === template.id) resetEditor();
      setFeedback({ tone: "success", message: `“${template.name}”已删除` });
      await queryClient.invalidateQueries({
        queryKey: ["store", queryScope, storeId, "publish-templates", "compliance"],
      });
    },
    onError: (error) => {
      setFeedback({
        tone: "danger",
        message: error instanceof Error ? error.message : "合规素材方案删除失败",
      });
    },
  });

  const uploadPhoto = async (group: "1" | "2", files: File[] = []) => {
    if (!files.length) return;
    const maxPhotos = group === "2" ? 2 : 1;
    const existingPhotos = photosForGroup(defaults.photos, group);
    if (existingPhotos.length + files.length > maxPhotos) {
      setFeedback({
        tone: "danger",
        message: group === "2"
          ? "商品包装通用实拍图最多保存 2 张，请先移除已有图片"
          : "商品本体通用实拍图只能保存 1 张，请先移除已有图片",
      });
      return;
    }
    setBusyKey(`photo:${group}`);
    setFeedback(null);
    try {
          const outcomes = await Promise.allSettled(
            files.map(async (file) => {
              const result = await api.uploadComplianceEvidence(storeId, file);
              return {
                labelId: "",
            labelGroup: group,
            labelName: group === "1" ? "商品本体通用实拍图" : "商品包装通用实拍图",
            localAssetRef: `media:${result.asset.id}`,
            fileName: result.asset.originalName,
            mimeType: result.asset.contentType,
            size: result.asset.sizeBytes,
            width: result.asset.width,
            height: result.asset.height,
            templateReusable: true,
          } satisfies CompliancePhotoAssignment;
        }),
      );
      const uploaded = outcomes.flatMap((outcome) =>
        outcome.status === "fulfilled" ? [outcome.value] : []
      );
      const failures = outcomes.filter((outcome) => outcome.status === "rejected").length;
      if (!uploaded.length) throw new Error("通用实拍图上传失败");
      setDefaults((value) => ({
        ...value,
        photos: [
          ...value.photos,
          ...uploaded,
        ],
      }));
      setFeedback({
        tone: failures ? "danger" : "success",
        message: `已上传 ${uploaded.length} 张${group === "2" ? "包装" : "本体"}通用实拍图${failures ? `，失败 ${failures} 张` : ""}`,
      });
    } catch (error) {
      setFeedback({
        tone: "danger",
        message: error instanceof Error ? error.message : "通用实拍图上传失败",
      });
    } finally {
      setBusyKey("");
    }
  };

  const reusableTemplates = useMemo(
    () => (templates.data?.templates || []).filter(
      (template) => template.data.templateKind !== "rug_report",
    ),
    [templates.data?.templates],
  );
  const photoTemplates = useMemo(
    () => reusableTemplates.filter(
      (template) => (template.data.defaults?.photos || []).length > 0,
    ),
    [reusableTemplates],
  );

  useEffect(() => {
    setSelectedTemplateId((current) => {
      if (current && photoTemplates.some((template) => template.id === current)) {
        return current;
      }
      return photoTemplates[0]?.id || "";
    });
  }, [photoTemplates]);

  if (!currentStore) return null;
  const busy = saveTemplate.isPending || deleteTemplate.isPending || Boolean(busyKey);

  return (
    <div className="pb-24">
      <header className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-xs font-medium text-[var(--text-subtle)]">模板中心</p>
          <h1 className="mt-1.5 text-2xl font-semibold text-[var(--ink)]">店铺合规素材方案</h1>
          <p className="mt-1.5 text-sm text-[var(--text-muted)]">
            {currentStore.label} · 上品引用与在售商品批量预检共用
          </p>
        </div>
        <Button
          disabled={complianceWorkspace.isFetching}
          onClick={() => complianceWorkspace.refetch()}
          variant="outline"
        >
          <RefreshCw className={complianceWorkspace.isFetching ? "animate-spin" : ""} size={15} />
          刷新在售商品
        </Button>
      </header>

      <div className="notice notice-warning mb-4" role="status">
        <AlertCircle size={17} />
        <span>
          素材方案不代表平台合规已完成。每个目标 SKC 都要重新查询实时要求、独立预检并保存 TraceId。
        </span>
      </div>

      {complianceWorkspace.error && (
        <div className="notice notice-danger mb-4" role="alert">
          <AlertCircle size={17} />
          <span>
            {complianceWorkspace.error.message}
          </span>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-5">
          <AutomaticBindings />

          <RugReportTemplateLibrary
            canEdit={canEdit}
            queryScope={queryScope}
            storeId={storeId}
            templates={templates.data?.templates || []}
          />

          <section className="data-panel">
            <header className="data-toolbar">
              <div>
                <h2>{editingId ? "编辑合规素材方案" : "新建合规素材方案"}</h2>
                <p>不绑定 SKC 或类目，保存后可在当前店铺的商品创建中复用</p>
              </div>
              {editingId && (
                <Button disabled={busy} onClick={resetEditor} size="sm" variant="outline">
                  新建方案
                </Button>
              )}
            </header>
            <div className="p-4">
              <label className="min-w-0">
                <span className="mb-1.5 block text-xs font-medium text-[var(--ink)]">
                  方案名称<span className="ml-1 text-[var(--danger)]">*</span>
                </span>
                <input
                  aria-invalid={saveAttempted && Boolean(validation.errors.name)}
                  className="field px-3"
                  disabled={!canEdit || busy}
                  id="compliance-template-name"
                  onChange={(event) => {
                    setName(event.target.value);
                    setFeedback(null);
                  }}
                  placeholder="例如：装饰地毯美国站合规素材"
                  value={name}
                />
                {saveAttempted && validation.errors.name && (
                  <span className="mt-1.5 block text-xs text-[var(--danger)]" role="alert">
                    {validation.errors.name}
                  </span>
                )}
              </label>
            </div>
          </section>

              <section className="data-panel" id="compliance-template-defaults">
                <header className="data-toolbar">
                  <div>
                    <h2>通用实拍图</h2>
                    <p>保存受保护媒体引用，不保存 Base64 或其他 SKC 的平台图片 ID</p>
                  </div>
                </header>
                <div className="divide-y divide-[var(--line)]">
                  {PHOTO_SLOTS.map((slot) => {
                    const assignments = photosForGroup(defaults.photos, slot.group);
                    const maxPhotos = slot.group === "2" ? 2 : 1;
                    const Icon = slot.icon;
                    return (
                      <div
                        className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
                        key={slot.group}
                      >
                        <div className="flex min-w-0 items-start gap-3">
                          <Icon className="mt-0.5 shrink-0 text-[var(--text-subtle)]" size={18} />
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <strong className="text-sm font-medium text-[var(--ink)]">
                                {slot.title}
                              </strong>
                            </div>
                            <p className="mt-1 text-xs leading-5 text-[var(--text-subtle)]">
                              {slot.description}
                            </p>
                            {assignments.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {assignments.map((assignment) => (
                                  <span
                                    className="inline-flex max-w-full items-center gap-1 rounded bg-[var(--surface-muted)] px-2 py-1 text-xs text-[var(--success-strong)]"
                                    key={assignment.localAssetRef}
                                    title={assignment.fileName}
                                  >
                                    <span className="max-w-56 truncate">{assignment.fileName}</span>
                                    {canEdit && (
                                      <button
                                        aria-label={`移除${assignment.fileName}`}
                                        className="text-[var(--text-subtle)] hover:text-[var(--danger)]"
                                        onClick={() => setDefaults((value) => ({
                                          ...value,
                                          photos: value.photos.filter(
                                            (photo) => photo.localAssetRef !== assignment.localAssetRef,
                                          ),
                                        }))}
                                        type="button"
                                      >
                                        <Trash2 size={12} />
                                      </button>
                                    )}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                        {canEdit && (
                          <div className="flex shrink-0 items-center gap-2">
                            <label className={`inline-flex h-8 items-center justify-center gap-2 rounded-md border border-[var(--line-strong)] bg-white px-2.5 text-xs font-medium text-[var(--ink)] ${busy ? "cursor-not-allowed opacity-45" : "cursor-pointer hover:bg-[var(--surface-muted)]"}`}>
                              <Upload size={14} />
                              {busyKey === `photo:${slot.group}` ? "上传中" : "上传图片"}
                              <input
                                accept="image/png,image/jpeg"
                                className="sr-only"
                                disabled={busy || assignments.length >= maxPhotos}
                                multiple={slot.group === "2"}
                                onChange={(event) => {
                                  void uploadPhoto(slot.group, Array.from(event.target.files || []));
                                  event.target.value = "";
                                }}
                                type="file"
                              />
                            </label>
                            <span className="text-[11px] text-[var(--text-subtle)]">
                              {assignments.length}/{maxPhotos}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>

          <BatchReusePanel
            items={complianceWorkspace.data?.items || []}
            template={
              photoTemplates.find((template) => template.id === selectedTemplateId) || null
            }
            templateOptions={photoTemplates}
            selectedTemplateId={selectedTemplateId}
            environment={currentStore.environment}
            storeId={storeId}
            queryScope={queryScope}
            onTemplateChange={setSelectedTemplateId}
            onOpenWorkspace={() =>
              navigate(`/app/operations/${encodeURIComponent(storeId)}/compliance`)
            }
          />
        </div>

        <TemplateList
          busy={busy}
          loading={templates.isLoading}
          onDelete={(template) => deleteTemplate.mutate(template)}
          onEdit={editTemplate}
          templates={reusableTemplates}
        />
      </div>

      {saveAttempted && validation.errors.requirements.length > 0 && (
        <div className="notice notice-danger mt-4" role="alert">
          <AlertCircle size={17} />
          <span>{validation.errors.requirements.join("；")}</span>
        </div>
      )}

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--line)] bg-white/95 px-3 py-3 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur lg:left-[236px] sm:px-5">
        <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div aria-live="polite" className="min-w-0 text-xs">
            {feedback ? (
              <span className={feedback.tone === "success" ? "text-[var(--success-strong)]" : "text-[var(--danger)]"}>
                {feedback.tone === "success" && <Check className="mr-1 inline" size={14} />}
                {feedback.message}
              </span>
            ) : (
              <span className="text-[var(--text-subtle)]">
                {defaults.photos.length
                  ? `已上传 ${defaults.photos.length} 张通用实拍图，可直接保存`
                  : "可直接上传通用实拍图后保存"}
              </span>
            )}
          </div>
          <Button
            disabled={!canEdit || busy}
            onClick={() => saveTemplate.mutate()}
          >
            {saveTemplate.isPending
              ? <LoaderCircle className="animate-spin" size={15} />
              : <Save size={15} />}
            {saveTemplate.isPending ? "正在保存店铺合规模板" : "统一保存店铺合规模板"}
          </Button>
        </div>
      </div>
    </div>
  );
}
