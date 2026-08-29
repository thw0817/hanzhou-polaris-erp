import { Fragment, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { DndContext, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, rectSortingStrategy, SortableContext, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  AlertCircle,
  Check,
  ChevronDown,
  FolderOpen,
  GripVertical,
  ImageIcon,
  LoaderCircle,
  Save,
  Send,
  Sparkles,
  Trash2,
  Upload,
  X,
  ZoomIn,
} from "lucide-react";
import { useNavigate } from "react-router";
import { useAppContext } from "../../app/AppShell";
import { Button } from "../../components/ui/button";
import { ApiError, api, type MediaAsset, type ProductDraft } from "../../lib/api";
import {
  applyBatchAttributeTemplate,
  applyBatchSkuSettings,
  buildBatchDraftName,
  buildBatchSkuStage,
  buildDefaultBatchSupplierCode,
  mapBatchSkuPreviews,
  reorderBatchImages,
  summarizeBatchProduct,
} from "../../lib/batch-product-create-contract.js";
import type { BatchSkuRow } from "../../lib/batch-product-create-contract.js";
import { buildProductFolderImportGroups } from "../../lib/product-folder-import-contract.js";
import { orderedTailTemplateImages } from "../../lib/product-image-contract.js";
import { applyWatermarkToFile, DEFAULT_WATERMARK_OPTIONS, normalizeWatermarkOptions } from "../../lib/product-image-watermark.js";
import { compressProductImage } from "../../lib/product-image-compress.js";
import { applyTitleRule } from "../../lib/title-rule-template-contract.js";
import {
  buildAiTitleRequest,
  composeAiTitle,
} from "../../lib/ai-title-contract.js";
import type { TitleRuleTemplate } from "../../lib/api";
import { buildAttributeFields, type AttributeField } from "../../lib/attribute-template-contract.js";
import {
  applySupplierSkuPrefix,
  buildSaleAttributeSchema,
  ensureSupplierSkuRows,
  reconcileSkuSizeMappings,
  type SaleValueMapping,
} from "../../lib/product-sku-contract.js";
import { DEFAULT_PRODUCT_PUBLISH_SETTINGS } from "../../lib/product-publish-settings-contract.js";
import { PublishQuotaNotice } from "../operations/OperationsShared";
import { useBusinessDashboard } from "../operations/use-business-dashboard";

type BatchEntry = {
  id: string;
  file: File;
  path: string;
  slot: "main" | "carousel" | "sku";
  previewUrl: string;
  width: number;
  height: number;
};

type BatchGroup = {
  id: string;
  name: string;
  title: string;
  supplierCode: string;
  entries: BatchEntry[];
  skuRows: BatchSkuRow[];
  attributeValues: Record<string, unknown>;
  colorMapping: SaleValueMapping | null;
  tailAssetOrder: string[];
  savedDraftId?: string;
  savedStatus?: ProductDraft["status"];
  titleRuleBaseTitle?: string;
  aiPatternName?: string;
  dirty: boolean;
};

type AttributeValue = { valueIds?: string[]; customValue?: string };
type BatchFeedback = { tone: "info" | "success" | "danger"; message: string };

function SortableImageCard({ id, children }: { id: string; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <article
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={isDragging ? "cursor-grabbing rounded border border-[var(--focus)] bg-white p-2 shadow-md" : "cursor-grab rounded border border-emerald-200 bg-white p-2 active:cursor-grabbing"}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      {children}
    </article>
  );
}

function SortableImageStrip<T extends { id: string }>({
  items,
  onChange,
  renderItem,
}: {
  items: T[];
  onChange: (items: T[]) => void;
  renderItem: (item: T, index: number) => ReactNode;
}) {
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = items.findIndex((item) => item.id === String(active.id));
    const to = items.findIndex((item) => item.id === String(over.id));
    if (from >= 0 && to >= 0) onChange(arrayMove(items, from, to));
  };
  return (
    <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={items.map((item) => item.id)} strategy={rectSortingStrategy}>
        <div className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2">
          {items.map((item, index) => <SortableImageCard id={item.id} key={item.id}>{renderItem(item, index)}</SortableImageCard>)}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function readDimensions(file: File) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`${file.name}：无法读取图片尺寸`));
    };
    image.src = url;
  });
}

async function centerCropSquare(file: File) {
  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error(`${file.name}：无法读取图片`));
      image.src = sourceUrl;
    });
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 1200;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前浏览器不支持方块图裁剪");
    context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, 1200, 1200);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => value ? resolve(value) : reject(new Error("方块图生成失败")), "image/jpeg", 0.92);
    });
    return new File([blob], `${file.name.replace(/\.[^.]+$/, "")}-square.jpg`, { type: "image/jpeg", lastModified: Date.now() });
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

function assetData(asset: MediaAsset) {
  return {
    assetId: asset.id,
    originalName: asset.originalName,
    contentType: asset.contentType,
    sizeBytes: asset.sizeBytes,
    width: asset.width,
    height: asset.height,
  };
}

function slotLabel(slot: BatchEntry["slot"]) {
  return slot === "main" ? "商品主图" : slot === "carousel" ? "通用轮播图" : "SKU预览图";
}

const WATERMARK_STORAGE_KEY = "shein-product-watermark-options-v1";
// Keep browser-side upload fan-out bounded so a large batch is faster without
// opening an unbounded number of object-storage requests at once.
const SAVE_GROUP_CONCURRENCY = 3;

function loadSavedWatermarkOptions() {
  try {
    const saved = window.localStorage.getItem(WATERMARK_STORAGE_KEY);
    return saved ? normalizeWatermarkOptions(JSON.parse(saved)) : DEFAULT_WATERMARK_OPTIONS;
  } catch {
    return DEFAULT_WATERMARK_OPTIONS;
  }
}

function categoryPathText(template: unknown) {
  const data = template && typeof template === "object" && "data" in template
    ? (template as { data?: Record<string, unknown> }).data || {}
    : {};
  const path = Array.isArray(data.categoryPath) ? data.categoryPath.map(String).filter(Boolean) : [];
  return path.length ? path.join("-") : String(data.categoryName || "");
}

function templateAssetData(asset: {
  id?: string;
  assetId?: string;
  originalName?: string;
  contentType?: string;
  width?: number | null;
  height?: number | null;
  sizeBytes?: number;
}) {
  return {
    assetId: String(asset.assetId || asset.id || ""),
    originalName: String(asset.originalName || ""),
    contentType: String(asset.contentType || "image/jpeg"),
    sizeBytes: Number(asset.sizeBytes || 0),
    width: asset.width ?? null,
    height: asset.height ?? null,
  };
}

function tailAssetId(asset: { id?: string; assetId?: string }) {
  return String(asset.assetId || asset.id || "");
}

function attributeValueText(field: AttributeField, value: AttributeValue) {
  const labels = (value.valueIds || []).map((valueId) =>
    field.values.find((option) => option.id === String(valueId))?.label || String(valueId)
  );
  const customValue = String(value.customValue || "").trim();
  return [...labels, ...(customValue ? [customValue] : [])].join("、") || "未填写";
}

export function BatchProductCreatePage() {
  const { currentStore, session } = useAppContext();
  const navigate = useNavigate();
  const storeId = currentStore?.id || "";
  const queryScope = `${session.tenant.id}:${session.user.id}`;
  const businessDashboard = useBusinessDashboard(storeId);
  const inputRef = useRef<HTMLInputElement>(null);
  const [groups, setGroups] = useState<BatchGroup[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editorGroupId, setEditorGroupId] = useState<string | null>(null);
  const [editorTab, setEditorTab] = useState<"attributes" | "sku">("attributes");
  const [skuPickerRowId, setSkuPickerRowId] = useState<string | null>(null);
  const [zoomEntry, setZoomEntry] = useState<BatchEntry | null>(null);
  const [tailPreviewUrls, setTailPreviewUrls] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<BatchFeedback | null>(null);
  const [aiTitleGenerating, setAiTitleGenerating] = useState(false);
  const [aiTitleProgress, setAiTitleProgress] = useState({ done: 0, total: 0 });
  const [attributeTemplateId, setAttributeTemplateId] = useState("");
  const [titleRuleTemplateId, setTitleRuleTemplateId] = useState("");
  const [sizeTemplateId, setSizeTemplateId] = useState("");
  const [packagingTemplateId, setPackagingTemplateId] = useState("");
  const [packagingMaterial, setPackagingMaterial] = useState("");
  const [pricePerSquareMeter, setPricePerSquareMeter] = useState("");
  const [gramsPerSquareMeter, setGramsPerSquareMeter] = useState("");
  const [inventory, setInventory] = useState("1000");
  const [previewMode, setPreviewMode] = useState<"none" | "carousel" | "main">("none");
  const [tailImageTemplateId, setTailImageTemplateId] = useState("");
  const [watermark, setWatermark] = useState(loadSavedWatermarkOptions);
  const [watermarkExpanded, setWatermarkExpanded] = useState(false);
  const [watermarking, setWatermarking] = useState(false);
  const uploadedAssetCacheRef = useRef(new Map<string, { file: File; asset: MediaAsset }>());
  const squareAssetCacheRef = useRef(new Map<string, { sourceFile: File; asset: MediaAsset }>());

  const templatesEnabled = Boolean(storeId);
  const attributeTemplates = useQuery({
    queryKey: ["store", queryScope, storeId, "publish-templates", "attribute"],
    queryFn: () => api.attributeTemplates(storeId),
    enabled: templatesEnabled,
    refetchOnMount: false,
  });
  const titleRuleTemplates = useQuery({
    queryKey: ["store", queryScope, storeId, "publish-templates", "title_rule"],
    queryFn: () => api.titleRuleTemplates(storeId),
    enabled: templatesEnabled,
    refetchOnMount: false,
  });
  const aiTitleCapability = useQuery({
    queryKey: ["store", queryScope, storeId, "ai-title-capability"],
    queryFn: () => api.aiTitleCapability(storeId),
    enabled: templatesEnabled,
    refetchOnMount: false,
    staleTime: 60_000,
  });
  const sizeTemplates = useQuery({
    queryKey: ["store", queryScope, storeId, "publish-templates", "size"],
    queryFn: () => api.sizeTemplates(storeId),
    enabled: templatesEnabled,
    refetchOnMount: false,
  });
  const packagingTemplates = useQuery({
    queryKey: ["store", queryScope, storeId, "publish-templates", "packaging"],
    queryFn: () => api.packagingTemplates(storeId),
    enabled: templatesEnabled,
    refetchOnMount: false,
  });
  const tailImageTemplates = useQuery({
    queryKey: ["store", queryScope, storeId, "publish-templates", "tail_image"],
    queryFn: () => api.tailImageTemplates(storeId),
    enabled: templatesEnabled,
    refetchOnMount: false,
  });

  const selectedAttributeTemplate = attributeTemplates.data?.templates.find((item) => item.id === attributeTemplateId) || null;
  const selectedTitleRuleTemplate = titleRuleTemplates.data?.templates.find((item) => item.id === titleRuleTemplateId) || null;
  const selectedSizeTemplate = sizeTemplates.data?.templates.find((item) => item.id === sizeTemplateId) || null;
  const selectedPackagingTemplate = packagingTemplates.data?.templates.find((item) => item.id === packagingTemplateId) || null;
  const selectedCategoryId = String(selectedAttributeTemplate?.categoryId || selectedSizeTemplate?.categoryId || "");
  const selectedProductTypeId = String(selectedAttributeTemplate?.productTypeId || selectedSizeTemplate?.productTypeId || "");
  const publishSchema = useQuery({
    queryKey: ["store", queryScope, storeId, "publish-schema", selectedCategoryId, selectedProductTypeId],
    queryFn: () => api.publishSchema(storeId, {
      categoryId: selectedCategoryId,
      productTypeId: selectedProductTypeId,
    }),
    enabled: Boolean(storeId && selectedCategoryId && selectedProductTypeId),
    refetchOnMount: false,
  });
  const returnedTitleMaxLength = Number(
    publishSchema.data?.publishStandard?.default_language_title_max_length,
  );
  const officialTitleMaxLength = Number.isInteger(returnedTitleMaxLength) && returnedTitleMaxLength >= 2 && returnedTitleMaxLength <= 1000
    ? returnedTitleMaxLength
    : null;
  const packagingMaterials = Object.keys(selectedPackagingTemplate?.data.materials || {});
  const selectedCount = selectedIds.length;
  const selectedGroups = useMemo(() => groups.filter((group) => selectedIds.includes(group.id)), [groups, selectedIds]);
  const selectedTailImageTemplate = tailImageTemplates.data?.templates.find((item) => item.id === tailImageTemplateId) || null;
  const selectedTailAssets = useMemo(
    () => orderedTailTemplateImages(selectedTailImageTemplate) as Array<{
      id?: string;
      assetId?: string;
      originalName?: string;
      contentType?: string;
      width?: number | null;
      height?: number | null;
      sizeBytes?: number;
    }>,
    [selectedTailImageTemplate],
  );
  const selectedTailAssetIds = useMemo(
    () => selectedTailAssets.map(tailAssetId).filter(Boolean),
    [selectedTailAssets],
  );
  const editorGroup = groups.find((group) => group.id === editorGroupId) || null;
  const attributeFields = useMemo(
    () => publishSchema.data && selectedProductTypeId
      ? buildAttributeFields(publishSchema.data.attributes, selectedProductTypeId)
      : [],
    [publishSchema.data, selectedProductTypeId],
  );
  const saleSchema = useMemo(
    () => buildSaleAttributeSchema(
      publishSchema.data?.attributes || {},
      selectedProductTypeId,
      publishSchema.data?.customAttributePermissions,
    ),
    [publishSchema.data, selectedProductTypeId],
  );

  useEffect(() => {
    try {
      window.localStorage.setItem(WATERMARK_STORAGE_KEY, JSON.stringify(normalizeWatermarkOptions(watermark)));
    } catch {
      // Private browsing or a restricted storage policy must not block batch creation.
    }
  }, [watermark]);

  useEffect(() => {
    setTailPreviewUrls({});
    if (!selectedTailImageTemplate || !selectedTailAssets.length) return;
    setTailPreviewUrls(Object.fromEntries(selectedTailAssets.map((asset) => {
      const assetId = tailAssetId(asset);
      return [assetId, api.tailImagePreviewUrl(storeId, selectedTailImageTemplate.id, assetId)];
    })));
  }, [selectedTailImageTemplate, selectedTailAssets, storeId]);

  useEffect(() => {
    setGroups((current) => current.map((group) => {
      const nextOrder = [
        ...group.tailAssetOrder.filter((assetId) => selectedTailAssetIds.includes(assetId)),
        ...selectedTailAssetIds.filter((assetId) => !group.tailAssetOrder.includes(assetId)),
      ];
      return nextOrder.join("|") === group.tailAssetOrder.join("|")
        ? group
        : { ...group, tailAssetOrder: nextOrder, dirty: true };
    }));
  }, [selectedTailAssetIds]);

  const chooseFolder = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) return;
    setParsing(true);
    setFeedback(null);
    try {
      const parsed = buildProductFolderImportGroups(files);
      const nextGroups = await Promise.all(parsed.groups.map(async (group, groupIndex) => {
        const entries = await Promise.all(group.files.map(async (entry) => ({
          id: entry.id,
          file: entry.file,
          path: entry.path,
          slot: (entry.suggestedSlot === "detail" ? "carousel" : entry.suggestedSlot === "sku" ? "sku" : "main") as BatchEntry["slot"],
          previewUrl: URL.createObjectURL(entry.file),
          ...(await readDimensions(entry.file)),
        })));
        const skuStage = selectedSizeTemplate
          ? buildBatchSkuStage(selectedSizeTemplate, group.id, saleSchema)
          : { colorMapping: null, rows: [] };
        return {
          id: group.id,
          name: group.name,
          title: group.name,
          supplierCode: buildDefaultBatchSupplierCode(groupIndex),
          entries,
          skuRows: skuStage.rows,
          colorMapping: skuStage.colorMapping,
          attributeValues: applyBatchAttributeTemplate(selectedAttributeTemplate),
          tailAssetOrder: selectedTailAssetIds,
          dirty: true,
        } satisfies BatchGroup;
      }));
      setGroups(nextGroups);
      setSelectedIds(nextGroups.map((group) => group.id));
      setFeedback({ tone: "success", message: `已解析 ${nextGroups.length} 个商品文件夹，共 ${nextGroups.reduce((sum, group) => sum + group.entries.length, 0)} 张图片。未标记用途的图片默认作为商品主图。${parsed.ignoredCount ? ` 已忽略 ${parsed.ignoredCount} 个非 JPG/PNG 文件。` : ""}` });
    } catch (error) {
      setFeedback({ tone: "danger", message: error instanceof Error ? error.message : "商品文件夹解析失败" });
    } finally {
      setParsing(false);
    }
  };

  const updateGroup = (groupId: string, update: Partial<BatchGroup>) => {
    setGroups((current) => current.map((group) => group.id === groupId ? { ...group, ...update, dirty: true } : group));
  };

  const applySettings = () => {
    if (!selectedGroups.length) return;
    setGroups((current) => current.map((group) => {
      if (!selectedIds.includes(group.id)) return group;
      const carousel = group.entries.filter((entry) => entry.slot === "carousel");
      const main = group.entries.filter((entry) => entry.slot === "main");
      const skuStage = selectedSizeTemplate
        ? buildBatchSkuStage(selectedSizeTemplate, group.id, saleSchema)
        : { colorMapping: group.colorMapping, rows: group.skuRows };
      let rows = skuStage.rows;
      rows = applyBatchSkuSettings(rows, {
        pricePerSquareMeter,
        gramsPerSquareMeter,
        packagingTemplate: selectedPackagingTemplate,
        packagingMaterial,
        inventory,
      });
      rows = mapBatchSkuPreviews(rows, previewMode === "carousel" ? carousel : main, previewMode);
      return {
        ...group,
        title: selectedTitleRuleTemplate
          ? group.aiPatternName
            ? composeAiTitle({
                rule: selectedTitleRuleTemplate.data,
                patternName: group.aiPatternName,
                maxLength: officialTitleMaxLength || 250,
              }).title
            : applyTitleRule(group.title, selectedTitleRuleTemplate.data)
          : group.title,
        titleRuleBaseTitle: selectedTitleRuleTemplate
          ? group.aiPatternName || group.titleRuleBaseTitle || group.title
          : group.titleRuleBaseTitle,
        attributeValues: applyBatchAttributeTemplate(selectedAttributeTemplate),
        skuRows: rows,
        colorMapping: skuStage.colorMapping,
        dirty: true,
      };
    }));
    setFeedback({ tone: "success", message: `已把商品模板和 SKU 参数应用到 ${selectedCount} 个商品。` });
  };

  const ensureAiMainAsset = async (group: BatchGroup) => {
    const entry = group.entries.find((item) => item.slot === "main")
      || group.entries.find((item) => item.slot !== "sku");
    if (!entry) throw new Error(`${group.name} 没有可用于识别的商品主图`);
    const cacheKey = `${group.id}:${entry.id}`;
    const cached = uploadedAssetCacheRef.current.get(cacheKey);
    if (cached?.file === entry.file) return cached.asset.id;
    const compressed = await compressProductImage(entry.file);
    const uploaded = await api.uploadProductImage(storeId, compressed.file, {
      width: entry.width,
      height: entry.height,
    });
    uploadedAssetCacheRef.current.set(cacheKey, { file: entry.file, asset: uploaded.asset });
    return uploaded.asset.id;
  };

  const generateBatchAiTitles = async () => {
    if (aiTitleGenerating || !selectedGroups.length) return;
    if (!selectedTitleRuleTemplate) {
      setFeedback({ tone: "danger", message: "请先选择商品标题模板，再使用 AI 识别图案" });
      return;
    }
    setAiTitleGenerating(true);
    setAiTitleProgress({ done: 0, total: selectedGroups.length });
    setFeedback(null);
    try {
      const outcomes: Array<{
        groupId: string;
        generated?: { title: string; titleRuleBaseTitle: string; aiPatternName: string };
        error?: unknown;
      }> = new Array(selectedGroups.length);
      let nextIndex = 0;
      const runWorker = async () => {
        while (true) {
          const index = nextIndex;
          nextIndex += 1;
          if (index >= selectedGroups.length) return;
          const group = selectedGroups[index];
          try {
          const mainImageAssetId = await ensureAiMainAsset(group);
          const request = buildAiTitleRequest({
            mainImageAssetId,
            titleRuleTemplateId,
            titleRule: selectedTitleRuleTemplate.data,
            currentTitle: group.title,
            titleMaxLength: officialTitleMaxLength || 250,
          });
          if (!request.valid) throw new Error(request.error || "AI 标题输入不完整");
          const result = await api.suggestAiTitle(storeId, request.input);
          const composed = composeAiTitle({
            rule: selectedTitleRuleTemplate.data,
            patternName: result.patternName,
            maxLength: officialTitleMaxLength || 250,
          });
          if (!composed.valid) throw new Error("AI 返回的图案名称无法组成有效标题");
            outcomes[index] = {
              groupId: group.id,
              generated: {
                title: composed.title,
                titleRuleBaseTitle: composed.patternName,
                aiPatternName: composed.patternName,
              },
            };
          } catch (error) {
            outcomes[index] = { groupId: group.id, error };
          } finally {
            setAiTitleProgress((current) => ({ ...current, done: current.done + 1 }));
          }
        }
      };
      const workerCount = Math.min(2, selectedGroups.length);
      await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

      const generated = new Map<string, { title: string; titleRuleBaseTitle: string; aiPatternName: string }>();
      const failureDetails: string[] = [];
      let failed = 0;
      outcomes.forEach((outcome) => {
        if (outcome.generated) {
          generated.set(outcome.groupId, outcome.generated);
          return;
        }
        failed += 1;
        if (failureDetails.length < 3) {
          const error = outcome.error;
          const detail = error instanceof ApiError
            ? `${error.code}${error.traceId ? `（Trace ${error.traceId}）` : ""}：${error.message}`
            : error instanceof Error ? error.message : "未知错误";
          failureDetails.push(detail);
        }
      });
      if (generated.size) {
        setGroups((current) => current.map((group) => {
          const next = generated.get(group.id);
          return next ? { ...group, ...next, dirty: true } : group;
        }));
      }
      setFeedback({
        tone: generated.size ? (failed ? "info" : "success") : "danger",
        message: generated.size
          ? `已为 ${generated.size} 个商品按模板替换生成 AI 标题${failed ? `，${failed} 个商品识别失败：${failureDetails.join("；")}` : ""}。`
          : `AI 标题生成失败${failureDetails.length ? `：${failureDetails.join("；")}` : "，请确认主图、标题模板和授权配置"}`,
      });
    } finally {
      setAiTitleGenerating(false);
    }
  };

  const updateEntrySlot = (groupId: string, entryId: string, slot: BatchEntry["slot"]) => {
    setGroups((current) => current.map((group) => group.id !== groupId ? group : {
      ...group,
      entries: group.entries.map((entry) => entry.id === entryId ? { ...entry, slot } : entry),
      dirty: true,
    }));
  };

  const removeEntry = (groupId: string, entryId: string) => {
    const removed = groups.find((group) => group.id === groupId)?.entries.find((entry) => entry.id === entryId);
    setGroups((current) => current.map((group) => group.id !== groupId ? group : {
      ...group,
      entries: group.entries.filter((entry) => entry.id !== entryId),
      skuRows: group.skuRows.map((row) => row.imageAssetId === entryId
        ? { ...row, imageAssetId: "", imageAssetSource: "" }
        : row),
      dirty: true,
    }));
    if (removed?.previewUrl.startsWith("blob:")) URL.revokeObjectURL(removed.previewUrl);
    setFeedback({ tone: "success", message: `已移除图片：${removed?.file.name || "图片"}` });
  };

  const updateSkuRow = (groupId: string, rowId: unknown, update: Partial<BatchSkuRow>) => {
    setGroups((current) => current.map((group) => group.id !== groupId ? group : {
      ...group,
      skuRows: group.skuRows.map((row) => String(row.id) === String(rowId) ? { ...row, ...update } : row),
      dirty: true,
    }));
  };

  const openEditor = (groupId: string) => {
    setEditorGroupId(groupId);
    setEditorTab("attributes");
    setSkuPickerRowId(null);
    setZoomEntry(null);
  };

  const closeEditor = () => {
    setEditorGroupId(null);
    setSkuPickerRowId(null);
    setZoomEntry(null);
  };

  const moveEntry = (groupId: string, activeId: string, overId: string) => {
    setGroups((current) => current.map((group) => group.id === groupId
      ? { ...group, entries: reorderBatchImages(group.entries, activeId, overId), dirty: true }
      : group));
  };

  const moveTailAsset = (groupId: string, activeId: string, overId: string) => {
    setGroups((current) => current.map((group) => group.id === groupId
      ? {
          ...group,
          tailAssetOrder: reorderBatchImages(
            group.tailAssetOrder.map((id) => ({ id })),
            activeId,
            overId,
          ).map((item) => String(item.id)),
          dirty: true,
        }
      : group));
  };

  const startImageDrag = (event: DragEvent<HTMLElement>, kind: "entry" | "tail", groupId: string, imageId: string) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-shein-batch-image", JSON.stringify({ kind, groupId, imageId }));
  };

  const dropImage = (event: DragEvent<HTMLElement>, kind: "entry" | "tail", groupId: string, overId: string) => {
    event.preventDefault();
    try {
      const value = JSON.parse(event.dataTransfer.getData("application/x-shein-batch-image")) as {
        kind?: string;
        groupId?: string;
        imageId?: string;
      };
      if (value.kind !== kind || value.groupId !== groupId || !value.imageId) return;
      if (kind === "entry") moveEntry(groupId, value.imageId, overId);
      else moveTailAsset(groupId, value.imageId, overId);
    } catch {
      // Ignore drags from outside the batch image panel.
    }
  };

  const applyWatermarkToSelected = async () => {
    if (!selectedGroups.length) {
      setFeedback({ tone: "danger", message: "请先选择需要处理的商品。" });
      return;
    }
    if (!watermark.text.trim()) {
      setFeedback({ tone: "danger", message: "请先填写水印内容。" });
      return;
    }
    setWatermarking(true);
    setFeedback(null);
    try {
      const options = normalizeWatermarkOptions(watermark);
      const changed = new Map<string, BatchEntry[]>();
      for (const group of selectedGroups) {
        const entries: BatchEntry[] = [];
        for (const entry of group.entries) {
          if (entry.slot !== "main") {
            entries.push(entry);
            continue;
          }
          const file = await applyWatermarkToFile(entry.file, options);
          if (entry.previewUrl.startsWith("blob:")) URL.revokeObjectURL(entry.previewUrl);
          entries.push({
            ...entry,
            file,
            previewUrl: URL.createObjectURL(file),
            ...(await readDimensions(file)),
          });
        }
        changed.set(group.id, entries);
      }
      setGroups((current) => current.map((group) => {
        const entries = changed.get(group.id);
        return entries ? { ...group, entries, dirty: true } : group;
      }));
      setFeedback({ tone: "success", message: `已将水印应用到 ${selectedGroups.length} 个商品的主图；保存时不会重复叠加。` });
    } catch (error) {
      setFeedback({ tone: "danger", message: error instanceof Error ? error.message : "水印生成失败" });
    } finally {
      setWatermarking(false);
    }
  };

  const saveGroup = async (group: BatchGroup) => {
    const productTitle = group.title.trim() || group.name;
    const uploadedByEntry = new Map<string, MediaAsset>();
    const main: ReturnType<typeof assetData>[] = [];
    const carousel: ReturnType<typeof assetData>[] = [];
    const square: ReturnType<typeof assetData>[] = [];
    const skuAssets: ReturnType<typeof assetData>[] = [];
    const referencedEntryIds = new Set(group.skuRows.map((row) => String(row.imageAssetId || "")).filter(Boolean));
    const uploadEntries = group.entries.filter((entry) => entry.slot !== "sku" || referencedEntryIds.has(entry.id));
    const uploadedEntries = await Promise.all(uploadEntries.map(async (entry) => {
      const cacheKey = `${group.id}:${entry.id}`;
      const cached = uploadedAssetCacheRef.current.get(cacheKey);
      if (cached?.file === entry.file) return [entry, cached.asset] as const;
      const compressed = await compressProductImage(entry.file);
      const uploaded = await api.uploadProductImage(storeId, compressed.file, { width: entry.width, height: entry.height });
      uploadedAssetCacheRef.current.set(cacheKey, { file: entry.file, asset: uploaded.asset });
      return [entry, uploaded.asset] as const;
    }));
    uploadedEntries.forEach(([entry, asset]) => uploadedByEntry.set(entry.id, asset));
    group.entries.forEach((entry) => {
      const asset = uploadedByEntry.get(entry.id);
      if (!asset) return;
      if (entry.slot === "main") main.push(assetData(asset));
      if (entry.slot === "carousel") carousel.push(assetData(asset));
    });
    const firstMainFile = group.entries.find((entry) => entry.slot === "main")?.file || null;
    const tailAssetsById = new Map(selectedTailAssets.map((asset) => [tailAssetId(asset), asset]));
    const tail = group.tailAssetOrder
      .map((assetId) => tailAssetsById.get(assetId))
      .filter((asset): asset is NonNullable<typeof asset> => Boolean(asset))
      .map((asset) => templateAssetData(asset));
    if (firstMainFile) {
      const cachedSquare = squareAssetCacheRef.current.get(group.id);
      if (cachedSquare?.sourceFile === firstMainFile) {
        square.push(assetData(cachedSquare.asset));
      } else {
        const squareFile = await centerCropSquare(firstMainFile);
        const compressedSquare = await compressProductImage(squareFile);
        const squareDimensions = await readDimensions(compressedSquare.file);
        const uploadedSquare = await api.uploadProductImage(storeId, compressedSquare.file, squareDimensions);
        squareAssetCacheRef.current.set(group.id, { sourceFile: firstMainFile, asset: uploadedSquare.asset });
        square.push(assetData(uploadedSquare.asset));
      }
    }
    Array.from(referencedEntryIds).forEach((entryId) => {
      const asset = uploadedByEntry.get(entryId);
      if (asset) skuAssets.push(assetData(asset));
    });
    const uploadedRows = group.skuRows.map((row) => {
      const asset = uploadedByEntry.get(String(row.imageAssetId || ""));
      return asset ? { ...row, imageAssetId: asset.id } : { ...row };
    });
    const skuRows = ensureSupplierSkuRows(
      applySupplierSkuPrefix(
        reconcileSkuSizeMappings(
          uploadedRows.map((row) => ({ ...row, weightGrams: row.weightGrams ?? "" })),
          saleSchema,
          group.colorMapping,
        ),
        group.supplierCode,
      ),
      group.supplierCode,
    );
    const categoryId = selectedCategoryId;
    const productTypeId = selectedProductTypeId;
    const saved = await api.saveProductDraft(storeId, {
      id: group.savedDraftId,
      name: buildBatchDraftName(productTitle, group.name),
      categoryId,
      productTypeId,
      data: {
        title: productTitle,
        categoryName: selectedAttributeTemplate?.data.categoryName || "",
        categoryPath: selectedAttributeTemplate?.data.categoryPath || [],
        attributeTemplateId,
        titleRuleTemplateId,
        titleRuleBaseTitle: group.titleRuleBaseTitle || "",
        aiTitlePatternName: group.aiPatternName || "",
        attributeValues: group.attributeValues,
        sizeTemplateId,
        packagingTemplateId,
        packagingMaterial,
        tailImageTemplateId,
        supplierCode: group.supplierCode,
        pricePerSquareMeter,
        gramsPerSquareMeter,
        bulkInventory: inventory,
        businessModeSnapshot: currentStore?.businessMode || "",
        publishSettings: { ...DEFAULT_PRODUCT_PUBLISH_SETTINGS },
        currency: String(publishSchema.data?.publishStandard?.currency || ""),
        colorSaleValue: group.colorMapping,
        attributeSchemaSnapshot: {
          fetchedAt: new Date().toISOString(),
          categoryId,
          productTypeId,
          fields: attributeFields,
        },
        salesSchemaSnapshot: {
          fetchedAt: new Date().toISOString(),
          mainAttributeStatus: saleSchema.mainAttributeStatus,
          fields: saleSchema.fields,
          sizeFields: saleSchema.sizeFields,
        },
        publishStandardSnapshot: {
          fetchedAt: new Date().toISOString(),
          currency: String(publishSchema.data?.publishStandard?.currency || ""),
          weightConfig: publishSchema.data?.publishStandard?.weight_config || null,
          dimensionConfig: publishSchema.data?.publishStandard?.length_width_height_config || null,
          pictureConfig: publishSchema.data?.publishStandard?.picture_config_list || [],
          fillInStandard: publishSchema.data?.publishStandard?.fill_in_standard_list || [],
          defaultLanguage: String(publishSchema.data?.publishStandard?.default_language || ""),
          titleMaxLength: officialTitleMaxLength,
        },
        imageAssets: { main, detail: carousel, square, description: [], tail },
        skuPreviewImages: skuAssets,
        skuRows,
      },
      preflight: {},
      status: "blocked",
    });
    return saved.draft;
  };

  const persistGroups = async (targets: BatchGroup[], openReviewCenter = false) => {
    if (!targets.length || saving) return null;
    setSaving(true);
    setProgress({ done: 0, total: targets.length });
    setFeedback(null);
    try {
      const savedDrafts: Array<Pick<ProductDraft, "id" | "status"> | undefined> = new Array(targets.length);
      let nextIndex = 0;
      const saveNext = async () => {
        while (nextIndex < targets.length) {
          const index = nextIndex;
          nextIndex += 1;
          const group = targets[index];
        const draft = group.savedDraftId && !group.dirty
          ? { id: group.savedDraftId, status: group.savedStatus || "blocked" as const }
          : await saveGroup(group);
          savedDrafts[index] = { id: draft.id, status: draft.status };
        setGroups((current) => current.map((item) => item.id === group.id
          ? { ...item, savedDraftId: draft.id, savedStatus: draft.status, dirty: false }
          : item));
        setProgress((current) => ({ ...current, done: current.done + 1 }));
        }
      }
      await Promise.all(Array.from({ length: Math.min(SAVE_GROUP_CONCURRENCY, targets.length) }, () => saveNext()));
      const completedDrafts = savedDrafts.filter((draft): draft is Pick<ProductDraft, "id" | "status"> => Boolean(draft));
      let handoffDrafts = completedDrafts;
      if (openReviewCenter && completedDrafts.length) {
        const refreshed = await api.revalidateProductDrafts(
          storeId,
          completedDrafts.map((draft) => draft.id),
          { force: true },
        );
        const refreshedById = new Map(refreshed.drafts.map((draft) => [draft.id, draft]));
        handoffDrafts = completedDrafts.map((draft) => ({
          id: draft.id,
          status: refreshedById.get(draft.id)?.status || "blocked",
        }));
      }
      const readyDraftIds = handoffDrafts.filter((draft) => draft.status === "ready").map((draft) => draft.id);
      setFeedback({
        tone: readyDraftIds.length === completedDrafts.length ? "success" : "info",
        message: `已保存 ${targets.length} 个商品草稿；${readyDraftIds.length} 个可发布${completedDrafts.length > readyDraftIds.length ? `，${completedDrafts.length - readyDraftIds.length} 个需继续完善` : ""}。`,
      });
      if (openReviewCenter) {
        navigate(`/app/operations/${encodeURIComponent(storeId)}/publishing`, {
          state: {
            source: "product-drafts",
            storeId,
            draftIds: readyDraftIds,
          },
        });
      }
      return completedDrafts;
    } catch (error) {
      setFeedback({ tone: "danger", message: error instanceof Error ? error.message : "批量保存失败，已停止后续商品" });
      return null;
    } finally {
      setSaving(false);
    }
  };

  const saveSelected = () => void persistGroups(selectedGroups);

  const saveAndReview = () => void persistGroups(selectedGroups, true);

  const saveOne = (group: BatchGroup) => void persistGroups([group]);

  const removeGroups = async (ids: string[]) => {
    const targetIds = [...new Set(ids)].filter(Boolean);
    if (!targetIds.length || deleting) return;
    const targets = groups.filter((group) => targetIds.includes(group.id));
    if (!targets.length) return;
    if (!window.confirm(`确认删除选中的 ${targets.length} 个商品吗？已保存的商品草稿也会一并删除。`)) return;
    setDeleting(true);
    try {
      const savedTargets = targets.filter((group) => group.savedDraftId);
      const results = await Promise.allSettled(savedTargets.map((group) => api.archiveProductDraft(storeId, String(group.savedDraftId))));
      const failed = results.filter((result) => result.status === "rejected").length;
      setGroups((current) => current.filter((group) => !targetIds.includes(group.id)));
      setSelectedIds((current) => current.filter((id) => !targetIds.includes(id)));
      if (editorGroupId && targetIds.includes(editorGroupId)) closeEditor();
      if (expandedId && targetIds.includes(expandedId)) setExpandedId(null);
      setFeedback(failed
        ? { tone: "danger", message: `已删除本地 ${targets.length} 个商品，但有 ${failed} 个已保存草稿删除失败，请刷新后重试。` }
        : { tone: "success", message: `已删除 ${targets.length} 个商品。` });
    } finally {
      setDeleting(false);
    }
  };

  if (!currentStore) return null;
  return (
    <div className="ops-page product-editor batch-create-page">
      <header className="ops-page__header batch-create-page__header">
        <div>
          <button className="text-xs text-[var(--text-muted)] hover:text-[var(--ink)]" onClick={() => navigate(`/app/operations/${encodeURIComponent(storeId)}/products/drafts`)} type="button">← 返回商品草稿</button>
          <h1 className="ops-page__title">按文件夹批量创建商品</h1>
          <p className="ops-page__description">先配置共享参数，再逐个复核 SKC；保存并前往发布不会绕过商品审核中心。</p>
        </div>
        <Button disabled={parsing || saving} onClick={() => inputRef.current?.click()} variant="outline"><FolderOpen size={16} />导入商品文件夹</Button>
      </header>

      <input accept="image/jpeg,image/png,.jpg,.jpeg,.png" className="hidden" multiple onChange={(event) => void chooseFolder(event)} ref={inputRef} type="file" {...({ webkitdirectory: "" } as Record<string, string>)} />
      <PublishQuotaNotice
        compact
        loading={businessDashboard.isLoading}
        quota={businessDashboard.data?.snapshot?.productQuota}
      />

      <section className="batch-create-params-panel mb-4 overflow-hidden rounded-lg border border-[var(--line)] bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="h-5 w-0.5 rounded-full bg-[var(--text-muted)]" />
            <h2 className="text-sm font-semibold text-[var(--ink)]">商品模板</h2>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {aiTitleCapability.data?.visible && (
              <Button
                disabled={saving || aiTitleGenerating || !selectedCount || !titleRuleTemplateId}
                onClick={() => void generateBatchAiTitles()}
                variant="danger"
              >
                {aiTitleGenerating ? <LoaderCircle className="animate-spin" size={15} /> : <Sparkles size={15} />}
                {aiTitleGenerating ? "并行识别中" : "AI识别图案标题"}
              </Button>
            )}
            <Button disabled={saving || !selectedCount} onClick={applySettings} variant="danger"><Sparkles size={15} />批量引用 · {selectedCount} 个商品</Button>
          </div>
        </div>
        <div className="grid gap-x-4 gap-y-3 px-4 py-4 md:grid-cols-2 xl:grid-cols-4">
          <label className="text-xs text-[var(--text-muted)]">商品标题模板<select className="field mt-1 h-9 px-2 text-xs" onChange={(event) => setTitleRuleTemplateId(event.target.value)} value={titleRuleTemplateId}><option value="">不引用</option>{(titleRuleTemplates.data?.templates || []).map((item: TitleRuleTemplate) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label className="text-xs text-[var(--text-muted)]">商品属性模板<select className="field mt-1 h-9 px-2 text-xs" onChange={(event) => setAttributeTemplateId(event.target.value)} value={attributeTemplateId}><option value="">未引用</option>{(attributeTemplates.data?.templates || []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label className="text-xs text-[var(--text-muted)]">尺寸模板<select className="field mt-1 h-9 px-2 text-xs" onChange={(event) => setSizeTemplateId(event.target.value)} value={sizeTemplateId}><option value="">未引用</option>{(sizeTemplates.data?.templates || []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label className="text-xs text-[var(--text-muted)]">通用图片模板<select className="field mt-1 h-9 px-2 text-xs" onChange={(event) => setTailImageTemplateId(event.target.value)} value={tailImageTemplateId}><option value="">不引用通用图片</option>{(tailImageTemplates.data?.templates || []).map((item) => <option key={item.id} value={item.id}>{item.name} · {item.data.assetIds?.length || 0} 张</option>)}</select></label>
          <label className="text-xs text-[var(--text-muted)]">打包模板<select className="field mt-1 h-9 px-2 text-xs" onChange={(event) => { setPackagingTemplateId(event.target.value); setPackagingMaterial(""); }} value={packagingTemplateId}><option value="">未引用</option>{(packagingTemplates.data?.templates || []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          {packagingMaterials.length > 0 && <label className="text-xs text-[var(--text-muted)]">包装材料<select className="field mt-1 h-9 px-2 text-xs" onChange={(event) => setPackagingMaterial(event.target.value)} value={packagingMaterial}><option value="">请选择</option>{packagingMaterials.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>}
          <label className="text-xs text-[var(--text-muted)]">每平方米供货价（CNY）<input className="field mt-1 h-9 px-2 text-xs" inputMode="decimal" onChange={(event) => setPricePerSquareMeter(event.target.value)} placeholder="例如 42" value={pricePerSquareMeter} /></label>
        </div>
        <div className="border-t border-[var(--line)] px-4 py-4">
          <div className="flex items-center gap-2">
            <span className="h-5 w-0.5 rounded-full bg-[var(--text-muted)]" />
            <h3 className="text-sm font-semibold text-[var(--ink)]">SKU参数</h3>
          </div>
          <div className="mt-3 grid gap-x-4 gap-y-3 md:grid-cols-2 xl:grid-cols-3">
            <label className="text-xs text-[var(--text-muted)]">每平方米克重（g）<input className="field mt-1 h-9 px-2 text-xs" inputMode="decimal" onChange={(event) => setGramsPerSquareMeter(event.target.value)} placeholder="例如 950" value={gramsPerSquareMeter} /></label>
            <label className="text-xs text-[var(--text-muted)]">统一库存<input className="field mt-1 h-9 px-2 text-xs" inputMode="numeric" onChange={(event) => setInventory(event.target.value)} value={inventory} /></label>
            <label className="text-xs text-[var(--text-muted)]">SKU预览图来源<select className="field mt-1 h-9 px-2 text-xs" onChange={(event) => setPreviewMode(event.target.value as typeof previewMode)} value={previewMode}><option value="none">不自动指定</option><option value="carousel">按顺序引用通用轮播图</option><option value="main">全部引用第一张主图</option></select></label>
          </div>
        </div>
        <div className="border-t border-[var(--line)]">
          <button aria-expanded={watermarkExpanded} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--surface-muted)]" onClick={() => setWatermarkExpanded((current) => !current)} type="button">
            <span className="flex min-w-0 items-center gap-2">
              <Sparkles className="shrink-0 text-[var(--text-muted)]" size={15} />
              <span className="text-xs font-semibold text-[var(--ink)]">主图满屏水印</span>
              <span className="truncate text-[11px] text-[var(--text-subtle)]">{watermark.text.trim() || "未设置"} · {watermark.fontSize}px · {Math.round(watermark.opacity * 100)}%</span>
            </span>
            <ChevronDown className={`shrink-0 text-[var(--text-subtle)] transition-transform ${watermarkExpanded ? "rotate-180" : ""}`} size={16} />
          </button>
          {watermarkExpanded && <div className="grid gap-3 border-t border-[var(--line)] bg-[var(--surface-muted)]/50 px-4 py-3 md:grid-cols-2 xl:grid-cols-[minmax(220px,1fr)_140px_160px_64px_auto] xl:items-end">
            <label className="text-[11px] text-[var(--text-subtle)]">水印文案<input aria-label="批量水印内容" className="field mt-1 h-9 px-2 text-xs" maxLength={40} onChange={(event) => setWatermark((current) => normalizeWatermarkOptions({ ...current, text: event.target.value }))} placeholder="例如 SHEIN RUG" value={watermark.text} /></label>
            <label className="text-[11px] text-[var(--text-subtle)]">大小 {watermark.fontSize}px<input aria-label="批量水印大小" className="mt-2 w-full" max="160" min="12" onChange={(event) => setWatermark((current) => normalizeWatermarkOptions({ ...current, fontSize: Number(event.target.value) }))} type="range" value={watermark.fontSize} /></label>
            <label className="text-[11px] text-[var(--text-subtle)]">深浅 {Math.round(watermark.opacity * 100)}%<input aria-label="批量水印深浅" className="mt-2 w-full" max="0.5" min="0.05" onChange={(event) => setWatermark((current) => normalizeWatermarkOptions({ ...current, opacity: Number(event.target.value) }))} step="0.01" type="range" value={watermark.opacity} /></label>
            <label className="text-[11px] text-[var(--text-subtle)]">颜色<input aria-label="批量水印颜色" className="mt-1 h-9 w-full cursor-pointer rounded border border-[var(--line)] bg-white p-1" onChange={(event) => setWatermark((current) => normalizeWatermarkOptions({ ...current, color: event.target.value }))} type="color" value={watermark.color} /></label>
            <div className="flex flex-col items-stretch gap-1 xl:items-end">
              <Button disabled={watermarking || saving || deleting || !selectedCount || !watermark.text.trim()} onClick={() => void applyWatermarkToSelected()} size="sm" variant="outline">
                {watermarking ? <LoaderCircle className="animate-spin" size={14} /> : <Sparkles size={14} />}
                应用水印
              </Button>
              <span className="text-[10px] text-[var(--text-subtle)]">仅应用到已选商品</span>
            </div>
          </div>}
        </div>
      </section>

      {feedback && <div className={`notice mb-4 ${feedback.tone === "danger" ? "notice-danger" : feedback.tone === "success" ? "notice-success" : "notice-info"}`} role={feedback.tone === "danger" ? "alert" : "status"}>{feedback.tone === "danger" ? <AlertCircle size={16} /> : <Check size={16} />}<span>{feedback.message}</span></div>}
      {saving && <div className="mb-4 rounded-md border border-[var(--line)] bg-white p-3 text-xs text-[var(--text-muted)]"><div className="flex items-center gap-2"><LoaderCircle className="animate-spin" size={15} />正在保存 {progress.done} / {progress.total} 个商品，完成后可逐个打开复核</div><progress className="mt-2 h-1.5 w-full" max={progress.total || 1} value={progress.done} /></div>}
      {aiTitleGenerating && <div className="mb-4 rounded-md border border-[var(--line)] bg-white p-3 text-xs text-[var(--text-muted)]"><div className="flex items-center gap-2"><LoaderCircle className="animate-spin" size={15} />正在并行识别 {aiTitleProgress.done} / {aiTitleProgress.total} 个商品</div><progress className="mt-2 h-1.5 w-full" max={aiTitleProgress.total || 1} value={aiTitleProgress.done} /></div>}

      {!groups.length && <button className="grid min-h-40 w-full place-items-center rounded-md border border-dashed border-[var(--line-strong)] bg-white p-5 text-center text-xs text-[var(--text-muted)]" disabled={parsing} onClick={() => inputRef.current?.click()} type="button">{parsing ? <LoaderCircle className="animate-spin" size={24} /> : <Upload size={24} />}<span className="mt-2">选择一个根目录；每个子文件夹会生成一个商品 SKC 行</span></button>}

      {groups.length > 0 && <section className="batch-create-table-panel overflow-hidden rounded-md border border-[var(--line)] bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
          <div><h2 className="text-sm font-semibold text-[var(--ink)]">批量商品总表</h2><p className="mt-1 text-xs text-[var(--text-subtle)]">共 {groups.length} 个商品，已选 {selectedCount} 个；价格、克重和预览图按每个 SKU 对应展示。</p></div>
          <div className="flex flex-wrap gap-2"><Button disabled={saving || deleting || !selectedCount} onClick={saveSelected} variant="outline"><Save size={16} />保存已选草稿</Button><Button disabled={saving || deleting || !selectedCount} onClick={saveAndReview}><Send size={16} />保存并前往发布</Button><Button disabled={saving || deleting || !selectedCount} onClick={() => void removeGroups(selectedIds)} variant="outline"><Trash2 size={16} />删除已选</Button></div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1050px] text-xs">
            <thead className="bg-[var(--surface-muted)] text-left text-[var(--text-muted)]"><tr><th className="w-10 px-3 py-2"><input aria-label="全选批量商品" checked={selectedCount === groups.length} onChange={(event) => setSelectedIds(event.target.checked ? groups.map((group) => group.id) : [])} type="checkbox" /></th><th className="w-72 px-3 py-2">SKC / 标题 / 主图</th><th className="px-3 py-2">SKU尺寸与预览图、价格与克重</th><th className="w-44 px-3 py-2">处理</th></tr></thead>
            <tbody>{groups.map((group) => {
              const summary = summarizeBatchProduct({ ...group, titleMaxLength: officialTitleMaxLength, attributeTemplateId, sizeTemplateId });
              const mainEntry = group.entries.find((entry) => entry.slot === "main") || group.entries[0];
              const categoryPath = categoryPathText(selectedAttributeTemplate || selectedSizeTemplate);
              const tailAssetsById = new Map(selectedTailAssets.map((asset) => [tailAssetId(asset), asset]));
              const orderedTailAssets = group.tailAssetOrder.flatMap((assetId) => {
                const asset = tailAssetsById.get(assetId);
                return asset ? [asset] : [];
              });
              return <Fragment key={group.id}>
                <tr className="border-t border-[var(--line)] align-top">
                  <td className="px-3 py-3"><input aria-label={`选择 ${group.name}`} checked={selectedIds.includes(group.id)} onChange={() => setSelectedIds((current) => current.includes(group.id) ? current.filter((id) => id !== group.id) : [...current, group.id])} type="checkbox" /></td>
                  <td className="px-3 py-3"><input aria-label={`${group.name}标题`} className="field h-8 w-full px-2 text-xs" maxLength={officialTitleMaxLength || undefined} onChange={(event) => updateGroup(group.id, { title: event.target.value })} value={group.title} /><p className={`mt-1 text-[10px] ${officialTitleMaxLength && group.title.trim().length > officialTitleMaxLength ? "text-[var(--danger)]" : "text-[var(--text-subtle)]"}`}>SHEIN标题：{group.title.trim().length}/{officialTitleMaxLength || "待读取"} 字符</p>{mainEntry && <div className="relative mt-2 size-16"><img alt={`${group.name}商品主图`} className="size-16 rounded border bg-[var(--surface-muted)] object-contain" src={mainEntry.previewUrl} /><button aria-label={`放大查看${group.name}商品主图`} className="absolute bottom-1 left-1 rounded-full bg-slate-950/75 p-1.5 text-white shadow-sm hover:bg-slate-950" onClick={() => setZoomEntry(mainEntry)} type="button"><ZoomIn size={13} /></button></div>}<p className="mt-1 text-[11px] font-medium text-[var(--danger)]">商品类目：{categoryPath || "未引用属性模板"}</p><p className="mt-1 truncate text-[11px] text-[var(--text-subtle)]" title={group.supplierCode}>商家 SKC：{group.supplierCode}</p><p className={`mt-1 text-[11px] ${summary.blockers.length ? "text-[var(--danger)]" : "text-[var(--success)]"}`}>{summary.blockers.length ? summary.blockers.join("；") : "数据已就绪，可打开 SKC 复核"}</p></td>
                  <td className="px-3 py-3"><div className="space-y-1.5">{group.skuRows.length ? group.skuRows.map((row) => { const entry = group.entries.find((item) => item.id === String(row.imageAssetId || "")); return <div className="grid grid-cols-[84px_40px_minmax(76px,1fr)_minmax(76px,1fr)] items-center gap-2" key={String(row.id)}><span className="truncate text-[var(--text-muted)]">{String(row.sizeText || "待设置")}</span>{entry ? <img alt={`${row.sizeText || "SKU"}预览图`} className="size-9 rounded border bg-[var(--surface-muted)] object-contain" src={entry.previewUrl} /> : <span className="grid size-9 place-items-center rounded border border-dashed text-[10px] text-[var(--text-subtle)]">未指定</span>}<span>{String(row.costPrice || "待生成")} CNY</span><span>{String(row.weightGrams || "待生成")} g</span></div>; }) : <span className="text-[var(--danger)]">未引用尺寸模板</span>}</div>{selectedTailImageTemplate && <p className="mt-2 text-[11px] text-[var(--success)]">已引用通用图片：{selectedTailImageTemplate.name} · {orderedTailAssets.length} 张</p>}<button className="mt-2 text-[11px] text-[var(--focus)] underline" onClick={() => setExpandedId(expandedId === group.id ? null : group.id)} type="button">{expandedId === group.id ? "收起图片用途" : `查看/调整图片用途（${group.entries.length + orderedTailAssets.length}）`} <ChevronDown className="inline" size={12} /></button></td>
                  <td className="px-3 py-3"><div className="flex flex-col items-start gap-2"><Button disabled={saving || deleting} onClick={() => openEditor(group.id)} size="sm" variant="outline">打开 SKC</Button><Button disabled={saving || deleting} onClick={() => void removeGroups([group.id])} size="sm" variant="outline"><Trash2 size={14} />删除</Button>{group.savedDraftId && <span className="text-[11px] text-[var(--success)]">已保存{group.dirty ? " · 有未保存修改" : group.savedStatus === "ready" ? " · 可发布" : " · 待完善"}</span>}</div></td>
                </tr>
                {expandedId === group.id && <tr className="border-t border-[var(--line)]" data-batch-image-panel={group.id}>
                  <td className="bg-[var(--surface-muted)] px-4 py-3" colSpan={4}>
                    <div className="flex items-center justify-between gap-3"><div><h3 className="text-xs font-semibold text-[var(--ink)]">{group.name} · 图片用途与排序</h3><p className="mt-1 text-[10px] text-[var(--text-subtle)]">拖动图片调整顺序；商品图片与已引用通用主图分别排序，通用主图仍追加在商品图片之后。</p></div><GripVertical className="text-[var(--text-subtle)]" size={16} /></div>
                    <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(118px,1fr))] gap-2">
                      {group.entries.map((entry, index) => <article className="cursor-grab rounded border border-[var(--line)] bg-white p-2 active:cursor-grabbing" draggable key={entry.id} onDragOver={(event) => event.preventDefault()} onDragStart={(event) => startImageDrag(event, "entry", group.id, entry.id)} onDrop={(event) => dropImage(event, "entry", group.id, entry.id)}>
                        <div className="relative"><img alt={entry.file.name} className="h-20 w-full rounded bg-[var(--surface-muted)] object-contain" src={entry.previewUrl} /><span className="absolute left-1 top-1 rounded bg-slate-950/70 px-1.5 py-0.5 text-[9px] text-white">{index + 1}</span><button aria-label={`放大查看${entry.file.name}`} className="absolute bottom-1 left-1 rounded-full bg-slate-950/75 p-1 text-white shadow-sm hover:bg-slate-950" onClick={(event) => { event.stopPropagation(); setZoomEntry(entry); }} type="button"><ZoomIn size={12} /></button><button aria-label={`删除${entry.file.name}`} className="absolute right-1 top-1 rounded-full bg-red-600/90 p-1 text-white shadow-sm hover:bg-red-700" onClick={(event) => { event.stopPropagation(); removeEntry(group.id, entry.id); }} type="button"><Trash2 size={12} /></button></div>
                        <p className="mt-1 truncate text-[10px]" title={entry.path}>{entry.file.name}</p>
                        <select aria-label={`${entry.file.name}用途`} className="field mt-1 h-7 px-1.5 text-[10px]" onChange={(event) => updateEntrySlot(group.id, entry.id, event.target.value as BatchEntry["slot"])} value={entry.slot}><option value="main">商品主图</option><option value="carousel">通用轮播图</option><option value="sku">SKU预览图素材</option></select>
                      </article>)}
                    </div>
                    {orderedTailAssets.length > 0 && <div className="mt-3 border-t border-[var(--line)] pt-3"><p className="text-[10px] font-medium text-[var(--text-muted)]">已引用的通用主图 · 可拖动排序</p><SortableImageStrip items={orderedTailAssets.map((asset) => ({ ...asset, id: tailAssetId(asset) }))} onChange={(next) => setGroups((current) => current.map((candidate) => candidate.id !== group.id ? candidate : { ...candidate, tailAssetOrder: next.map((asset) => asset.id), dirty: true }))} renderItem={(asset, index) => { const assetId = asset.id; return <>{tailPreviewUrls[assetId] ? <img alt={asset.originalName || `通用主图${index + 1}`} className="h-16 w-full rounded bg-[var(--surface-muted)] object-contain" src={tailPreviewUrls[assetId]} /> : <div className="grid h-16 place-items-center rounded bg-[var(--surface-muted)] text-[var(--text-subtle)]"><ImageIcon size={16} /></div>}<p className="mt-1 truncate text-[10px]" title={asset.originalName}>{index + 1}. {asset.originalName || "通用主图"}</p></>; }} /></div>}
                  </td>
                </tr>}
              </Fragment>;
            })}</tbody>
          </table>
        </div>
      </section>}

      {editorGroup && <div aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4" role="dialog">
        <section className="flex max-h-[92vh] w-full max-w-[1180px] flex-col overflow-hidden rounded-lg border border-[var(--line)] bg-white shadow-2xl">
          <header className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--line)] px-4 py-3"><div className="min-w-0"><p className="text-[11px] text-[var(--text-subtle)]">批量建品 · SKC 二级编辑</p><h2 className="mt-0.5 truncate text-sm font-semibold text-[var(--ink)]">{editorGroup.name}</h2><p className="mt-1 text-[10px] font-medium text-[var(--danger)]">商品类目：{categoryPathText(selectedAttributeTemplate || selectedSizeTemplate) || "未引用属性模板"}</p></div><button aria-label="关闭 SKC 编辑" className="rounded p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface-muted)]" onClick={closeEditor} type="button"><X size={18} /></button></header>
          <div className="flex shrink-0 border-b border-[var(--line)] bg-[var(--surface-muted)] px-4 pt-2"><button className={`rounded-t px-4 py-2 text-xs font-medium ${editorTab === "attributes" ? "border border-b-white border-[var(--line)] bg-white text-[var(--ink)]" : "text-[var(--text-muted)]"}`} onClick={() => setEditorTab("attributes")} type="button">商品属性</button><button className={`rounded-t px-4 py-2 text-xs font-medium ${editorTab === "sku" ? "border border-b-white border-[var(--line)] bg-white text-[var(--ink)]" : "text-[var(--text-muted)]"}`} onClick={() => setEditorTab("sku")} type="button">SKU与包装</button></div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <div className="grid gap-3 md:grid-cols-[76px_minmax(0,1fr)] md:items-start"><div>{(editorGroup.entries.find((entry) => entry.slot === "main") || editorGroup.entries[0]) && <div className="relative size-[72px]"><img alt="SKC商品主图" className="size-[72px] rounded border bg-[var(--surface-muted)] object-contain" src={(editorGroup.entries.find((entry) => entry.slot === "main") || editorGroup.entries[0])?.previewUrl} /><button aria-label="放大查看SKC商品主图" className="absolute bottom-1 left-1 rounded-full bg-slate-950/75 p-1.5 text-white shadow-sm hover:bg-slate-950" onClick={() => setZoomEntry(editorGroup.entries.find((entry) => entry.slot === "main") || editorGroup.entries[0] || null)} type="button"><ZoomIn size={13} /></button></div>}<p className="mt-1 max-w-[76px] truncate text-[9px] text-[var(--text-subtle)]" title={editorGroup.supplierCode}>{editorGroup.supplierCode}</p></div><label className="text-[11px] text-[var(--text-muted)]">商品标题<input aria-label="二级编辑商品标题" className="field mt-1 h-8 px-2 text-xs" maxLength={officialTitleMaxLength || undefined} onChange={(event) => updateGroup(editorGroup.id, { title: event.target.value })} value={editorGroup.title} /><span className="mt-1 block text-[10px] text-[var(--text-subtle)]">SHEIN标题：{editorGroup.title.trim().length}/{officialTitleMaxLength || "待读取"} 字符</span></label></div>
            {editorTab === "attributes" && <section className="mt-4 rounded border border-[var(--line)]"><header className="flex items-center justify-between border-b border-[var(--line)] px-3 py-2"><div><h3 className="text-xs font-semibold text-[var(--ink)]">已引用商品属性</h3><p className="mt-0.5 text-[10px] text-[var(--text-subtle)]">{selectedAttributeTemplate ? `${selectedAttributeTemplate.name} · ${Object.keys(editorGroup.attributeValues).length} 项` : "尚未引用商品属性模板"}</p></div></header>{publishSchema.isLoading ? <div className="p-4 text-xs text-[var(--text-muted)]">正在读取 SHEIN 商品属性…</div> : attributeFields.filter((field) => editorGroup.attributeValues[field.id]).length ? <div className="grid gap-px bg-[var(--line)] md:grid-cols-2">{attributeFields.filter((field) => editorGroup.attributeValues[field.id]).map((field) => <div className="grid grid-cols-[minmax(100px,34%)_minmax(0,1fr)] gap-2 bg-white px-3 py-2 text-[11px]" key={field.id}><div className="min-w-0"><p className="truncate font-medium text-[var(--ink)]" title={field.name}>{field.required && <span className="mr-1 text-[var(--danger)]">*</span>}{field.name}</p><p className="mt-0.5 text-[9px] text-[var(--text-subtle)]">ID {field.id}</p></div><p className="break-words leading-5 text-[var(--text-muted)]">{attributeValueText(field, editorGroup.attributeValues[field.id] as AttributeValue)}</p></div>)}</div> : <div className="p-5 text-center text-xs text-[var(--text-muted)]">当前模板没有可呈现的商品属性，请先在批量参数中引用并应用模板。</div>}</section>}
            {editorTab === "sku" && <div className="mt-4 overflow-x-auto rounded border border-[var(--line)]"><table className="w-full min-w-[900px] text-[11px]"><thead className="bg-[var(--surface-muted)] text-left text-[var(--text-muted)]"><tr><th className="w-28 px-2 py-2">SKU尺寸</th><th className="w-44 px-2 py-2">预览图</th><th className="w-28 px-2 py-2">价格（CNY）</th><th className="w-24 px-2 py-2">克重（g）</th><th className="px-2 py-2">打包体积（长×宽×高 cm）</th></tr></thead><tbody>{editorGroup.skuRows.map((row) => { const currentEntry = editorGroup.entries.find((entry) => entry.id === String(row.imageAssetId || "")); return <tr className="border-t border-[var(--line)]" key={String(row.id)}><td className="px-2 py-2 font-medium">{String(row.sizeText || "待设置")}</td><td className="px-2 py-2"><button className="flex h-9 w-36 items-center gap-2 rounded border border-[var(--line-strong)] px-2 text-left hover:bg-[var(--surface-muted)]" onClick={() => setSkuPickerRowId(String(row.id))} type="button">{currentEntry ? <img alt="当前SKU预览图" className="size-7 shrink-0 rounded bg-[var(--surface-muted)] object-contain" src={currentEntry.previewUrl} /> : <span className="grid size-7 shrink-0 place-items-center rounded border border-dashed text-[var(--text-subtle)]"><ImageIcon size={13} /></span>}<span className="truncate">选择预览图</span></button></td><td className="px-2 py-2"><input aria-label={`${row.sizeText || "SKU"}价格`} className="field h-8 w-24 px-2 text-[11px]" inputMode="decimal" onChange={(event) => updateSkuRow(editorGroup.id, row.id, { costPrice: event.target.value })} value={String(row.costPrice || "")} /></td><td className="px-2 py-2"><input aria-label={`${row.sizeText || "SKU"}克重`} className="field h-8 w-20 px-2 text-[11px]" inputMode="decimal" onChange={(event) => updateSkuRow(editorGroup.id, row.id, { weightGrams: event.target.value ? Number(event.target.value) : null })} value={row.weightGrams == null ? "" : String(row.weightGrams)} /></td><td className="px-2 py-2"><div className="flex items-center gap-1"><input aria-label={`${row.sizeText || "SKU"}打包长`} className="field h-8 w-16 px-2 text-[11px]" inputMode="decimal" onChange={(event) => updateSkuRow(editorGroup.id, row.id, { packageLengthCm: event.target.value ? Number(event.target.value) : null })} placeholder="长" value={row.packageLengthCm == null ? "" : String(row.packageLengthCm)} /><span>×</span><input aria-label={`${row.sizeText || "SKU"}打包宽`} className="field h-8 w-16 px-2 text-[11px]" inputMode="decimal" onChange={(event) => updateSkuRow(editorGroup.id, row.id, { packageWidthCm: event.target.value ? Number(event.target.value) : null })} placeholder="宽" value={row.packageWidthCm == null ? "" : String(row.packageWidthCm)} /><span>×</span><input aria-label={`${row.sizeText || "SKU"}打包高`} className="field h-8 w-16 px-2 text-[11px]" inputMode="decimal" onChange={(event) => updateSkuRow(editorGroup.id, row.id, { packageHeightCm: event.target.value ? Number(event.target.value) : null })} placeholder="高" value={row.packageHeightCm == null ? "" : String(row.packageHeightCm)} /></div></td></tr>; })}</tbody></table></div>}
          </div>
          <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-[var(--line)] px-4 py-3"><Button onClick={closeEditor} size="sm" variant="outline">关闭</Button><Button disabled={saving || deleting} onClick={() => saveOne(editorGroup)} size="sm" variant="outline"><Save size={14} />保存此 SKC</Button><Button disabled={saving || deleting} onClick={() => void persistGroups([editorGroup], true)} size="sm"><Send size={14} />保存并前往发布</Button></footer>
        </section>
      </div>}

      {editorGroup && skuPickerRowId && <div aria-modal="true" className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/55 p-4" role="dialog"><section className="max-h-[86vh] w-full max-w-4xl overflow-hidden rounded-lg bg-white shadow-2xl"><header className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3"><div><h3 className="text-sm font-semibold text-[var(--ink)]">选择 SKU 预览图</h3><p className="mt-1 text-[10px] text-[var(--text-subtle)]">先放大确认，再引用到当前 SKU；不会改变商品主图用途。</p></div><button aria-label="关闭预览图选择" className="rounded p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface-muted)]" onClick={() => setSkuPickerRowId(null)} type="button"><X size={18} /></button></header><div className="max-h-[calc(86vh-116px)] overflow-y-auto p-4"><div className="grid grid-cols-[repeat(auto-fill,minmax(142px,1fr))] gap-3">{editorGroup.entries.map((entry) => <article className="rounded border border-[var(--line)] p-2" key={entry.id}><button className="block w-full" onClick={() => setZoomEntry(entry)} type="button"><img alt={entry.file.name} className="h-28 w-full rounded bg-[var(--surface-muted)] object-contain" src={entry.previewUrl} /></button><p className="mt-1 truncate text-[10px]" title={entry.file.name}>{slotLabel(entry.slot)} · {entry.file.name}</p><div className="mt-2 grid grid-cols-2 gap-1"><Button onClick={() => setZoomEntry(entry)} size="sm" variant="outline"><ZoomIn size={13} />放大</Button><Button onClick={() => { updateSkuRow(editorGroup.id, skuPickerRowId, { imageAssetId: entry.id, imageAssetSource: "batch_manual" }); setSkuPickerRowId(null); }} size="sm">引用</Button></div></article>)}</div>{!editorGroup.entries.length && <p className="py-8 text-center text-xs text-[var(--text-muted)]">当前 SKC 没有可引用的图片。</p>}</div><footer className="flex justify-between border-t border-[var(--line)] px-4 py-3"><Button onClick={() => { updateSkuRow(editorGroup.id, skuPickerRowId, { imageAssetId: "", imageAssetSource: "" }); setSkuPickerRowId(null); }} size="sm" variant="outline">清除引用</Button><Button onClick={() => setSkuPickerRowId(null)} size="sm" variant="outline">关闭</Button></footer></section></div>}

      {zoomEntry && <div aria-label="SKU预览图放大" aria-modal="true" className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/75 p-6" onClick={() => setZoomEntry(null)} role="dialog"><div className="relative max-h-full max-w-4xl" onClick={(event) => event.stopPropagation()}><img alt={zoomEntry.file.name} className="max-h-[82vh] max-w-full rounded-lg bg-white object-contain shadow-2xl" src={zoomEntry.previewUrl} /><button aria-label="关闭放大图片" className="absolute right-2 top-2 rounded-full bg-slate-950/75 p-2 text-white" onClick={() => setZoomEntry(null)} type="button"><X size={18} /></button></div></div>}
    </div>
  );
}
