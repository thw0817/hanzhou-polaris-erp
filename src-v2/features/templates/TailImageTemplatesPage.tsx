import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Cropper, { type Area } from "react-easy-crop";
import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  Images,
  LoaderCircle,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useAppContext } from "../../app/AppShell";
import { Button } from "../../components/ui/button";
import {
  api,
  type SaveTailImageTemplateInput,
  type TailImageCropMetadata,
  type TailImageTemplate,
  type TailImageTemplateAsset,
} from "../../lib/api";
import {
  moveTailImageAsset,
  validateTailImageTemplateDraft,
} from "../../lib/tail-image-template-contract.js";
import {
  cropImageFile,
  isSheinMainImageReady,
  SHEIN_MAIN_IMAGE_PRESETS,
} from "../../../src/lib/main-image-crop.js";
import { formatTime } from "../operations/OperationsShared";

interface DraftAsset extends TailImageTemplateAsset {
  previewUrl?: string;
  templateId?: string;
}

interface CropQueueItem {
  id: string;
  file: File;
  previewUrl: string;
  presetId: "portrait" | "square";
  sourceWidth: number;
  sourceHeight: number;
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
    const previewUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(previewUrl);
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(previewUrl);
      reject(new Error(`${file.name}：无法读取图片尺寸`));
    };
    image.src = previewUrl;
  });
}

function revokeBlobPreview(asset: Pick<DraftAsset, "previewUrl">) {
  if (asset.previewUrl?.startsWith("blob:")) {
    URL.revokeObjectURL(asset.previewUrl);
  }
}

function CropDialog({
  item,
  onCancel,
  onSave,
}: {
  item: CropQueueItem | null;
  onCancel: () => void;
  onSave: (
    file: File,
    input: { presetId: "portrait" | "square"; cropPixels: Area },
  ) => Promise<void>;
}) {
  const [presetId, setPresetId] = useState<"portrait" | "square">(
    item?.presetId || "portrait",
  );
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(0.75);
  const [cropPixels, setCropPixels] = useState<Area | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setPresetId(item?.presetId || "portrait");
    setCrop({ x: 0, y: 0 });
    setZoom(0.75);
    setCropPixels(null);
    setError("");
  }, [item?.id, item?.presetId]);

  if (!item) return null;
  const preset = SHEIN_MAIN_IMAGE_PRESETS[presetId];

  const saveCrop = async () => {
    if (!cropPixels) return;
    setSaving(true);
    setError("");
    try {
      const file = await cropImageFile({
        file: item.file,
        imageUrl: item.previewUrl,
        cropPixels,
        presetId,
      });
      await onSave(file, { presetId, cropPixels });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "裁剪结果上传失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      aria-label="裁剪通用商品图片"
      aria-modal="true"
      className="fixed inset-0 z-[100] grid place-items-center bg-black/55 p-3"
      role="dialog"
    >
      <section className="flex max-h-[calc(100dvh-24px)] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-[var(--shadow-md)]">
        <header className="flex items-start gap-3 border-b border-[var(--line)] px-4 py-3 sm:px-5">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-[var(--text-subtle)]">
              SHEIN 主图规范
            </p>
            <h2 className="mt-1 text-base font-semibold text-[var(--ink)]">
              裁剪通用商品图片
            </h2>
            <p className="mt-1 truncate text-xs text-[var(--text-muted)]">
              {item.file.name}
            </p>
          </div>
          <Button
            aria-label="取消裁剪"
            disabled={saving}
            onClick={onCancel}
            size="icon"
            variant="ghost"
          >
            <X size={17} />
          </Button>
        </header>

        <div className="grid grid-cols-2 border-b border-[var(--line)] p-2">
          {Object.values(SHEIN_MAIN_IMAGE_PRESETS).map((option) => (
            <button
              className={`rounded-sm px-3 py-2 text-left ${
                presetId === option.id
                  ? "bg-[var(--nav-active)] text-[var(--ink)]"
                  : "text-[var(--text-muted)] hover:bg-[var(--surface-muted)]"
              }`}
              disabled={saving}
              key={option.id}
              onClick={() => setPresetId(option.id)}
              type="button"
            >
              <span className="block text-xs font-semibold">{option.label}</span>
              <span className="mt-0.5 block text-[11px] text-[var(--text-subtle)]">
                {option.id === "portrait" ? "固定 1340×1785" : "输出 1200×1200"}
              </span>
            </button>
          ))}
        </div>

        <div className="relative min-h-72 flex-1 bg-[#181b1b] sm:min-h-[420px]">
          <Cropper
            aspect={preset.aspect}
            crop={crop}
            image={item.previewUrl}
            minZoom={0.5}
            onCropChange={setCrop}
            onCropComplete={(_, pixels) => setCropPixels(pixels)}
            onZoomChange={setZoom}
            objectFit="contain"
            restrictPosition={false}
            showGrid
            zoom={zoom}
          />
        </div>

        <div className="border-t border-[var(--line)] px-4 py-3 sm:px-5">
          <label className="flex items-center gap-3 text-xs font-medium text-[var(--text-muted)]">
            <span>缩放（可缩小）</span>
            <input
              className="min-w-0 flex-1 accent-[var(--focus)]"
              disabled={saving}
              max="3"
              min="0.5"
              onChange={(event) => setZoom(Number(event.target.value))}
              step="0.01"
              type="range"
              value={zoom}
            />
          </label>
          {error && (
            <div className="notice notice-danger mt-3" role="alert">
              <AlertCircle size={15} />
              <span>{error}</span>
            </div>
          )}
          <footer className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-[var(--text-subtle)]">
              裁剪在浏览器完成，保存结果后才上传对象存储
            </p>
            <div className="flex justify-end gap-2">
              <Button disabled={saving} onClick={onCancel} variant="outline">
                取消
              </Button>
              <Button
                disabled={saving || !cropPixels}
                onClick={() => void saveCrop()}
              >
                {saving
                  ? <LoaderCircle className="animate-spin" size={16} />
                  : <Check size={16} />}
                {saving ? "正在裁剪并上传" : "保存裁剪"}
              </Button>
            </div>
          </footer>
        </div>
      </section>
    </div>
  );
}

function TemplateList({
  templates,
  loading,
  busy,
  onEdit,
  onDelete,
}: {
  templates: TailImageTemplate[];
  loading: boolean;
  busy: boolean;
  onEdit: (template: TailImageTemplate) => void;
  onDelete: (template: TailImageTemplate) => void;
}) {
  const [templateSearch, setTemplateSearch] = useState("");
  const filteredTemplates = useMemo(() => {
    const query = templateSearch.trim().toLocaleLowerCase();
    if (!query) return templates;
    return templates.filter((template) => [
      template.name,
      template.scopeLabel,
    ].some((value) => String(value || "").toLocaleLowerCase().includes(query)));
  }, [templateSearch, templates]);

  return (
    <section className="data-panel self-start">
      <header className="data-toolbar">
        <div>
          <h2>可引用模板</h2>
          <p>当前账号可见的通用商品图片模板</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <label className="search-field sm:w-56">
            <Search size={15} />
            <input
              aria-label="搜索通用商品图片模板"
              onChange={(event) => setTemplateSearch(event.target.value)}
              placeholder="搜索模板名"
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
                <span className="mt-1.5 block text-xs text-[var(--text-subtle)]">
                  {template.data.assetIds?.length || 0} 张 · 固定追加到末尾
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
            <Images className="mx-auto text-[var(--text-subtle)]" size={24} />
            <p className="mt-3 text-sm font-medium text-[var(--ink)]">
              {templates.length ? "没有匹配的通用商品图片模板" : "还没有通用商品图片模板"}
            </p>
            <p className="mt-1 text-xs text-[var(--text-subtle)]">
              {templates.length ? "调整搜索词后重试" : "上传图片、调整顺序后统一保存"}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

export function TailImageTemplatesPage() {
  const { currentStore, session } = useAppContext();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const assetsRef = useRef<DraftAsset[]>([]);
  const cropQueueRef = useRef<CropQueueItem[]>([]);
  const storeId = currentStore?.id || "";
  const queryScope = `${session.tenant.id}:${session.user.id}`;
  const [editingId, setEditingId] = useState("");
  const [name, setName] = useState("");
  const [assets, setAssets] = useState<DraftAsset[]>([]);
  const [cropQueue, setCropQueue] = useState<CropQueueItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [draggedId, setDraggedId] = useState("");
  const [saveAttempted, setSaveAttempted] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "danger";
    message: string;
  } | null>(null);

  const clearAssets = () => {
    setAssets((current) => {
      current.forEach(revokeBlobPreview);
      return [];
    });
    setCropQueue((current) => {
      current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      return [];
    });
  };

  const resetEditor = () => {
    clearAssets();
    setEditingId("");
    setName("");
    setUploading(false);
    setDraggedId("");
    setSaveAttempted(false);
    setFeedback(null);
  };

  useEffect(() => {
    resetEditor();
  }, [storeId]);

  useEffect(() => {
    assetsRef.current = assets;
    cropQueueRef.current = cropQueue;
  }, [assets, cropQueue]);

  useEffect(() => () => {
    assetsRef.current.forEach(revokeBlobPreview);
    cropQueueRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
  }, []);

  const templates = useQuery({
    queryKey: ["store", queryScope, storeId, "publish-templates", "tail_image"],
    queryFn: () => api.tailImageTemplates(storeId),
    enabled: Boolean(storeId),
    refetchOnMount: false,
  });
  const validation = useMemo(
    () => validateTailImageTemplateDraft({ name, assets }),
    [assets, name],
  );
  const canManageTenantTemplates = ["owner", "admin"].includes(session.user.role);

  useEffect(() => {
    const missing = assets.filter(
      (asset) => asset.templateId && !asset.previewUrl,
    );
    if (!missing.length) return;
    const previews = new Map(
      missing.map((asset) => [
        asset.id,
        api.tailImagePreviewUrl(storeId, asset.templateId || "", asset.id),
      ] as const),
    );
    setAssets((current) => current.map((asset) =>
      previews.has(asset.id)
        ? { ...asset, previewUrl: previews.get(asset.id) }
        : asset
    ));
  }, [assets, storeId]);

  const appendUploadedAsset = (
    asset: {
      id: string;
      storeId: string | null;
      originalName: string;
      contentType: string;
      width: number | null;
      height: number | null;
    },
    previewUrl: string,
    crop: TailImageCropMetadata,
  ) => {
    setAssets((current) => [
      ...current,
      {
        id: asset.id,
        storeId: asset.storeId || storeId,
        originalName: asset.originalName,
        contentType: asset.contentType,
        width: asset.width,
        height: asset.height,
        crop,
        previewUrl,
      },
    ]);
  };

  const uploadFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) return;
    setUploading(true);
    setSaveAttempted(false);
    setFeedback(null);
    const errors: string[] = [];
    const nextCropItems: CropQueueItem[] = [];
    let uploadedCount = 0;

    for (const sourceFile of files) {
      const file = prepareImageFile(sourceFile);
      try {
        if (!["image/jpeg", "image/png"].includes(file.type)) {
          throw new Error(`${file.name}：仅支持 JPG、JPEG、PNG`);
        }
        const dimensions = await readImageDimensions(file);
        const previewUrl = URL.createObjectURL(file);
        if (isSheinMainImageReady({
          ...dimensions,
          sizeBytes: file.size,
        })) {
          try {
            const result = await api.uploadTailImage(storeId, file, dimensions);
            appendUploadedAsset(result.asset, previewUrl, {
              mode: "original",
              presetId: dimensions.width === dimensions.height ? "square" : "portrait",
              sourceWidth: dimensions.width,
              sourceHeight: dimensions.height,
              outputWidth: dimensions.width,
              outputHeight: dimensions.height,
            });
            uploadedCount += 1;
          } catch (error) {
            URL.revokeObjectURL(previewUrl);
            throw error;
          }
        } else {
          nextCropItems.push({
            id: crypto.randomUUID(),
            file,
            previewUrl,
            presetId: dimensions.width === dimensions.height ? "square" : "portrait",
            sourceWidth: dimensions.width,
            sourceHeight: dimensions.height,
          });
        }
      } catch (error) {
        errors.push(error instanceof Error ? error.message : `${file.name}：上传失败`);
      }
    }

    setCropQueue((current) => [...current, ...nextCropItems]);
    setUploading(false);
    if (errors.length) {
      setFeedback({ tone: "danger", message: errors.slice(0, 3).join("；") });
    } else if (nextCropItems.length) {
      setFeedback({
        tone: "success",
        message: `${uploadedCount} 张直接上传，${nextCropItems.length} 张等待裁剪`,
      });
    } else {
      setFeedback({ tone: "success", message: `已上传 ${uploadedCount} 张通用商品图片` });
    }
  };

  const saveCroppedImage = async (
    file: File,
    input: { presetId: "portrait" | "square"; cropPixels: Area },
  ) => {
    const current = cropQueue[0];
    if (!current) return;
    const output = SHEIN_MAIN_IMAGE_PRESETS[input.presetId];
    const previewUrl = URL.createObjectURL(file);
    try {
      const result = await api.uploadTailImage(storeId, file, {
        width: output.width,
        height: output.height,
      });
      appendUploadedAsset(result.asset, previewUrl, {
        mode: "cropped",
        presetId: input.presetId,
        sourceWidth: current.sourceWidth,
        sourceHeight: current.sourceHeight,
        outputWidth: output.width,
        outputHeight: output.height,
      });
      URL.revokeObjectURL(current.previewUrl);
      setCropQueue((queue) => queue.slice(1));
      setFeedback({ tone: "success", message: `“${current.file.name}”已裁剪并上传` });
    } catch (error) {
      URL.revokeObjectURL(previewUrl);
      throw error;
    }
  };

  const cancelCrop = () => {
    const current = cropQueue[0];
    if (current) URL.revokeObjectURL(current.previewUrl);
    setCropQueue((queue) => queue.slice(1));
  };

  const removeAsset = (assetId: string) => {
    setAssets((current) => {
      const target = current.find((asset) => asset.id === assetId);
      if (target) revokeBlobPreview(target);
      return current.filter((asset) => asset.id !== assetId);
    });
    setFeedback(null);
  };

  const moveAsset = (assetId: string, direction: "previous" | "next") => {
    setAssets((current) => moveTailImageAsset(current, assetId, direction));
    setFeedback(null);
  };

  const onDrop = (event: DragEvent<HTMLElement>, targetId: string) => {
    event.preventDefault();
    const sourceId = draggedId || event.dataTransfer.getData("text/plain");
    setAssets((current) => moveTailImageAsset(current, sourceId, targetId));
    setDraggedId("");
    setFeedback(null);
  };

  const editTemplate = (template: TailImageTemplate) => {
    clearAssets();
    const metadataById = new Map(
      (template.data.assets || []).map((asset) => [asset.id, asset]),
    );
    setEditingId(template.id);
    setName(template.name);
    setAssets((template.data.assetIds || []).map((id) => {
      const asset = metadataById.get(id);
      return {
        id,
        storeId: asset?.storeId || template.storeId,
        originalName: asset?.originalName || `通用商品图片 ${id.slice(0, 8)}`,
        contentType: asset?.contentType || "image/jpeg",
        width: asset?.width || null,
        height: asset?.height || null,
        crop: asset?.crop || {
          mode: "original",
          presetId: "square",
          sourceWidth: asset?.width || null,
          sourceHeight: asset?.height || null,
          outputWidth: asset?.width || null,
          outputHeight: asset?.height || null,
        },
        templateId: template.id,
      };
    }));
    setSaveAttempted(false);
    setFeedback(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const saveTemplate = useMutation({
    mutationFn: async () => {
      setSaveAttempted(true);
      if (cropQueue.length) {
        throw new Error(`还有 ${cropQueue.length} 张图片等待裁剪或取消`);
      }
      if (!validation.valid) {
        const targetId = validation.errors.name
          ? "tail-image-template-name"
          : "tail-image-assets";
        const target = document.getElementById(targetId);
        target?.scrollIntoView({ behavior: "smooth", block: "center" });
        if (target instanceof HTMLInputElement) {
          target.focus({ preventScroll: true });
        }
        throw new Error(
          validation.errors.name || validation.errors.assets || "模板内容不完整",
        );
      }
      const input: SaveTailImageTemplateInput = {
        name: validation.data.name,
        data: {
          ...validation.data.template,
          placement: "append",
        },
      };
      return api.saveTailImageTemplate(storeId, input, editingId);
    },
    onMutate: () => setFeedback(null),
    onSuccess: ({ template }) => {
      queryClient.invalidateQueries({
        queryKey: ["store", queryScope, storeId, "publish-templates", "tail_image"],
      });
      const previews = new Map(assets.map((asset) => [asset.id, asset.previewUrl]));
      setEditingId(template.id);
      setAssets((template.data.assets || []).map((asset) => ({
        ...asset,
        previewUrl: previews.get(asset.id),
        templateId: template.id,
      })));
      setFeedback({ tone: "success", message: `模板“${template.name}”已保存` });
    },
    onError: (error: Error) => {
      setFeedback({ tone: "danger", message: error.message });
    },
  });

  const deleteTemplate = useMutation({
    mutationFn: (template: TailImageTemplate) =>
      api.deleteTailImageTemplate(storeId, template.id),
    onSuccess: (_, template) => {
      queryClient.invalidateQueries({
        queryKey: ["store", queryScope, storeId, "publish-templates", "tail_image"],
      });
      if (editingId === template.id) resetEditor();
      setFeedback({ tone: "success", message: `模板“${template.name}”已删除` });
    },
    onError: (error: Error) => {
      setFeedback({ tone: "danger", message: error.message });
    },
  });

  const confirmDelete = (template: TailImageTemplate) => {
    if (window.confirm(`确认删除模板“${template.name}”吗？`)) {
      deleteTemplate.mutate(template);
    }
  };

  if (!currentStore) return null;
  const busy = uploading || saveTemplate.isPending || deleteTemplate.isPending;
  const showNameError = saveAttempted ? validation.errors.name : "";
  const showAssetsError = saveAttempted ? validation.errors.assets : "";

  return (
    <>
      <header className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-xs font-medium text-[var(--text-subtle)]">模板中心</p>
          <h1 className="mt-1.5 text-2xl font-semibold text-[var(--ink)]">
            通用商品图片
          </h1>
          <p className="mt-1.5 text-sm text-[var(--text-muted)]">
            {currentStore.label} · 上传、裁剪与排序
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
          模板只追加到商品自身主图最后，不覆盖首图，也不插入商品已有图片中间。
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
              <h2>{editingId ? "编辑通用商品图片模板" : "新建通用商品图片模板"}</h2>
              <p>连续上传 JPG/PNG；不合规图片先完成真实裁剪</p>
            </div>
            <span className="status-badge">
              {canManageTenantTemplates ? "全员通用" : "我的店铺通用"}
            </span>
          </header>

          {saveAttempted && (!validation.valid || cropQueue.length > 0) && (
            <div className="notice notice-danger m-4 sm:m-5" role="alert">
              <AlertCircle size={16} />
              <span>保存前请填写模板名称、保留至少一张图片，并处理全部待裁剪图片</span>
            </div>
          )}

          <div className="border-b border-[var(--line)] px-4 py-4 sm:px-5">
            <label
              className="block text-xs font-medium text-[var(--text-muted)]"
              htmlFor="tail-image-template-name"
            >
              模板名称
            </label>
            <input
              className={`field mt-2 max-w-xl px-3 ${
                showNameError ? "!border-[var(--danger)]" : ""
              }`}
              disabled={busy}
              id="tail-image-template-name"
              maxLength={80}
              onChange={(event) => {
                setName(event.target.value);
                setFeedback(null);
              }}
              placeholder="例如：天鹅绒材质与保养说明"
              value={name}
            />
            {showNameError && (
              <p className="mt-1.5 text-xs font-medium text-[var(--danger)]">
                {showNameError}
              </p>
            )}
          </div>

          <div className="px-4 py-4 sm:px-5 sm:py-5" id="tail-image-assets">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-[var(--ink)]">通用图片顺序</h3>
                <p className="mt-1 text-xs text-[var(--text-subtle)]">
                  满足 1340×1785 或 900–2200px 的 1:1 图片直接上传
                </p>
              </div>
              <div>
                <input
                  accept=".jpg,.jpeg,.png,image/jpeg,image/png"
                  className="sr-only"
                  disabled={busy}
                  multiple
                  onChange={(event) => void uploadFiles(event)}
                  ref={fileInputRef}
                  type="file"
                />
                <Button
                  disabled={busy}
                  onClick={() => fileInputRef.current?.click()}
                  variant="outline"
                >
                  {uploading
                    ? <LoaderCircle className="animate-spin" size={16} />
                    : <Upload size={16} />}
                  {uploading ? "正在上传" : "连续上传"}
                </Button>
              </div>
            </div>

            {showAssetsError && (
              <p className="mt-3 text-xs font-medium text-[var(--danger)]">
                {showAssetsError}
              </p>
            )}

            {assets.length ? (
              <>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                  {assets.map((asset, index) => (
                    <article
                      aria-grabbed={draggedId === asset.id}
                      className={`overflow-hidden rounded-lg border bg-white ${
                        draggedId === asset.id
                          ? "border-[var(--focus)] opacity-70"
                          : "border-[var(--line)]"
                      }`}
                      draggable={!busy}
                      key={asset.id}
                      onDragEnd={() => setDraggedId("")}
                      onDragOver={(event) => event.preventDefault()}
                      onDragStart={(event) => {
                        setDraggedId(asset.id);
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", asset.id);
                      }}
                      onDrop={(event) => onDrop(event, asset.id)}
                    >
                      <div className="relative aspect-[4/3] bg-[var(--surface-muted)]">
                        {asset.previewUrl ? (
                          <img
                            alt={asset.originalName}
                            className="size-full object-contain"
                            src={asset.previewUrl}
                          />
                        ) : (
                          <div className="grid size-full place-items-center text-[var(--text-subtle)]">
                            <LoaderCircle className="animate-spin" size={20} />
                          </div>
                        )}
                        <span className="absolute left-2 top-2 grid size-6 place-items-center rounded-sm bg-black/75 text-xs font-semibold text-white">
                          {index + 1}
                        </span>
                        <span className="absolute right-2 top-2 grid size-7 place-items-center rounded-sm bg-white/90 text-[var(--text-muted)] shadow-sm">
                          <GripVertical size={15} />
                        </span>
                      </div>
                      <div className="px-3 py-3">
                        <p className="truncate text-sm font-medium text-[var(--ink)]">
                          {asset.originalName}
                        </p>
                        <p className="mt-1 text-xs text-[var(--text-subtle)]">
                          {asset.width && asset.height
                            ? `${asset.width}×${asset.height}`
                            : "尺寸待读取"}
                          {" · "}
                          {asset.crop.mode === "cropped" ? "已裁剪" : "原图直传"}
                        </p>
                        <div className="mt-3 flex items-center justify-between gap-2">
                          <div className="flex gap-1">
                            <Button
                              aria-label={`前移${asset.originalName}`}
                              disabled={busy || index === 0}
                              onClick={() => moveAsset(asset.id, "previous")}
                              size="icon"
                              title="向前移动"
                              variant="ghost"
                            >
                              <ChevronLeft size={16} />
                            </Button>
                            <Button
                              aria-label={`后移${asset.originalName}`}
                              disabled={busy || index === assets.length - 1}
                              onClick={() => moveAsset(asset.id, "next")}
                              size="icon"
                              title="向后移动"
                              variant="ghost"
                            >
                              <ChevronRight size={16} />
                            </Button>
                          </div>
                          <Button
                            aria-label={`移除${asset.originalName}`}
                            disabled={busy}
                            onClick={() => removeAsset(asset.id)}
                            size="icon"
                            title="从模板移除"
                            variant="ghost"
                          >
                            <Trash2 size={16} />
                          </Button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
                <p className="mt-3 text-xs text-[var(--text-subtle)]">
                  桌面端可拖拽排序；移动端使用每张图片下方的前后箭头。
                </p>
              </>
            ) : (
              <div className="empty-panel mt-4 min-h-64">
                <span className="empty-icon"><Images size={21} /></span>
                <h3>还没有通用商品图片</h3>
                <p>支持一次选择多张 JPG、JPEG 或 PNG 图片。</p>
              </div>
            )}
          </div>

          <footer className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--line)] bg-white/95 shadow-[0_-8px_20px_rgba(15,23,42,0.08)] backdrop-blur lg:left-[236px]">
            <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5 lg:px-6">
              <div className="min-w-0">
                <p className="text-xs font-medium text-[var(--ink)]">
                  已编排 {assets.length} 张
                  {cropQueue.length ? ` · ${cropQueue.length} 张等待裁剪` : " · 只追加到末尾"}
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
                      正在保存通用商品图片模板
                    </>
                  ) : feedback ? (
                    <>
                      {feedback.tone === "success"
                        ? <Check size={13} />
                        : <AlertCircle size={13} />}
                      <span className="truncate">{feedback.message}</span>
                    </>
                  ) : (
                    "模板 JSON 只保存媒体引用、顺序和裁剪元数据"
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
                  : editingId ? "更新通用商品图片" : "统一保存通用商品图片"}
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

      <CropDialog
        item={cropQueue[0] || null}
        onCancel={cancelCrop}
        onSave={saveCroppedImage}
      />
    </>
  );
}
