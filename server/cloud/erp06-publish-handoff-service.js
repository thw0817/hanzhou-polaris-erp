import { withTransaction } from "./postgres.js";
import {
  createErp06Fingerprint,
  redactVersionSnapshot,
} from "./erp06-product-version-service.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function text(value) {
  return String(value ?? "").trim();
}

function ensureUuid(value, name) {
  const normalized = text(value);
  if (!UUID_PATTERN.test(normalized)) {
    throw new Erp06PublishHandoffError(
      "INVALID_HANDOFF_INPUT",
      `${name} 不是有效 UUID`,
    );
  }
  return normalized;
}

function ensureRequestKey(value) {
  const normalized = text(value);
  if (!normalized) {
    throw new Erp06PublishHandoffError(
      "REQUEST_KEY_REQUIRED",
      "发布交接必须携带 requestKey",
    );
  }
  return normalized;
}

function ensureInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Erp06PublishHandoffError(
      "INVALID_HANDOFF_INPUT",
      `${name} 必须是非负安全整数`,
    );
  }
  return parsed;
}

function asBigIntSafe(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Erp06PublishHandoffError(
      "INVALID_HANDOFF_STATE",
      `${name} 不是有效的非负安全整数`,
      500,
    );
  }
  return parsed;
}

export class Erp06PublishHandoffError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.name = "Erp06PublishHandoffError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

async function loadExistingAttemptByRequestKey(client, scope) {
  const result = await client.query({
    text: `SELECT *
           FROM publish_attempts
           WHERE tenant_id=$1 AND store_id=$2 AND request_key=$3`,
    values: [scope.tenantId, scope.storeId, scope.requestKey],
  });
  return result.rows[0] || null;
}

async function loadCommandForAttempt(client, scope, attemptId) {
  const result = await client.query({
    text: `SELECT *
           FROM publish_commands
           WHERE tenant_id=$1 AND store_id=$2 AND publish_attempt_id=$3`,
    values: [scope.tenantId, scope.storeId, attemptId],
  });
  return result.rows[0] || null;
}

async function loadOutboxForCommand(client, scope, commandId) {
  const result = await client.query({
    text: `SELECT *
           FROM product_publish_outbox
           WHERE tenant_id=$1 AND store_id=$2 AND publish_command_id=$3`,
    values: [scope.tenantId, scope.storeId, commandId],
  });
  return result.rows[0] || null;
}

async function loadCurrentProjection(client, scope, catalogProductId) {
  const productResult = await client.query({
    text: `SELECT current_version_id, current_attempt_id
           FROM catalog_products
           WHERE tenant_id=$1 AND store_id=$2 AND id=$3`,
    values: [scope.tenantId, scope.storeId, catalogProductId],
  });
  const product = productResult.rows[0] || null;
  if (!product) return null;

  const draftResult = await client.query({
    text: `SELECT editing_status, lock_version
           FROM product_drafts
           WHERE tenant_id=$1 AND store_id=$2 AND id=$3`,
    values: [scope.tenantId, scope.storeId, scope.draftId],
  });
  const draft = draftResult.rows[0] || null;
  if (!draft) return null;
  return { product, draft };
}

async function loadVersionCatalogProductId(client, scope, productVersionId) {
  const result = await client.query({
    text: `SELECT catalog_product_id
           FROM product_versions
           WHERE tenant_id=$1 AND store_id=$2 AND id=$3`,
    values: [scope.tenantId, scope.storeId, productVersionId],
  });
  return result.rows[0]?.catalog_product_id || null;
}

async function loadBatchForUpdate(client, scope) {
  const result = await client.query({
    text: `SELECT *
           FROM publish_batches
           WHERE tenant_id=$1 AND store_id=$2 AND id=$3
           FOR UPDATE`,
    values: [scope.tenantId, scope.storeId, scope.publishBatchId],
  });
  const batch = result.rows[0] || null;
  if (!batch) {
    throw new Erp06PublishHandoffError(
      "BATCH_NOT_FOUND",
      "PublishBatch 不存在或不属于当前租户/店铺",
      409,
    );
  }
  return batch;
}

async function loadBatchItemForUpdate(client, scope, version, { requirePending = false } = {}) {
  await loadBatchForUpdate(client, scope);
  const result = await client.query({
    text: `SELECT *
           FROM publish_batch_items
           WHERE tenant_id=$1 AND store_id=$2 AND id=$3 AND batch_id=$4
           FOR UPDATE`,
    values: [
      scope.tenantId,
      scope.storeId,
      scope.publishBatchItemId,
      scope.publishBatchId,
    ],
  });
  const item = result.rows[0] || null;
  if (!item) {
    throw new Erp06PublishHandoffError(
      "BATCH_ITEM_NOT_FOUND",
      "PublishBatchItem 不存在、未挂在指定批次或不属于当前租户/店铺",
      409,
    );
  }
  if (
    item.product_version_id !== version.id
    || item.catalog_product_id !== version.catalog_product_id
    || item.product_draft_id !== version.source_product_draft_id
  ) {
    throw new Erp06PublishHandoffError(
      "BATCH_ITEM_VERSION_MISMATCH",
      "PublishBatchItem 与 ProductVersion/来源草稿不一致，已阻断交接",
      409,
    );
  }
  if (requirePending) assertBatchItemPending(item);
  return item;
}

function assertBatchItemPending(item) {
  if (item.handoff_state !== "pending" || item.publish_attempt_id) {
    throw new Erp06PublishHandoffError(
      "BATCH_ITEM_NOT_HANDOFFABLE",
      "PublishBatchItem 已交接或状态不是 pending，拒绝重复创建交接事实",
      409,
    );
  }
}

async function assertVersionSourceDraftMatchesRequest(
  client,
  scope,
  productVersionId,
) {
  const result = await client.query({
    text: `SELECT dr.product_draft_id AS source_product_draft_id
           FROM product_versions pv
           JOIN draft_revisions dr
             ON dr.tenant_id=pv.tenant_id
            AND dr.store_id=pv.store_id
            AND dr.id=pv.source_draft_revision_id
           WHERE pv.tenant_id=$1 AND pv.store_id=$2 AND pv.id=$3`,
    values: [scope.tenantId, scope.storeId, productVersionId],
  });
  const sourceDraftId = result.rows[0]?.source_product_draft_id || null;
  if (!sourceDraftId) {
    throw new Erp06PublishHandoffError(
      "INCOMPLETE_HANDOFF",
      "已有发布尝试无法确认 ProductVersion 的来源草稿，拒绝猜测性修复",
      500,
    );
  }
  if (sourceDraftId !== scope.draftId) {
    throw new Erp06PublishHandoffError(
      "VERSION_DRAFT_MISMATCH",
      "requestKey 对应的 ProductVersion 不属于当前草稿，已阻断越界幂等返回",
      409,
    );
  }
}

function assertCompleteExistingHandoff({ attempt, command, outbox, projection, batchItem }) {
  if (
    !command
    || !outbox
    || !projection
    || !batchItem
    || batchItem.publish_attempt_id !== attempt.id
    || batchItem.handoff_state !== "handed_off"
  ) {
    throw new Erp06PublishHandoffError(
      "INCOMPLETE_HANDOFF",
      "发现已有发布尝试但缺少批次项、Command、Outbox 或当前投影，拒绝猜测性修复",
      500,
    );
  }
  if (
    projection.product.current_version_id !== attempt.product_version_id ||
    projection.product.current_attempt_id !== attempt.id ||
    projection.draft.editing_status !== "handed_off"
  ) {
    throw new Erp06PublishHandoffError(
      "INCOMPLETE_HANDOFF",
      "已有发布尝试未完成当前版本/草稿交接，拒绝重复补写",
      500,
    );
  }
}

async function loadDraftForUpdate(client, scope) {
  const result = await client.query({
    text: `SELECT *
           FROM product_drafts
           WHERE id=$1 AND tenant_id=$2 AND store_id=$3
           FOR UPDATE`,
    values: [scope.draftId, scope.tenantId, scope.storeId],
  });
  const draft = result.rows[0] || null;
  if (!draft) {
    throw new Erp06PublishHandoffError(
      "DRAFT_NOT_FOUND",
      "商品草稿不存在或不属于当前租户/店铺",
      404,
    );
  }
  return draft;
}

async function loadVersionForDraft(client, scope, draft) {
  const result = await client.query({
    text: `SELECT pv.*, dr.product_draft_id AS source_product_draft_id,
                  dr.catalog_product_id AS source_catalog_product_id,
                  dr.revision_no AS source_revision_no
           FROM product_versions pv
           JOIN draft_revisions dr
             ON dr.tenant_id=pv.tenant_id
            AND dr.store_id=pv.store_id
            AND dr.id=pv.source_draft_revision_id
           WHERE pv.id=$1 AND pv.tenant_id=$2 AND pv.store_id=$3
           FOR SHARE`,
    values: [scope.productVersionId, scope.tenantId, scope.storeId],
  });
  const version = result.rows[0] || null;
  if (!version) {
    throw new Erp06PublishHandoffError(
      "PRODUCT_VERSION_NOT_FOUND",
      "ProductVersion 不存在或不属于当前租户/店铺",
      404,
    );
  }
  if (
    version.source_product_draft_id !== draft.id ||
    version.source_catalog_product_id !== draft.catalog_product_id ||
    version.catalog_product_id !== draft.catalog_product_id
  ) {
    throw new Erp06PublishHandoffError(
      "VERSION_DRAFT_MISMATCH",
      "ProductVersion 的来源修订、草稿和 CatalogProduct 不一致，已阻断交接",
      409,
    );
  }
  return version;
}

async function loadCatalogProductForUpdate(client, scope, catalogProductId) {
  const result = await client.query({
    text: `SELECT *
           FROM catalog_products
           WHERE id=$1 AND tenant_id=$2 AND store_id=$3
           FOR UPDATE`,
    values: [catalogProductId, scope.tenantId, scope.storeId],
  });
  const product = result.rows[0] || null;
  if (!product) {
    throw new Erp06PublishHandoffError(
      "CATALOG_PRODUCT_NOT_FOUND",
      "CatalogProduct 不存在或不属于当前租户/店铺",
      409,
    );
  }
  return product;
}

async function loadExistingAttemptForVersion(client, scope) {
  const result = await client.query({
    text: `SELECT *
           FROM publish_attempts
           WHERE tenant_id=$1 AND store_id=$2 AND product_version_id=$3
           ORDER BY attempt_no DESC
           LIMIT 1
           FOR UPDATE`,
    values: [scope.tenantId, scope.storeId, scope.productVersionId],
  });
  return result.rows[0] || null;
}

async function nextProductEventVersion(
  client,
  { tenantId, storeId, aggregateType, aggregateId },
) {
  const result = await client.query({
    text: `SELECT COALESCE(MAX(event_version),0)+1 AS event_version
           FROM product_events
           WHERE tenant_id=$1 AND store_id=$2
             AND aggregate_type=$3 AND aggregate_id=$4`,
    values: [tenantId, storeId, aggregateType, aggregateId],
  });
  return asBigIntSafe(result.rows[0]?.event_version, "product event_version");
}

async function insertEvent(
  client,
  {
    tenantId,
    storeId,
    aggregateType,
    aggregateId,
    eventType,
    eventVersion,
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
                   'erp06-publish-handoff-service',$7,$8::jsonb,$9,$10)`,
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

function publicHandoffResult({
  idempotent,
  draftId,
  productVersionId,
  publishBatchId,
  publishBatchItemId,
  batchItem,
  attempt,
  command,
  outbox,
  projection,
  draftLockVersion,
}) {
  return {
    idempotent,
    stage: "queued_for_dispatch",
    draftId,
    productVersionId,
    publishBatchId,
    publishBatchItemId,
    batchItemHandoffState: batchItem?.handoff_state || "handed_off",
    publishAttemptId: attempt.id,
    publishCommandId: command.id,
    publishOutboxId: outbox.id,
    attemptNo: attempt.attempt_no,
    attemptState: attempt.state,
    commandState: command.state,
    outboxState: outbox.state,
    currentVersionId: projection.product.current_version_id,
    currentAttemptId: projection.product.current_attempt_id,
    draftEditingStatus: projection.draft.editing_status,
    draftLockVersion,
    remoteCallMade: false,
  };
}

export class PostgresErp06PublishHandoffRepository {
  constructor({ pool } = {}) {
    if (!pool) throw new Error("PostgresErp06PublishHandoffRepository 缺少 pool");
    this.pool = pool;
  }

  /**
   * Atomically hand off an immutable ProductVersion to durable local publish
   * facts. This intentionally stops before any queue consumer or SHEIN call.
   */
  async createPublishHandoff({
    tenantId,
    storeId,
    draftId,
    productVersionId,
    publishBatchId,
    publishBatchItemId,
    expectedLockVersion,
    requestKey,
    reason = "initial_publish",
    capability = "product.publish",
    userId = null,
  } = {}) {
    const scope = {
      tenantId: ensureUuid(tenantId, "tenantId"),
      storeId: ensureUuid(storeId, "storeId"),
      draftId: ensureUuid(draftId, "draftId"),
      productVersionId: ensureUuid(productVersionId, "productVersionId"),
      publishBatchId: ensureUuid(publishBatchId, "publishBatchId"),
      publishBatchItemId: ensureUuid(publishBatchItemId, "publishBatchItemId"),
      requestKey: ensureRequestKey(requestKey),
      reason: text(reason) || "initial_publish",
      capability: text(capability) || "product.publish",
      userId: userId ? ensureUuid(userId, "userId") : null,
    };
    if (expectedLockVersion === undefined || expectedLockVersion === null) {
      throw new Erp06PublishHandoffError(
        "EXPECTED_LOCK_VERSION_REQUIRED",
        "发布交接必须携带期望的 draft lockVersion",
      );
    }
    const expectedLock = ensureInteger(expectedLockVersion, "expectedLockVersion");

    return withTransaction(this.pool, async (client) => {
      // Idempotency is checked before locking the draft. A retry after the
      // first transaction bumped lock_version must return the same durable
      // handoff instead of being misclassified as a stale request.
      const existingAttempt = await loadExistingAttemptByRequestKey(client, scope);
      if (existingAttempt) {
        if (existingAttempt.product_version_id !== scope.productVersionId) {
          throw new Erp06PublishHandoffError(
            "REQUEST_KEY_REUSE_CONFLICT",
            "requestKey 已用于另一 ProductVersion，拒绝复用",
            409,
            { existingProductVersionId: existingAttempt.product_version_id },
          );
        }
        if (
          existingAttempt.publish_batch_id !== scope.publishBatchId
          || existingAttempt.publish_batch_item_id !== scope.publishBatchItemId
        ) {
          throw new Erp06PublishHandoffError(
            "ATTEMPT_BATCH_ASSOCIATION_MISMATCH",
            "requestKey 对应的 PublishAttempt 未关联到本次指定批次/批次项，拒绝猜测性返回",
            409,
          );
        }
        const existingVersion = {
          id: existingAttempt.product_version_id,
          catalog_product_id: await loadVersionCatalogProductId(
            client,
            scope,
            existingAttempt.product_version_id,
          ),
          source_product_draft_id: scope.draftId,
        };
        await assertVersionSourceDraftMatchesRequest(
          client,
          scope,
          existingAttempt.product_version_id,
        );
        const existingBatchItem = await loadBatchItemForUpdate(
          client,
          scope,
          existingVersion,
        );
        const command = await loadCommandForAttempt(client, scope, existingAttempt.id);
        const outbox = command
          ? await loadOutboxForCommand(client, scope, command.id)
          : null;
        const catalogProductId = await loadVersionCatalogProductId(
          client,
          scope,
          existingAttempt.product_version_id,
        );
        const projection = catalogProductId
          ? await loadCurrentProjection(client, scope, catalogProductId)
          : null;
        assertCompleteExistingHandoff({
          attempt: existingAttempt,
          command,
          outbox,
          projection,
          batchItem: existingBatchItem,
        });
        return publicHandoffResult({
          idempotent: true,
          draftId: scope.draftId,
          productVersionId: scope.productVersionId,
          publishBatchId: scope.publishBatchId,
          publishBatchItemId: scope.publishBatchItemId,
          batchItem: existingBatchItem,
          attempt: existingAttempt,
          command,
          outbox,
          projection,
          draftLockVersion: asBigIntSafe(
            projection.draft.lock_version,
            "draft.lock_version",
          ),
        });
      }

      const draft = await loadDraftForUpdate(client, scope);
      const currentLock = asBigIntSafe(draft.lock_version, "draft.lock_version");
      if (currentLock !== expectedLock) {
        throw new Erp06PublishHandoffError(
          "DRAFT_VERSION_CONFLICT",
          "商品草稿已被其他操作修改，请重新加载后再交接发布",
          409,
          { expectedLockVersion: expectedLock, currentLockVersion: currentLock },
        );
      }
      if (["archived", "published"].includes(text(draft.status))) {
        throw new Erp06PublishHandoffError(
          "DRAFT_NOT_HANDOFFABLE",
          "当前草稿状态不允许进入发布交接阶段",
          409,
        );
      }

      const version = await loadVersionForDraft(client, scope, draft);
      const batchItem = await loadBatchItemForUpdate(client, scope, version);
      const catalogProduct = await loadCatalogProductForUpdate(
        client,
        scope,
        draft.catalog_product_id,
      );
      const existingVersionAttempt = await loadExistingAttemptForVersion(client, scope);
      if (existingVersionAttempt) {
        throw new Erp06PublishHandoffError(
          "PRODUCT_VERSION_ATTEMPT_ALREADY_EXISTS",
          "该 ProductVersion 已经存在 PublishAttempt；修正或重发必须创建新的 Draft、Revision、Version",
          409,
          {
            publishAttemptId: existingVersionAttempt.id,
            attemptState: existingVersionAttempt.state,
          },
        );
      }
      assertBatchItemPending(batchItem);

      if (!["editing", "blocked", "ready"].includes(text(draft.editing_status))) {
        throw new Erp06PublishHandoffError(
          "DRAFT_NOT_HANDOFFABLE",
          "当前草稿状态不允许进入发布交接阶段",
          409,
        );
      }

      const attemptNoResult = await client.query({
        text: `SELECT COALESCE(MAX(attempt_no),0)+1 AS attempt_no
               FROM publish_attempts
               WHERE tenant_id=$1 AND store_id=$2 AND product_version_id=$3`,
        values: [scope.tenantId, scope.storeId, scope.productVersionId],
      });
      const attemptNo = asBigIntSafe(
        attemptNoResult.rows[0]?.attempt_no,
        "attempt_no",
      );
      const commandKey = `${scope.requestKey}:command`;
      const payloadSummary = {
        publishBatchId: scope.publishBatchId,
        publishBatchItemId: scope.publishBatchItemId,
        productVersionId: version.id,
        sourceDraftRevisionId: version.source_draft_revision_id,
        versionFingerprint: version.version_fingerprint,
        schemaVersion: version.schema_version,
      };
      const commandFingerprint = createErp06Fingerprint({
        productVersionId: version.id,
        versionFingerprint: version.version_fingerprint,
        capability: scope.capability,
        requestKey: scope.requestKey,
      });

      const attempt = (
        await client.query({
          text: `INSERT INTO publish_attempts
                   (tenant_id, store_id, publish_batch_id, publish_batch_item_id,
                    product_version_id, attempt_no,
                    request_key, reason, state, created_by)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'created',$9)
                 RETURNING *`,
          values: [
            scope.tenantId,
            scope.storeId,
            scope.publishBatchId,
            scope.publishBatchItemId,
            version.id,
            attemptNo,
            scope.requestKey,
            scope.reason,
            scope.userId,
          ],
        })
      ).rows[0];
      if (!attempt) {
        throw new Erp06PublishHandoffError(
          "ATTEMPT_INSERT_FAILED",
          "PublishAttempt 未生成，事务已回滚",
          500,
        );
      }

      const command = (
        await client.query({
          text: `INSERT INTO publish_commands
                   (tenant_id, store_id, publish_attempt_id, request_key,
                    command_fingerprint, capability, state, payload_summary)
                 VALUES ($1,$2,$3,$4,$5,$6,'queued',$7::jsonb)
                 RETURNING *`,
          values: [
            scope.tenantId,
            scope.storeId,
            attempt.id,
            commandKey,
            commandFingerprint,
            scope.capability,
            JSON.stringify(payloadSummary),
          ],
        })
      ).rows[0];
      if (!command) {
        throw new Erp06PublishHandoffError(
          "COMMAND_INSERT_FAILED",
          "PublishCommand 未生成，事务已回滚",
          500,
        );
      }

      const outboxPayloadSummary = {
        ...payloadSummary,
        publishAttemptId: attempt.id,
        publishCommandId: command.id,
      };
      const outbox = (
        await client.query({
          text: `INSERT INTO product_publish_outbox
                   (tenant_id, store_id, publish_command_id, event_type,
                    dedupe_key, state, payload_summary)
                 VALUES ($1,$2,$3,'publish_command_requested',$4,'pending',$5::jsonb)
                 RETURNING *`,
          values: [
            scope.tenantId,
            scope.storeId,
            command.id,
            `${commandKey}:outbox`,
            JSON.stringify(outboxPayloadSummary),
          ],
        })
      ).rows[0];
      if (!outbox) {
        throw new Erp06PublishHandoffError(
          "OUTBOX_INSERT_FAILED",
          "ProductPublishOutbox 未生成，事务已回滚",
          500,
        );
      }

      const projectionRow = (
        await client.query({
          text: `UPDATE catalog_products
                 SET current_version_id=$1, current_attempt_id=$2,
                     updated_at=now()
                 WHERE tenant_id=$3 AND store_id=$4 AND id=$5
                 RETURNING current_version_id, current_attempt_id`,
          values: [
            version.id,
            attempt.id,
            scope.tenantId,
            scope.storeId,
            catalogProduct.id,
          ],
        })
      ).rows[0];
      if (!projectionRow) {
        throw new Erp06PublishHandoffError(
          "PROJECTION_UPDATE_FAILED",
          "当前商品投影未更新，事务已回滚",
          500,
        );
      }

      const handedOffDraft = (
        await client.query({
          text: `UPDATE product_drafts
                 SET editing_status='handed_off', lock_version=lock_version+1,
                     updated_by=$1, updated_at=now()
                 WHERE tenant_id=$2 AND store_id=$3 AND id=$4
                   AND lock_version=$5 AND editing_status <> 'handed_off'
                 RETURNING editing_status, lock_version`,
          values: [
            scope.userId,
            scope.tenantId,
            scope.storeId,
            scope.draftId,
            expectedLock,
          ],
        })
      ).rows[0];
      if (!handedOffDraft) {
        throw new Erp06PublishHandoffError(
          "DRAFT_VERSION_CONFLICT",
          "草稿交接时 lockVersion 已变化，事务已回滚",
          409,
        );
      }

      const handedOffBatchItem = (
        await client.query({
          text: `UPDATE publish_batch_items
                 SET publish_attempt_id=$1, handoff_state='handed_off', updated_at=now()
                 WHERE tenant_id=$2 AND store_id=$3 AND id=$4
                   AND batch_id=$5 AND product_version_id=$6
                   AND handoff_state='pending' AND publish_attempt_id IS NULL
                 RETURNING id, handoff_state`,
          values: [
            attempt.id,
            scope.tenantId,
            scope.storeId,
            scope.publishBatchItemId,
            scope.publishBatchId,
            version.id,
          ],
        })
      ).rows[0];
      if (!handedOffBatchItem) {
        throw new Erp06PublishHandoffError(
          "BATCH_ITEM_VERSION_CONFLICT",
          "PublishBatchItem 在交接时已被其他操作占用，事务已回滚",
          409,
        );
      }

      const projection = { product: projectionRow, draft: handedOffDraft };

      await insertEvent(client, {
        ...scope,
        aggregateType: "publish_attempt",
        aggregateId: attempt.id,
        eventType: "publish_attempt_created",
        eventVersion: 1,
        dedupeKey: `erp06:publish-attempt-created:${attempt.id}`,
        payload: {
          publishBatchId: scope.publishBatchId,
          publishBatchItemId: scope.publishBatchItemId,
          productVersionId: version.id,
          attemptNo,
          reason: scope.reason,
          requestFingerprint: createErp06Fingerprint(scope.requestKey),
        },
        actorId: scope.userId,
      });
      await insertEvent(client, {
        ...scope,
        aggregateType: "publish_command",
        aggregateId: command.id,
        eventType: "publish_command_requested",
        eventVersion: 1,
        dedupeKey: `erp06:publish-command-requested:${command.id}`,
        payload: {
          publishBatchId: scope.publishBatchId,
          publishBatchItemId: scope.publishBatchItemId,
          publishAttemptId: attempt.id,
          productVersionId: version.id,
          commandFingerprint,
          capability: scope.capability,
        },
        actorId: scope.userId,
      });
      await insertEvent(client, {
        ...scope,
        aggregateType: "draft",
        aggregateId: draft.id,
        eventType: "draft_handoff_completed",
        eventVersion: await nextProductEventVersion(client, {
          ...scope,
          aggregateType: "draft",
          aggregateId: draft.id,
        }),
        dedupeKey: `erp06:draft-handoff-completed:${draft.id}:${attempt.id}`,
        payload: {
          publishBatchId: scope.publishBatchId,
          publishBatchItemId: scope.publishBatchItemId,
          productVersionId: version.id,
          publishAttemptId: attempt.id,
          publishCommandId: command.id,
          draftLockVersion: asBigIntSafe(
            handedOffDraft.lock_version,
            "draft.lock_version",
          ),
        },
        actorId: scope.userId,
      });
      await insertEvent(client, {
        ...scope,
        aggregateType: "catalog_product",
        aggregateId: catalogProduct.id,
        eventType: "current_product_projection_updated",
        eventVersion: await nextProductEventVersion(client, {
          ...scope,
          aggregateType: "catalog_product",
          aggregateId: catalogProduct.id,
        }),
        dedupeKey: `erp06:current-product-projection-updated:${catalogProduct.id}:${attempt.id}`,
        payload: {
          publishBatchId: scope.publishBatchId,
          publishBatchItemId: scope.publishBatchItemId,
          productVersionId: version.id,
          publishAttemptId: attempt.id,
        },
        actorId: scope.userId,
      });

      return publicHandoffResult({
        idempotent: false,
        draftId: scope.draftId,
        productVersionId: version.id,
        publishBatchId: scope.publishBatchId,
        publishBatchItemId: scope.publishBatchItemId,
        batchItem: handedOffBatchItem,
        attempt,
        command,
        outbox,
        projection,
        draftLockVersion: asBigIntSafe(
          handedOffDraft.lock_version,
          "draft.lock_version",
        ),
      });
    });
  }
}
