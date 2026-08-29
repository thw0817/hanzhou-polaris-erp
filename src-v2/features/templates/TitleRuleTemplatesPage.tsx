import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Check,
  FileText,
  LoaderCircle,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { useAppContext } from "../../app/AppShell";
import { Button } from "../../components/ui/button";
import {
  api,
  type TitleRuleTemplate,
} from "../../lib/api";
import {
  applyTitleRule,
  validateTitleRuleTemplateDraft,
} from "../../lib/title-rule-template-contract.js";
import { formatTime } from "../operations/OperationsShared";

const SAMPLE_TITLE = "几何图案客厅地毯";

export function TitleRuleTemplatesPage() {
  const { currentStore, session } = useAppContext();
  const queryClient = useQueryClient();
  const storeId = currentStore?.id || "";
  const queryScope = `${session.tenant.id}:${session.user.id}`;
  const [editingId, setEditingId] = useState("");
  const [name, setName] = useState("");
  const [fullTitle, setFullTitle] = useState("");
  const [prefix, setPrefix] = useState("");
  const [keywords, setKeywords] = useState("");
  const [suffix, setSuffix] = useState("");
  const [templateSearch, setTemplateSearch] = useState("");
  const [saveAttempted, setSaveAttempted] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "danger";
    message: string;
  } | null>(null);

  const resetEditor = () => {
    setEditingId("");
    setName("");
    setFullTitle("");
    setPrefix("");
    setKeywords("");
    setSuffix("");
    setSaveAttempted(false);
    setFeedback(null);
  };

  useEffect(() => resetEditor(), [storeId]);

  const templates = useQuery({
    queryKey: ["store", queryScope, storeId, "publish-templates", "title_rule"],
    queryFn: () => api.titleRuleTemplates(storeId),
    enabled: Boolean(storeId),
    refetchOnMount: false,
  });
  const validation = useMemo(
    () => validateTitleRuleTemplateDraft({
      name,
      fullTitle,
      prefix,
      keywords,
      suffix,
    }),
    [fullTitle, keywords, name, prefix, suffix],
  );
  const preview = applyTitleRule(SAMPLE_TITLE, validation.data.template);
  const filteredTemplates = useMemo(() => {
    const query = templateSearch.trim().toLocaleLowerCase();
    const rows = templates.data?.templates || [];
    if (!query) return rows;
    return rows.filter((template) => [
      template.name,
      template.data.fullTitle,
      template.data.prefix,
      template.data.keywords,
      template.data.suffix,
    ].some((value) => String(value || "").toLocaleLowerCase().includes(query)));
  }, [templateSearch, templates.data?.templates]);

  const save = useMutation({
    mutationFn: () => api.saveTitleRuleTemplate(storeId, {
      name: validation.data.name,
      data: validation.data.template,
    }, editingId),
    onSuccess: async ({ template }) => {
      await queryClient.invalidateQueries({
        queryKey: ["store", queryScope, storeId, "publish-templates", "title_rule"],
      });
      setEditingId(template.id);
      setSaveAttempted(false);
      setFeedback({ tone: "success", message: "标题规则模板已保存" });
    },
    onError: (error: Error) => {
      setFeedback({ tone: "danger", message: error.message });
    },
  });

  const remove = useMutation({
    mutationFn: (templateId: string) => api.deleteTitleRuleTemplate(storeId, templateId),
    onSuccess: async (_, removedId) => {
      await queryClient.invalidateQueries({
        queryKey: ["store", queryScope, storeId, "publish-templates", "title_rule"],
      });
      if (editingId === removedId) resetEditor();
      setFeedback({ tone: "success", message: "标题规则模板已删除" });
    },
    onError: (error: Error) => {
      setFeedback({ tone: "danger", message: error.message });
    },
  });

  const editTemplate = (template: TitleRuleTemplate) => {
    setEditingId(template.id);
    setName(template.name);
    setFullTitle(template.data.fullTitle || "");
    setPrefix(template.data.prefix || "");
    setKeywords(template.data.keywords || "");
    setSuffix(template.data.suffix || "");
    setSaveAttempted(false);
    setFeedback(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const busy = save.isPending || remove.isPending;
  const canManageTenantTemplates = ["owner", "admin"].includes(session.user.role);

  if (!currentStore) return null;
  return (
    <>
      <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium text-[var(--text-subtle)]">模板中心</p>
          <h1 className="mt-1.5 text-2xl font-semibold text-[var(--ink)]">标题规则</h1>
          <p className="mt-1.5 text-sm text-[var(--text-muted)]">
            为自建商品复用标题片段；最终标题仍按当前 SHEIN 默认语种和长度规则校验。
          </p>
        </div>
        <Button disabled={busy} onClick={resetEditor} variant="outline">
          <Plus size={15} />新建规则
        </Button>
      </header>

      <div className="grid gap-4 pb-24 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="data-panel">
          <header className="data-toolbar">
            <div>
              <h2>{editingId ? "编辑标题规则" : "新建标题规则"}</h2>
              <p>{canManageTenantTemplates ? "保存后全员通用" : "保存后仅你可跨店铺复用"}</p>
            </div>
            <FileText className="text-[var(--text-subtle)]" size={18} />
          </header>
          <div className="grid gap-4 px-4 py-4 sm:px-5 lg:grid-cols-2">
            <label className="lg:col-span-2">
              <span className="text-xs font-medium text-[var(--text-muted)]">模板名称</span>
              <input
                className={`field mt-2 px-3 ${saveAttempted && validation.errors.name ? "!border-[var(--danger)]" : ""}`}
                disabled={busy}
                maxLength={80}
                onChange={(event) => { setName(event.target.value); setFeedback(null); }}
                placeholder="例如：现代地毯常用标题"
                value={name}
              />
              {saveAttempted && validation.errors.name && (
                <span className="mt-1.5 block text-xs text-[var(--danger)]">{validation.errors.name}</span>
              )}
            </label>
            <label className="lg:col-span-2">
              <span className="text-xs font-medium text-[var(--text-muted)]">完整替换标题（优先）</span>
              <input
                className="field mt-2 px-3"
                disabled={busy}
                maxLength={1000}
                onChange={(event) => { setFullTitle(event.target.value); setFeedback(null); }}
                placeholder="填写后引用时直接替换当前标题"
                value={fullTitle}
              />
            </label>
            <label>
              <span className="text-xs font-medium text-[var(--text-muted)]">标题前缀</span>
              <input className="field mt-2 px-3" disabled={busy} maxLength={300} onChange={(event) => { setPrefix(event.target.value); setFeedback(null); }} placeholder="例如：现代" value={prefix} />
            </label>
            <label>
              <span className="text-xs font-medium text-[var(--text-muted)]">标题后缀</span>
              <input className="field mt-2 px-3" disabled={busy} maxLength={300} onChange={(event) => { setSuffix(event.target.value); setFeedback(null); }} placeholder="例如：客厅卧室适用" value={suffix} />
            </label>
            <label className="lg:col-span-2">
              <span className="text-xs font-medium text-[var(--text-muted)]">固定关键词</span>
              <textarea
                className="field mt-2 min-h-24 resize-y px-3 py-2"
                disabled={busy}
                maxLength={500}
                onChange={(event) => { setKeywords(event.target.value); setFeedback(null); }}
                placeholder="例如：防滑 可机洗；换行输入也会自动合并"
                value={keywords}
              />
            </label>
          </div>
          {saveAttempted && validation.errors.rule && (
            <div className="notice notice-danger m-4 sm:m-5" role="alert">
              <AlertCircle size={16} />{validation.errors.rule}
            </div>
          )}
          <div className="border-t border-[var(--line)] px-4 py-4 sm:px-5">
            <span className="text-xs font-medium text-[var(--text-muted)]">标题预览</span>
            <p className="mt-2 rounded-md bg-[var(--surface-muted)] px-3 py-3 text-sm leading-6 text-[var(--ink)]">
              {preview || "填写规则后显示预览"}
            </p>
            <p className="mt-2 text-xs leading-5 text-[var(--text-subtle)]">
              预览以“{SAMPLE_TITLE}”作为当前商品标题；引用后仍会经过 SHEIN 标题长度、默认语种和 emoji 校验。
            </p>
          </div>
        </section>

        <section className="data-panel self-start">
          <header className="data-toolbar">
            <div><h2>可引用模板</h2><p>{templates.data?.count || 0} 个标题规则</p></div>
          </header>
          <div className="border-b border-[var(--line)] p-3">
            <label className="search-field">
              <Search size={15} />
              <input aria-label="搜索标题规则模板" onChange={(event) => setTemplateSearch(event.target.value)} placeholder="搜索模板或标题词" value={templateSearch} />
            </label>
          </div>
          {templates.isLoading ? (
            <div className="grid min-h-52 place-items-center"><LoaderCircle className="animate-spin text-[var(--text-subtle)]" size={20} /></div>
          ) : filteredTemplates.length ? (
            <div className="divide-y divide-[var(--line)]">
              {filteredTemplates.map((template) => (
                <article className="flex items-start gap-2 px-4 py-4" key={template.id}>
                  <button className="min-w-0 flex-1 text-left" disabled={!template.canManage || busy} onClick={() => editTemplate(template)} type="button">
                    <span className="flex items-center gap-2">
                      <strong className="truncate text-sm font-medium text-[var(--ink)]">{template.name}</strong>
                      <span className="status-badge">{template.scopeLabel}</span>
                    </span>
                    <span className="mt-1.5 line-clamp-2 block text-xs leading-5 text-[var(--text-subtle)]">
                      {applyTitleRule(SAMPLE_TITLE, template.data)}
                    </span>
                    <span className="mt-0.5 block text-xs text-[var(--text-subtle)]">v{template.version} · {formatTime(template.updatedAt)}</span>
                  </button>
                  {template.canManage && (
                    <div className="flex shrink-0 gap-1">
                      <Button aria-label={`编辑${template.name}`} disabled={busy} onClick={() => editTemplate(template)} size="icon" variant="ghost"><Pencil size={15} /></Button>
                      <Button aria-label={`删除${template.name}`} disabled={busy} onClick={() => {
                        if (window.confirm(`确定删除标题规则“${template.name}”吗？`)) remove.mutate(template.id);
                      }} size="icon" variant="ghost"><Trash2 size={15} /></Button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <div className="grid min-h-52 place-items-center px-6 text-center text-sm text-[var(--text-subtle)]">
              {templates.data?.templates.length ? "没有匹配的标题规则模板" : "还没有标题规则模板"}
            </div>
          )}
        </section>
      </div>

      <footer className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--line)] bg-white/95 shadow-[0_-8px_20px_rgba(15,23,42,0.08)] backdrop-blur lg:left-[236px]">
        <div className="mx-auto flex w-full max-w-[1600px] items-center justify-between gap-3 px-3 py-3 sm:px-5 lg:px-6">
          <div aria-live="polite" className={`min-h-5 text-xs ${feedback?.tone === "danger" ? "text-[var(--danger)]" : feedback?.tone === "success" ? "text-[var(--success-strong)]" : "text-[var(--text-subtle)]"}`}>
            {feedback ? <span className="flex items-center gap-1.5">{feedback.tone === "success" ? <Check size={13} /> : <AlertCircle size={13} />}{feedback.message}</span> : "标题规则仅写入模板，不会创建或发布商品"}
          </div>
          <Button disabled={busy} onClick={() => {
            setSaveAttempted(true);
            if (validation.valid) save.mutate();
          }}>
            {save.isPending ? <LoaderCircle className="animate-spin" size={16} /> : <FileText size={16} />}
            {save.isPending ? "正在保存" : "统一保存标题规则"}
          </Button>
        </div>
      </footer>
    </>
  );
}
