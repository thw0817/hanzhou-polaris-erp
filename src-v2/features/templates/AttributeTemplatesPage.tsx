import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import {
  AlertCircle,
  BookCopy,
  Check,
  ChevronDown,
  ChevronRight,
  DatabaseZap,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Ruler,
  Search,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useAppContext } from "../../app/AppShell";
import { Button } from "../../components/ui/button";
import {
  api,
  ApiError,
  type AttributeTemplate,
  type AttributeTemplateAssignment,
  type RugReportSources,
  type SaveAttributeTemplateInput,
} from "../../lib/api";
import {
  buildAttributeFields,
  flattenLeafCategories,
  isCompositionPercentageField,
  normalizeCategoryTree,
  validateAttributeAssignments,
  type AttributeAssignmentValue,
  type AttributeField,
  type PublishCategoryNode,
  type PublishCategoryOption,
} from "../../lib/attribute-template-contract.js";
import { formatTime } from "../operations/OperationsShared";
import { deriveRugReportThresholdSources } from "../../lib/rug-report-classification.js";
import { activeJobRefetchInterval } from "../../lib/refresh-state";

type Assignments = Record<string, AttributeAssignmentValue>;
type RugDimensionSource = NonNullable<RugReportSources["dimensions"]>[number];
type RugThresholds = NonNullable<RugReportSources["thresholds"]>;
type RugThresholdSource = RugThresholds["longestEdge"];
type RugReportMode = "thresholds" | "dimensions";

const EMPTY_RUG_DIMENSIONS: [RugDimensionSource, RugDimensionSource] = [
  { attributeId: "", unit: "cm" },
  { attributeId: "", unit: "cm" },
];

const EMPTY_RUG_THRESHOLDS: RugThresholds = {
  longestEdge: { attributeId: "", exceededValueId: "", withinValueId: "" },
  area: { attributeId: "", exceededValueId: "", withinValueId: "" },
};

function thresholdSource(field: AttributeField | undefined): RugThresholdSource {
  const exceededValueId = field?.values.find(
    (value) => value.label.trim() === "是",
  )?.id || "";
  const withinValueId = field?.values.find(
    (value) => value.label.trim() === "否",
  )?.id || "";
  return {
    attributeId: field?.id || "",
    exceededValueId,
    withinValueId,
  };
}

function suggestRugThresholds(fields: AttributeField[]): RugThresholds {
  return deriveRugReportThresholdSources(fields) || EMPTY_RUG_THRESHOLDS;
}

const schemaSyncStateLabels = {
  queued: "等待同步",
  running: "同步中",
  succeeded: "已完成",
  completed: "已完成",
  completed_with_errors: "部分完成",
  failed: "同步失败",
  cancelled: "已取消",
} as const;

const schemaSyncTerminalStates = ["succeeded", "completed", "completed_with_errors", "failed", "cancelled"];

function isMissingAttributeApi(error: unknown) {
  return error instanceof ApiError &&
    error.status === 404 &&
    error.code === "NOT_FOUND";
}

function describeAttributeTemplateError(error: unknown) {
  if (isMissingAttributeApi(error)) {
    return {
      title: "类目规则暂时不可用",
      message:
        "当前类目覆盖和商品属性规则暂时不可用。系统不会猜测或补造属性，请稍后重试或联系管理员。",
    };
  }
  if (error instanceof ApiError && error.code === "SHEIN_WEB_MODULE_FROZEN") {
    return {
      title: "云端商品模块当前未启用",
      message: "当前云端只开放基础工作台能力，商品属性模块仍处于冻结状态。",
    };
  }
  if (error instanceof ApiError && error.code === "STORE_REAUTHORIZATION_REQUIRED") {
    return {
      title: "店铺授权已失效",
      message: "SHEIN 拒绝了当前店铺的签名，请先在店铺管理中重新授权该店铺，再回来使用商品属性模板。",
    };
  }
  return {
    title: "服务暂不可用",
    message: error instanceof Error ? error.message : "请稍后重试",
  };
}

interface LinkedRule {
  attribute_id?: string | number;
  attribute_value_list?: Array<string | number>;
  attribute_value_pre_fill_list?: Array<string | number>;
}

function findCategoryTrail(
  nodes: PublishCategoryNode[],
  categoryId: string,
  trail: PublishCategoryNode[] = [],
): PublishCategoryNode[] {
  for (const node of nodes) {
    const nextTrail = [...trail, node];
    if (node.categoryId === categoryId) return nextTrail;
    const childTrail = findCategoryTrail(node.children, categoryId, nextTrail);
    if (childTrail.length) return childTrail;
  }
  return [];
}

function findFirstLeafTrail(
  nodes: PublishCategoryNode[],
  trail: PublishCategoryNode[] = [],
): PublishCategoryNode[] {
  for (const node of nodes) {
    const nextTrail = [...trail, node];
    if (node.lastCategory && node.productTypeId) return nextTrail;
    const childTrail = findFirstLeafTrail(node.children, nextTrail);
    if (childTrail.length) return childTrail;
  }
  return [];
}

function CategoryColumn({
  label,
  nodes,
  activeId,
  disabled,
  onSelect,
}: {
  label: string;
  nodes: PublishCategoryNode[];
  activeId: string;
  disabled: boolean;
  onSelect: (node: PublishCategoryNode) => void;
}) {
  return (
    <div
      aria-label={label}
      className="h-72 min-w-[200px] flex-1 basis-0 overflow-y-auto border-r border-[var(--line)] p-2 last:border-r-0"
      role="listbox"
    >
      {nodes.map((node) => {
        const active = node.categoryId === activeId;
        return (
          <button
            aria-selected={active}
            className={`flex min-h-10 w-full items-center justify-between gap-2 rounded-sm px-3 py-2 text-left text-sm ${
              active
                ? "bg-[#e8f3ff] font-medium text-[#1677ff]"
                : "text-[var(--text-muted)] hover:bg-[#f5f7f9] hover:text-[var(--ink)]"
            }`}
            disabled={disabled}
            key={node.categoryId}
            onClick={() => onSelect(node)}
            role="option"
            type="button"
          >
            <span className="min-w-0 truncate">{node.name}</span>
            {!node.lastCategory && node.children.length > 0 && (
              <ChevronRight className="shrink-0 opacity-60" size={15} />
            )}
          </button>
        );
      })}
      {!nodes.length && (
        <p className="px-3 py-6 text-center text-xs text-[var(--text-subtle)]">
          暂无下级类目
        </p>
      )}
    </div>
  );
}

function AttributeFieldEditor({
  field,
  value,
  invalid,
  onChange,
}: {
  field: AttributeField;
  value: AttributeAssignmentValue;
  invalid: boolean;
  onChange: (value: AttributeAssignmentValue) => void;
}) {
  const allowsPreset = [1, 3, 4].includes(field.modeCode) && field.values.length > 0;
  const allowsMultiple = field.modeCode === 1 || (field.modeCode === 4 && field.dataDimension !== 2);
  const allowsManual = [0, 4].includes(field.modeCode);
  const numericCustomField = field.dataDimension === 2 && field.modeCode === 4;
  const percentageComposition = isCompositionPercentageField(field);
  const quantityAttribute = /数量|quantity/i.test(field.name);
  const selected = new Set(value.valueIds);
  const [optionQuery, setOptionQuery] = useState("");
  const normalizedQuery = optionQuery.trim().toLocaleLowerCase();
  const visibleOptions = normalizedQuery
    ? field.values.filter((option) =>
        option.label.toLocaleLowerCase().includes(normalizedQuery) ||
        option.id.toLocaleLowerCase().includes(normalizedQuery),
      )
    : field.values;
  const showOptionSearch = field.values.length >= 20;
  const searchableOptionPicker = showOptionSearch || field.values.length > 0;
  const [optionPickerOpen, setOptionPickerOpen] = useState(false);

  const toggleValue = (valueId: string) => {
    if (!allowsMultiple) {
      onChange({ ...value, valueIds: valueId ? [valueId] : [] });
      return;
    }
    const next = selected.has(valueId)
      ? value.valueIds.filter((id) => id !== valueId)
      : [...value.valueIds, valueId];
    if (field.maxSelections > 0 && next.length > field.maxSelections) return;
    onChange({ ...value, valueIds: next });
  };

  return (
    <section
      className={`border-b border-[var(--line)] px-4 py-4 last:border-b-0 sm:px-5 ${
        invalid ? "bg-[var(--danger-soft)]/45" : ""
      }`}
      id={`attribute-field-${field.id}`}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
        <div className="min-w-0 lg:w-56 lg:shrink-0">
          <div className="flex items-center gap-1.5">
            {field.required && <span className="text-[var(--danger)]">*</span>}
            <h3 className="text-sm font-medium text-[var(--ink)]">{field.name}</h3>
          </div>
          <p className="mt-1 text-xs text-[var(--text-subtle)]">
            ID {field.id} · {field.mode}
            {allowsMultiple && field.maxSelections > 0
              ? ` · 最多 ${field.maxSelections} 项`
              : ""}
          </p>
          {field.remarks[0] && (
            <p className="mt-1.5 text-xs leading-5 text-[var(--text-muted)]">
              {field.remarks[0]}
            </p>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          {allowsPreset && !allowsMultiple && (
            <select
              aria-label={`${field.name}属性值`}
              aria-describedby={invalid ? `attribute-field-error-${field.id}` : undefined}
              aria-invalid={invalid}
              className="field px-3"
              onChange={(event) => toggleValue(event.target.value)}
              value={value.valueIds[0] || ""}
            >
              <option value="">请选择 SHEIN 属性值</option>
              {field.values.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          )}
          {allowsPreset && allowsMultiple && (
            <div className="relative space-y-2">
              {searchableOptionPicker && (
                <div className="relative">
                  <button
                    aria-expanded={optionPickerOpen}
                    aria-haspopup="listbox"
                    className="field flex w-full items-center justify-between gap-3 px-3 text-left text-xs"
                    onClick={() => setOptionPickerOpen((open) => !open)}
                    type="button"
                  >
                    <span className="truncate text-[var(--text-muted)]">
                      {value.valueIds.length ? value.valueIds.join("、") : "输入搜索并下拉选择"}
                    </span>
                    <ChevronDown className="shrink-0 text-[var(--text-subtle)]" size={15} />
                  </button>
                  {optionPickerOpen && (
                    <div className="absolute z-20 mt-1 w-full rounded-md border border-[var(--line)] bg-white p-2 shadow-lg">
                      <label className="relative block">
                        <Search
                          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-subtle)]"
                          size={15}
                        />
                        <input
                          aria-label={`${field.name}搜索属性值`}
                          autoFocus
                          className="field pl-9 pr-3"
                          onChange={(event) => setOptionQuery(event.target.value)}
                          placeholder={`搜索 ${field.values.length} 个 SHEIN 属性值`}
                          value={optionQuery}
                        />
                      </label>
                      <div className="mt-2 grid max-h-44 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2 xl:grid-cols-3" role="listbox">
                        {visibleOptions.map((option) => {
                          const checked = selected.has(option.id);
                          const limitReached = field.maxSelections > 0 && selected.size >= field.maxSelections;
                          return (
                            <label className="flex min-h-8 cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-muted)]" key={option.id}>
                              <input
                                aria-describedby={invalid ? `attribute-field-error-${field.id}` : undefined}
                                aria-invalid={invalid}
                                checked={checked}
                                disabled={!checked && limitReached}
                                onChange={() => toggleValue(option.id)}
                                type="checkbox"
                              />
                              <span>{option.label}</span>
                            </label>
                          );
                        })}
                        {!visibleOptions.length && (
                          <p className="col-span-full px-3 py-4 text-center text-xs text-[var(--text-subtle)]">没有匹配的属性值</p>
                        )}
                      </div>
                      <div className="mt-2 flex items-center justify-between border-t border-[var(--line)] pt-2">
                        <p className="text-xs text-[var(--text-subtle)]">
                          当前显示 {visibleOptions.length} / {field.values.length} 个官方值 · 已选 {selected.size}
                        </p>
                        <button className="text-xs font-medium text-[var(--accent)]" onClick={() => setOptionPickerOpen(false)} type="button">完成</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {allowsManual && (
            <input
              aria-label={`${field.name}自定义值`}
              aria-describedby={invalid ? `attribute-field-error-${field.id}` : undefined}
              aria-invalid={invalid}
              className="field px-3"
              inputMode={numericCustomField ? "decimal" : undefined}
              maxLength={500}
              max={percentageComposition ? 100 : undefined}
              onChange={(event) =>
                onChange({ ...value, customValue: event.target.value })
              }
              placeholder={numericCustomField
                ? (percentageComposition
                  ? "填写成分百分比，如 100"
                  : quantityAttribute ? "填写数量，如 1" : "填写数字，如 1")
                : field.modeCode === 4 ? "可补充自定义值" : "按 SHEIN 要求输入"}
              type={numericCustomField ? "number" : "text"}
              value={value.customValue}
            />
          )}
          {numericCustomField && (
            <p className="text-xs leading-5 text-[var(--text-subtle)]">
              {percentageComposition
                ? "成分填写百分比；多个成分合计应为 100%。"
                : quantityAttribute
                  ? "选择 SHEIN 官方单位后填写对应数量，例如选择“件”后填写 1。"
                  : "选择 SHEIN 官方值后填写对应数字附加值。"}
            </p>
          )}
          {!allowsPreset && !allowsManual && (
            <p className="text-xs text-[var(--warning)]">
              SHEIN 当前字段模式不允许保存模板值。
            </p>
          )}
          {invalid && (
            <p
              className="flex items-center gap-1.5 text-xs font-medium text-[var(--danger)]"
              id={`attribute-field-error-${field.id}`}
            >
              <AlertCircle size={14} />
              {field.dataDimension === 2 && field.modeCode === 4
                ? "已选官方值，但数字附加值未填写或不完整"
                : "此项为 SHEIN 必填属性"}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function TemplateList({
  templates,
  loading,
  busy,
  onEdit,
  onDelete,
}: {
  templates: AttributeTemplate[];
  loading: boolean;
  busy: boolean;
  onEdit: (template: AttributeTemplate) => void;
  onDelete: (template: AttributeTemplate) => void;
}) {
  const [templateSearch, setTemplateSearch] = useState("");
  const filteredTemplates = useMemo(() => {
    const query = templateSearch.trim().toLocaleLowerCase();
    if (!query) return templates;
    return templates.filter((template) => [
      template.name,
      template.categoryId,
      template.data.categoryName,
      ...(template.data.categoryPath || []),
    ].some((value) => String(value || "").toLocaleLowerCase().includes(query)));
  }, [templateSearch, templates]);

  return (
    <section className="data-panel self-start">
      <header className="data-toolbar">
        <div>
          <h2>可引用模板</h2>
          <p>当前店铺可见的商品属性模板</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <label className="search-field sm:w-56">
            <Search size={15} />
            <input
              aria-label="搜索属性模板"
              onChange={(event) => setTemplateSearch(event.target.value)}
              placeholder="搜索模板名或类目"
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
        <div className="grid min-h-52 place-items-center text-sm text-[var(--text-muted)]">
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
                title={template.canManage ? "编辑模板" : "只有创建者或管理员可以修改"}
                type="button"
              >
                <span className="flex items-center gap-2">
                  <strong className="truncate text-sm font-medium text-[var(--ink)]">
                    {template.name}
                  </strong>
                  <span className="status-badge">{template.scopeLabel}</span>
                </span>
                <span className="mt-1.5 block text-xs leading-5 text-[var(--text-subtle)]">
                  类目 {template.categoryId} · v{template.version} · {formatTime(template.updatedAt)}
                </span>
              </button>
              {template.canManage && (
                <div className="flex shrink-0 gap-1">
                  <Button
                    aria-label={`编辑${template.name}`}
                    disabled={busy}
                    onClick={() => onEdit(template)}
                    size="icon"
                    title="编辑模板"
                    variant="ghost"
                  >
                    <Pencil size={15} />
                  </Button>
                  <Button
                    aria-label={`删除${template.name}`}
                    disabled={busy}
                    onClick={() => onDelete(template)}
                    size="icon"
                    title="删除模板"
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
            <BookCopy className="mx-auto text-[var(--text-subtle)]" size={24} />
            <p className="mt-3 text-sm font-medium text-[var(--ink)]">
              {templates.length ? "没有匹配的属性模板" : "还没有商品属性模板"}
            </p>
            <p className="mt-1 text-xs text-[var(--text-subtle)]">
              {templates.length ? "调整搜索词后重试" : "在编辑区填写后保存"}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

export function AttributeTemplatesPage() {
  const { currentStore, session } = useAppContext();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const storeId = currentStore?.id || "";
  const queryScope = `${session.tenant.id}:${session.user.id}`;
  const [editingId, setEditingId] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState<PublishCategoryOption | null>(null);
  const [categoryTrailIds, setCategoryTrailIds] = useState<string[]>([]);
  const [categorySearch, setCategorySearch] = useState("");
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(true);
  const [assignments, setAssignments] = useState<Assignments>({});
  const [rugReportEnabled, setRugReportEnabled] = useState(false);
  const [rugReportMode, setRugReportMode] = useState<RugReportMode>("thresholds");
  const [rugDimensions, setRugDimensions] = useState<
    [RugDimensionSource, RugDimensionSource]
  >(EMPTY_RUG_DIMENSIONS);
  const [rugThresholds, setRugThresholds] = useState<RugThresholds>(
    EMPTY_RUG_THRESHOLDS,
  );
  const [saveAttempted, setSaveAttempted] = useState(false);
  const [schemaSyncJobId, setSchemaSyncJobId] = useState("");
  const [feedback, setFeedback] = useState<{
    tone: "success" | "danger";
    message: string;
  } | null>(null);

  useEffect(() => {
    setEditingId("");
    setName("");
    setCategory(null);
    setCategoryTrailIds([]);
    setCategorySearch("");
    setCategoryPickerOpen(true);
    setAssignments({});
    setRugReportEnabled(false);
    setRugReportMode("thresholds");
    setRugDimensions(EMPTY_RUG_DIMENSIONS);
    setRugThresholds(EMPTY_RUG_THRESHOLDS);
    setSaveAttempted(false);
    setSchemaSyncJobId("");
    setFeedback(null);
  }, [storeId]);

  const templates = useQuery({
    queryKey: ["store", `${session.tenant.id}:${session.user.id}`, storeId, "publish-templates", "attribute"],
    queryFn: () => api.attributeTemplates(storeId),
    enabled: Boolean(storeId),
    refetchOnMount: false,
  });
  const categories = useQuery({
    queryKey: ["store", `${session.tenant.id}:${session.user.id}`, storeId, "publish-categories"],
    queryFn: () => api.publishCategories(storeId),
    enabled: Boolean(storeId),
    refetchOnMount: false,
  });
  const schemaCoverage = useQuery({
    queryKey: ["store", `${session.tenant.id}:${session.user.id}`, storeId, "publish-schema-coverage"],
    queryFn: () => api.publishSchemaCoverage(storeId),
    enabled: Boolean(storeId),
    refetchOnMount: false,
  });
  const schemaSyncJob = useQuery({
    queryKey: ["store", queryScope, storeId, "publish-schema-sync", schemaSyncJobId],
    queryFn: () => api.syncJob(storeId, schemaSyncJobId),
    enabled: Boolean(storeId && schemaSyncJobId),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
    refetchInterval: activeJobRefetchInterval,
    refetchIntervalInBackground: false,
  });
  const activeSchemaSyncJobs = useQuery({
    queryKey: ["store", queryScope, storeId, "jobs", "active", "rule_refresh"],
    queryFn: () => api.syncJobs(storeId, { jobType: "rule_refresh" }),
    enabled: Boolean(storeId),
    staleTime: 10_000,
    gcTime: 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  useEffect(() => {
    if (schemaSyncJobId) return;
    const active = activeSchemaSyncJobs.data?.jobs.find(
      (job) => job.state === "queued" || job.state === "running",
    );
    if (active?.id) setSchemaSyncJobId(active.id);
  }, [activeSchemaSyncJobs.data?.jobs, schemaSyncJobId]);
  const schemaSyncState = schemaSyncJob.data?.job.state || "";

  useEffect(() => {
    if (schemaSyncTerminalStates.includes(schemaSyncState)) {
      void schemaCoverage.refetch();
      void activeSchemaSyncJobs.refetch();
    }
  }, [activeSchemaSyncJobs.refetch, schemaCoverage.refetch, schemaSyncState]);
  const categoryTree = useMemo(
    () => normalizeCategoryTree(categories.data?.info),
    [categories.data],
  );
  const leafCategories = useMemo(
    () => flattenLeafCategories(categories.data?.info),
    [categories.data],
  );
  const categoryColumns = useMemo(() => {
    const columns: Array<{
      nodes: PublishCategoryNode[];
      activeId: string;
    }> = [];
    let nodes = categoryTree;
    let depth = 0;
    while (nodes.length) {
      const activeId = categoryTrailIds[depth] || "";
      columns.push({ nodes, activeId });
      const activeNode = nodes.find((node) => node.categoryId === activeId);
      if (!activeNode || activeNode.lastCategory || !activeNode.children.length) break;
      nodes = activeNode.children;
      depth += 1;
    }
    return columns;
  }, [categoryTrailIds, categoryTree]);
  const visibleLeafCategories = useMemo(() => {
    const query = categorySearch.trim().toLocaleLowerCase();
    if (!query) return [];
    return leafCategories.filter((item) => [
      item.name,
      item.path.join(" / "),
      item.categoryId,
      item.productTypeId,
    ].some((value) => value.toLocaleLowerCase().includes(query)));
  }, [categorySearch, leafCategories]);

  useEffect(() => {
    if (!categoryTree.length) return;
    const selectedTrail = category
      ? findCategoryTrail(categoryTree, category.categoryId)
      : [];
    const initialTrail = selectedTrail.length
      ? selectedTrail
      : findFirstLeafTrail(categoryTree);
    setCategoryTrailIds(initialTrail.slice(0, -1).map((node) => node.categoryId));
  }, [category?.categoryId, categoryTree]);
  const schema = useQuery({
    queryKey: [
      "store",
      queryScope,
      storeId,
      "publish-schema",
      category?.categoryId,
      category?.productTypeId,
    ],
    queryFn: () => api.publishSchema(storeId, {
      categoryId: category!.categoryId,
      productTypeId: category!.productTypeId,
    }),
    enabled: Boolean(storeId && category?.categoryId && category?.productTypeId),
  });
  const fields = useMemo(
    () => category && schema.data
      ? buildAttributeFields(schema.data.attributes, category.productTypeId)
      : [],
    [category, schema.data],
  );
  const selectedCoverage = useMemo(
    () => category
      ? schemaCoverage.data?.categories.find(
        (item) =>
          item.categoryId === category.categoryId &&
          item.productTypeId === category.productTypeId,
      ) || null
      : null,
    [category, schemaCoverage.data],
  );
  const coverageReady = selectedCoverage?.ready === true;
  const requiredFields = fields.filter((field) => field.required);
  const optionalFields = fields.filter((field) => !field.required);
  const rugDimensionFields = fields.filter(
    (field) => [3, 4].includes(field.typeCode) && field.dataDimension === 1,
  );
  const validation = validateAttributeAssignments(fields, assignments);
  const completedRequiredCount = Math.max(
    0,
    requiredFields.length - validation.missingFieldIds.length,
  );
  const invalidIds = new Set(saveAttempted
    ? [...validation.missingFieldIds, ...validation.invalidFieldIds]
    : []);
  const missingRequiredFields = validation.missingFieldIds.map((id, index) => ({
    id,
    name: validation.missingFieldNames[index] || id,
  }));
  const canManageTenantTemplates = ["owner", "admin"].includes(session.user.role);

  const focusAttribute = (fieldId: string) => {
    const section = document.getElementById(`attribute-field-${fieldId}`);
    if (!section) return;
    section.scrollIntoView({ behavior: "smooth", block: "center" });
    section.querySelector<HTMLElement>("select, input, textarea")?.focus({
      preventScroll: true,
    });
  };

  const resetEditor = () => {
    setEditingId("");
    setName("");
    setCategory(null);
    setCategoryTrailIds([]);
    setCategoryPickerOpen(true);
    setAssignments({});
    setRugReportEnabled(false);
    setRugReportMode("thresholds");
    setRugDimensions(EMPTY_RUG_DIMENSIONS);
    setRugThresholds(EMPTY_RUG_THRESHOLDS);
    setSaveAttempted(false);
    setFeedback(null);
  };

  const selectCategory = (next: PublishCategoryOption) => {
    setCategory(next);
    setCategoryPickerOpen(false);
    setCategorySearch("");
    setAssignments({});
    setRugReportEnabled(false);
    setRugReportMode("thresholds");
    setRugDimensions(EMPTY_RUG_DIMENSIONS);
    setRugThresholds(EMPTY_RUG_THRESHOLDS);
    setSaveAttempted(false);
    setFeedback(null);
  };

  const chooseCategoryNode = (node: PublishCategoryNode) => {
    const trail = findCategoryTrail(categoryTree, node.categoryId);
    setCategoryTrailIds(trail.map((item) => item.categoryId));
    if (!node.lastCategory || !node.productTypeId) return;
    selectCategory({
      categoryId: node.categoryId,
      productTypeId: node.productTypeId,
      name: node.name,
      path: trail.map((item) => item.name),
    });
  };

  const updateAssignment = (fieldId: string, value: AttributeAssignmentValue) => {
    setAssignments((current) => ({ ...current, [fieldId]: value }));
    setFeedback(null);
  };

  const updateRugThreshold = (
    key: keyof RugThresholds,
    next: RugThresholdSource,
  ) => {
    setRugThresholds((current) => ({ ...current, [key]: next }));
    setFeedback(null);
  };

  const editTemplate = (template: AttributeTemplate) => {
    const nextCategory = {
      categoryId: template.categoryId,
      productTypeId: template.productTypeId,
      name: template.data.categoryName || template.categoryId,
      path: template.data.categoryPath || [template.categoryId],
    };
    setEditingId(template.id);
    setName(template.name);
    setCategory(nextCategory);
    setCategoryPickerOpen(false);
    setCategorySearch("");
    setAssignments(Object.fromEntries(
      (template.data.assignments || []).map((assignment) => [
        assignment.attributeId,
        {
          valueIds: assignment.valueIds || [],
          customValue: assignment.customValue || "",
        },
      ]),
    ));
    const savedDimensions = template.data.rugReportSources?.dimensions || [];
    const savedThresholds = template.data.rugReportSources?.thresholds;
    setRugReportEnabled(savedDimensions.length === 2 || Boolean(savedThresholds));
    setRugReportMode(savedThresholds ? "thresholds" : "dimensions");
    setRugDimensions(savedDimensions.length === 2
      ? [savedDimensions[0], savedDimensions[1]]
      : EMPTY_RUG_DIMENSIONS);
    setRugThresholds(savedThresholds || EMPTY_RUG_THRESHOLDS);
    setSaveAttempted(false);
    setFeedback(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const saveTemplate = useMutation({
    mutationFn: async () => {
      setSaveAttempted(true);
      const normalizedName = name.trim().replace(/\s+/g, " ");
      if (!normalizedName) throw new Error("请填写模板名称");
      if (!category || !schema.data) throw new Error("请先选择末级类目并读取属性结构");
      if (!coverageReady) {
        throw new Error("当前类目的官方 schema 尚未完整同步，不能保存模板");
      }
      const missing = validateAttributeAssignments(fields, assignments);
      const invalidFieldIds = [...missing.missingFieldIds, ...missing.invalidFieldIds];
      if (invalidFieldIds.length) {
        document.getElementById(`attribute-field-${invalidFieldIds[0]}`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
        const names = [...missing.missingFieldNames, ...missing.invalidFieldNames];
        throw new Error(`保存前请补齐关务属性：${names.join("、")}`);
      }
      if (
        rugReportEnabled &&
        rugReportMode === "dimensions" &&
        rugDimensions.some((source) => !source.attributeId || !source.unit)
      ) {
        document.getElementById("rug-report-sources")
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
        throw new Error("请完整选择 1630/1631 判定使用的两个商品属性");
      }
      if (
        rugReportEnabled &&
        rugReportMode === "thresholds" &&
        Object.values(rugThresholds).some((source) =>
          !source.attributeId ||
          !source.exceededValueId ||
          !source.withinValueId ||
          source.exceededValueId === source.withinValueId
        )
      ) {
        document.getElementById("rug-report-sources")
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
        throw new Error("请完整配置最长边和面积的 SHEIN 是/否阈值属性");
      }
      const savedAssignments: AttributeTemplateAssignment[] = fields.flatMap((field) => {
        const value = assignments[field.id] || { valueIds: [], customValue: "" };
        const valueIds = value.valueIds.map(String).filter(Boolean);
        const customValue = value.customValue.trim();
        return valueIds.length || customValue
          ? [{ attributeId: field.id, valueIds, customValue }]
          : [];
      });
      const linked = await api.associatedAttributeRules(storeId, {
        categoryId: category.categoryId,
        productTypeId: category.productTypeId,
        attributeList: savedAssignments.flatMap((assignment) =>
          assignment.valueIds.length
            ? assignment.valueIds.map((valueId) => ({
                attributeId: assignment.attributeId,
                attributeValueId: valueId,
              }))
            : [{ attributeId: assignment.attributeId }],
        ),
      });
      const linkedData = linked.info as {
        data?: Array<{ link_rule_attribute_list?: LinkedRule[] }>;
      };
      const linkedRules = linkedData.data?.[0]?.link_rule_attribute_list || [];
      const fieldIds = new Set(fields.map((field) => field.id));
      const linkedMissing = linkedRules.filter((rule) => {
        const attributeId = String(rule.attribute_id || "");
        if (!fieldIds.has(attributeId)) return false;
        const assignment = savedAssignments.find(
          (item) => item.attributeId === attributeId,
        );
        if (!assignment) return true;
        const allowed = [
          ...(rule.attribute_value_list || []),
          ...(rule.attribute_value_pre_fill_list || []),
        ].map(String);
        return allowed.length > 0 &&
          !assignment.valueIds.some((valueId) => allowed.includes(valueId));
      });
      if (linkedMissing.length) {
        const names = linkedMissing.map((rule) =>
          fields.find((field) => field.id === String(rule.attribute_id))?.name ||
          String(rule.attribute_id),
        );
        throw new Error(`SHEIN 关联规则要求继续补充：${names.join("、")}`);
      }
      const checkedAt = new Date().toISOString();
      const selectedByField = new Map(savedAssignments.map((assignment) => [
        assignment.attributeId,
        new Set(assignment.valueIds),
      ]));
      const input: SaveAttributeTemplateInput = {
        name: normalizedName,
        categoryId: category.categoryId,
        productTypeId: category.productTypeId,
        data: {
          categoryName: category.name,
          categoryPath: category.path,
          schemaFetchedAt: checkedAt,
          assignments: savedAssignments,
          ...(rugReportEnabled
            ? {
                rugReportSources: rugReportMode === "thresholds"
                  ? { thresholds: rugThresholds }
                  : { dimensions: rugDimensions },
              }
            : {}),
          associatedRuleCheck: {
            checkedAt,
            attributeIds: [...new Set(
              linkedRules.map((rule) => String(rule.attribute_id || "")).filter(Boolean),
            )],
          },
        },
        schemaSnapshot: {
          category: {
            categoryId: category.categoryId,
            productTypeId: category.productTypeId,
          },
          fields: fields.map((field) => ({
            id: field.id,
            name: field.name,
            typeCode: field.typeCode,
            dataDimension: field.dataDimension,
            modeCode: field.modeCode,
            required: field.required,
            maxSelections: field.maxSelections,
            values: field.values.filter((value) =>
              selectedByField.get(field.id)?.has(value.id) ||
              (
                rugReportEnabled &&
                rugReportMode === "thresholds" &&
                Object.values(rugThresholds).some(
                  (source) => source.attributeId === field.id,
                )
              )
            ),
          })),
        },
      };
      return api.saveAttributeTemplate(storeId, input, editingId);
    },
    onMutate: () => {
      setFeedback(null);
    },
    onSuccess: ({ template }) => {
      queryClient.invalidateQueries({
        queryKey: ["store", `${session.tenant.id}:${session.user.id}`, storeId, "publish-templates", "attribute"],
      });
      setEditingId(template.id);
      setFeedback({ tone: "success", message: `模板“${template.name}”已保存` });
    },
    onError: (error: Error) => {
      setFeedback({ tone: "danger", message: error.message });
    },
  });

  const deleteTemplate = useMutation({
    mutationFn: (template: AttributeTemplate) =>
      api.deleteAttributeTemplate(storeId, template.id),
    onSuccess: (_, template) => {
      queryClient.invalidateQueries({
        queryKey: ["store", `${session.tenant.id}:${session.user.id}`, storeId, "publish-templates", "attribute"],
      });
      if (editingId === template.id) resetEditor();
      setFeedback({ tone: "success", message: `模板“${template.name}”已删除` });
    },
    onError: (error: Error) => {
      setFeedback({ tone: "danger", message: error.message });
    },
  });

  const syncAllSchemas = useMutation({
    mutationFn: () => api.syncPublishSchemas(storeId),
    onSuccess: ({ job }) => {
      setSchemaSyncJobId(job.id);
      setFeedback({
        tone: "success",
        message: `全量类目 schema 同步任务已创建（${job.id}）`,
      });
    },
    onError: (error: Error) => {
      setFeedback({ tone: "danger", message: error.message });
    },
  });

  const confirmDelete = (template: AttributeTemplate) => {
    if (window.confirm(`确认删除模板“${template.name}”吗？`)) {
      deleteTemplate.mutate(template);
    }
  };

  if (!currentStore) return null;
  const queryError =
    templates.error || categories.error || schemaCoverage.error || schema.error;
  const queryNotice = queryError
    ? describeAttributeTemplateError(queryError)
    : null;
  const attributeApiMissing = [
    templates.error,
    categories.error,
    schemaCoverage.error,
    schema.error,
  ].some(isMissingAttributeApi);
  const busy =
    saveTemplate.isPending ||
    deleteTemplate.isPending ||
    syncAllSchemas.isPending;

  return (
    <>
      <header className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-xs font-medium text-[var(--text-subtle)]">模板中心</p>
          <h1 className="mt-1.5 text-2xl font-semibold text-[var(--ink)]">商品属性模板</h1>
          <p className="mt-1.5 text-sm text-[var(--text-muted)]">
            {currentStore.label} · 绑定 SHEIN 末级类目与当前字段结构
          </p>
        </div>
        <Button disabled={busy} onClick={resetEditor} variant="outline">
          <Plus size={16} />
          新建模板
        </Button>
      </header>

      <div className="notice notice-warning">
        <ShieldCheck size={16} />
        <span>
          当前页面只保存可复用属性值，不创建商品，也不执行 SHEIN 发布。
          {canManageTenantTemplates ? " 管理员保存后全员可见。" : " 成员保存后在本人获授权店铺中可见。"}
        </span>
      </div>

      {queryError && (
        <div
          className="notice notice-danger"
          role="alert"
        >
          <AlertCircle size={16} />
          <span className="min-w-0 flex-1">
            <strong className="block">{queryNotice?.title}</strong>
            <span className="mt-1 block text-xs leading-5">
              {queryNotice?.message}
            </span>
          </span>
          <Button
            onClick={() => {
              templates.refetch();
              categories.refetch();
              schemaCoverage.refetch();
              if (category) schema.refetch();
            }}
            size="sm"
            variant="outline"
          >
            <RefreshCw size={14} />
            重试
          </Button>
        </div>
      )}

      {saveAttempted && missingRequiredFields.length > 0 && (
        <div
          aria-live="assertive"
          className="notice notice-danger mb-4"
          role="alert"
        >
          <AlertCircle className="mt-0.5 shrink-0" size={17} />
          <div className="min-w-0 flex-1">
            <p className="font-medium">保存前检查未通过</p>
            <p className="mt-1 text-xs leading-5">
              当前还有 {missingRequiredFields.length} 项必填商品属性未填写，点击缺失项可直接定位。
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {missingRequiredFields.map((field) => (
                <button
                  className="border-b border-[var(--danger)] text-left text-xs font-medium text-[var(--danger)] hover:opacity-70"
                  key={field.id}
                  onClick={() => focusAttribute(field.id)}
                  type="button"
                >
                  定位：{field.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div
        className={`grid gap-4 pb-24 ${
          categoryPickerOpen ? "" : "xl:grid-cols-[minmax(0,1fr)_360px]"
        }`}
      >
        <section className="data-panel">
          <header className="data-toolbar">
            <div>
              <h2>{editingId ? "编辑商品属性模板" : "新建商品属性模板"}</h2>
              <p>{editingId ? "保存后版本号自动递增" : "字段始终来自当前店铺的 SHEIN schema"}</p>
            </div>
            <span className="status-badge">
              {canManageTenantTemplates ? "全员通用" : "我的店铺通用"}
            </span>
          </header>

          <div className="border-b border-[var(--line)] px-4 py-4 sm:px-5">
            <label className="block text-xs font-medium text-[var(--text-muted)]" htmlFor="attribute-template-name">
              模板名称
            </label>
            <input
              className="field mt-2 px-3"
              disabled={busy}
              id="attribute-template-name"
              maxLength={80}
              onChange={(event) => {
                setName(event.target.value);
                setFeedback(null);
              }}
              placeholder="例如：区域地毯常用属性"
              value={name}
            />
          </div>

          <div className="border-b border-[var(--line)] px-4 py-4 sm:px-5">
            <div className="flex items-end justify-between gap-3">
              <div>
                <h3 className="text-sm font-medium text-[var(--ink)]">SHEIN 类目</h3>
                <p className="mt-1 text-xs text-[var(--text-subtle)]">
                  按层级选择末级类目，切换类目会清空当前填写
                </p>
              </div>
              {categories.isFetching && (
                <LoaderCircle className="animate-spin text-[var(--text-subtle)]" size={17} />
              )}
            </div>
            <div className="mt-3 flex flex-col gap-3 rounded-md border border-[var(--line)] bg-[var(--page)] px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-medium text-[var(--ink)]">
                  全部末级类目属性覆盖
                </p>
                <p className="mt-1 text-xs leading-5 text-[var(--text-subtle)]">
                  {schemaCoverage.isFetching
                    ? "正在读取当前店铺的类目属性覆盖状态"
                    : schemaCoverage.data
                      ? `已同步 ${schemaCoverage.data.summary.ready} / ${schemaCoverage.data.summary.total} 个末级类目；未同步类目不会借用其他类目属性`
                      : "暂无覆盖率数据"}
                </p>
              </div>
              <Button
                disabled={busy || schemaCoverage.isFetching}
                onClick={() => schemaCoverage.refetch()}
                size="sm"
                variant="outline"
              >
                {schemaCoverage.isFetching
                  ? <LoaderCircle className="animate-spin" size={14} />
                  : <RefreshCw size={14} />}
                刷新覆盖状态
              </Button>
              {canManageTenantTemplates ? (
                <Button
                  disabled={busy || attributeApiMissing}
                  onClick={() => syncAllSchemas.mutate()}
                  size="sm"
          title="同步全部末级类目的商品属性和发布规范"
                >
                  {syncAllSchemas.isPending
                    ? <LoaderCircle className="animate-spin" size={14} />
                    : <DatabaseZap size={14} />}
                  {syncAllSchemas.isPending ? "正在创建任务" : "同步全部类目"}
                </Button>
              ) : (
                <span className="text-xs text-[var(--text-subtle)]">
                  类目与商品属性由管理员统一同步
                </span>
              )}
            </div>
            {canManageTenantTemplates && schemaSyncJobId && (
              <div
                className={`mt-3 flex flex-col gap-3 rounded-md px-3 py-2.5 text-xs sm:flex-row sm:items-center sm:justify-between ${
                  schemaSyncJob.error ||
                  schemaSyncState === "failed" ||
                  schemaSyncState === "cancelled"
                    ? "notice notice-danger"
                    : schemaSyncState === "succeeded"
                      ? "notice notice-success"
                      : "notice notice-warning"
                }`}
                role="status"
              >
                <div className="min-w-0">
                  <strong className="block font-medium">全量类目 schema 同步</strong>
                  {schemaSyncJob.isLoading ? (
                    <span className="mt-1 block">正在读取任务状态</span>
                  ) : schemaSyncJob.error ? (
                    <span className="mt-1 block">{schemaSyncJob.error.message}</span>
                  ) : schemaSyncJob.data?.job ? (
                    <span className="mt-1 block">
                      {schemaSyncStateLabels[schemaSyncState as keyof typeof schemaSyncStateLabels] || schemaSyncState}
                      {" · "}
                      {schemaSyncJob.data.job.progress.processed != null &&
                      schemaSyncJob.data.job.progress.total != null
                        ? `${schemaSyncJob.data.job.progress.processed} / ${schemaSyncJob.data.job.progress.total} 个类目`
                        : "等待服务端返回进度"}
                      {schemaSyncJob.data.job.error
                        ? ` · ${schemaSyncJob.data.job.error.message}`
                        : ""}
                    </span>
                  ) : null}
                </div>
                <Button
                  onClick={() => navigate(`/app/operations/${encodeURIComponent(storeId)}/jobs`)}
                  size="sm"
                  variant="outline"
                >
                  查看任务详情
                </Button>
              </div>
            )}
            {category && !categoryPickerOpen && (
              <div className="mt-3 flex items-start gap-3 rounded-md bg-[var(--success-soft)] px-3 py-2.5 text-xs text-[var(--success-strong)]">
                <Check className="mt-0.5 shrink-0" size={14} />
                <span className="min-w-0 flex-1">
                  <strong className="block truncate font-medium">{category.path.join(" / ")}</strong>
                  <span className="mt-0.5 block">
                    Category {category.categoryId} · Product Type {category.productTypeId}
                  </span>
                </span>
                <button
                  className="flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-1 font-medium hover:bg-white/65"
                  disabled={busy}
                  onClick={() => setCategoryPickerOpen(true)}
                  type="button"
                >
                  更换类目
                  <ChevronDown size={13} />
                </button>
              </div>
            )}
            {category && selectedCoverage && !selectedCoverage.ready && (
              <div className="mt-3 flex items-start gap-2 rounded-md bg-[var(--warning-soft)] px-3 py-2.5 text-xs text-[var(--warning-strong)]">
                <AlertCircle className="mt-0.5 shrink-0" size={14} />
                <span>
                  当前类目的官方 schema 尚未完整同步：
                  {!selectedCoverage.attributeReady && " 商品属性模板待同步"}
                  {!selectedCoverage.publishStandardReady && " 发布填写规范待同步"}。
                  系统不会使用地毯或其他类目的属性替代。
                </span>
              </div>
            )}
            {category && selectedCoverage?.ready && (
              <div className="mt-3 flex items-center gap-2 rounded-md bg-[var(--success-soft)] px-3 py-2.5 text-xs text-[var(--success-strong)]">
                <Check className="shrink-0" size={14} />
                当前类目的商品属性模板与发布填写规范均已同步
              </div>
            )}
            {categoryPickerOpen && (
              <div className="mt-3 rounded-md border border-[var(--line)] bg-white">
                <label className="relative block border-b border-[var(--line)] px-3 py-3">
                  <Search
                    className="pointer-events-none absolute left-6 top-1/2 -translate-y-1/2 text-[var(--text-subtle)]"
                    size={15}
                  />
                  <input
                    aria-label="搜索商品末级类目"
                    className="field pl-9 pr-3"
                    onChange={(event) => setCategorySearch(event.target.value)}
                    placeholder="搜索类目名称、路径、Category ID 或 Product Type ID"
                    value={categorySearch}
                  />
                </label>
                {categorySearch.trim() ? (
                  <div className="max-h-72 overflow-y-auto p-2">
                    {visibleLeafCategories.map((item) => (
                      <button
                        className="flex w-full flex-col gap-1 rounded-sm px-3 py-2 text-left hover:bg-[var(--surface-muted)]"
                        disabled={busy}
                        key={`${item.categoryId}:${item.productTypeId}`}
                        onClick={() => selectCategory(item)}
                        type="button"
                      >
                        <span className="text-sm font-medium text-[var(--ink)]">
                          {item.path.join(" / ")}
                        </span>
                        <span className="text-xs text-[var(--text-subtle)]">
                          Category {item.categoryId} · Product Type {item.productTypeId}
                        </span>
                      </button>
                    ))}
                    {!visibleLeafCategories.length && (
                      <p className="px-3 py-6 text-center text-xs text-[var(--text-subtle)]">
                        没有匹配的末级类目
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="flex overflow-x-auto">
                    {categoryColumns.map((column, index) => (
                      <CategoryColumn
                        activeId={column.activeId}
                        disabled={busy}
                        key={index}
                        label={`第${index + 1}级类目`}
                        nodes={column.nodes}
                        onSelect={chooseCategoryNode}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {schema.isFetching ? (
            <div className="grid min-h-56 place-items-center text-sm text-[var(--text-muted)]">
              <div className="text-center">
                <LoaderCircle className="mx-auto mb-3 animate-spin" size={20} />
                正在读取 SHEIN 属性结构
              </div>
            </div>
          ) : category && schema.error ? (
            <div className="notice notice-danger m-4 sm:m-5" role="alert">
              <AlertCircle className="mt-0.5 shrink-0" size={17} />
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {isMissingAttributeApi(schema.error)
                    ? "云端后端尚未同步新版商品属性接口"
                    : "当前类目没有可用的官方属性缓存"}
                </p>
                <p className="mt-1 text-xs leading-5">
                  {category.path.join(" / ")} · Category {category.categoryId} · Product Type{" "}
                  {category.productTypeId}
                </p>
                <p className="mt-1 text-xs leading-5">
                  {isMissingAttributeApi(schema.error)
                    ? "当前类目规则服务暂时不可用，请稍后重试或联系管理员。"
                    : "请先同步该类目的 SHEIN schema，或更换到已同步类目。系统不会猜测或补造商品属性。"}
                </p>
              </div>
              <Button
                onClick={() => setCategoryPickerOpen(true)}
                size="sm"
                variant="outline"
              >
                更换类目
              </Button>
            </div>
          ) : category && schemaCoverage.isFetching && !selectedCoverage ? (
            <div className="grid min-h-56 place-items-center text-sm text-[var(--text-muted)]">
              <div className="text-center">
                <LoaderCircle className="mx-auto mb-3 animate-spin" size={20} />
                正在读取当前类目的官方覆盖状态
              </div>
            </div>
          ) : category && selectedCoverage && !coverageReady ? (
            <div className="notice notice-warning m-4 sm:m-5" role="alert">
              <AlertCircle className="mt-0.5 shrink-0" size={17} />
              <div className="min-w-0 flex-1">
                <p className="font-medium">当前类目的官方 schema 尚未完整同步</p>
                <p className="mt-1 text-xs leading-5">
                  {!selectedCoverage.attributeReady && "商品属性模板待同步。"}
                  {!selectedCoverage.publishStandardReady && "发布填写规范待同步。"}
                  {" "}完成两项规则同步后，才能编辑并保存模板。
                </p>
              </div>
              <Button
                onClick={() => schemaCoverage.refetch()}
                size="sm"
                variant="outline"
              >
                <RefreshCw size={14} />
                刷新状态
              </Button>
            </div>
          ) : category && schema.data && coverageReady ? (
            fields.length ? (
              <>
                {saveAttempted && (validation.missingFieldNames.length > 0 || validation.invalidFieldNames.length > 0) && (
                  <div className="notice notice-danger m-4 sm:m-5" role="alert">
                    <AlertCircle size={16} />
                    <span>保存前请补齐：{[...validation.missingFieldNames, ...validation.invalidFieldNames].join("、")}</span>
                  </div>
                )}
                <div>
                  <header className="border-b border-[var(--line)] bg-[#fafafa] px-4 py-3 sm:px-5">
                    <h3 className="text-xs font-semibold text-[var(--ink)]">必填属性</h3>
                    <p className="mt-1 text-xs text-[var(--text-subtle)]">
                      {requiredFields.length} 项 · 保存前必须完整填写
                    </p>
                  </header>
                  {requiredFields.map((field) => (
                    <AttributeFieldEditor
                      field={field}
                      invalid={invalidIds.has(field.id)}
                      key={field.id}
                      onChange={(value) => updateAssignment(field.id, value)}
                      value={assignments[field.id] || { valueIds: [], customValue: "" }}
                    />
                  ))}
                </div>
                {optionalFields.length > 0 && (
                  <div className="border-t border-[var(--line)]">
                    <header className="border-b border-[var(--line)] bg-[#fafafa] px-4 py-3 sm:px-5">
                      <h3 className="text-xs font-semibold text-[var(--ink)]">选填属性</h3>
                      <p className="mt-1 text-xs text-[var(--text-subtle)]">
                        {optionalFields.length} 项 · 可按模板需要填写
                      </p>
                    </header>
                    {optionalFields.map((field) => (
                      <AttributeFieldEditor
                        field={field}
                        invalid={false}
                        key={field.id}
                        onChange={(value) => updateAssignment(field.id, value)}
                        value={assignments[field.id] || { valueIds: [], customValue: "" }}
                      />
                    ))}
                  </div>
                )}
                <section
                  className="border-t border-[var(--line)]"
                  id="rug-report-sources"
                >
                  <header className="border-b border-[var(--line)] bg-[#fafafa] px-4 py-3 sm:px-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <Ruler className="text-[var(--text-subtle)]" size={16} />
                          <h3 className="text-xs font-semibold text-[var(--ink)]">
                            1630/1631 判定属性
                          </h3>
                        </div>
                        <p className="mt-1 text-xs leading-5 text-[var(--text-subtle)]">
                          只绑定当前类目实时返回的 SKC 商品属性，不读取 SKU 或包装尺寸
                        </p>
                      </div>
                      <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-[var(--ink)]">
                        <input
                          checked={rugReportEnabled}
                          disabled={busy}
                          onChange={(event) => {
                            const enabled = event.target.checked;
                            setRugReportEnabled(enabled);
                            if (enabled) {
                              setRugReportMode("thresholds");
                              setRugThresholds(suggestRugThresholds(fields));
                            }
                            setFeedback(null);
                          }}
                          type="checkbox"
                        />
                        此类目启用预判
                      </label>
                    </div>
                  </header>
                  {rugReportEnabled && (
                    <div className="space-y-4 px-4 py-4 sm:px-5">
                      <label className="block max-w-md">
                        <span className="text-xs font-medium text-[var(--text-muted)]">
                          判定方式
                        </span>
                        <select
                          className="field mt-2 px-3"
                          disabled={busy}
                          onChange={(event) => {
                            setRugReportMode(event.target.value as RugReportMode);
                            setFeedback(null);
                          }}
                          value={rugReportMode}
                        >
                          <option value="thresholds">SHEIN 是/否阈值属性</option>
                          <option value="dimensions">两个成品边长数值</option>
                        </select>
                      </label>

                      {rugReportMode === "thresholds" ? (
                        <div className="grid gap-4 lg:grid-cols-2">
                          {([
                            ["longestEdge", "是否最长边大于1.8m"],
                            ["area", "是否面积大于2.16m²"],
                          ] as const).map(([key, label]) => {
                            const source = rugThresholds[key];
                            const field = rugDimensionFields.find(
                              (item) => item.id === source.attributeId,
                            );
                            return (
                              <div className="rounded-md border border-[var(--line)] p-3" key={key}>
                                <label className="block">
                                  <span className="text-xs font-medium text-[var(--ink)]">{label}</span>
                                  <select
                                    className="field mt-2 px-3"
                                    disabled={busy}
                                    onChange={(event) => updateRugThreshold(
                                      key,
                                      thresholdSource(rugDimensionFields.find(
                                        (item) => item.id === event.target.value,
                                      )),
                                    )}
                                    value={source.attributeId}
                                  >
                                    <option value="">选择商品属性</option>
                                    {rugDimensionFields.map((item) => (
                                      <option key={item.id} value={item.id}>
                                        {item.name} · ID {item.id}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <div className="mt-3 grid grid-cols-2 gap-3">
                                  {([
                                    ["exceededValueId", "超过阈值（是）"],
                                    ["withinValueId", "未超过阈值（否）"],
                                  ] as const).map(([valueKey, valueLabel]) => (
                                    <label key={valueKey}>
                                      <span className="text-xs text-[var(--text-muted)]">{valueLabel}</span>
                                      <select
                                        className="field mt-2 px-3"
                                        disabled={busy || !field}
                                        onChange={(event) => updateRugThreshold(key, {
                                          ...source,
                                          [valueKey]: event.target.value,
                                        })}
                                        value={source[valueKey]}
                                      >
                                        <option value="">选择官方值</option>
                                        {(field?.values || []).map((value) => (
                                          <option key={value.id} value={value.id}>
                                            {value.label} · ID {value.id}
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                          <p className="text-xs leading-5 text-[var(--text-subtle)] lg:col-span-2">
                            两项均为“否”判定 1631；任一项为“是”判定 1630。系统会优先识别当前 SHEIN Schema 中同名的官方字段和值。
                          </p>
                        </div>
                      ) : (
                        <div className="grid gap-4 lg:grid-cols-2">
                          {["成品长度或直径", "成品宽度"].map((label, index) => (
                            <div
                              className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_96px]"
                              key={label}
                            >
                              <label className="min-w-0">
                                <span className="text-xs font-medium text-[var(--text-muted)]">{label}</span>
                                <select
                                  className="field mt-2 px-3"
                                  disabled={busy}
                                  onChange={(event) => {
                                    setRugDimensions((current) => {
                                      const next = [...current] as [RugDimensionSource, RugDimensionSource];
                                      next[index] = { ...next[index], attributeId: event.target.value };
                                      return next;
                                    });
                                    setFeedback(null);
                                  }}
                                  value={rugDimensions[index].attributeId}
                                >
                                  <option value="">选择商品属性</option>
                                  {rugDimensionFields.map((field) => (
                                    <option key={field.id} value={field.id}>
                                      {field.name} · ID {field.id}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label>
                                <span className="text-xs font-medium text-[var(--text-muted)]">单位</span>
                                <select
                                  className="field mt-2 px-3"
                                  disabled={busy}
                                  onChange={(event) => {
                                    setRugDimensions((current) => {
                                      const next = [...current] as [RugDimensionSource, RugDimensionSource];
                                      next[index] = {
                                        ...next[index],
                                        unit: event.target.value as RugDimensionSource["unit"],
                                      };
                                      return next;
                                    });
                                    setFeedback(null);
                                  }}
                                  value={rugDimensions[index].unit}
                                >
                                  <option value="mm">mm</option>
                                  <option value="cm">cm</option>
                                  <option value="m">m</option>
                                </select>
                              </label>
                            </div>
                          ))}
                          <p className="text-xs leading-5 text-[var(--text-subtle)] lg:col-span-2">
                            系统使用两项属性计算最长边与面积；圆形商品可在两处选择同一个直径属性。等于 180cm 且 2.16㎡ 时仍预判为 1631。
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </section>
              </>
            ) : (
              <div className="grid min-h-56 place-items-center px-6 text-center text-sm text-[var(--text-muted)]">
                当前 SHEIN schema 没有返回可保存的商品属性
              </div>
            )
          ) : (
            <div className="grid min-h-56 place-items-center px-6 text-center">
              <div>
                <Search className="mx-auto text-[var(--text-subtle)]" size={23} />
                <p className="mt-3 text-sm font-medium text-[var(--ink)]">先选择末级类目</p>
                <p className="mt-1 text-xs text-[var(--text-subtle)]">选择后自动读取当前属性结构</p>
              </div>
            </div>
          )}

          <footer className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--line)] bg-white/95 shadow-[0_-8px_20px_rgba(15,23,42,0.08)] backdrop-blur lg:left-[236px]">
            <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5 lg:px-6">
              <div className="min-w-0">
                <p className="text-xs font-medium text-[var(--ink)]">
                  {requiredFields.length > 0
                    ? `必填 ${completedRequiredCount}/${requiredFields.length}`
                    : category && schema.data ? "当前类目没有必填商品属性" : "请先选择末级类目"}
                  {requiredFields.length > 0 && validation.missingFieldIds.length > 0
                    ? ` · 还差 ${validation.missingFieldIds.length} 项`
                    : requiredFields.length > 0 ? " · 已完成" : ""}
                </p>
                <div
                  aria-live="polite"
                  className={`mt-1 flex min-h-5 items-center gap-1.5 text-xs ${
                    feedback?.tone === "danger"
                      ? "text-[var(--danger)]"
                      : feedback?.tone === "success"
                        ? "text-[var(--success-strong)]"
                        : "text-[var(--text-subtle)]"
                  }`}
                  role={feedback?.tone === "danger" ? "alert" : "status"}
                >
                  {saveTemplate.isPending ? (
                    <>
                      <LoaderCircle className="animate-spin" size={13} />
                      正在校验 SHEIN 规则并保存
                    </>
                  ) : feedback ? (
                    <>
                      {feedback.tone === "success"
                        ? <Check size={13} />
                        : <AlertCircle size={13} />}
                      <span className="truncate">{feedback?.message}</span>
                    </>
                  ) : (
                    "保存前会再次检查 SHEIN 关联属性规则"
                  )}
                </div>
              </div>
              <Button
                className="shrink-0"
                disabled={busy || schema.isFetching || !coverageReady}
                onClick={() => saveTemplate.mutate()}
              >
                {saveTemplate.isPending
                  ? <LoaderCircle className="animate-spin" size={16} />
                  : <Check size={16} />}
                {saveTemplate.isPending
                  ? "正在保存"
                  : editingId ? "更新全部属性" : "统一保存全部属性"}
              </Button>
            </div>
          </footer>
        </section>

        <TemplateList
          busy={busy}
          loading={templates.isLoading}
          onDelete={confirmDelete}
          onEdit={editTemplate}
          templates={templates.data?.templates || []}
        />
      </div>
    </>
  );
}
