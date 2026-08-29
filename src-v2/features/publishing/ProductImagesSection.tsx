import { useEffect, useRef, useState, type ChangeEvent } from "react";
import Cropper, { type Area } from "react-easy-crop";
import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  ImagePlus,
  Images,
  LoaderCircle,
  Trash2,
  Upload,
  X,
  ZoomIn,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import {
  api,
  type MediaAsset,
  type TailImageTemplate,
} from "../../lib/api";
import {
  orderedTailTemplateImages,
  type ProductImageAssetInput,
} from "../../lib/product-image-contract.js";
import { validatePublishImage } from "../../../src/lib/publish-image-rules.js";
import {
  applyWatermarkToFile,
  DEFAULT_WATERMARK_OPTIONS,
  normalizeWatermarkOptions,
} from "../../lib/product-image-watermark.js";
import { compressProductImage } from "../../lib/product-image-compress.js";
import { cropImageFile } from "../../../src/lib/main-image-crop.js";

export interface DraftProductImage extends MediaAsset {
  previewUrl?: string;
  sourceFile?: File;
  originalFile?: File;
  recognizedText?: string;
}

interface ImageStage {
  valid: boolean;
  scheme: "new-spu" | "legacy-skc";
  uploads: Array<{ localId: string }>;
  blockers: Array<{ code: string; message: string }>;
  counts: {
    main: number;
    productDetail: number;
    tail: number;
    detailTotal: number;
    siteDetail: number;
  };
  rules: {
    detailAllowed: boolean;
    detailRequired: boolean;
    siteDetailRuleReturned: boolean;
    siteDetailAllowed: boolean;
    siteDetailRequired: boolean;
    siteDetailFieldKey: string;
  };
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
    if (!context) throw new Error("当前浏览器不支持图片裁剪");
    context.drawImage(
      image,
      (image.naturalWidth - side) / 2,
      (image.naturalHeight - side) / 2,
      side,
      side,
      0,
      0,
      1200,
      1200,
    );
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => value ? resolve(value) : reject(new Error("方块图生成失败")), "image/jpeg", 0.92);
    });
    return new File([blob], `${file.name.replace(/\.[^.]+$/, "")}-square.jpg`, {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

const WATERMARK_STORAGE_KEY = "shein-product-watermark-options-v1";

function loadSavedWatermarkOptions() {
  if (typeof window === "undefined") return DEFAULT_WATERMARK_OPTIONS;
  try {
    const raw = window.localStorage.getItem(WATERMARK_STORAGE_KEY);
    return raw
      ? normalizeWatermarkOptions(JSON.parse(raw))
      : DEFAULT_WATERMARK_OPTIONS;
  } catch {
    return DEFAULT_WATERMARK_OPTIONS;
  }
}

function formatBytes(value: number) {
  return value < 1024 * 1024
    ? `${Math.max(1, Math.round(value / 1024))} KB`
    : `${(value / 1024 / 1024).toFixed(2)} MB`;
}

function ImageThumbnail({
  asset,
  label,
  onRemove,
  onRestore,
  movePrevious,
  moveNext,
  onZoom,
  disabled,
}: {
  asset: DraftProductImage;
  label: string;
  onRemove: () => void;
  onRestore?: () => void;
  movePrevious?: () => void;
  moveNext?: () => void;
  onZoom?: () => void;
  disabled: boolean;
}) {
  return (
    <article className="product-image-card min-w-0 border border-[var(--line)] bg-white">
      <div className="relative aspect-square overflow-hidden bg-[var(--surface-muted)]">
        {asset.previewUrl ? (
          <img
            alt={label}
            className="h-full w-full object-contain"
            decoding="async"
            loading="lazy"
            src={asset.previewUrl}
          />
        ) : (
          <div className="grid h-full place-items-center text-[var(--text-subtle)]">
            <Images size={22} />
          </div>
        )}
        {asset.previewUrl && onZoom && (
          <Button
            aria-label={`放大查看${label}`}
            className="absolute bottom-1 left-1 rounded-full bg-slate-950/70 text-white shadow-sm hover:bg-slate-950"
            onClick={onZoom}
            size="icon"
            type="button"
            variant="ghost"
          >
            <ZoomIn size={14} />
          </Button>
        )}
        <Button
          aria-label={`删除${label}`}
          className="absolute right-1 top-1 rounded-full bg-red-600/90 text-white shadow-sm hover:bg-red-700"
          disabled={disabled}
          onClick={onRemove}
          size="icon"
          variant="ghost"
        >
          <Trash2 size={14} />
        </Button>
      </div>
      <div className="border-t border-[var(--line)] p-2">
        <p className="truncate text-xs font-medium text-[var(--ink)]" title={asset.originalName}>
          {asset.originalName}
        </p>
        <p className="mt-1 truncate text-[11px] text-[var(--text-subtle)]">
          {asset.width}×{asset.height} · {formatBytes(asset.sizeBytes)}
        </p>
        <div className="mt-2 flex items-center justify-end gap-1">
          {movePrevious && (
            <Button aria-label={`${label}前移`} disabled={disabled} onClick={movePrevious} size="icon" variant="ghost">
              <ChevronLeft size={15} />
            </Button>
          )}
          {moveNext && (
            <Button aria-label={`${label}后移`} disabled={disabled} onClick={moveNext} size="icon" variant="ghost">
              <ChevronRight size={15} />
            </Button>
          )}
          {onRestore && (
            <Button aria-label={`恢复${label}原图`} disabled={disabled} onClick={onRestore} size="sm" variant="ghost">
              恢复原图
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function imagePointFromPointer(target: HTMLElement, clientX: number, clientY: number) {
  const image = target.querySelector("img");
  const rect = (image || target).getBoundingClientRect();
  return {
    x: clamp(((clientX - rect.left) / rect.width) * 100, 0, 100),
    y: clamp(((clientY - rect.top) / rect.height) * 100, 0, 100),
  };
}

async function loadAssetFile(asset: DraftProductImage) {
  if (asset.sourceFile) return asset.sourceFile;
  if (!asset.previewUrl) throw new Error("当前图片没有可读取的预览地址，请重新上传");
  const response = await fetch(asset.previewUrl);
  if (!response.ok) throw new Error("无法读取当前主图，请重新上传");
  const blob = await response.blob();
  return new File([blob], asset.originalName || "product-image.jpg", {
    type: blob.type || asset.contentType || "image/jpeg",
  });
}

function ImageReferenceDialog({
  open,
  title,
  assets,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  assets: DraftProductImage[];
  onClose: () => void;
  onConfirm: (asset: DraftProductImage) => void;
}) {
  const [draftAssetId, setDraftAssetId] = useState("");
  const [hoverAssetId, setHoverAssetId] = useState("");
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    if (!open) return;
    setDraftAssetId(assets[0]?.id || "");
    setHoverAssetId("");
    setZoom(1);
  }, [assets, open]);

  if (!open) return null;
  const previewAsset = assets.find((asset) => asset.id === (hoverAssetId || draftAssetId)) || assets[0] || null;

  return (
    <div aria-label={title} aria-modal="true" className="fixed inset-0 z-[125] grid place-items-center bg-slate-950/70 p-3 sm:p-5" role="dialog">
      <section className="sku-preview-dialog">
        <header className="flex items-start gap-3 border-b border-[var(--line)] bg-white px-4 py-3 sm:px-5">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-[var(--text-subtle)]">图片引用</p>
            <h2 className="mt-1 text-base font-semibold text-[var(--ink)]">{title}</h2>
            <p className="mt-1 text-xs text-[var(--text-muted)]">悬停缩略图查看大图，选中后可继续自由裁剪。</p>
          </div>
          <button aria-label={`关闭${title}`} className="rounded-md p-2 text-[var(--text-subtle)] hover:bg-[var(--surface-muted)]" onClick={onClose} type="button"><X size={18} /></button>
        </header>
        <div className="sku-preview-dialog-body">
          <div
            className="sku-preview-dialog-canvas"
            onWheel={(event) => {
              event.preventDefault();
              setZoom((current) => Math.min(4, Math.max(1, current + (event.deltaY < 0 ? 0.1 : -0.1))));
            }}
          >
            {previewAsset?.previewUrl ? <img alt={`${title}大图`} src={previewAsset.previewUrl} style={{ transform: `scale(${zoom})` }} /> : <div className="grid place-items-center text-sm text-slate-300">暂无可引用图片</div>}
          </div>
          <aside className="sku-preview-dialog-options">
            <div className="border-b border-[var(--line)] px-3 py-2 text-xs font-medium text-[var(--text-muted)]">商品主图 · {assets.length}</div>
            {assets.map((asset, index) => (
              <button
                aria-selected={asset.id === draftAssetId}
                className="sku-preview-dialog-option"
                key={asset.id}
                onClick={() => { setDraftAssetId(asset.id); setHoverAssetId(""); setZoom(1); }}
                onMouseEnter={() => setHoverAssetId(asset.id)}
                onMouseLeave={() => setHoverAssetId("")}
                role="option"
                type="button"
              >
                <span className="sku-preview-dialog-option-thumb">{asset.previewUrl ? <img alt="" src={asset.previewUrl} /> : <Images size={18} />}</span>
                <span className="min-w-0 text-left"><strong className="block text-xs font-medium">商品主图 {index + 1}</strong><small className="block truncate text-[11px] text-[var(--text-subtle)]">{asset.originalName || "未命名图片"}</small></span>
              </button>
            ))}
          </aside>
        </div>
        <footer className="flex items-center justify-between gap-3 border-t border-[var(--line)] bg-white px-4 py-3 sm:px-5">
          <span className="text-xs text-[var(--text-subtle)]">滚轮缩放 · 拖动在下一步裁剪</span>
          <div className="flex gap-2"><Button onClick={onClose} size="sm" variant="outline">取消</Button><Button disabled={!draftAssetId} onClick={() => { const asset = assets.find((item) => item.id === draftAssetId); if (asset) onConfirm(asset); }} size="sm">继续裁剪</Button></div>
        </footer>
      </section>
    </div>
  );
}

function SquareImageCropDialog({
  source,
  busy,
  onClose,
  onConfirm,
}: {
  source: DraftProductImage | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (file: File) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState("");
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [cropPixels, setCropPixels] = useState<Area | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!source) return;
    let cancelled = false;
    let ownedUrl = "";
    setFile(null);
    setImageUrl("");
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCropPixels(null);
    setError("");
    void loadAssetFile(source).then((nextFile) => {
      if (cancelled) return;
      const nextUrl = source.previewUrl || URL.createObjectURL(nextFile);
      if (!source.previewUrl) ownedUrl = nextUrl;
      setFile(nextFile);
      setImageUrl(nextUrl);
    }).catch((caught) => {
      if (!cancelled) setError(caught instanceof Error ? caught.message : "无法读取主图");
    });
    return () => {
      cancelled = true;
      if (ownedUrl) URL.revokeObjectURL(ownedUrl);
    };
  }, [source]);

  if (!source) return null;
  return (
    <div aria-label="方块图裁剪" aria-modal="true" className="fixed inset-0 z-[130] grid place-items-center bg-slate-950/70 p-3 sm:p-5" role="dialog">
      <section className="w-full max-w-3xl overflow-hidden border border-[var(--line)] bg-white shadow-2xl">
        <header className="flex items-start gap-3 border-b border-[var(--line)] px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-[var(--text-subtle)]">SKC 方块图 · image_type=5</p>
            <h2 className="mt-1 text-base font-semibold text-[var(--ink)]">自由裁剪主图为1200×1200</h2>
            <p className="mt-1 text-xs text-[var(--text-muted)]">拖动图片调整取景，滑动缩放后确认；确认后会立即生成并显示方块图。</p>
          </div>
          <button aria-label="关闭方块图裁剪" className="rounded p-2 text-[var(--text-subtle)] hover:bg-[var(--surface-muted)]" onClick={onClose} type="button"><X size={18} /></button>
        </header>
        <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_190px]">
          <div
            className="relative h-[min(58vh,440px)] overflow-hidden bg-slate-950"
            onWheel={(event) => {
              event.preventDefault();
              setZoom((current) => clamp(current + (event.deltaY < 0 ? 0.08 : -0.08), 1, 3));
            }}
          >
            {imageUrl ? <Cropper aspect={1} crop={crop} image={imageUrl} onCropChange={setCrop} onCropComplete={(_, pixels) => setCropPixels(pixels)} onZoomChange={setZoom} showGrid zoom={zoom} /> : <div className="grid h-full place-items-center text-xs text-white/70">正在读取主图…</div>}
          </div>
          <div className="space-y-3 text-xs text-[var(--text-muted)]">
            <p className="truncate font-medium text-[var(--ink)]" title={source.originalName}>{source.originalName || "商品主图"}</p>
            <p>滚轮缩放，拖动图片调整位置</p>
            <label className="block">缩放 {zoom.toFixed(2)}<input aria-label="方块图裁剪缩放" className="mt-2 w-full" max="3" min="1" onChange={(event) => setZoom(Number(event.target.value))} step="0.01" type="range" value={zoom} /></label>
            {error && <p className="text-[var(--danger)]">{error}</p>}
            <div className="flex gap-2">
              <Button onClick={onClose} size="sm" variant="outline">取消</Button>
              <Button disabled={busy || !file || !imageUrl || !cropPixels} onClick={() => { if (file && imageUrl && cropPixels) void cropImageFile({ file, imageUrl, cropPixels, presetId: "square" }).then(onConfirm).catch((caught) => setError(caught instanceof Error ? caught.message : "方块图生成失败")); }} size="sm">{busy ? "正在上传…" : "确认生成"}</Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

async function createSwatchFile(file: File, point: { x: number; y: number }) {
  const bitmap = typeof createImageBitmap === "function"
    ? await createImageBitmap(file).catch(() => null)
    : null;
  const bitmapSource = bitmap || await new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("无法读取主图")); };
    image.src = url;
  });
  const width = "naturalWidth" in bitmapSource ? bitmapSource.naturalWidth : bitmapSource.width;
  const height = "naturalHeight" in bitmapSource ? bitmapSource.naturalHeight : bitmapSource.height;
  const side = Math.max(120, Math.min(width, height) * 0.32);
  const left = clamp((point.x / 100) * width - side / 2, 0, width - side);
  const top = clamp((point.y / 100) * height - side / 2, 0, height - side);
  const canvas = document.createElement("canvas");
  canvas.width = 600;
  canvas.height = 600;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器不支持色块图生成");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmapSource as CanvasImageSource, left, top, side, side, 0, 0, 600, 600);
  bitmap?.close?.();
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("色块图生成失败")), "image/jpeg", 0.92));
  return new File([blob], `${file.name.replace(/\.[^.]+$/, "")}-swatch.jpg`, { type: "image/jpeg", lastModified: Date.now() });
}

function SwatchImagePickerDialog({
  source,
  busy,
  onClose,
  onConfirm,
}: {
  source: DraftProductImage | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (file: File) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState("");
  const [point, setPoint] = useState({ x: 50, y: 50 });
  const [error, setError] = useState("");
  const [retryToken, setRetryToken] = useState(0);
  useEffect(() => {
    if (!source) return;
    let cancelled = false;
    let ownedUrl = "";
    setFile(null); setImageUrl(""); setPoint({ x: 50, y: 50 }); setError("");
    void loadAssetFile(source).then((nextFile) => {
      if (cancelled) return;
      const nextUrl = source.previewUrl || URL.createObjectURL(nextFile);
      if (!source.previewUrl) ownedUrl = nextUrl;
      setFile(nextFile); setImageUrl(nextUrl);
    }).catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : "无法读取主图"); });
    return () => { cancelled = true; if (ownedUrl) URL.revokeObjectURL(ownedUrl); };
  }, [source, retryToken]);
  if (!source) return null;
  return (
    <div aria-label="色块图取色" aria-modal="true" className="fixed inset-0 z-[130] grid place-items-center bg-slate-950/70 p-3 sm:p-5" role="dialog">
      <section className="w-full max-w-3xl overflow-hidden border border-[var(--line)] bg-white shadow-2xl">
        <header className="flex items-start gap-3 border-b border-[var(--line)] px-4 py-3">
          <div className="min-w-0 flex-1"><p className="text-xs text-[var(--text-subtle)]">SKC 色块图 · image_type=6</p><h2 className="mt-1 text-base font-semibold text-[var(--ink)]">点击主图选择色块区域</h2><p className="mt-1 text-xs text-[var(--text-muted)]">小圆点所在区域会裁成600×600色块图；上传后会按 SHEIN 的 SKC 色块图字段提交。</p></div>
          <button aria-label="关闭色块图取色" className="rounded p-2 text-[var(--text-subtle)] hover:bg-[var(--surface-muted)]" onClick={onClose} type="button"><X size={18} /></button>
        </header>
        <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_180px]">
          <button aria-label="在主图中选择色块位置" className="relative block max-h-[58vh] overflow-hidden bg-slate-950" onClick={(event) => setPoint(imagePointFromPointer(event.currentTarget, event.clientX, event.clientY))} onMouseMove={(event) => setPoint(imagePointFromPointer(event.currentTarget, event.clientX, event.clientY))} onPointerMove={(event) => setPoint(imagePointFromPointer(event.currentTarget, event.clientX, event.clientY))} type="button">
            {imageUrl ? <img alt="选择色块的商品主图" className="max-h-[58vh] w-full object-contain" src={imageUrl} /> : <span className="grid h-80 place-items-center text-xs text-white/70">正在读取主图…</span>}
            <span className="pointer-events-none absolute h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-white/20 shadow-[0_0_0_2px_rgba(15,23,42,.75)]" style={{ left: `${point.x}%`, top: `${point.y}%` }} />
          </button>
          <div className="space-y-3 text-xs text-[var(--text-muted)]"><p className="truncate font-medium text-[var(--ink)]">{source.originalName || "商品主图"}</p><p className="leading-5">移动鼠标预览取色位置，点击主图后再确认上传。</p>{error && <div className="space-y-2 text-[var(--danger)]"><p>主图读取失败：{error}</p><Button onClick={() => setRetryToken((current) => current + 1)} size="sm" variant="outline">重试读取主图</Button></div>}<div className="flex gap-2"><Button onClick={onClose} size="sm" variant="outline">取消</Button><Button disabled={busy || !file || !imageUrl} onClick={() => { if (file) void createSwatchFile(file, point).then(onConfirm).catch((caught) => setError(caught instanceof Error ? caught.message : "色块图生成失败")); }} size="sm">{busy ? "正在上传…" : "确认取色并上传"}</Button></div></div>
        </div>
      </section>
    </div>
  );
}

export function ProductImagesSection({
  storeId,
  templates,
  mainImages,
  detailImages,
  squareImages,
  swatchImages,
  tailImageTemplateId,
  imageStage,
  busy,
  saveAttempted,
  onMainImagesChange,
  onDetailImagesChange,
  onSquareImagesChange,
  onSwatchImagesChange,
  onTailTemplateChange,
  onUploadingChange,
}: {
  storeId: string;
  templates: TailImageTemplate[];
  mainImages: DraftProductImage[];
  detailImages: DraftProductImage[];
  squareImages: DraftProductImage[];
  swatchImages: DraftProductImage[];
  tailImageTemplateId: string;
  imageStage: ImageStage;
  busy: boolean;
  saveAttempted: boolean;
  onMainImagesChange: (images: DraftProductImage[]) => void;
  onDetailImagesChange: (images: DraftProductImage[]) => void;
  onSquareImagesChange: (images: DraftProductImage[]) => void;
  onSwatchImagesChange: (images: DraftProductImage[]) => void;
  onTailTemplateChange: (templateId: string) => void;
  onUploadingChange: (uploading: boolean) => void;
}) {
  const mainInputRef = useRef<HTMLInputElement>(null);
  const detailInputRef = useRef<HTMLInputElement>(null);
  const blobUrlsRef = useRef(new Set<string>());
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{
    completed: number;
    total: number;
    phase: string;
  } | null>(null);
  const [watermarkOptions, setWatermarkOptions] = useState(loadSavedWatermarkOptions);
  const [squareSourcePickerOpen, setSquareSourcePickerOpen] = useState(false);
  const [squareCropSource, setSquareCropSource] = useState<DraftProductImage | null>(null);
  const [swatchPickerSource, setSwatchPickerSource] = useState<DraftProductImage | null>(null);
  const [tailPreviewUrls, setTailPreviewUrls] = useState<Record<string, string>>({});
  const [zoomAsset, setZoomAsset] = useState<DraftProductImage | null>(null);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "danger";
    message: string;
  } | null>(null);
  const selectedTemplate = templates.find(
    (template) => template.id === tailImageTemplateId,
  ) || null;
  const tailAssets = orderedTailTemplateImages(selectedTemplate) as ProductImageAssetInput[];

  useEffect(() => () => {
    blobUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    blobUrlsRef.current.clear();
  }, []);

  useEffect(() => {
    blobUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    blobUrlsRef.current.clear();
  }, [storeId]);

  useEffect(() => {
    setTailPreviewUrls({});
    if (!selectedTemplate || !tailAssets.length) return;
    setTailPreviewUrls(Object.fromEntries(tailAssets.map((asset) => {
      const assetId = String(asset.id || asset.assetId || "");
      return [assetId, api.tailImagePreviewUrl(storeId, selectedTemplate.id, assetId)];
    })));
  }, [selectedTemplate, storeId]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        WATERMARK_STORAGE_KEY,
        JSON.stringify(normalizeWatermarkOptions(watermarkOptions)),
      );
    } catch {
      // Private browsing or a restricted storage policy should not block uploads.
    }
  }, [watermarkOptions]);

  const revokePreview = (asset: DraftProductImage) => {
    if (!asset.previewUrl?.startsWith("blob:")) return;
    URL.revokeObjectURL(asset.previewUrl);
    blobUrlsRef.current.delete(asset.previewUrl);
  };

  const uploadFiles = async (
    event: ChangeEvent<HTMLInputElement>,
    type: "main" | "detail",
  ) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) return;
    setUploading(true);
    onUploadingChange(true);
    setUploadProgress({ completed: 0, total: files.length, phase: "压缩并上传图片" });
    setFeedback(null);
    try {
      if (type === "detail" && detailImages.length + files.length > 10) {
        throw new Error("商品通用轮播图最多上传10张");
      }
      let completed = 0;
      let compressedCount = 0;
      const outcomes = await Promise.allSettled(files.map(async (sourceFile) => {
        try {
          const preparedFile = prepareImageFile(sourceFile);
          const watermarkActive = type === "main" && watermarkOptions.text;
          const watermarkedFile = watermarkActive
            ? await applyWatermarkToFile(preparedFile, watermarkOptions)
            : preparedFile;
          const compressed = await compressProductImage(watermarkedFile);
          if (compressed.compressed) compressedCount += 1;
          const file = compressed.file;
          if (!["image/jpeg", "image/png"].includes(file.type)) {
            throw new Error(`${file.name}：仅支持 JPG、JPEG、PNG`);
          }
          const dimensions = await readImageDimensions(file);
          const issues = validatePublishImage(file, type, dimensions.width, dimensions.height);
          if (issues.length) throw new Error(`${file.name}：${issues.join("；")}`);
          const result = await api.uploadProductImage(storeId, file, dimensions);
          const previewUrl = URL.createObjectURL(file);
          blobUrlsRef.current.add(previewUrl);
          return {
            ...result.asset,
            previewUrl,
            sourceFile: file,
            originalFile: watermarkActive ? preparedFile : undefined,
          };
        } finally {
          completed += 1;
          setUploadProgress({ completed, total: files.length, phase: "压缩并上传图片" });
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
        throw new Error(failures.join("；") || "商品图片上传失败");
      }
      if (type === "main") {
        onMainImagesChange([...mainImages, ...uploaded]);
      } else if (type === "detail") {
        onDetailImagesChange([...detailImages, ...uploaded]);
      }
      let squareCreated = false;
      if (type === "main" && !squareImages.length && uploaded[0]?.sourceFile) {
        const squareFile = await centerCropSquare(uploaded[0].sourceFile);
        const compressedSquare = await compressProductImage(squareFile);
        const squareDimensions = await readImageDimensions(compressedSquare.file);
        const squareIssues = validatePublishImage(
          compressedSquare.file,
          "square",
          squareDimensions.width,
          squareDimensions.height,
        );
        if (squareIssues.length) throw new Error(`方块图：${squareIssues.join("；")}`);
        const squareResult = await api.uploadProductImage(storeId, compressedSquare.file, squareDimensions);
        const squarePreviewUrl = URL.createObjectURL(compressedSquare.file);
        blobUrlsRef.current.add(squarePreviewUrl);
        onSquareImagesChange([{
          ...squareResult.asset,
          previewUrl: squarePreviewUrl,
          sourceFile: compressedSquare.file,
        }]);
        squareCreated = true;
      }
      const successMessage = type === "main"
        ? `已上传 ${uploaded.length} 张商品主图，发布时按当前顺序提交`
        : `已上传 ${uploaded.length} 张商品通用轮播图`;
      if (completed === files.length) {
        setUploadProgress({ completed, total: files.length, phase: "上传完成" });
      }
      setFeedback({
        tone: failures.length ? "danger" : "success",
        message: failures.length
          ? `${successMessage}；失败 ${failures.length} 张：${failures.join("；")}`
          : `${successMessage}${squareCreated ? "；已从第一张主图自动居中裁剪并生成1张方块图" : ""}${compressedCount ? `；已自动压缩 ${compressedCount} 张超过3MB的图片` : ""}`,
      });
    } catch (error) {
      setFeedback({
        tone: "danger",
        message: error instanceof Error ? error.message : "商品图片上传失败",
      });
    } finally {
      setUploading(false);
      onUploadingChange(false);
    }
  };

  const applyWatermarkToExisting = async () => {
    const options = normalizeWatermarkOptions(watermarkOptions);
    if (!options.text) {
      setFeedback({ tone: "danger", message: "请先填写英文水印内容" });
      return;
    }
    if (!mainImages.length) {
      setFeedback({ tone: "danger", message: "请先上传商品主图" });
      return;
    }
    setUploading(true);
    onUploadingChange(true);
    setFeedback(null);
    try {
      const outcomes = await Promise.allSettled(mainImages.map(async (asset) => {
        let sourceFile = asset.originalFile || asset.sourceFile;
        if (!sourceFile && asset.previewUrl) {
          const response = await fetch(asset.previewUrl);
          if (!response.ok) throw new Error("无法读取现有主图，请重新上传后再加水印");
          const blob = await response.blob();
          sourceFile = new File([blob], asset.originalName || "main-image.jpg", {
            type: blob.type || "image/jpeg",
          });
        }
        if (!sourceFile) throw new Error("当前主图没有可处理的本地文件，请重新上传");
        const compressed = await compressProductImage(
          await applyWatermarkToFile(sourceFile, options),
        );
        const file = compressed.file;
        const dimensions = await readImageDimensions(file);
        const issues = validatePublishImage(file, "main", dimensions.width, dimensions.height);
        if (issues.length) throw new Error(issues.join("；"));
        const result = await api.uploadProductImage(storeId, file, dimensions);
        const previewUrl = URL.createObjectURL(file);
        blobUrlsRef.current.add(previewUrl);
        return { ...result.asset, previewUrl, sourceFile: file, originalFile: sourceFile };
      }));
      const nextImages = mainImages.map((asset, index) => (
        outcomes[index]?.status === "fulfilled" ? outcomes[index].value : asset
      ));
      const failures = outcomes.flatMap((result, index) => result.status === "rejected"
        ? [`${mainImages[index]?.originalName || `第${index + 1}张`}：${result.reason instanceof Error ? result.reason.message : "水印处理失败"}`]
        : []);
      onMainImagesChange(nextImages);
      setFeedback({
        tone: failures.length ? "danger" : "success",
        message: failures.length
          ? `已替换 ${mainImages.length - failures.length} 张主图；失败 ${failures.length} 张：${failures.join("；")}`
          : `已为 ${mainImages.length} 张主图应用水印并替换当前主图`,
      });
    } catch (error) {
      setFeedback({ tone: "danger", message: error instanceof Error ? error.message : "主图水印处理失败" });
    } finally {
      setUploading(false);
      onUploadingChange(false);
    }
  };

  const restoreOriginal = async (asset: DraftProductImage) => {
    if (!asset.originalFile) return;
    setUploading(true);
    onUploadingChange(true);
    setFeedback(null);
    try {
      const file = (await compressProductImage(prepareImageFile(asset.originalFile))).file;
      const dimensions = await readImageDimensions(file);
      const issues = validatePublishImage(file, "main", dimensions.width, dimensions.height);
      if (issues.length) throw new Error(issues.join("；"));
      const result = await api.uploadProductImage(storeId, file, dimensions);
      const previewUrl = URL.createObjectURL(file);
      blobUrlsRef.current.add(previewUrl);
      onMainImagesChange(mainImages.map((item) => item.id === asset.id
        ? { ...result.asset, previewUrl, sourceFile: file }
        : item));
      setFeedback({ tone: "success", message: `已恢复“${asset.originalName}”的原图` });
    } catch (error) {
      setFeedback({ tone: "danger", message: error instanceof Error ? error.message : "恢复原图失败" });
    } finally {
      setUploading(false);
      onUploadingChange(false);
    }
  };

  const removeMain = (asset: DraftProductImage) => {
    revokePreview(asset);
    onMainImagesChange(mainImages.filter((item) => item.id !== asset.id));
    setFeedback(null);
  };

  const moveMain = (index: number, offset: -1 | 1) => {
    const nextIndex = index + offset;
    if (nextIndex < 0 || nextIndex >= mainImages.length) return;
    const next = [...mainImages];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    onMainImagesChange(next);
    setFeedback(null);
  };

  const removeDetail = (asset: DraftProductImage) => {
    revokePreview(asset);
    onDetailImagesChange(detailImages.filter((item) => item.id !== asset.id));
    setFeedback(null);
  };

  const generateSquareImage = async (source = mainImages[0]) => {
    if (!source) {
      setFeedback({ tone: "danger", message: "请先上传商品主图" });
      return;
    }
    setFeedback(null);
    setSquareSourcePickerOpen(true);
  };

  const uploadSquareCrop = async (squareFile: File) => {
    setUploading(true);
    onUploadingChange(true);
    setFeedback(null);
    try {
      const compressed = await compressProductImage(squareFile);
      const dimensions = await readImageDimensions(compressed.file);
      const issues = validatePublishImage(compressed.file, "square", dimensions.width, dimensions.height);
      if (issues.length) throw new Error(issues.join("；"));
      const result = await api.uploadProductImage(storeId, compressed.file, dimensions);
      const previewUrl = URL.createObjectURL(compressed.file);
      blobUrlsRef.current.add(previewUrl);
      onSquareImagesChange([{ ...result.asset, previewUrl, sourceFile: compressed.file }]);
      setSquareCropSource(null);
      setFeedback({ tone: "success", message: "方块图已按裁剪区域生成并替换，下面已显示最新缩略图" });
    } catch (error) {
      setFeedback({ tone: "danger", message: error instanceof Error ? error.message : "方块图生成失败" });
    } finally {
      setUploading(false);
      onUploadingChange(false);
    }
  };

  const uploadSwatch = async (file: File) => {
    setUploading(true);
    onUploadingChange(true);
    setFeedback(null);
    try {
      const compressed = await compressProductImage(file);
      const dimensions = await readImageDimensions(compressed.file);
      const issues = validatePublishImage(compressed.file, "square", dimensions.width, dimensions.height);
      if (issues.length) throw new Error(issues.join("；"));
      const result = await api.uploadProductImage(storeId, compressed.file, dimensions);
      const previewUrl = URL.createObjectURL(compressed.file);
      blobUrlsRef.current.add(previewUrl);
      onSwatchImagesChange([{ ...result.asset, previewUrl, sourceFile: compressed.file }]);
      setSwatchPickerSource(null);
      setFeedback({ tone: "success", message: "色块图已生成并替换，下面已显示最新缩略图" });
    } catch (error) {
      setFeedback({ tone: "danger", message: error instanceof Error ? error.message : "色块图生成失败" });
    } finally {
      setUploading(false);
      onUploadingChange(false);
    }
  };

  const moveDetail = (index: number, offset: -1 | 1) => {
    const nextIndex = index + offset;
    if (nextIndex < 0 || nextIndex >= detailImages.length) return;
    const next = [...detailImages];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    onDetailImagesChange(next);
    setFeedback(null);
  };

  return (
    <section className="data-panel scroll-mt-20" id="draft-product-images">
      <header className="data-toolbar">
        <div>
          <h2>商品图片</h2>
          <p>
            {imageStage.scheme === "new-spu" ? "SPU图片方案" : "SKC图片方案"}
            {` · ${imageStage.uploads.length} 张待上传 SHEIN`}
          </p>
        </div>
        <ImagePlus className="text-[var(--text-subtle)]" size={18} />
      </header>

      {uploadProgress && (
        <div className="border-b border-[var(--line)] px-4 py-3 sm:px-5" role="status">
          <div className="mb-2 flex items-center justify-between text-xs text-[var(--text-muted)]">
            <span>{uploadProgress.phase}</span>
            <span>{uploadProgress.completed}/{uploadProgress.total}</span>
          </div>
          <div
            aria-valuemax={uploadProgress.total}
            aria-valuemin={0}
            aria-valuenow={uploadProgress.completed}
            className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-muted)]"
            role="progressbar"
          >
            <div
              className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-200"
              style={{ width: `${Math.round((uploadProgress.completed / Math.max(1, uploadProgress.total)) * 100)}%` }}
            />
          </div>
        </div>
      )}

      <div className="border-b border-[var(--line)] px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-[var(--ink)]">商品主图（可多张）</h3>
            <p className="mt-1 text-xs leading-5 text-[var(--text-subtle)]">
              至少1张；按缩略图顺序提交，支持手动前移/后移；JPG/PNG，不超过3MB
            </p>
          </div>
          <input
            accept="image/jpeg,image/png,.jpg,.jpeg,.png"
            className="hidden"
            multiple
            onChange={(event) => void uploadFiles(event, "main")}
            ref={mainInputRef}
            type="file"
          />
          <Button
            disabled={busy || uploading}
            onClick={() => mainInputRef.current?.click()}
            variant="outline"
          >
            {uploading ? <LoaderCircle className="animate-spin" size={16} /> : <Upload size={16} />}
            上传商品主图
          </Button>
        </div>
        <div className="main-image-watermark mt-3">
          <div>
            <p className="text-xs font-medium text-[var(--text-muted)]">主图满屏水印（可选）</p>
            <p className="mt-1 text-[11px] leading-5 text-[var(--text-subtle)]">
              只处理商品主图；新上传时自动应用，已有主图点击按钮后生成新图并替换当前草稿图片。
            </p>
          </div>
          <div className="mt-2 grid gap-2 md:grid-cols-[minmax(180px,1fr)_120px_150px_48px_auto] md:items-end">
            <label className="text-[11px] text-[var(--text-subtle)]">
              英文内容
              <input
                aria-label="水印英文内容"
                className="field mt-1 px-2"
                maxLength={40}
                onChange={(event) => setWatermarkOptions((current) => normalizeWatermarkOptions({ ...current, text: event.target.value }))}
                placeholder="例如 SHEIN RUG"
                value={watermarkOptions.text}
              />
            </label>
            <label className="text-[11px] text-[var(--text-subtle)]">
              大小 {watermarkOptions.fontSize}px
              <input
                aria-label="水印大小"
                className="mt-2 w-full"
                max="160"
                min="12"
                onChange={(event) => setWatermarkOptions((current) => normalizeWatermarkOptions({ ...current, fontSize: Number(event.target.value) }))}
                type="range"
                value={watermarkOptions.fontSize}
              />
            </label>
            <label className="text-[11px] text-[var(--text-subtle)]">
              深浅 {Math.round(watermarkOptions.opacity * 100)}%
              <input
                aria-label="水印深浅"
                className="mt-2 w-full"
                max="0.5"
                min="0.05"
                onChange={(event) => setWatermarkOptions((current) => normalizeWatermarkOptions({ ...current, opacity: Number(event.target.value) }))}
                step="0.01"
                type="range"
                value={watermarkOptions.opacity}
              />
            </label>
            <label className="text-[11px] text-[var(--text-subtle)]">
              颜色
              <input
                aria-label="水印颜色"
                className="mt-1 h-9 w-full cursor-pointer rounded border border-[var(--line)] bg-white p-1"
                onChange={(event) => setWatermarkOptions((current) => normalizeWatermarkOptions({ ...current, color: event.target.value }))}
                type="color"
                value={watermarkOptions.color}
              />
            </label>
            <Button
              disabled={busy || uploading || !mainImages.length || !watermarkOptions.text.trim()}
              onClick={() => void applyWatermarkToExisting()}
              variant="outline"
            >
              一键应用并替换主图
            </Button>
          </div>
        </div>
        {mainImages.length ? (
          <div className="main-image-grid mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {mainImages.map((asset, index) => (
              <ImageThumbnail
                asset={asset}
                disabled={busy || uploading}
                key={asset.id}
                label={`商品主图${index + 1}`}
                moveNext={index < mainImages.length - 1 ? () => moveMain(index, 1) : undefined}
                movePrevious={index > 0 ? () => moveMain(index, -1) : undefined}
                onRemove={() => removeMain(asset)}
                onRestore={asset.originalFile ? () => void restoreOriginal(asset) : undefined}
                onZoom={() => setZoomAsset(asset)}
              />
            ))}
            {tailAssets.map((asset, index) => {
              const assetId = String(asset.id || asset.assetId || "");
              return (
                <figure className="min-w-0 border border-dashed border-[var(--line-strong)] bg-[var(--surface-muted)]" key={`tail-main-${assetId}`}>
                  <div className="aspect-square overflow-hidden">
                    {tailPreviewUrls[assetId] ? <img alt={`通用轮播图${index + 1}`} className="h-full w-full object-contain" src={tailPreviewUrls[assetId]} /> : <div className="grid h-full place-items-center"><LoaderCircle className="animate-spin" size={17} /></div>}
                  </div>
                  <figcaption className="truncate px-2 py-2 text-[11px] text-[var(--text-subtle)]">主图后追加 · {index + 1}</figcaption>
                </figure>
              );
            })}
          </div>
        ) : (
          <div className="mt-4 grid min-h-28 place-items-center border border-dashed border-[var(--line-strong)] bg-[var(--surface-muted)] px-4 text-center text-xs text-[var(--text-subtle)]">
            尚未上传商品主图
          </div>
        )}
      </div>

      <div className="border-b border-[var(--line)] px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-[var(--ink)]">SKC 色块图（image_type=6）</h3>
            <p className="mt-1 text-xs leading-5 text-[var(--text-subtle)]">SHEIN 需要色块图时，从任意一张商品主图点击取样区域，生成1张 SKC 色块图；不需要时不提交。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <select aria-label="选择色块图主图" className="field h-9 w-48 px-2 text-xs" disabled={busy || uploading || !mainImages.length} onChange={(event) => { const source = mainImages.find((item) => item.id === event.target.value); if (source) setSwatchPickerSource(source); }} value="">
              <option value="">选择主图取色块</option>
              {mainImages.map((asset, index) => <option key={asset.id} value={asset.id}>商品主图 {index + 1} · {asset.originalName}</option>)}
            </select>
            <Button disabled={busy || uploading || !mainImages.length} onClick={() => setSwatchPickerSource(mainImages[0] || null)} variant="outline"><Images size={16} />从主图取色块</Button>
          </div>
        </div>
        {swatchImages.length ? <div className="mt-3 max-w-48"><ImageThumbnail asset={swatchImages[0]} disabled={busy || uploading} label="SKC色块图" onRemove={() => onSwatchImagesChange([])} /></div> : <p className="mt-3 rounded border border-dashed border-[var(--line-strong)] bg-[var(--surface-muted)] px-3 py-2 text-xs text-[var(--text-subtle)]">尚未生成色块图；只有当前类目规则要求时才需要生成。</p>}
      </div>

      <div className="border-b border-[var(--line)] px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-[var(--ink)]">SKC 方块图（image_type=5）</h3>
            <p className="mt-1 text-xs leading-5 text-[var(--text-subtle)]">
              每个 SKC 最多提交1张；默认从第一张商品主图居中裁剪为1200×1200。批量建品也采用同一规则，可在这里重新生成。
            </p>
          </div>
          <Button disabled={busy || uploading || !mainImages.length} onClick={() => void generateSquareImage()} variant="outline">
            <Images size={16} />选择主图并裁剪
          </Button>
        </div>
        {squareImages.length ? (
          <div className="mt-3 max-w-48">
            <ImageThumbnail
              asset={squareImages[0]}
              disabled={busy || uploading}
              label="SKC方块图"
              onRemove={() => onSquareImagesChange([])}
            />
          </div>
        ) : (
          <p className="mt-3 rounded border border-dashed border-[var(--warning)] bg-[var(--warning-soft)] px-3 py-2 text-xs text-[var(--warning-strong)]">
            尚未生成方块图；如果 SHEIN 返回“SKC有且只能有1张方块图”，点击上面的按钮即可生成。
          </p>
        )}
      </div>

      <div className="border-b border-[var(--line)] px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-[var(--ink)]">商品通用轮播图</h3>
          <p className="mt-1 text-xs leading-5 text-[var(--text-subtle)]">
            {imageStage.rules.detailAllowed
                ? `${imageStage.rules.detailRequired ? "当前方案至少需1张" : "当前方案可选"}；上传或引用后即时排在主图后，最多10张`
                : "当前图片方案不允许提交通用轮播图"}
            </p>
          </div>
          <input
            accept="image/jpeg,image/png,.jpg,.jpeg,.png"
            className="hidden"
            multiple
            onChange={(event) => void uploadFiles(event, "detail")}
            ref={detailInputRef}
            type="file"
          />
          <Button
            disabled={busy || uploading || !imageStage.rules.detailAllowed}
            onClick={() => detailInputRef.current?.click()}
            variant="outline"
          >
            <ImagePlus size={16} />
            上传商品通用轮播图
          </Button>
        </div>
        {detailImages.length > 0 && (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {detailImages.map((asset, index) => (
              <ImageThumbnail
                asset={asset}
                disabled={busy || uploading}
                key={asset.id}
                label={`细节图${index + 1}`}
                moveNext={index < detailImages.length - 1 ? () => moveDetail(index, 1) : undefined}
                movePrevious={index > 0 ? () => moveDetail(index, -1) : undefined}
                onRemove={() => removeDetail(asset)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="border-b border-[var(--line)] px-4 py-4 sm:px-5">
        <label className="block max-w-xl">
          <span className="text-xs font-medium text-[var(--text-muted)]">引用商品通用轮播图模板</span>
          <select
            className="field mt-2 px-3"
            disabled={busy || uploading}
            onChange={(event) => {
              onTailTemplateChange(event.target.value);
              setFeedback(null);
            }}
            value={tailImageTemplateId}
          >
            <option value="">不引用通用商品图片</option>
            {templates.map((template) => (
              <option
                disabled={!imageStage.rules.detailAllowed}
                key={template.id}
                value={template.id}
              >
                {template.name} · {template.data.assetIds?.length || 0} 张
              </option>
            ))}
          </select>
        </label>
        <p className="mt-2 text-xs leading-5 text-[var(--text-subtle)]">
            模板图片会立即追加到商品主图之后；不会覆盖已有图片。
        </p>
        {selectedTemplate && (
          <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-6">
            {tailAssets.map((asset, index) => {
              const assetId = String(asset.id || asset.assetId || "");
              return (
                <figure className="min-w-0" key={assetId}>
                  <div className="aspect-square overflow-hidden border border-[var(--line)] bg-[var(--surface-muted)]">
                    {tailPreviewUrls[assetId] ? (
                      <img
                        alt={`通用商品图片${index + 1}`}
                className="h-full w-full object-contain"
                        src={tailPreviewUrls[assetId]}
                      />
                    ) : (
                      <div className="grid h-full place-items-center text-[var(--text-subtle)]">
                        <LoaderCircle className="animate-spin" size={17} />
                      </div>
                    )}
                  </div>
                  <figcaption className="mt-1 truncate text-[11px] text-[var(--text-subtle)]">
                    {index + 1}. {String(asset.originalName || asset.name || "通用商品图片")}
                  </figcaption>
                </figure>
              );
            })}
          </div>
        )}
      </div>

      <ImageReferenceDialog
        assets={mainImages}
        onClose={() => setSquareSourcePickerOpen(false)}
        onConfirm={(source) => {
          setSquareSourcePickerOpen(false);
          setSquareCropSource(source);
        }}
        open={squareSourcePickerOpen}
        title="选择方块图来源"
      />
      {zoomAsset?.previewUrl && (
        <div
          aria-label="商品主图放大预览"
          aria-modal="true"
          className="fixed inset-0 z-[140] grid place-items-center bg-slate-950/75 p-4 sm:p-8"
          onClick={() => setZoomAsset(null)}
          role="dialog"
        >
          <div className="relative max-h-full max-w-5xl" onClick={(event) => event.stopPropagation()}>
            <img
              alt={`${zoomAsset.originalName || "商品主图"}放大预览`}
              className="max-h-[88vh] max-w-full rounded-lg bg-white object-contain shadow-2xl"
              src={zoomAsset.previewUrl}
            />
            <button
              aria-label="关闭商品主图放大预览"
              className="absolute right-2 top-2 rounded-full bg-slate-950/75 p-2 text-white"
              onClick={() => setZoomAsset(null)}
              type="button"
            >
              <X size={18} />
            </button>
          </div>
        </div>
      )}
      <SquareImageCropDialog busy={uploading} onClose={() => setSquareCropSource(null)} onConfirm={(file) => void uploadSquareCrop(file)} source={squareCropSource} />
      <SwatchImagePickerDialog busy={uploading} onClose={() => setSwatchPickerSource(null)} onConfirm={(file) => void uploadSwatch(file)} source={swatchPickerSource} />

      {(feedback || (saveAttempted && imageStage.blockers.length > 0)) && (
        <div className="border-t border-[var(--line)] px-4 py-3 sm:px-5">
          {feedback && (
            <p
              className={`flex items-start gap-2 text-xs leading-5 ${
                feedback.tone === "danger"
                  ? "text-[var(--danger)]"
                  : "text-[var(--success-strong)]"
              }`}
              role={feedback.tone === "danger" ? "alert" : "status"}
            >
              {feedback.tone === "danger" ? <AlertCircle className="mt-0.5 shrink-0" size={14} /> : <Check className="mt-0.5 shrink-0" size={14} />}
              {feedback.message}
            </p>
          )}
          {saveAttempted && imageStage.blockers.map((blocker) => (
            <p className="mt-1 flex items-start gap-2 text-xs leading-5 text-[var(--danger)]" key={blocker.code}>
              <AlertCircle className="mt-0.5 shrink-0" size={14} />
              {blocker.message}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
