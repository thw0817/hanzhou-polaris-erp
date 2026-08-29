import { WebAuthError } from "./web-auth.js";
import {
  classifyReviewCenterStatus,
  normalizeWorkflowStageValue as normalizeUnifiedWorkflowStageValue,
} from "./review-center-status.js";
import { projectPublishAttempts } from "./review-center-attempts.js";

const ALL_CHANNEL_EVENT = "product_document_audit_status_notice_all_channels";
const AUDIT_EVENT = "product_document_audit_status_notice";
const RECEIVE_EVENT = "product_document_receive_status_notice";
const AUDIT_LABELS = new Map([
  [1, "pending"],
  [2, "passed"],
  [3, "failed"],
  [4, "withdrawn"],
]);

const EFFECTIVE_PUBLISH_SPU_NAME_SQL = `
  COALESCE(
    NULLIF(job.request_summary->>'spuName', ''),
    NULLIF(job.receipt->>'spuName', '')
  )
`;

const EFFECTIVE_PUBLISH_SKC_NAMES_SQL = `
  CASE
    WHEN jsonb_typeof(job.request_summary->'skcNames') = 'array'
         AND jsonb_array_length(job.request_summary->'skcNames') > 0
      THEN job.request_summary->'skcNames'
    WHEN EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(job.receipt->'skcs', '[]'::jsonb)) AS receipt_skc
      WHERE NULLIF(receipt_skc->>'skcName', '') IS NOT NULL
    )
      THEN COALESCE(
        (
          SELECT jsonb_agg(receipt_skc->>'skcName')
          FROM jsonb_array_elements(COALESCE(job.receipt->'skcs', '[]'::jsonb)) AS receipt_skc
          WHERE NULLIF(receipt_skc->>'skcName', '') IS NOT NULL
        ),
        '[]'::jsonb
      )
    WHEN review_state.skc_name IS NOT NULL
      THEN jsonb_build_array(review_state.skc_name)
    ELSE '[]'::jsonb
  END
`;

export function normalizeWorkflowStageValue(value) {
  return normalizeUnifiedWorkflowStageValue(value);
}

function workflowStage(row, { isReceive = false, auditState = null } = {}) {
  const raw = [
    row.workflowStage,
    row.workflow_stage,
    row.reviewStageValue,
    row.review_stage_value,
    row.stage,
    row.auditStage,
    row.audit_stage,
  ].map((value) => text(value, 80).toLowerCase()).find(Boolean);
  const auditStateLabel = text(row.auditStateLabel ?? row.audit_state_label, 80).toLowerCase();
  if (Number(auditState) === 3 || ["failed", "rejected", "reject", "审核失败", "驳回", "已驳回"].includes(auditStateLabel)) return "rejected";
  const explicit = normalizeWorkflowStageValue(raw);
  if (explicit) return explicit;
  if (Number(auditState) === 2) return "passed";
  if (isReceive && row.receivedSuccess === true) return "awaiting_review";
  if (Number(auditState) === 1) return "awaiting_review";
  return null;
}

function resolvedWorkflowStage({ auditState = null, auditStateLabel = "", workflowStage = "" } = {}) {
  const normalizedAuditLabel = text(auditStateLabel, 80).toLowerCase();
  if (Number(auditState) === 3 || ["failed", "rejected", "reject", "审核失败", "驳回", "已驳回"].includes(normalizedAuditLabel)) {
    return "rejected";
  }
  const explicit = normalizeWorkflowStageValue(workflowStage);
  if (explicit) return explicit;
  if (Number(auditState) === 1) return "awaiting_review";
  if (Number(auditState) === 2) return "passed";
  return null;
}

function isRejectedReviewState(state, item) {
  const labels = [state?.audit_state_label, item?.auditStateLabel]
    .map((value) => text(value, 80).toLowerCase());
  return state?.audit_state === 3
    || item?.auditState === 3
    || labels.some((label) => ["failed", "rejected", "reject", "审核失败", "驳回", "已驳回"].includes(label));
}

function isVersionlessTerminalPublishFailure(attempt) {
  const state = text(attempt?.executionState, 80).toLowerCase();
  return !text(attempt?.sheinVersion, 200)
    && ["failed", "failed_terminal", "failed_retryable"].includes(state);
}

function isTerminalPublishAudit(attempt) {
  const state = Number(attempt?.documentAuditState);
  const label = text(attempt?.documentAuditStateLabel, 80).toLowerCase();
  return state === 3
    || ["failed", "rejected", "reject", "审核失败", "驳回", "已驳回"].includes(label);
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value, maxLength = 500) {
  const result = typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
  return result.slice(0, maxLength);
}

function textArray(value, maxLength = 200) {
  const parsed = safeJson(value);
  const values = Array.isArray(parsed) ? parsed : Array.isArray(value) ? value : [];
  return values.map((item) => text(item, maxLength)).filter(Boolean);
}

function safeJson(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function timestampOrNull(value) {
  const raw = text(value, 100);
  if (!raw) return null;
  const numeric = /^\d{10,13}$/.test(raw) ? Number(raw) : null;
  const parsed = new Date(numeric === null ? raw : raw.length === 10 ? numeric * 1000 : numeric);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function comparableTime(value) {
  const parsed = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(parsed) ? parsed : -Infinity;
}

function compareReviewVersions(left, right) {
  const leftValue = text(left, 200);
  const rightValue = text(right, 200);
  if (!leftValue && !rightValue) return 0;
  if (!leftValue) return -1;
  if (!rightValue) return 1;
  const leftNumber = /^\d+(?:\.\d+)?$/.test(leftValue) ? Number(leftValue) : NaN;
  const rightNumber = /^\d+(?:\.\d+)?$/.test(rightValue) ? Number(rightValue) : NaN;
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) {
    return leftNumber - rightNumber;
  }
  return leftValue.localeCompare(rightValue);
}

function isNewerReview(left, right) {
  if (!right) return true;
  const leftTime = comparableTime(left.updatedAt);
  const rightTime = comparableTime(right.updatedAt);
  if (leftTime !== rightTime) return leftTime > rightTime;
  const versionComparison = compareReviewVersions(left.version, right.version);
  if (versionComparison !== 0) return versionComparison > 0;
  return String(left.reviewKey || "") > String(right.reviewKey || "");
}

function unwrapRecords(value) {
  const parsed = safeJson(value);
  if (!parsed || typeof parsed !== "object") return [];
  if (Array.isArray(parsed)) return parsed;
  if (parsed.data !== undefined && parsed.data !== parsed) {
    const data = safeJson(parsed.data);
    if (Array.isArray(data)) return data;
    return data && typeof data === "object" ? [data] : [];
  }
  return [parsed];
}

function skuCodes(value) {
  return Array.isArray(value)
    ? value.map((item) => text(object(item).sku_code ?? object(item).skuCode, 200)).filter(Boolean)
    : [];
}

function failedReasons(value) {
  return Array.isArray(value)
    ? value.map((item) => ({
        language: text(object(item).language, 40) || null,
        content: text(object(item).content ?? object(item).message, 2_000) || null,
      })).filter((item) => item.content)
    : [];
}

function reviewKey(record, fallback = "") {
  const version = text(record.version, 200);
  const documentSn = text(record.documentSn ?? record.document_sn, 200);
  const skcName = text(record.skcName ?? record.skc_name, 200);
  if (version) return `version:${version}`;
  if (documentSn) return `document:${documentSn}`;
  if (skcName) return `skc:${skcName}`;
  return fallback ? `event:${fallback}` : "";
}

function normalizeRecord(record, event, index) {
  const row = object(record);
  const rawAuditState = row.auditState ?? row.audit_state;
  const auditState = Number.isInteger(Number(rawAuditState))
    ? Number(rawAuditState)
    : null;
  const isReceive = event.event_type === RECEIVE_EVENT;
  const rawReceiveSuccess = row.receivedSuccess ?? row.received_success;
  const receiveStatus = isReceive
    ? text(row.status ?? (
        rawReceiveSuccess === true
          ? "accepted"
          : rawReceiveSuccess === false
            ? "failed"
            : "unknown"
      ), 40)
    : null;
  const normalized = {
    reviewKey: "",
    source: event.event_type === ALL_CHANNEL_EVENT ? "shein_backend" : "open_api",
    version: text(row.version, 200) || null,
    documentSn: text(row.documentSn ?? row.document_sn, 200) || null,
    spuName: text(row.spuName ?? row.spu_name, 200) || null,
    skcName: text(row.skcName ?? row.skc_name, 200) || null,
    skuCodes: Array.isArray(row.skuCodes)
      ? row.skuCodes.map((value) => text(value, 200)).filter(Boolean)
      : skuCodes(row.sku_list),
    auditState,
    auditStateLabel: text(row.auditStateLabel ?? row.audit_state_label, 40)
      || AUDIT_LABELS.get(auditState)
      || "unknown",
    reviewStage: isReceive ? "received" : "audited",
    workflowStage: workflowStage(row, { isReceive, auditState }),
    receiveStatus,
    failedReasons: failedReasons(row.failedReasons ?? row.failed_reason),
    updatedAt: text(row.occurredAt ?? row.auditTime ?? row.audit_time, 100)
      || event.received_at
      || null,
    receivedAt: text(event.received_at, 100) || null,
    eventId: text(event.id, 100) || null,
  };
  normalized.reviewKey = reviewKey(normalized, `${text(event.id, 100)}:${index}`);
  return normalized.reviewKey ? normalized : null;
}

export function countProductReviewRejections(events = []) {
  let count = 0;
  for (const eventValue of Array.isArray(events) ? events : []) {
    const event = object(eventValue);
    const records = event.event_type === AUDIT_EVENT || event.event_type === RECEIVE_EVENT
      ? (Array.isArray(object(event.projection).records)
          ? object(event.projection).records
          : unwrapRecords(event.payload))
      : unwrapRecords(event.payload);
    for (const record of records) {
      const row = object(record);
      const auditState = Number(row.auditState ?? row.audit_state);
      if (auditState === 3 || workflowStage(row, { auditState }) === "rejected") count += 1;
    }
  }
  return count;
}

export function countProductReviewRejectionsBySkc(events = []) {
  const counts = new Map();
  for (const eventValue of Array.isArray(events) ? events : []) {
    const event = object(eventValue);
    const records = event.event_type === AUDIT_EVENT || event.event_type === RECEIVE_EVENT
      ? (Array.isArray(object(event.projection).records)
          ? object(event.projection).records
          : unwrapRecords(event.payload))
      : unwrapRecords(event.payload);
    for (const record of records) {
      const row = object(record);
      const auditState = Number(row.auditState ?? row.audit_state);
      if (auditState !== 3 && workflowStage(row, { auditState }) !== "rejected") continue;
      const skc = text(row.skcName ?? row.skc_name, 200);
      if (skc) counts.set(skc, (counts.get(skc) || 0) + 1);
    }
  }
  return counts;
}

export function normalizeProductReviewEvents(events = []) {
  const rows = [];
  for (const eventValue of Array.isArray(events) ? events : []) {
    const event = object(eventValue);
    const records = event.event_type === AUDIT_EVENT || event.event_type === RECEIVE_EVENT
      ? (Array.isArray(object(event.projection).records)
          ? object(event.projection).records
          : unwrapRecords(event.payload))
      : unwrapRecords(event.payload);
    records.forEach((record, index) => {
      const normalized = normalizeRecord(record, event, index);
      if (normalized) rows.push(normalized);
    });
  }
  const latest = new Map();
  for (const row of rows) {
    const previous = latest.get(row.reviewKey);
    const rowUpdatedAt = comparableTime(row.updatedAt);
    const previousUpdatedAt = comparableTime(previous?.updatedAt);
    const rowReceivedAt = comparableTime(row.receivedAt);
    const previousReceivedAt = comparableTime(previous?.receivedAt);
    const isNewer = !previous
      || rowUpdatedAt > previousUpdatedAt
      || (rowUpdatedAt === previousUpdatedAt && rowReceivedAt > previousReceivedAt)
      || (rowUpdatedAt === previousUpdatedAt
        && rowReceivedAt === previousReceivedAt
        && String(row.eventId || "") > String(previous.eventId || ""));
    if (isNewer) {
      latest.set(row.reviewKey, {
        ...previous,
        ...row,
        failedReasons: row.failedReasons.length
          ? row.failedReasons
          : previous?.failedReasons || [],
      });
    }
  }
  return [...latest.values()];
}

function publicSample(rawData) {
  const snapshot = object(object(rawData).businessSnapshot);
  const sample = object(snapshot.sampleInfo);
  const hasSample = Object.keys(sample).length > 0;
  return hasSample ? {
    reserveSampleFlag: sample.reserveSampleFlag ?? null,
    spotFlag: sample.spotFlag ?? null,
    sampleJudgeType: sample.sampleJudgeType ?? null,
    sampleCode: text(sample.sampleCode, 200) || null,
  } : null;
}

function firstImageUrl(values) {
  for (const value of values) {
    const source = object(value);
    const candidate = text(
      typeof value === "string"
        ? value
        : source.url ?? source.imageUrl ?? source.previewUrl,
      2_000,
    );
    if (/^https?:\/\//iu.test(candidate)) return candidate;
  }
  return "";
}

function productImage(rawData, spuRawData) {
  const raw = { ...object(spuRawData), ...object(rawData) };
  const snapshot = object(raw.businessSnapshot);
  return firstImageUrl([
    snapshot.imageUrl,
    snapshot.image,
    snapshot.mainImageUrl,
    snapshot.mainPicUrl,
    snapshot.mainPic,
    object(snapshot.imageAssets).main?.[0],
    object(snapshot.images).main?.[0],
    Array.isArray(snapshot.imageList) ? snapshot.imageList[0] : null,
    raw.imageUrl,
    raw.image,
    raw.mainImageUrl,
    raw.mainPicUrl,
    raw.mainPic,
  ]);
}

export class PostgresProductReviewRepository {
  constructor({ pool } = {}) {
    if (!pool) throw new Error("PostgresProductReviewRepository 缺少 pool");
    this.pool = pool;
  }

  async listSources({ tenantId, storeId } = {}) {
    const values = [tenantId, storeId];
    const [events, states, products, archived, localDrafts] = await Promise.all([
      this.pool.query({
        text: `SELECT id, event_type, payload, projection, received_at
               FROM webhook_events
               WHERE tenant_id = $1 AND store_id = $2
                 AND source = 'production'
                 AND event_type IN (
                   'product_document_receive_status_notice',
                   'product_document_audit_status_notice',
                   'product_document_audit_status_notice_all_channels'
                 )
               ORDER BY received_at DESC, id DESC
               LIMIT 1000`,
        values,
      }),
      this.pool.query({
        text: `SELECT review_key, version, document_sn, spu_name, skc_name,
                      sku_codes, audit_state, audit_state_label, failed_reasons,
                      workflow_stage, occurred_at, updated_at
               FROM product_review_states
               WHERE tenant_id = $1 AND store_id = $2
                 AND archived_at IS NULL`,
        values,
      }),
      this.pool.query({
        text: `SELECT skc.skc_name, skc.shelf_status, skc.raw_data,
                      spu.raw_data AS spu_raw_data,
                      COALESCE(NULLIF(spu.title, ''), skc.supplier_code, skc.skc_name) AS title
               FROM skcs AS skc
               LEFT JOIN spus AS spu
                 ON spu.id = skc.spu_id
                AND spu.tenant_id = skc.tenant_id
                AND spu.store_id = skc.store_id
               WHERE skc.tenant_id = $1 AND skc.store_id = $2`,
        values,
      }),
      this.pool.query({
        text: `SELECT review_key
               FROM product_review_states
               WHERE tenant_id = $1 AND store_id = $2
                 AND archived_at IS NOT NULL`,
        values,
      }),
      this.pool.query({
        text: `SELECT
                      COALESCE(
                        ('version:' || job.shein_version),
                        ('job:' || job.id)
                      ) AS review_key,
                      job.product_draft_id,
                      draft.status AS draft_status,
                      draft.draft_data->>'title' AS draft_title,
                      COALESCE(
                        draft.draft_data #>> '{imageAssets,main,0,assetId}',
                        draft.draft_data #>> '{imageAssets,main,0,id}'
                      ) AS main_asset_id,
                      job.id AS publish_job_id,
                      job.request_key,
                      job.publish_batch_id,
                      job.execution_run_id,
                      job.request_summary,
                      job.shein_version AS version,
                      job.shein_document_sn AS document_sn,
                      job.state AS publish_job_state,
                      job.attempt_count AS execution_attempt_count,
                      job.source_candidate_fingerprint,
                      job.remote_candidate_fingerprint,
                      job.last_error,
                      job.trace_id,
                      job.created_at AS job_created_at,
                      job.submitted_at AS job_submitted_at,
                      job.updated_at AS job_updated_at,
                      ${EFFECTIVE_PUBLISH_SPU_NAME_SQL} AS request_spu_name,
                      ${EFFECTIVE_PUBLISH_SKC_NAMES_SQL} AS request_skc_names,
                      latest_audit.version AS publish_audit_version,
                      latest_audit.payload->>'auditState' AS publish_audit_state,
                      latest_audit.payload->>'auditStateLabel' AS publish_audit_state_label,
                      latest_audit.status AS publish_audit_receipt_status,
                      latest_audit.occurred_at AS publish_audit_occurred_at,
                      latest_audit.created_at AS publish_audit_received_at
               FROM publish_jobs AS job
               JOIN product_drafts AS draft
                 ON draft.id = job.product_draft_id
                AND draft.tenant_id = job.tenant_id
                AND draft.store_id = job.store_id
               LEFT JOIN product_review_states AS review_state
                 ON review_state.tenant_id = job.tenant_id
                AND review_state.store_id = job.store_id
                AND review_state.version = job.shein_version
               LEFT JOIN LATERAL (
                 SELECT receipt.version,
                        receipt.payload,
                        receipt.status,
                        receipt.occurred_at,
                        receipt.created_at
                 FROM publish_receipts AS receipt
                 WHERE receipt.publish_job_id = job.id
                   AND receipt.tenant_id = job.tenant_id
                   AND receipt.store_id = job.store_id
                   AND receipt.receipt_type IN ('audited', 'document_state')
                 ORDER BY receipt.occurred_at DESC NULLS LAST, receipt.created_at DESC
                 LIMIT 1
               ) AS latest_audit ON TRUE
               WHERE job.tenant_id = $1 AND job.store_id = $2
               ORDER BY job.updated_at DESC, job.id DESC`,
        values,
      }),
    ]);
    return {
      events: events.rows,
      states: states.rows,
      products: products.rows,
      archivedKeys: archived.rows.map((row) => row.review_key),
      localDrafts: localDrafts.rows,
    };
  }

  async saveDocumentStates({ tenantId, storeId, records = [] } = {}) {
    const normalized = records.map((record) => ({
      review_key: reviewKey(record),
      version: text(record?.version, 200) || null,
      document_sn: text(record?.documentSn, 200) || null,
      spu_name: text(record?.spuName, 200) || null,
      skc_name: text(record?.skcName, 200) || null,
      sku_codes: Array.isArray(record?.skuCodes) ? record.skuCodes.map((value) => text(value, 200)).filter(Boolean) : [],
      audit_state: Number.isInteger(Number(record?.auditState)) ? Number(record.auditState) : null,
      audit_state_label: text(record?.auditStateLabel, 40) || "unknown",
      failed_reasons: failedReasons(record?.failedReasons),
      workflow_stage: text(record?.workflowStage, 80) || null,
      occurred_at: timestampOrNull(record?.occurredAt ?? record?.auditTime),
    })).filter((record) => record.review_key);
    if (!normalized.length) return { savedCount: 0 };
    const result = await this.pool.query({
      text: `WITH input AS (
               SELECT * FROM jsonb_to_recordset($3::jsonb) AS row(
                 review_key text, version text, document_sn text, spu_name text,
                 skc_name text, sku_codes jsonb, audit_state integer,
                 audit_state_label text, failed_reasons jsonb, workflow_stage text,
                 occurred_at timestamptz
               )
             )
             INSERT INTO product_review_states (
               tenant_id, store_id, review_key, version, document_sn, spu_name,
               skc_name, sku_codes, audit_state, audit_state_label,
               failed_reasons, workflow_stage, occurred_at
             )
             SELECT $1, $2, review_key, version, document_sn, spu_name,
                    skc_name, COALESCE(sku_codes, '[]'::jsonb), audit_state,
                    audit_state_label, COALESCE(failed_reasons, '[]'::jsonb), workflow_stage, occurred_at
             FROM input
             ON CONFLICT (tenant_id, store_id, review_key) DO UPDATE SET
               version = COALESCE(EXCLUDED.version, product_review_states.version),
               document_sn = COALESCE(EXCLUDED.document_sn, product_review_states.document_sn),
               spu_name = COALESCE(EXCLUDED.spu_name, product_review_states.spu_name),
               skc_name = COALESCE(EXCLUDED.skc_name, product_review_states.skc_name),
               sku_codes = EXCLUDED.sku_codes,
               audit_state = EXCLUDED.audit_state,
               audit_state_label = EXCLUDED.audit_state_label,
               failed_reasons = EXCLUDED.failed_reasons,
               workflow_stage = COALESCE(EXCLUDED.workflow_stage, product_review_states.workflow_stage),
               occurred_at = COALESCE(EXCLUDED.occurred_at, product_review_states.occurred_at),
               updated_at = now()
             WHERE product_review_states.archived_at IS NULL
               AND (
                 product_review_states.occurred_at IS NULL
                 OR (
                   EXCLUDED.occurred_at IS NOT NULL
                   AND EXCLUDED.occurred_at >= product_review_states.occurred_at
                 )
               )`,
      values: [tenantId, storeId, JSON.stringify(normalized)],
    });
    return { savedCount: result.rowCount };
  }

  async archive({ tenantId, storeId, userId, reviewKey: key } = {}) {
    const result = await this.pool.query({
      text: `INSERT INTO product_review_states (
               tenant_id, store_id, review_key, archived_at, archived_by
             ) VALUES ($1, $2, $3, now(), $4)
             ON CONFLICT (tenant_id, store_id, review_key) DO UPDATE SET
               archived_at = now(), archived_by = EXCLUDED.archived_by,
               updated_at = now()
             RETURNING review_key, archived_at`,
      values: [tenantId, storeId, key, userId || null],
    });
    return result.rows[0];
  }

  async archiveMany({ tenantId, storeId, userId, reviewKeys = [] } = {}) {
    const keys = Array.from(new Set(reviewKeys.map((key) => text(key, 400)).filter(Boolean)));
    if (!keys.length) return [];
    const result = await this.pool.query({
      text: `INSERT INTO product_review_states (
               tenant_id, store_id, review_key, archived_at, archived_by
             )
             SELECT $1, $2, review_key, now(), $4
             FROM unnest($3::text[]) AS selected(review_key)
             ON CONFLICT (tenant_id, store_id, review_key) DO UPDATE SET
               archived_at = now(), archived_by = EXCLUDED.archived_by,
               updated_at = now()
             RETURNING review_key, archived_at`,
      values: [tenantId, storeId, keys, userId || null],
    });
    return result.rows;
  }
}

export class WebProductReviewService {
  constructor({ repository } = {}) {
    if (!repository) throw new Error("WebProductReviewService 缺少 repository");
    this.repository = repository;
  }

  async list({ context, storeId } = {}) {
    const sources = await this.repository.listSources({
      tenantId: context.tenantId,
      storeId,
    });
    const archivedKeys = Array.isArray(sources.archivedKeys) ? sources.archivedKeys : [];
    const archived = new Set(archivedKeys);
    const stateByKey = new Map((sources.states || []).map((row) => [row.review_key, row]));
    const productBySkc = new Map((sources.products || []).map((row) => [text(row.skc_name, 200), row]));
    const listedSkcs = new Set((sources.products || [])
      .filter((row) => row.shelf_status === "已上架")
      .map((row) => text(row.skc_name, 200)));
    const localDraftByKey = new Map();
    const attemptProjection = projectPublishAttempts(sources.localDrafts);
    const launchBySkc = new Map();
    const currentLaunchBySkc = new Map();
    for (const row of sources.localDrafts || []) {
      if (!localDraftByKey.has(row.review_key)) localDraftByKey.set(row.review_key, row);
      const jobId = text(row.publish_job_id, 100) || row.review_key;
      const skcs = textArray(row.request_skc_names);
      for (const skc of skcs) {
        const current = launchBySkc.get(skc) || new Set();
        current.add(jobId);
        launchBySkc.set(skc, current);
      }
    }
    for (const [skcName, projection] of attemptProjection.bySkc) {
      currentLaunchBySkc.set(skcName, {
        row: (sources.localDrafts || []).find((candidate) =>
          candidate.publish_job_id === projection.current.localAttemptId,
        ) || null,
        version: projection.current.sheinVersion,
        attempt: projection.current,
        history: projection.history,
      });
    }
    const rejectionBySkc = countProductReviewRejectionsBySkc(sources.events);
    const baseByKey = new Map(normalizeProductReviewEvents(sources.events)
      .map((item) => [item.reviewKey, item]));
    for (const state of sources.states || []) {
      if (baseByKey.has(state.review_key)) continue;
      const item = {
        reviewKey: text(state.review_key, 400),
        source: "open_api",
        reviewStage: "document_state",
        receiveStatus: null,
        version: text(state.version, 200) || null,
        documentSn: text(state.document_sn, 200) || null,
        spuName: text(state.spu_name, 200) || null,
        skcName: text(state.skc_name, 200) || null,
        skuCodes: Array.isArray(state.sku_codes) ? state.sku_codes : [],
        auditState: state.audit_state ?? null,
        auditStateLabel: text(state.audit_state_label, 40) || "unknown",
        workflowStage: resolvedWorkflowStage({
          auditState: state.audit_state,
          auditStateLabel: state.audit_state_label,
          workflowStage: state.workflow_stage,
        }),
        failedReasons: failedReasons(state.failed_reasons),
        updatedAt: state.occurred_at || state.updated_at || null,
        eventId: null,
      };
      if (item.reviewKey) baseByKey.set(item.reviewKey, item);
    }
    // A relaunch creates a new SHEIN version. Keep the newest version as the
    // current task for each SKC, while retaining old versions for counters and
    // audit history. If SHEIN has not returned the new version yet, expose a
    // pending placeholder so the UI can query that version on manual refresh.
    for (const { row, version, attempt } of currentLaunchBySkc.values()) {
      if (!row || !attempt?.reviewKey || baseByKey.has(attempt.reviewKey)) continue;
      const skcs = textArray(row.request_skc_names);
      for (const skcValue of skcs) {
        const skcName = text(skcValue, 200);
        if (!skcName) continue;
        const hasOfficialRejection = [...baseByKey.values()].some((candidate) =>
          candidate.skcName === skcName
          && isRejectedReviewState(stateByKey.get(candidate.reviewKey), candidate),
        );
        if (isVersionlessTerminalPublishFailure(attempt) && hasOfficialRejection) continue;
        baseByKey.set(attempt.reviewKey, {
          reviewKey: attempt.reviewKey,
          source: "local_publish",
          reviewStage: "document_state",
          receiveStatus: null,
          version: version || null,
          documentSn: text(row.document_sn, 200) || null,
          spuName: text(row.request_spu_name, 200) || null,
          skcName,
          skuCodes: [],
          auditState: null,
          auditStateLabel: "unknown",
          workflowStage: null,
          failedReasons: [],
          updatedAt: row.job_updated_at || row.job_submitted_at || row.job_created_at || null,
          eventId: null,
        });
      }
    }
    const resolvedItems = [...baseByKey.values()].map((item) => {
      const state = stateByKey.get(item.reviewKey);
      const localDraft = localDraftByKey.get(item.reviewKey);
      const skcName = text(state?.skc_name ?? item.skcName, 200) || null;
      const currentLaunch = skcName ? currentLaunchBySkc.get(skcName) : null;
      const itemVersion = text(state?.version ?? item.version, 200) || null;
      const currentAttempt = currentLaunch?.attempt || null;
      const preserveOfficialRejection = Boolean(
        currentAttempt
        && isVersionlessTerminalPublishFailure(currentAttempt)
        && isRejectedReviewState(state, item),
      );
      if (
        currentAttempt
        && item.reviewKey !== currentAttempt.reviewKey
        && (!currentLaunch.version || itemVersion !== currentLaunch.version)
        && !preserveOfficialRejection
      ) return null;
      const product = skcName ? productBySkc.get(skcName) : null;
      const launchState = text(currentAttempt?.executionState || currentLaunch?.row?.publish_job_state, 40);
      const launchUpdatedAt = (currentLaunch?.row?.job_submitted_at || currentLaunch?.row?.job_updated_at)
        ? new Date(currentLaunch.row.job_submitted_at || currentLaunch.row.job_updated_at).getTime()
        : NaN;
      const officialObservedAt = state?.occurred_at
        || item.eventOccurredAt
        || state?.updated_at
        || item.updatedAt
        || null;
      const officialObservedTime = officialObservedAt ? new Date(officialObservedAt).getTime() : NaN;
      const hasTerminalAudit = isTerminalPublishAudit(currentAttempt);
      const awaitingReadback = ["authorized", "claimed", "submitted", "result_unknown"].includes(launchState)
        && !hasTerminalAudit;
      const staleRejectedAttempt = awaitingReadback
        && Number.isFinite(launchUpdatedAt)
        && Number.isFinite(officialObservedTime)
        && launchUpdatedAt > officialObservedTime
        && isRejectedReviewState(state, item);
      const auditState = staleRejectedAttempt ? null : state?.audit_state ?? item.auditState;
      const auditStateLabel = staleRejectedAttempt ? "unknown" : text(state?.audit_state_label, 40) || item.auditStateLabel;
      const workflowStage = staleRejectedAttempt ? null : resolvedWorkflowStage({
        auditState,
        auditStateLabel,
        workflowStage: state?.workflow_stage ?? item.workflowStage,
      });
      const resolution = classifyReviewCenterStatus({
        execution: {
          state: launchState,
          updatedAt: currentLaunch?.row?.job_updated_at || currentLaunch?.row?.job_submitted_at || null,
        },
        receive: { state: item.receiveStatus },
        audit: {
          state: auditState,
          stateLabel: auditStateLabel,
          workflowStage,
          occurredAt: officialObservedAt,
        },
        listing: { state: product?.shelf_status === "已上架" ? "listed" : "not_listed" },
        draftStatus: localDraft?.draft_status,
      });
      return {
        ...item,
        version: itemVersion,
        documentSn: text(state?.document_sn ?? item.documentSn, 200) || null,
        spuName: text(state?.spu_name ?? item.spuName, 200) || null,
        skcName,
        skuCodes: Array.isArray(state?.sku_codes) ? state.sku_codes : item.skuCodes,
        auditState,
        auditStateLabel,
        workflowStage,
        resolution,
        reviewStage: state ? "document_state" : item.reviewStage,
        failedReasons: Array.isArray(state?.failed_reasons) && state.failed_reasons.length
          ? failedReasons(state.failed_reasons)
          : item.failedReasons,
        title: text(product?.title, 500) || text(localDraft?.draft_title, 500) || skcName || text(state?.spu_name ?? item.spuName, 200) || "SHEIN 商品",
        imageUrl: productImage(product?.raw_data, product?.spu_raw_data),
        sample: publicSample(product?.raw_data),
        localDraftId: localDraft?.product_draft_id || null,
        localMainAssetId: text(localDraft?.main_asset_id, 200) || null,
        taskId: `skc:${skcName || item.reviewKey}`,
        launchCount: skcName ? (launchBySkc.get(skcName)?.size || 0) : 0,
        rejectionCount: skcName ? (rejectionBySkc.get(skcName) || 0) : 0,
        currentAttempt: Boolean(currentAttempt),
        attempt: currentAttempt,
        attemptHistory: currentLaunch?.history || [],
        canRelaunch: Boolean(
          localDraft?.product_draft_id
          && ["ready", "published", "archived"].includes(String(localDraft?.draft_status || "")),
        ),
        submissionState: awaitingReadback ? "awaiting_readback" : launchState === "completed" ? "confirmed" : null,
        updatedAt: state?.occurred_at || state?.updated_at || item.updatedAt,
      };
    }).filter((item) => item && !archived.has(item.reviewKey) && !(item.skcName && listedSkcs.has(item.skcName)));
    // A SKC can have several historical versions. The review center must show
    // only the current official version; older rejected/pending attempts stay
    // available through the task history counters, not as duplicate current
    // rows. A local relaunch version wins explicitly, otherwise use the most
    // recent official timestamp and then the version as a deterministic tie
    // breaker.
    const currentBySkc = new Map();
    for (const item of resolvedItems) {
      if (!item.skcName) continue;
      const previous = currentBySkc.get(item.skcName);
      if (!previous || isNewerReview(item, previous)) currentBySkc.set(item.skcName, item);
    }
    const items = resolvedItems.filter((item) => !item.skcName || currentBySkc.get(item.skcName)?.reviewKey === item.reviewKey);
    items.sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")));
    return {
      items,
      count: items.length,
      archivedKeys,
      readOnly: true,
      externalWrite: false,
    };
  }

  async archive({ context, storeId, reviewKey: key } = {}) {
    const normalizedKey = text(key, 400);
    if (!/^(version|document|skc|draft|event|job):.+/.test(normalizedKey)) {
      throw new WebAuthError("INVALID_REVIEW_KEY", "商品审核记录标识无效", 400);
    }
    const row = await this.repository.archive({
      tenantId: context.tenantId,
      storeId,
      userId: context.userId,
      reviewKey: normalizedKey,
    });
    return {
      reviewKey: row.review_key,
      archivedAt: row.archived_at,
      archived: true,
      externalWrite: false,
    };
  }

  async archiveMany({ context, storeId, reviewKeys = [] } = {}) {
    const keys = Array.from(new Set((Array.isArray(reviewKeys) ? reviewKeys : [])
      .map((key) => text(key, 400))
      .filter((key) => /^(version|document|skc|draft|event|job):.+/.test(key))));
    if (!keys.length) throw new WebAuthError("INVALID_REVIEW_KEY", "至少选择一条有效的商品审核记录", 400);
    if (typeof this.repository.archiveMany === "function") {
      const rows = await this.repository.archiveMany({
        tenantId: context.tenantId,
        storeId,
        userId: context.userId,
        reviewKeys: keys,
      });
      return { archived: true, count: rows.length, reviewKeys: keys, externalWrite: false };
    }
    await Promise.all(keys.map((reviewKey) => this.repository.archive({
      tenantId: context.tenantId,
      storeId,
      userId: context.userId,
      reviewKey,
    })));
    return { archived: true, count: keys.length, reviewKeys: keys, externalWrite: false };
  }
}
