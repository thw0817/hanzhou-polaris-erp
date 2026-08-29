const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function text(value) {
  return String(value ?? "").trim();
}

function ensureUuid(value, name) {
  const normalized = text(value);
  if (!UUID_PATTERN.test(normalized)) {
    throw new Erp06LegacyReadonlyError(
      "INVALID_LEGACY_READ_INPUT",
      `${name} 不是有效 UUID`,
    );
  }
  return normalized;
}

function legacyDisposition(row) {
  if (row.state === "result_unknown") return "legacy_unknown";
  if (!row.product_draft_id) return "unmatched";
  if (row.source_candidate_fingerprint && row.remote_candidate_fingerprint) {
    return "legacy_draft_bound";
  }
  return "legacy_unversioned";
}

function projectReceipt(row) {
  return {
    id: row.id,
    receiptType: row.receipt_type,
    status: row.status,
    traceId: row.trace_id || null,
    document: row.document || null,
    version: row.version || null,
    occurredAt: row.occurred_at || null,
  };
}

function projectJob(row, receipts) {
  return {
    source: "legacy_readonly",
    currentKind: "legacy_readonly",
    legacyDisposition: legacyDisposition(row),
    jobId: row.id,
    batchId: row.publish_batch_id || null,
    batchItemId: row.publish_batch_item_id || null,
    draftId: row.product_draft_id || null,
    state: row.state || "UNKNOWN",
    requestKey: row.request_key || null,
    sourceCandidateFingerprint: row.source_candidate_fingerprint || null,
    remoteCandidateFingerprint: row.remote_candidate_fingerprint || null,
    productVersionId: null,
    publishAttemptId: null,
    platform: {
      document: row.shein_document_sn || null,
      version: row.shein_version || null,
    },
    traceId: row.trace_id || null,
    receipts: receipts.map(projectReceipt),
    updatedAt: row.updated_at || null,
  };
}

export class Erp06LegacyReadonlyError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.name = "Erp06LegacyReadonlyError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class PostgresErp06LegacyReadonlyAdapter {
  constructor({ pool } = {}) {
    if (!pool) throw new Error("PostgresErp06LegacyReadonlyAdapter 缺少 pool");
    this.pool = pool;
  }

  async #loadReceipts({ tenantId, storeId, jobId }) {
    const result = await this.pool.query({
      text: `SELECT id, publish_job_id, receipt_type, status,
                    trace_id, document, version, occurred_at
             FROM publish_receipts
             WHERE tenant_id=$1 AND store_id=$2 AND publish_job_id=$3
             ORDER BY occurred_at ASC NULLS LAST, id ASC`,
      values: [tenantId, storeId, jobId],
    });
    return result.rows || [];
  }

  async getJob({ tenantId, storeId, jobId } = {}) {
    const scope = {
      tenantId: ensureUuid(tenantId, "tenantId"),
      storeId: ensureUuid(storeId, "storeId"),
      jobId: ensureUuid(jobId, "jobId"),
    };
    const result = await this.pool.query({
      text: `SELECT id, tenant_id, store_id, publish_batch_id,
                    publish_batch_item_id, product_draft_id, request_key,
                    source_candidate_fingerprint, remote_candidate_fingerprint,
                    state, shein_document_sn, shein_version, trace_id, updated_at
             FROM publish_jobs
             WHERE tenant_id=$1 AND store_id=$2 AND id=$3`,
      values: [scope.tenantId, scope.storeId, scope.jobId],
    });
    const job = result.rows[0] || null;
    if (!job) return null;
    return projectJob(job, await this.#loadReceipts(scope));
  }

  async listForDraft({ tenantId, storeId, draftId } = {}) {
    const scope = {
      tenantId: ensureUuid(tenantId, "tenantId"),
      storeId: ensureUuid(storeId, "storeId"),
      draftId: ensureUuid(draftId, "draftId"),
    };
    const result = await this.pool.query({
      text: `SELECT id, tenant_id, store_id, publish_batch_id,
                    publish_batch_item_id, product_draft_id, request_key,
                    source_candidate_fingerprint, remote_candidate_fingerprint,
                    state, shein_document_sn, shein_version, trace_id, updated_at
             FROM publish_jobs
             WHERE tenant_id=$1 AND store_id=$2 AND product_draft_id=$3
             ORDER BY updated_at DESC, id DESC`,
      values: [scope.tenantId, scope.storeId, scope.draftId],
    });
    const jobs = result.rows || [];
    return Promise.all(
      jobs.map(async (job) => projectJob(
        job,
        await this.#loadReceipts({ ...scope, jobId: job.id }),
      )),
    );
  }
}
