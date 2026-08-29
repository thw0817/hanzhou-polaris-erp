import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Check,
  LoaderCircle,
  Palette,
  Pencil,
  Plus,
  Ruler,
  Search,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useAppContext } from "../../app/AppShell";
import { Button } from "../../components/ui/button";
import {
  api,
  type SaveSizeTemplateInput,
  type SizeTemplate,
} from "../../lib/api";
import { validateSizeTemplateDraft } from "../../lib/size-template-contract.js";
import { formatTime } from "../operations/OperationsShared";

interface DraftRow {
  id: string;
  sizeText: string;
  lengthCm: string;
  widthCm: string;
}

function createDraftRow(row?: {
  sizeText?: string | null;
  lengthCm?: number | null;
  widthCm?: number | null;
}): DraftRow {
  return {
    id: crypto.randomUUID(),
    sizeText: row?.sizeText || "",
    lengthCm: row?.lengthCm ? String(row.lengthCm) : "",
    widthCm: row?.widthCm ? String(row.widthCm) : "",
  };
}

function TemplateList({
  templates,
  loading,
  busy,
  onEdit,
  onDelete,
}: {
  templates: SizeTemplate[];
  loading: boolean;
  busy: boolean;
  onEdit: (template: SizeTemplate) => void;
  onDelete: (template: SizeTemplate) => void;
}) {
  const [templateSearch, setTemplateSearch] = useState("");
  const filteredTemplates = useMemo(() => {
    const query = templateSearch.trim().toLocaleLowerCase();
    if (!query) return templates;
    return templates.filter((template) => [
      template.name,
      template.data.colorText,
    ].some((value) => String(value || "").toLocaleLowerCase().includes(query)));
  }, [templateSearch, templates]);

  return (
    <section className="data-panel self-start">
      <header className="data-toolbar">
        <div>
          <h2>可引用模板</h2>
          <p>当前店铺可见的颜色与尺寸模板</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <label className="search-field sm:w-56">
            <Search size={15} />
            <input
              aria-label="搜索颜色与尺寸模板"
              onChange={(event) => setTemplateSearch(event.target.value)}
              placeholder="搜索模板名或共享颜色"
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
                  共享颜色 {template.data.colorText || "未填写"} · {template.data.rows?.length || 0} 个尺寸
                </span>
                <span className="mt-0.5 block text-xs text-[var(--text-subtle)]">
                  v{template.version} · {formatTime(template.updatedAt)}
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
            <Ruler className="mx-auto text-[var(--text-subtle)]" size={24} />
            <p className="mt-3 text-sm font-medium text-[var(--ink)]">
              {templates.length ? "没有匹配的颜色与尺寸模板" : "还没有颜色与尺寸模板"}
            </p>
            <p className="mt-1 text-xs text-[var(--text-subtle)]">
              {templates.length ? "调整搜索词后重试" : "在编辑区添加尺寸后统一保存"}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

export function SizeTemplatesPage() {
  const { currentStore, session } = useAppContext();
  const queryClient = useQueryClient();
  const storeId = currentStore?.id || "";
  const queryScope = `${session.tenant.id}:${session.user.id}`;
  const [editingId, setEditingId] = useState("");
  const [name, setName] = useState("");
  const [colorText, setColorText] = useState("");
  const [rows, setRows] = useState<DraftRow[]>(() => [createDraftRow()]);
  const [saveAttempted, setSaveAttempted] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "danger";
    message: string;
  } | null>(null);

  const resetEditor = () => {
    setEditingId("");
    setName("");
    setColorText("");
    setRows([createDraftRow()]);
    setSaveAttempted(false);
    setFeedback(null);
  };

  useEffect(() => {
    resetEditor();
  }, [storeId]);

  const templates = useQuery({
    queryKey: ["store", queryScope, storeId, "publish-templates", "size"],
    queryFn: () => api.sizeTemplates(storeId),
    enabled: Boolean(storeId),
    refetchOnMount: false,
  });
  const validation = useMemo(
    () => validateSizeTemplateDraft({ name, colorText, rows }),
    [colorText, name, rows],
  );
  const rowErrorCount = validation.errors.rows.filter(
    (row) => Object.keys(row).length > 0,
  ).length;
  const completedRows = Math.max(0, rows.length - rowErrorCount);
  const canManageTenantTemplates = ["owner", "admin"].includes(session.user.role);

  const updateRow = (rowId: string, values: Partial<DraftRow>) => {
    setRows((current) => current.map((row) =>
      row.id === rowId ? { ...row, ...values } : row
    ));
    setFeedback(null);
  };

  const addSizeRow = () => {
    setRows((current) => [...current, createDraftRow()]);
    setFeedback(null);
  };

  const removeSizeRow = (rowId: string) => {
    setRows((current) => current.length > 1
      ? current.filter((row) => row.id !== rowId)
      : current
    );
    setFeedback(null);
  };

  const editTemplate = (template: SizeTemplate) => {
    setEditingId(template.id);
    setName(template.name);
    setColorText(template.data.colorText || "");
    const normalized = validateSizeTemplateDraft({
      name: template.name,
      colorText: template.data.colorText,
      rows: template.data.rows,
    });
    setRows(normalized.data.rows.length
      ? normalized.data.rows.map((row) => createDraftRow(row))
      : [createDraftRow()]
    );
    setSaveAttempted(false);
    setFeedback(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const saveTemplate = useMutation({
    mutationFn: async () => {
      setSaveAttempted(true);
      if (!validation.valid) {
        const firstInvalidId = validation.errors.name
          ? "size-template-name"
          : validation.errors.colorText
            ? "size-template-color"
            : rows.flatMap((row, index) => {
                const errors = validation.errors.rows[index] || {};
                return (["sizeText", "lengthCm", "widthCm"] as const)
                  .filter((field) => errors[field])
                  .map((field) => `size-row-${row.id}-${field}`);
              })[0] || "size-template-rows";
        const target = document.getElementById(firstInvalidId);
        target?.scrollIntoView({ behavior: "smooth", block: "center" });
        if (target instanceof HTMLInputElement) target.focus({ preventScroll: true });
        throw new Error(
          validation.errors.rowsMessage ||
          `保存前请补齐 ${Number(Boolean(validation.errors.name)) +
            Number(Boolean(validation.errors.colorText)) +
            rowErrorCount} 处内容`,
        );
      }
      const input: SaveSizeTemplateInput = {
        name: validation.data.name,
        data: {
          colorText: validation.data.colorText,
          rows: validation.data.rows.map((row) => ({
            sizeText: row.sizeText,
            lengthCm: Number(row.lengthCm),
            widthCm: Number(row.widthCm),
          })),
        },
      };
      return api.saveSizeTemplate(storeId, input, editingId);
    },
    onMutate: () => {
      setFeedback(null);
    },
    onSuccess: ({ template }) => {
      queryClient.invalidateQueries({
        queryKey: ["store", queryScope, storeId, "publish-templates", "size"],
      });
      setEditingId(template.id);
      setFeedback({ tone: "success", message: `模板“${template.name}”已保存` });
    },
    onError: (error: Error) => {
      setFeedback({ tone: "danger", message: error.message });
    },
  });

  const deleteTemplate = useMutation({
    mutationFn: (template: SizeTemplate) =>
      api.deleteSizeTemplate(storeId, template.id),
    onSuccess: (_, template) => {
      queryClient.invalidateQueries({
        queryKey: ["store", queryScope, storeId, "publish-templates", "size"],
      });
      if (editingId === template.id) resetEditor();
      setFeedback({ tone: "success", message: `模板“${template.name}”已删除` });
    },
    onError: (error: Error) => {
      setFeedback({ tone: "danger", message: error.message });
    },
  });

  const confirmDelete = (template: SizeTemplate) => {
    if (window.confirm(`确认删除模板“${template.name}”吗？`)) {
      deleteTemplate.mutate(template);
    }
  };

  if (!currentStore) return null;
  const busy = saveTemplate.isPending || deleteTemplate.isPending;
  const showErrors = saveAttempted ? validation.errors : {
    name: "",
    colorText: "",
    rows: [],
    rowsMessage: "",
  };

  return (
    <>
      <header className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-xs font-medium text-[var(--text-subtle)]">模板中心</p>
          <h1 className="mt-1.5 text-2xl font-semibold text-[var(--ink)]">颜色与尺寸模板</h1>
          <p className="mt-1.5 text-sm text-[var(--text-muted)]">
            {currentStore.label} · 一套模板共用一个颜色
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
          当前模板不绑定类目。引用到商品时，必须按所选末级类目的当前 SHEIN schema
          匹配真实销售属性 ID；找不到完全匹配值时阻断预检。
        </span>
      </div>

      {templates.error && (
        <div className="notice notice-danger" role="alert">
          <AlertCircle size={16} />
          <span>{templates.error.message}</span>
          <Button onClick={() => templates.refetch()} size="sm" variant="outline">
            重试
          </Button>
        </div>
      )}

      <div className="grid gap-4 pb-24 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="data-panel">
          <header className="data-toolbar">
            <div>
              <h2>{editingId ? "编辑颜色与尺寸模板" : "新建颜色与尺寸模板"}</h2>
              <p>{editingId ? "保存后版本号自动递增" : "只保存共享颜色、尺寸显示名和尺寸边长"} · 系统统一按小边×大边保存</p>
            </div>
            <span className="status-badge">
              {canManageTenantTemplates ? "全员通用" : "我的店铺通用"}
            </span>
          </header>

          {saveAttempted && !validation.valid && (
            <div className="notice notice-danger m-4 sm:m-5" role="alert">
              <AlertCircle size={16} />
              <span>
                保存前请补齐模板名称、共享颜色以及所有尺寸行中的必填内容
              </span>
            </div>
          )}

          <div className="grid gap-4 border-b border-[var(--line)] px-4 py-4 sm:grid-cols-2 sm:px-5">
            <div>
              <label className="block text-xs font-medium text-[var(--text-muted)]" htmlFor="size-template-name">
                模板名称
              </label>
              <input
                className={`field mt-2 px-3 ${showErrors.name ? "!border-[var(--danger)]" : ""}`}
                disabled={busy}
                id="size-template-name"
                maxLength={80}
                onChange={(event) => {
                  setName(event.target.value);
                  setFeedback(null);
                }}
                placeholder="例如：常用装饰地毯尺寸"
                value={name}
              />
              {showErrors.name && (
                <p className="mt-1.5 text-xs font-medium text-[var(--danger)]">{showErrors.name}</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--text-muted)]" htmlFor="size-template-color">
                共享颜色
              </label>
              <div className="relative mt-2">
                <Palette className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-subtle)]" size={15} />
                <input
                  className={`field pl-9 pr-3 ${showErrors.colorText ? "!border-[var(--danger)]" : ""}`}
                  disabled={busy}
                  id="size-template-color"
                  maxLength={80}
                  onChange={(event) => {
                    setColorText(event.target.value);
                    setFeedback(null);
                  }}
                  placeholder="例如：多色"
                  value={colorText}
                />
              </div>
              {showErrors.colorText && (
                <p className="mt-1.5 text-xs font-medium text-[var(--danger)]">{showErrors.colorText}</p>
              )}
            </div>
          </div>

          <div id="size-template-rows">
            <header className="flex items-center justify-between gap-3 border-b border-[var(--line)] bg-[#fafafa] px-4 py-3 sm:px-5">
              <div>
                <h3 className="text-xs font-semibold text-[var(--ink)]">尺寸明细</h3>
                <p className="mt-1 text-xs text-[var(--text-subtle)]">
                  {rows.length} 行 · 每行对应一个商品尺寸
                </p>
              </div>
              <Button disabled={busy} onClick={addSizeRow} size="sm" variant="outline">
                <Plus size={14} />
                添加尺寸
              </Button>
            </header>

            <div className="hidden grid-cols-[minmax(180px,1fr)_130px_130px_40px] gap-3 border-b border-[var(--line)] bg-white px-5 py-2 text-xs font-medium text-[var(--text-subtle)] md:grid">
              <span>尺寸显示名</span>
              <span>小边（cm）</span>
              <span>大边（cm）</span>
              <span className="sr-only">操作</span>
            </div>

            <div className="divide-y divide-[var(--line)]">
              {rows.map((row, index) => {
                const errors = showErrors.rows[index] || {};
                const invalid = Object.keys(errors).length > 0;
                return (
                  <div
                    className={`grid gap-3 px-4 py-4 md:grid-cols-[minmax(180px,1fr)_130px_130px_40px] md:items-start sm:px-5 ${
                      invalid ? "bg-[var(--danger-soft)]/45" : ""
                    }`}
                    key={row.id}
                  >
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)] md:sr-only" htmlFor={`size-row-${row.id}-sizeText`}>
                        尺寸显示名
                      </label>
                      <input
                        className={`field px-3 ${errors.sizeText ? "!border-[var(--danger)]" : ""}`}
                        disabled={busy}
                        id={`size-row-${row.id}-sizeText`}
                        maxLength={120}
                        onChange={(event) => updateRow(row.id, { sizeText: event.target.value })}
                        placeholder="例如：40*60cm"
                        value={row.sizeText}
                      />
                      {errors.sizeText && (
                        <p className="mt-1 text-xs font-medium text-[var(--danger)]">{errors.sizeText}</p>
                      )}
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)] md:sr-only" htmlFor={`size-row-${row.id}-lengthCm`}>
                        小边（cm）
                      </label>
                      <input
                        className={`field px-3 ${errors.lengthCm ? "!border-[var(--danger)]" : ""}`}
                        disabled={busy}
                        id={`size-row-${row.id}-lengthCm`}
                        inputMode="decimal"
                        min="0"
                        onChange={(event) => updateRow(row.id, { lengthCm: event.target.value })}
                        placeholder="40"
                        step="0.1"
                        type="number"
                        value={row.lengthCm}
                      />
                      {errors.lengthCm && (
                        <p className="mt-1 text-xs font-medium text-[var(--danger)]">{errors.lengthCm}</p>
                      )}
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-[var(--text-muted)] md:sr-only" htmlFor={`size-row-${row.id}-widthCm`}>
                        大边（cm）
                      </label>
                      <input
                        className={`field px-3 ${errors.widthCm ? "!border-[var(--danger)]" : ""}`}
                        disabled={busy}
                        id={`size-row-${row.id}-widthCm`}
                        inputMode="decimal"
                        min="0"
                        onChange={(event) => updateRow(row.id, { widthCm: event.target.value })}
                        placeholder="60"
                        step="0.1"
                        type="number"
                        value={row.widthCm}
                      />
                      {errors.widthCm && (
                        <p className="mt-1 text-xs font-medium text-[var(--danger)]">{errors.widthCm}</p>
                      )}
                    </div>
                    <Button
                      aria-label={`删除第${index + 1}行尺寸`}
                      disabled={busy || rows.length === 1}
                      onClick={() => removeSizeRow(row.id)}
                      size="icon"
                      title={rows.length === 1 ? "至少保留一行尺寸" : "删除尺寸"}
                      variant="ghost"
                    >
                      <Trash2 size={15} />
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>

          <footer className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--line)] bg-white/95 shadow-[0_-8px_20px_rgba(15,23,42,0.08)] backdrop-blur lg:left-[236px]">
            <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5 lg:px-6">
              <div className="min-w-0">
                <p className="text-xs font-medium text-[var(--ink)]">
                  尺寸行 {completedRows}/{rows.length}
                  {validation.valid ? " · 可保存" : ` · 还差 ${rowErrorCount +
                    Number(Boolean(validation.errors.name)) +
                    Number(Boolean(validation.errors.colorText))} 处`}
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
                      正在保存颜色与尺寸模板
                    </>
                  ) : feedback ? (
                    <>
                      {feedback.tone === "success"
                        ? <Check size={13} />
                        : <AlertCircle size={13} />}
                      <span className="truncate">{feedback.message}</span>
                    </>
                  ) : (
                    "保存后在商品引用阶段匹配当前 SHEIN 类目销售属性"
                  )}
                </div>
              </div>
              <Button
                className="shrink-0"
                disabled={busy}
                onClick={() => saveTemplate.mutate()}
              >
                {saveTemplate.isPending
                  ? <LoaderCircle className="animate-spin" size={16} />
                  : <Check size={16} />}
                {saveTemplate.isPending
                  ? "正在保存"
                  : editingId ? "更新颜色与尺寸" : "统一保存颜色与尺寸"}
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
