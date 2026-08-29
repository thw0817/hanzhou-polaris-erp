import { WebAuthError } from "./web-auth.js";
import { STORE_BUSINESS_REFRESH_JOB_NAME } from "./job-queue.js";
import { withTransaction } from "./postgres.js";

const DEFAULT_FRESH_FOR_MS = 5 * 60 * 1000;
const REFRESH_LOCK_TIMEOUT_MS = 10 * 60 * 1000;
const MANUAL_REFRESH_COOLDOWN_MS = 60 * 1000;

const SHEIN_SHELF_STATES = Object.freeze({
  0: "待上架",
  1: "已上架",
  2: "已下架",
  3: "已售罄",
});

function safeTimestamp(value) {
  if (!value) return null;
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp;
}

function publicError(error) {
  if (String(error?.code || error?.response?.code || "") === "832213") {
    return {
      code: "SHEIN_RATE_LIMITED",
      message: "SHEIN接口暂时限流，请稍后再次刷新",
      occurredAt: new Date().toISOString(),
    };
  }
  return {
    code: String(error?.code || "SHEIN_SYNC_FAILED"),
    message: String(error?.message || "SHEIN经营数据同步失败").slice(0, 500),
    occurredAt: new Date().toISOString(),
  };
}

function sourceSaleDate(sourceCutoff) {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(String(sourceCutoff || ""));
  if (!match) return null;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : date;
}

function textOrNull(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function exactShelfState(product) {
  const statusCode = Number(product?.statusCode);
  if (
    product?.statusSource !== "shein_skc_label_list"
    || !Number.isInteger(statusCode)
    || !Object.hasOwn(SHEIN_SHELF_STATES, statusCode)
  ) {
    return { statusCode: null, state: "待同步", statusSource: "unavailable" };
  }
  return {
    statusCode,
    state: SHEIN_SHELF_STATES[statusCode],
    statusSource: "shein_skc_label_list",
  };
}

/**
 * Cached business snapshots may predate the exact SHEIN shelf-status readback.
 * Never expose those legacy/inferred values as current platform status.
 */
export function normalizeBusinessSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return snapshot || {};
  const outOfStock = snapshot.outOfStock && typeof snapshot.outOfStock === "object"
    ? snapshot.outOfStock
    : {};
  const products = Array.isArray(snapshot.products)
    ? snapshot.products.map((product) => {
      const skus = Array.isArray(product?.skus)
        ? product.skus.map((sku) => {
          const event = outOfStock[String(sku?.skuCode || "")];
          return event && typeof event === "object"
            ? { ...sku, outOfStockQty: Number(event.outOfStockQty || 0), outOfStockUpdatedAt: event.receivedAt || null }
            : sku;
        })
        : [];
      const skuTransitRows = Array.isArray(product?.skus)
        ? skus
          .map((sku) => sku?.transitInventory)
          .filter((value) => value !== null && value !== undefined && Number.isFinite(Number(value)))
          .map(Number)
        : [];
      const productTransit = product?.transitInventory;
      return {
        ...product,
        skus,
        ...exactShelfState(product),
        transitInventory: skuTransitRows.length
          ? skuTransitRows.reduce((total, value) => total + value, 0)
          : productTransit !== null && productTransit !== undefined && Number.isFinite(Number(productTransit))
            ? Number(productTransit)
            : null,
      };
    })
    : [];
  const productTransitRows = products
    .map((product) => product.transitInventory)
    .filter((value) => value !== null && Number.isFinite(Number(value)))
    .map(Number);
  const snapshotTransit = snapshot?.totals?.transitInventory;
  const transitInventory = productTransitRows.length
    ? productTransitRows.reduce((total, value) => total + value, 0)
    : snapshotTransit !== null && snapshotTransit !== undefined && Number.isFinite(Number(snapshotTransit))
      ? Number(snapshotTransit)
      : null;
  return {
    ...snapshot,
    products,
    totals: {
      ...(snapshot.totals || {}),
      transitInventory,
    },
  };
}

function businessProductRows(snapshot) {
  const bySkc = new Map();
  for (const product of Array.isArray(snapshot?.products) ? snapshot.products : []) {
    const skcName = textOrNull(product?.skc);
    if (!skcName) continue;
    bySkc.set(skcName, {
      skc_name: skcName,
      spu_name: textOrNull(product?.spu),
      title: textOrNull(product?.title || product?.name),
      category_id: textOrNull(product?.categoryId),
      category_name: textOrNull(product?.categoryName || product?.category),
      supplier_code: textOrNull(product?.supplierCode),
      shelf_status: product?.statusSource === "shein_skc_label_list"
        ? textOrNull(product?.state)
        : null,
      raw_data: product && typeof product === "object" ? product : {},
    });
  }
  return [...bySkc.values()];
}

function presentRefreshJob(row) {
  if (!row?.refresh_job_id) return null;
  return {
    id: String(row.refresh_job_id),
    jobType: String(row.refresh_job_type),
    state: String(row.refresh_job_state),
    requestedBy: row.refresh_job_requested_by || null,
    startedAt: safeTimestamp(row.refresh_job_started_at)?.toISOString() || null,
    completedAt: safeTimestamp(row.refresh_job_completed_at)?.toISOString() || null,
    createdAt: safeTimestamp(row.refresh_job_created_at)?.toISOString() || null,
  };
}

function presentSnapshot(row, now, freshForMs) {
  if (!row) {
    return {
      state: "idle",
      snapshot: null,
      stale: true,
      syncedAt: null,
      sourceCutoff: "",
      lastError: null,
      webhookPending: false,
      lastWebhookAt: null,
      lastWebhookEventType: null,
      lastWebhookEventId: null,
      lastManualRefreshAt: null,
      refreshControl: null,
    };
  }
  const syncedAt = safeTimestamp(row.synced_at);
  const lastManualRefreshAt = safeTimestamp(row.last_manual_refresh_at);
  const retryAfterSeconds = lastManualRefreshAt
    ? Math.max(0, Math.ceil((MANUAL_REFRESH_COOLDOWN_MS - (now.getTime() - lastManualRefreshAt.getTime())) / 1000))
    : 0;
  const normalizedSnapshot = normalizeBusinessSnapshot(row.snapshot && Object.keys(row.snapshot).length
    ? row.snapshot
    : null);
  return {
    state: row.state,
    snapshot: normalizedSnapshot && Object.keys(normalizedSnapshot).length
      ? normalizedSnapshot
      : null,
    stale: !syncedAt || now.getTime() - syncedAt.getTime() >= freshForMs,
    syncedAt: syncedAt?.toISOString() || null,
    sourceCutoff: row.source_cutoff || row.snapshot?.dataDate || "",
    refreshStartedAt: safeTimestamp(row.refresh_started_at)?.toISOString() || null,
    refreshCompletedAt: safeTimestamp(row.refresh_completed_at)?.toISOString() || null,
    lastError: row.last_error || null,
    refreshJob: presentRefreshJob(row),
    webhookPending: Number(row.webhook_version || 0) > Number(row.synced_webhook_version || 0),
    lastWebhookAt: safeTimestamp(row.last_webhook_at)?.toISOString() || null,
    lastWebhookEventType: row.last_webhook_event_type || null,
    lastWebhookEventId: row.last_webhook_event_id || null,
    lastManualRefreshAt: lastManualRefreshAt?.toISOString() || null,
    refreshControl: retryAfterSeconds > 0
      ? { status: "cooldown", retryAfterSeconds }
      : null,
  };
}

export class PostgresStoreBusinessRepository {
  constructor({ pool } = {}) {
    if (!pool) throw new Error("店铺经营仓库缺少 pool");
    this.pool = pool;
  }

  async reconcileStale({ tenantId, storeId, now = new Date() }) {
    const staleBefore = new Date(now.getTime() - REFRESH_LOCK_TIMEOUT_MS);
    await withTransaction(this.pool, async (client) => {
      await client.query({
        text: `
          UPDATE sync_jobs
          SET state = 'failed',
              error = jsonb_build_object(
                'code', 'SYNC_JOB_TIMEOUT',
                'message', '经营数据刷新任务超时'
              ),
              completed_at = COALESCE(completed_at, now()),
              updated_at = now()
          WHERE tenant_id = $1 AND store_id = $2
            AND job_type = 'store_business_refresh'
            AND state IN ('queued', 'running')
            AND COALESCE(updated_at, started_at, created_at) < $3
        `,
        values: [tenantId, storeId, staleBefore],
      });
      await client.query({
        text: `
          UPDATE store_business_snapshots snapshot
          SET state = CASE
                WHEN COALESCE(snapshot.snapshot, '{}'::jsonb) = '{}'::jsonb
                THEN 'failed'
                ELSE 'ready'
              END,
              refresh_completed_at = COALESCE(snapshot.refresh_completed_at, now()),
              last_error = jsonb_build_object(
                'code', 'SYNC_JOB_TIMEOUT',
                'message', '经营数据刷新任务超时，请重试'
              ),
              updated_at = now()
          WHERE snapshot.tenant_id = $1 AND snapshot.store_id = $2
            AND snapshot.state = 'refreshing'
            AND COALESCE(snapshot.refresh_started_at, snapshot.updated_at) < $3
            AND NOT EXISTS (
              SELECT 1
              FROM sync_jobs active_job
              WHERE active_job.tenant_id = snapshot.tenant_id
                AND active_job.store_id = snapshot.store_id
                AND active_job.job_type = 'store_business_refresh'
                AND active_job.state IN ('queued', 'running')
            )
        `,
        values: [tenantId, storeId, staleBefore],
      });
    });
  }

  async get(tenantId, storeId) {
    const result = await this.pool.query({
      text: `
        SELECT snapshot.tenant_id, snapshot.store_id, snapshot.state,
               snapshot.snapshot, snapshot.source_cutoff, snapshot.synced_at,
               snapshot.refresh_started_at, snapshot.refresh_completed_at,
               snapshot.last_error, snapshot.updated_at,
               snapshot.webhook_version, snapshot.synced_webhook_version,
               snapshot.last_webhook_at, snapshot.last_webhook_event_type,
               snapshot.last_webhook_event_id, snapshot.last_manual_refresh_at,
               refresh_job.id AS refresh_job_id,
               refresh_job.job_type AS refresh_job_type,
               refresh_job.state AS refresh_job_state,
               refresh_job.requested_by AS refresh_job_requested_by,
               refresh_job.started_at AS refresh_job_started_at,
               refresh_job.completed_at AS refresh_job_completed_at,
               refresh_job.created_at AS refresh_job_created_at
        FROM store_business_snapshots snapshot
        LEFT JOIN LATERAL (
          SELECT id, job_type, state, requested_by, started_at,
                 completed_at, created_at
          FROM sync_jobs
          WHERE tenant_id = snapshot.tenant_id
            AND store_id = snapshot.store_id
            AND job_type = 'store_business_refresh'
            AND state IN ('queued', 'running')
          ORDER BY created_at DESC
          LIMIT 1
        ) refresh_job ON true
        WHERE snapshot.tenant_id = $1 AND snapshot.store_id = $2
      `,
      values: [tenantId, storeId],
    });
    return result.rows[0] || null;
  }

  async claimRefresh({ tenantId, storeId, requestedBy, trigger = "web" }) {
    const lockBefore = new Date(Date.now() - REFRESH_LOCK_TIMEOUT_MS);
    const manualCutoff = new Date(Date.now() - MANUAL_REFRESH_COOLDOWN_MS);
    const scheduled = trigger === "scheduler";
    const result = await this.pool.query({
      text: `
        WITH expired_jobs AS (
          UPDATE sync_jobs
          SET state = 'failed',
              error = jsonb_build_object(
                'code', 'SYNC_JOB_TIMEOUT',
                'message', '经营数据刷新任务超时'
              ),
              completed_at = now(),
              updated_at = now()
          WHERE tenant_id = $1
            AND store_id = $2
            AND job_type = 'store_business_refresh'
            AND state IN ('queued', 'running')
            AND updated_at < $4
          RETURNING id
        ),
        active_job AS (
          SELECT id, job_type, state, requested_by, started_at,
                 completed_at, created_at
          FROM sync_jobs
          WHERE tenant_id = $1
            AND store_id = $2
            AND job_type = 'store_business_refresh'
            AND state IN ('queued', 'running')
            AND id NOT IN (SELECT id FROM expired_jobs)
          ORDER BY created_at DESC
          LIMIT 1
        ),
        snapshot_claim AS (
          INSERT INTO store_business_snapshots (
            tenant_id, store_id, state, refresh_started_at,
            refresh_requested_by, last_error, last_manual_refresh_at
          )
          SELECT $1, $2, 'refreshing', now(), $3, NULL,
                 CASE WHEN NOT $10::boolean THEN now() ELSE NULL END
          WHERE NOT EXISTS (SELECT 1 FROM active_job)
          ON CONFLICT (store_id) DO UPDATE SET
            state = 'refreshing',
            refresh_started_at = now(),
            refresh_requested_by = EXCLUDED.refresh_requested_by,
            last_error = NULL,
            last_manual_refresh_at = CASE
              WHEN NOT $10::boolean THEN now()
              ELSE store_business_snapshots.last_manual_refresh_at
            END,
            updated_at = now()
          WHERE store_business_snapshots.tenant_id = EXCLUDED.tenant_id
            AND NOT EXISTS (SELECT 1 FROM active_job)
            AND (
              store_business_snapshots.state <> 'refreshing'
              OR store_business_snapshots.refresh_started_at < $4
            )
            AND (
              $10::boolean
              OR store_business_snapshots.last_manual_refresh_at IS NULL
              OR store_business_snapshots.last_manual_refresh_at < $9
            )
          RETURNING store_id
        ),
        new_job AS (
          INSERT INTO sync_jobs (
            tenant_id, store_id, job_type, state, requested_by
          )
          SELECT $1, $2, 'store_business_refresh', 'queued', $3
          FROM snapshot_claim
          RETURNING id, job_type, state, requested_by, started_at,
                    completed_at, created_at
        ),
        audit_insert AS (
          INSERT INTO api_audit_logs (
            tenant_id, store_id, user_id, operation, method, path,
            status_code, metadata
          )
          SELECT $1, $2, $3, $5, $6, $7, 200,
                 jsonb_build_object(
                   'jobId', id,
                   'jobType', job_type,
                   'storeId', $2,
                   'trigger', $8::text
                 )
          FROM new_job
          RETURNING id
        ),
        selected_job AS (
          SELECT true AS claimed, * FROM new_job
          UNION ALL
          SELECT false AS claimed, * FROM active_job
        )
        SELECT claimed, id AS refresh_job_id,
               job_type AS refresh_job_type, state AS refresh_job_state,
               requested_by AS refresh_job_requested_by,
               started_at AS refresh_job_started_at,
               completed_at AS refresh_job_completed_at,
               created_at AS refresh_job_created_at
        FROM selected_job
        LIMIT 1
      `,
      values: [
        tenantId,
        storeId,
        requestedBy || null,
        lockBefore,
        scheduled ? "scheduler.store_business.refresh" : "web.store_business.refresh",
        scheduled ? null : "POST",
        scheduled ? null : "/v1/web/stores/:storeId/business-dashboard",
        scheduled ? "scheduler" : "web",
        manualCutoff,
        scheduled,
      ],
    });
    const row = result.rows[0];
    if (!row && !scheduled) {
      const current = await this.get(tenantId, storeId);
      const lastManualRefreshAt = safeTimestamp(current?.last_manual_refresh_at);
      const retryAfterSeconds = lastManualRefreshAt
        ? Math.max(0, Math.ceil((MANUAL_REFRESH_COOLDOWN_MS - (Date.now() - lastManualRefreshAt.getTime())) / 1000))
        : 0;
      if (retryAfterSeconds > 0) {
        return {
          claimed: false,
          job: presentRefreshJob(current),
          cooldown: true,
          retryAfterSeconds,
        };
      }
    }
    return {
      claimed: row?.claimed === true,
      job: presentRefreshJob(row),
    };
  }

  async markRefreshRunning({ tenantId, storeId, jobId }) {
    const result = await this.pool.query({
      text: `
        UPDATE sync_jobs
        SET state = 'running',
            started_at = COALESCE(started_at, now()),
            updated_at = now()
        WHERE id = $1 AND tenant_id = $2 AND store_id = $3
          AND job_type = 'store_business_refresh'
          AND state IN ('queued', 'running')
        RETURNING id
      `,
      values: [jobId, tenantId, storeId],
    });
    return result.rowCount > 0;
  }

  async touchRefreshJob({ tenantId, storeId, jobId }) {
    await this.pool.query({
      text: `
        UPDATE sync_jobs
        SET updated_at = now()
        WHERE id = $1 AND tenant_id = $2 AND store_id = $3
          AND job_type = 'store_business_refresh'
          AND state = 'running'
      `,
      values: [jobId, tenantId, storeId],
    });
  }

  async saveSuccess({ tenantId, storeId, snapshot, jobId = null }) {
    const normalizedSnapshot = normalizeBusinessSnapshot(snapshot);
    const sourceCutoff = String(normalizedSnapshot?.dataDate || "");
    const productRows = businessProductRows(normalizedSnapshot);
    await withTransaction(this.pool, async (client) => {
      await client.query({
        text: `
          UPDATE store_business_snapshots
          SET state = 'ready',
              snapshot = CASE
                WHEN COALESCE(store_business_snapshots.snapshot, '{}'::jsonb) ? 'productQuota'
                  AND NOT ($3::jsonb ? 'productQuota')
                THEN $3::jsonb || jsonb_build_object(
                  'productQuota',
                  store_business_snapshots.snapshot->'productQuota'
                )
                ELSE $3::jsonb
              END,
              source_cutoff = $4,
              synced_at = now(), refresh_completed_at = now(),
              synced_webhook_version = COALESCE(webhook_version, 0),
              last_error = NULL, updated_at = now()
          WHERE tenant_id = $1 AND store_id = $2
        `,
        values: [tenantId, storeId, JSON.stringify(normalizedSnapshot || {}), sourceCutoff || null],
      });
      await client.query({
        text: `UPDATE stores SET last_synced_at = now(), updated_at = now()
               WHERE tenant_id = $1 AND id = $2`,
        values: [tenantId, storeId],
      });
      if (productRows.length) {
        await client.query({
          text: `
            WITH input AS (
              SELECT *
              FROM jsonb_to_recordset($3::jsonb) AS row(
                skc_name text,
                spu_name text,
                title text,
                category_id text,
                category_name text,
                supplier_code text,
                shelf_status text,
                raw_data jsonb
              )
            ),
            normalized AS (
              SELECT
                NULLIF(trim(skc_name), '') AS skc_name,
                NULLIF(trim(spu_name), '') AS spu_name,
                NULLIF(trim(title), '') AS title,
                NULLIF(trim(category_id), '') AS category_id,
                NULLIF(trim(category_name), '') AS category_name,
                NULLIF(trim(supplier_code), '') AS supplier_code,
                NULLIF(trim(shelf_status), '') AS shelf_status,
                COALESCE(raw_data, '{}'::jsonb) AS raw_data
              FROM input
              WHERE NULLIF(trim(skc_name), '') IS NOT NULL
            ),
            spu_source AS (
              SELECT
                spu_name,
                COALESCE((array_remove(array_agg(title ORDER BY skc_name), NULL))[1], spu_name) AS title,
                (array_remove(array_agg(category_id ORDER BY skc_name), NULL))[1] AS category_id,
                (array_remove(array_agg(category_name ORDER BY skc_name), NULL))[1] AS category_name,
                jsonb_build_object(
                  'source', 'store_business_refresh',
                  'skcCount', count(*),
                  'updatedFrom', 'business_snapshot'
                ) AS raw_data
              FROM normalized
              WHERE spu_name IS NOT NULL
              GROUP BY spu_name
            ),
            upserted_spus AS (
              INSERT INTO spus (
                tenant_id, store_id, spu_name, title, category_id,
                category_name, raw_data
              )
              SELECT
                $1, $2, spu_name, title, category_id, category_name,
                jsonb_build_object('businessSnapshot', raw_data)
              FROM spu_source
              ON CONFLICT (store_id, spu_name) DO UPDATE SET
                title = EXCLUDED.title,
                category_id = COALESCE(EXCLUDED.category_id, spus.category_id),
                category_name = COALESCE(EXCLUDED.category_name, spus.category_name),
                raw_data = jsonb_set(
                  COALESCE(spus.raw_data, '{}'::jsonb),
                  '{businessSnapshot}',
                  EXCLUDED.raw_data->'businessSnapshot',
                  true
                ),
                updated_at = now()
              WHERE spus.tenant_id = EXCLUDED.tenant_id
              RETURNING id, spu_name
            ),
            resolved_spus AS (
              SELECT id, spu_name FROM upserted_spus
              UNION
              SELECT existing.id, existing.spu_name
              FROM spus existing
              JOIN spu_source source ON source.spu_name = existing.spu_name
              WHERE existing.tenant_id = $1 AND existing.store_id = $2
            )
            INSERT INTO skcs (
              tenant_id, store_id, spu_id, skc_name, supplier_code,
              shelf_status, raw_data
            )
            SELECT
              $1, $2, resolved_spus.id, normalized.skc_name,
              normalized.supplier_code, normalized.shelf_status,
              jsonb_build_object('businessSnapshot', normalized.raw_data)
            FROM normalized
            LEFT JOIN resolved_spus ON resolved_spus.spu_name = normalized.spu_name
            ON CONFLICT (store_id, skc_name) DO UPDATE SET
              spu_id = COALESCE(EXCLUDED.spu_id, skcs.spu_id),
              supplier_code = COALESCE(EXCLUDED.supplier_code, skcs.supplier_code),
              -- An unavailable exact readback must clear the old projection instead
              -- of preserving a stale or inferred SHEIN shelf status.
              shelf_status = EXCLUDED.shelf_status,
              raw_data = jsonb_set(
                COALESCE(skcs.raw_data, '{}'::jsonb),
                '{businessSnapshot}',
                EXCLUDED.raw_data->'businessSnapshot',
                true
              ),
              updated_at = now()
            WHERE skcs.tenant_id = EXCLUDED.tenant_id
          `,
          values: [tenantId, storeId, JSON.stringify(productRows)],
        });
      }
      const saleDate = sourceSaleDate(sourceCutoff);
      if (saleDate) {
        await client.query({
          text: `
            INSERT INTO store_sales_daily (
              tenant_id, store_id, sale_date, real_time_sale_count,
              yesterday_sale_count, seven_day_sale_count,
              thirty_day_sale_count
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (store_id, sale_date) DO UPDATE SET
              real_time_sale_count = EXCLUDED.real_time_sale_count,
              yesterday_sale_count = EXCLUDED.yesterday_sale_count,
              seven_day_sale_count = EXCLUDED.seven_day_sale_count,
              thirty_day_sale_count = EXCLUDED.thirty_day_sale_count,
              updated_at = now()
          `,
          values: [
            tenantId,
            storeId,
            saleDate,
            Number(snapshot?.totals?.today || 0),
            Number(snapshot?.totals?.yesterday || 0),
            Number(snapshot?.totals?.sales7 || 0),
            Number(snapshot?.totals?.sales30 || 0),
          ],
        });
      }
      if (jobId) {
        await client.query({
          text: `
            UPDATE sync_jobs
            SET state = 'succeeded',
                progress = jsonb_build_object(
                  'snapshotStored', true,
                  'productProjectionCount', $4::integer
                ),
                completed_at = now(),
                updated_at = now()
            WHERE id = $1 AND tenant_id = $2 AND store_id = $3
              AND job_type = 'store_business_refresh'
              AND state IN ('queued', 'running')
          `,
          values: [jobId, tenantId, storeId, productRows.length],
        });
      }
    });
  }

  async saveFailure({ tenantId, storeId, error, jobId = null }) {
    const failure = publicError(error);
    await this.pool.query({
      text: `
        UPDATE store_business_snapshots
        SET state = CASE
              WHEN snapshot = '{}'::jsonb THEN 'failed'
              ELSE 'ready'
            END,
            refresh_completed_at = now(), last_error = $3::jsonb,
            updated_at = now()
        WHERE tenant_id = $1 AND store_id = $2
      `,
      values: [tenantId, storeId, JSON.stringify(failure)],
    });
    if (jobId) {
      await this.pool.query({
        text: `
          UPDATE sync_jobs
          SET state = 'failed', error = $4::jsonb,
              completed_at = now(), updated_at = now()
          WHERE id = $1 AND tenant_id = $2 AND store_id = $3
            AND job_type = 'store_business_refresh'
            AND state IN ('queued', 'running')
        `,
        values: [jobId, tenantId, storeId, JSON.stringify(failure)],
      });
    }
  }
}

export class WebStoreBusinessService {
  constructor({
    repository,
    syncStore,
    queue = null,
    executionEnabled = Boolean(queue || syncStore),
    now = () => new Date(),
    freshForMs = DEFAULT_FRESH_FOR_MS,
    heartbeatIntervalMs = 30_000,
  } = {}) {
    if (!repository) throw new Error("店铺经营服务缺少 repository");
    if (executionEnabled && !queue && typeof syncStore !== "function") {
      throw new Error("店铺经营服务缺少 syncStore");
    }
    this.repository = repository;
    this.syncStore = syncStore;
    this.queue = queue;
    this.executionEnabled = executionEnabled;
    this.now = now;
    this.freshForMs = freshForMs;
    this.heartbeatIntervalMs = heartbeatIntervalMs;
    this.inflight = new Map();
    this.reconcileChecks = new Map();
  }

  async getDashboard({ context, storeId, refreshIfEmpty = false } = {}) {
    if (!context?.tenantId || !storeId) {
      throw new WebAuthError("INVALID_REQUEST", "缺少当前店铺", 400);
    }
    let row = await this.repository.get(context.tenantId, storeId);
    // Normal ready/idle reads stay read-only. Only refreshing snapshots need
    // the orphan repair check, throttled per store so active-job polling does
    // not turn into a write transaction on every request.
    if (row?.state === "refreshing" && typeof this.repository.reconcileStale === "function") {
      const now = this.now();
      const key = `${context.tenantId}:${storeId}`;
      const lastCheck = this.reconcileChecks.get(key) || 0;
      if (now.getTime() - lastCheck >= 30_000) {
        this.reconcileChecks.set(key, now.getTime());
        await this.repository.reconcileStale({
          tenantId: context.tenantId,
          storeId,
          now,
        });
        row = await this.repository.get(context.tenantId, storeId);
      }
    }
    const view = presentSnapshot(row, this.now(), this.freshForMs);
    if (!view.snapshot && refreshIfEmpty) {
      this.startRefresh({ context, storeId }).catch(() => {});
      if (!row) {
        row = { state: "refreshing", snapshot: {}, source_cutoff: null };
      }
    }
    return {
      ...presentSnapshot(row, this.now(), this.freshForMs),
      storeId,
      refreshAfterSeconds: Math.max(30, Math.round(this.freshForMs / 1000)),
    };
  }

  async startRefresh({ context, storeId } = {}) {
    if (!context?.tenantId || !storeId) {
      throw new WebAuthError("INVALID_REQUEST", "缺少当前店铺", 400);
    }
    if (!this.executionEnabled) {
      throw new WebAuthError(
        "SYNC_WORKER_UNAVAILABLE",
        "经营数据同步 Worker 尚未启用",
        503,
      );
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
        requestedBy: context.userId,
        trigger: context.trigger === "scheduler" ? "scheduler" : "web",
      });
      const claimed = typeof claim === "boolean" ? claim : claim.claimed;
      const job = typeof claim === "boolean" ? null : claim.job;
      if (!claimed) {
        this.inflight.delete(key);
        return {
          started: false,
          job,
          refreshControl: claim?.cooldown
            ? { status: "cooldown", retryAfterSeconds: claim.retryAfterSeconds }
            : { status: "active" },
        };
      }
      const jobId = job?.id || null;
      if (this.queue) {
        try {
          await this.queue.add(
            STORE_BUSINESS_REFRESH_JOB_NAME,
            {
              tenantId: context.tenantId,
              storeId,
              requestedBy: context.userId || null,
              jobId,
            },
            {
              jobId,
              // One bounded retry covers a worker/Redis interruption. The
              // persisted job state and idempotent jobId prevent duplicate
              // SHEIN reads after a failure has already been recorded.
              attempts: 2,
              backoff: { type: "exponential", delay: 2_000 },
            },
          );
        } catch {
          const error = new WebAuthError(
            "SYNC_QUEUE_UNAVAILABLE",
            "同步队列暂时不可用，请稍后重试",
            503,
          );
          await this.repository.saveFailure({
            tenantId: context.tenantId,
            storeId,
            error,
            jobId,
          });
          this.inflight.delete(key);
          throw error;
        }
        this.inflight.delete(key);
        return { started: true, job, refreshControl: { status: "started" } };
      }
      this.processRefreshJob({ context, storeId, jobId })
        .catch(() => {})
        .finally(() => this.inflight.delete(key));
      return { started: true, job, refreshControl: { status: "started" } };
    })();
    this.inflight.set(key, launch);
    try {
      return await launch;
    } catch (error) {
      this.inflight.delete(key);
      throw error;
    }
  }

  async processRefreshJob({ context, storeId, jobId } = {}) {
    if (!context?.tenantId || !storeId) {
      throw new WebAuthError("INVALID_REQUEST", "缺少当前店铺", 400);
    }
    if (jobId && typeof this.repository.markRefreshRunning === "function") {
      const runnable = await this.repository.markRefreshRunning({
        tenantId: context.tenantId,
        storeId,
        jobId,
      });
      if (!runnable) return { skipped: true };
    }
    const heartbeat = jobId && typeof this.repository.touchRefreshJob === "function"
      ? setInterval(() => {
          this.repository.touchRefreshJob({
            tenantId: context.tenantId,
            storeId,
            jobId,
          }).catch(() => {});
        }, this.heartbeatIntervalMs)
      : null;
    heartbeat?.unref?.();
    try {
      return await this.#runRefresh({ context, storeId, jobId });
    } finally {
      if (heartbeat) clearInterval(heartbeat);
    }
  }

  async #runRefresh({ context, storeId, jobId }) {
    try {
      const previous = await this.repository.get(context.tenantId, storeId);
      const snapshot = await this.syncStore({
        context,
        storeId,
        previousSnapshot: previous?.snapshot || null,
      });
      await this.repository.saveSuccess({
        tenantId: context.tenantId,
        storeId,
        snapshot,
        jobId,
      });
      return { state: "succeeded" };
    } catch (error) {
      await this.repository.saveFailure({
        tenantId: context.tenantId,
        storeId,
        error,
        jobId,
      });
      throw error;
    }
  }
}
