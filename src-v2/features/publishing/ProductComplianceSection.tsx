import {
  AlertCircle,
  Camera,
  FileCheck2,
  ListChecks,
  LoaderCircle,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import type {
  CompliancePhotoAssignment,
  ComplianceTemplate,
} from "../../lib/api";
import { classifyComplianceTemplateOptions } from "../../lib/compliance-template-reuse-contract.js";

export type CompliancePhotoSourceMode = "template" | "manual";
export type DraftCompliancePhoto = CompliancePhotoAssignment & {
  previewUrl?: string;
};

interface ComplianceStage {
  valid: boolean;
  blockers: Array<{ code: string; message: string }>;
  advisories: Array<{ code: string; message: string }>;
  postPublishTasks: Array<{ code: string; message: string }>;
  expectedReport: "1630" | "1631" | null;
  reportMaterial: unknown | null;
  reportDate: string | null;
  photos: {
    body: unknown | null;
    bodyList?: unknown[];
    package: unknown | null;
    packageList?: unknown[];
  };
  manualQueue: Array<"gcc" | "product_identifier">;
  requiresSkcRevalidation: true;
}

function PhotoSummary({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-start gap-3 rounded-md border border-[var(--line)] bg-white px-3 py-3">
      <Camera className="mt-0.5 shrink-0 text-[var(--text-subtle)]" size={16} />
      <div className="min-w-0">
        <p className="text-sm font-medium text-[var(--ink)]">{label}</p>
        <p className={`mt-1 text-xs ${count ? "text-[var(--success-strong)]" : "text-[var(--text-subtle)]"}`}>
          {count ? `已引用 ${count} 张` : "模板中未配置"}
        </p>
      </div>
    </div>
  );
}

function ManualPhotoGroup({
  group,
  label,
  photos,
  busy,
  uploading,
  onUpload,
  onRemove,
}: {
  group: "body" | "package";
  label: string;
  photos: DraftCompliancePhoto[];
  busy: boolean;
  uploading: boolean;
  onUpload: (group: "body" | "package", files: FileList | null) => void;
  onRemove: (group: "body" | "package", localAssetRef: string) => void;
}) {
  return (
    <div className="rounded-md border border-[var(--line)] bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-[var(--ink)]">{label}</p>
          <p className="mt-1 text-xs text-[var(--text-subtle)]">
            JPG、JPEG、PNG，最多15张，单张不超过10MB
          </p>
        </div>
        <label className={`inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--line-strong)] bg-white px-2.5 text-xs font-medium ${busy ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-[var(--surface-muted)]"}`}>
          {uploading ? <LoaderCircle className="animate-spin" size={14} /> : <Upload size={14} />}
          选择图片
          <input
            accept="image/jpeg,image/png"
            className="sr-only"
            disabled={busy || photos.length >= 15}
            multiple
            onChange={(event) => {
              onUpload(group, event.target.files);
              event.target.value = "";
            }}
            type="file"
          />
        </label>
      </div>
      {photos.length ? (
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5 xl:grid-cols-8">
          {photos.map((photo) => (
            <div className="group relative aspect-square overflow-hidden rounded border border-[var(--line)] bg-[var(--surface-subtle)]" key={photo.localAssetRef}>
              {photo.previewUrl ? (
                <img alt={photo.fileName || label} className="h-full w-full object-cover" src={photo.previewUrl} />
              ) : (
                <div className="grid h-full place-items-center text-[var(--text-subtle)]"><Camera size={18} /></div>
              )}
              <button
                aria-label={`移除${photo.fileName || label}`}
                className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded bg-white/95 text-[var(--danger)] shadow-sm opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                disabled={busy}
                onClick={() => onRemove(group, photo.localAssetRef)}
                type="button"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 rounded border border-dashed border-[var(--line)] px-3 py-4 text-center text-xs text-[var(--text-subtle)]">
          尚未上传{label}
        </p>
      )}
    </div>
  );
}

export function ProductComplianceSection({
  templates,
  selectedTemplateId,
  photoSourceMode,
  manualPhotos,
  stage,
  busy,
  uploading,
  onPhotoSourceModeChange,
  onTemplateChange,
  onUpload,
  onRemove,
  onOpenTemplates,
}: {
  templates: ComplianceTemplate[];
  selectedTemplateId: string;
  photoSourceMode: CompliancePhotoSourceMode;
  manualPhotos: DraftCompliancePhoto[];
  stage: ComplianceStage;
  busy: boolean;
  uploading: boolean;
  saveAttempted: boolean;
  onPhotoSourceModeChange: (mode: CompliancePhotoSourceMode) => void;
  onTemplateChange: (templateId: string) => void;
  onUpload: (group: "body" | "package", files: FileList | null) => void;
  onRemove: (group: "body" | "package", localAssetRef: string) => void;
  onOpenTemplates: () => void;
}) {
  const options = classifyComplianceTemplateOptions({ templates, reportType: null });
  // Only show templates that carry protected body/package assets. Report templates
  // and empty compliance shells cannot satisfy the photo reference workflow.
  const categoryTemplates = options.photoTemplates;
  const bodyPhotos = manualPhotos.filter((photo) => String(photo.labelGroup) === "1");
  const packagePhotos = manualPhotos.filter((photo) => String(photo.labelGroup) === "2");
  const templateBodyCount = stage.photos.bodyList?.length || (stage.photos.body ? 1 : 0);
  const templatePackageCount = stage.photos.packageList?.length || (stage.photos.package ? 1 : 0);

  return (
    <section className="data-panel scroll-mt-20" id="draft-product-compliance">
      <header className="data-toolbar">
        <div>
          <h2>商品实拍图</h2>
          <p>商品发布成功并获得SKC后，系统自动上传并绑定到SHEIN</p>
        </div>
        <ShieldCheck className="text-[var(--text-subtle)]" size={18} />
      </header>

      <div className="border-b border-[var(--line)] px-4 py-4 sm:px-5">
        <div className="inline-grid grid-cols-2 rounded-md border border-[var(--line)] bg-[var(--surface-subtle)] p-1">
          {([["template", "引用模板"], ["manual", "手动上传"]] as const).map(([mode, label]) => (
            <button
              aria-pressed={photoSourceMode === mode}
              className={`rounded px-4 py-2 text-xs font-medium ${photoSourceMode === mode ? "bg-white text-[var(--ink)] shadow-sm" : "text-[var(--text-muted)]"}`}
              disabled={busy}
              key={mode}
              onClick={() => onPhotoSourceModeChange(mode)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {photoSourceMode === "template" ? (
        <div className="border-b border-[var(--line)] px-4 py-4 sm:px-5">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <label>
              <span className="text-xs font-medium text-[var(--text-muted)]">实拍图模板（可选）</span>
              <select
                className="field mt-2 px-3"
                disabled={busy}
                onChange={(event) => onTemplateChange(event.target.value)}
                value={selectedTemplateId}
              >
                <option value="">暂不引用（不阻断发布）</option>
                {categoryTemplates.map((template) => (
                  <option key={template.id} value={template.id}>{template.name} · v{template.version}</option>
                ))}
              </select>
            </label>
            <Button disabled={busy} onClick={onOpenTemplates} variant="outline">
              <ListChecks size={16} />管理实拍图模板
            </Button>
          </div>
          {selectedTemplateId ? (
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <PhotoSummary count={templateBodyCount} label="商品本体实拍图" />
              <PhotoSummary count={templatePackageCount} label="商品包装实拍图" />
            </div>
          ) : !categoryTemplates.length ? (
            <p className="mt-3 text-xs text-[var(--text-subtle)]">当前店铺没有可引用的实拍图模板</p>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-3 border-b border-[var(--line)] bg-[var(--surface-subtle)] px-4 py-4 sm:px-5 lg:grid-cols-2">
          <ManualPhotoGroup busy={busy} group="body" label="商品本体实拍图" onRemove={onRemove} onUpload={onUpload} photos={bodyPhotos} uploading={uploading} />
          <ManualPhotoGroup busy={busy} group="package" label="商品包装实拍图" onRemove={onRemove} onUpload={onUpload} photos={packagePhotos} uploading={uploading} />
        </div>
      )}

      <div className="border-b border-[var(--line)] px-4 py-4 sm:px-5">
        <div className="flex items-start gap-3">
          <FileCheck2 className="mt-0.5 shrink-0 text-[var(--text-subtle)]" size={16} />
          <div>
            <p className="text-sm font-medium text-[var(--ink)]">1630/1631 报告</p>
            <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
              等待 SKC 生成后由 SHEIN 返回官方报告类型，再到合规工作台单个或批量上传。
            </p>
          </div>
        </div>
      </div>

      <div className="grid divide-y divide-[var(--line)] sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        {["GCC", "产品标识符"].map((label) => (
          <div className="flex items-start gap-3 px-4 py-3 sm:px-5" key={label}>
            <AlertCircle className="mt-0.5 shrink-0 text-[var(--warning)]" size={16} />
            <div>
              <p className="text-sm font-medium text-[var(--ink)]">{label}</p>
              <p className="mt-1 text-xs leading-5 text-[var(--text-subtle)]">SKC生成后读取官方必填状态，必填时进入人工队列</p>
            </div>
          </div>
        ))}
      </div>

      {stage.advisories.length > 0 && (
        <div className="notice m-4 sm:m-5" role="status">
          <AlertCircle size={16} />
          <span>
            {stage.advisories[0].message}
            {stage.advisories.length > 1 ? `，另有 ${stage.advisories.length - 1} 项发布后待处理` : ""}
          </span>
        </div>
      )}
    </section>
  );
}
