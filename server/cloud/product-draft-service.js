import { withTransaction } from "./postgres.js";
import {
  buildSkuPublishPreview,
  applyPackagingTemplate,
  validateSkuStage,
} from "../../src-v2/lib/product-sku-contract.js";
import { buildProductImageStage } from "../../src-v2/lib/product-image-contract.js";
import { buildProductContentStage } from "../../src-v2/lib/product-content-contract.js";
import { buildProductComplianceStage } from "../../src-v2/lib/product-compliance-contract.js";
import { buildProductPublishSettingsStage } from "../../src-v2/lib/product-publish-settings-contract.js";
import {
  buildAssociatedAttributeRuleRequest,
  buildProductAttributePreflight,
  buildProductPublishCandidate,
} from "./product-publish-candidate.js";
import {
  buildWorkspaceQuotaProjection,
  canAddDraft,
} from "./workspace-quota.js";

export class ProductDraftError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "ProductDraftError";
    this.code = code;
    this.status = status;
  }
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function configRequired(config) {
  const value = asObject(config).is_required;
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "required", "是"].includes(
    String(value ?? "").trim().toLowerCase(),
  );
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function collectDraftMediaAssetIds(data = {}) {
  const source = asObject(data);
  const ids = new Set();
  const add = (value) => {
    const id = String(value || "").trim();
    if (id) ids.add(id);
  };
  const addMediaRef = (value) => {
    const match = /^media:([^\s]+)$/i.exec(String(value || "").trim());
    if (match) add(match[1]);
  };
  add(source.mainAssetId);
  add(asObject(source.skuImageAsset).id);
  for (const assetId of Array.isArray(source.mainAssetIds)
    ? source.mainAssetIds
    : []) {
    add(assetId);
  }
  for (const assetId of Array.isArray(source.tailAssetIds)
    ? source.tailAssetIds
    : []) {
    add(assetId);
  }
  for (const row of Array.isArray(source.sizeRows) ? source.sizeRows : []) {
    add(row?.imageAssetId);
  }
  for (const row of Array.isArray(source.skuRows) ? source.skuRows : []) {
    add(row?.imageAssetId);
  }
  for (const asset of Array.isArray(source.skuPreviewImages)
    ? source.skuPreviewImages
    : []) {
    add(asset?.assetId || asset?.id);
  }
  for (const assets of Object.values(asObject(source.imageAssets))) {
    for (const asset of Array.isArray(assets) ? assets : []) {
      add(asset?.assetId || asset?.id);
    }
  }
  const complianceDefaults = asObject(
    asObject(asObject(source.complianceTemplateSnapshot).data).defaults,
  );
  const reportTemplateData = asObject(
    asObject(source.reportTemplateSnapshot).data,
  );
  for (const photo of Array.isArray(complianceDefaults.photos)
    ? complianceDefaults.photos
    : []) {
    if (["1", "2"].includes(String(photo?.labelGroup || ""))) {
      addMediaRef(photo?.localAssetRef);
    }
  }
  for (const photo of Array.isArray(source.compliancePhotoAssignments)
    ? source.compliancePhotoAssignments
    : []) {
    if (["1", "2"].includes(String(photo?.labelGroup || ""))) {
      addMediaRef(photo?.localAssetRef);
    }
  }
  addMediaRef(asObject(reportTemplateData.reportFile).localAssetRef);
  return Array.from(ids);
}

export function buildRugReportDraftPreflight(data = {}, preflight = {}) {
  return {
    ...asObject(preflight),
    rugReport: {
      reportType: null,
      longestEdgeCm: null,
      areaM2: null,
      evidence: [],
      blockers: [],
      source: "shein_compliance_requirement",
      schemaFetchedAt: "",
      requiresSkcReadback: true,
    },
  };
}

export function buildProductComplianceDraftPreflight(
  data = {},
  preflight = {},
  { categoryId = "", storeId = "", now = new Date() } = {},
) {
  const source = asObject(data);
  const snapshot = asObject(source.complianceTemplateSnapshot);
  const manualPhotoMode = source.compliancePhotoSourceMode === "manual";
  const selectedId = manualPhotoMode
    ? ""
    : String(source.complianceTemplateId || "").trim();
  const blockers = [];
  const advisories = [];
  if (selectedId && selectedId !== String(snapshot.id || "").trim()) {
    advisories.push({
      code: "COMPLIANCE_TEMPLATE_ID_MISMATCH",
      message: "合规模板ID与草稿快照不一致",
    });
  }
  if (
    selectedId &&
    storeId &&
    String(snapshot.storeId || "").trim() !== String(storeId).trim()
  ) {
    advisories.push({
      code: "COMPLIANCE_TEMPLATE_STORE_MISMATCH",
      message: "合规模板不属于当前店铺",
    });
  }
  const trustedTemplate = selectedId && advisories.length === 0 ? snapshot : null;
  const stage = buildProductComplianceStage({
    template: trustedTemplate,
    categoryId,
    photoSourceMode: manualPhotoMode ? "manual" : "template",
    manualPhotos: Array.isArray(source.compliancePhotoAssignments)
      ? source.compliancePhotoAssignments
      : [],
    now,
  });
  return {
    ...asObject(preflight),
    compliance: {
      checkedAt: String(asObject(snapshot.data).ruleFetchedAt || ""),
      templateId: selectedId,
      reportTemplateId: "",
      blockers,
      advisories: [...advisories, ...(stage.advisories || [])],
      postPublishTasks: stage.postPublishTasks,
      expectedReport: stage.expectedReport,
      assetIds: stage.assetIds,
      postPublishPhotos: {
        package: (Array.isArray(stage.photos?.packageList)
          ? stage.photos.packageList
          : stage.photos?.package
            ? [stage.photos.package]
            : [])
          .map((photo) => ({
            assetId: String(photo?.localAssetRef || "").replace(/^media:/i, ""),
            name: String(photo?.fileName || photo?.name || ""),
          }))
          .filter((photo) => photo.assetId),
        body: (Array.isArray(stage.photos?.bodyList)
          ? stage.photos.bodyList
          : stage.photos?.body
            ? [stage.photos.body]
            : [])
          .map((photo) => ({
            assetId: String(photo?.localAssetRef || "").replace(/^media:/i, ""),
            name: String(photo?.fileName || photo?.name || ""),
          }))
          .filter((photo) => photo.assetId),
      },
      manualQueue: stage.manualQueue,
      requiresSkcRevalidation: true,
    },
  };
}

export function buildProductPublishSettingsDraftPreflight(
  data = {},
  preflight = {},
  { businessMode = "full" } = {},
) {
  const source = asObject(data);
  const publishStandard = asObject(source.publishStandardSnapshot);
  const stage = buildProductPublishSettingsStage({
    businessMode,
    settings: asObject(source.publishSettings),
    fillInStandard: Array.isArray(publishStandard.fillInStandard)
      ? publishStandard.fillInStandard
      : [],
  });
  return {
    ...asObject(preflight),
    publishSettings: {
      checkedAt: String(publishStandard.fetchedAt || ""),
      businessMode: "full",
      blockers: stage.blockers,
      payload: stage.payload,
    },
  };
}

export function buildProductAttributeDraftPreflight(
  data = {},
  preflight = {},
  options = {},
) {
  return {
    ...asObject(preflight),
    attributes: buildProductAttributePreflight({
      data,
      categoryId: String(options.categoryId || ""),
      productTypeId: String(options.productTypeId || ""),
      associatedRuleResult: options.associatedRuleResult || null,
      associatedRuleError: String(options.associatedRuleError || ""),
    }),
  };
}

export function buildProductPublishCandidateDraftPreflight(
  data = {},
  preflight = {},
  options = {},
) {
  return {
    ...asObject(preflight),
    publishCandidate: buildProductPublishCandidate({
      data,
      categoryId: String(options.categoryId || ""),
      productTypeId: String(options.productTypeId || ""),
      preflight,
      generatedAt: options.generatedAt,
    }),
  };
}

export function buildSkuDraftPreflight(data = {}, preflight = {}) {
  const source = asObject(data);
  const schema = asObject(source.salesSchemaSnapshot);
  const publishStandard = asObject(source.publishStandardSnapshot);
  const blockers = [];
  if (
    !String(schema.fetchedAt || "").trim() ||
    !Array.isArray(schema.fields) ||
    !schema.fields.length
  ) {
    blockers.push({
      code: "SALE_SCHEMA_SNAPSHOT_MISSING",
      message: "缺少当前类目的SHEIN销售属性快照，无法校验颜色和尺寸",
    });
  }
  if (!String(publishStandard.fetchedAt || "").trim()) {
    blockers.push({
      code: "PUBLISH_STANDARD_SNAPSHOT_MISSING",
      message: "缺少当前类目的SHEIN发布规范快照，无法校验供货价、库存和重量",
    });
  }
  const currency = String(source.currency || "").trim();
  const snapshotCurrency = String(publishStandard.currency || "").trim();
  if (currency && snapshotCurrency && currency !== snapshotCurrency) {
    blockers.push({
      code: "SKU_COST_CURRENCY_INVALID",
      message: "草稿供货价币种与当前SHEIN发布规范快照不一致",
    });
  }
  const result = validateSkuStage({
    saleSchema: {
      mainAttributeStatus: Number(schema.mainAttributeStatus || 0),
      fields: Array.isArray(schema.fields) ? schema.fields : [],
      sizeFields: Array.isArray(schema.sizeFields) ? schema.sizeFields : [],
    },
    supplierCode: String(source.supplierCode || ""),
    sizeTemplateId: String(source.sizeTemplateId || ""),
    colorMapping: asObject(source.colorSaleValue),
    rows: Array.isArray(source.skuRows) ? source.skuRows : [],
    packagingTemplateId: String(source.packagingTemplateId || ""),
    packagingMaterial: String(source.packagingMaterial || ""),
    currency: currency === snapshotCurrency ? currency : "",
    weightRequired: configRequired(publishStandard.weightConfig),
  });
  const publishPreview = buildSkuPublishPreview({
    supplierCode: String(source.supplierCode || ""),
    colorMapping: asObject(source.colorSaleValue),
    rows: Array.isArray(source.skuRows) ? source.skuRows : [],
    sizeAttributeFields: Array.isArray(schema.sizeFields) ? schema.sizeFields : [],
    currency: currency === snapshotCurrency ? currency : "",
    skuSettings: asObject(
      asObject(asObject(preflight).publishSettings).payload,
    ).sku,
    weightConfig: publishStandard.weightConfig || null,
    dimensionConfig: publishStandard.dimensionConfig || null,
  });
  if (result.valid && publishPreview.blockers.length) {
    blockers.push({
      code: "SKU_PUBLISH_PREVIEW_INVALID",
      message: publishPreview.blockers[0],
    });
  }
  return {
    ...asObject(preflight),
    sku: {
      checkedAt: String(schema.fetchedAt || ""),
      blockers: [...blockers, ...result.blockers],
      publishPreview: {
        skc: publishPreview.skc,
        size_attribute_list: publishPreview.size_attribute_list,
        pendingImageUploads: publishPreview.pendingImageUploads,
      },
    },
  };
}

export function buildProductImageDraftPreflight(data = {}, preflight = {}) {
  const source = asObject(data);
  const publishStandard = asObject(source.publishStandardSnapshot);
  const imageAssets = asObject(source.imageAssets);
  const mainImages = Array.isArray(imageAssets.main) ? imageAssets.main : [];
  const detailImages = Array.isArray(imageAssets.detail) ? imageAssets.detail : [];
  const squareImages = Array.isArray(imageAssets.square) ? imageAssets.square : [];
  const swatchImages = Array.isArray(imageAssets.swatch) ? imageAssets.swatch : [];
  const descriptionImages = Array.isArray(imageAssets.description)
    ? imageAssets.description
    : [];
  const tailImages = Array.isArray(imageAssets.tail) ? imageAssets.tail : [];
  const tailImageTemplateId = String(source.tailImageTemplateId || "").trim();
  const blockers = [];

  if (
    !String(publishStandard.fetchedAt || "").trim() ||
    !Object.prototype.hasOwnProperty.call(publishStandard, "pictureConfig") ||
    !Array.isArray(publishStandard.pictureConfig)
  ) {
    blockers.push({
      code: "PICTURE_CONFIG_SNAPSHOT_MISSING",
      message: "缺少当前类目的SHEIN图片规则快照，无法校验SPU/SKC图片方案",
    });
  }
  if (
    !Object.prototype.hasOwnProperty.call(publishStandard, "fillInStandard") ||
    !Array.isArray(publishStandard.fillInStandard)
  ) {
    blockers.push({
      code: "FILL_STANDARD_SNAPSHOT_MISSING",
      message: "缺少当前类目的SHEIN动态填写规范快照，无法校验站点详情图",
    });
  }
  if (tailImageTemplateId && !tailImages.length) {
    blockers.push({
      code: "TAIL_IMAGE_TEMPLATE_ASSETS_MISSING",
      message: "已引用尾部主图模板，但草稿中缺少模板图片快照",
    });
  }

  const tailTemplate = tailImageTemplateId
    ? {
        id: tailImageTemplateId,
        name: "草稿尾部主图模板",
        data: {
          placement: source.tailImagePlacement,
          assetIds: tailImages.map((asset) => String(asset?.assetId || asset?.id || "")),
          assets: tailImages,
        },
      }
    : null;
  const stage = buildProductImageStage({
    mainImages,
    detailImages,
    squareImages,
    swatchImages,
    descriptionImages,
    tailTemplate,
    pictureConfig: Array.isArray(publishStandard.pictureConfig)
      ? publishStandard.pictureConfig
      : [],
    fillInStandard: Array.isArray(publishStandard.fillInStandard)
      ? publishStandard.fillInStandard
      : [],
  });

  return {
    ...asObject(preflight),
    images: {
      checkedAt: String(publishStandard.fetchedAt || ""),
      scheme: stage.scheme,
      blockers: [...blockers, ...stage.blockers],
      uploads: stage.uploads.map((upload) => ({
        localId: upload.localId,
        name: upload.name,
        source: upload.source,
        templateId: upload.templateId,
        targetLevel: upload.targetLevel,
        imageType: upload.imageType,
        imageSort: upload.imageSort,
        slot: upload.slot,
        status: upload.status,
      })),
    },
  };
}

export function buildProductContentDraftPreflight(data = {}, preflight = {}) {
  const source = asObject(data);
  const publishStandard = asObject(source.publishStandardSnapshot);
  const hasSnapshot = Boolean(String(publishStandard.fetchedAt || "").trim());
  const stage = buildProductContentStage({
    title: source.title,
    description: source.description,
    defaultLanguage: publishStandard.defaultLanguage,
    titleMaxLength: publishStandard.titleMaxLength,
  });
  const blockers = hasSnapshot
    ? stage.blockers
    : [
        {
          code: "CONTENT_STANDARD_SNAPSHOT_MISSING",
          message: "缺少当前类目的SHEIN默认语种和标题长度快照",
        },
        ...stage.blockers.filter(
          (item) => item.code !== "DEFAULT_LANGUAGE_MISSING",
        ),
      ];
  return {
    ...asObject(preflight),
    content: {
      checkedAt: String(publishStandard.fetchedAt || ""),
      blockers,
      defaultLanguage: stage.defaultLanguage,
      titleMaxLength: stage.titleMaxLength,
      publishPreview: {
        multi_language_name_list: stage.multiLanguageNameList,
        multi_language_desc_list: stage.multiLanguageDescList,
      },
    },
  };
}

function publicDraft(row) {
  return {
    id: row.id,
    storeId: row.store_id,
    name: row.name,
    categoryId: row.category_id,
    productTypeId: row.product_type_id,
    data: row.draft_data || {},
    preflight: row.preflight || {},
    status: row.status,
    updatedAt: row.updated_at,
  };
}

export class PostgresProductDraftRepository {
  constructor({ pool } = {}) {
    if (!pool) throw new Error("PostgresProductDraftRepository 缺少 pool");
    this.pool = pool;
  }

  async list({ tenantId, storeId, includePublishHistory = false }) {
    const draftBoxFilter = includePublishHistory
      ? ""
      : `AND NOT EXISTS (
               SELECT 1
               FROM publish_jobs
               WHERE publish_jobs.tenant_id=product_drafts.tenant_id
                 AND publish_jobs.store_id=product_drafts.store_id
                 AND publish_jobs.product_draft_id=product_drafts.id
             )`;
    const result = await this.pool.query({
      text: `SELECT * FROM product_drafts
             WHERE tenant_id=$1 AND store_id=$2 AND status <> 'archived'
             ${draftBoxFilter}
             ORDER BY updated_at DESC LIMIT 100`,
      values: [tenantId, storeId],
    });
    return result.rows;
  }

  async usage({ tenantId, storeId }) {
    const result = await this.pool.query({
      text: `
        SELECT
          COUNT(*) FILTER (
            WHERE store_id=$2
              AND status NOT IN ('archived', 'published')
              AND NOT EXISTS (
                SELECT 1
                FROM publish_jobs
                WHERE publish_jobs.tenant_id=product_drafts.tenant_id
                  AND publish_jobs.store_id=product_drafts.store_id
                  AND publish_jobs.product_draft_id=product_drafts.id
              )
          )::int AS store_draft_count,
          COUNT(*) FILTER (
            WHERE status NOT IN ('archived', 'published')
              AND NOT EXISTS (
                SELECT 1
                FROM publish_jobs
                WHERE publish_jobs.tenant_id=product_drafts.tenant_id
                  AND publish_jobs.store_id=product_drafts.store_id
                  AND publish_jobs.product_draft_id=product_drafts.id
              )
          )::int AS tenant_draft_count
        FROM product_drafts
        WHERE tenant_id=$1
      `,
      values: [tenantId, storeId],
    });
    return result.rows[0] || {};
  }

  async save(input) {
    return withTransaction(this.pool, async (client) => {
      const result = await client.query({
        text: `INSERT INTO product_drafts (
                 id, tenant_id, store_id, name, category_id, product_type_id,
                 draft_data, preflight, status, created_by, updated_by
               )
               VALUES (
                 COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6,
                 $7::jsonb, $8::jsonb, $9, $10, $10
               )
               ON CONFLICT (id) DO UPDATE SET
                 name=EXCLUDED.name, category_id=EXCLUDED.category_id,
                 product_type_id=EXCLUDED.product_type_id,
                 draft_data=EXCLUDED.draft_data, preflight=EXCLUDED.preflight,
                 status=EXCLUDED.status, updated_by=EXCLUDED.updated_by,
                 updated_at=now()
               WHERE product_drafts.tenant_id=EXCLUDED.tenant_id
                 AND product_drafts.store_id=EXCLUDED.store_id
                 AND product_drafts.status <> 'published'
               RETURNING *`,
        values: [
          input.id,
          input.tenantId,
          input.storeId,
          input.name,
          input.categoryId,
          input.productTypeId,
          JSON.stringify(input.data),
          JSON.stringify(input.preflight),
          input.status,
          input.userId,
        ],
      });
      const row = result.rows[0] || null;
      if (!row) return null;

      const previousResult = await client.query({
        text: `SELECT asset_id
               FROM media_asset_references
               WHERE tenant_id=$1
                 AND store_id=$2
                 AND reference_type='product_draft'
                 AND reference_key=$3`,
        values: [input.tenantId, input.storeId, String(row.id)],
      });
      const previousIds = previousResult.rows.map((item) => item.asset_id);
      const mediaAssetIds = Array.from(
        new Set((input.mediaAssetIds || []).map(String)),
      );
      const requestedTailTemplateId = String(
        asObject(input.data).tailImageTemplateId || "",
      ).trim();
      const tailTemplateId = UUID_PATTERN.test(requestedTailTemplateId)
        ? requestedTailTemplateId
        : null;

      if (mediaAssetIds.some((id) => !UUID_PATTERN.test(id))) {
        throw new ProductDraftError(
          "INVALID_DRAFT_MEDIA",
          "商品草稿包含无效的对象存储素材ID",
        );
      }

      await client.query({
        text: `DELETE FROM media_asset_references
               WHERE tenant_id=$1
                 AND store_id=$2
                 AND reference_type='product_draft'
                 AND reference_key=$3`,
        values: [input.tenantId, input.storeId, String(row.id)],
      });

      if (mediaAssetIds.length) {
        const inserted = await client.query({
          text: `INSERT INTO media_asset_references (
                   asset_id, tenant_id, store_id, reference_type, reference_key
                 )
                 SELECT m.id, $2, $3, 'product_draft', $4
                 FROM media_assets m
                 WHERE m.id = ANY($1::uuid[])
                   AND m.tenant_id=$2
                   AND m.status <> 'deleted'
                   AND (
                     m.store_id=$3
                     OR EXISTS (
                       SELECT 1
                       FROM publish_templates template
                       WHERE template.id=$5::uuid
                         AND template.tenant_id=$2
                         AND template.template_type='tail_image'
                         AND template.store_id=m.store_id
                         AND template.template_data->'assetIds' ? (m.id::text)
                         AND (
                           template.scope='tenant'
                           OR (
                             template.scope='user'
                             AND template.owner_user_id=$6
                           )
                           OR (
                             template.scope='store'
                             AND template.store_id=$3
                           )
                         )
                     )
                   )
                 ON CONFLICT (asset_id, reference_type, reference_key)
                 DO NOTHING`,
          values: [
            mediaAssetIds,
            input.tenantId,
            input.storeId,
            String(row.id),
            tailTemplateId,
            input.userId,
          ],
        });
        if (inserted.rowCount !== mediaAssetIds.length) {
          throw new ProductDraftError(
            "INVALID_DRAFT_MEDIA",
            "商品草稿引用了不存在、未完成上传或不属于当前店铺的图片",
            409,
          );
        }
      }

      const affectedIds = Array.from(
        new Set([...previousIds, ...mediaAssetIds]),
      );
      if (affectedIds.length) {
        await client.query({
          text: `UPDATE media_assets m
                 SET reference_count = refs.reference_count,
                     status = CASE
                       WHEN refs.reference_count > 0
                         AND m.status IN ('ready', 'referenced', 'pending_delete')
                         THEN 'referenced'
                       WHEN refs.reference_count = 0
                         AND m.status = 'referenced'
                         THEN 'ready'
                       ELSE m.status
                     END,
                     updated_at=now()
                 FROM (
                   SELECT m2.id, COUNT(r.asset_id)::int AS reference_count
                   FROM media_assets m2
                   LEFT JOIN media_asset_references r ON r.asset_id=m2.id
                   WHERE m2.id = ANY($1::uuid[])
                   GROUP BY m2.id
                 ) refs
                 WHERE m.id=refs.id`,
          values: [affectedIds],
        });
      }
      return row;
    });
  }

  async archive({ tenantId, storeId, draftId, userId }) {
    return withTransaction(this.pool, async (client) => {
      const result = await client.query({
        text: `
          UPDATE product_drafts
          SET status='archived', updated_by=$4, updated_at=now()
          WHERE id=$1
            AND tenant_id=$2
            AND store_id=$3
            AND status <> 'published'
          RETURNING *
        `,
        values: [draftId, tenantId, storeId, userId],
      });
      const row = result.rows[0] || null;
      if (!row) return null;
      await client.query({
        text: `
          WITH released AS (
            DELETE FROM media_asset_references AS ref
            USING media_assets AS source_asset
            WHERE ref.asset_id=source_asset.id
              AND ref.tenant_id=$1
              AND ref.store_id=$2
              AND ref.reference_type='product_draft'
              AND ref.reference_key=$3
              AND source_asset.purpose IN (
                'temporary_upload', 'reusable_source',
                'generated_unselected', 'selected_unpublished'
              )
            RETURNING ref.asset_id
          ), affected AS (
            SELECT released.asset_id, COUNT(ref.asset_id)::int AS reference_count
            FROM released
            LEFT JOIN media_asset_references ref ON ref.asset_id=released.asset_id
            GROUP BY released.asset_id
          )
          UPDATE media_assets asset
          SET reference_count=affected.reference_count,
              status=CASE
                WHEN affected.reference_count=0
                  AND asset.purpose IN (
                    'temporary_upload', 'reusable_source',
                    'generated_unselected', 'selected_unpublished'
                  )
                  AND asset.status <> 'deleted'
                  THEN 'pending_delete'
                WHEN affected.reference_count>0
                  AND asset.status IN ('ready', 'referenced', 'pending_delete')
                  THEN 'referenced'
                ELSE asset.status
              END,
              expires_at=CASE
                WHEN affected.reference_count=0
                  AND asset.purpose IN (
                    'temporary_upload', 'reusable_source',
                    'generated_unselected', 'selected_unpublished'
                  )
                  AND asset.status <> 'deleted'
                  THEN now()
                ELSE asset.expires_at
              END,
              delete_after=CASE
                WHEN affected.reference_count=0
                  AND asset.purpose IN (
                    'temporary_upload', 'reusable_source',
                    'generated_unselected', 'selected_unpublished'
                  )
                  AND asset.status <> 'deleted'
                  THEN now()
                ELSE asset.delete_after
              END,
              updated_at=now()
          FROM affected
          WHERE asset.id=affected.asset_id
            AND asset.tenant_id=$1
        `,
        values: [tenantId, storeId, String(row.id)],
      });
      return row;
    });
  }
}

export class WebProductDraftService {
  constructor({
    repository,
    associatedAttributeRules = null,
    packagingTemplateProvider = null,
    quota = {},
    now = () => new Date(),
  } = {}) {
    if (!repository) throw new Error("WebProductDraftService 缺少 repository");
    this.repository = repository;
    this.associatedAttributeRules = associatedAttributeRules;
    this.packagingTemplateProvider = packagingTemplateProvider;
    this.quota = quota;
    this.now = now;
  }

  async list({ context, storeId, includePublishHistory = false }) {
    const rows = await this.repository.list({
      tenantId: context.tenantId,
      storeId,
      includePublishHistory,
    });
    const result = { drafts: rows.map(publicDraft), count: rows.length };
    if (typeof this.repository.usage === "function") {
      result.quota = buildWorkspaceQuotaProjection({
        draftUsage: await this.repository.usage({
          tenantId: context.tenantId,
          storeId,
        }),
        quota: this.quota,
      }).drafts;
    }
    return result;
  }

  async revalidate({ context, storeId, draftIds = [], force = false }) {
    const requested = new Set((Array.isArray(draftIds) ? draftIds : [])
      .map((id) => String(id || "").trim())
      .filter(Boolean));
    const rows = await this.repository.list({
      tenantId: context.tenantId,
      storeId,
      includePublishHistory: true,
    });
    let packagingTemplates = [];
    if (typeof this.packagingTemplateProvider === "function") {
      try {
        const result = await this.packagingTemplateProvider({ context, storeId });
        packagingTemplates = Array.isArray(result?.templates)
          ? result.templates
          : [];
      } catch {
        // Keep the persisted draft state when the template read is unavailable.
      }
    }
    const nowMs = this.now().getTime();
    const candidates = rows
      .filter((row) => row.status !== "published" &&
        (!requested.size ? row.status === "blocked" : requested.has(String(row.id))))
      .filter((row) => {
        const generatedAt = Date.parse(String(
          asObject(asObject(row.preflight).publishCandidate).generatedAt || "",
        ));
        return force || !Number.isFinite(generatedAt) || nowMs - generatedAt >= 5 * 60 * 1000;
      })
      // A user-selected handoff must revalidate every selected draft. The
      // limit is only for the background sweep, otherwise a large selection
      // would silently enter the review center with a mixed old/new snapshot.
      .slice(0, requested.size ? undefined : 20);
    const drafts = [];
    for (const row of candidates) {
      const sourceData = asObject(row.draft_data);
      const imageAssets = asObject(sourceData.imageAssets);
      const data = { ...sourceData };
      const packagingTemplateId = String(sourceData.packagingTemplateId || "").trim();
      const packagingMaterial = String(sourceData.packagingMaterial || "").trim();
      const packagingTemplate = packagingTemplates.find(
        (template) => String(template?.id || "") === packagingTemplateId,
      );
      if (packagingTemplate && packagingMaterial && Array.isArray(sourceData.skuRows)) {
        data.skuRows = applyPackagingTemplate(
          sourceData.skuRows,
          packagingTemplate,
          packagingMaterial,
        );
      }
      // Older drafts did not persist the fixed append placement. Normalize
      // that legacy omission during the read-side revalidation so the list
      // and editor use the same current image contract.
      if (
        String(sourceData.tailImageTemplateId || "").trim() &&
        Array.isArray(imageAssets.tail) &&
        imageAssets.tail.length &&
        !String(sourceData.tailImagePlacement || "").trim()
      ) {
        data.tailImagePlacement = "append";
      }
      const result = await this.save({
        context,
        storeId,
        input: {
          id: row.id,
          name: row.name,
          categoryId: row.category_id,
          productTypeId: row.product_type_id,
          data,
          status: "draft",
        },
      });
      if (result?.draft) drafts.push(result.draft);
    }
    return {
      drafts,
      count: drafts.length,
      skippedCount: Math.max(0, candidates.length - drafts.length),
    };
  }

  async archive({ context, storeId, draftId }) {
    if (!String(draftId || "").trim()) {
      throw new ProductDraftError("DRAFT_ID_REQUIRED", "草稿ID不能为空");
    }
    if (typeof this.repository.archive !== "function") {
      throw new ProductDraftError("DRAFT_ARCHIVE_UNAVAILABLE", "草稿归档服务尚未启用", 503);
    }
    const row = await this.repository.archive({
      tenantId: context.tenantId,
      storeId,
      draftId: String(draftId),
      userId: context.userId,
    });
    if (!row) {
      throw new ProductDraftError("DRAFT_NOT_FOUND", "草稿不存在、已发布或不属于当前店铺", 404);
    }
    return { draft: publicDraft(row) };
  }

  async archiveMany({ context, storeId, draftIds = [] }) {
    const ids = [...new Set(
      (Array.isArray(draftIds) ? draftIds : [])
        .map((draftId) => String(draftId || "").trim())
        .filter(Boolean),
    )].slice(0, 100);
    if (!ids.length) {
      throw new ProductDraftError("DRAFT_IDS_REQUIRED", "请选择要删除的草稿");
    }
    if (typeof this.repository.archive !== "function") {
      throw new ProductDraftError("DRAFT_ARCHIVE_UNAVAILABLE", "草稿归档服务尚未启用", 503);
    }
    const drafts = [];
    for (const draftId of ids) {
      const row = await this.repository.archive({
        tenantId: context.tenantId,
        storeId,
        draftId,
        userId: context.userId,
      });
      if (row) drafts.push(publicDraft(row));
    }
    return { drafts, count: drafts.length, skippedCount: ids.length - drafts.length };
  }

  async save({ context, storeId, input = {} }) {
    const requestedName = String(input.name || "").trim();
    if (!requestedName) {
      throw new ProductDraftError(
        "INVALID_PRODUCT_NAME",
        "商品草稿名称不能为空",
      );
    }
    const name = requestedName.slice(0, 160);
    if (input.status === "published") {
      throw new ProductDraftError(
        "PUBLISHED_STATUS_SERVER_MANAGED",
        "已发布状态只能由SHEIN发布回读闭环写入",
        409,
      );
    }
    const status = ["draft", "blocked", "ready", "archived"]
      .includes(input.status)
      ? input.status
      : "draft";
    if (!input.id && typeof this.repository.usage === "function") {
      const projection = buildWorkspaceQuotaProjection({
        draftUsage: await this.repository.usage({
          tenantId: context.tenantId,
          storeId,
        }),
        quota: this.quota,
      });
      if (!canAddDraft(projection)) {
        throw new ProductDraftError(
          "DRAFT_QUOTA_EXCEEDED",
          "草稿数量已达到当前店铺或账号上限，请先删除或发布旧草稿",
          409,
        );
      }
    }
    const data = asObject(input.data);
    const categoryId = String(input.categoryId || "");
    const productTypeId = String(input.productTypeId || "");
    let associatedRuleResult = null;
    let associatedRuleError = "";
    if (!categoryId || !productTypeId) {
      associatedRuleError = "";
    } else if (typeof this.associatedAttributeRules === "function") {
      try {
        const result = await this.associatedAttributeRules({
          context,
          storeId,
          categoryId,
          productTypeId,
          attributeList: buildAssociatedAttributeRuleRequest(data),
        });
        const info = asObject(result?.info);
        const group = (Array.isArray(info.data) ? info.data : [])[0] || {};
        associatedRuleResult = {
          checkedAt: this.now().toISOString(),
          traceId: String(result?.diagnostics?.traceId || ""),
          rules: Array.isArray(group.link_rule_attribute_list)
            ? group.link_rule_attribute_list
            : [],
        };
      } catch (error) {
        associatedRuleError =
          `SHEIN关联属性规则读取失败：${error?.message || "未知错误"}`;
      }
    } else {
      associatedRuleError = "SHEIN关联属性规则服务尚未配置";
    }
    const basePreflight = buildRugReportDraftPreflight(
      data,
      buildProductContentDraftPreflight(
        data,
        buildProductImageDraftPreflight(
          data,
          buildSkuDraftPreflight(
            data,
            buildProductPublishSettingsDraftPreflight(
              data,
              buildProductAttributeDraftPreflight(data, input.preflight, {
                categoryId,
                productTypeId,
                associatedRuleResult,
                associatedRuleError,
              }),
            ),
          ),
        ),
      ),
    );
    const preflight = buildProductComplianceDraftPreflight(
      data,
      basePreflight,
      {
        categoryId,
        storeId,
      },
    );
    const finalPreflight = buildProductPublishCandidateDraftPreflight(
      data,
      preflight,
      {
        categoryId,
        productTypeId,
        generatedAt: this.now().toISOString(),
      },
    );
    const savedStatus = ["draft", "blocked", "ready"].includes(status)
      ? finalPreflight.publishCandidate.state === "ready_for_remote_preflight"
        ? "ready"
        : "blocked"
      : status;
    const row = await this.repository.save({
      id: input.id || null,
      tenantId: context.tenantId,
      storeId,
      name,
      categoryId,
      productTypeId,
      data,
      mediaAssetIds: collectDraftMediaAssetIds(data),
      preflight: finalPreflight,
      status: savedStatus,
      userId: context.userId,
    });
    if (!row) {
      throw new ProductDraftError("DRAFT_CONFLICT", "商品草稿保存冲突", 409);
    }
    return { draft: publicDraft(row) };
  }
}
