import crypto from "node:crypto";
import {
  buildMediaObjectKey,
  calculateMediaExpiry,
  MEDIA_RETENTION_DAYS,
} from "./media-lifecycle.js";
import {
  SHEIN_CERTIFICATE_MAX_BYTES,
  SHEIN_CERTIFICATE_MIME_TYPES,
  SHEIN_COMPLIANCE_PHOTO_MIME_TYPES,
  SHEIN_PHOTO_MAX_BYTES,
} from "../compliance-write-contract.js";
import {
  SHEIN_IMAGE_MAX_BYTES,
  SHEIN_IMAGE_MIME_TYPES,
} from "../shein-upload.js";
import {
  buildWorkspaceQuotaProjection,
  canAddMedia,
} from "./workspace-quota.js";

const ALLOWED_UPLOAD_TYPES = Object.freeze({
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "application/pdf": "pdf",
});

const BROWSER_UPLOAD_PURPOSES = new Set([
  "temporary_upload",
  "reusable_source",
  "generated_unselected",
  "selected_unpublished",
  "compliance_evidence",
]);

export class MediaServiceError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "MediaServiceError";
    this.code = code;
    this.status = status;
  }
}

function cleanFileName(value) {
  const normalized = String(value || "")
    .replaceAll("\\", "/")
    .split("/")
    .pop()
    .trim();
  if (!normalized) {
    throw new MediaServiceError("INVALID_FILE_NAME", "图片文件名不能为空");
  }
  if (normalized.length > 200) {
    throw new MediaServiceError(
      "INVALID_FILE_NAME",
      "图片文件名不能超过200个字符",
    );
  }
  return normalized;
}

function parsePositiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new MediaServiceError("INVALID_MEDIA_INPUT", `${name}无效`);
  }
  return parsed;
}

function parseOptionalDimension(value, name) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 100_000) {
    throw new MediaServiceError("INVALID_MEDIA_INPUT", `${name}无效`);
  }
  return parsed;
}

function publicAsset(row) {
  return {
    id: row.id,
    storeId: row.store_id ?? row.storeId ?? null,
    purpose: row.purpose,
    status: row.status,
    originalName: row.original_name ?? row.originalName ?? "",
    contentType: row.content_type ?? row.contentType ?? "",
    sizeBytes: Number(row.size_bytes ?? row.sizeBytes ?? 0),
    width: row.width ?? null,
    height: row.height ?? null,
    referenceCount: Number(
      row.reference_count ?? row.referenceCount ?? 0,
    ),
    expiresAt: row.expires_at ?? row.expiresAt ?? null,
    createdAt: row.created_at ?? row.createdAt ?? null,
  };
}

export class PostgresMediaRepository {
  constructor({ pool } = {}) {
    if (!pool) throw new Error("PostgresMediaRepository 缺少 pool");
    this.pool = pool;
  }

  async createAsset(asset) {
    const result = await this.pool.query({
      text: `
        INSERT INTO media_assets (
          id,
          tenant_id,
          store_id,
          created_by,
          provider,
          bucket,
          object_key,
          purpose,
          status,
          original_name,
          content_type,
          size_bytes,
          expires_at,
          metadata
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8,
          'uploading', $9, $10, $11, $12, $13::jsonb
        )
        RETURNING *
      `,
      values: [
        asset.id,
        asset.tenantId,
        asset.storeId,
        asset.createdBy,
        asset.provider,
        asset.bucket,
        asset.objectKey,
        asset.purpose,
        asset.originalName,
        asset.contentType,
        asset.sizeBytes,
        asset.expiresAt,
        JSON.stringify(asset.metadata || {}),
      ],
    });
    return result.rows[0];
  }

  async findAsset({ tenantId, storeId, assetId }) {
    const result = await this.pool.query({
      text: `
        SELECT *
        FROM media_assets
        WHERE id = $1
          AND tenant_id = $2
          AND store_id = $3
        LIMIT 1
      `,
      values: [assetId, tenantId, storeId],
    });
    return result.rows[0] || null;
  }

  async markReady({
    tenantId,
    storeId,
    assetId,
    sizeBytes,
    contentType,
    width,
    height,
    sha256,
    etag,
  }) {
    const result = await this.pool.query({
      text: `
        UPDATE media_assets
        SET status = 'ready',
            size_bytes = $4,
            content_type = $5,
            width = $6,
            height = $7,
            sha256 = $8,
            metadata = metadata || $9::jsonb,
            updated_at = now()
        WHERE id = $1
          AND tenant_id = $2
          AND store_id = $3
          AND status IN ('uploading', 'failed')
        RETURNING *
      `,
      values: [
        assetId,
        tenantId,
        storeId,
        sizeBytes,
        contentType,
        width,
        height,
        sha256,
        JSON.stringify(etag ? { etag } : {}),
      ],
    });
    return result.rows[0] || null;
  }

  async listAssets({ tenantId, storeId, purpose = null, limit = 50 }) {
    const result = await this.pool.query({
      text: `
        SELECT *
        FROM media_assets
        WHERE tenant_id = $1
          AND store_id = $2
          AND status <> 'deleted'
          AND ($3::text IS NULL OR purpose = $3)
        ORDER BY created_at DESC
        LIMIT $4
      `,
      values: [tenantId, storeId, purpose, limit],
    });
    return result.rows;
  }

  async usage({ tenantId, storeId }) {
    const result = await this.pool.query({
      text: `
        SELECT
          COUNT(*) FILTER (WHERE store_id=$2 AND status <> 'deleted')::int AS store_asset_count,
          COALESCE(SUM(size_bytes) FILTER (WHERE store_id=$2 AND status <> 'deleted'), 0)::bigint AS store_bytes,
          COUNT(*) FILTER (WHERE status <> 'deleted')::int AS tenant_asset_count,
          COALESCE(SUM(size_bytes) FILTER (WHERE status <> 'deleted'), 0)::bigint AS tenant_bytes
        FROM media_assets
        WHERE tenant_id=$1
      `,
      values: [tenantId, storeId],
    });
    return result.rows[0] || {};
  }
}

export class WebMediaService {
  constructor({
    repository,
    storage,
    provider = "s3",
    bucket,
    maxUploadBytes = 20 * 1024 * 1024,
    uploadTicketSeconds = 10 * 60,
    quota = {},
    now = () => new Date(),
  } = {}) {
    if (!repository) throw new Error("WebMediaService 缺少 repository");
    if (!storage) throw new Error("WebMediaService 缺少 storage");
    this.repository = repository;
    this.storage = storage;
    this.provider = String(provider || "s3");
    this.bucket = String(bucket || storage.bucket || "");
    this.maxUploadBytes =
      Number.isSafeInteger(Number(maxUploadBytes)) &&
      Number(maxUploadBytes) > 0
        ? Number(maxUploadBytes)
        : 20 * 1024 * 1024;
    this.uploadTicketSeconds =
      Number.isInteger(Number(uploadTicketSeconds)) &&
      Number(uploadTicketSeconds) >= 60
        ? Number(uploadTicketSeconds)
        : 10 * 60;
    this.quota = quota;
    this.now = now;
  }

  async createUploadTicket({ context, storeId, input = {} } = {}) {
    const contentType = String(input.contentType || "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    const extension = ALLOWED_UPLOAD_TYPES[contentType];
    if (!extension) {
      throw new MediaServiceError(
        "UNSUPPORTED_MEDIA_TYPE",
        "仅支持PDF、JPG、PNG、WebP和AVIF文件",
        415,
      );
    }
    const sizeBytes = parsePositiveInteger(input.sizeBytes, "图片大小");
    if (sizeBytes > this.maxUploadBytes) {
      throw new MediaServiceError(
        "MEDIA_TOO_LARGE",
        `单张图片不能超过${Math.floor(this.maxUploadBytes / 1024 / 1024)}MB`,
        413,
      );
    }
    const purpose = String(input.purpose || "temporary_upload").trim();
    if (
      !BROWSER_UPLOAD_PURPOSES.has(purpose) ||
      !(purpose in MEDIA_RETENTION_DAYS)
    ) {
      throw new MediaServiceError("INVALID_MEDIA_PURPOSE", "图片用途无效");
    }
    if (contentType === "application/pdf" && purpose !== "compliance_evidence") {
      throw new MediaServiceError(
        "INVALID_MEDIA_PURPOSE",
        "PDF只能作为合规证据上传",
      );
    }
    if (typeof this.repository.usage === "function") {
      const projection = buildWorkspaceQuotaProjection({
        mediaUsage: await this.repository.usage({
          tenantId: context.tenantId,
          storeId,
        }),
        quota: this.quota,
      });
      if (!canAddMedia(projection, { sizeBytes })) {
        throw new MediaServiceError(
          "MEDIA_QUOTA_EXCEEDED",
          "图片素材已达到当前店铺或账号上限，请先删除旧素材或发布后等待清理",
          409,
        );
      }
    }
    const originalName = cleanFileName(input.originalName);
    const assetId = crypto.randomUUID();
    const createdAt = new Date(this.now());
    const objectKey = buildMediaObjectKey({
      tenantId: context.tenantId,
      storeId,
      purpose,
      assetId,
      extension,
      createdAt,
    });
    const expiresAt = calculateMediaExpiry({ purpose, createdAt });
    const upload = this.storage.createUploadUrl({
      objectKey,
      contentType,
      expiresInSeconds: this.uploadTicketSeconds,
    });
    const asset = await this.repository.createAsset({
      id: assetId,
      tenantId: context.tenantId,
      storeId,
      createdBy: context.userId,
      provider: this.provider,
      bucket: this.bucket,
      objectKey,
      purpose,
      originalName,
      contentType,
      sizeBytes,
      expiresAt,
      metadata: {
        expectedSizeBytes: sizeBytes,
      },
    });
    return {
      asset: publicAsset(asset),
      upload: {
        method: "PUT",
        url: upload.url,
        headers: upload.headers,
        expiresAt: upload.expiresAt,
      },
    };
  }

  async completeUpload({
    context,
    storeId,
    assetId,
    input = {},
  } = {}) {
    const asset = await this.repository.findAsset({
      tenantId: context.tenantId,
      storeId,
      assetId,
    });
    if (!asset) {
      throw new MediaServiceError("MEDIA_NOT_FOUND", "图片记录不存在", 404);
    }
    if (asset.status === "ready" || asset.status === "referenced") {
      return { asset: publicAsset(asset), alreadyCompleted: true };
    }
    if (!["uploading", "failed"].includes(asset.status)) {
      throw new MediaServiceError(
        "MEDIA_STATE_CONFLICT",
        "当前图片状态不能完成上传",
        409,
      );
    }

    let remote;
    try {
      remote = await this.storage.statObject({
        objectKey: asset.object_key,
      });
    } catch (error) {
      throw new MediaServiceError(
        "MEDIA_UPLOAD_NOT_FOUND",
        error?.status === 404
          ? "对象存储中尚未找到图片，请确认上传完成"
          : "暂时无法校验对象存储中的图片",
        error?.status === 404 ? 409 : 503,
      );
    }
    const expectedSize = Number(asset.size_bytes);
    if (
      Number.isFinite(remote.sizeBytes) &&
      remote.sizeBytes !== expectedSize
    ) {
      throw new MediaServiceError(
        "MEDIA_SIZE_MISMATCH",
        "对象存储中的图片大小与上传申请不一致",
        409,
      );
    }
    const remoteType = String(remote.contentType || "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (remoteType && remoteType !== asset.content_type) {
      throw new MediaServiceError(
        "MEDIA_TYPE_MISMATCH",
        "对象存储中的图片类型与上传申请不一致",
        409,
      );
    }
    const sha256 = String(input.sha256 || "").trim().toLowerCase() || null;
    if (sha256 && !/^[a-f0-9]{64}$/.test(sha256)) {
      throw new MediaServiceError("INVALID_MEDIA_HASH", "图片SHA-256无效");
    }
    const ready = await this.repository.markReady({
      tenantId: context.tenantId,
      storeId,
      assetId,
      sizeBytes: remote.sizeBytes ?? expectedSize,
      contentType: remoteType || asset.content_type,
      width: parseOptionalDimension(input.width, "图片宽度"),
      height: parseOptionalDimension(input.height, "图片高度"),
      sha256,
      etag: remote.etag || null,
    });
    if (!ready) {
      throw new MediaServiceError(
        "MEDIA_STATE_CONFLICT",
        "图片状态已变化，请刷新后重试",
        409,
      );
    }
    return { asset: publicAsset(ready), alreadyCompleted: false };
  }

  async createDownloadTicket({ context, storeId, assetId } = {}) {
    const asset = await this.repository.findAsset({
      tenantId: context.tenantId,
      storeId,
      assetId,
    });
    if (!asset) {
      throw new MediaServiceError("MEDIA_NOT_FOUND", "图片记录不存在", 404);
    }
    if (!["ready", "referenced"].includes(String(asset.status || ""))) {
      throw new MediaServiceError(
        "MEDIA_NOT_READY",
        "图片尚未生成完成",
        409,
      );
    }
    const contentType = String(asset.content_type || "");
    if (!contentType.startsWith("image/")) {
      throw new MediaServiceError(
        "UNSUPPORTED_MEDIA_TYPE",
        "当前文件不是可下载图片",
        415,
      );
    }
    const download = this.storage.createDownloadUrl({
      objectKey: asset.object_key,
      expiresInSeconds: 5 * 60,
    });
    return {
      asset: publicAsset(asset),
      download: {
        method: "GET",
        url: download.url,
        headers: download.headers || {},
        expiresAt: download.expiresAt,
      },
    };
  }

  async readReadySheinImage({ context, storeId, assetId } = {}) {
    const asset = await this.repository.findAsset({
      tenantId: context.tenantId,
      storeId,
      assetId,
    });
    if (!asset) {
      throw new MediaServiceError("MEDIA_NOT_FOUND", "图片记录不存在", 404);
    }
    if (!["ready", "referenced"].includes(String(asset.status || ""))) {
      throw new MediaServiceError(
        "MEDIA_NOT_READY",
        "图片尚未完成上传或仍不可用于发布",
        409,
      );
    }
    const contentType = String(asset.content_type || "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (!SHEIN_IMAGE_MIME_TYPES.has(contentType)) {
      throw new MediaServiceError(
        "UNSUPPORTED_SHEIN_IMAGE_TYPE",
        "SHEIN商品图片仅支持JPG、JPEG和PNG",
        415,
      );
    }
    if (Number(asset.size_bytes) > SHEIN_IMAGE_MAX_BYTES) {
      throw new MediaServiceError(
        "SHEIN_IMAGE_TOO_LARGE",
        "图片文件超过SHEIN规定的3MB",
        413,
      );
    }
    const object = await this.storage.getObject({
      objectKey: asset.object_key,
      maxBytes: SHEIN_IMAGE_MAX_BYTES,
    });
    const remoteType = String(object.contentType || "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (
      remoteType &&
      remoteType !== "application/octet-stream" &&
      remoteType !== contentType
    ) {
      throw new MediaServiceError(
        "MEDIA_TYPE_MISMATCH",
        "对象存储中的图片类型与素材记录不一致",
        409,
      );
    }
    return {
      asset: publicAsset(asset),
      fileBytes: object.bytes,
      fileName: String(asset.original_name || "upload.jpg"),
      mimeType: contentType,
    };
  }

  async readReadyComplianceEvidence({
    context,
    storeId,
    assetId,
    kind,
  } = {}) {
    const asset = await this.repository.findAsset({
      tenantId: context.tenantId,
      storeId,
      assetId,
    });
    if (!asset) {
      throw new MediaServiceError("MEDIA_NOT_FOUND", "合规素材记录不存在", 404);
    }
    if (!["ready", "referenced"].includes(String(asset.status || ""))) {
      throw new MediaServiceError(
        "MEDIA_NOT_READY",
        "合规素材尚未完成上传或仍不可用于提交",
        409,
      );
    }
    if (String(asset.purpose || "") !== "compliance_evidence") {
      throw new MediaServiceError(
        "INVALID_MEDIA_PURPOSE",
        "当前文件不属于合规证据素材",
        409,
      );
    }
    const contentType = String(asset.content_type || "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    const photo = kind === "photo";
    const allowedTypes = photo
      ? SHEIN_COMPLIANCE_PHOTO_MIME_TYPES
      : SHEIN_CERTIFICATE_MIME_TYPES;
    const maxBytes = photo ? SHEIN_PHOTO_MAX_BYTES : SHEIN_CERTIFICATE_MAX_BYTES;
    if (!allowedTypes.has(contentType)) {
      throw new MediaServiceError(
        "UNSUPPORTED_COMPLIANCE_MEDIA_TYPE",
        photo
          ? "SHEIN合规实拍图仅支持JPG、JPEG和PNG"
          : "SHEIN资质证书仅支持PDF、JPG、JPEG和PNG",
        415,
      );
    }
    if (Number(asset.size_bytes) > maxBytes) {
      throw new MediaServiceError(
        "COMPLIANCE_MEDIA_TOO_LARGE",
        photo ? "合规实拍图超过SHEIN规定的10MB" : "资质证书超过SHEIN规定的20MB",
        413,
      );
    }
    if (photo && (
      !Number.isInteger(Number(asset.width)) ||
      !Number.isInteger(Number(asset.height)) ||
      Number(asset.width) <= 0 ||
      Number(asset.height) <= 0 ||
      Number(asset.width) > 8000 ||
      Number(asset.height) > 8000
    )) {
      throw new MediaServiceError(
        "COMPLIANCE_PHOTO_DIMENSIONS_INVALID",
        "合规实拍图宽高必须已校验且均不超过8000px",
        409,
      );
    }
    const object = await this.storage.getObject({
      objectKey: asset.object_key,
      maxBytes,
    });
    const remoteType = String(object.contentType || "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (
      remoteType &&
      remoteType !== "application/octet-stream" &&
      remoteType !== contentType
    ) {
      throw new MediaServiceError(
        "MEDIA_TYPE_MISMATCH",
        "对象存储中的文件类型与素材记录不一致",
        409,
      );
    }
    return {
      asset: publicAsset(asset),
      fileBytes: object.bytes,
      fileName: String(asset.original_name || (photo ? "compliance-photo.jpg" : "report.pdf")),
      mimeType: contentType,
      width: asset.width == null ? null : Number(asset.width),
      height: asset.height == null ? null : Number(asset.height),
    };
  }

  async listAssets({
    context,
    storeId,
    purpose = null,
    limit = 50,
  } = {}) {
    const normalizedPurpose = purpose ? String(purpose).trim() : null;
    if (
      normalizedPurpose &&
      !(normalizedPurpose in MEDIA_RETENTION_DAYS)
    ) {
      throw new MediaServiceError("INVALID_MEDIA_PURPOSE", "图片用途无效");
    }
    const normalizedLimit = Math.min(
      100,
      Math.max(1, Number.parseInt(limit, 10) || 50),
    );
    const rows = await this.repository.listAssets({
      tenantId: context.tenantId,
      storeId,
      purpose: normalizedPurpose,
      limit: normalizedLimit,
    });
    let quota = null;
    if (typeof this.repository.usage === "function") {
      quota = buildWorkspaceQuotaProjection({
        mediaUsage: await this.repository.usage({
          tenantId: context.tenantId,
          storeId,
        }),
        quota: this.quota,
      }).media;
    }
    return {
      assets: rows.map(publicAsset),
      count: rows.length,
      retentionDays: MEDIA_RETENTION_DAYS,
      generatedAt: new Date(this.now()).toISOString(),
      quota,
    };
  }
}
