export const DEFAULT_WORKSPACE_QUOTA = Object.freeze({
  draftPerStore: 100,
  draftPerTenant: 1_000,
  mediaAssetsPerStore: 1_000,
  mediaAssetsPerTenant: 10_000,
  mediaBytesPerStore: 4 * 1024 ** 3,
  mediaBytesPerTenant: 40 * 1024 ** 3,
});

function positiveLimit(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function normalizeWorkspaceQuota(input = {}) {
  return Object.freeze({
    draftPerStore: positiveLimit(input.draftPerStore, DEFAULT_WORKSPACE_QUOTA.draftPerStore),
    draftPerTenant: positiveLimit(input.draftPerTenant, DEFAULT_WORKSPACE_QUOTA.draftPerTenant),
    mediaAssetsPerStore: positiveLimit(
      input.mediaAssetsPerStore,
      DEFAULT_WORKSPACE_QUOTA.mediaAssetsPerStore,
    ),
    mediaAssetsPerTenant: positiveLimit(
      input.mediaAssetsPerTenant,
      DEFAULT_WORKSPACE_QUOTA.mediaAssetsPerTenant,
    ),
    mediaBytesPerStore: positiveLimit(
      input.mediaBytesPerStore,
      DEFAULT_WORKSPACE_QUOTA.mediaBytesPerStore,
    ),
    mediaBytesPerTenant: positiveLimit(
      input.mediaBytesPerTenant,
      DEFAULT_WORKSPACE_QUOTA.mediaBytesPerTenant,
    ),
  });
}

function remaining(limit, used) {
  return Math.max(0, limit - Math.max(0, Number(used) || 0));
}

function nearingLimit(used, limit) {
  return used >= limit || used / limit >= 0.8;
}

function formatBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

export function buildWorkspaceQuotaProjection({
  draftUsage = {},
  mediaUsage = {},
  quota: inputQuota = {},
} = {}) {
  const quota = normalizeWorkspaceQuota(inputQuota);
  const drafts = {
    storeUsed: Math.max(0, Number(draftUsage.storeDraftCount) || 0),
    storeLimit: quota.draftPerStore,
    tenantUsed: Math.max(0, Number(draftUsage.tenantDraftCount) || 0),
    tenantLimit: quota.draftPerTenant,
  };
  drafts.storeRemaining = remaining(drafts.storeLimit, drafts.storeUsed);
  drafts.tenantRemaining = remaining(drafts.tenantLimit, drafts.tenantUsed);
  drafts.blocked =
    drafts.storeUsed >= drafts.storeLimit || drafts.tenantUsed >= drafts.tenantLimit;

  const media = {
    storeUsed: Math.max(0, Number(mediaUsage.storeAssetCount) || 0),
    storeLimit: quota.mediaAssetsPerStore,
    tenantUsed: Math.max(0, Number(mediaUsage.tenantAssetCount) || 0),
    tenantLimit: quota.mediaAssetsPerTenant,
    storeBytesUsed: Math.max(0, Number(mediaUsage.storeBytes) || 0),
    storeBytesLimit: quota.mediaBytesPerStore,
    tenantBytesUsed: Math.max(0, Number(mediaUsage.tenantBytes) || 0),
    tenantBytesLimit: quota.mediaBytesPerTenant,
  };
  media.storeRemaining = remaining(media.storeLimit, media.storeUsed);
  media.tenantRemaining = remaining(media.tenantLimit, media.tenantUsed);
  media.storeBytesRemaining = remaining(media.storeBytesLimit, media.storeBytesUsed);
  media.tenantBytesRemaining = remaining(media.tenantBytesLimit, media.tenantBytesUsed);
  media.blocked =
    media.storeUsed >= media.storeLimit ||
    media.tenantUsed >= media.tenantLimit ||
    media.storeBytesUsed >= media.storeBytesLimit ||
    media.tenantBytesUsed >= media.tenantBytesLimit;

  const alerts = [];
  if (drafts.blocked) {
    alerts.push({
      code: "DRAFT_QUOTA_EXCEEDED",
      level: "error",
      message: "草稿数量已达到当前店铺或账号上限，请先删除或发布旧草稿",
    });
  } else if (nearingLimit(drafts.storeUsed, drafts.storeLimit) || nearingLimit(drafts.tenantUsed, drafts.tenantLimit)) {
    alerts.push({
      code: "DRAFT_QUOTA_NEAR_LIMIT",
      level: "warning",
      message: `草稿空间接近上限，当前店铺剩余${drafts.storeRemaining}个、账号剩余${drafts.tenantRemaining}个`,
    });
  }
  if (media.blocked) {
    alerts.push({
      code: "MEDIA_QUOTA_EXCEEDED",
      level: "error",
      message: "图片素材已达到当前店铺或账号上限，请先删除旧素材或发布后等待清理",
    });
  } else if (
    nearingLimit(media.storeUsed, media.storeLimit) ||
    nearingLimit(media.tenantUsed, media.tenantLimit) ||
    nearingLimit(media.storeBytesUsed, media.storeBytesLimit) ||
    nearingLimit(media.tenantBytesUsed, media.tenantBytesLimit)
  ) {
    alerts.push({
      code: "MEDIA_QUOTA_NEAR_LIMIT",
      level: "warning",
      message: `图片素材空间接近上限，当前店铺已用${formatBytes(media.storeBytesUsed)}、账号已用${formatBytes(media.tenantBytesUsed)}`,
    });
  }
  return { quota, drafts, media, alerts };
}

export function canAddDraft(projection) {
  return !projection?.drafts?.blocked;
}

export function canAddMedia(projection, { sizeBytes = 0 } = {}) {
  const size = Math.max(0, Number(sizeBytes) || 0);
  const media = projection?.media;
  if (!media) return true;
  return (
    media.storeUsed + 1 <= media.storeLimit &&
    media.tenantUsed + 1 <= media.tenantLimit &&
    media.storeBytesUsed + size <= media.storeBytesLimit &&
    media.tenantBytesUsed + size <= media.tenantBytesLimit
  );
}
