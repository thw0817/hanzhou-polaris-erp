const DAY_MS = 24 * 60 * 60 * 1000;

export const MEDIA_RETENTION_DAYS = Object.freeze({
  temporary_upload: 3,
  reusable_source: 3,
  generated_unselected: 3,
  selected_unpublished: 3,
  published_archive: 180,
  compliance_evidence: null,
  thumbnail: 30,
});

export const MEDIA_DELETE_GRACE_DAYS = 7;
export const MEDIA_UPLOAD_TIMEOUT_MS = 2 * 60 * 60 * 1000;

const CREATIVE_MEDIA_PURPOSES = new Set([
  "temporary_upload",
  "reusable_source",
  "generated_unselected",
  "selected_unpublished",
]);

function requiredText(value, name) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new TypeError(`${name}不能为空`);
  return normalized;
}

function safeSegment(value, name) {
  const normalized = requiredText(value, name);
  if (!/^[A-Za-z0-9_-]+$/.test(normalized)) {
    throw new TypeError(`${name}只能包含字母、数字、下划线和短横线`);
  }
  return normalized;
}

export function buildMediaObjectKey({
  tenantId,
  storeId = "shared",
  purpose,
  assetId,
  extension = "bin",
  createdAt = new Date(),
} = {}) {
  if (!(purpose in MEDIA_RETENTION_DAYS)) {
    throw new TypeError("图片用途无效");
  }
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) throw new TypeError("创建时间无效");
  const normalizedExtension = String(extension || "bin")
    .replace(/^\./, "")
    .toLowerCase();
  if (!/^[a-z0-9]{1,10}$/.test(normalizedExtension)) {
    throw new TypeError("文件扩展名无效");
  }
  return [
    safeSegment(tenantId, "租户ID"),
    safeSegment(storeId, "店铺ID"),
    purpose,
    date.toISOString().slice(0, 10),
    `${safeSegment(assetId, "素材ID")}.${normalizedExtension}`,
  ].join("/");
}

export function calculateMediaExpiry({
  purpose,
  createdAt = new Date(),
} = {}) {
  if (!(purpose in MEDIA_RETENTION_DAYS)) {
    throw new TypeError("图片用途无效");
  }
  const retentionDays = MEDIA_RETENTION_DAYS[purpose];
  if (retentionDays === null) return null;
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) throw new TypeError("创建时间无效");
  return new Date(created.getTime() + retentionDays * DAY_MS);
}

export function evaluateMediaCleanup(asset = {}, now = new Date()) {
  const currentTime = new Date(now);
  if (Number.isNaN(currentTime.getTime())) throw new TypeError("当前时间无效");
  const referenceCount = Number(asset.referenceCount || 0);
  const activeJobCount = Number(asset.activeJobCount || 0);
  if (referenceCount > 0 || activeJobCount > 0) {
    return {
      action: "keep",
      reason: referenceCount > 0 ? "referenced" : "active_job",
      deleteAfter: null,
    };
  }
  if (asset.status === "uploading") {
    const createdAt = asset.createdAt ? new Date(asset.createdAt) : null;
    if (createdAt && !Number.isNaN(createdAt.getTime()) &&
        createdAt.getTime() + MEDIA_UPLOAD_TIMEOUT_MS <= currentTime.getTime()) {
      return { action: "mark_upload_failed", reason: "stale_upload", deleteAfter: null };
    }
    return { action: "keep", reason: "upload_in_progress", deleteAfter: null };
  }
  const staleEvidence = asset.purpose === "compliance_evidence" &&
    asset.status === "failed" &&
    asset.metadata?.cleanupError === "stale_upload";
  if (asset.purpose === "compliance_evidence" && !staleEvidence) {
    return {
      action: "keep",
      reason: "protected_evidence",
      deleteAfter: null,
    };
  }
  if (asset.status === "pending_delete") {
    const deleteAfter = asset.deleteAfter
      ? new Date(asset.deleteAfter)
      : null;
    if (deleteAfter && deleteAfter <= currentTime) {
      return { action: "delete", reason: "grace_expired", deleteAfter };
    }
    return {
      action: "keep",
      reason: "recovery_window",
      deleteAfter,
    };
  }
  const expiresAt = asset.expiresAt ? new Date(asset.expiresAt) : null;
  if (!expiresAt || expiresAt > currentTime) {
    return { action: "keep", reason: "not_expired", deleteAfter: null };
  }
  return {
    action: "mark_pending_delete",
    reason: "expired_unreferenced",
    deleteAfter: new Date(
      currentTime.getTime() +
        (CREATIVE_MEDIA_PURPOSES.has(asset.purpose)
          ? 0
          : MEDIA_DELETE_GRACE_DAYS) * DAY_MS,
    ),
  };
}
