import { RULE_REFRESH_JOB_NAME } from "./job-queue.js";
import { WebAuthError } from "./web-auth.js";
import { flattenPublishCategoryLeaves } from "../publish-schema-coverage.js";

function presentJob(row) {
  if (!row?.id) return null;
  return {
    id: String(row.id),
    jobType: String(row.job_type),
    state: String(row.state),
    requestedBy: row.requested_by || null,
    startedAt: row.started_at || null,
    completedAt: row.completed_at || null,
    createdAt: row.created_at || null,
  };
}

function publicError(error) {
  return {
    code: String(error?.code || "RULE_REFRESH_FAILED").slice(0, 100),
    message: String(error?.message || "SHEIN规则刷新失败").slice(0, 500),
  };
}

function normalizeRuleTargets(value) {
  const targets = [];
  const seen = new Set();
  for (const item of Array.isArray(value) ? value : []) {
    const categoryId = String(item?.categoryId ?? item?.category_id ?? "").trim();
    const productTypeId = String(item?.productTypeId ?? item?.product_type_id ?? "").trim();
    if (!categoryId || !productTypeId) continue;
    const key = `${categoryId}\u0000${productTypeId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({ category_id: categoryId, product_type_id: productTypeId });
  }
  return targets;
}

function targetKey(target) {
  return `${target.category_id}\u0000${target.product_type_id}`;
}

function normalizeTargetConcurrency(value) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized)) return 1;
  return Math.min(4, Math.max(1, normalized));
}

export class PostgresRuleRefreshRepository {
  constructor({ pool } = {}) {
    if (!pool) throw new Error("规则刷新仓库缺少 pool");
    this.pool = pool;
  }

  async getActive({ tenantId, storeId }) {
    const result = await this.pool.query({
      text: `WITH expired_jobs AS (
               UPDATE sync_jobs
               SET state='failed',
                   error=jsonb_build_object('code', 'SYNC_JOB_TIMEOUT', 'message', '规则刷新任务超时，请重试'),
                   completed_at=COALESCE(completed_at, now()), updated_at=now()
               WHERE tenant_id=$1 AND store_id=$2
                 AND job_type='rule_refresh'
                 AND state IN ('queued', 'running')
                 AND COALESCE(updated_at, started_at, created_at) < now() - INTERVAL '15 minutes'
               RETURNING id
             )
             SELECT id, job_type, state, requested_by, started_at,
                    completed_at, created_at
             FROM sync_jobs
             WHERE tenant_id=$1 AND store_id=$2
               AND job_type='rule_refresh'
               AND state IN ('queued', 'running')
               AND id NOT IN (SELECT id FROM expired_jobs)
             ORDER BY created_at DESC LIMIT 1`,
      values: [tenantId, storeId],
    });
    return presentJob(result.rows[0]);
  }

  async claimRefresh({ tenantId, storeId, requestedBy, scope = "referenced" }) {
    try {
      const result = await this.pool.query({
        text: `
        WITH expired_jobs AS (
            UPDATE sync_jobs
            SET state='failed',
                error=jsonb_build_object('code', 'SYNC_JOB_TIMEOUT', 'message', '规则刷新任务超时，请重试'),
                completed_at=COALESCE(completed_at, now()), updated_at=now()
            WHERE tenant_id=$1 AND store_id=$2
              AND job_type='rule_refresh'
              AND state IN ('queued', 'running')
              AND COALESCE(updated_at, started_at, created_at) < now() - INTERVAL '15 minutes'
            RETURNING id
          ),
          active_job AS (
            SELECT id, job_type, state, requested_by, started_at,
                   completed_at, created_at
            FROM sync_jobs
            WHERE tenant_id=$1 AND store_id=$2
              AND job_type='rule_refresh'
              AND state IN ('queued', 'running')
              AND id NOT IN (SELECT id FROM expired_jobs)
            ORDER BY created_at DESC LIMIT 1
          ),
          new_job AS (
            INSERT INTO sync_jobs (
              tenant_id, store_id, job_type, state, progress, requested_by
            )
            SELECT $1, $2, 'rule_refresh', 'queued',
                   jsonb_build_object('scope', $4::text), $3
            FROM stores authorized_store
            WHERE authorized_store.id=$2
              AND authorized_store.tenant_id=$1
              AND NOT EXISTS (SELECT 1 FROM active_job)
            RETURNING id, job_type, state, requested_by, started_at,
                      completed_at, created_at
          ),
          audit_insert AS (
            INSERT INTO api_audit_logs (
              tenant_id, store_id, user_id, operation, method, path,
              status_code, metadata
            )
            SELECT $1, $2, $3, 'web.rules.refresh', 'POST',
                   '/v1/web/stores/:storeId/rules/refresh', 202,
                   jsonb_build_object('jobId', id, 'jobType', job_type)
            FROM new_job
            RETURNING id
          )
          SELECT true AS claimed, * FROM new_job
          UNION ALL
          SELECT false AS claimed, * FROM active_job
          LIMIT 1
        `,
        values: [tenantId, storeId, requestedBy || null, scope],
      });
      const row = result.rows[0];
      return { claimed: row?.claimed === true, job: presentJob(row) };
    } catch (error) {
      if (error?.code !== "23505") throw error;
      return { claimed: false, job: await this.getActive({ tenantId, storeId }) };
    }
  }

  async markRunning({ tenantId, storeId, jobId }) {
    const result = await this.pool.query({
      text: `UPDATE sync_jobs
             SET state='running', started_at=COALESCE(started_at, now()),
                 updated_at=now()
             WHERE id=$1 AND tenant_id=$2 AND store_id=$3
               AND job_type='rule_refresh'
               AND state IN ('queued', 'running')
             RETURNING id`,
      values: [jobId, tenantId, storeId],
    });
    return result.rowCount > 0;
  }

  async listTargets({ tenantId, storeId }) {
    const result = await this.pool.query({
      text: `
        SELECT DISTINCT category_id, product_type_id
        FROM (
          SELECT category_id, product_type_id
          FROM product_drafts
          WHERE tenant_id = $1 AND store_id = $2
            AND status <> 'archived'
          UNION
          SELECT category_id, product_type_id
          FROM publish_templates
          WHERE tenant_id = $1
            AND (scope IN ('tenant', 'user') OR (scope='store' AND store_id = $2))
        ) referenced_rules
        WHERE category_id <> '' AND product_type_id <> ''
        ORDER BY category_id, product_type_id
      `,
      values: [tenantId, storeId],
    });
    return result.rows;
  }

  async getFailedTargets({ tenantId, storeId, jobId }) {
    const result = await this.pool.query({
      text: `SELECT job_type, state, progress
             FROM sync_jobs
             WHERE id=$1 AND tenant_id=$2 AND store_id=$3`,
      values: [jobId, tenantId, storeId],
    });
    const row = result.rows[0];
    if (!row) return null;
    return {
      jobType: String(row.job_type || ""),
      state: String(row.state || ""),
      progress: row.progress && typeof row.progress === "object"
        ? row.progress
        : {},
    };
  }

  async updateProgress({ tenantId, storeId, jobId, progress }) {
    await this.pool.query({
      text: `UPDATE sync_jobs SET progress=$4::jsonb, updated_at=now()
             WHERE id=$1 AND tenant_id=$2 AND store_id=$3
               AND job_type='rule_refresh' AND state='running'`,
      values: [jobId, tenantId, storeId, JSON.stringify(progress)],
    });
  }

  async saveSuccess({ tenantId, storeId, jobId, progress }) {
    await this.pool.query({
      text: `UPDATE sync_jobs
             SET state='succeeded', progress=$4::jsonb,
                 completed_at=now(), updated_at=now()
             WHERE id=$1 AND tenant_id=$2 AND store_id=$3
               AND job_type='rule_refresh' AND state IN ('queued', 'running')`,
      values: [jobId, tenantId, storeId, JSON.stringify(progress)],
    });
  }

  async saveFailure({ tenantId, storeId, jobId, progress = null, error }) {
    await this.pool.query({
      text: `UPDATE sync_jobs
             SET state='failed',
                 progress=COALESCE($4::jsonb, progress),
                 error=$5::jsonb,
                 completed_at=now(), updated_at=now()
             WHERE id=$1 AND tenant_id=$2 AND store_id=$3
               AND job_type='rule_refresh' AND state IN ('queued', 'running')`,
      values: [
        jobId,
        tenantId,
        storeId,
        progress ? JSON.stringify(progress) : null,
        JSON.stringify(publicError(error)),
      ],
    });
  }
}

export class WebRuleRefreshService {
  constructor({
    repository,
    queue = null,
    ruleReader = null,
    executionEnabled,
    targetConcurrency = 1,
  } = {}) {
    if (!repository) throw new Error("规则刷新服务缺少 repository");
    this.repository = repository;
    this.queue = queue;
    this.ruleReader = ruleReader;
    this.executionEnabled = executionEnabled ?? Boolean(queue || ruleReader);
    this.targetConcurrency = normalizeTargetConcurrency(targetConcurrency);
    this.inflight = new Map();
  }

  async startRefresh({
    context,
    storeId,
    scope = "referenced",
    retryJobId = null,
  } = {}) {
    if (!context?.tenantId || !storeId) {
      throw new WebAuthError("INVALID_REQUEST", "缺少当前店铺", 400);
    }
    if (!["referenced", "all"].includes(scope)) {
      throw new WebAuthError("INVALID_REQUEST", "规则刷新范围不正确", 400);
    }
    if (context.role === "viewer") {
      throw new WebAuthError("RULE_REFRESH_FORBIDDEN", "当前角色不能刷新规则", 403);
    }
    if (!this.executionEnabled) {
      throw new WebAuthError("RULE_REFRESH_WORKER_UNAVAILABLE", "规则刷新 Worker 尚未启用", 503);
    }
    let retryTargets = null;
    if (retryJobId) {
      const previous = await this.repository.getFailedTargets({
        tenantId: context.tenantId,
        storeId,
        jobId: String(retryJobId),
      });
      if (
        !previous ||
        previous.jobType !== "rule_refresh" ||
        previous.state !== "failed"
      ) {
        throw new WebAuthError(
          "RULE_REFRESH_RETRY_INVALID",
          "只能重试已失败的规则刷新任务",
          409,
        );
      }
      retryTargets = normalizeRuleTargets(previous.progress.failedTargets);
      if (!retryTargets.length) {
        throw new WebAuthError(
          "RULE_REFRESH_RETRY_EMPTY",
          "该任务没有可定向重试的失败类目",
          409,
        );
      }
      scope = previous.progress.scope === "all" ? "all" : "referenced";
    }
    const key = `${context.tenantId}:${storeId}`;
    if (this.inflight.has(key)) {
      const active = await this.inflight.get(key);
      return { ...active, started: false };
    }
    const launch = (async () => {
      const claim = await this.repository.claimRefresh({
        tenantId: context.tenantId,
        storeId,
      requestedBy: context.userId || null,
        scope,
      });
      if (!claim.claimed) return { started: false, job: claim.job };
      const jobId = claim.job?.id || null;
      if (this.queue) {
        try {
          const data = {
            tenantId: context.tenantId,
            storeId,
            requestedBy: context.userId || null,
            jobId,
            scope,
          };
          if (retryTargets) data.retryTargets = retryTargets;
          await this.queue.add(RULE_REFRESH_JOB_NAME, data, {
            jobId,
            // Retry one infrastructure interruption only; jobId and the
            // persisted state prevent duplicate logical refreshes.
            attempts: 2,
            backoff: { type: "exponential", delay: 2_000 },
          });
        } catch {
          const error = new WebAuthError(
            "RULE_REFRESH_QUEUE_UNAVAILABLE",
            "规则刷新队列暂时不可用，请稍后重试",
            503,
          );
          await this.repository.saveFailure({
            tenantId: context.tenantId,
            storeId,
            jobId,
            error,
          });
          throw error;
        }
        return { started: true, job: claim.job };
      }
      this.processRefreshJob({
        context,
        storeId,
        jobId,
        scope,
        retryTargets,
      }).catch(() => {});
      return { started: true, job: claim.job };
    })();
    this.inflight.set(key, launch);
    try {
      return await launch;
    } finally {
      this.inflight.delete(key);
    }
  }

  async recordQueueFailure({ tenantId, storeId, jobId, error } = {}) {
    if (!tenantId || !storeId || !jobId) return;
    await this.repository.saveFailure({
      tenantId,
      storeId,
      jobId,
      progress: null,
      error,
    });
  }

  async processRefreshJob({
    context,
    storeId,
    jobId,
    scope = "referenced",
    retryTargets = null,
  } = {}) {
    if (!context?.tenantId || !storeId || !jobId || !this.ruleReader) {
      throw new WebAuthError("INVALID_REQUEST", "规则刷新任务参数不完整", 400);
    }
    if (!["referenced", "all"].includes(scope)) {
      throw new WebAuthError("INVALID_REQUEST", "规则刷新范围不正确", 400);
    }
    const runnable = await this.repository.markRunning({
      tenantId: context.tenantId,
      storeId,
      jobId,
    });
    if (!runnable) return { skipped: true };
    let progress = null;
    try {
      const categories = await this.ruleReader.getPublishCategories({
        context,
        storeId,
        forceRefresh: true,
      });
      const allTargets = scope === "all" || retryTargets != null
        ? normalizeRuleTargets(
            flattenPublishCategoryLeaves(categories.info).map((category) => ({
              category_id: category.categoryId,
              product_type_id: category.productTypeId,
            })),
          )
        : null;
      let targets;
      if (retryTargets != null) {
        if (!Array.isArray(retryTargets) || !retryTargets.length) {
          throw new WebAuthError(
            "RULE_REFRESH_RETRY_INVALID",
            "定向重试目标不完整",
            409,
          );
        }
        const availableTargets = new Set(allTargets.map(targetKey));
        targets = normalizeRuleTargets(retryTargets);
        if (
          targets.length !== retryTargets.length ||
          targets.some((target) => !availableTargets.has(targetKey(target)))
        ) {
          throw new WebAuthError(
            "RULE_REFRESH_RETRY_STALE",
            "部分失败类目已不在当前官方类目树中，请重新同步全部类目",
            409,
          );
        }
      } else if (scope === "all") {
        targets = allTargets;
      } else {
        targets = await this.repository.listTargets({
          tenantId: context.tenantId,
          storeId,
        });
      }
      progress = {
        scope,
        total: targets.length,
        processed: 0,
        succeeded: 0,
        failed: 0,
      };
      await this.repository.updateProgress({
        tenantId: context.tenantId,
        storeId,
        jobId,
        progress,
      });
      const failures = [];
      let nextTargetIndex = 0;
      let progressWrite = Promise.resolve();
      const saveProgress = () => {
        const snapshot = { ...progress };
        if (progress.failedTargets) {
          snapshot.failedTargets = [...progress.failedTargets];
        }
        progressWrite = progressWrite.then(() => this.repository.updateProgress({
          tenantId: context.tenantId,
          storeId,
          jobId,
          progress: snapshot,
        }));
        return progressWrite;
      };
      const processTarget = async () => {
        while (nextTargetIndex < targets.length) {
          const target = targets[nextTargetIndex++];
          try {
            await this.ruleReader.getPublishSchema({
              context,
              storeId,
              categoryId: String(target.category_id),
              productTypeId: String(target.product_type_id),
              forceRefresh: true,
            });
          } catch (error) {
            failures.push({ target, error });
            progress.failedTargets = [
              ...(progress.failedTargets || []),
              {
                categoryId: String(target.category_id),
                productTypeId: String(target.product_type_id),
              },
            ];
            progress.processed += 1;
            progress.failed += 1;
            await saveProgress();
            continue;
          }
          progress.processed += 1;
          progress.succeeded += 1;
          await saveProgress();
        }
      };
      await Promise.all(
        Array.from(
          { length: Math.min(this.targetConcurrency, Math.max(1, targets.length)) },
          () => processTarget(),
        ),
      );
      await progressWrite;
      if (failures.length) {
        const error = new WebAuthError(
          "RULE_REFRESH_PARTIAL",
          `${failures.length}个类目规则同步失败，请检查失败类目后重试`,
          503,
        );
        throw error;
      }
      await this.repository.saveSuccess({
        tenantId: context.tenantId,
        storeId,
        jobId,
        progress,
      });
      return { state: "succeeded", total: progress.total };
    } catch (error) {
      await this.repository.saveFailure({
        tenantId: context.tenantId,
        storeId,
        jobId,
        progress,
        error,
      });
      throw error;
    }
  }
}
