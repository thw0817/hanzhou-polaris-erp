import { withTransaction } from "./postgres.js";
import { createRuleFingerprint } from "./rule-snapshot-service.js";

export const PUBLISH_REQUEST_CLAIM_TTL_SECONDS = 120;

const EFFECTIVE_PUBLISH_SKC_NAMES_SQL = `
  CASE
    WHEN jsonb_typeof(job.request_summary->'skcNames') = 'array'
      AND jsonb_array_length(job.request_summary->'skcNames') > 0
    THEN job.request_summary->'skcNames'
    ELSE COALESCE(
      (
        SELECT jsonb_agg(skc->>'skcName')
        FROM jsonb_array_elements(COALESCE(job.receipt->'skcs', '[]'::jsonb)) AS skc
        WHERE NULLIF(skc->>'skcName', '') IS NOT NULL
      ),
      '[]'::jsonb
    )
  END
`;

const EFFECTIVE_PUBLISH_SPU_NAME_SQL = `
  COALESCE(
    NULLIF(job.request_summary->>'spuName', ''),
    NULLIF(job.receipt->>'spuName', '')
  )
`;

const EFFECTIVE_PUBLISH_SKU_CODES_SQL = `
  CASE
    WHEN jsonb_typeof(job.request_summary->'skuCodes') = 'array'
      AND jsonb_array_length(job.request_summary->'skuCodes') > 0
    THEN job.request_summary->'skuCodes'
    ELSE COALESCE(
      (
        SELECT jsonb_agg(sku->>'skuCode')
        FROM jsonb_array_elements(COALESCE(job.receipt->'skcs', '[]'::jsonb)) AS skc
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(skc->'skus', '[]'::jsonb)) AS sku
        WHERE NULLIF(sku->>'skuCode', '') IS NOT NULL
      ),
      '[]'::jsonb
    )
  END
`;

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function presentJob(row) {
  if (!row) return null;
  return {
    ...row,
    attemptCount: Number(row.attempt_count || 0),
    executionEnabled: row.execution_enabled === true,
    authorizesPublishing: row.authorizes_publishing === true,
  };
}

function presentRun(row) {
  if (!row) return null;
  return {
    ...row,
    executionEnabled: row.execution_enabled === true,
    authorizesPublishing: row.authorizes_publishing === true,
  };
}

function executionError(error) {
  const source = asObject(error);
  const projected = {
    code: source.code == null ? null : String(source.code).trim().slice(0, 100),
    message: String(source.message || "SHEIN商品发布执行失败").trim().slice(0, 1000),
    traceId: source.traceId == null
      ? null
      : String(source.traceId).trim().slice(0, 200) || null,
  };
  if (Array.isArray(source.details) && source.details.length) {
    projected.details = source.details.slice(0, 100).map((detail) => {
      const row = asObject(detail);
      return {
        source: String(row.source || "SHEIN字段校验").trim().slice(0, 100),
        location: String(row.location || "").trim().slice(0, 300),
        messages: (Array.isArray(row.messages) ? row.messages : [])
          .map((message) => String(message || "").trim().slice(0, 500))
          .filter(Boolean)
          .slice(0, 20),
      };
    }).filter((detail) => detail.messages.length);
  }
  return projected;
}

function claimValues({
  tenantId,
  storeId,
  executionRunId,
  workerId,
  claimId,
  claimedAt,
}) {
  return [
    tenantId,
    storeId,
    executionRunId,
    workerId,
    claimId,
    claimedAt,
  ];
}

export async function projectPublishExecutionAuthorization({
  client,
  tenantId,
  storeId,
  publishBatchId,
  protocol,
  executionPlan,
} = {}) {
  if (!client) throw new Error("projectPublishExecutionAuthorization缺少client");
  const normalizedProtocol = asObject(protocol);
  const normalizedPlan = asObject(executionPlan);
  const requests = Array.isArray(normalizedPlan.requests)
    ? normalizedPlan.requests
    : [];
  if (
    !normalizedProtocol.authorizationId ||
    !normalizedProtocol.fingerprint ||
    !normalizedPlan.fingerprint ||
    normalizedProtocol.executionPlanFingerprint !== normalizedPlan.fingerprint ||
    normalizedProtocol.executionEnabled !== false ||
    normalizedProtocol.authorizesPublishing !== false ||
    !requests.length
  ) {
    throw new Error("执行授权协议与执行计划不一致");
  }

  const runResult = await client.query({
    text: `
      INSERT INTO publish_execution_runs (
        tenant_id, store_id, publish_batch_id, authorization_id,
        execution_plan_fingerprint, authorization_fingerprint,
        authorized_by, authorized_at, expires_at,
        execution_enabled, authorizes_publishing
      )
      VALUES (
        $1, $2, $3, $4,
        $5, $6,
        $7, $8::timestamptz, $9::timestamptz,
        false, false
      )
      ON CONFLICT (tenant_id, store_id, authorization_id)
      DO NOTHING
      RETURNING *
    `,
    values: [
      tenantId,
      storeId,
      publishBatchId,
      normalizedProtocol.authorizationId,
      normalizedPlan.fingerprint,
      normalizedProtocol.fingerprint,
      normalizedProtocol.authorizedBy || null,
      normalizedProtocol.authorizedAt,
      normalizedProtocol.expiresAt,
    ],
  });
  let run = runResult.rows[0];
  if (!run) {
    const existing = await client.query({
      text: `
        SELECT *
        FROM publish_execution_runs
        WHERE tenant_id = $1
          AND store_id = $2
          AND authorization_id = $3
      `,
      values: [
        tenantId,
        storeId,
        normalizedProtocol.authorizationId,
      ],
    });
    run = existing.rows[0] || null;
  }
  if (
    !run ||
    run.publish_batch_id !== publishBatchId ||
    run.execution_plan_fingerprint !== normalizedPlan.fingerprint ||
    run.authorization_fingerprint !== normalizedProtocol.fingerprint
  ) {
    throw new Error("数据库中的执行授权协议与当前批次不一致");
  }

  const planByKey = new Map(
    requests.map((request) => [String(request.requestKey || ""), request]),
  );
  const protocolRequests = Array.isArray(normalizedProtocol.requests)
    ? normalizedProtocol.requests
    : [];
  if (
    protocolRequests.length !== requests.length ||
    protocolRequests.some((request) => !planByKey.has(String(request.requestKey || "")))
  ) {
    throw new Error("执行授权协议缺少冻结请求");
  }

  for (const request of requests) {
    const requestKey = String(request.requestKey || "");
    const inserted = await client.query({
      text: `
        INSERT INTO publish_jobs (
          tenant_id, store_id, execution_run_id, publish_batch_id,
          publish_batch_item_id, product_draft_id, request_key,
          source_candidate_fingerprint, remote_candidate_fingerprint,
          state, request_summary
        )
        VALUES (
          $1, $2, $3, $4,
          $5, $6, $7,
          $8, $9,
          'authorized', $10::jsonb
        )
        ON CONFLICT (tenant_id, store_id, request_key)
        DO NOTHING
        RETURNING *
      `,
      values: [
        tenantId,
        storeId,
        run.id,
        publishBatchId,
        request.itemId,
        request.draftId,
        requestKey,
        request.sourceCandidateFingerprint,
        request.remoteCandidateFingerprint,
        JSON.stringify({
          categoryId: request.categoryId,
          supplierCode: request.supplierCode,
          spuName: request.spuName,
          skcNames: (request.skcSummaries || [])
            .map((skc) => skc.skcName)
            .filter(Boolean),
          skuCodes: (request.skcSummaries || [])
            .flatMap((skc) => skc.skuCodes || [])
            .filter(Boolean),
          supplierSkus: (request.skcSummaries || [])
            .flatMap((skc) => skc.supplierSkus || [])
            .filter(Boolean),
          skcCount: request.skcCount,
          skuCount: request.skuCount,
          attemptReason: request.attemptReason,
          parentAttemptId: request.parentAttemptId,
          supersedesAttemptId: request.parentAttemptId,
        }),
      ],
    });
    const job = inserted.rows[0] || (await client.query({
      text: `
        SELECT *
        FROM publish_jobs
        WHERE tenant_id = $1
          AND store_id = $2
          AND request_key = $3
      `,
      values: [tenantId, storeId, requestKey],
    })).rows[0];
    if (
      !job ||
      job.execution_run_id !== run.id ||
      job.source_candidate_fingerprint !== request.sourceCandidateFingerprint ||
      job.remote_candidate_fingerprint !== request.remoteCandidateFingerprint
    ) {
      throw new Error("数据库中的发布请求与当前执行计划不一致");
    }
  }
  return run;
}

function receiptStatusFor(record) {
  const status = String(record?.status || "").trim();
  if (["accepted", "pending", "passed", "failed", "withdrawn", "unknown"].includes(status)) {
    return status;
  }
  throw new Error("发布回执状态无效");
}

function receiptRecordValues(record) {
  return [
    record?.documentSn || null,
    record?.version || null,
    record?.spuName || null,
    record?.skcName || null,
    Array.isArray(record?.skuCodes) ? record.skuCodes[0] || null : null,
  ];
}

export class PostgresPublishExecutionRepository {
  constructor({ pool } = {}) {
    if (!pool) throw new Error("PostgresPublishExecutionRepository 缺少 pool");
    this.pool = pool;
  }

  async consumeAuthorization({
    tenantId,
    storeId,
    executionRunId,
    authorizationId,
    authorizationFingerprint,
    executionPlanFingerprint,
    consumedAt = new Date(),
  } = {}) {
    const result = await this.pool.query({
      text: `
        UPDATE publish_execution_runs
        SET state = 'running',
            execution_enabled = true,
            authorizes_publishing = true,
            consumed_at = $7::timestamptz,
            updated_at = $7::timestamptz
        WHERE tenant_id = $1
          AND store_id = $2
          AND id = $3
          AND authorization_id = $4
          AND authorization_fingerprint = $5
          AND execution_plan_fingerprint = $6
          AND state = 'issued'
          AND single_use = true
          AND consumed_at IS NULL
          AND expires_at > $7::timestamptz
          AND execution_enabled = false
          AND authorizes_publishing = false
        RETURNING *
      `,
      values: [
        tenantId,
        storeId,
        executionRunId,
        authorizationId,
        authorizationFingerprint,
        executionPlanFingerprint,
        consumedAt,
      ],
    });
    return presentRun(result.rows[0] || null);
  }

  async claimNextJob({
    tenantId,
    storeId,
    executionRunId = null,
    commandId = null,
    workerId,
    claimId,
    claimedAt = new Date(),
    excludedJobIds = [],
  } = {}) {
    const result = await this.pool.query({
      text: `
        WITH candidate AS (
          SELECT
            job.id,
            run.execution_enabled,
            run.authorizes_publishing
          FROM publish_jobs AS job
          JOIN publish_execution_runs AS run
            ON run.id = job.execution_run_id
           AND run.tenant_id = job.tenant_id
           AND run.store_id = job.store_id
          WHERE job.tenant_id = $1
            AND job.store_id = $2
            AND ($3::uuid IS NULL OR job.execution_run_id = $3)
            AND ($9::uuid IS NULL OR job.id = $9)
            AND run.state = 'running'
            AND run.execution_enabled = true
            AND run.authorizes_publishing = true
            AND job.state IN ('authorized', 'failed_retryable')
            AND NOT (job.id = ANY($8::uuid[]))
          ORDER BY job.created_at, job.id
          FOR UPDATE OF job SKIP LOCKED
          LIMIT 1
        )
        UPDATE publish_jobs AS job
        SET state = 'claimed',
            attempt_count = job.attempt_count + 1,
            claim_id = $5,
            worker_id = $4,
            claimed_at = $6::timestamptz,
            claim_expires_at =
              $6::timestamptz + ($7::text || ' seconds')::interval,
            last_error = NULL,
            updated_at = $6::timestamptz
        FROM candidate
        WHERE job.id = candidate.id
        RETURNING
          job.*,
          candidate.execution_enabled,
          candidate.authorizes_publishing
      `,
      values: [
        ...claimValues({
          tenantId,
          storeId,
          executionRunId,
          workerId,
          claimId,
          claimedAt,
        }),
        PUBLISH_REQUEST_CLAIM_TTL_SECONDS,
        excludedJobIds,
        commandId,
      ],
    });
    return presentJob(result.rows[0] || null);
  }

  async loadClaimedExecutionSource({
    tenantId,
    storeId,
    executionRunId,
    jobId,
    claimId,
  } = {}) {
    const result = await this.pool.query({
      text: `
        SELECT
          job.*,
          run.execution_enabled,
          run.authorizes_publishing,
          item.preflight->'remotePublishCandidate' AS remote_candidate,
          draft.preflight->'publishCandidate' AS current_source_candidate
        FROM publish_jobs AS job
        JOIN publish_execution_runs AS run
          ON run.id = job.execution_run_id
         AND run.tenant_id = job.tenant_id
         AND run.store_id = job.store_id
        JOIN publish_batch_items AS item
          ON item.id = job.publish_batch_item_id
         AND item.batch_id = job.publish_batch_id
        JOIN product_drafts AS draft
          ON draft.id = job.product_draft_id
         AND draft.tenant_id = job.tenant_id
         AND draft.store_id = job.store_id
        WHERE job.tenant_id = $1
          AND job.store_id = $2
          AND job.execution_run_id = $3
          AND job.id = $4
          AND job.claim_id = $5
          AND job.state = 'claimed'
          AND run.state = 'running'
          AND run.execution_enabled = true
          AND run.authorizes_publishing = true
          AND item.preflight->'remotePublishCandidate'->>'fingerprint' =
            job.remote_candidate_fingerprint
          AND item.preflight->'remotePublishCandidate'->>'sourceCandidateFingerprint' =
            job.source_candidate_fingerprint
          AND draft.preflight->'publishCandidate'->>'fingerprint' =
            job.source_candidate_fingerprint
        LIMIT 1
      `,
      values: [tenantId, storeId, executionRunId, jobId, claimId],
    });
    const row = result.rows[0] || null;
    if (!row) return null;
    return {
      job: presentJob(row),
      remoteCandidate: asObject(row.remote_candidate),
      currentSourceCandidate: asObject(row.current_source_candidate),
    };
  }

  async markExpiredClaimsUnknown({
    tenantId,
    storeId,
    executionRunId = null,
    jobId = null,
    expiredAt = new Date(),
    limit = 100,
  } = {}) {
    const result = await this.pool.query({
      text: `
        WITH expired AS (
          SELECT job.id
          FROM publish_jobs AS job
          WHERE job.tenant_id = $1
            AND job.store_id = $2
            AND ($3::uuid IS NULL OR job.execution_run_id = $3)
            AND ($6::uuid IS NULL OR job.id = $6)
            AND job.state = 'claimed'
            AND job.claim_expires_at <= $4::timestamptz
          ORDER BY job.claim_expires_at, job.id
          FOR UPDATE SKIP LOCKED
          LIMIT $5
        )
        UPDATE publish_jobs AS job
        SET state = 'result_unknown',
            claim_id = NULL,
            worker_id = NULL,
            claimed_at = NULL,
            claim_expires_at = NULL,
            last_error = jsonb_build_object(
              'code', 'CLAIM_EXPIRED_RESULT_UNKNOWN',
              'message', '领取租约过期，结果必须通过通知或状态查询恢复',
              'occurredAt', $4::timestamptz
            ),
            updated_at = $4::timestamptz
        FROM expired
        WHERE job.id = expired.id
        RETURNING job.*
      `,
      values: [tenantId, storeId, executionRunId, expiredAt, limit, jobId],
    });
    return result.rows.map(presentJob);
  }

  async recordSubmitted({
    tenantId,
    storeId,
    executionRunId,
    jobId,
    claimId,
    receipt,
    submittedAt = new Date(),
  } = {}) {
    const normalizedReceipt = asObject(receipt);
    const receiptSkcs = Array.isArray(normalizedReceipt.skcs)
      ? normalizedReceipt.skcs
      : [];
    const receiptSkcNames = receiptSkcs
      .map((skc) => String(skc?.skcName || "").trim())
      .filter(Boolean);
    const receiptSkuCodes = receiptSkcs.flatMap((skc) =>
      Array.isArray(skc?.skus)
        ? skc.skus
            .map((sku) => String(sku?.skuCode || "").trim())
            .filter(Boolean)
        : []
    );
    const receiptSupplierSkus = receiptSkcs.flatMap((skc) =>
      Array.isArray(skc?.skus)
        ? skc.skus
            .map((sku) => String(sku?.supplierSku || "").trim())
            .filter(Boolean)
        : []
    );
    const dedupeKey = `submitted:${createRuleFingerprint({
      executionRunId,
      jobId,
      version: normalizedReceipt.version || null,
      spuName: normalizedReceipt.spuName || null,
      traceId: normalizedReceipt.traceId || null,
    })}`;
    return withTransaction(this.pool, async (client) => {
      const updated = await client.query({
        text: `
          UPDATE publish_jobs
          SET state = 'submitted',
              claim_id = NULL,
              worker_id = NULL,
              claimed_at = NULL,
              claim_expires_at = NULL,
              submitted_at = $6::timestamptz,
              receipt = $7::jsonb,
              request_summary = COALESCE(request_summary, '{}'::jsonb) ||
                jsonb_strip_nulls(jsonb_build_object(
                  'spuName', COALESCE(
                    NULLIF(request_summary->>'spuName', ''),
                    NULLIF($11::text, '')
                  ),
                  'skcNames', COALESCE(
                    NULLIF(request_summary->'skcNames', '[]'::jsonb),
                    $12::jsonb
                  ),
                  'skuCodes', COALESCE(
                    NULLIF(request_summary->'skuCodes', '[]'::jsonb),
                    $13::jsonb
                  ),
                  'supplierSkus', COALESCE(
                    NULLIF(request_summary->'supplierSkus', '[]'::jsonb),
                    $14::jsonb
                  )
                )),
              shein_document_sn = COALESCE($8, shein_document_sn),
              shein_version = COALESCE($9, shein_version),
              trace_id = COALESCE($10, trace_id),
              last_error = NULL,
              updated_at = $6::timestamptz
          WHERE id = $4
            AND tenant_id = $1
            AND store_id = $2
            AND execution_run_id = $3
            AND state = 'claimed'
            AND claim_id = $5
          RETURNING *
        `,
        values: [
          tenantId,
          storeId,
          executionRunId,
          jobId,
          claimId,
          submittedAt,
          JSON.stringify(normalizedReceipt),
          normalizedReceipt.documentSn || null,
          normalizedReceipt.version || null,
          normalizedReceipt.traceId || null,
          normalizedReceipt.spuName || null,
          JSON.stringify(receiptSkcNames),
          JSON.stringify(receiptSkuCodes),
          JSON.stringify(receiptSupplierSkus),
        ],
      });
      const job = updated.rows[0] || null;
      if (!job) return null;
      await client.query({
        text: `
          INSERT INTO publish_receipts (
            tenant_id, store_id, publish_job_id,
            receipt_type, status, dedupe_key, trace_id,
            document_sn, version, spu_name, payload, occurred_at
          )
          VALUES (
            $1, $2, $3,
            'submitted', 'accepted', $4, $5,
            $6, $7, $8, $9::jsonb, $10::timestamptz
          )
          ON CONFLICT (publish_job_id, receipt_type, dedupe_key)
          DO NOTHING
        `,
        values: [
          tenantId,
          storeId,
          jobId,
          dedupeKey,
          normalizedReceipt.traceId || null,
          normalizedReceipt.documentSn || null,
          normalizedReceipt.version || null,
          normalizedReceipt.spuName || null,
          JSON.stringify(normalizedReceipt),
          submittedAt,
        ],
      });
      // Keep the cached store quota honest immediately after SHEIN accepts a
      // publish request. The next official quota webhook remains authoritative
      // and resets this local projection; until then the UI must not overstate
      // the remaining monthly allowance.
      await client.query({
        text: `
          WITH current AS (
            SELECT snapshot
            FROM store_business_snapshots
            WHERE tenant_id = $1 AND store_id = $2
            FOR UPDATE
          ), normalized AS (
            SELECT
              snapshot->'productQuota' AS quota,
              to_char($3::timestamptz, 'YYYY-MM') AS period,
              CASE
                WHEN COALESCE(
                  snapshot->'productQuota'->>'platformAvailableLimit',
                  snapshot->'productQuota'->>'availableLimit'
                ) ~ '^[0-9]+$'
                THEN COALESCE(
                  snapshot->'productQuota'->>'platformAvailableLimit',
                  snapshot->'productQuota'->>'availableLimit'
                )::integer
                ELSE NULL
              END AS platform_limit,
              CASE
                WHEN snapshot->'productQuota'->>'quotaPeriod' = to_char($3::timestamptz, 'YYYY-MM')
                  AND snapshot->'productQuota'->>'localConsumedThisMonth' ~ '^[0-9]+$'
                THEN (snapshot->'productQuota'->>'localConsumedThisMonth')::integer
                ELSE 0
              END AS consumed
            FROM current
            WHERE snapshot->'productQuota' IS NOT NULL
          )
          UPDATE store_business_snapshots AS target
          SET snapshot = jsonb_set(
            COALESCE(target.snapshot, '{}'::jsonb),
            '{productQuota}',
            normalized.quota || jsonb_build_object(
              'platformAvailableLimit', normalized.platform_limit,
              'localConsumedThisMonth', normalized.consumed + 1,
              'quotaPeriod', normalized.period,
              'availableLimit', GREATEST(normalized.platform_limit - normalized.consumed - 1, 0),
              'localQuotaUpdatedAt', $3::timestamptz
            ),
            true
          )
          FROM normalized
          WHERE target.tenant_id = $1
            AND target.store_id = $2
            AND normalized.platform_limit IS NOT NULL
        `,
        values: [tenantId, storeId, submittedAt],
      });
      return presentJob(job);
    });
  }

  async recordExecutionFailure({
    tenantId,
    storeId,
    executionRunId,
    jobId,
    claimId,
    outcome,
    retryable = false,
    error,
    failedAt = new Date(),
  } = {}) {
    if (!["failed", "unknown"].includes(outcome)) {
      throw new Error("发布执行结果必须是failed或unknown");
    }
    const normalizedError = executionError(error);
    return withTransaction(this.pool, async (client) => {
      const result = await client.query({
        text: `
          UPDATE publish_jobs
          SET state = CASE
                WHEN $7 = 'unknown' THEN 'result_unknown'
                WHEN $8::boolean THEN 'failed_retryable'
                ELSE 'failed_terminal'
              END,
              claim_id = NULL,
              worker_id = NULL,
              claimed_at = NULL,
              claim_expires_at = NULL,
              last_error = $6::jsonb,
              trace_id = COALESCE($9, trace_id),
              updated_at = $10::timestamptz
          WHERE tenant_id = $1
            AND store_id = $2
            AND execution_run_id = $3
            AND id = $4
            AND state = 'claimed'
            AND claim_id = $5
          RETURNING *
        `,
        values: [
          tenantId,
          storeId,
          executionRunId,
          jobId,
          claimId,
          JSON.stringify(normalizedError),
          outcome,
          retryable === true,
          normalizedError.traceId,
          failedAt,
        ],
      });
      const job = result.rows[0] || null;
      if (!job) return null;

      // Keep the batch projection transactionally aligned with the execution
      // job. Previously only publish_jobs changed, leaving ready batch items
      // visible after a terminal SHEIN rejection (for example quota code
      // 20100). Unknown outcomes intentionally remain ready so the readback
      // path can still confirm whether SHEIN accepted the request.
      if (["failed_terminal", "failed_retryable"].includes(job.state)) {
        const batchId = String(job.publish_batch_id || "").trim();
        const batchItemId = String(job.publish_batch_item_id || "").trim();
        if (batchId && batchItemId) {
          await client.query({
            text: `
              UPDATE publish_batch_items
              SET state = 'failed',
                  last_error = $3,
                  updated_at = $4::timestamptz
              WHERE id = $1
                AND batch_id = $2
                AND state <> 'completed'
            `,
            values: [
              batchItemId,
              batchId,
              JSON.stringify(normalizedError),
              failedAt,
            ],
          });
          await client.query({
            text: `
              UPDATE publish_batches AS batch
              SET state = CASE
                    WHEN EXISTS (
                      SELECT 1
                      FROM publish_batch_items AS item
                      WHERE item.batch_id = batch.id
                        AND item.state IN ('queued', 'preflighting', 'ready', 'paused')
                    ) THEN 'ready'
                    ELSE 'failed'
                  END,
                  preflight = jsonb_set(
                    jsonb_set(
                      COALESCE(batch.preflight, '{}'::jsonb),
                      '{executionProtocol,state}',
                      CASE
                        WHEN EXISTS (
                          SELECT 1
                          FROM publish_batch_items AS item
                          WHERE item.batch_id = batch.id
                            AND item.state IN ('queued', 'preflighting', 'ready', 'paused')
                        ) THEN '"partial_failure"'::jsonb
                        ELSE '"failed"'::jsonb
                      END,
                      true
                    ),
                    '{executionProtocol,lastError}',
                    $2::jsonb,
                    true
                  ),
                  last_error = $3,
                  updated_at = $4::timestamptz
              WHERE batch.id = $1
                AND batch.tenant_id = $5
                AND batch.store_id = $6
            `,
            values: [
              batchId,
              JSON.stringify(normalizedError),
              normalizedError.message,
              failedAt,
              tenantId,
              storeId,
            ],
          });
        }
      }
      return presentJob(job);
    });
  }

  async recordQueueFailure({
    tenantId,
    storeId,
    executionRunId,
    error,
    failedAt = new Date(),
  } = {}) {
    const normalizedError = executionError(error);
    return withTransaction(this.pool, async (client) => {
      const failedJobs = await client.query({
        text: `
          UPDATE publish_jobs
          SET state = 'failed_terminal',
              claim_id = NULL,
              worker_id = NULL,
              claimed_at = NULL,
              claim_expires_at = NULL,
              last_error = $4::jsonb,
              updated_at = $5::timestamptz
          WHERE tenant_id = $1
            AND store_id = $2
            AND execution_run_id = $3
            AND state IN ('authorized', 'failed_retryable')
          RETURNING id, publish_batch_id, publish_batch_item_id
        `,
        values: [
          tenantId,
          storeId,
          executionRunId,
          JSON.stringify(normalizedError),
          failedAt,
        ],
      });
      const batchIds = Array.from(
        new Set(
          failedJobs.rows
            .map((job) => String(job.publish_batch_id || "").trim())
            .filter(Boolean),
        ),
      );
      for (const batchId of batchIds) {
        await client.query({
          text: `
            UPDATE publish_batch_items
            SET state = 'failed',
                last_error = $3,
                updated_at = $4::timestamptz
            WHERE batch_id = $1
              AND state <> 'completed'
              AND id = ANY($2::uuid[])
          `,
          values: [
            batchId,
            failedJobs.rows
              .filter((job) => job.publish_batch_id === batchId)
              .map((job) => job.publish_batch_item_id),
            JSON.stringify(normalizedError),
            failedAt,
          ],
        });
        await client.query({
          text: `
            UPDATE publish_batches
            SET state = 'failed',
                preflight = jsonb_set(
                  jsonb_set(
                    COALESCE(preflight, '{}'::jsonb),
                    '{executionProtocol,state}',
                    '"failed"'::jsonb,
                    true
                  ),
                  '{executionProtocol,lastError}',
                  $4::jsonb,
                  true
                ),
                last_error = $3,
                updated_at = $5::timestamptz
            WHERE id = $1
              AND tenant_id = $2
              AND store_id = $6
          `,
          values: [
            batchId,
            tenantId,
            normalizedError.message,
            JSON.stringify(normalizedError),
            failedAt,
            storeId,
          ],
        });
      }
      const failedRun = await client.query({
        text: `
          UPDATE publish_execution_runs
          SET state = 'failed',
              execution_enabled = false,
              authorizes_publishing = false,
              last_error = $4::jsonb,
              updated_at = $5::timestamptz
          WHERE id = $3
            AND tenant_id = $1
            AND store_id = $2
            AND state = 'running'
          RETURNING *
        `,
        values: [
          tenantId,
          storeId,
          executionRunId,
          JSON.stringify(normalizedError),
          failedAt,
        ],
      });
      return {
        jobs: failedJobs.rows.map(presentJob),
        run: presentRun(failedRun.rows[0] || null),
        error: normalizedError,
      };
    });
  }

  async settleExecutionRun({
    tenantId,
    storeId,
    executionRunId,
    settledAt = new Date(),
  } = {}) {
    const result = await this.pool.query({
      text: `
        WITH job_states AS (
          SELECT
            COUNT(*) FILTER (
              WHERE state IN ('authorized', 'claimed', 'failed_retryable')
            ) AS write_pending_count,
            COUNT(*) FILTER (
              WHERE state IN ('submitted', 'result_unknown')
            ) AS readback_pending_count,
            COUNT(*) FILTER (
              WHERE state = 'failed_terminal'
            ) AS terminal_failure_count
          FROM publish_jobs
          WHERE tenant_id = $1
            AND store_id = $2
            AND execution_run_id = $3
        )
        UPDATE publish_execution_runs AS run
        SET state = CASE
              WHEN job_states.write_pending_count = 0
                AND job_states.readback_pending_count = 0
                AND job_states.terminal_failure_count > 0
              THEN 'failed'
              ELSE run.state
            END,
            execution_enabled = CASE
              WHEN job_states.write_pending_count = 0 THEN false
              ELSE run.execution_enabled
            END,
            authorizes_publishing = CASE
              WHEN job_states.write_pending_count = 0 THEN false
              ELSE run.authorizes_publishing
            END,
            last_error = CASE
              WHEN job_states.write_pending_count = 0
                AND job_states.readback_pending_count = 0
                AND job_states.terminal_failure_count > 0
              THEN jsonb_build_object(
                'code', 'PRODUCT_PUBLISH_EXECUTION_FAILED',
                'message', '一个或多个商品发布请求明确失败',
                'occurredAt', $4::timestamptz
              )
              ELSE run.last_error
            END,
            updated_at = $4::timestamptz
        FROM job_states
        WHERE run.id = $3
          AND run.tenant_id = $1
          AND run.store_id = $2
          AND run.state = 'running'
        RETURNING run.*
      `,
      values: [tenantId, storeId, executionRunId, settledAt],
    });
    return presentRun(result.rows[0] || null);
  }

  async appendWebhookReceipts({
    tenantId,
    storeId,
    webhookEventId,
    receiptType,
    records = [],
  } = {}) {
    if (!tenantId || !storeId || !webhookEventId) {
      throw new Error("发布Webhook回执缺少租户、店铺或事件ID");
    }
    if (!Array.isArray(records) || !records.length) {
      throw new Error("发布Webhook回执没有规范化记录");
    }
    if (!["received", "audited"].includes(receiptType)) {
      throw new Error("发布Webhook回执类型无效");
    }

    return this.#appendExternalReceipts({
      tenantId,
      storeId,
      externalEventId: webhookEventId,
      receiptType,
      records,
      dedupeKeyFor: (record, index) => `${webhookEventId}:${index}`,
    });
  }

  async appendUnscopedWebhookReceipts({
    webhookEventId,
    receiptType,
    records = [],
  } = {}) {
    if (!webhookEventId) {
      throw new Error("无店铺作用域的发布Webhook回执缺少事件ID");
    }
    if (!Array.isArray(records) || !records.length) {
      throw new Error("无店铺作用域的发布Webhook回执没有规范化记录");
    }
    if (!["received", "audited"].includes(receiptType)) {
      throw new Error("发布Webhook回执类型无效");
    }

    return this.#appendExternalReceipts({
      tenantId: null,
      storeId: null,
      externalEventId: webhookEventId,
      receiptType,
      records,
      dedupeKeyFor: (record, index) => `${webhookEventId}:${index}`,
    });
  }

  async appendDocumentStateReceipts({
    tenantId,
    storeId,
    records = [],
  } = {}) {
    if (!tenantId || !storeId) {
      throw new Error("商品文档状态回执缺少租户或店铺");
    }
    if (!Array.isArray(records) || !records.length) {
      throw new Error("商品文档状态回执没有规范化记录");
    }
    return this.#appendExternalReceipts({
      tenantId,
      storeId,
      externalEventId: null,
      receiptType: "document_state",
      records,
      dedupeKeyFor: (record) =>
        `document-state:${createRuleFingerprint({
          documentSn: record?.documentSn || null,
          version: record?.version || null,
          spuName: record?.spuName || null,
          skcName: record?.skcName || null,
          skuCodes: Array.isArray(record?.skuCodes) ? record.skuCodes : [],
          status: record?.status || "unknown",
          failedReasons: Array.isArray(record?.failedReasons)
            ? record.failedReasons
            : [],
        })}`,
    });
  }

  async findApprovedReadbackJob({
    tenantId,
    storeId,
    spuName,
    version,
  } = {}) {
    if (!tenantId || !storeId || !spuName || !version) {
      throw new Error("SPU关系回读任务缺少租户、店铺、SPU或版本");
    }
    const result = await this.pool.query({
      text: `
        SELECT job.*
        FROM publish_jobs AS job
        WHERE job.tenant_id = $1
          AND job.store_id = $2
          AND job.shein_version = $3
          AND ${EFFECTIVE_PUBLISH_SPU_NAME_SQL} = $4
          AND EXISTS (
            SELECT 1
            FROM publish_receipts AS receipt
            WHERE receipt.publish_job_id = job.id
              AND receipt.tenant_id = job.tenant_id
              AND receipt.store_id = job.store_id
              AND receipt.receipt_type IN ('audited', 'document_state')
              AND receipt.status = 'passed'
          )
        ORDER BY job.updated_at DESC, job.id
        LIMIT 2
      `,
      values: [tenantId, storeId, version, spuName],
    });
    if (result.rows.length > 1) {
      throw new Error("SPU关系回读任务匹配不唯一");
    }
    return presentJob(result.rows[0] || null);
  }

  async listPublishReadbackStatus({
    tenantId,
    storeId,
    batchId,
  } = {}) {
    if (!tenantId || !storeId || !batchId) {
      throw new Error("发布回读状态缺少租户、店铺或批次");
    }
    const result = await this.pool.query({
      text: `
        SELECT
          job.id,
          job.product_draft_id,
          job.request_key,
          job.state,
          job.last_error,
          job.trace_id,
          job.request_summary,
          ${EFFECTIVE_PUBLISH_SPU_NAME_SQL} AS effective_spu_name,
          ${EFFECTIVE_PUBLISH_SKC_NAMES_SQL} AS effective_skc_names,
          job.shein_document_sn,
          job.shein_version,
          job.readback,
          job.submitted_at,
          job.updated_at,
          COALESCE((
            SELECT jsonb_build_object(
              'status', receipt.status,
              'occurredAt', receipt.occurred_at,
              'documentSn', receipt.document_sn,
              'version', receipt.version,
              'spuName', receipt.spu_name,
              'auditState', receipt.payload->'auditState',
              'auditStateLabel', receipt.payload->>'auditStateLabel',
              'workflowStage', COALESCE(receipt.payload->>'workflowStage', receipt.payload->>'workflow_stage'),
              'failedReasons', COALESCE(receipt.payload->'failedReasons', '[]'::jsonb),
              'traceId', receipt.trace_id
            )
            FROM publish_receipts AS receipt
            WHERE receipt.publish_job_id = job.id
              AND receipt.tenant_id = job.tenant_id
              AND receipt.store_id = job.store_id
              AND receipt.receipt_type IN ('audited', 'document_state')
            ORDER BY receipt.occurred_at DESC NULLS LAST, receipt.created_at DESC
            LIMIT 1
          ), '{}'::jsonb) AS document_state,
          COALESCE((
            SELECT jsonb_build_object(
              'status', receipt.status,
              'occurredAt', receipt.occurred_at,
              'summary', COALESCE(receipt.payload->'summary', '{}'::jsonb)
            )
            FROM publish_receipts AS receipt
            WHERE receipt.publish_job_id = job.id
              AND receipt.tenant_id = job.tenant_id
              AND receipt.store_id = job.store_id
              AND receipt.receipt_type = 'readback'
            ORDER BY receipt.occurred_at DESC NULLS LAST, receipt.created_at DESC
            LIMIT 1
          ), '{}'::jsonb) AS readback_receipt,
          COALESCE((
            SELECT jsonb_build_object(
              'status', receipt.status,
              'occurredAt', receipt.occurred_at,
              'summary', COALESCE(receipt.payload->'summary', '{}'::jsonb)
            )
            FROM publish_receipts AS receipt
            WHERE receipt.publish_job_id = job.id
              AND receipt.tenant_id = job.tenant_id
              AND receipt.store_id = job.store_id
              AND receipt.receipt_type = 'compliance'
            ORDER BY receipt.occurred_at DESC NULLS LAST, receipt.created_at DESC
            LIMIT 1
          ), '{}'::jsonb) AS compliance_receipt,
          CASE
            WHEN job.receipt ? 'compliancePhotoSubmission' THEN jsonb_build_object(
              'status', job.receipt->'compliancePhotoSubmission'->>'status',
              'occurredAt', job.submitted_at,
              'summary', jsonb_build_object(
                'packageCount', COALESCE((job.receipt->'compliancePhotoSubmission'->>'packageCount')::integer, 0),
                'bodyCount', COALESCE((job.receipt->'compliancePhotoSubmission'->>'bodyCount')::integer, 0),
                'skcCount', COALESCE((job.receipt->'compliancePhotoSubmission'->>'skcCount')::integer, 0),
                'message', job.receipt->'compliancePhotoSubmission'->>'message',
                'code', job.receipt->'compliancePhotoSubmission'->>'code',
                'traceId', job.receipt->'compliancePhotoSubmission'->>'traceId'
              )
            )
            ELSE '{}'::jsonb
          END AS compliance_photo_submission
        FROM publish_jobs AS job
        WHERE job.tenant_id = $1
          AND job.store_id = $2
          AND job.publish_batch_id = $3
        ORDER BY job.created_at, job.id
      `,
      values: [tenantId, storeId, batchId],
    });
    return result.rows;
  }

  async getComplianceRevalidationSource({
    tenantId,
    storeId,
    jobId,
    now = new Date(),
  } = {}) {
    if (!tenantId || !storeId || !jobId) {
      throw new Error("合规复验来源缺少租户、店铺或任务");
    }
    const jobResult = await this.pool.query({
      text: `
        SELECT
          job.id,
          job.shein_version,
          job.request_summary,
          draft.draft_data,
          draft.preflight,
          ${EFFECTIVE_PUBLISH_SPU_NAME_SQL} AS effective_spu_name,
          ${EFFECTIVE_PUBLISH_SKC_NAMES_SQL} AS effective_skc_names,
          readback.payload AS readback_payload
        FROM publish_jobs AS job
        JOIN product_drafts AS draft
          ON draft.id = job.product_draft_id
         AND draft.tenant_id = job.tenant_id
         AND draft.store_id = job.store_id
        JOIN LATERAL (
          SELECT receipt.payload
          FROM publish_receipts AS receipt
          WHERE receipt.publish_job_id = job.id
            AND receipt.tenant_id = job.tenant_id
            AND receipt.store_id = job.store_id
            AND receipt.receipt_type = 'readback'
            AND receipt.status = 'passed'
            AND receipt.version = job.shein_version
            AND receipt.spu_name = ${EFFECTIVE_PUBLISH_SPU_NAME_SQL}
          ORDER BY receipt.occurred_at DESC NULLS LAST, receipt.created_at DESC
          LIMIT 1
        ) AS readback ON true
        WHERE job.id = $1
          AND job.tenant_id = $2
          AND job.store_id = $3
      `,
      values: [jobId, tenantId, storeId],
    });
    const job = jobResult.rows[0] || null;
    if (!job) return null;

    const skcNames = Array.from(
      new Set(
        (Array.isArray(job.effective_skc_names)
          ? job.effective_skc_names
          : Array.isArray(job.request_summary?.skcNames)
            ? job.request_summary.skcNames
            : [])
          .map((value) => String(value || "").trim())
          .filter(Boolean),
      ),
    );
    const snapshotResult = await this.pool.query({
      text: `
        SELECT DISTINCT ON (subject_key)
          subject_key,
          payload,
          source_trace_id,
          fetched_at,
          expires_at,
          expires_at > $4::timestamptz AS fresh
        FROM shein_rule_snapshots
        WHERE tenant_id = $1
          AND store_id = $2
          AND rule_type = 'compliance_requirement'
          AND subject_key = ANY($3::text[])
        ORDER BY subject_key, fetched_at DESC, id DESC
      `,
      values: [tenantId, storeId, skcNames, now],
    });
    const ruleSnapshotsBySkc = Object.fromEntries(
      snapshotResult.rows.map((row) => [
        String(row.subject_key),
        {
          fetchedAt: row.fetched_at || null,
          expiresAt: row.expires_at || null,
          fresh: row.fresh === true,
          traceId: row.source_trace_id || null,
        },
      ]),
    );
    return {
      job: presentJob(job),
      draftData: job.draft_data || {},
      draftPreflight: job.preflight || {},
      readback: job.readback_payload || {},
      requirementRows: snapshotResult.rows.map((row) => row.payload || {}),
      ruleSnapshotsBySkc,
    };
  }

  async appendSpuReadbackReceipt({
    tenantId,
    storeId,
    jobId,
    version,
    projection,
    occurredAt = null,
  } = {}) {
    if (!tenantId || !storeId || !jobId || !version || !projection) {
      throw new Error("SPU关系回读回执缺少关联字段");
    }
    const normalizedProjection = {
      spuName: projection.spuName || null,
      categoryId: projection.categoryId ?? null,
      productTypeId: projection.productTypeId ?? null,
      supplierCode: projection.supplierCode || null,
      skcs: Array.isArray(projection.skcs)
        ? projection.skcs.map((skc) => ({
            skcName: skc?.skcName || null,
            supplierCode: skc?.supplierCode || null,
            skuList: Array.isArray(skc?.skuList)
              ? skc.skuList.map((sku) => ({
                  skuCode: sku?.skuCode || null,
                  supplierSku: sku?.supplierSku || null,
                }))
              : [],
          }))
        : [],
    };
    const dedupeKey = `spu-readback:${createRuleFingerprint({
      version,
      projection: normalizedProjection,
    })}`;
    return withTransaction(this.pool, async (client) => {
      const inserted = await client.query({
        text: `
          INSERT INTO publish_receipts (
            tenant_id, store_id, publish_job_id, receipt_type, status,
            dedupe_key, version, spu_name, payload, occurred_at
          )
          SELECT
            $1, $2, job.id, 'readback', 'passed',
            $4, $5, $6, $7::jsonb, $8::timestamptz
          FROM publish_jobs AS job
          WHERE job.id = $3
            AND job.tenant_id = $1
            AND job.store_id = $2
            AND job.shein_version = $5
            AND EXISTS (
              SELECT 1
              FROM publish_receipts AS approval
              WHERE approval.publish_job_id = job.id
                AND approval.tenant_id = job.tenant_id
                AND approval.store_id = job.store_id
                AND approval.receipt_type IN ('audited', 'document_state')
                AND approval.status = 'passed'
            )
          ON CONFLICT (publish_job_id, receipt_type, dedupe_key)
          DO NOTHING
          RETURNING *
        `,
        values: [
          tenantId,
          storeId,
          jobId,
          dedupeKey,
          version,
          normalizedProjection.spuName,
          JSON.stringify(normalizedProjection),
          occurredAt,
        ],
      });
      let row = inserted.rows[0] || null;
      let deduplicated = false;
      if (!row) {
        const existing = await client.query({
          text: `
            SELECT *
            FROM publish_receipts
            WHERE publish_job_id = $1
              AND receipt_type = 'readback'
              AND dedupe_key = $2
          `,
          values: [jobId, dedupeKey],
        });
        row = existing.rows[0] || null;
        deduplicated = Boolean(row);
      }
      if (!row) return null;
      await client.query({
        text: `
          UPDATE publish_jobs
          SET readback = COALESCE(readback, '{}'::jsonb) ||
              jsonb_build_object(
                'spu', 'completed',
                'spuName', $2,
                'version', $3,
                'skcCount', $4,
                'skuCount', $5
              ),
              updated_at = now()
          WHERE id = $1
            AND tenant_id = $6
            AND store_id = $7
        `,
        values: [
          jobId,
          normalizedProjection.spuName,
          version,
          normalizedProjection.skcs.length,
          normalizedProjection.skcs.reduce(
            (total, skc) => total + skc.skuList.length,
            0,
          ),
          tenantId,
          storeId,
        ],
      });
      return { ...row, deduplicated };
    });
  }

  async appendComplianceRevalidationReceipt({
    tenantId,
    storeId,
    jobId,
    version,
    projection,
    occurredAt = null,
  } = {}) {
    if (!tenantId || !storeId || !jobId || !version || !projection) {
      throw new Error("合规复验回执缺少关联字段");
    }
    if (!["passed", "blocked"].includes(String(projection.status || ""))) {
      throw new Error("合规复验状态无效");
    }
    const normalizedProjection = {
      projectionVersion: projection.projectionVersion || null,
      status: projection.status,
      completionEligible: projection.completionEligible === true,
      spuName: projection.spuName || null,
      ruleSnapshot: projection.ruleSnapshot || null,
      ruleSnapshotsBySkc: projection.ruleSnapshotsBySkc || {},
      skcs: Array.isArray(projection.skcs) ? projection.skcs : [],
      blockers: Array.isArray(projection.blockers) ? projection.blockers : [],
      summary: projection.summary || {},
    };
    const status = normalizedProjection.completionEligible ? "passed" : "failed";
    const dedupeKey = `compliance:${createRuleFingerprint({
      version,
      projection: normalizedProjection,
    })}`;
    return withTransaction(this.pool, async (client) => {
      const inserted = await client.query({
        text: `
          INSERT INTO publish_receipts (
            tenant_id, store_id, publish_job_id, receipt_type, status,
            dedupe_key, version, spu_name, payload, occurred_at
          )
          SELECT
            $1, $2, job.id, 'compliance', $8,
            $4, $5, $6, $7::jsonb, $9::timestamptz
          FROM publish_jobs AS job
          WHERE job.id = $3
            AND job.tenant_id = $1
            AND job.store_id = $2
            AND job.shein_version = $5
            AND ${EFFECTIVE_PUBLISH_SPU_NAME_SQL} = $6
            AND EXISTS (
              SELECT 1
              FROM publish_receipts AS readback
              WHERE readback.publish_job_id = job.id
                AND readback.tenant_id = job.tenant_id
                AND readback.store_id = job.store_id
                AND readback.receipt_type = 'readback'
                AND readback.status = 'passed'
                AND readback.version = job.shein_version
                AND readback.spu_name = ${EFFECTIVE_PUBLISH_SPU_NAME_SQL}
            )
          ON CONFLICT (publish_job_id, receipt_type, dedupe_key)
          DO NOTHING
          RETURNING *
        `,
        values: [
          tenantId,
          storeId,
          jobId,
          dedupeKey,
          version,
          normalizedProjection.spuName,
          JSON.stringify(normalizedProjection),
          status,
          occurredAt,
        ],
      });
      let row = inserted.rows[0] || null;
      let deduplicated = false;
      if (!row) {
        const existing = await client.query({
          text: `
            SELECT *
            FROM publish_receipts
            WHERE publish_job_id = $1
              AND receipt_type = 'compliance'
              AND dedupe_key = $2
          `,
          values: [jobId, dedupeKey],
        });
        row = existing.rows[0] || null;
        deduplicated = Boolean(row);
      }
      if (!row) return null;
      const completed = await client.query({
        text: `
          UPDATE publish_jobs
          SET state = CASE
                WHEN $6::boolean
                  AND state IN ('submitted', 'result_unknown')
                THEN 'completed'
                ELSE state
              END,
              readback = COALESCE(readback, '{}'::jsonb) ||
                jsonb_build_object(
                  'compliance',
                  CASE WHEN $6::boolean THEN 'completed' ELSE 'blocked' END,
                  'complianceReceiptId', $2,
                  'complianceStatus', $3
                ),
              completed_at = CASE
                WHEN $6::boolean THEN COALESCE(completed_at, now())
                ELSE completed_at
              END,
              updated_at = now()
          WHERE id = $1
            AND tenant_id = $4
            AND store_id = $5
          RETURNING
            state,
            publish_batch_item_id,
            product_draft_id,
            publish_batch_id,
            execution_run_id
        `,
        values: [
          jobId,
          row.id,
          status,
          tenantId,
          storeId,
          normalizedProjection.completionEligible,
        ],
      });
      const completion = completed.rows[0] || null;
      if (completion?.state === "completed") {
        await client.query({
          text: `
            UPDATE publish_batch_items
            SET state = 'completed',
                last_error = NULL,
                updated_at = now()
            WHERE id = $1
              AND batch_id = $2
          `,
          values: [
            completion.publish_batch_item_id,
            completion.publish_batch_id,
          ],
        });
        await client.query({
          text: `
            UPDATE product_drafts
            SET status = 'published',
                updated_at = now()
            WHERE id = $1
              AND tenant_id = $2
              AND store_id = $3
          `,
          values: [completion.product_draft_id, tenantId, storeId],
        });
        // 发布完成后，草稿不再需要继续占用发布素材；共享给其他草稿、模板或合规记录的素材会保留。
        await client.query({
          text: `
            WITH released AS (
              DELETE FROM media_asset_references AS ref
              USING media_assets AS source_asset
              WHERE ref.asset_id = source_asset.id
                AND ref.tenant_id = $1
                AND ref.store_id = $2
                AND ref.reference_type = 'product_draft'
                AND ref.reference_key = $3
                AND source_asset.purpose IN (
                  'temporary_upload', 'reusable_source',
                  'generated_unselected', 'selected_unpublished'
                )
              RETURNING ref.asset_id
            ),
            affected AS (
              SELECT released.asset_id, COUNT(ref.asset_id)::int AS reference_count
              FROM released
              LEFT JOIN media_asset_references AS ref
                ON ref.asset_id = released.asset_id
              GROUP BY released.asset_id
            )
            UPDATE media_assets AS asset
            SET reference_count = refs.reference_count,
                status = CASE
                  WHEN refs.reference_count = 0
                    AND asset.purpose IN (
                      'temporary_upload', 'reusable_source',
                      'generated_unselected', 'selected_unpublished'
                    )
                    AND asset.status <> 'deleted'
                    THEN 'pending_delete'
                  WHEN refs.reference_count > 0
                    AND asset.status IN ('ready', 'referenced', 'pending_delete')
                    THEN 'referenced'
                  ELSE asset.status
                END,
                expires_at = CASE
                  WHEN refs.reference_count = 0
                    AND asset.purpose IN (
                      'temporary_upload', 'reusable_source',
                      'generated_unselected', 'selected_unpublished'
                    )
                    AND asset.status <> 'deleted'
                    THEN now()
                  ELSE asset.expires_at
                END,
                delete_after = CASE
                  WHEN refs.reference_count = 0
                    AND asset.purpose IN (
                      'temporary_upload', 'reusable_source',
                      'generated_unselected', 'selected_unpublished'
                    )
                    AND asset.status <> 'deleted'
                    THEN now()
                  ELSE asset.delete_after
                END,
                updated_at = now()
            FROM affected AS refs
            WHERE asset.id = refs.asset_id
              AND asset.tenant_id = $1
              AND asset.store_id = $2
              AND asset.purpose IN (
                'temporary_upload', 'reusable_source',
                'generated_unselected', 'selected_unpublished'
              )
          `,
          values: [tenantId, storeId, String(completion.product_draft_id)],
        });
        await client.query({
          text: `
            UPDATE publish_batches AS batch
            SET state = 'completed',
                preflight = jsonb_set(
                  jsonb_set(
                    COALESCE(batch.preflight, '{}'::jsonb),
                    '{executionProtocol,state}',
                    '"completed"'::jsonb,
                    true
                  ),
                  '{executionProtocol,completedAt}',
                  to_jsonb(now()),
                  true
                ),
                last_error = NULL,
                updated_at = now()
            WHERE batch.id = $1
              AND batch.tenant_id = $2
              AND batch.store_id = $3
              AND NOT EXISTS (
                SELECT 1
                FROM publish_jobs AS job
                WHERE job.publish_batch_id = batch.id
                  AND job.tenant_id = batch.tenant_id
                  AND job.store_id = batch.store_id
                  AND job.state <> 'completed'
              )
          `,
          values: [completion.publish_batch_id, tenantId, storeId],
        });
        await client.query({
          text: `
            UPDATE publish_execution_runs AS run
            SET state = 'completed',
                execution_enabled = false,
                authorizes_publishing = false,
                completed_at = COALESCE(completed_at, now()),
                last_error = NULL,
                updated_at = now()
            WHERE run.id = $1
              AND run.tenant_id = $2
              AND run.store_id = $3
              AND run.state = 'running'
              AND NOT EXISTS (
                SELECT 1
                FROM publish_jobs AS job
                WHERE job.execution_run_id = run.id
                  AND job.tenant_id = run.tenant_id
                  AND job.store_id = run.store_id
                  AND job.state <> 'completed'
              )
          `,
          values: [completion.execution_run_id, tenantId, storeId],
        });
      }
      return { ...row, deduplicated };
    });
  }

  async #appendExternalReceipts({
    tenantId,
    storeId,
    externalEventId,
    receiptType,
    records,
    dedupeKeyFor,
  }) {
    return withTransaction(this.pool, async (client) => {
      let matchedCount = 0;
      let persistedCount = 0;
      let ambiguousCount = 0;
      const unmatchedCount = [];

      for (const [index, record] of records.entries()) {
        const [documentSn, version, spuName, skcName, skuCode] =
          receiptRecordValues(record);
        if (!documentSn && !version) {
          unmatchedCount.push(index);
          continue;
        }
        const candidates = await client.query({
          text: `
            SELECT job.id, job.tenant_id, job.store_id
            FROM publish_jobs AS job
            WHERE ($1::uuid IS NULL OR job.tenant_id = $1::uuid)
              AND ($2::uuid IS NULL OR job.store_id = $2::uuid)
              AND (
                ($1::uuid IS NOT NULL AND $2::uuid IS NOT NULL)
                OR ($3::text IS NOT NULL AND $4::text IS NOT NULL)
                OR (
                  $4::text IS NOT NULL
                  AND $5::text IS NOT NULL
                  AND ($6::text IS NOT NULL OR $7::text IS NOT NULL)
                )
              )
              AND (
                (
                  $3::text IS NOT NULL
                  AND job.shein_document_sn = $3
                  AND ($4::text IS NULL OR job.shein_version = $4)
                )
                OR
                (
                  $4::text IS NOT NULL
                  AND job.shein_version = $4
                  AND ($5::text IS NULL OR ${EFFECTIVE_PUBLISH_SPU_NAME_SQL} = $5)
                  AND ($6::text IS NULL OR ${EFFECTIVE_PUBLISH_SKC_NAMES_SQL} ? $6)
                  AND ($7::text IS NULL OR ${EFFECTIVE_PUBLISH_SKU_CODES_SQL} ? $7)
                )
              )
            ORDER BY job.updated_at DESC, job.id
            LIMIT 2
          `,
          values: [
            tenantId,
            storeId,
            documentSn,
            version,
            spuName,
            skcName,
            skuCode,
          ],
        });
        if (candidates.rows.length !== 1) {
          if (candidates.rows.length > 1) ambiguousCount += 1;
          unmatchedCount.push(index);
          continue;
        }

        const jobId = candidates.rows[0].id;
        const matchedTenantId = candidates.rows[0].tenant_id || tenantId;
        const matchedStoreId = candidates.rows[0].store_id || storeId;
        if (!matchedTenantId || !matchedStoreId) {
          unmatchedCount.push(index);
          continue;
        }
        matchedCount += 1;
        const status = receiptStatusFor(record);
        const dedupeKey = dedupeKeyFor(record, index);
        const inserted = await client.query({
          text: `
            INSERT INTO publish_receipts (
              tenant_id, store_id, publish_job_id, webhook_event_id,
              receipt_type, status, dedupe_key, trace_id,
              document_sn, version, spu_name, skc_name, sku_code,
              payload, occurred_at
            )
            VALUES (
            $1, $2, $3, $4,
              $5, $6, $7, $8,
              $9, $10, $11, $12, $13,
              $14::jsonb, $15::timestamptz
            )
            ON CONFLICT (publish_job_id, receipt_type, dedupe_key)
            DO NOTHING
            RETURNING *
          `,
          values: [
            matchedTenantId,
            matchedStoreId,
            jobId,
            externalEventId,
            receiptType,
            status,
            dedupeKey,
            record.traceId || null,
            documentSn,
            version,
            spuName,
            skcName,
            skuCode,
            JSON.stringify(record),
            record.occurredAt || null,
          ],
        });
        if (inserted.rowCount) persistedCount += 1;
        await client.query({
          text: `
            UPDATE publish_jobs
            SET state = CASE
                  WHEN state = 'result_unknown' THEN 'submitted'
                  ELSE state
                END,
                shein_document_sn = COALESCE($2, shein_document_sn),
                shein_version = COALESCE($3, shein_version),
                updated_at = now()
            WHERE id = $1
              AND tenant_id = $4
              AND store_id = $5
              AND state <> 'completed'
          `,
          values: [jobId, documentSn, version, matchedTenantId, matchedStoreId],
        });
      }

      return {
        matchedCount,
        persistedCount,
        ambiguousCount,
        unmatchedCount,
      };
    });
  }

  async appendReceipt({
    tenantId,
    storeId,
    jobId,
    webhookEventId = null,
    receiptType,
    status,
    dedupeKey,
    platformCode = null,
    traceId = null,
    documentSn = null,
    version = null,
    spuName = null,
    skcName = null,
    skuCode = null,
    payload = {},
    occurredAt = null,
  } = {}) {
    return withTransaction(this.pool, async (client) => {
      const inserted = await client.query({
        text: `
          INSERT INTO publish_receipts (
            tenant_id, store_id, publish_job_id, webhook_event_id,
            receipt_type, status, dedupe_key, platform_code, trace_id,
            document_sn, version, spu_name, skc_name, sku_code,
            payload, occurred_at
          )
          SELECT
            $1, $2, job.id, $4,
            $5, $6, $7, $8, $9,
            $10, $11, $12, $13, $14,
            $15::jsonb, $16::timestamptz
          FROM publish_jobs AS job
          WHERE job.id = $3
            AND job.tenant_id = $1
            AND job.store_id = $2
          ON CONFLICT (publish_job_id, receipt_type, dedupe_key)
          DO NOTHING
          RETURNING *
        `,
        values: [
          tenantId,
          storeId,
          jobId,
          webhookEventId,
          receiptType,
          status,
          dedupeKey,
          platformCode,
          traceId,
          documentSn,
          version,
          spuName,
          skcName,
          skuCode,
          JSON.stringify(payload || {}),
          occurredAt,
        ],
      });
      if (inserted.rowCount) return inserted.rows[0];
      const existing = await client.query({
        text: `
          SELECT *
          FROM publish_receipts
          WHERE publish_job_id = $1
            AND receipt_type = $2
            AND dedupe_key = $3
        `,
        values: [jobId, receiptType, dedupeKey],
      });
      return existing.rows[0] || null;
    });
  }
}

export function isExecutionClaimQuery(text) {
  return /FOR UPDATE OF job SKIP LOCKED/i.test(text) &&
    /state = 'claimed'/i.test(text) &&
    /claim_expires_at/i.test(text);
}
