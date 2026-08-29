import {
  createErp06Fingerprint,
  redactVersionSnapshot,
} from "./erp06-product-version-service.js";
import { withTransaction } from "./postgres.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BATCH_SOURCES = new Set(["drafts", "relaunch", "mixed"]);

function text(value) {
  return String(value ?? "").trim();
}

function ensureUuid(value, name) {
  const normalized = text(value);
  if (!UUID_PATTERN.test(normalized)) {
    throw new Erp06PublishBatchError(
      "INVALID_BATCH_INPUT",
      `${name} 不是有效 UUID`,
    );
  }
  return normalized;
}

function ensureText(value, name) {
  const normalized = text(value);
  if (!normalized) {
    throw new Erp06PublishBatchError(
      "INVALID_BATCH_INPUT",
      `${name} 不能为空`,
    );
  }
  return normalized;
}

function ensureProductVersionIds(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Erp06PublishBatchError(
      "INVALID_BATCH_SELECTION",
      "PublishBatch 至少需要一个 ProductVersion",
    );
  }
  const normalized = values.map((value) => ensureUuid(value, "productVersionId"));
  if (new Set(normalized).size !== normalized.length) {
    throw new Erp06PublishBatchError(
      "INVALID_BATCH_SELECTION",
      "PublishBatch 不允许重复 ProductVersion",
    );
  }
  return normalized;
}

function publicBatch({ idempotent, batch, items, selectionFingerprint, productVersionIds }) {
  return {
    idempotent,
    batchId: batch.id,
    selectionFingerprint,
    state: batch.state || "queued",
    itemIds: items.map((item) => item.id),
    productVersionIds,
    itemCount: items.length,
  };
}

export class Erp06PublishBatchError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.name = "Erp06PublishBatchError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class PostgresErp06PublishBatchRepository {
  constructor({ pool } = {}) {
    if (!pool) throw new Error("PostgresErp06PublishBatchRepository 缺少 pool");
    this.pool = pool;
  }

  async createPublishBatch({
    tenantId,
    storeId,
    name,
    idempotencyKey,
    productVersionIds,
    source = "drafts",
    policySnapshot = {},
    userId = null,
  } = {}) {
    const scope = {
      tenantId: ensureUuid(tenantId, "tenantId"),
      storeId: ensureUuid(storeId, "storeId"),
      name: ensureText(name, "name"),
      idempotencyKey: ensureText(idempotencyKey, "idempotencyKey"),
      productVersionIds: ensureProductVersionIds(productVersionIds),
      source: text(source) || "drafts",
      policySnapshot: redactVersionSnapshot(policySnapshot || {}),
      userId: userId ? ensureUuid(userId, "userId") : null,
    };
    if (!BATCH_SOURCES.has(scope.source)) {
      throw new Erp06PublishBatchError(
        "INVALID_BATCH_INPUT",
        "PublishBatch source 不在允许范围内",
      );
    }

    return withTransaction(this.pool, async (client) => {
      const versionsResult = await client.query({
        text: `SELECT pv.id, pv.catalog_product_id,
                      dr.product_draft_id AS source_product_draft_id,
                      pv.version_fingerprint, pv.schema_version
               FROM product_versions pv
               JOIN draft_revisions dr
                 ON dr.tenant_id=pv.tenant_id
                AND dr.store_id=pv.store_id
                AND dr.id=pv.source_draft_revision_id
               WHERE pv.tenant_id=$1 AND pv.store_id=$2
                 AND pv.id = ANY($3::uuid[])
               ORDER BY array_position($3::uuid[], pv.id)
               FOR SHARE`,
        values: [scope.tenantId, scope.storeId, scope.productVersionIds],
      });
      const versions = versionsResult.rows || [];
      if (versions.length !== scope.productVersionIds.length) {
        throw new Erp06PublishBatchError(
          "PRODUCT_VERSION_NOT_FOUND",
          "部分 ProductVersion 不存在或不属于当前租户/店铺",
          409,
        );
      }
      const selectionFingerprint = createErp06Fingerprint({
        tenantId: scope.tenantId,
        storeId: scope.storeId,
        source: scope.source,
        policySnapshot: scope.policySnapshot,
        items: versions.map((version) => ({
          productVersionId: version.id,
          catalogProductId: version.catalog_product_id,
          sourceProductDraftId: version.source_product_draft_id,
          versionFingerprint: version.version_fingerprint,
          schemaVersion: version.schema_version,
        })),
      });

      const existingResult = await client.query({
        text: `SELECT *
               FROM publish_batches
               WHERE tenant_id=$1 AND store_id=$2 AND idempotency_key=$3
               FOR UPDATE`,
        values: [scope.tenantId, scope.storeId, scope.idempotencyKey],
      });
      let existing = existingResult.rows[0] || null;
      if (existing) {
        if (existing.selection_fingerprint !== selectionFingerprint) {
          throw new Erp06PublishBatchError(
            "SELECTION_FINGERPRINT_CONFLICT",
            "idempotencyKey 已用于另一批次选择，拒绝复用",
            409,
          );
        }
        const itemsResult = await client.query({
          text: `SELECT *
                 FROM publish_batch_items
                 WHERE batch_id=$1 AND tenant_id=$2 AND store_id=$3
                 ORDER BY item_key`,
          values: [existing.id, scope.tenantId, scope.storeId],
        });
        const items = itemsResult.rows || [];
        const existingVersionIds = items.map((item) => item.product_version_id);
        if (
          items.length !== scope.productVersionIds.length ||
          existingVersionIds.some(
            (id, index) => id !== scope.productVersionIds[index],
          )
        ) {
          throw new Erp06PublishBatchError(
            "INCOMPLETE_BATCH",
            "已有批次缺少完整的 ProductVersion/BatchItem 关联，拒绝猜测性补写",
            500,
          );
        }
        return publicBatch({
          idempotent: true,
          batch: existing,
          items,
          selectionFingerprint,
          productVersionIds: scope.productVersionIds,
        });
      }

      const insertedBatch = await client.query({
        text: `INSERT INTO publish_batches
                 (tenant_id, store_id, name, idempotency_key,
                  selection_fingerprint, source, policy_snapshot,
                  created_by, updated_by)
               VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$8)
               ON CONFLICT (tenant_id, store_id, idempotency_key) DO NOTHING
               RETURNING *`,
        values: [
          scope.tenantId,
          scope.storeId,
          scope.name,
          scope.idempotencyKey,
          selectionFingerprint,
          scope.source,
          JSON.stringify(scope.policySnapshot),
          scope.userId,
        ],
      });
      let batch = insertedBatch.rows[0] || null;
      if (!batch) {
        const racedBatchResult = await client.query({
          text: `SELECT *
                 FROM publish_batches
                 WHERE tenant_id=$1 AND store_id=$2 AND idempotency_key=$3
                 FOR UPDATE`,
          values: [scope.tenantId, scope.storeId, scope.idempotencyKey],
        });
        existing = racedBatchResult.rows[0] || null;
        if (!existing) {
          throw new Erp06PublishBatchError(
            "BATCH_INSERT_FAILED",
            "PublishBatch 并发创建未返回可确认的批次，事务已回滚",
            500,
          );
        }
        if (existing.selection_fingerprint !== selectionFingerprint) {
          throw new Erp06PublishBatchError(
            "SELECTION_FINGERPRINT_CONFLICT",
            "idempotencyKey 已用于另一批次选择，拒绝复用",
            409,
          );
        }
        const racedItemsResult = await client.query({
          text: `SELECT *
                 FROM publish_batch_items
                 WHERE batch_id=$1 AND tenant_id=$2 AND store_id=$3
                 ORDER BY item_key`,
          values: [existing.id, scope.tenantId, scope.storeId],
        });
        const racedItems = racedItemsResult.rows || [];
        const racedVersionIds = racedItems.map((item) => item.product_version_id);
        if (
          racedItems.length !== scope.productVersionIds.length
          || racedVersionIds.some((id, index) => id !== scope.productVersionIds[index])
        ) {
          throw new Erp06PublishBatchError(
            "INCOMPLETE_BATCH",
            "并发创建的批次缺少完整的 ProductVersion/BatchItem 关联，拒绝猜测性补写",
            500,
          );
        }
        return publicBatch({
          idempotent: true,
          batch: existing,
          items: racedItems,
          selectionFingerprint,
          productVersionIds: scope.productVersionIds,
        });
      }
      if (!batch) {
        throw new Erp06PublishBatchError(
          "BATCH_INSERT_FAILED",
          "PublishBatch 未生成，事务已回滚",
          500,
        );
      }

      const items = [];
      for (const [index, version] of versions.entries()) {
        const itemResult = await client.query({
          text: `INSERT INTO publish_batch_items
                   (batch_id, product_draft_id, tenant_id, store_id,
                    catalog_product_id, product_version_id, item_key,
                    state, handoff_state)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,'ready','pending')
                 RETURNING *`,
          values: [
            batch.id,
            version.source_product_draft_id,
            scope.tenantId,
            scope.storeId,
            version.catalog_product_id,
            version.id,
            `${String(index + 1).padStart(6, "0")}:${version.id}`,
          ],
        });
        const item = itemResult.rows[0];
        if (!item) {
          throw new Erp06PublishBatchError(
            "BATCH_ITEM_INSERT_FAILED",
            "PublishBatchItem 未生成，事务已回滚",
            500,
          );
        }
        items.push(item);
      }
      return publicBatch({
        idempotent: false,
        batch,
        items,
        selectionFingerprint,
        productVersionIds: scope.productVersionIds,
      });
    });
  }
}
