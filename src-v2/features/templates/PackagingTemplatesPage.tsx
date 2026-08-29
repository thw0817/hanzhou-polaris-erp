import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Check,
  FileSpreadsheet,
  LoaderCircle,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { useAppContext } from "../../app/AppShell";
import { Button } from "../../components/ui/button";
import {
  api,
  type PackagingTemplate,
  type SavePackagingTemplateInput,
} from "../../lib/api";
import {
  normalizePackagingWorkbook,
  validatePackagingTemplateDraft,
  type PackagingWorkbook,
} from "../../lib/packaging-template-contract.js";
import { formatTime } from "../operations/OperationsShared";

function materialCount(workbook: PackagingWorkbook | null) {
  return workbook
    ? Number(workbook.materialCount) ||
        Object.keys(workbook.materials || {}).length
    : 0;
}

function recordCount(workbook: PackagingWorkbook | null) {
  return workbook
    ? Number(workbook.rowCount) ||
        Number(workbook.recordCount) ||
        Object.values(workbook.materials || {}).reduce(
          (total, rows) => total + rows.length,
          0,
        )
    : 0;
}

function sizeCount(workbook: PackagingWorkbook | null) {
  if (!workbook) return 0;
  if (Number(workbook.sizeCount)) return Number(workbook.sizeCount);
  return new Set(
    Object.values(workbook.materials || {}).flatMap((rows) =>
      rows.map((row) =>
        [Number(row.widthCm), Number(row.lengthCm)]
          .sort((left, right) => left - right)
          .join("x"),
      ),
    ),
  ).size;
}

function TemplateList({
  templates,
  loading,
  busy,
  onEdit,
  onDelete,
}: {
  templates: PackagingTemplate[];
  loading: boolean;
  busy: boolean;
  onEdit: (template: PackagingTemplate) => void;
  onDelete: (template: PackagingTemplate) => void;
}) {
  const [templateSearch, setTemplateSearch] = useState("");
  const filteredTemplates = useMemo(() => {
    const query = templateSearch.trim().toLocaleLowerCase();
    if (!query) return templates;
    return templates.filter((template) => [
      template.name,
      (template.data as PackagingWorkbook).fileName,
    ].some((value) => String(value || "").toLocaleLowerCase().includes(query)));
  }, [templateSearch, templates]);

  return (
    <section className="data-panel self-start">
      <header className="data-toolbar">
        <div>
          <h2>可引用模板</h2>
          <p>当前店铺可见的打包体积模板</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <label className="search-field sm:w-56">
            <Search size={15} />
            <input
              aria-label="搜索打包体积模板"
              onChange={(event) => setTemplateSearch(event.target.value)}
              placeholder="搜索模板名或工作簿"
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
                  {materialCount(template.data as PackagingWorkbook)} 种材质 ·{" "}
                  {sizeCount(template.data as PackagingWorkbook)} 个尺寸
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
            <FileSpreadsheet
              className="mx-auto text-[var(--text-subtle)]"
              size={24}
            />
            <p className="mt-3 text-sm font-medium text-[var(--ink)]">
              {templates.length ? "没有匹配的打包体积模板" : "还没有打包体积模板"}
            </p>
            <p className="mt-1 text-xs text-[var(--text-subtle)]">
              {templates.length ? "调整搜索词后重试" : "上传标准工作簿后统一保存"}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

export function PackagingTemplatesPage() {
  const { currentStore, session } = useAppContext();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const storeId = currentStore?.id || "";
  const queryScope = `${session.tenant.id}:${session.user.id}`;
  const [editingId, setEditingId] = useState("");
  const [name, setName] = useState("");
  const [workbook, setWorkbook] = useState<PackagingWorkbook | null>(null);
  const [parseIssues, setParseIssues] = useState<string[]>([]);
  const [parsing, setParsing] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [saveAttempted, setSaveAttempted] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "danger";
    message: string;
  } | null>(null);

  const resetEditor = () => {
    setEditingId("");
    setName("");
    setWorkbook(null);
    setParseIssues([]);
    setParsing(false);
    setDragActive(false);
    setSaveAttempted(false);
    setFeedback(null);
  };

  useEffect(() => {
    resetEditor();
  }, [storeId]);

  const templates = useQuery({
    queryKey: ["store", queryScope, storeId, "publish-templates", "packaging"],
    queryFn: () => api.packagingTemplates(storeId),
    enabled: Boolean(storeId),
    refetchOnMount: false,
  });
  const validation = useMemo(
    () => validatePackagingTemplateDraft({ name, workbook }),
    [name, workbook],
  );
  const issues = workbook?.issues || parseIssues;
  const canManageTenantTemplates = ["owner", "admin"].includes(session.user.role);

  const parseWorkbook = async (file: File) => {
    setSaveAttempted(false);
    setFeedback(null);
    if (!/\.xlsx$/i.test(file.name)) {
      setWorkbook(null);
      setParseIssues(["只允许上传 .xlsx 标准工作簿"]);
      setFeedback({ tone: "danger", message: "文件格式不正确，请重新选择 .xlsx 工作簿" });
      return;
    }
    setParsing(true);
    setParseIssues([]);
    try {
      const { default: readExcelFile } = await import("read-excel-file/browser");
      const normalized = normalizePackagingWorkbook(await readExcelFile(file));
      const nextWorkbook: PackagingWorkbook = {
        fileName: file.name,
        importedAt: new Date().toISOString(),
        ...normalized,
      };
      setWorkbook(nextWorkbook);
      setFeedback(normalized.issues.length
        ? { tone: "danger", message: `发现 ${normalized.issues.length} 个工作簿错误` }
        : {
            tone: "success",
            message: `解析完成：${normalized.materialCount} 种材质、${normalized.sizeCount} 个尺寸`,
          }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "无法读取工作簿";
      setWorkbook(null);
      setParseIssues([message]);
      setFeedback({ tone: "danger", message: `解析失败：${message}` });
    } finally {
      setParsing(false);
    }
  };

  const onFileChange = (file: File | undefined) => {
    if (file) void parseWorkbook(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    if (!parsing) onFileChange(event.dataTransfer.files?.[0]);
  };

  const editTemplate = (template: PackagingTemplate) => {
    setEditingId(template.id);
    setName(template.name);
    setWorkbook({
      ...template.data,
      materials: template.data.materials || {},
      issues: [],
    });
    setParseIssues([]);
    setSaveAttempted(false);
    setFeedback(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const saveTemplate = useMutation({
    mutationFn: async () => {
      setSaveAttempted(true);
      if (!validation.valid || !validation.data.workbook) {
        const targetId = validation.errors.name
          ? "packaging-template-name"
          : "packaging-workbook-upload";
        const target = document.getElementById(targetId);
        target?.scrollIntoView({ behavior: "smooth", block: "center" });
        if (target instanceof HTMLInputElement) {
          target.focus({ preventScroll: true });
        }
        throw new Error(
          validation.errors.name || validation.errors.workbook || "模板内容不完整",
        );
      }
      const input: SavePackagingTemplateInput = {
        name: validation.data.name,
        data: validation.data.workbook,
      };
      return api.savePackagingTemplate(storeId, input, editingId);
    },
    onMutate: () => setFeedback(null),
    onSuccess: ({ template }) => {
      queryClient.invalidateQueries({
        queryKey: ["store", queryScope, storeId, "publish-templates", "packaging"],
      });
      setEditingId(template.id);
      setWorkbook({
        ...template.data,
        materials: template.data.materials || {},
        issues: [],
      });
      setFeedback({ tone: "success", message: `模板“${template.name}”已保存` });
    },
    onError: (error: Error) => {
      setFeedback({ tone: "danger", message: error.message });
    },
  });

  const deleteTemplate = useMutation({
    mutationFn: (template: PackagingTemplate) =>
      api.deletePackagingTemplate(storeId, template.id),
    onSuccess: (_, template) => {
      queryClient.invalidateQueries({
        queryKey: ["store", queryScope, storeId, "publish-templates", "packaging"],
      });
      if (editingId === template.id) resetEditor();
      setFeedback({ tone: "success", message: `模板“${template.name}”已删除` });
    },
    onError: (error: Error) => {
      setFeedback({ tone: "danger", message: error.message });
    },
  });

  const confirmDelete = (template: PackagingTemplate) => {
    if (window.confirm(`确认删除模板“${template.name}”吗？`)) {
      deleteTemplate.mutate(template);
    }
  };

  if (!currentStore) return null;
  const busy = parsing || saveTemplate.isPending || deleteTemplate.isPending;
  const showNameError = saveAttempted ? validation.errors.name : "";
  const showWorkbookError = saveAttempted ? validation.errors.workbook : "";

  return (
    <>
      <header className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-xs font-medium text-[var(--text-subtle)]">模板中心</p>
          <h1 className="mt-1.5 text-2xl font-semibold text-[var(--ink)]">
            打包体积模板
          </h1>
          <p className="mt-1.5 text-sm text-[var(--text-muted)]">
            {currentStore.label} · 标准 Excel 严格校验
          </p>
        </div>
        <Button disabled={busy} onClick={resetEditor} variant="outline">
          <Plus size={16} />
          新建模板
        </Button>
      </header>

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
              <h2>{editingId ? "编辑打包体积模板" : "新建打包体积模板"}</h2>
              <p>
                {editingId
                  ? "重新上传会替换当前模板中的旧工作簿"
                  : "上传后只显示校验摘要，不展开可编辑表格"}
              </p>
            </div>
            <span className="status-badge">
              {canManageTenantTemplates ? "全员通用" : "我的店铺通用"}
            </span>
          </header>

          {saveAttempted && !validation.valid && (
            <div className="notice notice-danger m-4 sm:m-5" role="alert">
              <AlertCircle size={16} />
              <span>保存前请填写模板名称，并上传通过校验的标准工作簿</span>
            </div>
          )}

          <div className="border-b border-[var(--line)] px-4 py-4 sm:px-5">
            <label
              className="block text-xs font-medium text-[var(--text-muted)]"
              htmlFor="packaging-template-name"
            >
              模板名称
            </label>
            <input
              className={`field mt-2 max-w-xl px-3 ${
                showNameError ? "!border-[var(--danger)]" : ""
              }`}
              disabled={busy}
              id="packaging-template-name"
              maxLength={80}
              onChange={(event) => {
                setName(event.target.value);
                setFeedback(null);
              }}
              placeholder="例如：哇噻地毯标准打包体积"
              value={name}
            />
            {showNameError && (
              <p className="mt-1.5 text-xs font-medium text-[var(--danger)]">
                {showNameError}
              </p>
            )}
          </div>

          <div className="px-4 py-4 sm:px-5 sm:py-5">
            <div
              className={`grid min-h-52 place-items-center border border-dashed px-5 py-8 text-center transition-colors ${
                showWorkbookError || issues.length
                  ? "border-[var(--danger)] bg-[var(--danger-soft)]/35"
                  : dragActive
                    ? "border-[var(--focus)] bg-[var(--surface-muted)]"
                    : "border-[var(--line-strong)] bg-[#fafafa]"
              }`}
              id="packaging-workbook-upload"
              onDragEnter={(event) => {
                event.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={onDrop}
            >
              <div className="max-w-xl">
                {parsing ? (
                  <LoaderCircle
                    className="mx-auto animate-spin text-[var(--text-muted)]"
                    size={28}
                  />
                ) : (
                  <FileSpreadsheet
                    className="mx-auto text-[var(--text-subtle)]"
                    size={30}
                  />
                )}
                <h3 className="mt-3 text-sm font-semibold text-[var(--ink)]">
                  {parsing ? "正在严格校验工作簿" : "上传标准打包体积工作簿"}
                </h3>
                <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">
                  只接受 .xlsx；每个工作表名称作为材质，列必须严格为：
                  宽、长、打包长、打包宽、打包高。
                </p>
                <input
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="sr-only"
                  disabled={busy}
                  onChange={(event) => onFileChange(event.target.files?.[0])}
                  ref={fileInputRef}
                  type="file"
                />
                <Button
                  className="mt-4"
                  disabled={busy}
                  onClick={() => fileInputRef.current?.click()}
                  size="sm"
                  variant="outline"
                >
                  {parsing
                    ? <LoaderCircle className="animate-spin" size={15} />
                    : <Upload size={15} />}
                  {workbook ? "更换工作簿" : "选择工作簿"}
                </Button>
                <p className="mt-2 text-[11px] text-[var(--text-subtle)]">
                  标准文件：哇噻地毯_打包体积标准模板.xlsx
                </p>
              </div>
            </div>

            {showWorkbookError && (
              <p className="mt-2 text-xs font-medium text-[var(--danger)]">
                {showWorkbookError}
              </p>
            )}

            {workbook && (
              <section className="mt-4 border border-[var(--line)] bg-white">
                <header className="flex items-center gap-3 border-b border-[var(--line)] px-4 py-3">
                  <Check className="text-[var(--success)]" size={16} />
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-medium text-[var(--ink)]">
                      {workbook.fileName || "已保存工作簿"}
                    </h3>
                    <p className="mt-0.5 text-xs text-[var(--text-subtle)]">
                      上传新文件会完整替换当前工作簿
                    </p>
                  </div>
                </header>
                <div className="grid grid-cols-2 divide-x divide-y divide-[var(--line)] sm:grid-cols-4 sm:divide-y-0">
                  {[
                    ["材质数", materialCount(workbook)],
                    ["尺寸数", sizeCount(workbook)],
                    ["有效记录", recordCount(workbook)],
                    ["重复覆盖", Number(workbook.overwrittenCount || 0)],
                  ].map(([label, value]) => (
                    <div className="px-4 py-3" key={String(label)}>
                      <p className="text-[11px] font-medium text-[var(--text-subtle)]">
                        {label}
                      </p>
                      <p className="mt-1 text-lg font-semibold text-[var(--ink)]">
                        {value}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {!!issues.length && (
              <div className="notice notice-danger mt-4" role="alert">
                <AlertCircle className="mt-0.5 shrink-0" size={16} />
                <div className="min-w-0">
                  <p className="font-medium">工作簿未通过校验</p>
                  <ul className="mt-1 space-y-1 text-xs">
                    {issues.slice(0, 5).map((issue) => (
                      <li key={issue}>{issue}</li>
                    ))}
                  </ul>
                  {issues.length > 5 && (
                    <p className="mt-1 text-xs">
                      另有 {issues.length - 5} 个错误，请修正后重新上传
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          <footer className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--line)] bg-white/95 shadow-[0_-8px_20px_rgba(15,23,42,0.08)] backdrop-blur lg:left-[236px]">
            <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5 lg:px-6">
              <div className="min-w-0">
                <p className="text-xs font-medium text-[var(--ink)]">
                  {validation.valid
                    ? `已通过校验 · ${materialCount(workbook)} 种材质、${sizeCount(workbook)} 个尺寸`
                    : "等待完整且通过校验的标准工作簿"}
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
                      正在保存打包体积模板
                    </>
                  ) : feedback ? (
                    <>
                      {feedback.tone === "success"
                        ? <Check size={13} />
                        : <AlertCircle size={13} />}
                      <span className="truncate">{feedback.message}</span>
                    </>
                  ) : (
                    "重复材质和尺寸按工作簿最后一行覆盖"
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
                  : editingId ? "更新打包体积" : "统一保存打包体积"}
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
