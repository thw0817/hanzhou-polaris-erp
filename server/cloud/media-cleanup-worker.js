import { evaluateMediaCleanup } from "./media-lifecycle.js";

function toLifecycleAsset(row) {
  return {
    purpose: row.purpose,
    status: row.status,
    referenceCount: Number(
      row.actual_reference_count ?? row.reference_count ?? 0,
    ),
    activeJobCount: 0,
    expiresAt: row.expires_at,
    deleteAfter: row.delete_after,
    createdAt: row.created_at,
    metadata: row.metadata || {},
  };
}

export class PostgresMediaCleanupRepository {
  constructor({ pool } = {}) {
    if (!pool) {
      throw new Error("PostgresMediaCleanupRepository 缺少 pool");
    }
    this.pool = pool;
  }

  async listCandidates({ now, limit = 100 }) {
    const result = await this.pool.query({
      text: `
        SELECT
          asset.*,
          (
            SELECT count(*)::integer
            FROM media_asset_references asset_reference
            WHERE asset_reference.asset_id = asset.id
          ) AS actual_reference_count,
        FROM media_assets asset
          WHERE asset.status IN ('ready', 'failed', 'pending_delete', 'deleting')
          AND (
            (asset.status IN ('ready', 'failed') AND asset.expires_at <= $1)
            OR
            (asset.status = 'pending_delete' AND asset.delete_after <= $1)
            OR
            (
              asset.status = 'deleting'
              AND asset.updated_at <= $1 - interval '15 minutes'
            )
          )
            OR (asset.status = 'uploading'
              AND asset.created_at <= $1 - interval '2 hours')
        ORDER BY
          COALESCE(asset.delete_after, asset.expires_at) ASC,
          asset.created_at ASC
        LIMIT $2
      `,
      values: [now, limit],
    });
    return result.rows;
  }

  async markPendingDelete({
    assetId,
    tenantId,
    deleteAfter,
    expectedStatus,
  }) {
    const result = await this.pool.query({
      text: `
        UPDATE media_assets
        SET status = 'pending_delete',
            delete_after = $3,
            updated_at = now()
        WHERE id = $1
          AND tenant_id = $2
          AND status = $4
          AND NOT EXISTS (
            SELECT 1
            FROM media_asset_references asset_reference
            WHERE asset_reference.asset_id = media_assets.id
          )
        RETURNING id
      `,
      values: [assetId, tenantId, deleteAfter, expectedStatus],
    });
    return Boolean(result.rowCount);
  }

  async markUploadFailed({ assetId, tenantId }) {
    const result = await this.pool.query({
      text: `UPDATE media_assets
             SET status='failed',
                 expires_at = COALESCE(expires_at, now() + interval '7 days'),
                 metadata = COALESCE(metadata, '{}'::jsonb)
                   || jsonb_build_object(
                        'cleanupError', 'stale_upload',
                        'cleanupMarkedAt', now()
                      ),
                 updated_at=now()
             WHERE id=$1 AND tenant_id=$2 AND status='uploading'
             RETURNING id`,
      values: [assetId, tenantId],
    });
    return Boolean(result.rowCount);
  }

  async restoreProtected({
    assetId,
    tenantId,
    referenceCount,
    activeJobCount,
  }) {
    const restoredStatus = referenceCount > 0 ? "referenced" : "ready";
    await this.pool.query({
      text: `
        UPDATE media_assets
        SET status = $3,
            reference_count = $4,
            delete_after = NULL,
            updated_at = now()
        WHERE id = $1
          AND tenant_id = $2
          AND status = 'pending_delete'
          AND ($4 > 0 OR $5 > 0)
      `,
      values: [
        assetId,
        tenantId,
        restoredStatus,
        referenceCount,
        activeJobCount,
      ],
    });
  }

  async markDeleted({ assetId, tenantId }) {
    const result = await this.pool.query({
      text: `
        UPDATE media_assets
        SET status = 'deleted',
            deleted_at = now(),
            delete_after = NULL,
            updated_at = now()
        WHERE id = $1
          AND tenant_id = $2
          AND status = 'deleting'
        RETURNING id
      `,
      values: [assetId, tenantId],
    });
    return Boolean(result.rowCount);
  }

  async claimDelete({ assetId, tenantId }) {
    const result = await this.pool.query({
      text: `
        UPDATE media_assets
        SET status = 'deleting',
            updated_at = now()
        WHERE id = $1
          AND tenant_id = $2
          AND status = 'pending_delete'
          AND NOT EXISTS (
            SELECT 1
            FROM media_asset_references asset_reference
            WHERE asset_reference.asset_id = media_assets.id
          )
        RETURNING id
      `,
      values: [assetId, tenantId],
    });
    return Boolean(result.rowCount);
  }

  async releaseDelete({ assetId, tenantId }) {
    await this.pool.query({
      text: `
        UPDATE media_assets
        SET status = 'pending_delete',
            updated_at = now()
        WHERE id = $1
          AND tenant_id = $2
          AND status = 'deleting'
      `,
      values: [assetId, tenantId],
    });
  }
}

export class MediaCleanupWorker {
  constructor({
    repository,
    storage,
    now = () => new Date(),
    batchSize = 100,
  } = {}) {
    if (!repository) throw new Error("MediaCleanupWorker 缺少 repository");
    if (!storage) throw new Error("MediaCleanupWorker 缺少 storage");
    this.repository = repository;
    this.storage = storage;
    this.now = now;
    this.batchSize = Math.min(
      500,
      Math.max(1, Number.parseInt(batchSize, 10) || 100),
    );
  }

  async runOnce() {
    const now = new Date(this.now());
    const candidates = await this.repository.listCandidates({
      now,
      limit: this.batchSize,
    });
    const summary = {
      scanned: candidates.length,
      markedPendingDelete: 0,
      deleted: 0,
      restored: 0,
      kept: 0,
      failed: 0,
      markedUploadFailed: 0,
    };

    for (const row of candidates) {
      const lifecycle = toLifecycleAsset(row);
      const decision =
        row.status === "deleting"
          ? { action: "delete", reason: "stale_delete_claim" }
          : evaluateMediaCleanup(lifecycle, now);
      try {
        if (
          decision.action === "mark_upload_failed"
        ) {
          const changed = await this.repository.markUploadFailed({
            assetId: row.id,
            tenantId: row.tenant_id,
          });
          summary.markedUploadFailed += changed ? 1 : 0;
          summary.kept += changed ? 0 : 1;
          continue;
        }
        if (
          decision.action === "keep" &&
          row.status === "pending_delete" &&
          ["referenced", "active_job"].includes(decision.reason)
        ) {
          await this.repository.restoreProtected({
            assetId: row.id,
            tenantId: row.tenant_id,
            referenceCount: lifecycle.referenceCount,
            activeJobCount: lifecycle.activeJobCount,
          });
          summary.restored += 1;
          continue;
        }
        if (decision.action === "mark_pending_delete") {
          const changed = await this.repository.markPendingDelete({
            assetId: row.id,
            tenantId: row.tenant_id,
            deleteAfter: decision.deleteAfter,
            expectedStatus: row.status,
          });
          summary.markedPendingDelete += changed ? 1 : 0;
          summary.kept += changed ? 0 : 1;
          continue;
        }
        if (decision.action === "delete") {
          const claimed =
            row.status === "deleting" ||
            (await this.repository.claimDelete({
              assetId: row.id,
              tenantId: row.tenant_id,
            }));
          if (!claimed) {
            summary.kept += 1;
            continue;
          }
          try {
            await this.storage.deleteObject({ objectKey: row.object_key });
          } catch (error) {
            await this.repository.releaseDelete({
              assetId: row.id,
              tenantId: row.tenant_id,
            });
            throw error;
          }
          const changed = await this.repository.markDeleted({
            assetId: row.id,
            tenantId: row.tenant_id,
          });
          summary.deleted += changed ? 1 : 0;
          summary.kept += changed ? 0 : 1;
          continue;
        }
        summary.kept += 1;
      } catch {
        summary.failed += 1;
      }
    }
    return summary;
  }
}
