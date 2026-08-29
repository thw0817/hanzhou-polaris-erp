import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Check,
  FileImage,
  FolderOpen,
  LoaderCircle,
  Upload,
  X,
} from "lucide-react";
import { useNavigate } from "react-router";
import { Button } from "../../components/ui/button";
import { useAppContext } from "../../app/AppShell";
import { api, type MediaAsset } from "../../lib/api";
import {
  buildProductFolderDraftShell,
  buildProductFolderImportGroups,
  validateProductFolderMappings,
  type ProductFolderImageSlot,
} from "../../lib/product-folder-import-contract.js";
import { validatePublishImage } from "../../../src/lib/publish-image-rules.js";
import type { DraftProductImage } from "./ProductImagesSection";

interface InspectedEntry {
  id: string;
  file: File;
  path: string;
  slot: ProductFolderImageSlot;
  width: number;
  height: number;
  previewUrl: string;
  readError: string;
}

interface InspectedGroup {
  id: string;
  name: string;
  files: InspectedEntry[];
}

export interface ProductFolderImportResult {
  titleSuggestion: string;
  mainImages: DraftProductImage[];
  detailImages: DraftProductImage[];
  skuImages: DraftProductImage[];
  transferredPreviewUrls: string[];
}

const SLOT_OPTIONS: Array<{ value: ProductFolderImageSlot; label: string }> = [
  { value: "unassigned", label: "未分配（不导入）" },
  { value: "main", label: "商品主图" },
  { value: "detail", label: "商品通用轮播图" },
  { value: "sku", label: "通用SKU图" },
];

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

function asDraftImage(asset: MediaAsset, previewUrl: string): DraftProductImage {
  return { ...asset, previewUrl };
}

function inspectedEntryIssues(entry: InspectedEntry) {
  if (entry.slot === "unassigned") return [];
  if (entry.readError) return [`${entry.file.name}：${entry.readError}`];
  return validatePublishImage(
    entry.file,
    entry.slot,
    entry.width,
    entry.height,
  ).map((issue) => `${entry.file.name}：${issue}`);
}

function summarizeBatchGroup(
  group: InspectedGroup,
  options: { existingDetailCount?: number } = {},
) {
  const mapping = validateProductFolderMappings(group.files, options);
  const blockers = [
    ...mapping.blockers,
    ...group.files.flatMap(inspectedEntryIssues),
    ...(mapping.selectedCount === 0 ? ["至少映射1张要导入的图片"] : []),
  ];
  return { group, mapping, blockers };
}

export function ProductFolderImport({
  storeId,
  busy,
  existingDetailCount,
  onImported,
  onUploadingChange,
}: {
  storeId: string;
  busy: boolean;
  existingDetailCount: number;
  onImported: (result: ProductFolderImportResult) => void;
  onUploadingChange: (uploading: boolean) => void;
}) {
  const { session } = useAppContext();
  const queryScope = `${session.tenant.id}:${session.user.id}`;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const previewUrlsRef = useRef(new Set<string>());
  const transferredUrlsRef = useRef(new Set<string>());
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<InspectedGroup[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [parsing, setParsing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [batchSelectedIds, setBatchSelectedIds] = useState<string[]>([]);
  const [batchConfirmed, setBatchConfirmed] = useState(false);
  const [batchCreatedGroupIds, setBatchCreatedGroupIds] = useState<string[]>([]);
  const [batchResult, setBatchResult] = useState<{
    success: Array<{ groupId: string; name: string; draftId: string }>;
    failures: Array<{ groupId: string; name: string; message: string }>;
  } | null>(null);

  const revokePendingPreviews = () => {
    previewUrlsRef.current.forEach((url) => {
      if (!transferredUrlsRef.current.has(url)) URL.revokeObjectURL(url);
    });
    previewUrlsRef.current.clear();
  };

  useEffect(() => () => revokePendingPreviews(), []);

  useEffect(() => {
    revokePendingPreviews();
    transferredUrlsRef.current.clear();
    setGroups([]);
    setSelectedGroupId("");
    setOpen(false);
    setFeedback("");
    setBatchSelectedIds([]);
    setBatchConfirmed(false);
    setBatchCreatedGroupIds([]);
    setBatchResult(null);
  }, [storeId]);

  const selectedGroup = groups.find((group) => group.id === selectedGroupId) || null;
  const mapping = useMemo(() => selectedGroup
    ? validateProductFolderMappings(selectedGroup.files, {
        existingDetailCount,
      })
    : null,
  [existingDetailCount, selectedGroup]);
  const imageIssues = useMemo(
    () => selectedGroup?.files.flatMap(inspectedEntryIssues) || [],
    [selectedGroup],
  );
  const blockers = [
    ...(mapping?.blockers || []),
    ...imageIssues,
    ...(mapping && mapping.selectedCount === 0 ? ["至少映射1张要导入的图片"] : []),
  ];
  const batchSummaries = useMemo(
    () => groups.map((group) => summarizeBatchGroup(group, {
      existingDetailCount,
    })),
    [existingDetailCount, groups],
  );
  const selectedBatchSummaries = batchSummaries.filter(
    (item) => batchSelectedIds.includes(item.group.id),
  );
  const selectedBatchBlockerCount = selectedBatchSummaries.reduce(
    (sum, item) => sum + item.blockers.length,
    0,
  );

  const chooseFolder = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) return;
    setParsing(true);
    setFeedback("");
    revokePendingPreviews();
    try {
      const parsed = buildProductFolderImportGroups(files);
      const inspected = await Promise.all(parsed.groups.map(async (group) => ({
        ...group,
        files: await Promise.all(group.files.map(async (entry) => {
          const file = prepareImageFile(entry.file);
          const previewUrl = URL.createObjectURL(file);
          previewUrlsRef.current.add(previewUrl);
          try {
            const dimensions = await readImageDimensions(file);
            return {
              ...entry,
              file,
              slot: entry.suggestedSlot,
              width: dimensions.width,
              height: dimensions.height,
              previewUrl,
              readError: "",
            };
          } catch (error) {
            return {
              ...entry,
              file,
              slot: entry.suggestedSlot,
              width: 0,
              height: 0,
              previewUrl,
              readError: error instanceof Error ? error.message : "无法读取图片尺寸",
            };
          }
        })),
      })));
      setGroups(inspected);
      setSelectedGroupId(inspected[0]?.id || "");
      setBatchSelectedIds(inspected.length > 1 ? inspected.map((group) => group.id) : []);
      setBatchConfirmed(false);
      setBatchCreatedGroupIds([]);
      setBatchResult(null);
      setFeedback([
        `识别到 ${inspected.length} 个商品文件夹、${inspected.reduce((sum, group) => sum + group.files.length, 0)} 张图片。`,
        parsed.ignoredCount ? `已忽略 ${parsed.ignoredCount} 个非 JPG/PNG 文件。` : "",
        "未标记用途的图片默认作为商品主图；如需调整，可在这里改成通用轮播图或 SKU 图。",
      ].filter(Boolean).join(" "));
    } catch (error) {
      setGroups([]);
      setSelectedGroupId("");
      setFeedback(error instanceof Error ? error.message : "素材文件夹解析失败");
    } finally {
      setParsing(false);
    }
  };

  const updateSlot = (entryId: string, slot: ProductFolderImageSlot) => {
    setGroups((current) => current.map((group) => group.id === selectedGroupId
      ? {
          ...group,
          files: group.files.map((entry) => entry.id === entryId
            ? { ...entry, slot }
            : entry),
        }
      : group));
    setBatchConfirmed(false);
    setBatchResult(null);
  };

  const toggleBatchGroup = (groupId: string) => {
    setBatchSelectedIds((current) => current.includes(groupId)
      ? current.filter((id) => id !== groupId)
      : [...current, groupId]);
    setBatchConfirmed(false);
    setBatchResult(null);
  };

  const createBatchDrafts = async () => {
    if (!batchConfirmed || !selectedBatchSummaries.length || selectedBatchBlockerCount) return;
    setUploading(true);
    onUploadingChange(true);
    setBatchResult(null);
    const success: Array<{ groupId: string; name: string; draftId: string }> = [];
    const failures: Array<{ groupId: string; name: string; message: string }> = [];
    try {
      for (const item of selectedBatchSummaries) {
        try {
          const uploadedImages: Array<{ slot: ProductFolderImageSlot; asset: MediaAsset }> = [];
          for (const entry of item.group.files.filter((file) => file.slot !== "unassigned")) {
            const uploaded = entry.slot === "sku"
              ? await api.uploadSkuImage(storeId, entry.file, {
                  width: entry.width,
                  height: entry.height,
                })
              : await api.uploadProductImage(storeId, entry.file, {
                  width: entry.width,
                  height: entry.height,
                });
            uploadedImages.push({ slot: entry.slot, asset: uploaded.asset });
          }
          const shell = buildProductFolderDraftShell({
            name: item.group.name,
            uploadedImages,
          });
          const saved = await api.saveProductDraft(storeId, shell.input);
          success.push({ groupId: item.group.id, name: item.group.name, draftId: saved.draft.id });
        } catch (error) {
          failures.push({
            groupId: item.group.id,
            name: item.group.name,
            message: error instanceof Error ? error.message : "商品草稿创建失败",
          });
        }
      }
      setBatchCreatedGroupIds((current) => [...new Set([
        ...current,
        ...success.map((item) => item.groupId),
      ])]);
      setBatchSelectedIds(failures.map((item) => item.groupId));
      setBatchConfirmed(false);
      setBatchResult({ success, failures });
      if (success.length) {
        void queryClient.invalidateQueries({ queryKey: ["store", queryScope, storeId, "product-drafts"], exact: false });
      }
    } finally {
      setUploading(false);
      onUploadingChange(false);
    }
  };

  const importSelected = async () => {
    if (!selectedGroup || blockers.length) return;
    setUploading(true);
    onUploadingChange(true);
    setFeedback("");
    try {
      const selected = selectedGroup.files.filter((entry) => entry.slot !== "unassigned");
      const uploaded = await Promise.all(selected.map(async (entry) => {
        const result = entry.slot === "sku"
          ? await api.uploadSkuImage(storeId, entry.file, {
              width: entry.width,
              height: entry.height,
            })
          : await api.uploadProductImage(storeId, entry.file, {
              width: entry.width,
              height: entry.height,
            });
        transferredUrlsRef.current.add(entry.previewUrl);
        return { entry, asset: result.asset };
      }));
      const bySlot = (slot: ProductFolderImageSlot) => uploaded
        .filter((item) => item.entry.slot === slot)
        .map((item) => asDraftImage(item.asset, item.entry.previewUrl));
      onImported({
        titleSuggestion: selectedGroup.name,
        mainImages: bySlot("main"),
        detailImages: bySlot("detail"),
        skuImages: bySlot("sku"),
        transferredPreviewUrls: uploaded.map((item) => item.entry.previewUrl),
      });
      revokePendingPreviews();
      setGroups([]);
      setSelectedGroupId("");
      setOpen(false);
      setFeedback("");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "素材导入失败");
    } finally {
      setUploading(false);
      onUploadingChange(false);
    }
  };

  return (
    <section className="mb-4 rounded-md border border-[var(--line)] bg-white">
      <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-[var(--ink)]">从素材文件夹开始</h2>
          <p className="mt-1 text-xs leading-5 text-[var(--text-subtle)]">
            识别图片用途并预览；保存为商品草稿素材，不选择类目、不填写属性、不发布 SHEIN。
          </p>
        </div>
        <Button disabled={busy} onClick={() => setOpen((current) => !current)} variant="outline">
          {open ? <X size={16} /> : <FolderOpen size={16} />}
          {open ? "收起导入" : "导入素材文件夹"}
        </Button>
      </div>

      {open && (
        <div className="border-t border-[var(--line)] px-4 py-4">
          <input
            accept="image/jpeg,image/png,.jpg,.jpeg,.png"
            className="hidden"
            multiple
            onChange={(event) => void chooseFolder(event)}
            ref={inputRef}
            type="file"
            {...({ webkitdirectory: "" } as Record<string, string>)}
          />
          <button
            className="grid min-h-24 w-full place-items-center rounded-md border border-dashed border-[var(--line-strong)] bg-[var(--surface-muted)] px-4 text-center text-xs text-[var(--text-muted)] hover:border-[var(--ink)]"
            disabled={busy || parsing || uploading}
            onClick={() => inputRef.current?.click()}
            type="button"
          >
            <span>
              {parsing ? <LoaderCircle className="mx-auto mb-2 animate-spin" size={20} /> : <Upload className="mx-auto mb-2" size={20} />}
              {parsing ? "正在读取图片尺寸" : "选择一个商品文件夹，或包含多个商品子文件夹的根目录"}
            </span>
          </button>

          {feedback && (
            <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-[var(--text-muted)]" role="status">
              <Check className="mt-0.5 shrink-0" size={14} />
              {feedback}
            </p>
          )}

          {groups.length > 1 && (
            <div className="mt-4 rounded-md border border-[var(--line)] bg-[var(--surface-muted)] p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-[var(--ink)]">批量草稿队列</h3>
                  <p className="mt-1 text-xs leading-5 text-[var(--text-subtle)]">
                    每个文件夹创建一个待修正商品草稿；创建后需逐个商品继续补充类目、属性和 SKU。
                  </p>
                </div>
                <span className="status-badge">已选 {batchSelectedIds.length} / {groups.length}</span>
              </div>
              <div className="mt-3 grid gap-2 lg:grid-cols-2">
                {batchSummaries.map((item) => {
                  const created = batchCreatedGroupIds.includes(item.group.id);
                  return (
                    <div className={`flex items-start gap-3 rounded-sm border bg-white p-3 ${item.blockers.length ? "border-red-200" : "border-[var(--line)]"}`} key={item.group.id}>
                      <input
                        aria-label={`批量创建 ${item.group.name}`}
                        checked={batchSelectedIds.includes(item.group.id)}
                        className="mt-1"
                        disabled={uploading || created}
                        onChange={() => toggleBatchGroup(item.group.id)}
                        type="checkbox"
                      />
                      <div className="min-w-0 flex-1">
                        <strong className="block truncate text-xs font-medium text-[var(--ink)]">{item.group.name}</strong>
                        <p className={`mt-1 text-[11px] ${item.blockers.length ? "text-[var(--danger)]" : "text-[var(--text-subtle)]"}`}>
                          {created
                            ? "已创建商品草稿"
                            : item.blockers.length
                              ? `${item.blockers.length} 项阻断：${item.blockers[0]}`
                              : `${item.mapping.selectedCount} 张图片可导入`}
                        </p>
                      </div>
                      <button
                        className="shrink-0 text-xs font-medium text-[var(--text-muted)] underline underline-offset-2"
                        disabled={uploading}
                        onClick={() => setSelectedGroupId(item.group.id)}
                        type="button"
                      >
                        检查映射
                      </button>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 border-t border-[var(--line)] pt-3">
                <label className="flex items-start gap-2 text-xs font-medium text-[var(--ink)]">
                  <input
                    checked={batchConfirmed}
                    className="mt-0.5"
                    disabled={!batchSelectedIds.length || selectedBatchBlockerCount > 0 || uploading}
                    onChange={(event) => setBatchConfirmed(event.target.checked)}
                    type="checkbox"
                  />
                  我确认只创建商品草稿，不发布 SHEIN
                </label>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <Button
                    disabled={!batchConfirmed || !batchSelectedIds.length || selectedBatchBlockerCount > 0 || uploading}
                    onClick={() => void createBatchDrafts()}
                  >
                    {uploading ? <LoaderCircle className="animate-spin" size={16} /> : <FileImage size={16} />}
                    {uploading ? "正在逐个创建" : `创建 ${batchSelectedIds.length} 个商品草稿`}
                  </Button>
                  <span className={`text-xs ${selectedBatchBlockerCount ? "text-[var(--danger)]" : "text-[var(--text-subtle)]"}`}>
                    {selectedBatchBlockerCount
                      ? `选中商品还有 ${selectedBatchBlockerCount} 项阻断，请先检查映射`
                      : "按文件夹串行上传和保存，单个失败不影响其他商品"}
                  </span>
                </div>
              </div>
              {batchResult && (
                <div className={`notice mt-3 ${batchResult.failures.length ? "notice-warning" : "notice-success"}`} role="status">
                  {batchResult.failures.length ? <AlertCircle size={16} /> : <Check size={16} />}
                  <div className="min-w-0 flex-1">
                    <p>成功 {batchResult.success.length} 个，失败 {batchResult.failures.length} 个。</p>
                    {batchResult.failures.map((item) => (
                      <p className="mt-1 text-xs" key={item.groupId}>{item.name}：{item.message}</p>
                    ))}
                  </div>
                  {batchResult.success.length > 0 && (
                    <Button
                      onClick={() => navigate(`/app/operations/${encodeURIComponent(storeId)}/products/drafts`)}
                      size="sm"
                      variant="outline"
                    >
                      前往商品草稿
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}

          {groups.length > 0 && (
            <div className="mt-4 space-y-4">
              {groups.length > 1 && (
                <label className="block max-w-xl">
                  <span className="text-xs font-medium text-[var(--text-muted)]">本次导入的商品文件夹</span>
                  <select
                    className="field mt-2 px-3"
                    disabled={uploading}
                    onChange={(event) => setSelectedGroupId(event.target.value)}
                    value={selectedGroupId}
                  >
                    {groups.map((group) => (
                      <option key={group.id} value={group.id}>{group.name} · {group.files.length} 张</option>
                    ))}
                  </select>
                  <span className="mt-1.5 block text-[11px] text-[var(--text-subtle)]">
                    可逐个检查图片用途；也可在上方确认后批量创建独立商品草稿。
                  </span>
                </label>
              )}

              {selectedGroup && (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {selectedGroup.files.map((entry) => {
                    const issues = entry.slot === "unassigned"
                      ? []
                      : entry.readError
                        ? [entry.readError]
                        : validatePublishImage(
                            entry.file,
                            entry.slot,
                            entry.width,
                            entry.height,
                          );
                    return (
                      <article className={`min-w-0 border bg-white ${issues.length ? "border-[var(--danger)]" : "border-[var(--line)]"}`} key={entry.id}>
                        <div className="aspect-square overflow-hidden bg-[var(--surface-muted)]">
                          <img alt={entry.file.name} className="h-full w-full object-cover" src={entry.previewUrl} />
                        </div>
                        <div className="space-y-2 border-t border-[var(--line)] p-2.5">
                          <p className="truncate text-xs font-medium text-[var(--ink)]" title={entry.path}>{entry.file.name}</p>
                          <p className="text-[11px] text-[var(--text-subtle)]">{entry.width || "--"}×{entry.height || "--"}</p>
                          <select
                            aria-label={`${entry.file.name}图片用途`}
                            className="field h-9 px-2 text-xs"
                            disabled={uploading}
                            onChange={(event) => updateSlot(entry.id, event.target.value as ProductFolderImageSlot)}
                            value={entry.slot}
                          >
                            {SLOT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                          </select>
                          {issues.map((issue) => (
                            <p className="flex gap-1 text-[11px] leading-4 text-[var(--danger)]" key={issue}>
                              <AlertCircle className="mt-0.5 shrink-0" size={12} />{issue}
                            </p>
                          ))}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}

              <div className="flex flex-col gap-3 border-t border-[var(--line)] pt-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-xs leading-5 text-[var(--text-subtle)]">
                  <p>
                    已映射 {mapping?.selectedCount || 0} 张；未分配 {mapping?.counts.unassigned || 0} 张不会上传。
                  </p>
                  <p>导入的主图和SKU图会替换当前草稿对应图片；细节图与详情图追加。</p>
                  {blockers.map((blocker) => (
                    <p className="text-[var(--danger)]" key={blocker}>{blocker}</p>
                  ))}
                </div>
                <Button disabled={busy || uploading || blockers.length > 0} onClick={() => void importSelected()}>
                  {uploading ? <LoaderCircle className="animate-spin" size={16} /> : <FileImage size={16} />}
                  {uploading ? "正在写入草稿素材" : "确认导入当前商品"}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
