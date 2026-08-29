import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowLeft,
  Boxes,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  ImagePlus,
  Images,
  LoaderCircle,
  PackageCheck,
  Save,
  Scale,
  Search,
  Sparkles,
  Trash2,
  Upload,
  WalletCards,
  Warehouse,
} from "lucide-react";
import { useNavigate, useSearchParams } from "react-router";
import { useAppContext } from "../../app/AppShell";
import { Button } from "../../components/ui/button";
import {
  ApiError,
  api,
  type ProductDraft,
  type RugReportSources,
} from "../../lib/api";
import { productDraftSectionAnchor } from "../../lib/product-draft-issue-contract.js";
import { PublishQuotaNotice } from "../operations/OperationsShared";
import { useBusinessDashboard } from "../operations/use-business-dashboard";
import {
  ProductImagesSection,
  type DraftProductImage,
} from "./ProductImagesSection";
import {
  ProductComplianceSection,
  type CompliancePhotoSourceMode,
  type DraftCompliancePhoto,
} from "./ProductComplianceSection";
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
import {
  applyGramsPerSquareMeter,
  applyInventoryToAll,
  applyPackagingTemplate,
  applyPricePerSquareMeter,
  applySharedSkuImage,
  applySupplierSkuPrefix,
  assignSkuPreviewImage,
  autoMapSkuPreviewImages,
  buildSaleAttributeSchema,
  buildSkuStageFromSizeTemplate,
  ensureSupplierSkuRows,
  reconcileSkuSizeMappings,
  resolveMainSaleAttributeValue,
  validateSkuStage,
  type ProductSkuRow,
  type SaleAttributeField,
  type SaleValueMapping,
} from "../../lib/product-sku-contract.js";
import {
  buildProductImageStage,
  orderedTailTemplateImages,
} from "../../lib/product-image-contract.js";
import { buildProductContentStage } from "../../lib/product-content-contract.js";
import {
  applyTitleRule,
  stripTitleRuleFragments,
} from "../../lib/title-rule-template-contract.js";
import {
  buildAiTitleRequest,
  composeAiTitle,
} from "../../lib/ai-title-contract.js";
import { buildProductComplianceStage } from "../../lib/product-compliance-contract.js";
import {
  DEFAULT_PRODUCT_PUBLISH_SETTINGS,
  buildProductPublishSettingsStage,
} from "../../lib/product-publish-settings-contract.js";
import { validatePublishImage } from "../../../src/lib/publish-image-rules.js";
import { defaultSupplierCode, normalizeSupplierCode } from "../../lib/product-code.js";
import { compressProductImage } from "../../lib/product-image-compress.js";
import {
  autoMapSkuPreviewImagesByOcr,
  recognizeSkuImageText,
} from "../../lib/sku-image-ocr.js";

type Assignments = Record<string, AttributeAssignmentValue>;

interface LinkedRule {
  attribute_id?: string | number;
  attribute_value_list?: Array<string | number>;
  attribute_value_pre_fill_list?: Array<string | number>;
}

function saleValueOptions(fields: SaleAttributeField[]) {
  return fields.flatMap((field) =>
    field.values.map((value) => ({
      key: `${field.id}:${value.id}`,
      mapping: {
        attributeId: field.id,
        attributeName: field.name,
        valueId: value.id,
        valueLabel: value.label,
      },
    })),
  );
}

function configRequired(config: unknown) {
  if (!config || typeof config !== "object" || Array.isArray(config)) return false;
  const value = (config as { is_required?: unknown }).is_required;
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "required", "是"].includes(
    String(value ?? "").trim().toLocaleLowerCase(),
  );
}

function SkuPreviewImageDialog({
  open,
  rowLabel,
  assets,
  mainAssetIds,
  selectedAssetId,
  onClose,
  onSelect,
}: {
  open: boolean;
  rowLabel: string;
  assets: DraftProductImage[];
  mainAssetIds: string[];
  selectedAssetId?: string;
  onClose: () => void;
  onSelect: (assetId: string) => void;
}) {
  const [draftAssetId, setDraftAssetId] = useState(selectedAssetId || "");
  const [hoverAssetId, setHoverAssetId] = useState("");
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    if (!open) return;
    setDraftAssetId(selectedAssetId || "");
    setHoverAssetId("");
    setZoom(1);
  }, [open, selectedAssetId]);

  if (!open) return null;

  const selectedAsset = assets.find((asset) => asset.id === (hoverAssetId || draftAssetId)) || null;

  return (
    <div
      aria-label={`${rowLabel} SKU预览图选择`}
      aria-modal="true"
      className="fixed inset-0 z-[120] grid place-items-center bg-slate-950/70 p-3 sm:p-5"
      role="dialog"
    >
      <section className="sku-preview-dialog">
        <header className="flex items-start gap-3 border-b border-[var(--line)] bg-white px-4 py-3 sm:px-5">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-[var(--text-subtle)]">SKU预览图</p>
            <h2 className="mt-1 text-base font-semibold text-[var(--ink)]">
              为「{rowLabel}」选择预览图
            </h2>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              选中图片后可在左侧放大查看文字，确认后再引用到这一行。
            </p>
          </div>
          <button
            aria-label="关闭SKU预览图选择"
            className="rounded-md p-2 text-[var(--text-subtle)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]"
            onClick={onClose}
            type="button"
          >
            <span aria-hidden="true" className="text-xl leading-none">×</span>
          </button>
        </header>

        <div className="sku-preview-dialog-body">
          <div
            className="sku-preview-dialog-canvas"
            onWheel={(event) => {
              event.preventDefault();
              setZoom((current) => Math.min(4, Math.max(1, current + (event.deltaY < 0 ? 0.1 : -0.1))));
            }}
          >
            {selectedAsset?.previewUrl ? (
              <img
                alt={`${rowLabel} SKU预览大图`}
                src={selectedAsset.previewUrl}
                style={{ transform: `scale(${zoom})` }}
              />
            ) : (
              <div className="grid place-items-center gap-2 text-sm text-slate-300">
                <Images size={34} />
                <span>请选择右侧图片</span>
              </div>
            )}
          </div>

          <aside className="sku-preview-dialog-options">
            <div className="border-b border-[var(--line)] px-3 py-2 text-xs font-medium text-[var(--text-muted)]">
              可选图片 · {assets.length}
            </div>
            <button
              aria-selected={!draftAssetId}
              className="sku-preview-dialog-option"
              onClick={() => { setDraftAssetId(""); setHoverAssetId(""); }}
              onMouseEnter={() => setHoverAssetId("")}
              onMouseLeave={() => setHoverAssetId("")}
              role="option"
              type="button"
            >
              <span className="sku-preview-dialog-option-thumb"><Images size={18} /></span>
              <span className="min-w-0 text-left">
                <strong className="block text-xs font-medium">不提供SKU图</strong>
                <small className="block text-[11px] text-[var(--text-subtle)]">可稍后再指定</small>
              </span>
            </button>
            {assets.map((asset, index) => {
              const isMain = mainAssetIds.includes(asset.id);
              return (
                <button
                  aria-selected={asset.id === draftAssetId}
                  className="sku-preview-dialog-option"
                  key={asset.id}
                  onClick={() => {
                    setDraftAssetId(asset.id);
                    setHoverAssetId("");
                    setZoom(1);
                  }}
                  onMouseEnter={() => setHoverAssetId(asset.id)}
                  onMouseLeave={() => setHoverAssetId("")}
                  role="option"
                  type="button"
                >
                  <span className="sku-preview-dialog-option-thumb">
                    {asset.previewUrl ? <img alt="" src={asset.previewUrl} /> : <Images size={18} />}
                  </span>
                  <span className="min-w-0 text-left">
                    <strong className="block text-xs font-medium">
                      {isMain
                        ? `商品主图 ${mainAssetIds.indexOf(asset.id) + 1}`
                        : `SKU图 ${index + 1}`}
                    </strong>
                    <small className="block truncate text-[11px] text-[var(--text-subtle)]">
                      {asset.originalName || "未命名图片"}
                    </small>
                  </span>
                </button>
              );
            })}
          </aside>
        </div>

        <footer className="flex flex-col gap-3 border-t border-[var(--line)] bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <label className="flex min-w-0 items-center gap-3 text-xs text-[var(--text-muted)]">
            <span className="shrink-0">放大查看</span>
            <input
              aria-label="SKU预览图放大"
              className="min-w-0 flex-1 accent-[var(--focus)] sm:w-64"
              max="4"
              min="1"
              onChange={(event) => setZoom(Number(event.target.value))}
              step="0.1"
              type="range"
              value={zoom}
            />
            <span className="w-10 text-right">{zoom.toFixed(1)}×</span>
          </label>
          <div className="flex justify-end gap-2">
            <Button onClick={onClose} type="button" variant="outline">取消</Button>
            <Button onClick={() => { onSelect(draftAssetId); onClose(); }} type="button">
              引用此图
            </Button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function prepareImageFile(file: File) {
  if (file.type) return file;
  const contentType = /\.jpe?g$/i.test(file.name)
    ? "image/jpeg"
    : /\.png$/i.test(file.name)
      ? "image/png"
      : "";
  return contentType
    ? new File([file], file.name, {
        type: contentType,
        lastModified: file.lastModified || Date.now(),
      })
    : file;
}

function readImageDimensions(file: File) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("无法读取图片尺寸"));
    };
    image.src = url;
  });
}

function savedImageAsset(asset: {
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
    contentType: String(asset.contentType || ""),
    width: asset.width ?? null,
    height: asset.height ?? null,
    sizeBytes: Number(asset.sizeBytes || 0),
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function draftImage(value: unknown, storeId: string): DraftProductImage | null {
  const source = record(value);
  const id = String(source.assetId || source.id || "").trim();
  if (!id) return null;
  return {
    id,
    storeId,
    purpose: "selected_unpublished",
    status: "ready",
    originalName: String(source.originalName || "已保存图片"),
    contentType: String(source.contentType || "image/jpeg"),
    sizeBytes: Number(source.sizeBytes || 0),
    width: Number(source.width) || null,
    height: Number(source.height) || null,
    referenceCount: 1,
    expiresAt: null,
    createdAt: null,
  };
}

function draftCompliancePhoto(value: unknown): DraftCompliancePhoto | null {
  const source = record(value);
  const localAssetRef = String(source.localAssetRef || "").trim();
  const labelGroup = String(source.labelGroup || "").trim();
  if (!/^media:[^\s]+$/i.test(localAssetRef) || !["1", "2"].includes(labelGroup)) {
    return null;
  }
  return {
    labelId: String(source.labelId || ""),
    labelGroup,
    labelName: String(source.labelName || ""),
    localAssetRef,
    fileName: String(source.fileName || "已保存实拍图"),
    mimeType: String(source.mimeType || "image/jpeg"),
    size: Number(source.size || 0),
    width: Number(source.width) || null,
    height: Number(source.height) || null,
  };
}

function savedCompliancePhoto(photo: DraftCompliancePhoto) {
  return {
    labelId: photo.labelId,
    labelGroup: photo.labelGroup,
    labelName: photo.labelName || "",
    localAssetRef: photo.localAssetRef,
    fileName: photo.fileName,
    mimeType: photo.mimeType,
    size: photo.size,
    width: photo.width ?? null,
    height: photo.height ?? null,
  };
}

function compliancePhotoAssetId(photo: DraftCompliancePhoto) {
  return photo.localAssetRef.replace(/^media:/i, "");
}

async function loadImageOcrFile(asset: DraftProductImage) {
  if (asset.sourceFile) return asset.sourceFile;
  if (!asset.previewUrl) throw new Error(`${asset.originalName}：没有可读取的图片预览`);
  const response = await fetch(asset.previewUrl);
  if (!response.ok) throw new Error(`${asset.originalName}：无法读取图片预览`);
  const blob = await response.blob();
  return new File([blob], asset.originalName || "sku-preview.jpg", {
    type: blob.type || asset.contentType || "image/jpeg",
  });
}

function hydrateProductDraft(
  draft: ProductDraft,
  category: PublishCategoryOption,
  storeId: string,
) {
  const data = record(draft.data);
  const imageAssets = record(data.imageAssets);
  const images = (value: unknown) => (Array.isArray(value) ? value : [])
    .map((item) => draftImage(item, storeId))
    .filter((item): item is DraftProductImage => Boolean(item));
  const savedSkuRows = (Array.isArray(data.skuRows) ? data.skuRows : [])
    .filter((row) => row && typeof row === "object" && !Array.isArray(row))
    .map((row, index) => ({
      ...(row as ProductSkuRow),
      id: String((row as ProductSkuRow).id || `${draft.id}:${index}`),
    }));
  return {
    draftId: draft.id,
    title: String(data.title || draft.name || ""),
    category,
    attributeValues: record(data.attributeValues) as Assignments,
    rugReportSources: Object.keys(record(data.rugReportSources)).length
      ? record(data.rugReportSources) as RugReportSources
      : null,
    titleRuleTemplateId: String(data.titleRuleTemplateId || ""),
    titleRuleBaseTitle: String(data.titleRuleBaseTitle || ""),
    attributeTemplateId: String(data.attributeTemplateId || ""),
    sizeTemplateId: String(data.sizeTemplateId || ""),
    packagingTemplateId: String(data.packagingTemplateId || ""),
    packagingMaterial: String(data.packagingMaterial || ""),
    commercialTemplateId: String(data.commercialTemplateId || ""),
    tailImageTemplateId: String(data.tailImageTemplateId || ""),
    complianceTemplateId: String(data.complianceTemplateId || ""),
    compliancePhotoSourceMode: data.compliancePhotoSourceMode === "manual"
      ? "manual" as const
      : "template" as const,
    compliancePhotoAssignments: (Array.isArray(data.compliancePhotoAssignments)
      ? data.compliancePhotoAssignments
      : [])
      .map(draftCompliancePhoto)
      .filter((item): item is DraftCompliancePhoto => Boolean(item)),
    supplierCode: String(data.supplierCode || ""),
    pricePerSquareMeter: String(data.pricePerSquareMeter || ""),
    gramsPerSquareMeter: String(data.gramsPerSquareMeter || ""),
    bulkInventory: String(data.bulkInventory || ""),
    colorMapping: Object.keys(record(data.colorSaleValue)).length
      ? record(data.colorSaleValue) as unknown as SaleValueMapping
      : null,
    skuRows: savedSkuRows,
    mainImages: images(imageAssets.main),
    detailImages: images(imageAssets.detail),
    squareImages: images(imageAssets.square),
    swatchImages: images(imageAssets.swatch),
    skuPreviewImages: images(data.skuPreviewImages),
  };
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
    </div>
  );
}

function AttributeEditor({
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
        option.id.toLocaleLowerCase().includes(normalizedQuery)
      )
    : field.values;
  const optionLabels = new Map(
    field.values.map((option) => [option.id, option.label]),
  );
  const selectedLabels = value.valueIds.map(
    (valueId) => optionLabels.get(valueId) || `${valueId}（当前 Schema 未返回）`,
  );
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
      className={`border-b border-[var(--line)] px-3 py-2.5 last:border-b-0 sm:px-4 ${
        invalid ? "bg-[var(--danger-soft)]/45" : ""
      }`}
      id={`draft-attribute-${field.id}`}
    >
      <div className="grid gap-2.5 lg:grid-cols-[170px_minmax(0,1fr)] lg:items-start">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            {field.required && <span className="text-[var(--danger)]">*</span>}
            <h3 className="text-xs font-medium text-[var(--ink)]">{field.name}</h3>
          </div>
          <p className="mt-0.5 text-[10px] text-[var(--text-subtle)]">
            ID {field.id} · {field.mode}
          </p>
        </div>
        <div className="min-w-0 space-y-2">
          {allowsPreset && !allowsMultiple && (
            <select
              aria-label={`${field.name}属性值`}
              aria-describedby={invalid ? `draft-attribute-error-${field.id}` : undefined}
              aria-invalid={invalid}
              className="field h-9 px-2.5 text-xs"
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
              <div className="rounded-md border border-[var(--line)] bg-[var(--page)] px-2.5 py-1.5 text-xs">
                <p className="font-medium text-[var(--ink)]">
                  已选 {selected.size}
                  {field.maxSelections > 0 ? ` / ${field.maxSelections}` : ""}
                </p>
                <p className="mt-0.5 break-words leading-4 text-[var(--text-subtle)]">
                  {selectedLabels.length ? selectedLabels.join("、") : "尚未选择"}
                </p>
              </div>
              {searchableOptionPicker && (
                <div className="relative">
                  <button
                    aria-expanded={optionPickerOpen}
                    aria-haspopup="listbox"
                    className="field flex h-9 w-full items-center justify-between gap-3 px-2.5 text-left text-xs"
                    onClick={() => setOptionPickerOpen((open) => !open)}
                    type="button"
                  >
                    <span className="truncate text-[var(--text-muted)]">
                      {selectedLabels.length ? selectedLabels.join("、") : "输入搜索并下拉选择"}
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
                        className="field h-9 pl-9 pr-3 text-xs"
                          onChange={(event) => setOptionQuery(event.target.value)}
                          placeholder={`搜索 ${field.values.length} 个 SHEIN 属性值`}
                          value={optionQuery}
                        />
                      </label>
                      <div className="mt-2 grid max-h-52 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2" role="listbox">
                        {visibleOptions.map((option) => {
                          const checked = selected.has(option.id);
                          const limitReached = field.maxSelections > 0 && selected.size >= field.maxSelections;
                          return (
                            <label
                              className="flex min-h-8 cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-muted)]"
                              key={option.id}
                            >
                              <input
                                aria-describedby={invalid ? `draft-attribute-error-${field.id}` : undefined}
                                aria-invalid={invalid}
                                checked={checked}
                                disabled={!checked && limitReached}
                                onChange={() => toggleValue(option.id)}
                                type="checkbox"
                              />
                              <span className="min-w-0 break-words">{option.label}</span>
                            </label>
                          );
                        })}
                        {!visibleOptions.length && (
                          <p className="col-span-full px-3 py-4 text-center text-xs text-[var(--text-subtle)]">
                            没有匹配的属性值
                          </p>
                        )}
                      </div>
                      <div className="mt-2 flex items-center justify-between border-t border-[var(--line)] pt-2">
                        <p className="text-xs text-[var(--text-subtle)]">
                          当前显示 {visibleOptions.length} / {field.values.length} 个官方值
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
              aria-describedby={invalid ? `draft-attribute-error-${field.id}` : undefined}
              aria-invalid={invalid}
              className="field h-9 px-2.5 text-xs"
              inputMode={numericCustomField ? "decimal" : undefined}
              maxLength={500}
              max={percentageComposition ? 100 : undefined}
              onChange={(event) =>
                onChange({ ...value, customValue: event.target.value })
              }
              placeholder={numericCustomField
                ? (percentageComposition
                  ? "填写成分百分比，如 100（不要输入 %）"
                  : quantityAttribute ? "填写数量，如 1" : "填写数字，如 1")
                : field.dataDimension === 2 ? "按 SHEIN 单位填写数字" : "按 SHEIN 属性要求填写"}
              type={numericCustomField ? "number" : "text"}
              value={value.customValue}
            />
          )}
          {allowsManual && numericCustomField && (
            <p className="text-[11px] leading-4 text-[var(--text-subtle)]">
              {percentageComposition
                ? "这里填写数字百分比，例如 100；不要输入 %。多个成分时合计应为 100%。"
                : quantityAttribute
                  ? "选择 SHEIN 官方单位后填写对应数量，例如选择“件”后填写 1。"
                  : "选择 SHEIN 官方值后填写对应数字附加值。"}
            </p>
          )}
          {!allowsPreset && !allowsManual && (
            <p className="text-xs text-[var(--warning)]">
              当前属性模式不能在草稿中填写
            </p>
          )}
          {invalid && (
            <p
              className="flex items-center gap-1.5 text-xs font-medium text-[var(--danger)]"
              id={`draft-attribute-error-${field.id}`}
            >
              <AlertCircle size={14} />
              此项为当前类目必填属性
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function sortAttributeFields(fields: AttributeField[]) {
  return fields
    .map((field, index) => ({ field, index }))
    .sort(({ field: left, index: leftIndex }, { field: right, index: rightIndex }) => {
      const leftName = String(left.name || "").toLocaleLowerCase();
      const rightName = String(right.name || "").toLocaleLowerCase();
      const craftRank = (name: string) =>
        /制作工艺|织造方式|织造|工艺|weaving|craft/.test(name) ? 0 : 1;
      return Number(!left.required) - Number(!right.required) ||
        craftRank(leftName) - craftRank(rightName) ||
        leftIndex - rightIndex;
    })
    .map(({ field }) => field);
}

export function NewProductPage() {
  const { currentStore, session } = useAppContext();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const storeId = currentStore?.id || "";
  const queryScope = `${session.tenant.id}:${session.user.id}`;
  const businessDashboard = useBusinessDashboard(storeId);
  const draftQueryId = String(searchParams.get("draft") || "").trim();
  const autoGenerateAiTitle = searchParams.get("aiTitle") === "1";
  const requestedDraftSection = String(searchParams.get("section") || "").trim();
  const returnBatchValue = String(searchParams.get("returnBatch") || "").trim();
  const returnBatchId = /^[0-9a-f-]{36}$/i.test(returnBatchValue)
    ? returnBatchValue
    : "";
  const [draftId, setDraftId] = useState("");
  const [title, setTitle] = useState("");
  const [titleRuleTemplateId, setTitleRuleTemplateId] = useState("");
  const [titleRuleBaseTitle, setTitleRuleBaseTitle] = useState("");
  const [aiTitleGenerating, setAiTitleGenerating] = useState(false);
  const [templateId, setTemplateId] = useState("");
  const [category, setCategory] = useState<PublishCategoryOption | null>(null);
  const [categoryTrailIds, setCategoryTrailIds] = useState<string[]>([]);
  const [categorySearch, setCategorySearch] = useState("");
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(true);
  const [attributeValues, setAttributeValues] = useState<Assignments>({});
  const [attributesExpanded, setAttributesExpanded] = useState(false);
  const [rugReportSources, setRugReportSources] =
    useState<RugReportSources | null>(null);
  const [sizeTemplateId, setSizeTemplateId] = useState("");
  const [packagingTemplateId, setPackagingTemplateId] = useState("");
  const [packagingMaterial, setPackagingMaterial] = useState("");
  const [commercialTemplateId, setCommercialTemplateId] = useState("");
  const [colorMapping, setColorMapping] = useState<SaleValueMapping | null>(null);
  const [colorInputValue, setColorInputValue] = useState("");
  const [supplierCode, setSupplierCode] = useState("");
  const [skuRows, setSkuRows] = useState<ProductSkuRow[]>([]);
  const [mainImages, setMainImages] = useState<DraftProductImage[]>([]);
  const [detailImages, setDetailImages] = useState<DraftProductImage[]>([]);
  const [squareImages, setSquareImages] = useState<DraftProductImage[]>([]);
  const [swatchImages, setSwatchImages] = useState<DraftProductImage[]>([]);
  const [tailImageTemplateId, setTailImageTemplateId] = useState("");
  const [complianceTemplateId, setComplianceTemplateId] = useState("");
  const [compliancePhotoSourceMode, setCompliancePhotoSourceMode] =
    useState<CompliancePhotoSourceMode>("template");
  const [compliancePhotoAssignments, setCompliancePhotoAssignments] =
    useState<DraftCompliancePhoto[]>([]);
  const [compliancePhotoUploading, setCompliancePhotoUploading] = useState(false);
  const [productImageUploading, setProductImageUploading] = useState(false);
  const [skuPreviewImages, setSkuPreviewImages] = useState<DraftProductImage[]>([]);
  const [skuImageUploading, setSkuImageUploading] = useState(false);
  const [skuImageMatching, setSkuImageMatching] = useState(false);
  const [skuPickerRowId, setSkuPickerRowId] = useState<string | null>(null);
  const [skuImageProgress, setSkuImageProgress] = useState<{
    completed: number;
    total: number;
    phase: string;
  } | null>(null);
  const [pricePerSquareMeter, setPricePerSquareMeter] = useState("");
  const [gramsPerSquareMeter, setGramsPerSquareMeter] = useState("");
  const [bulkInventory, setBulkInventory] = useState("");
  const [skuFeedback, setSkuFeedback] = useState<{
    tone: "success" | "danger";
    message: string;
  } | null>(null);
  const [saveAttempted, setSaveAttempted] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "danger";
    message: string;
  } | null>(null);
  const skuImageInputRef = useRef<HTMLInputElement>(null);
  const importedBlobUrlsRef = useRef(new Set<string>());
  const hydratedDraftRef = useRef("");
  const focusedDraftSectionRef = useRef("");
  const aiTitleAutoStartedRef = useRef(false);

  useEffect(() => () => {
    importedBlobUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    importedBlobUrlsRef.current.clear();
    hydratedDraftRef.current = "";
    focusedDraftSectionRef.current = "";
    aiTitleAutoStartedRef.current = false;
  }, []);

  useEffect(() => {
    importedBlobUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    importedBlobUrlsRef.current.clear();
    hydratedDraftRef.current = "";
    focusedDraftSectionRef.current = "";
    setDraftId("");
    setTitle("");
    setTitleRuleTemplateId("");
    setTemplateId("");
    setCategory(null);
    setCategoryTrailIds([]);
    setCategoryPickerOpen(true);
    setAttributeValues({});
    setAttributesExpanded(false);
    setRugReportSources(null);
    setSizeTemplateId("");
    setPackagingTemplateId("");
    setPackagingMaterial("");
    setCommercialTemplateId("");
    setColorMapping(null);
    setColorInputValue("");
    setSupplierCode("");
    setSkuRows([]);
    setMainImages([]);
    setDetailImages([]);
    setSquareImages([]);
    setSwatchImages([]);
    setTailImageTemplateId("");
    setComplianceTemplateId("");
    setCompliancePhotoSourceMode("template");
    setCompliancePhotoAssignments([]);
    setCompliancePhotoUploading(false);
    setProductImageUploading(false);
    setSkuPreviewImages([]);
    setSkuImageUploading(false);
    setSkuImageMatching(false);
    setSkuPickerRowId(null);
    setPricePerSquareMeter("");
    setGramsPerSquareMeter("");
    setBulkInventory("");
    setSkuFeedback(null);
    setSaveAttempted(false);
    setFeedback(null);
    aiTitleAutoStartedRef.current = false;
  }, [draftQueryId, storeId]);

  const categories = useQuery({
    queryKey: ["store", queryScope, storeId, "publish-categories"],
    queryFn: () => api.publishCategories(storeId),
    enabled: Boolean(storeId),
    refetchOnMount: false,
  });
  const draftsQuery = useQuery({
    queryKey: ["store", queryScope, storeId, "product-drafts", "history"],
    queryFn: () => api.productDrafts(storeId, { includePublishHistory: true }),
    enabled: Boolean(storeId && draftQueryId),
    refetchOnMount: false,
  });
  const schemaCoverage = useQuery({
    queryKey: ["store", queryScope, storeId, "publish-schema-coverage"],
    queryFn: () => api.publishSchemaCoverage(storeId),
    enabled: Boolean(storeId),
    refetchOnMount: false,
  });
  const templates = useQuery({
    queryKey: ["store", queryScope, storeId, "publish-templates", "attribute"],
    queryFn: () => api.attributeTemplates(storeId),
    enabled: Boolean(storeId),
    refetchOnMount: false,
  });
  const titleRuleTemplates = useQuery({
    queryKey: ["store", queryScope, storeId, "publish-templates", "title_rule"],
    queryFn: () => api.titleRuleTemplates(storeId),
    enabled: Boolean(storeId),
    refetchOnMount: false,
  });
  const aiTitleCapability = useQuery({
    queryKey: ["store", queryScope, storeId, "ai-title-capability"],
    queryFn: () => api.aiTitleCapability(storeId),
    enabled: Boolean(storeId),
    refetchOnMount: false,
    staleTime: 60_000,
  });
  const sizeTemplates = useQuery({
    queryKey: ["store", queryScope, storeId, "publish-templates", "size"],
    queryFn: () => api.sizeTemplates(storeId),
    enabled: Boolean(storeId),
    refetchOnMount: false,
  });
  const packagingTemplates = useQuery({
    queryKey: ["store", queryScope, storeId, "publish-templates", "packaging"],
    queryFn: () => api.packagingTemplates(storeId),
    enabled: Boolean(storeId),
    refetchOnMount: false,
  });
  const tailImageTemplates = useQuery({
    queryKey: ["store", queryScope, storeId, "publish-templates", "tail_image"],
    queryFn: () => api.tailImageTemplates(storeId),
    enabled: Boolean(storeId),
    refetchOnMount: false,
  });
  const complianceTemplates = useQuery({
    queryKey: ["store", queryScope, storeId, "publish-templates", "compliance"],
    queryFn: () => api.complianceTemplates(storeId),
    enabled: Boolean(storeId),
    refetchOnMount: false,
  });
  const categoryTree = useMemo(
    () => normalizeCategoryTree(categories.data?.info),
    [categories.data],
  );
  const leafCategories = useMemo(
    () => flattenLeafCategories(categories.data?.info),
    [categories.data],
  );
  useEffect(() => {
    if (!draftQueryId || !draftsQuery.data || !leafCategories.length) return;
    const hydrationKey = `${storeId}:${draftQueryId}`;
    if (hydratedDraftRef.current === hydrationKey) return;
    const draft = draftsQuery.data.drafts.find((item) => item.id === draftQueryId);
    if (!draft) {
      hydratedDraftRef.current = hydrationKey;
      setFeedback({ tone: "danger", message: "当前店铺中没有找到该商品草稿" });
      return;
    }
    const savedCategory = leafCategories.find((item) =>
      item.categoryId === draft.categoryId &&
      item.productTypeId === draft.productTypeId
    );
    if (!savedCategory) {
      hydratedDraftRef.current = hydrationKey;
      setFeedback({
        tone: "danger",
        message: "草稿原类目已不在当前 SHEIN 类目树中，请新建草稿或重新选择类目",
      });
      return;
    }
    const hydrated = hydrateProductDraft(draft, savedCategory, storeId);
    hydratedDraftRef.current = hydrationKey;
    const trail = findCategoryTrail(categoryTree, savedCategory.categoryId);
    setDraftId(hydrated.draftId);
    setTitle(hydrated.title);
    setTitleRuleBaseTitle(hydrated.titleRuleBaseTitle);
    setCategory(hydrated.category);
    setCategoryTrailIds(trail.map((item) => item.categoryId));
    setCategoryPickerOpen(false);
    setAttributeValues(hydrated.attributeValues);
    setAttributesExpanded(false);
    setRugReportSources(hydrated.rugReportSources);
    setTitleRuleTemplateId(hydrated.titleRuleTemplateId);
    setTemplateId(hydrated.attributeTemplateId);
    setSizeTemplateId(hydrated.sizeTemplateId);
    setPackagingTemplateId(hydrated.packagingTemplateId);
    setPackagingMaterial(hydrated.packagingMaterial);
    setCommercialTemplateId(hydrated.commercialTemplateId);
    setTailImageTemplateId(hydrated.tailImageTemplateId);
    setComplianceTemplateId(hydrated.complianceTemplateId);
    setCompliancePhotoSourceMode(hydrated.compliancePhotoSourceMode);
    setCompliancePhotoAssignments(hydrated.compliancePhotoAssignments.map((photo) => {
      const assetId = compliancePhotoAssetId(photo);
      return {
        ...photo,
        previewUrl: assetId ? api.mediaContentUrl(storeId, assetId) : photo.previewUrl,
      };
    }));
    setSupplierCode(
      normalizeSupplierCode(hydrated.supplierCode) || defaultSupplierCode(savedCategory.path),
    );
    setPricePerSquareMeter(hydrated.pricePerSquareMeter);
    setGramsPerSquareMeter(hydrated.gramsPerSquareMeter);
    setBulkInventory(hydrated.bulkInventory);
    setColorMapping(hydrated.colorMapping);
    setColorInputValue(
      hydrated.colorMapping?.customValue || hydrated.colorMapping?.valueLabel || "",
    );
    setSkuRows(hydrated.skuRows);
    const attachStablePreview = (images: DraftProductImage[]) => images.map((asset) => ({
      ...asset,
      previewUrl: asset.id ? api.mediaContentUrl(storeId, asset.id) : asset.previewUrl,
    }));
    setMainImages(attachStablePreview(hydrated.mainImages));
    setDetailImages(attachStablePreview(hydrated.detailImages));
    setSquareImages(attachStablePreview(hydrated.squareImages));
    setSwatchImages(attachStablePreview(hydrated.swatchImages));
    setSkuPreviewImages(attachStablePreview(hydrated.skuPreviewImages));
    setSaveAttempted(false);
    setFeedback({ tone: "success", message: `已载入商品草稿“${draft.name}”` });

  }, [categoryTree, draftQueryId, draftsQuery.data, leafCategories, storeId]);
  const categoryColumns = useMemo(() => {
    const columns: Array<{ nodes: PublishCategoryNode[]; activeId: string }> = [];
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
    const trail = category
      ? findCategoryTrail(categoryTree, category.categoryId)
      : findFirstLeafTrail(categoryTree);
    setCategoryTrailIds(
      category ? trail.map((node) => node.categoryId) : trail.slice(0, -1).map(
        (node) => node.categoryId,
      ),
    );
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
    refetchOnMount: false,
  });
  useEffect(() => {
    if (!category || !schema.dataUpdatedAt) return;
    void schemaCoverage.refetch();
  }, [category?.categoryId, category?.productTypeId, schema.dataUpdatedAt]);
  const fields = useMemo(
    () => category && schema.data
      ? buildAttributeFields(schema.data.attributes, category.productTypeId)
      : [],
    [category, schema.data],
  );
  const orderedAttributeFields = useMemo(
    () => sortAttributeFields(fields),
    [fields],
  );
  const saleSchema = useMemo(
    () => category && schema.data
      ? buildSaleAttributeSchema(
          schema.data.attributes,
          category.productTypeId,
          schema.data.customAttributePermissions,
        )
      : { mainAttributeStatus: 0, fields: [], sizeFields: [] },
    [category, schema.data],
  );
  const selectedPackagingTemplate = packagingTemplates.data?.templates.find(
    (template) => template.id === packagingTemplateId,
  ) || null;
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
  const currentSchemaReady = Boolean(
    schema.data &&
    Object.keys(schema.data.attributes || {}).length > 0 &&
    Object.keys(schema.data.publishStandard || {}).length > 0,
  );
  const coverageReady = selectedCoverage?.ready === true || currentSchemaReady;
  useEffect(() => {
    if (!draftQueryId || !requestedDraftSection || !category) return;
    if (schema.isFetching || schemaCoverage.isFetching) return;
    const hydrationKey = `${storeId}:${draftQueryId}`;
    const focusKey = `${hydrationKey}:${requestedDraftSection}`;
    if (hydratedDraftRef.current !== hydrationKey || focusedDraftSectionRef.current === focusKey) return;
    focusedDraftSectionRef.current = focusKey;
    setSaveAttempted(true);
    const frame = window.requestAnimationFrame(() => {
      const section = document.getElementById(productDraftSectionAnchor(requestedDraftSection));
      section?.scrollIntoView({ behavior: "auto", block: "start" });
      section?.querySelector<HTMLElement>("input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])")?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [category, draftQueryId, requestedDraftSection, schema.isFetching, schemaCoverage.isFetching, storeId]);
  const packagedSkuRows = useMemo(
    () => applyPackagingTemplate(
      ensureSupplierSkuRows(skuRows, supplierCode),
      selectedPackagingTemplate,
      packagingMaterial,
    ),
    [packagingMaterial, selectedPackagingTemplate, skuRows, supplierCode],
  );
  const resolvedSkuRows = useMemo(
    () => reconcileSkuSizeMappings(
      packagedSkuRows,
      saleSchema,
      colorMapping,
    ),
    [colorMapping, packagedSkuRows, saleSchema],
  );
  const publishStandard = schema.data?.publishStandard as {
    currency?: unknown;
    weight_config?: unknown;
    length_width_height_config?: unknown;
    picture_config_list?: unknown;
    fill_in_standard_list?: unknown;
    default_language?: unknown;
    default_language_title_max_length?: unknown;
  } | undefined;
  const pictureConfig = Array.isArray(publishStandard?.picture_config_list)
    ? publishStandard.picture_config_list
    : [];
  const fillInStandard = Array.isArray(publishStandard?.fill_in_standard_list)
    ? publishStandard.fill_in_standard_list
    : [];
  const defaultLanguage = String(
    publishStandard?.default_language || "",
  ).trim();
  const contentStage = buildProductContentStage({
    title,
    defaultLanguage,
    titleMaxLength: publishStandard?.default_language_title_max_length as
      | number
      | string
      | null,
  });
  const selectedTailImageTemplate =
    tailImageTemplates.data?.templates.find(
      (template) => template.id === tailImageTemplateId,
    ) || null;
  const imageStage = useMemo(
    () => buildProductImageStage({
      mainImages,
      detailImages,
      squareImages,
      swatchImages,
      tailTemplate: selectedTailImageTemplate,
      pictureConfig,
      fillInStandard,
    }),
    [
      detailImages,
      fillInStandard,
      mainImages,
      squareImages,
      swatchImages,
      pictureConfig,
      selectedTailImageTemplate,
    ],
  );
  const currency = String(publishStandard?.currency || "").trim();
  const weightRequired = configRequired(publishStandard?.weight_config);
  const publishSettingsStage = useMemo(
    () => buildProductPublishSettingsStage({
      businessMode: currentStore?.businessMode || "",
    }),
    [currentStore?.businessMode],
  );
  const skuValidation = validateSkuStage({
    saleSchema,
    supplierCode,
    sizeTemplateId,
    colorMapping,
    rows: resolvedSkuRows,
    packagingTemplateId,
    packagingMaterial,
    currency,
    weightRequired,
  });
  const colorOptions = saleValueOptions(
    saleSchema.fields.filter((field) => field.labelCode === 1),
  );
  const customColorAllowed = saleSchema.fields.filter(
    (field) => field.labelCode === 1 && field.customValueAllowed,
  ).length === 1;
  const packagingMaterials = Object.keys(
    selectedPackagingTemplate?.data.materials || {},
  );
  const validation = validateAttributeAssignments(fields, attributeValues);
  const invalidIds = new Set(saveAttempted
    ? [...validation.missingFieldIds, ...validation.invalidFieldIds]
    : []);
  useEffect(() => {
    if (saveAttempted && (validation.missingFieldIds.length || validation.invalidFieldIds.length)) {
      setAttributesExpanded(true);
    }
  }, [saveAttempted, validation.invalidFieldIds.length, validation.missingFieldIds.length]);
  const missingRequiredFields = validation.missingFieldIds.map((id, index) => ({
    id,
    name: validation.missingFieldNames[index] || id,
  }));
  const titleIssue = contentStage.blockers.find(
    (item) => item.code.startsWith("PRODUCT_TITLE"),
  );
  const selectedComplianceTemplate =
    complianceTemplates.data?.templates.find(
      (template) => template.id === complianceTemplateId,
    ) || null;
  const complianceStage = useMemo(
    () => buildProductComplianceStage({
      template: compliancePhotoSourceMode === "template"
        ? selectedComplianceTemplate
        : null,
      categoryId: category?.categoryId || "",
      photoSourceMode: compliancePhotoSourceMode,
      manualPhotos: compliancePhotoAssignments,
    }),
    [
      category?.categoryId,
      compliancePhotoAssignments,
      compliancePhotoSourceMode,
      selectedComplianceTemplate,
    ],
  );
  const formBlockers = [
    ...(!category ? ["末级类目未选择"] : []),
    ...(category && !coverageReady
      ? [
          schemaCoverage.error
            ? "当前类目官方 schema 覆盖状态读取失败"
            : "当前类目官方 schema 尚未完整同步",
        ]
      : []),
    ...contentStage.blockers
      .filter((item) => category || item.code !== "DEFAULT_LANGUAGE_MISSING")
      .map((item) => item.message),
    ...validation.missingFieldNames.map((name) => `必填属性“${name}”未填写`),
    ...validation.invalidFieldNames.map((name) => `属性“${name}”需要官方值和数字附加值`),
    ...(category ? publishSettingsStage.blockers.map((item) => item.message) : []),
  ];
  const blockers = [
    ...formBlockers,
    ...(category ? imageStage.blockers.map((item) => item.message) : []),
    ...(category ? skuValidation.blockers.map((item) => item.message) : []),
  ];
  const completedRequired = Math.max(
    0,
    fields.filter((field) => field.required).length -
      validation.missingFieldIds.length + validation.invalidFieldIds.length,
  );

  const focusAttribute = (fieldId: string) => {
    const section = document.getElementById(`draft-attribute-${fieldId}`);
    if (!section) return;
    section.scrollIntoView({ behavior: "smooth", block: "center" });
    section.querySelector<HTMLElement>("select, input, textarea")?.focus({
      preventScroll: true,
    });
  };

  const scrollToProductStage = (sectionId: string) => {
    document.getElementById(sectionId)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  const applyTitleTemplate = (nextTemplateId: string) => {
    setTitleRuleTemplateId(nextTemplateId);
    const template = titleRuleTemplates.data?.templates.find(
      (item) => item.id === nextTemplateId,
    );
    if (!template) {
      setFeedback(null);
      return;
    }
    const previousRule = titleRuleTemplates.data?.templates.find(
      (item) => item.id === titleRuleTemplateId,
    )?.data;
    const baseTitle = titleRuleBaseTitle || stripTitleRuleFragments(
      title,
      previousRule || (titleRuleTemplateId === nextTemplateId ? template.data : {}),
    );
    const nextTitle = applyTitleRule(baseTitle, template.data);
    setTitleRuleBaseTitle(baseTitle);
    setTitle(nextTitle);
    setSaveAttempted(false);
    setFeedback({
      tone: "success",
      message: `已引用标题规则“${template.name}”，保存时仍会按 SHEIN 标题规范校验`,
    });
  };

  const generateAiTitle = async () => {
    if (aiTitleGenerating || !storeId) return;
    const template = titleRuleTemplates.data?.templates.find((item) => item.id === titleRuleTemplateId);
    const request = buildAiTitleRequest({
      mainImageAssetId: mainImages[0]?.id,
      titleRuleTemplateId,
      titleRule: template?.data,
      currentTitle: title,
      titleMaxLength: contentStage.titleMaxLength,
      locale: defaultLanguage,
    });
    if (!request.valid) {
      setFeedback({ tone: "danger", message: request.error || "AI 标题输入不完整" });
      return;
    }
    setAiTitleGenerating(true);
    try {
      const result = await api.suggestAiTitle(storeId, request.input);
      const composed = composeAiTitle({
        rule: template?.data,
        patternName: result.patternName,
        maxLength: contentStage.titleMaxLength,
      });
      if (!composed.valid) {
        setFeedback({ tone: "danger", message: "AI 未能生成符合标题模板的结果，请检查标题规则后重试" });
        return;
      }
      setTitle(composed.title);
      setTitleRuleBaseTitle(composed.patternName);
      setSaveAttempted(false);
      setFeedback({
        tone: "success",
        message: `AI 已识别图案“${composed.patternName}”，标题已按模板替换生成${result.confidence == null ? "" : `（置信度 ${Math.round(result.confidence * 100)}%）`}`,
      });
    } catch (error) {
      const message = error instanceof ApiError && error.traceId
        ? `${error.message}（Trace ${error.traceId}）`
        : error instanceof Error ? error.message : "AI 标题生成失败，请稍后重试";
      setFeedback({ tone: "danger", message });
    } finally {
      setAiTitleGenerating(false);
    }
  };

  useEffect(() => {
    if (!autoGenerateAiTitle || !draftId || !mainImages.length || !titleRuleTemplateId) return;
    if (!titleRuleTemplates.data?.templates.some((template) => template.id === titleRuleTemplateId)) return;
    if (aiTitleCapability.data?.visible !== true || aiTitleGenerating || aiTitleAutoStartedRef.current) return;
    aiTitleAutoStartedRef.current = true;
    void generateAiTitle();
  }, [autoGenerateAiTitle, aiTitleCapability.data?.visible, aiTitleGenerating, draftId, mainImages.length, titleRuleTemplateId, titleRuleTemplates.data?.templates]);

  const chooseCategory = (node: PublishCategoryNode | PublishCategoryOption) => {
    const trail = findCategoryTrail(categoryTree, node.categoryId);
    setCategoryTrailIds(trail.map((item) => item.categoryId));
    if (("lastCategory" in node && !node.lastCategory) || !node.productTypeId) return;
    setCategory({
      categoryId: node.categoryId,
      productTypeId: node.productTypeId,
      name: node.name,
      path: trail.map((item) => item.name),
    });
    setSupplierCode((current) => normalizeSupplierCode(current) || defaultSupplierCode(trail.map((item) => item.name)));
    setTemplateId("");
    setAttributeValues({});
    setAttributesExpanded(false);
    setRugReportSources(null);
    setSizeTemplateId("");
    setPackagingTemplateId("");
    setPackagingMaterial("");
    setColorMapping(null);
    setColorInputValue("");
    setSkuRows([]);
    setComplianceTemplateId("");
    setPricePerSquareMeter("");
    setGramsPerSquareMeter("");
    setBulkInventory("");
    setSkuFeedback(null);
    setCategoryPickerOpen(false);
    setCategorySearch("");
    setSaveAttempted(false);
    setFeedback(null);
  };

  const applyTemplate = (nextTemplateId: string) => {
    setTemplateId(nextTemplateId);
    const template = templates.data?.templates.find(
      (item) => item.id === nextTemplateId,
    );
    if (!template) {
      setAttributeValues({});
      setRugReportSources(null);
      setFeedback(null);
      return;
    }
    const nextCategory = leafCategories.find(
      (item) =>
        item.categoryId === template.categoryId &&
        item.productTypeId === template.productTypeId,
    );
    if (!nextCategory) {
      setTemplateId("");
      setFeedback({
        tone: "danger",
        message: `模板“${template.name}”的类目已不在当前店铺类目树中`,
      });
      return;
    }
    const sameTemplate = templateId === nextTemplateId;
    const sameCategory = category?.categoryId === nextCategory.categoryId &&
      category?.productTypeId === nextCategory.productTypeId;
    if (sameTemplate && sameCategory) {
      setAttributeValues(Object.fromEntries(
        (template.data.assignments || []).map((assignment) => [
          assignment.attributeId,
          {
            valueIds: assignment.valueIds || [],
            customValue: assignment.customValue || "",
          },
        ]),
      ));
      setRugReportSources(template.data.rugReportSources || null);
      setSaveAttempted(false);
      setFeedback({ tone: "success", message: `已重新引用商品属性模板“${template.name}”，其他 SKU 与图片数据保持不变` });
      return;
    }
    setCategory(nextCategory);
    setSupplierCode((current) => normalizeSupplierCode(current) || defaultSupplierCode(nextCategory.path));
    setCategoryPickerOpen(false);
    setSizeTemplateId("");
    setPackagingTemplateId("");
    setPackagingMaterial("");
    setColorMapping(null);
    setColorInputValue("");
    setSkuRows([]);
    setComplianceTemplateId("");
    setPricePerSquareMeter("");
    setGramsPerSquareMeter("");
    setBulkInventory("");
    setSkuFeedback(null);
    setAttributeValues(Object.fromEntries(
      (template.data.assignments || []).map((assignment) => [
        assignment.attributeId,
        {
          valueIds: assignment.valueIds || [],
          customValue: assignment.customValue || "",
        },
      ]),
    ));
    setAttributesExpanded(false);
    setRugReportSources(template.data.rugReportSources || null);
    setSaveAttempted(false);
    setFeedback(null);
  };

  const applySizeTemplate = (nextTemplateId: string) => {
    setSizeTemplateId(nextTemplateId);
    const template = sizeTemplates.data?.templates.find(
      (item) => item.id === nextTemplateId,
    );
    if (!template) {
      setColorMapping(null);
      setColorInputValue("");
      setSkuRows([]);
      setFeedback(null);
      return;
    }
    if (!category || !schema.data) {
      setSkuFeedback({
        tone: "danger",
        message: "当前 SHEIN 尺寸规则尚未读取完成，请稍后再重新引用",
      });
      return;
    }
    const next = buildSkuStageFromSizeTemplate(template, saleSchema);
    if (!next.rows.length || !next.colorMapping) {
      setSkuFeedback({
        tone: "danger",
        message: "当前尺寸模板无法匹配本店铺 SHEIN 规则，请刷新规则后重试",
      });
      return;
    }
    const nextSupplierCode = normalizeSupplierCode(supplierCode) || defaultSupplierCode(category?.path || []);
    if (!supplierCode.trim()) setSupplierCode(nextSupplierCode);
    setColorMapping(next.colorMapping);
    setColorInputValue(String(template.data.colorText || ""));
    const codedRows = ensureSupplierSkuRows(
      applySupplierSkuPrefix(next.rows, nextSupplierCode),
      nextSupplierCode,
    );
    const mappedRows = autoMapSkuPreviewImages(codedRows, skuPreviewImages).rows;
    setCommercialTemplateId("");
    setSkuRows(mappedRows);
    setSaveAttempted(false);
    setSkuFeedback({
      tone: "success",
      message: `已重新引用尺寸模板“${template.name}”，SKU 尺寸与颜色已替换`,
    });
    setFeedback(null);
  };

  const applyPackaging = (nextTemplateId: string) => {
    setPackagingTemplateId(nextTemplateId);
    setPackagingMaterial("");
    setSaveAttempted(false);
    setFeedback(null);
  };

  const applyPackagingMaterial = (nextMaterial: string) => {
    setPackagingMaterial(nextMaterial);
    const template = packagingTemplates.data?.templates.find(
      (item) => item.id === packagingTemplateId,
    );
    if (template && nextMaterial) {
      setSkuRows((current) => applyPackagingTemplate(
        current,
        template,
        nextMaterial,
        { overwrite: true },
      ));
    }
    setSaveAttempted(false);
    setFeedback(null);
  };

  const reapplyPackaging = () => {
    if (!selectedPackagingTemplate || !packagingMaterial) {
      setSkuFeedback({
        tone: "danger",
        message: "请先选择打包体积模板和材质，再点击重新引用",
      });
      return;
    }
    const nextRows = applyPackagingTemplate(
      skuRows,
      selectedPackagingTemplate,
      packagingMaterial,
      { overwrite: true },
    );
    const matched = nextRows.filter((row) => row.packageMatch === "matched").length;
    const unmatched = nextRows.filter((row) => row.packageMatch !== "matched");
    setSkuRows(nextRows);
    setSkuFeedback({
      tone: unmatched.length ? "danger" : "success",
      message: unmatched.length
        ? `已重新引用：${matched}/${nextRows.length} 个 SKU 匹配成功；${unmatched.map((row) => row.sizeText || row.id).join("、")} 在当前模板中没有对应打包体积，请补充模板或手动填写`
        : `已重新引用当前打包体积，${matched} 个 SKU 已替换为模板数据`,
    });
    setFeedback(null);
  };

  const updateSkuRow = (
    rowId: string,
    patch: Partial<ProductSkuRow>,
  ) => {
    setSkuRows((current) => current.map((row) => {
      if (row.id !== rowId) return row;
      const next = { ...row, ...patch };
      if ("packageLengthCm" in patch || "packageWidthCm" in patch || "packageHeightCm" in patch) {
        // Keep partial manual input visible; template derivation must not
        // write old template values back while the user fills the other fields.
        next.packageMatch = "manual";
      }
      return next;
    }));
    setSkuFeedback(null);
    setFeedback(null);
  };

  const applyBulkPrice = () => {
    const value = Number(pricePerSquareMeter);
    if (!skuRows.length || !Number.isFinite(value) || value <= 0) {
      setSkuFeedback({
        tone: "danger",
        message: "请先生成 SKU，并输入大于0的每平方米供货价",
      });
      return;
    }
    const next = applyPricePerSquareMeter(skuRows, value);
    if (next.some((row) =>
      !(Number(row.costPrice) > 0) || Number(row.costPrice) > 100000
    )) {
      setSkuFeedback({
        tone: "danger",
        message: "换算后存在0元或超过100000的SKU供货价，请调整每平方米单价",
      });
      return;
    }
    setCommercialTemplateId("");
    setSkuRows(next);
    setSkuFeedback({
      tone: "success",
      message: `已按成品面积计算 ${next.length} 个 SKU 的供货价`,
    });
  };

  const applyBulkWeight = () => {
    const value = Number(gramsPerSquareMeter);
    if (!skuRows.length || !Number.isFinite(value) || value <= 0) {
      setSkuFeedback({
        tone: "danger",
        message: "请先生成 SKU，并输入大于0的每平方米克重",
      });
      return;
    }
    const next = applyGramsPerSquareMeter(skuRows, value);
    if (next.some((row) => !(Number(row.weightGrams) > 0))) {
      setSkuFeedback({
        tone: "danger",
        message: "换算后存在小于1克的SKU重量，请调整每平方米克重",
      });
      return;
    }
    setCommercialTemplateId("");
    setSkuRows(next);
    setSkuFeedback({
      tone: "success",
      message: `已按成品面积估算 ${next.length} 个 SKU 的商品重量，请核对包装增重`,
    });
  };

  const applyBulkInventory = () => {
    const value = Number(bulkInventory);
    if (
      !skuRows.length ||
      !Number.isInteger(value) ||
      value < 0 ||
      value > 99999
    ) {
      setSkuFeedback({
        tone: "danger",
        message: "请先生成 SKU，并输入0到99999的整数库存",
      });
      return;
    }
    const next = applyInventoryToAll(skuRows, value);
    setSkuRows(next);
    setSkuFeedback({
      tone: "success",
      message: `已给 ${next.length} 个 SKU 统一填写库存`,
    });
  };

  const smartMatchSkuPreviewImages = async () => {
    if (!mainImages.length || !skuRows.length) {
      setSkuFeedback({ tone: "danger", message: "请先上传商品主图并生成SKU尺寸行" });
      return;
    }
    const sourceImages = mainImages;
    const rowsForMatching: ProductSkuRow[] = skuRows.map((row) => (
      ["per_sku_ocr", "per_sku_filename", "shared_main", "shared_sku"].includes(row.imageAssetSource || "")
        ? { ...row, imageAssetId: "", imageAssetSource: undefined }
        : row
    ));
    setSkuImageMatching(true);
    setSkuImageProgress({ completed: 0, total: sourceImages.length, phase: "智能识别商品主图" });
    setSkuFeedback(null);
    try {
      let completed = 0;
      const outcomes = await Promise.allSettled(sourceImages.map(async (asset) => {
        try {
          const file = await loadImageOcrFile(asset);
          const recognizedText = await recognizeSkuImageText(file);
          return { asset, recognizedText };
        } finally {
          completed += 1;
          setSkuImageProgress({ completed, total: sourceImages.length, phase: "智能识别商品主图" });
        }
      }));
      const recognizedAssets = sourceImages.map((asset, index) => {
        const result = outcomes[index];
        return result?.status === "fulfilled" && result.value.recognizedText
          ? { ...asset, recognizedText: result.value.recognizedText }
          : asset;
      });
      const ocrMapping = autoMapSkuPreviewImagesByOcr(rowsForMatching, recognizedAssets);
      const mapping = autoMapSkuPreviewImages(ocrMapping.rows, recognizedAssets);
      const matchedByOcr = mapping.rows.filter((row) => row.imageAssetSource === "per_sku_ocr").length;
      const matchedByFilename = mapping.rows.filter((row) => row.imageAssetSource === "per_sku_filename").length;
      const unsupportedCount = outcomes.filter(
        (result) => result.status === "rejected" && result.reason?.code === "OCR_UNSUPPORTED",
      ).length;
      const failedCount = outcomes.filter((result) => result.status === "rejected").length;
      setMainImages((current) => current.map((asset) => {
        const recognized = recognizedAssets.find((item) => item.id === asset.id);
        return recognized || asset;
      }));
      setSkuRows(mapping.rows);
      setSkuFeedback({
        tone: unsupportedCount || failedCount || ocrMapping.ambiguousAssetIds.length || mapping.ambiguousAssetIds.length || mapping.unmatchedAssetIds.length
          ? "danger"
          : "success",
        message: [
          `智能匹配完成：从商品主图识别并匹配 ${matchedByOcr} 个SKU`,
          matchedByFilename ? `，文件名回退匹配 ${matchedByFilename} 个` : "",
          unsupportedCount ? "；当前浏览器没有原生 OCR，已尝试文件名/尺寸回退，请在缩略图面板确认未匹配项" : "",
          failedCount && !unsupportedCount ? `；识别失败 ${failedCount} 张` : "",
          ocrMapping.ambiguousAssetIds.length || mapping.ambiguousAssetIds.length
            ? `；${ocrMapping.ambiguousAssetIds.length + mapping.ambiguousAssetIds.length} 张匹配存在歧义`
            : "",
          mapping.unmatchedAssetIds.length ? `；${mapping.unmatchedAssetIds.length} 张未匹配` : "",
          "。",
        ].join(""),
      });
      setSkuImageProgress({ completed, total: sourceImages.length, phase: "智能匹配完成" });
    } catch (error) {
      setSkuFeedback({
        tone: "danger",
        message: error instanceof Error ? error.message : "SKU图片智能匹配失败",
      });
    } finally {
      setSkuImageMatching(false);
    }
  };

  const uploadSkuPreviewImages = async (fileInputs: FileList | null) => {
    const files = Array.from(fileInputs || []).map(prepareImageFile);
    if (!files.length || !skuRows.length) return;
    setSkuImageUploading(true);
    setSkuImageProgress({ completed: 0, total: files.length, phase: "压缩并上传SKU预览图" });
    setSkuFeedback(null);
    try {
      let completed = 0;
      let compressedCount = 0;
      const outcomes = await Promise.allSettled(files.map(async (sourceFile) => {
        try {
          const compressed = await compressProductImage(sourceFile);
          if (compressed.compressed) compressedCount += 1;
          const file = compressed.file;
          if (!["image/jpeg", "image/png"].includes(file.type)) {
            throw new Error(`${file.name}：SKU图仅支持 JPG、JPEG、PNG`);
          }
          const dimensions = await readImageDimensions(file);
          const issues = validatePublishImage(
            file,
            "sku",
            dimensions.width,
            dimensions.height,
          );
          if (issues.length) throw new Error(`${file.name}：${issues.join("；")}`);
          const result = await api.uploadSkuImage(storeId, file, dimensions);
          const previewUrl = URL.createObjectURL(file);
          importedBlobUrlsRef.current.add(previewUrl);
          return { ...result.asset, previewUrl, sourceFile: file };
        } finally {
          completed += 1;
          setSkuImageProgress({ completed, total: files.length, phase: "压缩并上传SKU预览图" });
        }
      }));
      const uploaded = outcomes.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : []
      );
      const failures = outcomes.flatMap((result, index) => {
        if (result.status === "fulfilled") return [];
        const reason = result.reason instanceof Error ? result.reason.message : "上传失败";
        return [`${files[index]?.name || `第${index + 1}张`}：${reason}`];
      });
      if (!uploaded.length) {
        throw new Error(failures.join("；") || "SKU图片上传失败");
      }
      setSkuPreviewImages((current) => [...current, ...uploaded]);
      setSkuFeedback({
        tone: failures.length ? "danger" : "success",
        message: [
          `已上传 ${uploaded.length} 张SKU预览图`,
          failures.length
            ? `；失败 ${failures.length} 张：${failures.join("；")}`
            : "",
          compressedCount
            ? `；已自动压缩 ${compressedCount} 张超过3MB的图片`
            : "",
          "。点击“智能匹配SKU预览图”按图片文字匹配尺寸。",
        ].join(""),
      });
      setSkuImageProgress({ completed, total: files.length, phase: "上传完成" });
    } catch (error) {
      setSkuFeedback({
        tone: "danger",
        message: error instanceof Error ? error.message : "SKU图片上传失败",
      });
    } finally {
      setSkuImageUploading(false);
      if (skuImageInputRef.current) skuImageInputRef.current.value = "";
    }
  };

  const removeSkuPreviewImage = (asset: DraftProductImage) => {
    if (asset.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(asset.previewUrl);
    setSkuPreviewImages((current) => current.filter((item) => item.id !== asset.id));
    setSkuRows((current) => current.map((row) => row.imageAssetId === asset.id
      ? { ...row, imageAssetId: "", imageAssetSource: "" }
      : row));
    setSkuFeedback({ tone: "success", message: "已移除SKU预览图及其当前映射" });
  };

  const uploadCompliancePhotos = async (
    group: "body" | "package",
    fileInputs: FileList | null,
  ) => {
    const groupCode = group === "body" ? "1" : "2";
    const currentCount = compliancePhotoAssignments.filter(
      (photo) => String(photo.labelGroup) === groupCode,
    ).length;
    const available = Math.max(0, 15 - currentCount);
    const selected = Array.from(fileInputs || []).map(prepareImageFile);
    const files = selected.slice(0, available);
    if (!files.length) {
      if (selected.length) {
        setFeedback({ tone: "danger", message: "每组实拍图最多上传15张" });
      }
      return;
    }
    setCompliancePhotoUploading(true);
    setFeedback(null);
    try {
      const outcomes = await Promise.allSettled(files.map(async (file) => {
        if (!["image/jpeg", "image/png"].includes(file.type)) {
          throw new Error(`${file.name}：仅支持JPG、JPEG、PNG`);
        }
        if (file.size > 10 * 1024 * 1024) {
          throw new Error(`${file.name}：不能超过10MB`);
        }
        const dimensions = await readImageDimensions(file);
        if (dimensions.width > 8000 || dimensions.height > 8000) {
          throw new Error(`${file.name}：宽高均不能超过8000px`);
        }
        const result = await api.uploadComplianceEvidence(storeId, file);
        const previewUrl = URL.createObjectURL(file);
        importedBlobUrlsRef.current.add(previewUrl);
        return {
          labelId: "",
          labelGroup: groupCode,
          labelName: group === "body" ? "商品本体实拍图" : "商品包装实拍图",
          localAssetRef: `media:${result.asset.id}`,
          fileName: result.asset.originalName,
          mimeType: result.asset.contentType,
          size: result.asset.sizeBytes,
          width: result.asset.width,
          height: result.asset.height,
          previewUrl,
        } satisfies DraftCompliancePhoto;
      }));
      const uploaded = outcomes.flatMap((outcome) =>
        outcome.status === "fulfilled" ? [outcome.value] : []
      );
      const failures = outcomes.flatMap((outcome) =>
        outcome.status === "rejected"
          ? [outcome.reason instanceof Error ? outcome.reason.message : "实拍图上传失败"]
          : []
      );
      setCompliancePhotoAssignments((current) => [
        ...current,
        ...uploaded.filter((photo) => !current.some(
          (item) => item.localAssetRef === photo.localAssetRef,
        )),
      ]);
      setFeedback({
        tone: failures.length ? "danger" : "success",
        message: failures.length
          ? `已上传${uploaded.length}张，失败${failures.length}张：${failures.join("；")}`
          : `已上传${uploaded.length}张${group === "body" ? "商品本体" : "商品包装"}实拍图`,
      });
    } finally {
      setCompliancePhotoUploading(false);
    }
  };

  const removeCompliancePhoto = (
    _group: "body" | "package",
    localAssetRef: string,
  ) => {
    setCompliancePhotoAssignments((current) => current.filter((photo) => {
      if (photo.localAssetRef !== localAssetRef) return true;
      if (photo.previewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(photo.previewUrl);
        importedBlobUrlsRef.current.delete(photo.previewUrl);
      }
      return false;
    }));
    setFeedback({ tone: "success", message: "已移除实拍图" });
  };

  const saveDraft = useMutation({
    mutationFn: async () => {
      setSaveAttempted(true);
      window.requestAnimationFrame(() => {
        const firstContentBlocker = contentStage.blockers[0]?.code || "";
        const firstMissingId = firstContentBlocker.startsWith("PRODUCT_TITLE")
          ? "draft-product-title"
          : !category
            ? "draft-product-category"
              : validation.missingFieldIds[0]
              ? `draft-attribute-${validation.missingFieldIds[0]}`
              : imageStage.blockers[0]
                ? "draft-product-images"
              : skuValidation.blockers[0]
                ? "draft-product-skus"
              : "";
        if (firstMissingId) {
          document.getElementById(firstMissingId)?.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        }
      });
      const checkedAt = new Date().toISOString();
      let associatedRules: LinkedRule[] = [];
      let associatedRulesCheckedAt = "";
      const saveBlockers = [...formBlockers];
      if (category && schema.data) {
        const assignedList = fields.flatMap((field) => {
          const assignment = attributeValues[field.id] || {};
          const valueIds = Array.isArray(assignment.valueIds)
            ? assignment.valueIds.map(String).filter(Boolean)
            : [];
          if (valueIds.length) {
            return valueIds.map((valueId) => ({
              attributeId: field.id,
              attributeValueId: valueId,
            }));
          }
          return String(assignment.customValue || "").trim()
            ? [{ attributeId: field.id }]
            : [];
        });
        if (assignedList.length) {
          try {
            const linked = await api.associatedAttributeRules(storeId, {
              categoryId: category.categoryId,
              productTypeId: category.productTypeId,
              attributeList: assignedList,
            });
            const linkedData = linked.info as {
              data?: Array<{ link_rule_attribute_list?: LinkedRule[] }>;
            };
            associatedRulesCheckedAt = checkedAt;
            associatedRules =
              linkedData.data?.[0]?.link_rule_attribute_list || [];
            for (const rule of associatedRules) {
              const attributeId = String(rule.attribute_id || "");
              if (!fields.some((field) => field.id === attributeId)) continue;
              const assignment = attributeValues[attributeId];
              const allowed = [
                ...(rule.attribute_value_list || []),
                ...(rule.attribute_value_pre_fill_list || []),
              ].map(String);
              if (
                !assignment ||
                (
                  allowed.length > 0 &&
                  !assignment.valueIds.some((valueId) => allowed.includes(valueId))
                )
              ) {
                const name =
                  fields.find((field) => field.id === attributeId)?.name ||
                  attributeId;
                saveBlockers.push(`SHEIN 关联规则要求补充“${name}”`);
              }
            }
          } catch (error) {
            saveBlockers.push(
              `SHEIN 关联属性规则读取失败：${(error as Error).message}`,
            );
          }
        }
      }
      const draftBlocked =
        saveBlockers.length > 0 ||
        (Boolean(category) && !imageStage.valid) ||
        (Boolean(category) && !skuValidation.valid) ||
        (Boolean(category) && !publishSettingsStage.valid);
      const savedTailImages = selectedTailImageTemplate
        ? orderedTailTemplateImages(selectedTailImageTemplate).map(savedImageAsset)
        : [];
      const input = {
        ...(draftId ? { id: draftId } : {}),
        name: title.trim().slice(0, 160) || "未命名商品草稿",
        categoryId: category?.categoryId || "",
        productTypeId: category?.productTypeId || "",
        data: {
          title: title.trim(),
          titleRuleTemplateId,
          titleRuleBaseTitle,
          contentPreview: {
            multiLanguageNameList: contentStage.multiLanguageNameList,
            multiLanguageDescList: [],
          },
          categoryName: category?.name || "",
          categoryPath: category?.path || [],
          attributeTemplateId: templateId,
          attributeValues,
          rugReportSources,
          sizeTemplateId,
          packagingTemplateId,
          packagingMaterial,
          commercialTemplateId,
          tailImageTemplateId,
          tailImagePlacement: selectedTailImageTemplate?.data.placement || "append",
          compliancePhotoSourceMode,
          compliancePhotoAssignments: compliancePhotoAssignments.map(
            savedCompliancePhoto,
          ),
          complianceTemplateId: compliancePhotoSourceMode === "template"
            ? complianceTemplateId
            : "",
          complianceTemplateSnapshot: compliancePhotoSourceMode === "template" && selectedComplianceTemplate
            ? {
                id: selectedComplianceTemplate.id,
                storeId: selectedComplianceTemplate.storeId,
                name: selectedComplianceTemplate.name,
                version: selectedComplianceTemplate.version,
                data: {
                  requirements: selectedComplianceTemplate.data.requirements || [],
                  defaults: selectedComplianceTemplate.data.defaults || {
                    certificates: [],
                    agencies: [],
                    warnings: [],
                    photos: [],
                  },
                  storeScoped: selectedComplianceTemplate.data.storeScoped === true,
                  revalidateOnUse:
                    selectedComplianceTemplate.data.revalidateOnUse === true,
                },
              }
            : null,
          reportTemplateId: "",
          reportTemplateSnapshot: null,
          compliancePlan: {
            expectedReport: complianceStage.expectedReport,
            manualQueue: complianceStage.manualQueue,
            requiresSkcRevalidation: true,
          },
          businessModeSnapshot: currentStore?.businessMode || "",
          publishSettings: { ...DEFAULT_PRODUCT_PUBLISH_SETTINGS },
          imageAssets: {
            main: mainImages.map(savedImageAsset),
            detail: detailImages.map(savedImageAsset),
            square: squareImages.map(savedImageAsset),
            swatch: swatchImages.map(savedImageAsset),
            tail: savedTailImages,
          },
          supplierCode: normalizeSupplierCode(supplierCode),
          skuPreviewImages: skuPreviewImages.map(savedImageAsset),
          pricePerSquareMeter,
          gramsPerSquareMeter,
          bulkInventory,
          currency,
          colorSaleValue: colorMapping,
          skuRows: resolvedSkuRows,
          attributeSchemaSnapshot: {
            fetchedAt: schema.data ? checkedAt : "",
            categoryId: category?.categoryId || "",
            productTypeId: category?.productTypeId || "",
            fields: fields.map((field) => ({
              id: field.id,
              name: field.name,
              required: field.required,
              typeCode: field.typeCode,
              dataDimension: field.dataDimension,
              modeCode: field.modeCode,
              maxSelections: field.maxSelections,
              values: field.values,
              ruleInfoList: field.ruleInfoList,
            })),
          },
          associatedRulesSnapshot: {
            checkedAt: associatedRulesCheckedAt,
            rules: associatedRules,
          },
          salesSchemaSnapshot: {
            fetchedAt: schema.data ? checkedAt : "",
            mainAttributeStatus: saleSchema.mainAttributeStatus,
            fields: saleSchema.fields,
            sizeFields: saleSchema.sizeFields,
          },
          publishStandardSnapshot: {
            fetchedAt: schema.data ? checkedAt : "",
            currency,
            weightRequired,
            weightConfig: publishStandard?.weight_config || null,
            dimensionConfig:
              publishStandard?.length_width_height_config || null,
            pictureConfig,
            fillInStandard,
            defaultLanguage,
            titleMaxLength: contentStage.titleMaxLength,
          },
        },
        preflight: {
          local: {
            checkedAt,
            blockers: saveBlockers,
          },
        },
        status: draftBlocked ? "blocked" as const : "draft" as const,
      };
      return api.saveProductDraft(storeId, input);
    },
    onMutate: () => {
      setFeedback(null);
    },
    onSuccess: ({ draft }) => {
      setDraftId(draft.id);
      const nextParams = new URLSearchParams();
      nextParams.set("draft", draft.id);
      if (returnBatchId) nextParams.set("returnBatch", returnBatchId);
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}?${nextParams.toString()}`,
      );
      const publishCandidate = draft.preflight.publishCandidate as {
        state?: string;
        fingerprint?: string;
        blockers?: unknown[];
      } | undefined;
      queryClient.invalidateQueries({
        queryKey: ["store", queryScope, storeId, "product-drafts"],
      });
      queryClient.invalidateQueries({
        queryKey: ["store", queryScope, storeId, "workspace-usage"],
      });
      const skuBlockers = (
        draft.preflight.sku as { blockers?: unknown[] } | undefined
      )?.blockers?.length || 0;
      const imageBlockers = (
        draft.preflight.images as { blockers?: unknown[] } | undefined
      )?.blockers?.length || 0;
      const contentBlockers = (
        draft.preflight.content as { blockers?: unknown[] } | undefined
      )?.blockers?.length || 0;
      const complianceBlockers = (
        draft.preflight.compliance as { blockers?: unknown[] } | undefined
      )?.blockers?.length || 0;
      const publishSettingsBlockers = (
        draft.preflight.publishSettings as { blockers?: unknown[] } | undefined
      )?.blockers?.length || 0;
      const attributeBlockers = (
        draft.preflight.attributes as { blockers?: unknown[] } | undefined
      )?.blockers?.length || 0;
      const blockerCount =
        skuBlockers + imageBlockers + contentBlockers +
        complianceBlockers + publishSettingsBlockers + attributeBlockers;
      setFeedback({
        tone: blockerCount > 0
          ? "danger"
          : "success",
        message: blockerCount > 0
          ? `草稿已保存，还有 ${blockerCount} 个阻断项`
          : publishCandidate?.state === "ready_for_remote_preflight"
            ? "草稿已保存并生成可审计发布候选快照"
            : "草稿已保存，尚未生成发布候选快照",
      });
    },
    onError: (error: Error) => {
      setFeedback({ tone: "danger", message: error.message });
    },
  });

  if (!currentStore) return null;
  const queryError =
    categories.error ||
    schemaCoverage.error ||
    titleRuleTemplates.error ||
    templates.error ||
    sizeTemplates.error ||
    packagingTemplates.error ||
    tailImageTemplates.error ||
    complianceTemplates.error ||
    draftsQuery.error ||
    schema.error;
  const busy =
    saveDraft.isPending || skuImageUploading || skuImageMatching ||
    productImageUploading || compliancePhotoUploading;
  const requiredCount = fields.filter((field) => field.required).length;
  const availableSkuPreviewAssets = [...mainImages, ...skuPreviewImages];
  const assignSkuPreviewAsset = (rowId: string, assetId: string) => {
    const isMain = mainImages.some((asset) => asset.id === assetId);
    setSkuRows((current) => assignSkuPreviewImage(
      current,
      rowId,
      assetId,
      isMain ? "per_sku_main" : "per_sku_manual",
    ));
  };
  const skuPickerRow = resolvedSkuRows.find((row) => row.id === skuPickerRowId) || null;
  const openTemplateManager = (path: string) => {
    window.open(path, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="ops-page product-editor single-product-page">
      <header className="ops-page__header single-product-page__header">
        <div className="min-w-0">
          <button
            className="mb-3 flex items-center gap-1.5 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--ink)]"
            onClick={() => navigate(
              returnBatchId
                ? `/app/operations/${encodeURIComponent(currentStore.id)}/publishing?batch=${encodeURIComponent(returnBatchId)}`
                : draftId
                ? `/app/operations/${encodeURIComponent(currentStore.id)}/products/drafts`
                : `/app/operations/${encodeURIComponent(currentStore.id)}/products`,
            )}
            type="button"
          >
            <ArrowLeft size={14} />
            {returnBatchId
              ? "返回原发布批次"
              : draftId
                ? "返回商品草稿"
                : "返回商品经营"}
          </button>
          <p className="ops-page__eyebrow">单个商品创建</p>
          <h1 className="ops-page__title">
            {draftId ? "继续编辑商品草稿" : "新建商品草稿"}
          </h1>
          <p className="ops-page__description">
            {currentStore.label} · 属性与合规预判
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => navigate(`/app/operations/${encodeURIComponent(currentStore.id)}/products/batch-new`)} variant="outline">
            批量建品
          </Button>
          <span className="status-badge">
            {draftId ? `草稿 ${draftId.slice(0, 8)}` : "尚未保存"}
          </span>
        </div>
      </header>

      <PublishQuotaNotice
        compact
        loading={businessDashboard.isLoading}
        quota={businessDashboard.data?.snapshot?.productQuota}
      />

      {queryError && (
        <div className="notice notice-danger" role="alert">
          <AlertCircle size={16} />
          <span className="min-w-0 flex-1">{queryError.message}</span>
          <Button
            onClick={() => {
              categories.refetch();
              schemaCoverage.refetch();
              titleRuleTemplates.refetch();
              if (draftQueryId) draftsQuery.refetch();
              templates.refetch();
              sizeTemplates.refetch();
              packagingTemplates.refetch();
              tailImageTemplates.refetch();
              complianceTemplates.refetch();
              if (category) schema.refetch();
            }}
            size="sm"
            variant="outline"
          >
            重试
          </Button>
        </div>
      )}

      {saveAttempted && blockers.length > 0 && (
        <div
          aria-live="assertive"
          className="notice notice-danger mb-4"
          role="alert"
        >
          <AlertCircle className="mt-0.5 shrink-0" size={17} />
          <div className="min-w-0 flex-1">
            <p className="font-medium">保存前检查未通过</p>
            <p className="mt-1 text-xs leading-5">
              当前还有 {blockers.length} 个阻断项。必填商品属性会在下方标红，点击缺失项可直接定位。
            </p>
            {missingRequiredFields.length > 0 && (
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
            )}
          </div>
        </div>
      )}

      <nav
        aria-label="新建商品步骤"
        className="product-editor-step-nav mb-4 grid gap-2 rounded-md border border-[var(--line)] bg-white p-2 sm:grid-cols-4"
      >
        {[
          {
            id: "draft-product-basic",
            label: "基础与类目",
            pending: formBlockers.length,
          },
          {
            id: "draft-product-images",
            label: "图片与素材",
            pending: category ? imageStage.blockers.length : 1,
          },
          {
            id: "draft-product-skus",
            label: "SKU与包装",
            pending: category ? skuValidation.blockers.length : 1,
          },
          {
            id: "draft-product-compliance",
            label: "合规（发布后处理）",
            pending: 0,
          },
        ].map((stage, index) => (
          <button
            className={`product-editor-step flex min-w-0 items-center gap-2 rounded-sm px-3 py-2.5 text-left hover:bg-[var(--surface-muted)] ${
              stage.pending ? "text-[var(--danger)]" : "text-[var(--success-strong)]"
            }`}
            key={stage.id}
            onClick={() => scrollToProductStage(stage.id)}
            type="button"
          >
            <span className={`grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${
              stage.pending ? "bg-[var(--danger-soft)]" : "bg-[var(--success-soft)]"
            }`}>
              {stage.pending ? index + 1 : <Check size={13} />}
            </span>
            <span className="min-w-0">
              <strong className="block truncate text-xs font-medium">{stage.label}</strong>
              <span className="mt-0.5 block truncate text-[11px] opacity-75">
                {stage.pending ? `${stage.pending} 项待处理` : "已完成"}
              </span>
            </span>
          </button>
        ))}
      </nav>

      <div className="grid gap-4 pb-24">
        <div className="min-w-0 space-y-4">
          <section className="data-panel scroll-mt-20" id="draft-product-basic">
            <header className="data-toolbar">
              <div>
                <h2>标题与属性模板</h2>
                <p>标题规则与商品属性模板独立引用，最终均按当前类目规范校验</p>
              </div>
              <FileText className="text-[var(--text-subtle)]" size={18} />
            </header>
            <div className="grid gap-4 px-4 py-4 sm:px-5 lg:grid-cols-2">
              <label className="lg:col-span-2">
                <span className="text-xs font-medium text-[var(--text-muted)]">
                  商品标题
                </span>
                <input
                  className={`field mt-2 px-3 ${
                    saveAttempted && titleIssue ? "border-[var(--danger)]" : ""
                  }`}
                  maxLength={contentStage.titleMaxLength}
                  id="draft-product-title"
                  onChange={(event) => {
                    setTitle(event.target.value);
                    setTitleRuleBaseTitle("");
                    setFeedback(null);
                  }}
                  placeholder="填写与实物一致的商品标题"
                  value={title}
                />
                <span className="mt-1.5 block text-[11px] text-[var(--text-subtle)]">
                  {defaultLanguage || "默认语种待读取"} · {title.length}/{contentStage.titleMaxLength}
                </span>
                {saveAttempted && titleIssue && (
                  <span className="mt-1.5 block text-xs text-[var(--danger)]">
                    {titleIssue.message}
                  </span>
                )}
              </label>
              <label>
                <span className="text-xs font-medium text-[var(--text-muted)]">
                  标题规则模板
                </span>
                <div className="mt-2 flex gap-2">
                  <select
                    className="field min-w-0 flex-1 px-3"
                    disabled={titleRuleTemplates.isLoading || busy}
                    onChange={(event) => applyTitleTemplate(event.target.value)}
                    value={titleRuleTemplateId}
                  >
                    <option value="">不引用标题规则</option>
                    {(titleRuleTemplates.data?.templates || []).map((template) => (
                      <option key={template.id} value={template.id}>{template.name}</option>
                    ))}
                  </select>
                  <Button
                    disabled={!titleRuleTemplateId || busy}
                    onClick={() => applyTitleTemplate(titleRuleTemplateId)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    重新引用
                  </Button>
                  {aiTitleCapability.data?.visible && (
                    <Button
                      disabled={!titleRuleTemplateId || !mainImages.length || busy || aiTitleGenerating}
                      onClick={() => void generateAiTitle()}
                      size="sm"
                      type="button"
                      variant="danger"
                    >
                      {aiTitleGenerating ? <LoaderCircle className="animate-spin" size={14} /> : <Sparkles size={14} />}
                      {aiTitleGenerating ? "识别中" : "AI识别图案"}
                    </Button>
                  )}
                </div>
                <button
                  className="mt-2 text-xs font-medium text-[var(--text-muted)] underline underline-offset-2 hover:text-[var(--ink)]"
                  onClick={() => openTemplateManager(`/app/templates/${encodeURIComponent(storeId)}/title-rules`)}
                  type="button"
                >
                  管理标题规则
                </button>
              </label>
              <label>
                <span className="text-xs font-medium text-[var(--text-muted)]">
                  商品属性模板
                </span>
                <div className="mt-2 flex gap-2">
                  <select
                    className="field min-w-0 flex-1 px-3"
                    disabled={templates.isLoading || busy}
                    onChange={(event) => applyTemplate(event.target.value)}
                    value={templateId}
                  >
                    <option value="">不引用模板</option>
                    {(templates.data?.templates || []).map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name} · {template.data.categoryName || template.categoryId}
                      </option>
                    ))}
                  </select>
                  <Button
                    disabled={!templateId || busy}
                    onClick={() => applyTemplate(templateId)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    重新引用
                  </Button>
                </div>
              </label>
            </div>
          </section>

          <section className="data-panel" id="draft-product-category">
            <header className="data-toolbar">
              <div>
                <h2>SHEIN 末级类目</h2>
                <p>类目变化后重新读取当前店铺属性 Schema</p>
              </div>
              {categories.isFetching && (
                <LoaderCircle className="animate-spin text-[var(--text-subtle)]" size={18} />
              )}
            </header>
            <div className="px-4 py-4 sm:px-5">
              {category && !categoryPickerOpen && (
                <div className="flex items-start gap-3 rounded-md bg-[var(--success-soft)] px-3 py-2.5 text-xs text-[var(--success-strong)]">
                  <Check className="mt-0.5 shrink-0" size={14} />
                  <span className="min-w-0 flex-1">
                    <strong className="block font-medium">
                      {category.path.join(" / ")}
                    </strong>
                    <span className="mt-0.5 block">
                      Category {category.categoryId} · Product Type {category.productTypeId}
                    </span>
                  </span>
                  <button
                    className="flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-1 font-medium hover:bg-white/65"
                    disabled={busy}
                    onClick={() => {
                      setCategorySearch("");
                      setCategoryPickerOpen(true);
                    }}
                    type="button"
                  >
                    更换类目
                    <ChevronDown size={13} />
                  </button>
                </div>
              )}
              {categoryPickerOpen && (
                <div className="rounded-md border border-[var(--line)] bg-white">
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
                          onClick={() => chooseCategory(item)}
                          type="button"
                        >
                          <span className="text-sm font-medium text-[var(--ink)]">{item.path.join(" / ")}</span>
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
                          onSelect={chooseCategory}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
              {saveAttempted && !category && (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-[var(--danger)]">
                  <AlertCircle size={14} />
                  末级类目未选择
                </p>
              )}
            </div>
          </section>

          <section className="data-panel">
            <header className="data-toolbar">
              <div>
                <h2>商品属性</h2>
                <p>
                  {category
                    ? `必填 ${completedRequired}/${requiredCount} · 选填 ${Math.max(0, fields.length - requiredCount)}`
                    : "选择末级类目后显示"}
                </p>
              </div>
              {schema.isFetching && (
                <LoaderCircle className="animate-spin text-[var(--text-subtle)]" size={18} />
              )}
              {category && fields.length > 0 && !schema.isFetching && (
                <Button
                  aria-expanded={attributesExpanded}
                  onClick={() => setAttributesExpanded((current) => !current)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <ChevronDown className={attributesExpanded ? "rotate-180" : ""} size={14} />
                  {attributesExpanded ? "收起属性" : "展开属性"}
                </Button>
              )}
            </header>
            {schema.isFetching ? (
              <div className="grid min-h-52 place-items-center text-sm text-[var(--text-muted)]">
                正在读取 SHEIN 属性结构
              </div>
            ) : category && schemaCoverage.isFetching && !selectedCoverage && !currentSchemaReady ? (
              <div className="grid min-h-52 place-items-center text-sm text-[var(--text-muted)]">
                正在读取当前类目的官方覆盖状态
              </div>
            ) : category && !coverageReady ? (
              <div className="notice notice-warning m-4 sm:m-5" role="alert">
                <AlertCircle className="mt-0.5 shrink-0" size={17} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {schemaCoverage.error
                      ? "当前类目的官方 schema 覆盖状态读取失败"
                      : "当前类目的官方 schema 尚未完整同步"}
                  </p>
                  <p className="mt-1 text-xs leading-5">
                    商品属性 schema 和发布填写规范都确认同步后，才能继续填写并保存该商品草稿。
                    系统不会使用其他类目的字段替代。
                  </p>
                </div>
                <Button
                  onClick={() => schemaCoverage.refetch()}
                  size="sm"
                  variant="outline"
                >
                  <Search size={14} />
                  重试覆盖状态
                </Button>
              </div>
            ) : category && schema.data && coverageReady && fields.length && !attributesExpanded ? (
              <div className="flex items-center justify-between gap-3 px-4 py-4 text-xs text-[var(--text-muted)] sm:px-5">
                <span>
                  商品属性已隐藏，当前已填写 {completedRequired}/{requiredCount} 项必填属性；需要修改时再展开。
                </span>
                <Button
                  onClick={() => setAttributesExpanded(true)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  展开查看
                </Button>
              </div>
            ) : category && schema.data && coverageReady && fields.length ? (
              orderedAttributeFields.map((field) => (
                <AttributeEditor
                  field={field}
                  invalid={invalidIds.has(field.id)}
                  key={field.id}
                  onChange={(value) => {
                    setAttributeValues((current) => ({
                      ...current,
                      [field.id]: value,
                    }));
                    setFeedback(null);
                  }}
                  value={attributeValues[field.id] || {
                    valueIds: [],
                    customValue: "",
                  }}
                />
              ))
            ) : (
              <div className="grid min-h-52 place-items-center px-6 text-center">
                <div>
                  <Search className="mx-auto text-[var(--text-subtle)]" size={22} />
                  <p className="mt-3 text-sm font-medium text-[var(--ink)]">
                    {category ? "当前类目没有可填写的商品属性" : "先选择末级类目"}
                  </p>
                </div>
              </div>
            )}
          </section>

          <ProductImagesSection
            busy={busy}
            detailImages={detailImages}
            squareImages={squareImages}
            swatchImages={swatchImages}
            imageStage={imageStage}
            mainImages={mainImages}
            onDetailImagesChange={(images) => {
              setDetailImages(images);
              setFeedback(null);
            }}
            onSquareImagesChange={(images) => {
              setSquareImages(images);
              setFeedback(null);
            }}
            onSwatchImagesChange={(images) => {
              setSwatchImages(images);
              setFeedback(null);
            }}
            onMainImagesChange={(images) => {
              setMainImages(images);
              setFeedback(null);
            }}
            onTailTemplateChange={(nextTemplateId) => {
              setTailImageTemplateId(nextTemplateId);
              setFeedback(null);
            }}
            onUploadingChange={setProductImageUploading}
            saveAttempted={saveAttempted}
            storeId={storeId}
            tailImageTemplateId={tailImageTemplateId}
            templates={tailImageTemplates.data?.templates || []}
          />

          <section className="data-panel scroll-mt-20" id="draft-product-skus">
            <header className="data-toolbar">
              <div>
                <h2>颜色、尺寸与打包体积</h2>
                <p>
                  {skuRows.length
                    ? `${skuRows.length} 个 SKU 尺寸 · ${
                        resolvedSkuRows.filter(
                          (row) => ["matched", "manual"].includes(row.packageMatch || ""),
                        ).length
                      } 个已匹配打包体积`
                    : "引用模板后按当前类目匹配官方销售属性"}
                </p>
              </div>
              <Boxes className="text-[var(--text-subtle)]" size={18} />
            </header>

            <div className="grid gap-4 px-4 py-4 sm:px-5 lg:grid-cols-2">
              <label>
                <span className="text-xs font-medium text-[var(--text-muted)]">
                  颜色与尺寸模板
                </span>
                <div className="mt-2 flex gap-2">
                  <select
                    className="field min-w-0 flex-1 px-3"
                    disabled={!category || schema.isFetching || busy}
                    onChange={(event) => applySizeTemplate(event.target.value)}
                    value={sizeTemplateId}
                  >
                    <option value="">请选择模板</option>
                    {(sizeTemplates.data?.templates || []).map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name} · {template.data.rows?.length || 0} 个尺寸
                      </option>
                    ))}
                  </select>
                  <Button
                    disabled={!sizeTemplateId || busy}
                    onClick={() => applySizeTemplate(sizeTemplateId)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    重新引用
                  </Button>
                </div>
              </label>

              <label>
                <span className="text-xs font-medium text-[var(--text-muted)]">
                  共享颜色的 SHEIN 主销售属性值
                </span>
                <input
                  aria-label="共享颜色的 SHEIN 主销售属性值"
                  className="field mt-2 px-3"
                  disabled={!skuRows.length || busy}
                  list="shein-main-color-values"
                  onChange={(event) => {
                    const input = event.target.value;
                    setColorInputValue(input);
                    setColorMapping(resolveMainSaleAttributeValue(saleSchema, input));
                    setFeedback(null);
                  }}
                  placeholder="输入或选择当前类目的颜色"
                  value={colorInputValue}
                />
                <datalist id="shein-main-color-values">
                  {colorOptions.map((option) => (
                    <option key={option.key} value={option.mapping.valueLabel} />
                  ))}
                </datalist>
                {colorInputValue && colorMapping?.customValue && (
                  <span className="mt-1 block text-[11px] text-[var(--success)]">
                    当前值未命中官方预设，将按 SHEIN 自定义销售属性值提交
                  </span>
                )}
                {colorInputValue && !colorMapping && (
                  <span className="mt-1 block text-[11px] text-[var(--danger)]">
                    {customColorAllowed
                      ? "请输入一个明确的颜色值"
                      : "当前类目不允许自定义该销售属性值，请选择 SHEIN 官方值"}
                  </span>
                )}
              </label>

              <label>
                <span className="text-xs font-medium text-[var(--text-muted)]">
                  打包体积模板
                </span>
                <select
                  className="field mt-2 px-3"
                  disabled={!skuRows.length || busy}
                  onChange={(event) => applyPackaging(event.target.value)}
                  value={packagingTemplateId}
                >
                  <option value="">请选择模板</option>
                  {(packagingTemplates.data?.templates || []).map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span className="text-xs font-medium text-[var(--text-muted)]">
                  打包材质
                </span>
                <select
                  className="field mt-2 px-3"
                  disabled={!packagingTemplateId || busy}
                  onChange={(event) => {
                    applyPackagingMaterial(event.target.value);
                  }}
                  value={packagingMaterial}
                >
                  <option value="">请选择工作表材质</option>
                  {packagingMaterials.map((material) => (
                    <option key={material} value={material}>{material}</option>
                  ))}
                </select>
                <Button
                  className="mt-2"
                  disabled={!packagingTemplateId || !packagingMaterial || !skuRows.length || busy}
                  onClick={reapplyPackaging}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  重新引用当前打包体积
                </Button>
                {skuFeedback && /打包体积|重新引用当前打包/.test(skuFeedback.message) && (
                  <span
                    className={`mt-2 block text-xs leading-5 ${skuFeedback.tone === "danger" ? "text-[var(--danger)]" : "text-[var(--success-strong)]"}`}
                    role="status"
                  >
                    {skuFeedback.message}
                  </span>
                )}
              </label>
            </div>

            <div className="grid gap-5 border-t border-[var(--line)] px-4 py-4 sm:px-5 lg:grid-cols-2">
              <div className="min-w-0">
                <label>
                  <span className="text-xs font-medium text-[var(--text-muted)]">
                    商家SKC货号
                  </span>
                  <input
                    className={`field mt-2 px-3 ${
                      saveAttempted && (!supplierCode.trim() || supplierCode.trim().length > 200)
                        ? "border-[var(--danger)]"
                        : ""
                    }`}
                    readOnly
                    maxLength={200}
                    placeholder="例如 家居-地毯-0822001"
                    value={supplierCode}
                  />
                  <p className="mt-1 text-[11px] text-[var(--text-subtle)]">
                    系统按类目与日期自动生成，可直接用于发布；系统会自动移除顿号和其他非法字符。
                  </p>
                </label>
              </div>

              <div className="min-w-0">
                <span className="text-xs font-medium text-[var(--text-muted)]">
                  SKU预览图（选填）
                </span>
                <input
                  accept="image/jpeg,image/png"
                  aria-hidden="true"
                  disabled={!skuRows.length || busy}
                  hidden
                  multiple
                  onChange={(event) => void uploadSkuPreviewImages(event.target.files)}
                  ref={skuImageInputRef}
                  type="file"
                />
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Button
                    disabled={!skuRows.length || busy}
                    onClick={() => skuImageInputRef.current?.click()}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {skuImageUploading
                      ? <LoaderCircle className="animate-spin" size={15} />
                      : <Upload size={15} />}
                    {skuImageUploading ? "正在上传" : "上传预览图"}
                  </Button>
                  <Button
                    disabled={!skuRows.length || !mainImages.length || busy}
                    onClick={() => void smartMatchSkuPreviewImages()}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {skuImageMatching
                      ? <LoaderCircle className="animate-spin" size={15} />
                      : <Sparkles size={15} />}
                    {skuImageMatching ? "正在识别" : "智能匹配SKU预览图"}
                  </Button>
                </div>
                {skuImageProgress && (
                  <div className="mt-2" role="status">
                    <div className="mb-1 flex items-center justify-between text-[11px] text-[var(--text-muted)]">
                      <span>{skuImageProgress.phase}</span>
                      <span>{skuImageProgress.completed}/{skuImageProgress.total}</span>
                    </div>
                    <div
                      aria-valuemax={skuImageProgress.total}
                      aria-valuemin={0}
                      aria-valuenow={skuImageProgress.completed}
                      className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-muted)]"
                      role="progressbar"
                    >
                      <div
                        className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-200"
                        style={{ width: `${Math.round((skuImageProgress.completed / Math.max(1, skuImageProgress.total)) * 100)}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {skuPreviewImages.length > 0 && (
              <div className="grid gap-3 border-t border-[var(--line)] px-4 py-4 sm:grid-cols-2 sm:px-5 lg:grid-cols-4">
                {skuPreviewImages.map((asset) => (
                  <article className="flex min-w-0 items-center gap-3 border border-[var(--line)] p-2" key={asset.id}>
                    {asset.previewUrl ? (
                      <img alt={asset.originalName} className="h-14 w-14 shrink-0 object-cover" src={asset.previewUrl} />
                    ) : (
                      <div className="grid h-14 w-14 shrink-0 place-items-center bg-[var(--page)]"><ImagePlus size={18} /></div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-[var(--ink)]" title={asset.originalName}>{asset.originalName}</p>
                      <p className="mt-1 text-[11px] text-[var(--text-subtle)]">{asset.width}×{asset.height}</p>
                      <button
                        className="mt-1 text-[11px] font-medium text-[var(--text-muted)] underline underline-offset-2"
                        disabled={busy}
                        onClick={() => {
                          setSkuRows((current) => applySharedSkuImage(current, asset.id));
                          setSkuFeedback({ tone: "success", message: `已将“${asset.originalName}”设为全部SKU共用预览图` });
                        }}
                        type="button"
                      >
                        全部SKU共用
                      </button>
                    </div>
                    <Button aria-label={`删除${asset.originalName}`} disabled={busy} onClick={() => removeSkuPreviewImage(asset)} size="icon" variant="ghost">
                      <Trash2 size={14} />
                    </Button>
                  </article>
                ))}
              </div>
            )}

            <div className="border-t border-[var(--line)] px-4 py-4 sm:px-5">
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-[var(--ink)]">直接填写计价与克重</h3>
                <p className="mt-1 text-xs leading-5 text-[var(--text-subtle)]">
                  不需要进入模板中心；输入每㎡供货价和每㎡克重后，点击下方按钮即可按每个 SKU 成品面积一键填充。
                </p>
              </div>
              <div className="grid gap-4 lg:grid-cols-3">
              <div className="min-w-0">
                <label>
                  <span className="text-xs font-medium text-[var(--text-muted)]">
                    每平方米供货单价{currency ? `（${currency}）` : ""}
                  </span>
                  <input
                    className="field mt-2 px-3"
                    disabled={!skuRows.length || busy}
                    inputMode="decimal"
                    onChange={(event) => {
                      setCommercialTemplateId("");
                      setPricePerSquareMeter(event.target.value);
                      setSkuFeedback(null);
                    }}
                    placeholder="例如 25.50"
                    value={pricePerSquareMeter}
                  />
                </label>
                <Button
                  className="mt-2 w-full"
                  disabled={!skuRows.length || busy}
                  onClick={applyBulkPrice}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <WalletCards size={15} />
                  一键填充全部 SKU 供货价
                </Button>
              </div>

              <div className="min-w-0">
                <label>
                  <span className="text-xs font-medium text-[var(--text-muted)]">
                    每平方米克重（g）
                  </span>
                  <input
                    className="field mt-2 px-3"
                    disabled={!skuRows.length || busy}
                    inputMode="decimal"
                    onChange={(event) => {
                      setCommercialTemplateId("");
                      setGramsPerSquareMeter(event.target.value);
                      setSkuFeedback(null);
                    }}
                    placeholder="例如 850"
                    value={gramsPerSquareMeter}
                  />
                </label>
                <Button
                  className="mt-2 w-full"
                  disabled={!skuRows.length || busy}
                  onClick={applyBulkWeight}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <Scale size={15} />
                  一键填充全部 SKU 重量
                </Button>
              </div>

              <div className="min-w-0">
                <label>
                  <span className="text-xs font-medium text-[var(--text-muted)]">
                    统一库存
                  </span>
                  <input
                    className="field mt-2 px-3"
                    disabled={!skuRows.length || busy}
                    inputMode="numeric"
                    max="99999"
                    min="0"
                    onChange={(event) => {
                      setBulkInventory(event.target.value);
                      setSkuFeedback(null);
                    }}
                    placeholder="0–99999"
                    type="number"
                    value={bulkInventory}
                  />
                </label>
                <Button
                  className="mt-2 w-full"
                  disabled={!skuRows.length || busy}
                  onClick={applyBulkInventory}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <Warehouse size={15} />
                  一键应用库存
                </Button>
              </div>
              <p className="text-xs leading-5 text-[var(--text-subtle)] lg:col-span-3">
                价格和重量按成品长×宽换算；重量是面积估算值，发布前需核对包装增重。批量填写后仍可逐个 SKU 修正。
              </p>
              </div>
            </div>

            {skuFeedback && (
              <div
                className={`notice m-4 mt-0 sm:m-5 sm:mt-0 ${
                  skuFeedback.tone === "danger"
                    ? "notice-danger"
                    : "notice-success"
                }`}
                role="status"
              >
                {skuFeedback.tone === "danger"
                  ? <AlertCircle size={16} />
                  : <Check size={16} />}
                <span>{skuFeedback.message}</span>
              </div>
            )}

            {skuRows.length ? (
              <div className="overflow-x-auto border-t border-[var(--line)]">
                <table className="sku-contract-table w-full min-w-[1160px] text-left text-xs">
                  <thead className="bg-[var(--page)] text-[var(--text-subtle)]">
                    <tr>
                      <th className="px-4 py-3 font-medium">模板尺寸</th>
                      <th className="px-4 py-3 font-medium">SKU预览图</th>
                      <th className="px-4 py-3 font-medium">SHEIN 尺寸值</th>
                      <th className="px-4 py-3 font-medium">SKU供货总价</th>
                      <th className="px-4 py-3 font-medium">库存</th>
                      <th className="px-4 py-3 font-medium">商品重量</th>
                      <th className="px-4 py-3 font-medium">打包体积(cm)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--line)]">
                    {resolvedSkuRows.map((row) => {
                      const hasSizeAttributeValues = row.sizeAttributeValues &&
                        Object.values(row.sizeAttributeValues).some(Boolean);
                      const sizeMissing = !hasSizeAttributeValues && (
                        !row.sizeMapping ||
                        (!row.sizeMapping.valueId && !row.sizeMapping.customValue)
                      );
                      const costPrice = String(row.costPrice ?? "");
                      const inventoryText = String(row.inventoryNum ?? "");
                      const weightText = String(row.weightGrams ?? "");
                      const costInvalid = saveAttempted && (
                        !/^\d+(?:\.\d{1,2})?$/.test(costPrice) ||
                        !(Number(costPrice) > 0) ||
                        Number(costPrice) > 100000
                      );
                      const inventoryInvalid = saveAttempted && (
                        !inventoryText ||
                        !Number.isInteger(Number(inventoryText)) ||
                        Number(inventoryText) < 0 ||
                        Number(inventoryText) > 99999
                      );
                      const weightInvalid = saveAttempted && (
                        (weightRequired && !(Number(weightText) > 0)) ||
                        (weightText !== "" && !(Number(weightText) > 0))
                      );
                      return (
                        <tr key={row.id}>
                          <td className="px-4 py-3 font-medium text-[var(--ink)]">
                            {row.sizeText}
                          </td>
                          <td className="w-[210px] px-4 py-3">
                            {(() => {
                              const selectedAsset = availableSkuPreviewAssets.find(
                                (asset) => asset.id === row.imageAssetId,
                              );
                              const selectedAssetIndex = selectedAsset
                                ? availableSkuPreviewAssets.findIndex((asset) => asset.id === selectedAsset.id)
                                : -1;
                              const pickerOpen = skuPickerRowId === row.id;
                              return (
                                <div className="sku-preview-picker">
                                  <div className="sku-preview-thumb" title={selectedAsset?.originalName || "未提供SKU图"}>
                                    {selectedAsset?.previewUrl ? (
                                      <img alt={`${row.sizeText} SKU预览`} src={selectedAsset.previewUrl} />
                                    ) : <Images size={16} />}
                                  </div>
                                  <button
                                    aria-expanded={pickerOpen}
                                    aria-haspopup="dialog"
                                    aria-label={`${row.sizeText} SKU预览图`}
                                    className="sku-preview-select-trigger"
                                    disabled={busy || !availableSkuPreviewAssets.length}
                                    onClick={() => setSkuPickerRowId(pickerOpen ? null : row.id)}
                                    type="button"
                                  >
                                    <span className="truncate">
                                      {selectedAsset
                                        ? `查看缩略图 · ${selectedAssetIndex + 1}`
                                        : "选择SKU预览图"}
                                    </span>
                                    <ChevronDown size={14} />
                                  </button>
                                  <span className="sku-preview-source">
                                    {row.imageAssetSource === "per_sku_ocr"
                                      ? "图片文字自动匹配"
                                      : row.imageAssetSource === "per_sku_filename"
                                        ? "文件名自动匹配"
                                        : row.imageAssetSource === "shared_main"
                                          ? "商品主图共用"
                                          : row.imageAssetSource === "per_sku_main"
                                            ? "指定商品主图"
                                            : row.imageAssetSource === "shared_sku"
                                              ? "全部SKU共用"
                                              : row.imageAssetSource === "per_sku_manual"
                                                ? "人工指定"
                                                : "未绑定"}
                                  </span>
                                </div>
                              );
                            })()}
                          </td>
                          <td className="w-[280px] px-4 py-3">
                            <div className={`rounded-md border px-3 py-2 text-xs ${
                              saveAttempted && sizeMissing
                                ? "border-[var(--danger)] text-[var(--danger)]"
                                : "border-[var(--line)] text-[var(--text-muted)]"
                            }`}>
                              {row.sizeMapping
                                ? `${row.sizeMapping.attributeName} / ${row.sizeMapping.valueLabel}`
                                : "未能按当前类目自动匹配"}
                            </div>
                            <span className="mt-1 block text-[11px] text-[var(--text-subtle)]">
                              {row.sizeAttributeValues && Object.values(row.sizeAttributeValues).some(Boolean)
                                ? "将按 SHEIN size_attribute_list 提交"
                                : row.sizeMapping?.customValue
                                ? "将按 SHEIN custom_attribute_value 提交"
                                : row.sizeMapping
                                  ? "已自动使用当前类目 SHEIN 尺寸值"
                                  : "请刷新类目规则或调整尺寸模板文本"}
                            </span>
                          </td>
                          <td className="w-[130px] px-4 py-3">
                            <input
                              aria-label={`${row.sizeText}SKU供货总价`}
                              className={`field px-3 ${
                                costInvalid ? "!border-[var(--danger)]" : ""
                              }`}
                              disabled={busy}
                              inputMode="decimal"
                              onChange={(event) => updateSkuRow(row.id, {
                                costPrice: event.target.value,
                              })}
                              value={costPrice}
                            />
                            <span className="mt-1 block text-[var(--text-subtle)]">
                              {currency || "币种待同步"}
                            </span>
                          </td>
                          <td className="w-[120px] px-4 py-3">
                            <input
                              aria-label={`${row.sizeText}库存`}
                              className={`field px-3 ${
                                inventoryInvalid ? "!border-[var(--danger)]" : ""
                              }`}
                              disabled={busy}
                              inputMode="numeric"
                              max="99999"
                              min="0"
                              onChange={(event) => updateSkuRow(row.id, {
                                inventoryNum: event.target.value,
                              })}
                              type="number"
                              value={inventoryText}
                            />
                          </td>
                          <td className="w-[145px] px-4 py-3">
                            <input
                              aria-label={`${row.sizeText}商品重量`}
                              className={`field px-3 ${
                                weightInvalid ? "!border-[var(--danger)]" : ""
                              }`}
                              disabled={busy}
                              inputMode="decimal"
                              onChange={(event) => updateSkuRow(row.id, {
                                weightGrams: event.target.value,
                                weightSource: "manual",
                              })}
                              value={weightText}
                            />
                            <span className="mt-1 block text-[var(--text-subtle)]">
                              {row.weightSource === "area_estimate"
                                ? "面积估算 · g"
                                : weightText
                                  ? "人工值 · g"
                                  : "待填写 · g"}
                            </span>
                          </td>
                          <td className="w-[220px] px-4 py-3">
                            <div className="grid grid-cols-3 gap-1.5">
                              {([
                                ["长", "packageLengthCm"],
                                ["宽", "packageWidthCm"],
                                ["高", "packageHeightCm"],
                              ] as const).map(([label, key]) => (
                                <label className="min-w-0" key={key}>
                                  <span className="mb-1 block text-[10px] text-[var(--text-subtle)]">{label}</span>
                                  <input
                                    aria-label={`${row.sizeText}打包${label}`}
                                    className={`field h-8 px-2 text-xs ${
                                      saveAttempted && !(Number(row[key]) > 0) ? "!border-[var(--danger)]" : ""
                                    }`}
                                    disabled={busy}
                                    inputMode="decimal"
                                    min="0"
                                    onChange={(event) => updateSkuRow(row.id, { [key]: event.target.value })}
                                    type="number"
                                    value={String(row[key] ?? "")}
                                  />
                                </label>
                              ))}
                            </div>
                            <span className="mt-1 block text-[11px] text-[var(--text-subtle)]">
                              {row.packageMatch === "manual"
                                ? ([row.packageLengthCm, row.packageWidthCm, row.packageHeightCm].every((value) => Number(value) > 0)
                                  ? "人工修改"
                                  : "人工填写中 · 待补充")
                                : row.packageMatch === "matched" ? "模板已匹配" : "待补充"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="grid min-h-36 place-items-center px-6 text-center">
                <div>
                  <PackageCheck
                    className="mx-auto text-[var(--text-subtle)]"
                    size={22}
                  />
                  <p className="mt-3 text-sm font-medium text-[var(--ink)]">
                    {category
                      ? "选择颜色与尺寸模板生成 SKU 行"
                      : "先选择末级类目"}
                  </p>
                </div>
              </div>
            )}

            {saveAttempted && category && !skuValidation.valid && (
              <div className="notice notice-danger m-4 sm:m-5" role="alert">
                <AlertCircle size={16} />
                <div className="min-w-0">
                  <p className="font-medium">SKU与包装有 {skuValidation.blockers.length} 项待处理</p>
                  <ul className="mt-2 space-y-1 text-xs leading-5">
                    {skuValidation.blockers.map((blocker, index) => (
                      <li key={`${blocker.code}:${blocker.message}:${index}`}>{blocker.message}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </section>

          <ProductComplianceSection
            busy={busy}
            manualPhotos={compliancePhotoAssignments}
            onOpenTemplates={() => openTemplateManager(
              `/app/templates/${encodeURIComponent(storeId)}/compliance`,
            )}
            onPhotoSourceModeChange={(mode) => {
              setCompliancePhotoSourceMode(mode);
              setFeedback(null);
            }}
            onRemove={removeCompliancePhoto}
            onTemplateChange={(nextTemplateId) => {
              setComplianceTemplateId(nextTemplateId);
              setFeedback(null);
            }}
            onUpload={uploadCompliancePhotos}
            photoSourceMode={compliancePhotoSourceMode}
            saveAttempted={saveAttempted}
            selectedTemplateId={complianceTemplateId}
            stage={complianceStage}
            templates={complianceTemplates.data?.templates || []}
            uploading={compliancePhotoUploading}
          />
        </div>

      </div>

      <SkuPreviewImageDialog
        assets={availableSkuPreviewAssets}
        mainAssetIds={mainImages.map((asset) => asset.id)}
        onClose={() => setSkuPickerRowId(null)}
        onSelect={(assetId) => {
          if (skuPickerRow) assignSkuPreviewAsset(skuPickerRow.id, assetId);
        }}
        open={Boolean(skuPickerRow)}
        rowLabel={skuPickerRow?.sizeText || "当前SKU"}
        selectedAssetId={skuPickerRow?.imageAssetId}
      />

      <footer className="single-product-save-bar fixed inset-x-0 bottom-0 z-30 border-t border-[var(--line)] bg-white/95 shadow-[0_-8px_20px_rgba(15,23,42,0.08)] backdrop-blur lg:left-[236px]">
        <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5 lg:px-6">
          <div className="min-w-0">
            <p className="text-xs font-medium text-[var(--ink)]">
              {blockers.length
                ? `当前草稿还有 ${blockers.length} 个阻断项`
                : "属性、图片与SKU阶段已完整"}
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
              {saveDraft.isPending ? (
                <>
                  <LoaderCircle className="animate-spin" size={13} />
                  正在保存草稿
                </>
              ) : feedback ? (
                <>
                  {feedback.tone === "success"
                    ? <Check size={13} />
                    : <AlertCircle size={13} />}
                  <span>{feedback.message}</span>
                </>
              ) : (
                "保存时重新检查 SHEIN 关联属性规则"
              )}
            </div>
          </div>
          <Button
            className="shrink-0"
            disabled={busy}
            onClick={() => saveDraft.mutate()}
          >
            {saveDraft.isPending
              ? <LoaderCircle className="animate-spin" size={16} />
              : <Save size={16} />}
            {saveDraft.isPending ? "正在保存" : "统一保存当前草稿"}
          </Button>
        </div>
      </footer>
    </div>
  );
}
