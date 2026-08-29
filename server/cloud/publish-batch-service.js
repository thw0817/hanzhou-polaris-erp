import { randomUUID } from "node:crypto";
import { withTransaction } from "./postgres.js";
import {
  buildPublishExecutionProtocol,
  consumePublishExecutionAuthorization,
  EXECUTION_AUTHORIZATION_TTL_MS,
  isPublishExecutionAuthorizationActive,
} from "./publish-execution-protocol.js";
import {
  projectPublishExecutionAuthorization,
} from "./publish-execution-repository.js";
import {
  productPublishCandidateFingerprint,
  verifyProductPublishCandidate,
} from "./product-publish-candidate.js";
import { createPublishOutboxEvents } from "./outbox-dispatcher.js";
import {
  verifyProductRemotePublishCandidate,
} from "./product-remote-preflight.js";
import { createRuleFingerprint } from "./rule-snapshot-service.js";
import { classifyReviewCenterStatus } from "./review-center-status.js";

const ACTIVE_STATES = new Set([
  "queued",
  "preflighting",
  "ready",
  "paused",
  "failed",
  "completed",
]);
export const PRODUCT_PUBLISH_EXECUTION_CONFIRMATION =
  "CONFIRM_SHEIN_PRODUCT_PUBLISH";
export const PRODUCT_PUBLISH_FAST_ACK_TIMEOUT_MS = 8_000;
export const PRODUCT_PUBLISH_FAST_ACK_POLL_MS = 150;

export class PublishBatchError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "PublishBatchError";
    this.code = code;
    this.status = status;
  }
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function normalizePublishError(error, fallbackMessage) {
  const source = asObject(error);
  const message = String(
    source.message || error?.message || fallbackMessage || "商品发布失败",
  ).trim().slice(0, 1000);
  const normalized = {
    code: source.code == null ? null : String(source.code).trim().slice(0, 100),
    message,
    traceId: source.traceId == null
      ? null
      : String(source.traceId).trim().slice(0, 200) || null,
  };
  if (Array.isArray(source.details) && source.details.length) {
    normalized.details = source.details.slice(0, 100).map((detail) => {
      const row = asObject(detail);
      return {
        source: String(row.source || "SHEIN字段校验").trim().slice(0, 100),
        location: String(row.location || "").trim().slice(0, 300),
        messages: (Array.isArray(row.messages) ? row.messages : [])
          .map((value) => String(value || "").trim().slice(0, 500))
          .filter(Boolean)
          .slice(0, 20),
      };
    }).filter((detail) => detail.messages.length);
  }
  return normalized;
}

function uniqueStrings(values) {
  return Array.from(new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean),
  ));
}

export function summarizeFastPublishAcknowledgement(
  rows = [],
  fallbackDraftIds = [],
) {
  const normalizedRows = Array.isArray(rows) ? rows : [];
  const rowDraftIds = uniqueStrings(
    normalizedRows.map((row) => row?.draftId || row?.product_draft_id),
  );
  const handoffDraftIds = uniqueStrings([...fallbackDraftIds, ...rowDraftIds]);
  const states = normalizedRows.map((row) => String(
    row?.jobState || row?.state || "",
  ).trim());
  const acceptedDraftIds = uniqueStrings(
    normalizedRows
      .filter((row) => ["submitted", "completed"].includes(String(row?.jobState || row?.state || "").trim()))
      .map((row) => row?.draftId || row?.product_draft_id),
  );
  const failedDraftIds = uniqueStrings(
    normalizedRows
      .filter((row) => ["failed_terminal", "failed_retryable"].includes(String(row?.jobState || row?.state || "").trim()))
      .map((row) => row?.draftId || row?.product_draft_id),
  );
  const uncertainDraftIds = uniqueStrings(
    normalizedRows
      .filter((row) => !["submitted", "completed", "failed_terminal", "failed_retryable"].includes(String(row?.jobState || row?.state || "").trim()))
      .map((row) => row?.draftId || row?.product_draft_id),
  );
  const knownTerminalIds = new Set([...acceptedDraftIds, ...failedDraftIds]);
  const allDraftIds = uniqueStrings([...handoffDraftIds, ...uncertainDraftIds]);
  const unresolvedDraftIds = allDraftIds.filter((draftId) => !knownTerminalIds.has(draftId));
  const hasUnknown = states.includes("result_unknown");
  const allAccepted = allDraftIds.length > 0 && acceptedDraftIds.length === allDraftIds.length;
  const allTerminal = allDraftIds.length > 0 &&
    unresolvedDraftIds.length === 0;
  const stage = hasUnknown
    ? "result_unknown"
    : allAccepted
      ? "accepted"
      : allTerminal && failedDraftIds.length > 0
        ? "failed"
        : "queued";
  const effectiveUncertainDraftIds = uniqueStrings(
    unresolvedDraftIds.length ? unresolvedDraftIds : uncertainDraftIds,
  );
  return {
    stage,
    handoffDraftIds,
    acceptedDraftIds,
    failedDraftIds,
    uncertainDraftIds: effectiveUncertainDraftIds,
    partial: acceptedDraftIds.length > 0 && (
      failedDraftIds.length > 0 || effectiveUncertainDraftIds.length > 0
    ),
  };
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function publicItem(row, index = 0) {
  const createdAt = row.created_at || row.updated_at || new Date().toISOString();
  const date = new Date(createdAt);
  const datePart = Number.isNaN(date.getTime())
    ? "00000000"
    : date.toISOString().slice(0, 10).replaceAll("-", "");
  return {
    id: row.id,
    taskId: `${datePart}-${String(index + 1).padStart(3, "0")}`,
    draftId: row.product_draft_id,
    draftName: row.draft_name,
    state: row.state,
    attemptCount: Number(row.attempt_count || 0),
    preflight: row.preflight || {},
    lastError: row.last_error || "",
    updatedAt: row.updated_at,
  };
}

function publicBatch(row, items = []) {
  const preflight = row.preflight || {};
  const confirmation = asObject(preflight.confirmation);
  const executionPlan = asObject(preflight.executionPlan);
  const executionProtocol = asObject(preflight.executionProtocol);
  return {
    id: row.id,
    storeId: row.store_id,
    name: row.name,
    idempotencyKey: row.idempotency_key,
    state: row.state,
    preflight,
    confirmationState:
      row.state === "ready" && confirmation.state === "confirmed"
        ? "confirmed"
        : "pending",
    executionState:
      confirmation.state === "confirmed" &&
      executionPlan.state === "ready_for_execution_confirmation"
        ? ({
            issued: "authorized",
            running: "running",
            completed: "completed",
            expired: "expired",
            failed: "failed",
          }[executionProtocol.state] || "planned")
        : "pending",
    lastError: row.last_error || "",
    items,
    itemCount: items.length,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  };
}

function publicReadbackStatus(row) {
  const requestSummary = asObject(row.request_summary);
  const jobReadback = asObject(row.readback);
  const documentState = asObject(row.document_state);
  const readbackReceipt = asObject(row.readback_receipt);
  const complianceReceipt = asObject(row.compliance_receipt);
  const compliancePhotoSubmission = asObject(row.compliance_photo_submission);
  const readbackSummary = asObject(readbackReceipt.summary);
  const complianceSummary = asObject(complianceReceipt.summary);
  const compliancePhotoSummary = asObject(compliancePhotoSubmission.summary);
  const effectiveSpuName = String(
    row.effective_spu_name || requestSummary.spuName || "",
  ).trim() || null;
  const effectiveSkcNames = Array.isArray(row.effective_skc_names)
    ? row.effective_skc_names
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    : Array.isArray(requestSummary.skcNames)
      ? requestSummary.skcNames
          .map((value) => String(value || "").trim())
          .filter(Boolean)
      : [];
  const failedReasons = Array.isArray(documentState.failedReasons)
    ? documentState.failedReasons.map((reason) => {
        const item = asObject(reason);
        return {
          language: String(item.language || "").trim().slice(0, 20),
          content: String(item.content || item.message || "").trim().slice(0, 1000),
        };
      }).filter((reason) => reason.content)
    : [];
  const rawAuditState = documentState.auditState;
  const auditState = rawAuditState === null || rawAuditState === undefined || rawAuditState === ""
    ? null
    : Number.isInteger(Number(rawAuditState))
      ? Number(rawAuditState)
      : null;
  const submittedAt = row.submitted_at || null;
  const submittedTimestamp = submittedAt ? new Date(submittedAt).getTime() : NaN;
  const pendingTooLong = ["submitted", "result_unknown"].includes(String(row.state || "")) &&
    Number.isFinite(submittedTimestamp) && Date.now() - submittedTimestamp >= 24 * 60 * 60 * 1000 &&
    !documentState.auditStateLabel;
  const resolution = classifyReviewCenterStatus({
    execution: { state: row.state, updatedAt: row.updated_at || null },
    audit: {
      state: auditState,
      stateLabel: documentState.auditStateLabel,
      workflowStage: documentState.workflowStage,
      occurredAt: documentState.occurredAt,
    },
  });
  return {
    id: row.id,
    draftId: row.product_draft_id || null,
    requestKey: row.request_key,
    jobState: row.state,
    submittedAt,
    pendingTooLong,
    spuName: effectiveSpuName,
    skcNames: effectiveSkcNames,
    version: row.shein_version || null,
    documentSn: row.shein_document_sn || documentState.documentSn || null,
    documentState: {
      status: documentState.status || "not_started",
      occurredAt: documentState.occurredAt || null,
      auditState,
      auditStateLabel: documentState.auditStateLabel || null,
      ...(documentState.workflowStage ? { workflowStage: documentState.workflowStage } : {}),
      failedReasons,
      traceId: documentState.traceId || row.trace_id || null,
    },
    resolution,
    relationship: {
      status:
        jobReadback.spu === "completed"
          ? "passed"
          : readbackReceipt.status || "not_started",
      occurredAt: readbackReceipt.occurredAt || null,
      skcCount: Number(
        jobReadback.skcCount ?? readbackSummary.skcCount ?? 0,
      ),
      skuCount: Number(
        jobReadback.skuCount ?? readbackSummary.skuCount ?? 0,
      ),
    },
    compliance: {
      status:
        jobReadback.compliance === "completed"
          ? "passed"
          : jobReadback.compliance === "blocked"
            ? "blocked"
            : complianceReceipt.status === "passed"
              ? "passed"
              : complianceReceipt.status === "failed"
                ? "blocked"
                : "not_started",
      occurredAt: complianceReceipt.occurredAt || null,
      blockerCount: Array.isArray(complianceSummary.blockers)
        ? complianceSummary.blockers.length
        : 0,
    },
    compliancePhotoSubmission: {
      status: String(compliancePhotoSubmission.status || "not_started").trim(),
      occurredAt: compliancePhotoSubmission.occurredAt || null,
      packageCount: Number(compliancePhotoSummary.packageCount || 0),
      bodyCount: Number(compliancePhotoSummary.bodyCount || 0),
      skcCount: Number(compliancePhotoSummary.skcCount || 0),
      message: String(compliancePhotoSummary.message || "").trim() || null,
      code: String(compliancePhotoSummary.code || "").trim() || null,
      traceId: String(compliancePhotoSummary.traceId || "").trim() || null,
    },
    lastError: row.last_error || null,
    updatedAt: row.updated_at,
  };
}

function normalizeDraftIds(values) {
  const ids = Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
  if (!ids.length) {
    throw new PublishBatchError(
      "INVALID_BATCH_DRAFTS",
      "发布批次至少需要一个商品草稿",
    );
  }
  if (ids.length > 100) {
    throw new PublishBatchError(
      "INVALID_BATCH_DRAFTS",
      "单个发布批次最多包含100个商品草稿",
    );
  }
  return ids;
}

function normalizeBatchName(value) {
  const name = String(value || "").trim();
  if (!name || name.length > 120) {
    throw new PublishBatchError(
      "INVALID_BATCH_NAME",
      "批次名称不能为空且不能超过120个字符",
    );
  }
  return name;
}

function normalizeIdempotencyKey(value) {
  const key = String(value || "").trim();
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(key)) {
    throw new PublishBatchError(
      "INVALID_IDEMPOTENCY_KEY",
      "幂等键需为8-160位字母、数字、点、下划线、冒号或短横线",
    );
  }
  return key;
}

function extractSupplierSkus(data = {}) {
  const rows = [
    ...(Array.isArray(data.skuRows) ? data.skuRows : []),
    ...(Array.isArray(data.sizeRows) ? data.sizeRows : []),
  ];
  const rowSkus = rows
    .map((row) => String(row.supplierSku || "").trim())
    .filter(Boolean);
  const legacy = String(data.supplierSku || "").trim();
  return Array.from(new Set([...rowSkus, ...(legacy ? [legacy] : [])]));
}

function getPublishCandidateBlockers(item) {
  const candidate = asObject(asObject(item.draft_preflight).publishCandidate);
  if (verifyProductPublishCandidate(candidate)) {
    return [];
  }
  const messages = Array.isArray(candidate.blockers)
    ? candidate.blockers
      .map((blocker) => String(blocker?.message || "").trim())
      .filter(Boolean)
    : [];
  return messages.length
    ? messages
    : ["商品草稿缺少有效的可审计发布候选快照"];
}

export class PostgresPublishBatchRepository {
  constructor({ pool } = {}) {
    if (!pool) throw new Error("PostgresPublishBatchRepository 缺少 pool");
    this.pool = pool;
  }

  async #hydrate(rows, queryable = this.pool) {
    if (!rows.length) return [];
    const ids = rows.map((row) => row.id);
    const itemResult = await queryable.query({
      text: `SELECT i.*, d.name AS draft_name, d.draft_data,
                    d.preflight AS draft_preflight,
                    d.status AS draft_status,
                    relaunch_parent.parent_attempt_id AS rejected_parent_attempt_id
             FROM publish_batch_items i
             JOIN product_drafts d ON d.id=i.product_draft_id
             LEFT JOIN LATERAL (
               SELECT rejected_job.id AS parent_attempt_id
               FROM publish_jobs rejected_job
               WHERE rejected_job.product_draft_id=d.id
                 AND rejected_job.tenant_id=d.tenant_id
                 AND rejected_job.store_id=d.store_id
                 AND (
                   EXISTS (
                     SELECT 1
                     FROM product_review_states review_state
                     WHERE review_state.tenant_id=d.tenant_id
                       AND review_state.store_id=d.store_id
                       AND review_state.version=rejected_job.shein_version
                       AND review_state.archived_at IS NULL
                       AND (
                         review_state.audit_state=3
                         OR review_state.audit_state_label='failed'
                         OR review_state.workflow_stage='rejected'
                       )
                   )
                   OR EXISTS (
                     SELECT 1
                     FROM publish_receipts rejected_receipt
                     WHERE rejected_receipt.publish_job_id=rejected_job.id
                       AND rejected_receipt.tenant_id=d.tenant_id
                       AND rejected_receipt.store_id=d.store_id
                       AND rejected_receipt.status='failed'
                       AND rejected_receipt.receipt_type IN ('audited', 'document_state')
                   )
                 )
               ORDER BY rejected_job.updated_at DESC, rejected_job.id DESC
               LIMIT 1
             ) relaunch_parent ON TRUE
             WHERE i.batch_id = ANY($1::uuid[])
             ORDER BY i.created_at, i.id`,
      values: [ids],
    });
    const byBatch = new Map();
    itemResult.rows.forEach((item) => {
      const items = byBatch.get(item.batch_id) || [];
      items.push(item);
      byBatch.set(item.batch_id, items);
    });
    return rows.map((row) => ({
      ...row,
      items: byBatch.get(row.id) || [],
    }));
  }

  async list({ tenantId, storeId }) {
    const result = await this.pool.query({
      text: `SELECT * FROM publish_batches
             WHERE tenant_id=$1 AND store_id=$2
             ORDER BY updated_at DESC LIMIT 50`,
      values: [tenantId, storeId],
    });
    return this.#hydrate(result.rows);
  }

  async get({ tenantId, storeId, batchId }, queryable = this.pool) {
    const result = await queryable.query({
      text: `SELECT * FROM publish_batches
             WHERE id=$1 AND tenant_id=$2 AND store_id=$3`,
      values: [batchId, tenantId, storeId],
    });
    const rows = await this.#hydrate(result.rows, queryable);
    return rows[0] || null;
  }

  async create({
    tenantId,
    storeId,
    name,
    idempotencyKey,
    draftIds,
    userId,
    allowRejectedPublished = false,
  }) {
    return withTransaction(this.pool, async (client) => {
      const inserted = await client.query({
        text: `INSERT INTO publish_batches (
                 tenant_id, store_id, name, idempotency_key,
                 created_by, updated_by
               )
               VALUES ($1,$2,$3,$4,$5,$5)
               ON CONFLICT (tenant_id, store_id, idempotency_key)
               DO NOTHING
               RETURNING *`,
        values: [tenantId, storeId, name, idempotencyKey, userId],
      });
      let batch = inserted.rows[0];
      if (!batch) {
        const existing = await client.query({
          text: `SELECT * FROM publish_batches
                 WHERE tenant_id=$1 AND store_id=$2 AND idempotency_key=$3`,
          values: [tenantId, storeId, idempotencyKey],
        });
        return (await this.#hydrate(existing.rows, client))[0];
      }

      const itemResult = await client.query({
        text: `INSERT INTO publish_batch_items (batch_id, product_draft_id)
               SELECT $1, d.id
               FROM product_drafts d
               WHERE d.id = ANY($2::uuid[])
                 AND d.tenant_id=$3
                 AND d.store_id=$4
                 AND (
                   d.status = 'ready'
                   OR (
                     $5::boolean
                     AND d.status IN ('published', 'archived')
                     AND EXISTS (
                       SELECT 1
                       FROM publish_jobs rejected_job
                       WHERE rejected_job.product_draft_id=d.id
                         AND rejected_job.tenant_id=d.tenant_id
                         AND rejected_job.store_id=d.store_id
                         AND (
                           EXISTS (
                             SELECT 1
                             FROM product_review_states review_state
                             WHERE review_state.tenant_id=d.tenant_id
                               AND review_state.store_id=d.store_id
                               AND review_state.version=rejected_job.shein_version
                               AND review_state.archived_at IS NULL
                               AND (
                                 review_state.audit_state=3
                                 OR review_state.audit_state_label='failed'
                                 OR review_state.workflow_stage='rejected'
                               )
                           )
                           OR EXISTS (
                             SELECT 1
                             FROM publish_receipts rejected_receipt
                             WHERE rejected_receipt.publish_job_id=rejected_job.id
                               AND rejected_receipt.tenant_id=d.tenant_id
                               AND rejected_receipt.store_id=d.store_id
                               AND rejected_receipt.status='failed'
                               AND rejected_receipt.receipt_type IN ('audited', 'document_state')
                           )
                         )
                     )
                   )
                 )
               RETURNING *`,
        values: [batch.id, draftIds, tenantId, storeId, allowRejectedPublished === true],
      });
      if (itemResult.rowCount !== draftIds.length) {
        throw new PublishBatchError(
          "INVALID_BATCH_DRAFTS",
          "部分商品草稿不存在、尚未预检通过或不属于当前店铺",
          409,
        );
      }
      batch = (await this.#hydrate([batch], client))[0];
      return batch;
    });
  }

  async setState({
    tenantId,
    storeId,
    batchId,
    batchState,
    itemState,
    userId,
    lastError = null,
  }) {
    return withTransaction(this.pool, async (client) => {
      await client.query({
        text: `UPDATE publish_batches
               SET state=$4, last_error=$5, updated_by=$6, updated_at=now()
               WHERE id=$1 AND tenant_id=$2 AND store_id=$3`,
        values: [
          batchId,
          tenantId,
          storeId,
          batchState,
          lastError,
          userId,
        ],
      });
      await client.query({
        text: `UPDATE publish_batch_items
               SET state=$2, last_error=$3, updated_at=now()
               WHERE batch_id=$1 AND state <> 'completed'`,
        values: [batchId, itemState, lastError],
      });
      return this.get({ tenantId, storeId, batchId }, client);
    });
  }

  async recordPreflight({
    tenantId,
    storeId,
    batchId,
    result,
    itemResults,
    userId,
  }) {
    return withTransaction(this.pool, async (client) => {
      for (const item of itemResults) {
        await client.query({
          text: `UPDATE publish_batch_items
                 SET state=$3, attempt_count=attempt_count+1,
                     preflight=$4::jsonb, last_error=$5, updated_at=now()
                 WHERE id=$1 AND batch_id=$2`,
          values: [
            item.id,
            batchId,
            item.state,
            JSON.stringify(item.preflight),
            item.lastError || null,
          ],
        });
      }
      const batchState = itemResults.every((item) => item.state === "ready")
        ? "ready"
        : "failed";
      const lastError =
        itemResults.find((item) => item.lastError)?.lastError || null;
      await client.query({
        text: `UPDATE publish_batches
               SET state=$4, preflight=$5::jsonb, last_error=$6,
                   updated_by=$7, updated_at=now()
               WHERE id=$1 AND tenant_id=$2 AND store_id=$3`,
        values: [
          batchId,
          tenantId,
          storeId,
          batchState,
          JSON.stringify(result),
          lastError,
          userId,
        ],
      });
      return this.get({ tenantId, storeId, batchId }, client);
    });
  }

  async confirm({
    tenantId,
    storeId,
    batchId,
    expectedBatchPreflight,
    batchPreflight,
    itemResults,
    userId,
  }) {
    return withTransaction(this.pool, async (client) => {
      for (const item of itemResults) {
        const updated = await client.query({
          text: `UPDATE publish_batch_items
                 SET preflight=$4::jsonb, updated_at=now()
                 WHERE id=$1 AND batch_id=$2 AND state='ready'
                   AND preflight=$3::jsonb`,
          values: [
            item.id,
            batchId,
            JSON.stringify(item.expectedPreflight),
            JSON.stringify(item.preflight),
          ],
        });
        if (updated.rowCount !== 1) {
          throw new PublishBatchError(
            "BATCH_CONFIRMATION_STALE",
            "发布候选快照已变化，请重新预检后再确认",
            409,
          );
        }
      }
      const updated = await client.query({
        text: `UPDATE publish_batches
               SET preflight=$5::jsonb, updated_by=$6, updated_at=now()
               WHERE id=$1 AND tenant_id=$2 AND store_id=$3
                 AND state='ready' AND preflight=$4::jsonb`,
        values: [
          batchId,
          tenantId,
          storeId,
          JSON.stringify(expectedBatchPreflight),
          JSON.stringify(batchPreflight),
          userId,
        ],
      });
      if (updated.rowCount !== 1) {
        throw new PublishBatchError(
          "BATCH_CONFIRMATION_STALE",
          "发布批次状态或预检快照已变化，请重新读取后再确认",
          409,
        );
      }
      return this.get({ tenantId, storeId, batchId }, client);
    });
  }

  async recordExecutionPlan({
    tenantId,
    storeId,
    batchId,
    expectedBatchPreflight,
    batchPreflight,
    userId,
  }) {
    return withTransaction(this.pool, async (client) => {
      const updated = await client.query({
        text: `UPDATE publish_batches
               SET preflight=$5::jsonb, updated_by=$6, updated_at=now()
               WHERE id=$1 AND tenant_id=$2 AND store_id=$3
                 AND state='ready' AND preflight=$4::jsonb`,
        values: [
          batchId,
          tenantId,
          storeId,
          JSON.stringify(expectedBatchPreflight),
          JSON.stringify(batchPreflight),
          userId,
        ],
      });
      if (updated.rowCount !== 1) {
        throw new PublishBatchError(
          "EXECUTION_PLAN_STALE",
          "发布确认或候选快照已变化，请刷新后重新生成执行计划",
          409,
        );
      }
      return this.get({ tenantId, storeId, batchId }, client);
    });
  }

  async recordExecutionProtocol({
    tenantId,
    storeId,
    batchId,
    expectedBatchPreflight,
    batchPreflight,
    userId,
  }) {
    return withTransaction(this.pool, async (client) => {
      const updated = await client.query({
        text: `UPDATE publish_batches
               SET preflight=$5::jsonb, updated_by=$6, updated_at=now()
               WHERE id=$1 AND tenant_id=$2 AND store_id=$3
                 AND state='ready' AND preflight=$4::jsonb`,
        values: [
          batchId,
          tenantId,
          storeId,
          JSON.stringify(expectedBatchPreflight),
          JSON.stringify(batchPreflight),
          userId,
        ],
      });
      if (updated.rowCount !== 1) {
        throw new PublishBatchError(
          "EXECUTION_AUTHORIZATION_STALE",
          "执行计划或确认快照已变化，请刷新后重新确认",
          409,
        );
      }
      const executionPlan = asObject(batchPreflight.executionPlan);
      const protocol = asObject(batchPreflight.executionProtocol);
      const run = await projectPublishExecutionAuthorization({
        client,
        tenantId,
        storeId,
        publishBatchId: batchId,
        protocol,
        executionPlan,
      });
      const persistedPreflight = {
        ...batchPreflight,
        executionProtocol: {
          ...protocol,
          executionRunId: run.id,
        },
      };
      await client.query({
        text: `UPDATE publish_batches
               SET preflight=$5::jsonb, updated_by=$6, updated_at=now()
               WHERE id=$1 AND tenant_id=$2 AND store_id=$3
                 AND preflight=$4::jsonb`,
        values: [
          batchId,
          tenantId,
          storeId,
          JSON.stringify(batchPreflight),
          JSON.stringify(persistedPreflight),
          userId,
        ],
      });
      return this.get({ tenantId, storeId, batchId }, client);
    });
  }

  async consumeExecutionProtocol({
    tenantId,
    storeId,
    batchId,
    executionRunId,
    expectedBatchPreflight,
    batchPreflight,
    protocol,
    consumedAt,
    userId,
  }) {
    return withTransaction(this.pool, async (client) => {
      const consumed = await client.query({
        text: `
          UPDATE publish_execution_runs
          SET state = 'running',
              execution_enabled = true,
              authorizes_publishing = true,
              consumed_at = $8::timestamptz,
              updated_at = $8::timestamptz
          WHERE id = $4
            AND tenant_id = $1
            AND store_id = $2
            AND publish_batch_id = $3
            AND authorization_id = $5
            AND authorization_fingerprint = $6
            AND execution_plan_fingerprint = $7
            AND state = 'issued'
            AND single_use = true
            AND consumed_at IS NULL
            AND expires_at > $8::timestamptz
            AND execution_enabled = false
            AND authorizes_publishing = false
          RETURNING id
        `,
        values: [
          tenantId,
          storeId,
          batchId,
          executionRunId,
          protocol.authorizationId,
          protocol.fingerprint,
          protocol.executionPlanFingerprint,
          consumedAt,
        ],
      });
      if (consumed.rowCount !== 1) {
        throw new PublishBatchError(
          "EXECUTION_AUTHORIZATION_CONSUMED_OR_EXPIRED",
          "一次性执行授权已消费、已过期或与当前执行计划不一致",
          409,
        );
      }
      const updated = await client.query({
        text: `
          UPDATE publish_batches
          SET preflight = $5::jsonb,
              updated_by = $7,
              updated_at = $6::timestamptz
          WHERE id = $3
            AND tenant_id = $1
            AND store_id = $2
            AND state = 'ready'
            AND preflight = $4::jsonb
        `,
        values: [
          tenantId,
          storeId,
          batchId,
          JSON.stringify(expectedBatchPreflight),
          JSON.stringify(batchPreflight),
          consumedAt,
          userId,
        ],
      });
      if (updated.rowCount !== 1) {
        throw new PublishBatchError(
          "EXECUTION_AUTHORIZATION_STALE",
          "执行授权消费前批次快照已变化，请刷新后重新确认",
          409,
        );
      }
      await createPublishOutboxEvents({
        client,
        tenantId,
        storeId,
        executionRunId,
        availableAt: consumedAt,
      });
      return this.get({ tenantId, storeId, batchId }, client);
    });
  }
}

function confirmationSnapshot(existing) {
  if (
    existing.state !== "ready" ||
    !existing.items.length ||
    existing.items.some((item) => item.state !== "ready")
  ) {
    throw new PublishBatchError(
      "BATCH_NOT_READY_FOR_CONFIRMATION",
      "仅可确认全部条目均已通过远程预检的发布批次",
      409,
    );
  }
  const items = existing.items.map((item) => {
    const preflight = asObject(item.preflight);
    const sourceCandidate = asObject(
      asObject(item.draft_preflight).publishCandidate,
    );
    const sourceCandidateFingerprint = String(
      preflight.publishCandidateFingerprint || "",
    ).trim();
    const currentSourceFingerprint = verifyProductPublishCandidate(
      sourceCandidate,
    )
      ? productPublishCandidateFingerprint(sourceCandidate)
      : "";
    const remoteCandidate = asObject(preflight.remotePublishCandidate);
    const remoteCandidateFingerprint = String(
      remoteCandidate.fingerprint || "",
    ).trim();
    const remoteSourceFingerprint = String(
      remoteCandidate.sourceCandidateFingerprint || "",
    ).trim();
    const remoteBlockers = Array.isArray(remoteCandidate.blockers)
      ? remoteCandidate.blockers
      : [];
    if (
      !sourceCandidateFingerprint ||
      sourceCandidateFingerprint !== currentSourceFingerprint ||
      remoteCandidate.state !== "ready_for_publish_confirmation" ||
      !remoteCandidateFingerprint ||
      !verifyProductRemotePublishCandidate(remoteCandidate) ||
      remoteSourceFingerprint !== sourceCandidateFingerprint ||
      remoteBlockers.length ||
      remoteCandidate.publishingEnabled !== false
    ) {
      throw new PublishBatchError(
        "BATCH_CONFIRMATION_STALE",
        `商品草稿“${item.draft_name || item.product_draft_id}”的发布候选快照已变化，请重新预检`,
        409,
      );
    }
    return {
      itemId: item.id,
      draftId: item.product_draft_id,
      sourceCandidateFingerprint,
      remoteCandidateFingerprint,
    };
  });
  items.sort((left, right) => left.itemId.localeCompare(right.itemId));
  return {
    items,
    batchFingerprint: createRuleFingerprint(items),
  };
}

function buildExecutionPlan(existing, snapshot, plannedAt, plannedBy) {
  const confirmation = asObject(asObject(existing.preflight).confirmation);
  if (
    confirmation.state !== "confirmed" ||
    confirmation.batchFingerprint !== snapshot.batchFingerprint ||
    confirmation.authorizesPublishing !== false
  ) {
    throw new PublishBatchError(
      "EXECUTION_PLAN_CONFIRMATION_REQUIRED",
      "必须先确认当前冻结快照，才能生成发布执行计划",
      409,
    );
  }
  const requests = existing.items.map((item) => {
    const remote = asObject(
      asObject(item.preflight).remotePublishCandidate,
    );
    const requestBody = asObject(remote.requestBody);
    const skcs = Array.isArray(requestBody.skc_list)
      ? requestBody.skc_list
      : [];
    if (!skcs.length || skcs.length > 40) {
      throw new PublishBatchError(
        "EXECUTION_PLAN_SKC_LIMIT",
        `商品草稿“${item.draft_name || item.product_draft_id}”必须包含1-40个SKC`,
        409,
      );
    }
    const skuCounts = skcs.map((skc) =>
      Array.isArray(skc?.sku_list) ? skc.sku_list.length : 0
    );
    if (skuCounts.some((count) => count < 1 || count > 400)) {
      throw new PublishBatchError(
        "EXECUTION_PLAN_SKU_LIMIT",
        `商品草稿“${item.draft_name || item.product_draft_id}”的每个SKC必须包含1-400个SKU`,
        409,
      );
    }
    const sourceFingerprint = String(
      asObject(item.preflight).publishCandidateFingerprint || "",
    );
    const remoteFingerprint = String(remote.fingerprint || "");
    const skcSummaries = skcs.map((skc) => ({
      skcName: String(skc?.skc_name || ""),
      skuCodes: Array.isArray(skc?.sku_list)
        ? skc.sku_list
            .map((sku) => String(sku?.sku_code || ""))
            .filter(Boolean)
        : [],
      supplierSkus: Array.isArray(skc?.sku_list)
        ? skc.sku_list
            .map((sku) => String(sku?.supplier_sku || ""))
            .filter(Boolean)
        : [],
    }));
    const isRejectedRelaunch = ["published", "archived"].includes(
      String(item.draft_status || "").trim(),
    );
    return {
      itemId: item.id,
      draftId: item.product_draft_id,
      requestKey: createRuleFingerprint({
        batchId: existing.id,
        batchIdempotencyKey: existing.idempotency_key,
        itemId: item.id,
        remoteFingerprint,
      }),
      sourceCandidateFingerprint: sourceFingerprint,
      remoteCandidateFingerprint: remoteFingerprint,
      categoryId: String(requestBody.category_id || ""),
      supplierCode: String(requestBody.supplier_code || ""),
      spuName: String(requestBody.spu_name || ""),
      skcSummaries,
      skcCount: skcs.length,
      skuCount: skuCounts.reduce((total, count) => total + count, 0),
      attemptReason: isRejectedRelaunch ? "rejected_relaunch" : "first_publish",
      parentAttemptId: isRejectedRelaunch
        ? String(item.rejected_parent_attempt_id || "").trim() || null
        : null,
    };
  });
  requests.sort((left, right) => left.itemId.localeCompare(right.itemId));
  const stablePlan = {
    batchFingerprint: snapshot.batchFingerprint,
    requestCount: requests.length,
    skcCount: requests.reduce((total, item) => total + item.skcCount, 0),
    skuCount: requests.reduce((total, item) => total + item.skuCount, 0),
    requests,
    receiptContract: {
      immediate: [
        "success",
        "spu_name",
        "skc_name",
        "sku_code",
        "supplier_sku",
        "version",
        "traceId",
      ],
      receiveWebhook: "/product_document_receive_status_notice",
      auditWebhook: "/product_document_audit_status_notice",
    },
    readbackPlan: [
      {
        order: 1,
        source: "publish_response",
        purpose: "persist_platform_identifiers_and_version",
      },
      {
        order: 2,
        source: "/product_document_receive_status_notice",
        purpose: "confirm_platform_received_document_and_document_sn",
      },
      {
        order: 3,
        source: "/product_document_audit_status_notice",
        purpose: "record_pending_approved_rejected_or_revoked",
      },
      {
        order: 4,
        source: "/open-api/goods/query-document-state",
        purpose: "compensate_missing_webhook_by_version",
      },
      {
        order: 5,
        source: "/open-api/goods/spu-info",
        purpose: "read_back_relationships_only_after_audit_approval",
      },
      {
        order: 6,
        source: "skc_compliance_revalidation",
        purpose: "recheck_1630_1631_gcc_and_product_identifier",
      },
    ],
  };
  return {
    state: "ready_for_execution_confirmation",
    plannedAt,
    plannedBy,
    ...stablePlan,
    fingerprint: createRuleFingerprint(stablePlan),
    executionEnabled: false,
    authorizesPublishing: false,
  };
}

export class WebPublishBatchService {
  constructor({
    repository,
    readbackRepository = repository,
    preflightPublish,
    preparePublishCandidate,
    now = () => new Date(),
    randomId = randomUUID,
    executionAuthorizationTtlMs = EXECUTION_AUTHORIZATION_TTL_MS,
    executionEnabled = false,
    revalidateDrafts = null,
    fastAckTimeoutMs = PRODUCT_PUBLISH_FAST_ACK_TIMEOUT_MS,
    fastAckPollMs = PRODUCT_PUBLISH_FAST_ACK_POLL_MS,
  } = {}) {
    if (!repository) throw new Error("WebPublishBatchService 缺少 repository");
    if (typeof preflightPublish !== "function") {
      throw new Error("WebPublishBatchService 缺少 preflightPublish");
    }
    if (typeof preparePublishCandidate !== "function") {
      throw new Error("WebPublishBatchService 缺少 preparePublishCandidate");
    }
    this.repository = repository;
    this.readbackRepository = readbackRepository;
    this.preflightPublish = preflightPublish;
    this.preparePublishCandidate = preparePublishCandidate;
    this.now = now;
    this.randomId = randomId;
    this.executionAuthorizationTtlMs = executionAuthorizationTtlMs;
    this.executionEnabled = executionEnabled === true;
    this.revalidateDrafts = revalidateDrafts;
    this.fastAckTimeoutMs = Math.max(0, Number(fastAckTimeoutMs) || 0);
    this.fastAckPollMs = Math.max(25, Number(fastAckPollMs) || PRODUCT_PUBLISH_FAST_ACK_POLL_MS);
  }

  async #awaitFastAcknowledgement({ context, storeId, batch, executionRunId }) {
    const fallbackDraftIds = batch.items.map((item) => item.draftId);
    if (
      !executionRunId ||
      typeof this.readbackRepository?.listPublishReadbackStatus !== "function" ||
      this.fastAckTimeoutMs <= 0
    ) {
      return {
        stage: "queued",
        handoffDraftIds: uniqueStrings(fallbackDraftIds),
        acceptedDraftIds: [],
        failedDraftIds: [],
        uncertainDraftIds: uniqueStrings(fallbackDraftIds),
        timedOut: false,
      };
    }
    const deadline = Date.now() + this.fastAckTimeoutMs;
    let latestRows = [];
    while (true) {
      try {
        latestRows = await this.readbackRepository.listPublishReadbackStatus({
          tenantId: context.tenantId,
          storeId,
          batchId: batch.id,
        });
      } catch (error) {
        return {
          stage: "result_unknown",
          handoffDraftIds: uniqueStrings(fallbackDraftIds),
          acceptedDraftIds: [],
          failedDraftIds: [],
          uncertainDraftIds: uniqueStrings(fallbackDraftIds),
          timedOut: false,
          readbackError: normalizePublishError(error, "发布结果回读暂不可用"),
        };
      }
      const summary = summarizeFastPublishAcknowledgement(latestRows, fallbackDraftIds);
      if (
        summary.stage === "accepted" ||
        summary.stage === "failed" ||
        summary.stage === "result_unknown"
      ) {
        return { ...summary, timedOut: false };
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        return {
          ...summary,
          stage: "result_unknown",
          handoffDraftIds: uniqueStrings(
            summary.handoffDraftIds.length ? summary.handoffDraftIds : fallbackDraftIds,
          ),
          uncertainDraftIds: uniqueStrings(
            summary.uncertainDraftIds.length ? summary.uncertainDraftIds : fallbackDraftIds,
          ),
          timedOut: true,
        };
      }
      await wait(Math.min(this.fastAckPollMs, remaining));
    }
  }

  async #withFastAcknowledgement({ context, storeId, result }) {
    if (!result.executionQueued) return result;
    const protocol = asObject(asObject(result.batch.preflight).executionProtocol);
    const executionRunId = String(protocol.executionRunId || "").trim();
    const fastAck = await this.#awaitFastAcknowledgement({
      context,
      storeId,
      batch: result.batch,
      executionRunId,
    });
    return {
      ...result,
      executionQueued: fastAck.stage === "queued",
      executionStage: fastAck.stage,
      fastAck,
    };
  }

  async list({ context, storeId }) {
    const rows = await this.repository.list({
      tenantId: context.tenantId,
      storeId,
    });
    return {
      batches: rows.map((row) =>
        publicBatch(row, row.items.map((item, index) => publicItem(item, index))),
      ),
      count: rows.length,
      publishingEnabled: this.executionEnabled,
    };
  }

  async listReadbackStatus({ context, storeId, batchId }) {
    if (typeof this.readbackRepository?.listPublishReadbackStatus !== "function") {
      throw new PublishBatchError(
        "READBACK_STATUS_UNAVAILABLE",
        "发布批次回读状态服务尚未启用",
        503,
      );
    }
    const normalizedBatchId = String(batchId || "").trim();
    if (!normalizedBatchId) {
      throw new PublishBatchError(
        "INVALID_BATCH_ID",
        "发布批次 ID 不能为空",
        400,
      );
    }
    const rows = await this.readbackRepository.listPublishReadbackStatus({
      tenantId: context.tenantId,
      storeId,
      batchId: normalizedBatchId,
    });
    return {
      batchId: normalizedBatchId,
      items: rows.map(publicReadbackStatus),
      readOnly: true,
    };
  }

  async create({ context, storeId, input = {} }) {
    const draftIds = normalizeDraftIds(input.draftIds);
    if (typeof this.revalidateDrafts === "function") {
      await this.revalidateDrafts({
        context,
        storeId,
        draftIds,
        force: true,
      });
    }
    const row = await this.repository.create({
      tenantId: context.tenantId,
      storeId,
      name: normalizeBatchName(input.name),
      idempotencyKey: normalizeIdempotencyKey(input.idempotencyKey),
      draftIds,
      userId: context.userId,
    });
    return {
      batch: publicBatch(row, row.items.map((item, index) => publicItem(item, index))),
      publishingEnabled: false,
    };
  }

  async publishNow({ context, storeId, input = {} } = {}) {
    if (!this.executionEnabled) {
      throw new PublishBatchError(
        "PRODUCT_PUBLISH_EXECUTION_DISABLED",
        "SHEIN商品真实发布执行尚未启用",
        503,
      );
    }
    if (String(input.confirmation || "") !== PRODUCT_PUBLISH_EXECUTION_CONFIRMATION) {
      throw new PublishBatchError(
        "PRODUCT_PUBLISH_CONFIRMATION_REQUIRED",
        "真实发布需要当前用户再次明确确认",
        409,
      );
    }
    const draftIds = normalizeDraftIds(input.draftIds);
    if (!String(input.idempotencyKey || "").trim()) {
      throw new PublishBatchError(
        "PRODUCT_PUBLISH_IDEMPOTENCY_KEY_REQUIRED",
        "发布请求缺少重复提交保护，请刷新页面后重试",
        400,
      );
    }
    const requestKey = normalizeIdempotencyKey(input.idempotencyKey);
    let created = await this.repository.create({
      tenantId: context.tenantId,
      storeId,
      name: `直接发布 ${this.now().toISOString().slice(0, 19).replace("T", " ")}`,
      idempotencyKey: `direct:${requestKey}`,
      draftIds,
      userId: context.userId,
      allowRejectedPublished: true,
    });
    const existingDirectPublish =
      asObject(created.preflight).directPublish === true ||
      created.state !== "queued" ||
      created.items.some((item) => item.state !== "queued");
    if (existingDirectPublish) {
      return this.#withFastAcknowledgement({
        context,
        storeId,
        result: {
        batch: publicBatch(created, created.items.map((item, index) => publicItem(item, index))),
        publishingEnabled: true,
        executionQueued: ["ready", "queued", "preflighting"].includes(created.state) ||
          asObject(asObject(created.preflight).executionProtocol).state === "running",
        executionStage: ["ready", "queued", "preflighting"].includes(created.state) ||
          asObject(asObject(created.preflight).executionProtocol).state === "running"
          ? "queued"
          : "failed",
        idempotentReplay: true,
        },
      });
    }
    if (typeof this.revalidateDrafts === "function") {
      await this.revalidateDrafts({
        context,
        storeId,
        draftIds,
        force: true,
      });
      if (typeof this.repository.get !== "function") {
        throw new PublishBatchError(
          "PUBLISH_DRAFT_REVALIDATION_UNAVAILABLE",
          "发布前草稿实时校验结果无法读取，请稍后重试",
          503,
        );
      }
      const refreshed = await this.repository.get({
        tenantId: context.tenantId,
        storeId,
        batchId: created.id,
      });
      if (!refreshed) {
        throw new PublishBatchError(
          "PUBLISH_BATCH_NOT_FOUND_AFTER_REVALIDATION",
          "发布批次在草稿实时校验后无法读取，请稍后重试",
          503,
        );
      }
      created = refreshed;
    }
    const itemsWithSkus = created.items.map((item) => ({
      ...item,
      supplierSkus: extractSupplierSkus(asObject(item.draft_data)),
      publishCandidateBlockers: getPublishCandidateBlockers(item),
      publishCandidate: asObject(asObject(item.draft_preflight).publishCandidate),
    }));
    const locallyBlocked = itemsWithSkus.filter(
      (item) => item.publishCandidateBlockers.length,
    );
    if (locallyBlocked.length) {
      const itemResults = itemsWithSkus.map((item) => ({
        id: item.id,
        state: "failed",
        preflight: {
          passed: false,
          directPublish: true,
          blockers: item.publishCandidateBlockers,
        },
        lastError: item.publishCandidateBlockers.join("；"),
      }));
      const preflighted = await this.repository.recordPreflight({
        tenantId: context.tenantId,
        storeId,
        batchId: created.id,
        result: {
          passed: false,
          directPublish: true,
          blockers: locallyBlocked.flatMap((item) => item.publishCandidateBlockers),
        },
        itemResults,
        userId: context.userId,
      });
      return {
        batch: publicBatch(preflighted, preflighted.items.map((item, index) => publicItem(item, index))),
        publishingEnabled: true,
        executionQueued: false,
      };
    }

    let publishPreflight;
    try {
      publishPreflight = await this.preflightPublish({
        context,
        storeId,
        supplierSkuList: itemsWithSkus.flatMap((item) => item.supplierSkus),
      });
    } catch (error) {
      const publishError = normalizePublishError(error, "SHEIN只读预检失败");
      const message = publishError.message;
      const preflighted = await this.repository.recordPreflight({
        tenantId: context.tenantId,
        storeId,
        batchId: created.id,
        result: {
          passed: false,
          directPublish: true,
          blockers: [message],
          error: publishError,
        },
        itemResults: itemsWithSkus.map((item) => ({
          id: item.id,
          state: "failed",
          preflight: {
            passed: false,
            directPublish: true,
            blockers: [message],
            publishError,
          },
          lastError: message,
        })),
        userId: context.userId,
      });
      return {
        batch: publicBatch(preflighted, preflighted.items.map((item, index) => publicItem(item, index))),
        publishingEnabled: true,
        executionQueued: false,
      };
    }
    if (publishPreflight?.passed !== true) {
      const blockers = Array.isArray(publishPreflight?.blockers)
        ? publishPreflight.blockers.map((value) => String(value || "").trim()).filter(Boolean)
        : [];
      const message = blockers.join("；") || "SHEIN只读预检未通过";
      const publishError = normalizePublishError(
        asObject(publishPreflight).error || blockers[0],
        message,
      );
      const preflighted = await this.repository.recordPreflight({
        tenantId: context.tenantId,
        storeId,
        batchId: created.id,
        result: {
          ...publishPreflight,
          passed: false,
          directPublish: true,
          error: publishError,
        },
        itemResults: itemsWithSkus.map((item) => ({
          id: item.id,
          state: "failed",
          preflight: {
            ...publishPreflight,
            passed: false,
            directPublish: true,
            blockers,
            publishError,
          },
          lastError: message,
        })),
        userId: context.userId,
      });
      return {
        batch: publicBatch(preflighted, preflighted.items.map((item, index) => publicItem(item, index))),
        publishingEnabled: true,
        executionQueued: false,
      };
    }
    const itemResults = await Promise.all(itemsWithSkus.map(async (item) => {
      try {
        const remotePublishCandidate = await this.preparePublishCandidate({
          context,
          storeId,
          candidate: item.publishCandidate,
          publishPreflight,
          previousRemoteCandidate: {},
        });
        const blockers = (Array.isArray(remotePublishCandidate?.blockers)
          ? remotePublishCandidate.blockers
          : [])
          .map((blocker) => String(blocker?.message || "").trim())
          .filter(Boolean);
        const firstBlocker = Array.isArray(remotePublishCandidate?.blockers)
          ? remotePublishCandidate.blockers.find((blocker) => blocker?.message)
          : null;
        const publishError = firstBlocker
          ? normalizePublishError(firstBlocker, blockers.join("；"))
          : null;
        const ready =
          remotePublishCandidate?.state === "ready_for_publish_confirmation" &&
          Boolean(String(remotePublishCandidate?.fingerprint || "").trim()) &&
          blockers.length === 0;
        return {
          id: item.id,
          state: ready ? "ready" : "failed",
          preflight: {
            passed: ready,
            directPublish: true,
            blockers,
            supplierSkus: item.supplierSkus,
            publishCandidateFingerprint: String(item.publishCandidate.fingerprint || ""),
            remotePublishCandidate,
            ...(publishError ? { publishError } : {}),
          },
          lastError: blockers.join("；"),
        };
      } catch (error) {
        const publishError = normalizePublishError(error, "商品图片或发布载荷准备失败");
        const message = publishError.message;
        return {
          id: item.id,
          state: "failed",
          preflight: {
            passed: false,
            directPublish: true,
            blockers: [message],
            publishError,
          },
          lastError: message,
        };
      }
    }));
    const preflighted = await this.repository.recordPreflight({
      tenantId: context.tenantId,
      storeId,
      batchId: created.id,
      result: {
        passed: itemResults.every((item) => item.state === "ready"),
        directPublish: true,
        blockers: itemResults.flatMap((item) => item.lastError ? [item.lastError] : []),
      },
      itemResults,
      userId: context.userId,
    });
    if (preflighted.state !== "ready") {
      return {
        batch: publicBatch(preflighted, preflighted.items.map((item, index) => publicItem(item, index))),
        publishingEnabled: true,
        executionQueued: false,
      };
    }
    await this.act({ context, storeId, batchId: preflighted.id, action: "confirm" });
    await this.act({ context, storeId, batchId: preflighted.id, action: "plan-execution" });
    await this.act({ context, storeId, batchId: preflighted.id, action: "authorize-execution" });
    const executed = await this.act({
      context,
      storeId,
      batchId: preflighted.id,
      action: "execute",
      confirmation: PRODUCT_PUBLISH_EXECUTION_CONFIRMATION,
    });
    return this.#withFastAcknowledgement({ context, storeId, result: executed });
  }

  async act({ context, storeId, batchId, action, confirmation = "" }) {
    const normalizedAction = String(action || "").trim();
    const existing = await this.repository.get({
      tenantId: context.tenantId,
      storeId,
      batchId,
    });
    if (!existing) {
      throw new PublishBatchError("BATCH_NOT_FOUND", "发布批次不存在", 404);
    }
    if (!ACTIVE_STATES.has(existing.state)) {
      throw new PublishBatchError("INVALID_BATCH_STATE", "发布批次状态无效");
    }

    if (normalizedAction === "execute") {
      if (!this.executionEnabled) {
        throw new PublishBatchError(
          "PRODUCT_PUBLISH_EXECUTION_DISABLED",
          "SHEIN商品真实发布执行尚未启用",
          503,
        );
      }
      if (confirmation !== PRODUCT_PUBLISH_EXECUTION_CONFIRMATION) {
        throw new PublishBatchError(
          "PRODUCT_PUBLISH_CONFIRMATION_REQUIRED",
          "真实发布需要当前用户再次明确确认",
          409,
        );
      }
      const preflight = asObject(existing.preflight);
      const protocol = asObject(preflight.executionProtocol);
      const executionRunId = String(protocol.executionRunId || "").trim();
      if (!executionRunId || !["issued", "running"].includes(protocol.state)) {
        throw new PublishBatchError(
          "EXECUTION_AUTHORIZATION_NOT_ACTIVE",
          "当前批次没有可消费的一次性执行授权",
          409,
        );
      }
      let row = existing;
      if (protocol.state === "running") {
        return {
          batch: publicBatch(existing, existing.items.map((item, index) => publicItem(item, index))),
          publishingEnabled: true,
          executionQueued: true,
          executionStage: "queued",
          idempotentReplay: true,
        };
      }
      if (protocol.state === "issued") {
        const consumedAt = this.now();
        let consumedProtocol;
        try {
          consumedProtocol = consumePublishExecutionAuthorization(protocol, {
            executionRunId,
            consumedAt,
          });
        } catch (error) {
          throw new PublishBatchError(
            error?.code || "EXECUTION_AUTHORIZATION_NOT_ACTIVE",
            error?.message || "一次性执行授权不可用",
            error?.status || 409,
          );
        }
        row = await this.repository.consumeExecutionProtocol({
          tenantId: context.tenantId,
          storeId,
          batchId,
          executionRunId,
          expectedBatchPreflight: preflight,
          batchPreflight: {
            ...preflight,
            executionProtocol: consumedProtocol,
          },
          protocol,
          consumedAt,
          userId: context.userId,
        });
      }
      return {
        batch: publicBatch(row, row.items.map((item, index) => publicItem(item, index))),
        publishingEnabled: true,
        executionQueued: true,
        executionStage: "queued",
      };
    }

    if (normalizedAction === "pause") {
      const row = await this.repository.setState({
        tenantId: context.tenantId,
        storeId,
        batchId,
        batchState: "paused",
        itemState: "paused",
        userId: context.userId,
      });
      return { batch: publicBatch(row, row.items.map((item, index) => publicItem(item, index))) };
    }

    if (["resume", "retry"].includes(normalizedAction)) {
      const row = await this.repository.setState({
        tenantId: context.tenantId,
        storeId,
        batchId,
        batchState: "queued",
        itemState: "queued",
        userId: context.userId,
      });
      return { batch: publicBatch(row, row.items.map((item, index) => publicItem(item, index))) };
    }

    if (normalizedAction === "confirm") {
      const snapshot = confirmationSnapshot(existing);
      const previous = asObject(asObject(existing.preflight).confirmation);
      if (
        previous.state === "confirmed" &&
        previous.batchFingerprint === snapshot.batchFingerprint &&
        previous.authorizesPublishing === false
      ) {
        return {
          batch: publicBatch(existing, existing.items.map((item, index) => publicItem(item, index))),
          publishingEnabled: false,
        };
      }
      const confirmedAt = this.now().toISOString();
      const confirmation = {
        state: "confirmed",
        confirmedAt,
        confirmedBy: context.userId,
        batchFingerprint: snapshot.batchFingerprint,
        items: snapshot.items,
        authorizesPublishing: false,
      };
      const row = await this.repository.confirm({
        tenantId: context.tenantId,
        storeId,
        batchId,
        expectedBatchPreflight: asObject(existing.preflight),
        batchPreflight: {
          ...asObject(existing.preflight),
          confirmation,
          publishingEnabled: false,
        },
        itemResults: existing.items.map((item) => ({
          id: item.id,
          expectedPreflight: asObject(item.preflight),
          preflight: {
            ...asObject(item.preflight),
            confirmation: {
              state: "confirmed",
              confirmedAt,
              confirmedBy: context.userId,
              batchFingerprint: snapshot.batchFingerprint,
              authorizesPublishing: false,
            },
          },
        })),
        userId: context.userId,
      });
      return {
          batch: publicBatch(row, row.items.map((item, index) => publicItem(item, index))),
        publishingEnabled: false,
      };
    }

    if (normalizedAction === "plan-execution") {
      const snapshot = confirmationSnapshot(existing);
      const plan = buildExecutionPlan(
        existing,
        snapshot,
        this.now().toISOString(),
        context.userId,
      );
      const previous = asObject(asObject(existing.preflight).executionPlan);
      if (
        previous.state === "ready_for_execution_confirmation" &&
        previous.fingerprint === plan.fingerprint &&
        previous.executionEnabled === false &&
        previous.authorizesPublishing === false
      ) {
        return {
          batch: publicBatch(existing, existing.items.map((item, index) => publicItem(item, index))),
          publishingEnabled: false,
        };
      }
      const row = await this.repository.recordExecutionPlan({
        tenantId: context.tenantId,
        storeId,
        batchId,
        expectedBatchPreflight: asObject(existing.preflight),
        batchPreflight: {
          ...asObject(existing.preflight),
          executionPlan: plan,
          publishingEnabled: false,
        },
        userId: context.userId,
      });
      return {
          batch: publicBatch(row, row.items.map((item, index) => publicItem(item, index))),
        publishingEnabled: false,
      };
    }

    if (normalizedAction === "authorize-execution") {
      const snapshot = confirmationSnapshot(existing);
      const storedPlan = asObject(asObject(existing.preflight).executionPlan);
      const currentPlan = buildExecutionPlan(
        existing,
        snapshot,
        storedPlan.plannedAt || this.now().toISOString(),
        storedPlan.plannedBy || context.userId,
      );
      if (
        storedPlan.state !== "ready_for_execution_confirmation" ||
        storedPlan.fingerprint !== currentPlan.fingerprint ||
        storedPlan.executionEnabled !== false ||
        storedPlan.authorizesPublishing !== false
      ) {
        throw new PublishBatchError(
          "EXECUTION_AUTHORIZATION_STALE",
          "执行计划已变化，请重新生成并核对执行计划",
          409,
        );
      }
      const now = this.now();
      const previous = asObject(asObject(existing.preflight).executionProtocol);
      if (
        previous.executionPlanFingerprint === storedPlan.fingerprint &&
        previous.executionEnabled === false &&
        previous.authorizesPublishing === false &&
        isPublishExecutionAuthorizationActive(previous, now)
      ) {
        return {
          batch: publicBatch(existing, existing.items.map((item, index) => publicItem(item, index))),
          publishingEnabled: false,
        };
      }
      const protocol = buildPublishExecutionProtocol({
        batchId: existing.id,
        plan: storedPlan,
        authorizedAt: now,
        authorizedBy: context.userId,
        authorizationId: this.randomId(),
        authorizationTtlMs: this.executionAuthorizationTtlMs,
      });
      const row = await this.repository.recordExecutionProtocol({
        tenantId: context.tenantId,
        storeId,
        batchId,
        expectedBatchPreflight: asObject(existing.preflight),
        batchPreflight: {
          ...asObject(existing.preflight),
          executionProtocol: protocol,
          publishingEnabled: false,
        },
        userId: context.userId,
      });
      return {
          batch: publicBatch(row, row.items.map((item, index) => publicItem(item, index))),
        publishingEnabled: false,
      };
    }

    if (normalizedAction !== "preflight") {
      throw new PublishBatchError(
        "INVALID_BATCH_ACTION",
        "仅支持preflight、confirm、plan-execution、authorize-execution、execute、pause、resume或retry",
      );
    }
    if (existing.state === "paused") {
      throw new PublishBatchError(
        "BATCH_PAUSED",
        "批次已暂停，请先恢复后再预检",
        409,
      );
    }
    if (existing.state === "ready") {
      return {
          batch: publicBatch(existing, existing.items.map((item, index) => publicItem(item, index))),
        publishingEnabled: false,
      };
    }

    await this.repository.setState({
      tenantId: context.tenantId,
      storeId,
      batchId,
      batchState: "preflighting",
      itemState: "preflighting",
      userId: context.userId,
    });

    const itemsWithSkus = existing.items.map((item) => ({
      ...item,
      supplierSkus: extractSupplierSkus(asObject(item.draft_data)),
      publishCandidateBlockers: getPublishCandidateBlockers(item),
      publishCandidateFingerprint: String(
        asObject(asObject(item.draft_preflight).publishCandidate).fingerprint ||
          "",
      ),
      publishCandidate: asObject(
        asObject(item.draft_preflight).publishCandidate,
      ),
    }));
    const locallyBlocked = itemsWithSkus.filter(
      (item) => item.publishCandidateBlockers.length,
    );
    if (locallyBlocked.length) {
      const message = `${locallyBlocked.length}个草稿存在本地预检阻断`;
      const result = {
        passed: false,
        blockers: [message],
        publishingEnabled: false,
      };
      const row = await this.repository.recordPreflight({
        tenantId: context.tenantId,
        storeId,
        batchId,
        result,
        itemResults: itemsWithSkus.map((item) => ({
          id: item.id,
          state: !item.publishCandidateBlockers.length
            ? "queued"
            : "failed",
          preflight: !item.publishCandidateBlockers.length
            ? {}
            : {
                passed: false,
                blockers: item.publishCandidateBlockers,
              },
          lastError: item.publishCandidateBlockers.join("；"),
        })),
        userId: context.userId,
      });
      return {
        batch: publicBatch(row, row.items.map((item, index) => publicItem(item, index))),
        publishingEnabled: false,
      };
    }

    let result;
    try {
      result = await this.preflightPublish({
        context,
        storeId,
        supplierSkuList: itemsWithSkus.flatMap((item) => item.supplierSkus),
      });
    } catch (error) {
      const publishError = normalizePublishError(error, "SHEIN只读预检失败");
      const message = publishError.message;
      const row = await this.repository.recordPreflight({
        tenantId: context.tenantId,
        storeId,
        batchId,
        result: { passed: false, blockers: [message], error: publishError },
        itemResults: itemsWithSkus.map((item) => ({
          id: item.id,
          state: "failed",
          preflight: { passed: false, blockers: [message], publishError },
          lastError: message,
        })),
        userId: context.userId,
      });
      return {
        batch: publicBatch(row, row.items.map((item, index) => publicItem(item, index))),
        publishingEnabled: false,
      };
    }

    const itemResults = await Promise.all(itemsWithSkus.map(async (item) => {
      let remotePublishCandidate;
      try {
        remotePublishCandidate = await this.preparePublishCandidate({
          context,
          storeId,
          candidate: item.publishCandidate,
          publishPreflight: result,
          previousRemoteCandidate: asObject(item.preflight)
            .remotePublishCandidate,
        });
      } catch (error) {
        remotePublishCandidate = {
          state: "blocked",
          publishingEnabled: false,
          fingerprint: "",
          requestBody: null,
          blockers: [{
            code: "REMOTE_PREFLIGHT_FAILED",
            message: error?.message || "SHEIN远程预检失败",
          }],
        };
      }
      const blockers = (Array.isArray(remotePublishCandidate?.blockers)
        ? remotePublishCandidate.blockers
        : [])
        .map((blocker) => String(blocker?.message || "").trim())
        .filter(Boolean);
      const firstBlocker = Array.isArray(remotePublishCandidate?.blockers)
        ? remotePublishCandidate.blockers.find((blocker) => blocker?.message)
        : null;
      const publishError = firstBlocker
        ? normalizePublishError(firstBlocker, blockers.join("；"))
        : null;
      const ready =
        remotePublishCandidate?.state === "ready_for_publish_confirmation" &&
        Boolean(String(remotePublishCandidate?.fingerprint || "").trim()) &&
        blockers.length === 0;
      return {
        id: item.id,
        state: ready ? "ready" : "failed",
        preflight: {
          passed: ready,
          blockers,
          supplierSkus: item.supplierSkus,
          publishCandidateFingerprint: item.publishCandidateFingerprint,
          remotePublishCandidate,
          ...(publishError ? { publishError } : {}),
        },
        lastError: blockers.join("；"),
      };
    }));
    const row = await this.repository.recordPreflight({
      tenantId: context.tenantId,
      storeId,
      batchId,
      result: { ...result, publishingEnabled: false },
      itemResults,
      userId: context.userId,
    });
    return {
      batch: publicBatch(row, row.items.map((item, index) => publicItem(item, index))),
      publishingEnabled: false,
    };
  }
}
