import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  FilePenLine,
  Image as ImageIcon,
  Layers3,
  LoaderCircle,
  Plus,
  Search,
  Send,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useNavigate } from "react-router";
import { useAppContext } from "../../app/AppShell";
import { Button } from "../../components/ui/button";
import { OpsPageHeader } from "../../components/operations/OperationsPrimitives";
import { api, type ProductDraft } from "../../lib/api";
import {
  planBulkDraftTemplateApplication,
  type BulkDraftTemplatePlan,
} from "../../lib/product-draft-bulk-template-contract.js";
import {
  collectProductDraftIssues,
  sortProductDraftsByActionPriority,
  type ProductDraftIssueSection,
} from "../../lib/product-draft-issue-contract.js";
import { buildPublishBatchHandoff } from "../../lib/product-draft-publish-handoff-contract.js";
import { formatTime, PublishQuotaNotice } from "../operations/OperationsShared";
import { useBusinessDashboard } from "../operations/use-business-dashboard";

const statusLabels: Record<ProductDraft["status"], string> = {
  draft: "草稿",
  blocked: "待修正",
  ready: "可预检",
  published: "已发布",
  archived: "已归档",
};

type BulkSchemaSnapshot = {
  checkedAt: string;
  attributes: Record<string, unknown>;
  publishStandard: Record<string, unknown>;
  error?: string;
};

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function categoryLabelOf(draft: ProductDraft): string {
  const data = asRecord(draft.data);
  const rawPath = data.categoryPath;
  const path = Array.isArray(rawPath)
    ? rawPath.map((value) => String(value || "").trim()).filter(Boolean)
    : String(rawPath || "").split(/[/>]/).map((value) => value.trim()).filter(Boolean);
  if (path.length >= 2) return path.slice(0, 2).join("-");
  if (path.length === 1) return path[0];
  return String(data.categoryName || draft.categoryId || "未选择");
}

function mainAssetIdOf(draft: ProductDraft): string {
  const imageAssets = asRecord(asRecord(draft.data).imageAssets);
  const main = Array.isArray(imageAssets.main) ? imageAssets.main : [];
  const first = asRecord(main[0]);
  return String(first.assetId || first.id || "");
}

export function ProductDraftsPage() {
  const { currentStore, session } = useAppContext();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const storeId = currentStore?.id || "";
  const queryScope = `${session.tenant.id}:${session.user.id}`;
  const businessDashboard = useBusinessDashboard(storeId);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<ProductDraft["status"] | "all">("all");
  const [workbenchOpen, setWorkbenchOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [attributeTemplateId, setAttributeTemplateId] = useState("");
  const [sizeTemplateId, setSizeTemplateId] = useState("");
  const [titleRuleTemplateId, setTitleRuleTemplateId] = useState("");
  const [packagingTemplateId, setPackagingTemplateId] = useState("");
  const [packagingMaterial, setPackagingMaterial] = useState("");
  const [tailImageTemplateId, setTailImageTemplateId] = useState("");
  const [generateSupplierCodes, setGenerateSupplierCodes] = useState(false);
  const [supplierCodePrefix, setSupplierCodePrefix] = useState("");
  const [inventoryValue, setInventoryValue] = useState("");
  const [autoMapSkuImages, setAutoMapSkuImages] = useState(false);
  const [replaceExistingTemplates, setReplaceExistingTemplates] = useState(false);
  const [preview, setPreview] = useState<BulkDraftTemplatePlan | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<{ success: string[]; failures: Array<{ id: string; message: string }> } | null>(null);
  const [publishHandoffError, setPublishHandoffError] = useState("");
  const revalidatedStoreRef = useRef("");
  const draftsQuery = useQuery({
    queryKey: ["store", queryScope, storeId, "product-drafts", "draft-box"],
    queryFn: () => api.productDrafts(storeId),
    enabled: Boolean(storeId),
    refetchOnMount: false,
  });
  useEffect(() => {
    if (!storeId || !draftsQuery.data || revalidatedStoreRef.current === storeId) return;
    revalidatedStoreRef.current = storeId;
    const draftIds = draftsQuery.data.drafts
      .filter((draft) => draft.status === "blocked")
      .slice(0, 20)
      .map((draft) => draft.id);
    if (!draftIds.length) return;
    void api.revalidateProductDrafts(storeId, draftIds)
      .then((refreshed) => {
        if (refreshed.count) {
          queryClient.invalidateQueries({ queryKey: ["store", queryScope, storeId, "product-drafts"] });
        }
      })
      .catch(() => {
        // The saved server snapshot remains visible if a background refresh fails.
      });
  }, [draftsQuery.data, queryClient, storeId]);
  const attributeTemplates = useQuery({
    queryKey: ["store", queryScope, storeId, "publish-templates", "attribute"],
    queryFn: () => api.attributeTemplates(storeId),
    enabled: Boolean(storeId && workbenchOpen),
    refetchOnMount: false,
  });
  const sizeTemplates = useQuery({
    queryKey: ["store", queryScope, storeId, "publish-templates", "size"],
    queryFn: () => api.sizeTemplates(storeId),
    enabled: Boolean(storeId && workbenchOpen),
    refetchOnMount: false,
  });
  const titleRuleTemplates = useQuery({
    queryKey: ["store", queryScope, storeId, "publish-templates", "title_rule"],
    queryFn: () => api.titleRuleTemplates(storeId),
    enabled: Boolean(storeId && workbenchOpen),
    refetchOnMount: false,
  });
  const packagingTemplates = useQuery({
    queryKey: ["store", queryScope, storeId, "publish-templates", "packaging"],
    queryFn: () => api.packagingTemplates(storeId),
    enabled: Boolean(storeId && workbenchOpen),
    refetchOnMount: false,
  });
  const tailImageTemplates = useQuery({
    queryKey: ["store", queryScope, storeId, "publish-templates", "tail_image"],
    queryFn: () => api.tailImageTemplates(storeId),
    enabled: Boolean(storeId && workbenchOpen),
    refetchOnMount: false,
  });
  const drafts = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return sortProductDraftsByActionPriority((draftsQuery.data?.drafts || []).filter((draft) => {
      if (!["draft", "blocked", "ready"].includes(draft.status)) return false;
      const matchesStatus = status === "all" || draft.status === status;
      const matchesQuery = !needle || [
        draft.name,
        draft.data.categoryName,
        draft.categoryId,
        draft.productTypeId,
      ].some((value) => String(value || "").toLocaleLowerCase().includes(needle));
      return matchesStatus && matchesQuery;
    }));
  }, [draftsQuery.data?.drafts, query, status]);
  const editableDrafts = drafts.filter((draft) => !["published", "archived"].includes(draft.status));
  const selectedDrafts = (draftsQuery.data?.drafts || []).filter((draft) => selectedIds.includes(draft.id));
  const selectedEditableDrafts = editableDrafts.filter((draft) => selectedIds.includes(draft.id));
  const mainAssetIds = useMemo(
    () => Array.from(new Set(drafts.map(mainAssetIdOf).filter(Boolean))),
    [drafts],
  );
  const thumbnailUrls = Object.fromEntries(
    mainAssetIds.map((assetId) => [assetId, api.mediaContentUrl(storeId, assetId)]),
  );
  const publishHandoff = useMemo(() => buildPublishBatchHandoff({
    drafts: draftsQuery.data?.drafts || [],
    selectedIds,
    storeId,
  }), [draftsQuery.data?.drafts, selectedIds, storeId]);
  const selectedAttributeTemplate = attributeTemplates.data?.templates.find((template) => template.id === attributeTemplateId) || null;
  const selectedSizeTemplate = sizeTemplates.data?.templates.find((template) => template.id === sizeTemplateId) || null;
  const selectedPackagingTemplate = packagingTemplates.data?.templates.find((template) => template.id === packagingTemplateId) || null;
  const packagingMaterials = Object.keys(selectedPackagingTemplate?.data.materials || {});
  const hasTemplateSelection = Boolean(
    attributeTemplateId || sizeTemplateId || titleRuleTemplateId || packagingTemplateId || tailImageTemplateId ||
    generateSupplierCodes || inventoryValue.trim() || autoMapSkuImages,
  );

  const invalidatePreview = () => {
    setPreview(null);
    setConfirmed(false);
    setResult(null);
  };
  const toggleDraft = (draftId: string) => {
    setSelectedIds((current) => current.includes(draftId)
      ? current.filter((id) => id !== draftId)
      : [...current, draftId]);
    invalidatePreview();
  };
  const loadSchemaByCategory = async (
    sourceDrafts: ProductDraft[],
  ): Promise<Record<string, BulkSchemaSnapshot>> => {
    if (!selectedAttributeTemplate && !selectedSizeTemplate) return {};
    const keys = new Map<string, { categoryId: string; productTypeId: string }>();
    for (const draft of sourceDrafts) {
      const categoryId = selectedAttributeTemplate?.categoryId || draft.categoryId;
      const productTypeId = selectedAttributeTemplate?.productTypeId || draft.productTypeId;
      if (categoryId && productTypeId) {
        keys.set(`${categoryId}:${productTypeId}`, { categoryId, productTypeId });
      }
    }
    const entries = await Promise.all([...keys.entries()].map(async ([key, category]) => {
      try {
        const schema = await api.publishSchema(storeId, category);
        return [key, { checkedAt: new Date().toISOString(), ...schema }] as const;
      } catch (error) {
        return [key, {
          checkedAt: "",
          attributes: {},
          publishStandard: {},
          error: error instanceof Error ? error.message : "SHEIN Schema 读取失败",
        }] as const;
      }
    }));
    return Object.fromEntries(entries);
  };
  const planTemplates = (
    sourceDrafts: ProductDraft[],
    schemaByCategory: Record<string, BulkSchemaSnapshot>,
    allDrafts: ProductDraft[] = draftsQuery.data?.drafts || [],
    replace = replaceExistingTemplates,
  ) => planBulkDraftTemplateApplication({
    drafts: sourceDrafts,
    attributeTemplate: selectedAttributeTemplate,
    sizeTemplate: selectedSizeTemplate,
    titleRuleTemplate: titleRuleTemplates.data?.templates.find((template) => template.id === titleRuleTemplateId) || null,
    titleRuleTemplates: titleRuleTemplates.data?.templates || [],
    businessMode: currentStore?.businessMode || "",
    packagingTemplate: selectedPackagingTemplate,
    packagingMaterial,
    tailImageTemplate: tailImageTemplates.data?.templates.find((template) => template.id === tailImageTemplateId) || null,
    schemaByCategory,
    generateSupplierCodes,
    supplierCodePrefix,
    inventoryValue,
    autoMapSkuImages,
    replaceExistingTemplates: replace,
    reservedSupplierCodes: allDrafts
      .filter((draft) => !sourceDrafts.some((source) => source.id === draft.id))
      .map((draft) => String(draft.data.supplierCode || ""))
      .filter(Boolean),
  });
  const buildPreview = async (replace = replaceExistingTemplates) => {
    setPreviewLoading(true);
    setConfirmed(false);
    setResult(null);
    setReplaceExistingTemplates(replace);
    try {
      const schemaByCategory = await loadSchemaByCategory(selectedDrafts);
      setPreview(planTemplates(selectedDrafts, schemaByCategory, undefined, replace));
    } finally {
      setPreviewLoading(false);
    }
  };
  const applyMutation = useMutation({
    mutationFn: async (plan: BulkDraftTemplatePlan) => {
      const latest = await api.productDrafts(storeId);
      const latestById = new Map(latest.drafts.map((draft) => [draft.id, draft]));
      const latestDrafts = plan.items.flatMap((item) => {
        const draft = latestById.get(item.draftId);
        return draft ? [draft] : [];
      });
      const schemaByCategory = await loadSchemaByCategory(latestDrafts);
      const refreshedPlanById = new Map(
        planTemplates(
          latestDrafts,
          schemaByCategory,
          latest.drafts,
          plan.replaceExistingTemplates,
        ).items.map((item) => [item.draftId, item]),
      );
      const success: string[] = [];
      const failures: Array<{ id: string; message: string }> = [];
      for (const item of plan.items.filter((candidate) => candidate.state === "ready" && candidate.input)) {
        const current = latestById.get(item.draftId);
        if (!current || current.updatedAt !== item.sourceUpdatedAt) {
          failures.push({ id: item.draftId, message: "预览后草稿已更新，请重新预览" });
          continue;
        }
        const refreshed = refreshedPlanById.get(item.draftId);
        if (!refreshed || refreshed.state !== "ready" || !refreshed.input) {
          failures.push({
            id: item.draftId,
            message: refreshed?.blockers[0] || "当前 SHEIN Schema 已变化，请重新预览",
          });
          continue;
        }
        try {
          await api.saveProductDraft(storeId, refreshed.input);
          success.push(item.draftId);
        } catch (error) {
          failures.push({ id: item.draftId, message: (error as Error).message });
        }
      }
      return { success, failures };
    },
    onSuccess: (nextResult) => {
      setResult(nextResult);
      setConfirmed(false);
      setSelectedIds((current) => current.filter((id) => !nextResult.success.includes(id)));
      void queryClient.invalidateQueries({ queryKey: ["store", queryScope, storeId, "product-drafts"] });
      void queryClient.invalidateQueries({ queryKey: ["store", queryScope, storeId, "workspace-usage"] });
    },
  });
  const archiveMutation = useMutation({
    mutationFn: (draftId: string) => api.archiveProductDraft(storeId, draftId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["store", queryScope, storeId, "product-drafts"] });
      void queryClient.invalidateQueries({ queryKey: ["store", queryScope, storeId, "workspace-usage"] });
    },
  });
  const archiveManyMutation = useMutation({
    mutationFn: (draftIds: string[]) => api.archiveProductDrafts(storeId, draftIds),
    onSuccess: () => {
      setSelectedIds([]);
      void queryClient.invalidateQueries({ queryKey: ["store", queryScope, storeId, "product-drafts"] });
      void queryClient.invalidateQueries({ queryKey: ["store", queryScope, storeId, "workspace-usage"] });
    },
  });
  const publishHandoffMutation = useMutation({
    mutationFn: async () => {
      const ids = Array.from(new Set(selectedIds));
      if (!ids.length) throw new Error("请先选择要进入商品审核中心的草稿");
      // The persisted status is only a cached projection. Recalculate the
      // selected drafts immediately before handoff so an editor save or a
      // rule change cannot leave the review center with a stale preflight.
      await api.revalidateProductDrafts(storeId, ids, { force: true });
      const refreshed = await draftsQuery.refetch();
      return {
        drafts: refreshed.data?.drafts || [],
        selectedIds: ids,
      };
    },
    onSuccess: ({ drafts: refreshedDrafts, selectedIds: ids }) => {
      const refreshedHandoff = buildPublishBatchHandoff({
        drafts: refreshedDrafts,
        selectedIds: ids,
        storeId,
      });
      if (!refreshedHandoff.readyDraftIds.length) {
        setPublishHandoffError("选中的草稿实时校验未通过，请打开商品查看具体阻断原因并保存后重试");
        return;
      }
      setPublishHandoffError("");
      navigate(
        `/app/operations/${encodeURIComponent(storeId)}/publishing`,
        { state: refreshedHandoff.state },
      );
    },
    onError: (error) => {
      setPublishHandoffError(error instanceof Error ? error.message : "草稿实时校验失败，请稍后重试");
    },
  });

  if (!currentStore) return null;
  const openDraft = (draftId: string, section?: ProductDraftIssueSection) => navigate(
    `/app/operations/${encodeURIComponent(storeId)}/products/new?draft=${encodeURIComponent(draftId)}${section ? `&section=${encodeURIComponent(section)}` : ""}`,
  );
  return (
    <div className="ops-page product-drafts-page">
      <OpsPageHeader
        eyebrow="商品经营"
        title="商品草稿"
        description={`${currentStore.label} · 保存后可继续编辑，通过校验后再进入商品审核中心`}
        action={(
          <div className="flex flex-wrap gap-2">
          <Button
            disabled={!selectedDrafts.some((draft) => !["published", "archived"].includes(draft.status)) || publishHandoffMutation.isPending}
            onClick={() => publishHandoffMutation.mutate()}
            variant="outline"
          >
            {publishHandoffMutation.isPending ? <LoaderCircle className="animate-spin" size={15} /> : <Send size={15} />}
            {publishHandoffMutation.isPending ? "正在校验草稿…" : "进入商品审核中心"}
            {!publishHandoffMutation.isPending && publishHandoff.readyDraftIds.length ? `（${publishHandoff.readyDraftIds.length}）` : ""}
          </Button>
          <Button onClick={() => setWorkbenchOpen((current) => !current)} variant="outline">
            <Layers3 size={15} />批量套模板{selectedIds.length ? `（${selectedIds.length}）` : ""}
          </Button>
          <Button onClick={() => navigate(`/app/operations/${encodeURIComponent(storeId)}/products/batch-new`)} variant="outline">
            <Layers3 size={15} />批量建品
          </Button>
          <Button onClick={() => navigate(`/app/operations/${encodeURIComponent(storeId)}/products/new`)}>
            <Plus size={15} />新建商品
          </Button>
          </div>
        )}
      />

      <PublishQuotaNotice
        loading={businessDashboard.isLoading}
        quota={businessDashboard.data?.snapshot?.productQuota}
      />

      {publishHandoff.selectedCount ? (
        <div className="notice notice-info mb-4" role="status">
          <ShieldCheck size={16} />
          <span>
            已选 {publishHandoff.selectedCount} 个草稿，其中 {publishHandoff.readyDraftIds.length} 个可进入商品审核中心
            {publishHandoff.rejectedCount ? `；${publishHandoff.rejectedCount} 个需先修正或完成保存` : ""}。带入选择不会创建批次或调用 SHEIN。
          </span>
        </div>
      ) : null}

      {publishHandoffError ? (
        <div className="notice notice-error mb-4" role="alert">
          <AlertCircle size={16} />
          <span>{publishHandoffError}</span>
        </div>
      ) : null}

      {workbenchOpen ? (
        <section className="data-panel mb-4">
          <header className="data-toolbar">
            <div>
              <h2>批量套模板</h2>
              <p>只选择需要更新的模板类型；再次引用会替换该类型，其他已填写内容保持不变</p>
            </div>
            <span className="status-badge"><ShieldCheck size={13} />不发布 SHEIN</span>
          </header>
          <div className="grid gap-4 p-4 lg:grid-cols-2 xl:grid-cols-3">
            <label className="field-label">商品属性
              <select className="select-field mt-1 w-full" value={attributeTemplateId} onChange={(event) => { setAttributeTemplateId(event.target.value); invalidatePreview(); }}>
                <option value="">不修改</option>
                {(attributeTemplates.data?.templates || []).map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
              </select>
            </label>
            <label className="field-label">颜色与尺寸
              <select className="select-field mt-1 w-full" value={sizeTemplateId} onChange={(event) => { setSizeTemplateId(event.target.value); invalidatePreview(); }}>
                <option value="">不修改</option>
                {(sizeTemplates.data?.templates || []).map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
              </select>
            </label>
            <label className="field-label">标题规则
              <select className="select-field mt-1 w-full" value={titleRuleTemplateId} onChange={(event) => { setTitleRuleTemplateId(event.target.value); invalidatePreview(); }}>
                <option value="">不修改</option>
                {(titleRuleTemplates.data?.templates || []).map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
              </select>
            </label>
            <label className="field-label">打包体积
              <select className="select-field mt-1 w-full" value={packagingTemplateId} onChange={(event) => { setPackagingTemplateId(event.target.value); setPackagingMaterial(""); invalidatePreview(); }}>
                <option value="">不修改</option>
                {(packagingTemplates.data?.templates || []).map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
              </select>
              {packagingTemplateId ? (
                <select aria-label="批量包装材质" className="select-field mt-2 w-full" value={packagingMaterial} onChange={(event) => { setPackagingMaterial(event.target.value); invalidatePreview(); }}>
                  <option value="">选择包装材质</option>
                  {packagingMaterials.map((material) => <option key={material} value={material}>{material}</option>)}
                </select>
              ) : null}
            </label>
            <label className="field-label">通用商品图片
              <select className="select-field mt-1 w-full" value={tailImageTemplateId} onChange={(event) => { setTailImageTemplateId(event.target.value); invalidatePreview(); }}>
                <option value="">不修改</option>
                {(tailImageTemplates.data?.templates || []).map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
              </select>
            </label>
          </div>
          <div className="grid gap-4 border-t border-[var(--line)] px-4 py-4 lg:grid-cols-3">
            <div>
              <label className="flex items-start gap-2 text-sm font-medium text-[var(--ink)]">
                <input checked={generateSupplierCodes} className="mt-0.5" onChange={(event) => { setGenerateSupplierCodes(event.target.checked); invalidatePreview(); }} type="checkbox" />
                为空草稿生成商家 SKC/SKU 货号
              </label>
              <input
                aria-label="批量商家货号前缀"
                className="field mt-2 px-3"
                disabled={!generateSupplierCodes}
                maxLength={190}
                onChange={(event) => { setSupplierCodePrefix(event.target.value); invalidatePreview(); }}
                placeholder="例如 RUG-20260822"
                value={supplierCodePrefix}
              />
              <p className="mt-1 text-[11px] leading-5 text-[var(--text-subtle)]">按当前勾选顺序生成 -001、-002；自动跳过当前店铺草稿中已使用的货号。</p>
            </div>
            <label className="field-label">统一库存（只填空值）
              <input
                className="field mt-2 px-3"
                inputMode="numeric"
                max="99999"
                min="0"
                onChange={(event) => { setInventoryValue(event.target.value); invalidatePreview(); }}
                placeholder="留空则不修改"
                type="number"
                value={inventoryValue}
              />
            </label>
            <label className="flex items-start gap-2 text-sm font-medium text-[var(--ink)]">
              <input checked={autoMapSkuImages} className="mt-0.5" onChange={(event) => { setAutoMapSkuImages(event.target.checked); invalidatePreview(); }} type="checkbox" />
              <span>按完整货号或唯一尺寸匹配候选图
                <small className="mt-1 block font-normal leading-5 text-[var(--text-subtle)]">一张候选图供全部 SKU 共用；多张必须全部精确匹配，不按上传顺序分配。</small>
              </span>
            </label>
          </div>
          <div className="notice notice-info mx-4 mb-4">
            商品属性和颜色尺寸只填充对应空草稿；需要替换已引用模板时，请使用“重新引用（替换）”。两种预览和确认执行时都会重新读取当前 SHEIN Schema；货号、价格、库存、包装或预览图不会被普通套用覆盖。固定发布默认值由系统统一处理，合规模块保持冻结。
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-[var(--line)] p-4">
            <Button disabled={!selectedIds.length || !hasTemplateSelection || previewLoading} onClick={() => void buildPreview()} variant="outline">
              {previewLoading ? <LoaderCircle className="animate-spin" size={15} /> : null}预览批量套用
            </Button>
            <Button
              disabled={!selectedIds.length || !hasTemplateSelection || previewLoading}
              onClick={() => void buildPreview(true)}
              variant="danger"
            >
              {previewLoading && replaceExistingTemplates ? <LoaderCircle className="animate-spin" size={15} /> : null}
              重新引用（替换）
            </Button>
            <span className="text-xs text-[var(--text-subtle)]">已选择 {selectedIds.length} 个草稿</span>
          </div>
          {preview ? (
            <div className="border-t border-[var(--line)] p-4">
              <div className="mb-3 flex flex-wrap gap-3 text-sm">
                <strong>可更新 {preview.readyCount}</strong>
                <span className="text-[var(--danger)]">阻断 {preview.blockedCount}</span>
                <span className="text-[var(--text-muted)]">无需修改 {preview.skippedCount}</span>
              </div>
              <div className="space-y-2">
                {preview.items.map((item) => (
                  <div className={`rounded-lg border p-3 text-sm ${item.state === "blocked" ? "border-red-200 bg-red-50" : "border-[var(--line)]"}`} key={item.draftId}>
                    <strong>{item.name}</strong>
                    <p className="mt-1 text-xs text-[var(--text-muted)]">
                      {item.blockers.length ? item.blockers.join("；") : item.changes.length ? `将修改：${item.changes.join("、")}` : "模板已应用，无需重复修改"}
                    </p>
                  </div>
                ))}
              </div>
              {preview.readyCount ? (
                <div className="mt-4 rounded-lg border border-[var(--line)] p-3">
                  <label className="flex items-start gap-2 text-sm font-medium text-[var(--ink)]">
                    <input checked={confirmed} className="mt-0.5" onChange={(event) => setConfirmed(event.target.checked)} type="checkbox" />
                    我确认只修改商品草稿，不发布 SHEIN{preview.replaceExistingTemplates ? "，并替换本次选择的模板字段" : ""}
                  </label>
                  <Button className="mt-3" disabled={!confirmed || applyMutation.isPending} onClick={() => applyMutation.mutate(preview)}>
                    {applyMutation.isPending ? <LoaderCircle className="animate-spin" size={15} /> : <ShieldCheck size={15} />}
                    {preview.replaceExistingTemplates ? "确认重新引用" : "确认更新"} {preview.readyCount} 个商品草稿
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
          {result ? (
            <div className={`notice mx-4 mb-4 ${result.failures.length ? "notice-danger" : "notice-success"}`} role="status">
              {result.failures.length ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
              <span>成功 {result.success.length} 个，失败 {result.failures.length} 个{result.failures.length ? `：${result.failures.map((item) => item.message).join("；")}` : ""}</span>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="data-panel">
        <header className="data-toolbar">
          <div>
            <h2>待发布商品</h2>
            <p>共 {drafts.length} / {draftsQuery.data?.count || 0} 个结果</p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <label className="search-field sm:w-64">
              <Search size={15} />
              <input aria-label="搜索商品草稿" onChange={(event) => setQuery(event.target.value)} placeholder="搜索草稿名、类目或 ID" value={query} />
            </label>
            <select aria-label="筛选草稿状态" className="select-field" onChange={(event) => setStatus(event.target.value as ProductDraft["status"] | "all")} value={status}>
              <option value="all">全部状态</option>
              <option value="blocked">待修正</option>
              <option value="draft">草稿</option>
              <option value="ready">可预检</option>
            </select>
            {selectedEditableDrafts.length ? (
              <Button
                disabled={archiveManyMutation.isPending}
                onClick={() => {
                  if (window.confirm(`确认删除选中的 ${selectedEditableDrafts.length} 个商品草稿吗？删除后将不再显示在草稿箱中。`)) {
                    archiveManyMutation.mutate(selectedEditableDrafts.map((draft) => draft.id));
                  }
                }}
                size="sm"
                variant="ghost"
              >
                <Trash2 size={14} />批量删除（{selectedEditableDrafts.length}）
              </Button>
            ) : null}
          </div>
        </header>

        {draftsQuery.isLoading ? (
          <div className="grid min-h-64 place-items-center text-[var(--text-muted)]"><LoaderCircle className="animate-spin" size={20} /></div>
        ) : draftsQuery.error ? (
          <div className="notice notice-danger m-4" role="alert"><AlertCircle size={16} /><span>{(draftsQuery.error as Error).message}</span></div>
        ) : drafts.length ? (
          <div className="table-scroll">
            <table className="operations-table">
              <thead><tr><th><input aria-label="选择当前结果中的可编辑草稿" checked={Boolean(editableDrafts.length) && editableDrafts.every((draft) => selectedIds.includes(draft.id))} onChange={(event) => { setSelectedIds(event.target.checked ? editableDrafts.map((draft) => draft.id) : []); invalidatePreview(); }} type="checkbox" /></th><th>主图</th><th>草稿名称</th><th>状态</th><th>待处理分组</th><th>SKU</th><th>更新时间</th><th>操作</th></tr></thead>
              <tbody>
                {drafts.map((draft) => {
                  const rows = Array.isArray(draft.data.skuRows) ? draft.data.skuRows : [];
                  const issues = collectProductDraftIssues(draft);
                  return (
                    <tr key={draft.id}>
                      <td><input aria-label={`选择草稿 ${draft.name}`} checked={selectedIds.includes(draft.id)} disabled={["published", "archived"].includes(draft.status)} onChange={() => toggleDraft(draft.id)} type="checkbox" /></td>
                      <td>
                        {thumbnailUrls[mainAssetIdOf(draft)] ? (
                          <img alt={`${draft.name} 主图`} className="h-12 w-12 rounded-md border border-[var(--line)] object-cover" decoding="async" loading="lazy" src={thumbnailUrls[mainAssetIdOf(draft)]} />
                        ) : (
                          <div aria-label="暂无主图" className="grid h-12 w-12 place-items-center rounded-md border border-dashed border-[var(--line)] text-[var(--text-subtle)]"><ImageIcon size={17} /></div>
                        )}
                      </td>
                      <td>
                        <strong className="block max-w-[360px] truncate text-sm font-medium text-[var(--ink)]">{draft.name}</strong>
                        <small className="mt-1 block text-[11px] text-[var(--text-subtle)]">类目：{categoryLabelOf(draft)}</small>
                        <small className="mt-1 block font-mono text-[11px] text-[var(--text-subtle)]">{draft.id}</small>
                      </td>
                      <td>
                        <span className={`status-badge ${draft.status === "blocked" ? "!text-[var(--danger)]" : draft.status === "ready" ? "!text-[var(--success)]" : ""}`}>
                          {draft.status === "ready" ? <CheckCircle2 size={13} /> : null}
                          {statusLabels[draft.status]}{issues.total ? ` · ${issues.total}项` : ""}
                        </span>
                      </td>
                      <td>
                        {issues.total ? (
                          <div className="max-w-[300px]">
                            <div className="flex flex-wrap gap-1">
                              {issues.groups.filter((group) => group.count).map((group) => (
                                <span className="rounded bg-[var(--danger-soft)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--danger)]" key={group.key}>
                                  {group.label} {group.count}
                                </span>
                              ))}
                            </div>
                            <p className="mt-1.5 truncate text-xs text-[var(--danger)]" title={issues.firstIssue?.message}>
                              {issues.firstIssue?.message}
                            </p>
                          </div>
                        ) : <span className="text-xs text-[var(--text-subtle)]">无阻断</span>}
                      </td>
                      <td>{rows.length}</td>
                      <td>{formatTime(draft.updatedAt)}</td>
                      <td>
                        <div className="flex flex-wrap gap-1.5">
                          {issues.firstIssue ? (
                            <Button onClick={() => openDraft(draft.id, issues.firstIssue!.section)} size="sm">
                              <AlertCircle size={14} />处理首个问题
                            </Button>
                          ) : null}
                          <Button onClick={() => openDraft(draft.id)} size="sm" variant="outline">
                            <FilePenLine size={14} />继续编辑<ChevronRight size={14} />
                          </Button>
                          {draft.status === "ready" ? (
                            <Button
                              onClick={() => navigate(
                                `/app/operations/${encodeURIComponent(storeId)}/publishing`,
                                { state: buildPublishBatchHandoff({ drafts: [draft], selectedIds: [draft.id], storeId }).state },
                              )}
                              size="sm"
                            >
                              <Send size={14} />发布
                            </Button>
                          ) : null}
                          {!['published', 'archived'].includes(draft.status) ? (
                            <Button
                              disabled={archiveMutation.isPending}
                              onClick={() => {
                                if (window.confirm(`确认删除“${draft.name}”吗？删除后将不再显示在草稿箱中。`)) {
                                  archiveMutation.mutate(draft.id);
                                }
                              }}
                              size="sm"
                              variant="ghost"
                            >
                              <Trash2 size={14} />删除
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="grid min-h-64 place-items-center px-6 text-center">
            <div><FilePenLine className="mx-auto text-[var(--text-subtle)]" size={24} /><p className="mt-3 text-sm font-medium text-[var(--ink)]">{draftsQuery.data?.count ? "没有匹配的商品草稿" : "还没有商品草稿"}</p><p className="mt-1 text-xs text-[var(--text-subtle)]">新建商品并保存后会显示在这里</p></div>
          </div>
        )}
      </section>
    </div>
  );
}
