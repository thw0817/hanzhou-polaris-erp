import { summarizeComplianceRow } from "../shein-compliance.js";
import { withTransaction } from "./postgres.js";
import { createRuleFingerprint } from "./rule-snapshot-service.js";
import { COMPLIANCE_SYNC_JOB_NAME } from "./job-queue.js";
import { WebAuthError } from "./web-auth.js";

const REQUIREMENT_GROUPS = [
  ["certificate", "certificateRequirements", "certificate"],
  ["agency", "agencyRequirements", "agency"],
  ["warning", "warningRequirements", "warning"],
  ["package_photo", "packagePhotoRequirements", "packagePhoto"],
  ["body_photo", "bodyPhotoRequirements", "bodyPhoto"],
  ["unsupported", "unsupportedRequirements", "platformOnly"],
];
const SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000;
const COMPLIANCE_SYNC_COOLDOWN_MS = 60 * 1000;

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
    code: String(error?.code || "COMPLIANCE_SYNC_FAILED").slice(0, 100),
    message: String(error?.message || "SHEIN合规同步失败").slice(0, 500),
  };
}

function noTargetsError() {
  return new WebAuthError(
    "COMPLIANCE_SYNC_NO_TARGETS",
    "当前店铺没有可同步的真实 SKC，请先刷新经营数据",
    409,
  );
}

function requirementKey(item, index) {
  const value = item?.certificateTypeCode ?? item?.certificateTypeId ??
    item?.labelId ?? item?.labelCode ?? item?.complianceTypeCode;
  return String(value ?? index + 1);
}

export function flattenComplianceRequirements(row = {}) {
  const records = [];
  for (const [requirementType, property, statusProperty] of REQUIREMENT_GROUPS) {
    const items = Array.isArray(row[property]) ? row[property] : [];
    const keyCounts = new Map();
    items.forEach((item, index) => {
      const baseKey = requirementKey(item, index);
      const count = (keyCounts.get(baseKey) || 0) + 1;
      keyCounts.set(baseKey, count);
      records.push({
        requirementType,
        requirementKey: count === 1 ? baseKey : `${baseKey}:${count}`,
        status: String(row[statusProperty] || "待同步"),
        required: Number(item?.isRequired) === 1,
        data: item || {},
      });
    });
  }
  return records;
}

function hasCompleteCoverage(row) {
  return row?.sourceCoverage?.requirementsReturned === true &&
    row?.sourceCoverage?.photoRequirementsReturned === true;
}

export class PostgresComplianceSyncRepository {
  constructor({ pool } = {}) {
    if (!pool) throw new Error("合规同步仓库缺少 pool");
    this.pool = pool;
  }

  async getActive({ tenantId, storeId }) {
    const result = await this.pool.query({
      text: `WITH expired_jobs AS (
               UPDATE sync_jobs
               SET state='failed',
                   error=jsonb_build_object('code', 'SYNC_JOB_TIMEOUT', 'message', '合规同步任务超时，请重试'),
                   completed_at=COALESCE(completed_at, now()), updated_at=now()
               WHERE tenant_id=$1 AND store_id=$2
                 AND job_type='compliance_sync'
                 AND state IN ('queued', 'running')
                 AND COALESCE(updated_at, started_at, created_at) < now() - INTERVAL '15 minutes'
               RETURNING id
             )
             SELECT id, job_type, state, requested_by, started_at,
                    completed_at, created_at
             FROM sync_jobs
             WHERE tenant_id=$1 AND store_id=$2
               AND job_type='compliance_sync'
               AND state IN ('queued', 'running')
               AND id NOT IN (SELECT id FROM expired_jobs)
             ORDER BY created_at DESC LIMIT 1`,
      values: [tenantId, storeId],
    });
    return presentJob(result.rows[0]);
  }

  async claimSync({ tenantId, storeId, requestedBy }) {
    const activeJob = await this.getActive({ tenantId, storeId });
    if (activeJob) {
      return { claimed: false, job: activeJob, refreshControl: { status: "active" } };
    }
    const recentResult = await this.pool.query({
      text: `SELECT COALESCE(completed_at, updated_at, created_at) AS completed_at
             FROM sync_jobs
             WHERE tenant_id=$1 AND store_id=$2
               AND job_type='compliance_sync'
               AND state IN ('succeeded', 'failed', 'cancelled')
               AND COALESCE(completed_at, updated_at, created_at) >= $3
             ORDER BY COALESCE(completed_at, updated_at, created_at) DESC
             LIMIT 1`,
      values: [tenantId, storeId, new Date(Date.now() - COMPLIANCE_SYNC_COOLDOWN_MS)],
    });
    const recentAt = recentResult.rows?.[0]?.completed_at
      ? new Date(recentResult.rows[0].completed_at)
      : null;
    const retryAfterSeconds = recentAt && !Number.isNaN(recentAt.getTime())
      ? Math.max(0, Math.ceil((COMPLIANCE_SYNC_COOLDOWN_MS - (Date.now() - recentAt.getTime())) / 1000))
      : 0;
    if (retryAfterSeconds > 0) {
      return { claimed: false, job: null, cooldown: true, retryAfterSeconds };
    }
    try {
      const result = await this.pool.query({
        text: `
          WITH expired_jobs AS (
            UPDATE sync_jobs
            SET state='failed',
                error=jsonb_build_object('code', 'SYNC_JOB_TIMEOUT', 'message', '合规同步任务超时，请重试'),
                completed_at=COALESCE(completed_at, now()), updated_at=now()
            WHERE tenant_id=$1 AND store_id=$2
              AND job_type='compliance_sync'
              AND state IN ('queued', 'running')
              AND COALESCE(updated_at, started_at, created_at) < now() - INTERVAL '15 minutes'
            RETURNING id
          ),
          active_job AS (
            SELECT id, job_type, state, requested_by, started_at,
                   completed_at, created_at
            FROM sync_jobs
            WHERE tenant_id=$1 AND store_id=$2
              AND job_type='compliance_sync'
              AND state IN ('queued', 'running')
              AND id NOT IN (SELECT id FROM expired_jobs)
            ORDER BY created_at DESC LIMIT 1
          ),
          new_job AS (
            INSERT INTO sync_jobs (
              tenant_id, store_id, job_type, state, requested_by
            )
            SELECT $1, $2, 'compliance_sync', 'queued', $3
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
            SELECT $1, $2, $3, 'web.compliance.refresh', 'POST',
                   '/v1/web/stores/:storeId/compliance/refresh', 202,
                   jsonb_build_object('jobId', id, 'jobType', job_type)
            FROM new_job RETURNING id
          )
          SELECT true AS claimed, * FROM new_job
          UNION ALL
          SELECT false AS claimed, * FROM active_job
          LIMIT 1
        `,
        values: [tenantId, storeId, requestedBy || null],
      });
      const row = result.rows[0];
      return {
        claimed: row?.claimed === true,
        job: presentJob(row),
        refreshControl: row?.claimed === true
          ? { status: "started" }
          : { status: "active" },
      };
    } catch (error) {
      if (error?.code !== "23505") throw error;
      const activeJob = await this.getActive({ tenantId, storeId });
      return {
        claimed: false,
        job: activeJob,
        refreshControl: activeJob ? { status: "active" } : null,
      };
    }
  }

  async markRunning({ tenantId, storeId, jobId }) {
    const result = await this.pool.query({
      text: `UPDATE sync_jobs
             SET state='running', started_at=COALESCE(started_at, now()),
                 updated_at=now()
             WHERE id=$1 AND tenant_id=$2 AND store_id=$3
               AND job_type='compliance_sync'
               AND state IN ('queued', 'running') RETURNING id`,
      values: [jobId, tenantId, storeId],
    });
    return result.rowCount > 0;
  }

  async listTargets({ tenantId, storeId }) {
    const result = await this.pool.query({
      text: `SELECT skc.id, skc.skc_name, skc.raw_data, spu.spu_name
             FROM skcs skc
             LEFT JOIN spus spu
               ON spu.id = skc.spu_id
              AND spu.tenant_id = $1
              AND spu.store_id = $2
             WHERE skc.tenant_id=$1 AND skc.store_id=$2
               AND NULLIF(BTRIM(skc.skc_name), '') IS NOT NULL
             ORDER BY skc.skc_name`,
      values: [tenantId, storeId],
    });
    return result.rows;
  }

  async hasTargets({ tenantId, storeId }) {
    const result = await this.pool.query({
      text: `SELECT EXISTS (
               SELECT 1
               FROM skcs
               WHERE tenant_id=$1 AND store_id=$2
                 AND NULLIF(BTRIM(skc_name), '') IS NOT NULL
             ) AS has_targets`,
      values: [tenantId, storeId],
    });
    return result.rows[0]?.has_targets === true;
  }

  async saveAttributeSnapshots({
    tenantId,
    storeId,
    snapshots = [],
  }) {
    if (!snapshots.length) return;
    await withTransaction(this.pool, async (client) => {
      for (const item of snapshots) {
        await client.query({
          text: `UPDATE skcs
                 SET raw_data = jsonb_set(
                   COALESCE(raw_data, '{}'::jsonb),
                   '{attributeSnapshot}',
                   $4::jsonb,
                   true
                 ),
                 updated_at=now()
                 WHERE tenant_id=$1 AND store_id=$2 AND skc_name=$3`,
          values: [
            tenantId,
            storeId,
            String(item?.skc || ""),
            JSON.stringify(item?.snapshot || {}),
          ],
        });
      }
    });
  }

  async prepareItems({ tenantId, storeId, jobId, skcNames }) {
    if (!skcNames.length) return;
    await this.pool.query({
      text: `INSERT INTO sync_job_items (job_id, item_key)
             SELECT job.id, input.item_key
             FROM sync_jobs job
             CROSS JOIN unnest($4::text[]) AS input(item_key)
             WHERE job.id=$1 AND job.tenant_id=$2 AND job.store_id=$3
               AND job.job_type='compliance_sync'
             ON CONFLICT (job_id, item_key) DO NOTHING`,
      values: [jobId, tenantId, storeId, skcNames],
    });
  }

  async saveBatch({
    tenantId,
    storeId,
    jobId,
    rows,
    failedSkcNames,
    traceId = null,
    error = null,
    checkedAt = new Date(),
  }) {
    await withTransaction(this.pool, async (client) => {
      for (const row of rows) {
        const summary = summarizeComplianceRow(row);
        const skcResult = await client.query({
          text: `UPDATE skcs
                 SET compliance_status=$4, compliance_summary=$5::jsonb,
                     updated_at=now()
                 WHERE tenant_id=$1 AND store_id=$2 AND skc_name=$3
                 RETURNING id`,
          values: [tenantId, storeId, row.skc, summary.state, JSON.stringify(summary)],
        });
        const skcId = skcResult.rows[0]?.id;
        if (!skcId) throw new Error(`合规同步目标SKC不存在: ${row.skc}`);
        await client.query({
          text: `DELETE FROM skc_compliance_records
                 WHERE tenant_id=$1 AND store_id=$2 AND skc_id=$3`,
          values: [tenantId, storeId, skcId],
        });
        for (const record of flattenComplianceRequirements(row)) {
          await client.query({
            text: `INSERT INTO skc_compliance_records (
                     tenant_id, store_id, skc_id, requirement_type,
                     requirement_key, status, required, requirement_data,
                     source_trace_id, checked_at
                   ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)`,
            values: [
              tenantId, storeId, skcId, record.requirementType,
              record.requirementKey, record.status, record.required,
              JSON.stringify(record.data), traceId, checkedAt,
            ],
          });
        }
        const expiresAt = new Date(checkedAt.getTime() + SNAPSHOT_TTL_MS);
        await client.query({
          text: `INSERT INTO shein_rule_snapshots (
                   tenant_id, store_id, rule_type, subject_key, fingerprint,
                   payload, source_trace_id, fetched_at, expires_at
                 ) VALUES ($1,$2,'compliance_requirement',$3,$4,$5::jsonb,$6,$7,$8)
                 ON CONFLICT (store_id, rule_type, category_id, product_type_id, subject_key)
                 DO UPDATE SET fingerprint=EXCLUDED.fingerprint,
                   payload=EXCLUDED.payload, source_trace_id=EXCLUDED.source_trace_id,
                   fetched_at=EXCLUDED.fetched_at, expires_at=EXCLUDED.expires_at,
                   updated_at=now()
                 WHERE shein_rule_snapshots.tenant_id=EXCLUDED.tenant_id`,
          values: [
            tenantId, storeId, row.skc, createRuleFingerprint(row),
            JSON.stringify(row), traceId, checkedAt, expiresAt,
          ],
        });
        await client.query({
          text: `UPDATE sync_job_items
                 SET state='succeeded', attempt_count=attempt_count+1,
                     trace_id=$4, result=$5::jsonb, error=NULL,
                     started_at=COALESCE(started_at, now()),
                     completed_at=now(), updated_at=now()
                 WHERE job_id=$1 AND item_key=$2
                   AND EXISTS (
                     SELECT 1 FROM sync_jobs job
                     WHERE job.id=$1 AND job.tenant_id=$3 AND job.store_id=$6
                   )`,
          values: [jobId, row.skc, tenantId, traceId, JSON.stringify(summary), storeId],
        });
      }
      for (const skcName of failedSkcNames) {
        await client.query({
          text: `UPDATE sync_job_items
                 SET state='failed', attempt_count=attempt_count+1,
                     trace_id=$4, error=$5::jsonb,
                     started_at=COALESCE(started_at, now()),
                     completed_at=now(), updated_at=now()
                 WHERE job_id=$1 AND item_key=$2
                   AND EXISTS (
                     SELECT 1 FROM sync_jobs job
                     WHERE job.id=$1 AND job.tenant_id=$3 AND job.store_id=$6
                   )`,
          values: [
            jobId, skcName, tenantId, traceId,
            JSON.stringify(publicError(error || {
              code: "INCOMPLETE_COMPLIANCE_RESPONSE",
              message: "SHEIN未返回完整合规来源",
            })),
            storeId,
          ],
        });
      }
    });
  }

  async updateProgress({ tenantId, storeId, jobId, progress }) {
    await this.pool.query({
      text: `UPDATE sync_jobs SET progress=$4::jsonb, updated_at=now()
             WHERE id=$1 AND tenant_id=$2 AND store_id=$3
               AND job_type='compliance_sync' AND state='running'`,
      values: [jobId, tenantId, storeId, JSON.stringify(progress)],
    });
  }

  async saveSuccess({ tenantId, storeId, jobId, progress }) {
    await this.pool.query({
      text: `UPDATE sync_jobs SET state='succeeded', progress=$4::jsonb,
               completed_at=now(), updated_at=now()
             WHERE id=$1 AND tenant_id=$2 AND store_id=$3
               AND job_type='compliance_sync' AND state IN ('queued','running')`,
      values: [jobId, tenantId, storeId, JSON.stringify(progress)],
    });
  }

  async saveFailure({ tenantId, storeId, jobId, progress, error, failedSkcNames = [] }) {
    await this.pool.query({
      text: `UPDATE sync_jobs SET state='failed', progress=$4::jsonb,
               error=$5::jsonb, cursor=$6::jsonb,
               completed_at=now(), updated_at=now()
             WHERE id=$1 AND tenant_id=$2 AND store_id=$3
               AND job_type='compliance_sync' AND state IN ('queued','running')`,
      values: [
        jobId, tenantId, storeId, JSON.stringify(progress || {}),
        JSON.stringify(publicError(error)), JSON.stringify({ failedSkcNames }),
      ],
    });
  }
}

export class WebComplianceSyncService {
  constructor({ repository, queue = null, complianceReader = null, executionEnabled } = {}) {
    if (!repository) throw new Error("合规同步服务缺少 repository");
    this.repository = repository;
    this.queue = queue;
    this.complianceReader = complianceReader;
    this.executionEnabled = executionEnabled ?? Boolean(queue || complianceReader);
    this.inflight = new Map();
  }

  async startSync({ context, storeId } = {}) {
    if (!context?.tenantId || !storeId) {
      throw new WebAuthError("INVALID_REQUEST", "缺少当前店铺", 400);
    }
    if (context.role === "viewer") {
      throw new WebAuthError("COMPLIANCE_SYNC_FORBIDDEN", "当前角色不能刷新合规", 403);
    }
    if (!this.executionEnabled) {
      throw new WebAuthError("COMPLIANCE_SYNC_WORKER_UNAVAILABLE", "合规同步 Worker 尚未启用", 503);
    }
    const key = `${context.tenantId}:${storeId}`;
    if (this.inflight.has(key)) return { ...(await this.inflight.get(key)), started: false };
    const launch = (async () => {
      if (!(await this.repository.hasTargets({
        tenantId: context.tenantId,
        storeId,
      }))) {
        throw noTargetsError();
      }
      const claim = await this.repository.claimSync({
        tenantId: context.tenantId,
        storeId,
        requestedBy: context.userId || null,
      });
      if (!claim.claimed) {
        return {
          started: false,
          job: claim.job,
          refreshControl: claim.cooldown
            ? { status: "cooldown", retryAfterSeconds: claim.retryAfterSeconds }
            : (claim.refreshControl || { status: "active" }),
        };
      }
      const jobId = claim.job?.id || null;
      if (this.queue) {
        try {
          await this.queue.add(COMPLIANCE_SYNC_JOB_NAME, {
            tenantId: context.tenantId,
            storeId,
            requestedBy: context.userId || null,
            jobId,
          }, {
            jobId,
            // A single bounded retry covers transient worker/Redis
            // interruptions; persisted job state keeps the read idempotent.
            attempts: 2,
            backoff: { type: "exponential", delay: 2_000 },
          });
        } catch {
          const error = new WebAuthError(
            "COMPLIANCE_SYNC_QUEUE_UNAVAILABLE",
            "合规同步队列暂时不可用，请稍后重试",
            503,
          );
          await this.repository.saveFailure({
            tenantId: context.tenantId, storeId, jobId, progress: {}, error,
          });
          throw error;
        }
        return { started: true, job: claim.job, refreshControl: { status: "started" } };
      }
      this.processSyncJob({ context, storeId, jobId }).catch(() => {});
      return { started: true, job: claim.job, refreshControl: { status: "started" } };
    })();
    this.inflight.set(key, launch);
    try {
      return await launch;
    } finally {
      this.inflight.delete(key);
    }
  }

  async processSyncJob({ context, storeId, jobId } = {}) {
    if (!context?.tenantId || !storeId || !jobId || !this.complianceReader) {
      throw new WebAuthError("INVALID_REQUEST", "合规同步任务参数不完整", 400);
    }
    const runnable = await this.repository.markRunning({
      tenantId: context.tenantId, storeId, jobId,
    });
    if (!runnable) return { skipped: true };
    const progress = { total: 0, processed: 0, succeeded: 0, failed: 0 };
    const failed = new Set();
    const attributeSnapshotFailures = new Set();
    try {
      const targets = await this.repository.listTargets({
        tenantId: context.tenantId, storeId,
      });
      const skcNames = targets.map((target) => String(target.skc_name));
      progress.total = skcNames.length;
      await this.repository.prepareItems({
        tenantId: context.tenantId, storeId, jobId, skcNames,
      });
      await this.repository.updateProgress({
        tenantId: context.tenantId, storeId, jobId, progress,
      });
      if (!skcNames.length) {
        const error = noTargetsError();
        await this.repository.saveFailure({
          tenantId: context.tenantId, storeId, jobId, progress,
          error,
        });
        throw error;
      }
      if (typeof this.complianceReader.syncProductAttributeSnapshots === "function") {
        const attributeSync =
          await this.complianceReader.syncProductAttributeSnapshots({
            context,
            storeId,
            targets,
          });
        await this.repository.saveAttributeSnapshots({
          tenantId: context.tenantId,
          storeId,
          snapshots: attributeSync.snapshots || [],
        });
        for (const skcName of attributeSync.failedSkcNames || []) {
          // Attribute snapshots are a supplemental readback.  They must be
          // visible as a warning, but cannot turn a complete compliance
          // response into an "all SKCs failed" job.
          attributeSnapshotFailures.add(String(skcName));
        }
      }
      await this.complianceReader.syncCompliance({
        context,
        storeId,
        skcNames,
        continueOnError: true,
        onBatch: async (batch) => {
          const rowBySkc = new Map((batch.rows || []).map((row) => [row.skc, row]));
          const completeRows = [];
          const failedSkcNames = [];
          for (const skcName of batch.skcNames || []) {
            const row = rowBySkc.get(skcName);
            if (!batch.error && hasCompleteCoverage(row)) completeRows.push(row);
            else {
              failed.add(skcName);
              failedSkcNames.push(skcName);
            }
          }
          const traceId = batch.diagnostics?.find((item) => item.traceId)?.traceId || null;
          await this.repository.saveBatch({
            tenantId: context.tenantId,
            storeId,
            jobId,
            rows: completeRows,
            failedSkcNames,
            traceId,
            error: batch.error,
          });
          progress.processed += (batch.skcNames || []).length;
          progress.succeeded += completeRows.length;
          progress.failed += failedSkcNames.length;
          await this.repository.updateProgress({
            tenantId: context.tenantId, storeId, jobId, progress,
          });
        },
      });
      if (attributeSnapshotFailures.size) {
        progress.attributeSnapshotFailed = Array.from(attributeSnapshotFailures);
      }
      if (failed.size) {
        const error = new Error(`${failed.size}个SKC合规同步失败`);
        error.code = "COMPLIANCE_SYNC_PARTIAL";
        throw error;
      }
      await this.repository.saveSuccess({
        tenantId: context.tenantId, storeId, jobId, progress,
      });
      return { state: "succeeded", total: progress.total };
    } catch (error) {
      await this.repository.saveFailure({
        tenantId: context.tenantId,
        storeId,
        jobId,
        progress,
        error,
        failedSkcNames: Array.from(failed),
      });
      throw error;
    }
  }
}
