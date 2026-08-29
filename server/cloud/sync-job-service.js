import { WebAuthError } from "./web-auth.js";

export const SYNC_JOB_STALE_TIMEOUT_MS = 15 * 60_000;

const SYNC_JOB_STATES = new Set([
  "queued",
  "running",
  "succeeded",
  "completed_with_errors",
  "failed",
  "cancelled",
]);
const SYNC_JOB_TYPES = new Set([
  "store_business_refresh",
  "product_incremental_sync",
  "sales_daily_sync",
  "inventory_sync",
  "compliance_sync",
  "rule_refresh",
  "webhook_reconcile",
]);
const PUBLIC_PROGRESS_KEYS = new Set([
  "total",
  "processed",
  "succeeded",
  "failed",
  "skipped",
  "snapshotStored",
  "scope",
  "failedTargets",
]);

function safeTimestamp(value) {
  if (!value) return null;
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
}

function normalizeOptionalEnum(value, allowed, code, message) {
  const normalized = String(value || "").trim();
  if (!normalized) return null;
  if (!allowed.has(normalized)) {
    throw new WebAuthError(code, message, 400);
  }
  return normalized;
}

function normalizeLimit(value) {
  if (value == null || value === "") return 30;
  const normalized = String(value).trim();
  if (!/^\d+$/.test(normalized)) {
    throw new WebAuthError("INVALID_LIMIT", "任务条数必须为1至100", 400);
  }
  const limit = Number(normalized);
  if (limit < 1 || limit > 100) {
    throw new WebAuthError("INVALID_LIMIT", "任务条数必须为1至100", 400);
  }
  return limit;
}

function publicProgress(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const progress = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!PUBLIC_PROGRESS_KEYS.has(key)) continue;
    if (key === "scope") {
      if (raw === "referenced" || raw === "all") progress[key] = raw;
      continue;
    }
    if (key === "snapshotStored" && typeof raw === "boolean") {
      progress[key] = raw;
      continue;
    }
    if (key === "failedTargets") {
      if (!Array.isArray(raw)) continue;
      progress[key] = raw.slice(0, 500).flatMap((target) => {
        if (!target || typeof target !== "object") return [];
        const categoryId = String(target.categoryId || "").slice(0, 100);
        const productTypeId = String(target.productTypeId || "").slice(0, 100);
        return categoryId && productTypeId
          ? [{ categoryId, productTypeId }]
          : [];
      });
      continue;
    }
    const number = Number(raw);
    if (Number.isFinite(number) && number >= 0) progress[key] = number;
  }
  return progress;
}

function publicError(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    code: String(value.code || "SYNC_JOB_FAILED").slice(0, 100),
    message: String(value.message || "同步任务失败").slice(0, 500),
  };
}

function publicItem(row) {
  return {
    id: String(row.id),
    itemKey: String(row.item_key),
    state: String(row.state),
    attemptCount: Number(row.attempt_count || 0),
    traceId: row.trace_id ? String(row.trace_id).slice(0, 200) : null,
    error: publicError(row.error),
    startedAt: safeTimestamp(row.started_at),
    completedAt: safeTimestamp(row.completed_at),
  };
}

function publicJob(row, currentUserId) {
  return {
    id: String(row.id),
    jobType: String(row.job_type),
    state: String(row.state),
    progress: publicProgress(row.progress),
    error: publicError(row.error),
    requestedBy: row.requested_by
      ? {
          name: String(row.requested_by_name || "成员").slice(0, 120),
          me: String(row.requested_by) === String(currentUserId),
        }
      : null,
    startedAt: safeTimestamp(row.started_at),
    completedAt: safeTimestamp(row.completed_at),
    createdAt: safeTimestamp(row.created_at),
    updatedAt: safeTimestamp(row.updated_at),
  };
}

export class PostgresSyncJobRepository {
  constructor({ pool } = {}) {
    if (!pool) throw new Error("同步任务仓库缺少 pool");
    this.pool = pool;
  }

  async reconcileStale({ tenantId, storeId, now = new Date() }) {
    const staleBefore = new Date(now.getTime() - SYNC_JOB_STALE_TIMEOUT_MS);
    await this.pool.query({
      text: `UPDATE sync_jobs
             SET state='failed',
                 error=jsonb_build_object(
                   'code', 'SYNC_JOB_TIMEOUT',
                   'message', '同步任务超时，请重试'
                 ),
                 completed_at=COALESCE(completed_at, now()),
                 updated_at=now()
             WHERE tenant_id = $1 AND store_id = $2
               AND job_type IN (
                 'store_business_refresh',
                 'product_incremental_sync',
                 'sales_daily_sync',
                 'inventory_sync',
                 'compliance_sync',
                 'rule_refresh',
                 'webhook_reconcile'
               )
               AND state IN ('queued', 'running')
               AND COALESCE(updated_at, started_at, created_at) < $3`,
      values: [tenantId, storeId, staleBefore],
    });
  }

  async list({ tenantId, storeId, state, jobType, limit }) {
    await this.reconcileStale({ tenantId, storeId });
    const values = [tenantId, storeId];
    const filters = [];
    if (state) {
      values.push(state);
      filters.push(`AND job.state = $${values.length}`);
    }
    if (jobType) {
      values.push(jobType);
      filters.push(`AND job.job_type = $${values.length}`);
    }
    values.push(limit);
    const result = await this.pool.query({
      text: `
        SELECT job.id, job.job_type, job.state, job.progress, job.error,
               job.requested_by, requested_user.display_name AS requested_by_name,
               job.started_at, job.completed_at, job.created_at, job.updated_at
        FROM sync_jobs job
        LEFT JOIN users requested_user ON requested_user.id = job.requested_by
        WHERE job.tenant_id = $1 AND job.store_id = $2
          ${filters.join("\n          ")}
        ORDER BY job.created_at DESC, job.id DESC
        LIMIT $${values.length}
      `,
      values,
    });
    return result.rows;
  }

  async get({ tenantId, storeId, jobId }) {
    await this.reconcileStale({ tenantId, storeId });
    const jobResult = await this.pool.query({
      text: `
        SELECT job.id, job.job_type, job.state, job.progress, job.error,
               job.requested_by, requested_user.display_name AS requested_by_name,
               job.started_at, job.completed_at, job.created_at, job.updated_at
        FROM sync_jobs job
        LEFT JOIN users requested_user ON requested_user.id = job.requested_by
        WHERE job.tenant_id = $1 AND job.store_id = $2 AND job.id = $3
      `,
      values: [tenantId, storeId, jobId],
    });
    const job = jobResult.rows[0];
    if (!job) return null;
    const itemResult = await this.pool.query({
      text: `
        SELECT item.id, item.item_key, item.state, item.attempt_count,
               item.trace_id, item.error, item.started_at, item.completed_at
        FROM sync_job_items item
        JOIN sync_jobs job ON job.id = item.job_id
        WHERE job.tenant_id = $1 AND job.store_id = $2 AND job.id = $3
        ORDER BY item.created_at, item.id
        LIMIT 200
      `,
      values: [tenantId, storeId, jobId],
    });
    return { job, items: itemResult.rows };
  }
}

export class WebSyncJobService {
  constructor({ repository } = {}) {
    if (!repository) throw new Error("同步任务服务缺少 repository");
    this.repository = repository;
  }

  async list({ context, storeId, filters = {} } = {}) {
    if (!context?.tenantId || !storeId) {
      throw new WebAuthError("INVALID_REQUEST", "缺少当前店铺", 400);
    }
    const state = normalizeOptionalEnum(
      filters.state,
      SYNC_JOB_STATES,
      "INVALID_SYNC_JOB_STATE",
      "同步任务状态无效",
    );
    const jobType = normalizeOptionalEnum(
      filters.jobType,
      SYNC_JOB_TYPES,
      "INVALID_SYNC_JOB_TYPE",
      "同步任务类型无效",
    );
    const rows = await this.repository.list({
      tenantId: context.tenantId,
      storeId,
      state,
      jobType,
      limit: normalizeLimit(filters.limit),
    });
    const jobs = rows.map((row) => publicJob(row, context.userId));
    return { jobs, count: jobs.length };
  }

  async get({ context, storeId, jobId } = {}) {
    if (!context?.tenantId || !storeId || !jobId) {
      throw new WebAuthError("INVALID_REQUEST", "缺少同步任务", 400);
    }
    const result = await this.repository.get({
      tenantId: context.tenantId,
      storeId,
      jobId,
    });
    if (!result) {
      throw new WebAuthError("SYNC_JOB_NOT_FOUND", "同步任务不存在", 404);
    }
    return {
      job: {
        ...publicJob(result.job, context.userId),
        items: result.items.map(publicItem),
      },
    };
  }
}
