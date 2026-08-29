import crypto from "node:crypto";

import { collectDraftMediaAssetIds } from "./product-draft-service.js";
import { withTransaction } from "./postgres.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SENSITIVE_KEY_PATTERN =
  /(accesskey|secret|token|password|authorization|signature|privatekey|cookie|credential)/i;

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value ?? "").trim();
}

function integer(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Erp06ProductVersionError(
      "INVALID_VERSION_INPUT",
      `${name} 必须是安全整数`,
    );
  }
  return parsed;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => value[key] !== undefined)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function createErp06Fingerprint(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(value)), "utf8")
    .digest("hex");
}

/**
 * Version snapshots are evidence, not a configuration vault. Sensitive keys
 * are omitted recursively before either persistence or fingerprinting.
 */
export function redactVersionSnapshot(value) {
  if (Array.isArray(value)) return value.map(redactVersionSnapshot);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !SENSITIVE_KEY_PATTERN.test(key.replace(/[_-]/g, "")))
      .map(([key, item]) => [key, redactVersionSnapshot(item)]),
  );
}

export class Erp06ProductVersionError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.name = "Erp06ProductVersionError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function mediaIdFrom(value) {
  const raw = text(value);
  const match = /^media:(.+)$/i.exec(raw);
  return match ? text(match[1]) : raw;
}

function addMediaReference(references, value, role, slot = "", variantRole = "") {
  const assetId = mediaIdFrom(value);
  if (!assetId) return;
  references.push({
    assetId,
    role: text(role) || "draft_media",
    slot: text(slot),
    variantRole: text(variantRole),
  });
}

function collectVersionMediaReferences(data) {
  const source = asObject(data);
  const references = [];

  addMediaReference(references, source.mainAssetId, "main");
  for (const assetId of asArray(source.mainAssetIds)) {
    addMediaReference(references, assetId, "main");
  }
  addMediaReference(
    references,
    asObject(source.skuImageAsset).assetId || asObject(source.skuImageAsset).id,
    "sku",
  );
  for (const assetId of asArray(source.tailAssetIds)) {
    addMediaReference(references, assetId, "tail");
  }

  for (const [role, assets] of Object.entries(asObject(source.imageAssets))) {
    for (const asset of asArray(assets)) {
      addMediaReference(
        references,
        asset?.assetId || asset?.id,
        role,
        asset?.slot || asset?.position,
        asset?.variantRole,
      );
    }
  }

  for (const [index, row] of asArray(source.sizeRows).entries()) {
    addMediaReference(
      references,
      row?.imageAssetId,
      "sku",
      row?.supplierSku || row?.sizeText || `size-${index + 1}`,
    );
  }
  for (const [index, row] of asArray(source.skuRows).entries()) {
    addMediaReference(
      references,
      row?.imageAssetId,
      "sku",
      row?.supplierSku || row?.sizeText || `sku-${index + 1}`,
    );
  }
  for (const photo of asArray(source.compliancePhotoAssignments)) {
    addMediaReference(references, photo?.localAssetRef, "compliance", photo?.slot);
  }

  // Keep the extractor used by the legacy draft path as a safety net. If an
  // old shape contains an asset that the role-aware mapping did not recognize,
  // retain it as a generic reference instead of silently dropping it.
  const knownIds = new Set(references.map((reference) => reference.assetId));
  for (const assetId of collectDraftMediaAssetIds(source)) {
    if (!knownIds.has(assetId)) {
      addMediaReference(references, assetId, "draft_media");
      knownIds.add(assetId);
    }
  }

  const seen = new Set();
  return references.filter((reference) => {
    const key = [
      reference.assetId,
      reference.role,
      reference.slot,
      reference.variantRole,
    ].join("\u001f");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildSkuRows(data) {
  return asArray(asObject(data).skuRows).map((row, index) => {
    const snapshot = redactVersionSnapshot(row || {});
    const stableKey = text(
      row?.stableKey || row?.supplierSku || row?.skuCode,
    );
    if (!stableKey) {
      throw new Erp06ProductVersionError(
        "SKU_STABLE_KEY_REQUIRED",
        `第 ${index + 1} 个 SKU 缺少 supplierSku 或 stableKey，已阻断版本冻结`,
        409,
      );
    }
    return {
      stableKey,
      supplierSku: text(row?.supplierSku || row?.skuCode || stableKey),
      sizeLabel: text(row?.sizeText || row?.sizeLabel),
      snapshot,
    };
  });
}

function buildSnapshots(draft) {
  const draftData = redactVersionSnapshot(
    typeof draft.draft_data === "string"
      ? JSON.parse(draft.draft_data || "{}")
      : asObject(draft.draft_data),
  );
  const preflightSnapshot = redactVersionSnapshot(
    typeof draft.preflight === "string"
      ? JSON.parse(draft.preflight || "{}")
      : asObject(draft.preflight),
  );
  const draftSnapshot = {
    name: text(draft.name),
    categoryId: text(draft.category_id),
    productTypeId: text(draft.product_type_id),
    data: draftData,
  };
  const skuRows = buildSkuRows(draftData);
  const mediaReferences = collectVersionMediaReferences(draftData);
  const templateSnapshot = redactVersionSnapshot(
    draftData.templateSnapshot ||
      draftData.templateSnapshots ||
      draftData.publishTemplateSnapshot ||
      {},
  );
  const templateFingerprint = createErp06Fingerprint(templateSnapshot);
  const preflightFingerprint = createErp06Fingerprint(preflightSnapshot);
  const inputFingerprint = createErp06Fingerprint({
    schemaVersion: text(draft.schema_version),
    revisionNo: integer(draft.revision_no, "revisionNo"),
    draftSnapshot,
    preflightSnapshot,
  });
  const skuSnapshot = { rows: skuRows.map((row) => row.snapshot) };
  const mediaSnapshot = {
    refs: mediaReferences.map((reference, index) => ({
      ...reference,
      sortOrder: index,
    })),
  };
  const productSnapshot = draftSnapshot;
  const versionFingerprint = createErp06Fingerprint({
    schemaVersion: text(draft.schema_version),
    productSnapshot,
    skuSnapshot,
    mediaSnapshot,
    templateFingerprint,
    preflightFingerprint,
  });
  return {
    draftData,
    draftSnapshot,
    preflightSnapshot,
    skuRows,
    mediaReferences,
    skuSnapshot,
    mediaSnapshot,
    templateFingerprint,
    preflightFingerprint,
    inputFingerprint,
    versionFingerprint,
  };
}

function ensureUuid(value, name) {
  const normalized = text(value);
  if (!UUID_PATTERN.test(normalized)) {
    throw new Erp06ProductVersionError(
      "INVALID_VERSION_INPUT",
      `${name} 不是有效 UUID`,
    );
  }
  return normalized;
}

async function loadDraft(client, { tenantId, storeId, draftId }) {
  const result = await client.query({
    text: `SELECT d.*
           FROM product_drafts d
           WHERE d.id=$1 AND d.tenant_id=$2 AND d.store_id=$3
           FOR UPDATE`,
    values: [draftId, tenantId, storeId],
  });
  const draft = result.rows[0] || null;
  if (!draft) {
    throw new Erp06ProductVersionError(
      "DRAFT_NOT_FOUND",
      "商品草稿不存在或不属于当前租户/店铺",
      404,
    );
  }
  return draft;
}

async function loadCatalogProduct(client, { tenantId, storeId, catalogProductId }) {
  const result = await client.query({
    text: `SELECT *
           FROM catalog_products
           WHERE id=$1 AND tenant_id=$2 AND store_id=$3
           FOR UPDATE`,
    values: [catalogProductId, tenantId, storeId],
  });
  const product = result.rows[0] || null;
  if (!product) {
    throw new Erp06ProductVersionError(
      "CATALOG_PRODUCT_NOT_FOUND",
      "草稿关联的 CatalogProduct 不存在或不属于当前租户/店铺",
      409,
    );
  }
  return product;
}

async function loadVerifiedMedia(client, { tenantId, storeId, references }) {
  if (!references.length) return new Map();
  const ids = Array.from(new Set(references.map((reference) => reference.assetId)));
  for (const assetId of ids) ensureUuid(assetId, "媒体 assetId");
  const result = await client.query({
    text: `SELECT id, tenant_id, store_id, status, integrity_state,
                  verified_size_bytes, verified_sha256
           FROM media_assets
           WHERE tenant_id=$1 AND store_id=$2 AND id=ANY($3::uuid[])
           FOR SHARE`,
    values: [tenantId, storeId, ids],
  });
  const assets = new Map(result.rows.map((row) => [String(row.id), row]));
  for (const reference of references) {
    const asset = assets.get(reference.assetId);
    if (
      !asset ||
      asset.tenant_id !== tenantId ||
      asset.store_id !== storeId ||
      asset.integrity_state !== "verified" ||
      !["ready", "referenced"].includes(asset.status) ||
      !text(asset.verified_sha256) ||
      asset.verified_size_bytes === null ||
      asset.verified_size_bytes === undefined
    ) {
      throw new Erp06ProductVersionError(
        "MEDIA_NOT_VERIFIED",
        `媒体 ${reference.assetId} 未通过 COS 完整性核验，已阻断版本冻结`,
        409,
        { assetId: reference.assetId },
      );
    }
  }
  return assets;
}

async function loadExistingRevision(client, { tenantId, storeId, draftId, revisionNo }) {
  const result = await client.query({
    text: `SELECT *
           FROM draft_revisions
           WHERE tenant_id=$1 AND store_id=$2
             AND product_draft_id=$3 AND revision_no=$4`,
    values: [tenantId, storeId, draftId, revisionNo],
  });
  return result.rows[0] || null;
}

async function loadVersionByRevision(client, { tenantId, storeId, revisionId }) {
  const result = await client.query({
    text: `SELECT *
           FROM product_versions
           WHERE tenant_id=$1 AND store_id=$2
             AND source_draft_revision_id=$3`,
    values: [tenantId, storeId, revisionId],
  });
  return result.rows[0] || null;
}

async function loadFingerprintCollision(client, { tenantId, storeId, versionFingerprint }) {
  const result = await client.query({
    text: `SELECT *
           FROM product_versions
           WHERE tenant_id=$1 AND store_id=$2 AND version_fingerprint=$3`,
    values: [tenantId, storeId, versionFingerprint],
  });
  return result.rows[0] || null;
}

async function getOrCreateCatalogSkus(
  client,
  { tenantId, storeId, catalogProductId, skuRows },
) {
  const result = [];
  for (const [sortOrder, sku] of skuRows.entries()) {
    const inserted = await client.query({
      text: `INSERT INTO catalog_skus
               (tenant_id, store_id, catalog_product_id, stable_key,
                supplier_sku, size_label)
             VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT (tenant_id, store_id, stable_key)
             DO NOTHING
             RETURNING *`,
      values: [
        tenantId,
        storeId,
        catalogProductId,
        sku.stableKey,
        sku.supplierSku,
        sku.sizeLabel,
      ],
    });
    let row = inserted.rows[0] || null;
    let created = Boolean(row);
    if (!row) {
      const existing = await client.query({
        text: `SELECT *
               FROM catalog_skus
               WHERE tenant_id=$1 AND store_id=$2 AND stable_key=$3`,
        values: [tenantId, storeId, sku.stableKey],
      });
      row = existing.rows[0] || null;
    }
    if (!row || row.catalog_product_id !== catalogProductId) {
      throw new Erp06ProductVersionError(
        "CATALOG_SKU_COLLISION",
        `SKU ${sku.stableKey} 已属于其他 CatalogProduct，已阻断自动合并`,
        409,
        { stableKey: sku.stableKey },
      );
    }
    result.push({
      row,
      created,
      sortOrder,
      snapshot: sku.snapshot,
      fingerprint: createErp06Fingerprint({
        catalogSkuId: row.id,
        snapshot: sku.snapshot,
      }),
    });
  }
  return result;
}

async function insertEvent(
  client,
  {
    tenantId,
    storeId,
    aggregateType,
    aggregateId,
    eventType,
    eventVersion = 1,
    dedupeKey,
    payload,
    actorId,
  },
) {
  const safePayload = redactVersionSnapshot(payload || {});
  await client.query({
    text: `INSERT INTO product_events
             (tenant_id, store_id, aggregate_type, aggregate_id,
              event_type, schema_version, event_version, occurred_at,
              producer, dedupe_key, payload, payload_sha256, actor_id)
           VALUES ($1,$2,$3,$4,$5,'erp06.v1',$6,now(),
                   'erp06-product-version-service',$7,$8::jsonb,$9,$10)`,
    values: [
      tenantId,
      storeId,
      aggregateType,
      aggregateId,
      eventType,
      eventVersion,
      dedupeKey,
      JSON.stringify(safePayload),
      createErp06Fingerprint(safePayload),
      actorId || null,
    ],
  });
}

function publicVersionResult({
  idempotent,
  catalogProductId,
  revision,
  version,
  versionSkuRows,
  versionMediaRows,
}) {
  return {
    idempotent,
    stage: "frozen_not_handed_off",
    catalogProductId,
    draftRevisionId: revision.id,
    revisionNo: revision.revision_no,
    productVersionId: version.id,
    versionNo: version.version_no,
    versionFingerprint: version.version_fingerprint,
    inputFingerprint: revision.input_fingerprint,
    skuCount: versionSkuRows.length,
    mediaCount: versionMediaRows.length,
    publishAttemptCreated: false,
    queueDeliveryCreated: false,
  };
}

export class PostgresErp06ProductVersionRepository {
  constructor({ pool } = {}) {
    if (!pool) throw new Error("PostgresErp06ProductVersionRepository 缺少 pool");
    this.pool = pool;
  }

  /**
   * Freeze an explicit draft revision into an immutable ProductVersion.
   *
   * This is deliberately not the ERP-09 publish handoff: it does not change
   * ProductDraft editing status, create a PublishAttempt, create a Command,
   * enqueue an Outbox record, or call any remote platform.
   */
  async freezeDraftVersion({
    tenantId,
    storeId,
    draftId,
    expectedLockVersion,
    userId = null,
  } = {}) {
    const scope = {
      tenantId: ensureUuid(tenantId, "tenantId"),
      storeId: ensureUuid(storeId, "storeId"),
      draftId: ensureUuid(draftId, "draftId"),
      userId: userId ? ensureUuid(userId, "userId") : null,
    };
    if (expectedLockVersion === undefined || expectedLockVersion === null) {
      throw new Erp06ProductVersionError(
        "EXPECTED_LOCK_VERSION_REQUIRED",
        "版本冻结必须携带期望的 draft lockVersion",
        400,
      );
    }
    const expectedLock = integer(expectedLockVersion, "expectedLockVersion");

    return withTransaction(this.pool, async (client) => {
      const draft = await loadDraft(client, scope);
      const currentLock = integer(draft.lock_version, "draft.lock_version");
      if (currentLock !== expectedLock) {
        throw new Erp06ProductVersionError(
          "DRAFT_VERSION_CONFLICT",
          "商品草稿已被其他操作修改，请重新加载后再冻结版本",
          409,
          { expectedLockVersion: expectedLock, currentLockVersion: currentLock },
        );
      }
      if (
        ["archived", "published"].includes(text(draft.status)) ||
        !["editing", "blocked", "ready"].includes(text(draft.editing_status))
      ) {
        throw new Erp06ProductVersionError(
          "DRAFT_NOT_FREEZABLE",
          "当前草稿状态不允许进入 ERP-06 版本冻结阶段",
          409,
        );
      }

      const catalogProductId = ensureUuid(
        draft.catalog_product_id,
        "draft.catalog_product_id",
      );
      await loadCatalogProduct(client, {
        ...scope,
        catalogProductId,
      });

      const snapshots = buildSnapshots(draft);
      const mediaAssets = await loadVerifiedMedia(client, {
        ...scope,
        references: snapshots.mediaReferences,
      });
      const revisionNo = integer(draft.revision_no, "draft.revision_no");
      const existingRevision = await loadExistingRevision(client, {
        ...scope,
        revisionNo,
      });
      if (existingRevision) {
        if (existingRevision.input_fingerprint !== snapshots.inputFingerprint) {
          throw new Erp06ProductVersionError(
            "DRAFT_REVISION_ALREADY_FROZEN",
            "同一草稿修订号已经对应另一份不可变快照，拒绝覆盖",
            409,
          );
        }
        const existingVersion = await loadVersionByRevision(client, {
          ...scope,
          revisionId: existingRevision.id,
        });
        if (!existingVersion) {
          throw new Erp06ProductVersionError(
            "INCOMPLETE_VERSION_FACT",
            "发现没有对应 ProductVersion 的 DraftRevision，已阻断继续写入",
            500,
          );
        }
        if (existingVersion.version_fingerprint !== snapshots.versionFingerprint) {
          throw new Erp06ProductVersionError(
            "VERSION_FINGERPRINT_MISMATCH",
            "已有 ProductVersion 指纹与当前快照不一致，已阻断幂等返回",
            409,
          );
        }
        return publicVersionResult({
          idempotent: true,
          catalogProductId,
          revision: existingRevision,
          version: existingVersion,
          versionSkuRows: [],
          versionMediaRows: [],
        });
      }

      const collision = await loadFingerprintCollision(client, {
        ...scope,
        versionFingerprint: snapshots.versionFingerprint,
      });
      if (collision) {
        throw new Erp06ProductVersionError(
          "VERSION_FINGERPRINT_COLLISION",
          "版本指纹已属于其他版本，拒绝跨商品静默复用",
          409,
          { productVersionId: collision.id },
        );
      }

      const catalogSkus = await getOrCreateCatalogSkus(client, {
        ...scope,
        catalogProductId,
        skuRows: snapshots.skuRows,
      });
      const revision = (
        await client.query({
          text: `INSERT INTO draft_revisions
                   (tenant_id, store_id, product_draft_id, catalog_product_id,
                    revision_no, schema_version, input_fingerprint,
                    draft_snapshot, preflight_snapshot, created_by)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10)
                 RETURNING *`,
          values: [
            scope.tenantId,
            scope.storeId,
            scope.draftId,
            catalogProductId,
            revisionNo,
            text(draft.schema_version),
            snapshots.inputFingerprint,
            JSON.stringify(snapshots.draftSnapshot),
            JSON.stringify(snapshots.preflightSnapshot),
            scope.userId,
          ],
        })
      ).rows[0];
      if (!revision) {
        throw new Erp06ProductVersionError(
          "REVISION_INSERT_FAILED",
          "DraftRevision 未生成，事务已回滚",
          500,
        );
      }

      const versionNoResult = await client.query({
        text: `SELECT COALESCE(MAX(version_no),0)+1 AS version_no
               FROM product_versions
               WHERE tenant_id=$1 AND store_id=$2 AND catalog_product_id=$3`,
        values: [scope.tenantId, scope.storeId, catalogProductId],
      });
      const versionNo = integer(versionNoResult.rows[0]?.version_no, "versionNo");
      const version = (
        await client.query({
          text: `INSERT INTO product_versions
                   (tenant_id, store_id, catalog_product_id,
                    source_draft_revision_id, version_no, schema_version,
                    version_fingerprint, template_fingerprint,
                    preflight_fingerprint, product_snapshot, sku_snapshot,
                    media_snapshot, created_by)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,
                         $12::jsonb,$13)
                 RETURNING *`,
          values: [
            scope.tenantId,
            scope.storeId,
            catalogProductId,
            revision.id,
            versionNo,
            text(draft.schema_version),
            snapshots.versionFingerprint,
            snapshots.templateFingerprint,
            snapshots.preflightFingerprint,
            JSON.stringify(snapshots.draftSnapshot),
            JSON.stringify(snapshots.skuSnapshot),
            JSON.stringify(snapshots.mediaSnapshot),
            scope.userId,
          ],
        })
      ).rows[0];
      if (!version) {
        throw new Erp06ProductVersionError(
          "VERSION_INSERT_FAILED",
          "ProductVersion 未生成，事务已回滚",
          500,
        );
      }

      const versionSkuRows = [];
      for (const catalogSku of catalogSkus) {
        const inserted = await client.query({
          text: `INSERT INTO product_version_skus
                   (tenant_id, store_id, product_version_id, catalog_sku_id,
                    sku_snapshot, sku_fingerprint, sort_order)
                 VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)
                 RETURNING *`,
          values: [
            scope.tenantId,
            scope.storeId,
            version.id,
            catalogSku.row.id,
            JSON.stringify(catalogSku.snapshot),
            catalogSku.fingerprint,
            catalogSku.sortOrder,
          ],
        });
        const versionSku = inserted.rows[0];
        if (!versionSku) {
          throw new Erp06ProductVersionError(
            "VERSION_SKU_INSERT_FAILED",
            "ProductVersionSku 未生成，事务已回滚",
            500,
          );
        }
        versionSkuRows.push(versionSku);
      }

      const versionMediaRows = [];
      for (const [sortOrder, reference] of snapshots.mediaReferences.entries()) {
        const asset = mediaAssets.get(reference.assetId);
        const contentSha256 = text(asset.verified_sha256);
        const contentSizeBytes = String(asset.verified_size_bytes);
        const sourceFingerprint = createErp06Fingerprint({
          assetId: reference.assetId,
          role: reference.role,
          slot: reference.slot,
          variantRole: reference.variantRole,
          contentSha256,
          contentSizeBytes,
        });
        const inserted = await client.query({
          text: `INSERT INTO product_version_media
                   (tenant_id, store_id, product_version_id, asset_id, role,
                    slot, sort_order, variant_role, content_sha256,
                    content_size_bytes, source_fingerprint)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
                 RETURNING *`,
          values: [
            scope.tenantId,
            scope.storeId,
            version.id,
            reference.assetId,
            reference.role,
            reference.slot,
            sortOrder,
            reference.variantRole,
            contentSha256,
            contentSizeBytes,
            sourceFingerprint,
          ],
        });
        const versionMedia = inserted.rows[0];
        if (!versionMedia) {
          throw new Erp06ProductVersionError(
            "VERSION_MEDIA_INSERT_FAILED",
            "ProductVersionMedia 未生成，事务已回滚",
            500,
          );
        }
        versionMediaRows.push(versionMedia);
      }

      for (const catalogSku of catalogSkus.filter((item) => item.created)) {
        await insertEvent(client, {
          ...scope,
          aggregateType: "catalog_sku",
          aggregateId: catalogSku.row.id,
          eventType: "catalog_sku_created",
          dedupeKey: `erp06:catalog-sku-created:${catalogSku.row.id}`,
          payload: {
            catalogProductId,
            catalogSkuId: catalogSku.row.id,
            stableKey: catalogSku.row.stable_key,
          },
        });
      }
      await insertEvent(client, {
        ...scope,
        aggregateType: "draft_revision",
        aggregateId: revision.id,
        eventType: "draft_revision_created",
        dedupeKey: `erp06:draft-revision-created:${revision.id}`,
        payload: {
          draftId: scope.draftId,
          catalogProductId,
          revisionNo,
          inputFingerprint: snapshots.inputFingerprint,
        },
      });
      await insertEvent(client, {
        ...scope,
        aggregateType: "product_version",
        aggregateId: version.id,
        eventType: "product_version_created",
        dedupeKey: `erp06:product-version-created:${version.id}`,
        payload: {
          catalogProductId,
          draftRevisionId: revision.id,
          versionNo,
          versionFingerprint: snapshots.versionFingerprint,
        },
      });
      for (const versionMedia of versionMediaRows) {
        await insertEvent(client, {
          ...scope,
          aggregateType: "product_version_media",
          aggregateId: versionMedia.id,
          eventType: "version_media_attached",
          dedupeKey: `erp06:version-media-attached:${versionMedia.id}`,
          payload: {
            productVersionId: version.id,
            assetId: versionMedia.asset_id,
            role: versionMedia.role,
            sortOrder: versionMedia.sort_order,
          },
        });
      }

      return publicVersionResult({
        idempotent: false,
        catalogProductId,
        revision,
        version,
        versionSkuRows,
        versionMediaRows,
      });
    });
  }
}
