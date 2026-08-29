import { withTransaction } from "./postgres.js";

function textOrNull(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function quotaValue(value) {
  const normalized = textOrNull(value);
  if (normalized === null) return null;
  const parsed = Number(normalized);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : normalized;
}

function quotaPeriodKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 7);
}

export class PostgresWebhookBusinessStateRepository {
  constructor({ pool } = {}) {
    if (!pool) throw new Error("Webhook 业务状态仓库缺少 pool");
    this.pool = pool;
  }

  async requireReauthorizationBySupplierId({
    supplierId,
    tenantId = null,
    storeId = null,
    webhookEventId = null,
  } = {}) {
    const normalizedSupplierId = textOrNull(supplierId);
    if (!normalizedSupplierId || !textOrNull(tenantId) || !textOrNull(storeId)) return [];
    const result = await this.pool.query({
      text: `UPDATE stores
             SET status='reauthorization_required', updated_at=now()
             WHERE tenant_id=$1 AND id=$2 AND supplier_id=$3 AND status <> 'disabled'
             RETURNING id`,
      values: [tenantId, storeId, normalizedSupplierId],
    });
    const storeIds = result.rows.map((row) => String(row.id));
    await this.markBusinessInvalidated({
      storeIds,
      eventType: "authorization_change_notice",
      webhookEventId,
    });
    return storeIds;
  }

  async markComplianceInvalidated({
    skc,
    supplierId,
    complianceTypeId,
    isMiss,
    isRequired,
    updateTime,
    tenantId = null,
    storeId = null,
    webhookEventId = null,
  } = {}) {
    if (
      String(isMiss ?? "") !== "1" ||
      !textOrNull(skc) ||
      !textOrNull(tenantId) ||
      !textOrNull(storeId)
    ) {
      return { matchedCount: 0, skcIds: [], skipped: true };
    }
    const invalidation = {
      source: "shein_webhook",
      eventId: textOrNull(webhookEventId),
      complianceTypeId: textOrNull(complianceTypeId),
      isRequired: textOrNull(isRequired),
      isMiss: "1",
      updateTime: textOrNull(updateTime),
      receivedAt: new Date().toISOString(),
    };
    const result = await this.pool.query({
      text: `UPDATE skcs AS skc_row
             SET compliance_status='需修正',
                 compliance_summary = COALESCE(skc_row.compliance_summary, '{}'::jsonb)
                   || jsonb_build_object(
                        'state', '需修正',
                        'source', 'shein_webhook',
                        'lastInvalidation', $5::jsonb
                      ),
                 raw_data = COALESCE(skc_row.raw_data, '{}'::jsonb)
                   || jsonb_build_object('complianceWebhookInvalidation', $5::jsonb),
                 updated_at=now()
             FROM stores store_row
             WHERE store_row.tenant_id=$3
               AND store_row.id=$4
               AND store_row.id=skc_row.store_id
               AND store_row.tenant_id=skc_row.tenant_id
               AND skc_row.skc_name=$1
               AND ($2::text IS NULL OR store_row.supplier_id=$2)
             RETURNING skc_row.id, skc_row.store_id`,
      values: [
        textOrNull(skc),
        textOrNull(supplierId),
        tenantId,
        storeId,
        JSON.stringify(invalidation),
      ],
    });
    const storeIds = [...new Set(result.rows.map((row) => String(row.store_id)).filter(Boolean))];
    await this.markBusinessInvalidated({
      storeIds,
      eventType: "product_compliance_change_notice",
      webhookEventId,
    });
    return {
      matchedCount: result.rowCount,
      skcIds: result.rows.map((row) => String(row.id)),
      skipped: false,
    };
  }

  async saveQuotaProjection({
    supplierId,
    reason,
    availableLimit,
    sendTimestamp,
    tenantId = null,
    storeId = null,
    webhookEventId = null,
  } = {}) {
    const normalizedSupplierId = textOrNull(supplierId);
    if (!normalizedSupplierId || !textOrNull(tenantId) || !textOrNull(storeId)) {
      return { matchedCount: 0, storeIds: [], skipped: true };
    }
    const quota = {
      source: "shein_webhook",
      eventId: textOrNull(webhookEventId),
      reason: textOrNull(reason),
      // The platform value is authoritative. A local submission projection
      // may temporarily lower availableLimit until the next webhook arrives.
      availableLimit: quotaValue(availableLimit),
      platformAvailableLimit: quotaValue(availableLimit),
      localConsumedThisMonth: 0,
      quotaPeriod: quotaPeriodKey(),
      sendTimestamp: textOrNull(sendTimestamp),
      receivedAt: new Date().toISOString(),
    };
    const projection = await withTransaction(this.pool, async (client) => {
      const result = await client.query({
        text: `INSERT INTO store_business_snapshots (
                 tenant_id, store_id, state, snapshot
               )
               SELECT store_row.tenant_id, store_row.id, 'idle',
                      jsonb_build_object('productQuota', $4::jsonb)
               FROM stores store_row
               WHERE store_row.tenant_id=$1
                 AND store_row.id=$2
                 AND store_row.supplier_id=$3
                 AND store_row.status <> 'disabled'
               ON CONFLICT (store_id) DO UPDATE SET
                 snapshot = COALESCE(store_business_snapshots.snapshot, '{}'::jsonb)
                   || jsonb_build_object('productQuota', $4::jsonb),
                 updated_at=now()
               RETURNING store_id`,
        values: [tenantId, storeId, normalizedSupplierId, JSON.stringify(quota)],
      });
      return {
        matchedCount: result.rowCount,
        storeIds: result.rows.map((row) => String(row.store_id)),
        skipped: false,
      };
    });
    await this.markBusinessInvalidated({
      storeIds: projection.storeIds,
      eventType: "product_quota_change_notice",
      webhookEventId,
    });
    return projection;
  }

  async saveOutOfStockProjection({
    skcName,
    skuCode,
    outOfStockQty,
    tempLockExceptionQty,
    sendTimestamp,
    webhookEventId = null,
    tenantId = null,
    storeId = null,
  } = {}) {
    const normalizedSku = textOrNull(skuCode);
    const normalizedSkc = textOrNull(skcName);
    if (!normalizedSku && !normalizedSkc) {
      return { matchedCount: 0, storeIds: [], skipped: true };
    }
    if (!tenantId || !storeId) {
      return { matchedCount: 0, storeIds: [], skipped: true };
    }
    const payload = {
      outOfStockQty: Number(outOfStockQty || 0),
      tempLockExceptionQty: Number(tempLockExceptionQty || 0),
      sendTimestamp: textOrNull(sendTimestamp),
      eventId: textOrNull(webhookEventId),
      receivedAt: new Date().toISOString(),
    };
    const result = await this.pool.query({
      text: `INSERT INTO store_business_snapshots (
               tenant_id, store_id, state, snapshot
             ) VALUES (
               $1, $2, 'idle',
               jsonb_build_object('outOfStock', jsonb_build_object($3::text, $4::jsonb))
             )
             ON CONFLICT (store_id) DO UPDATE SET
               snapshot = jsonb_set(
                 COALESCE(store_business_snapshots.snapshot, '{}'::jsonb),
                 ARRAY['outOfStock', $3::text],
                 $4::jsonb,
                 true
               ),
               updated_at=now()
             WHERE store_business_snapshots.tenant_id = EXCLUDED.tenant_id
             RETURNING store_id`,
      values: [tenantId, storeId, normalizedSku || normalizedSkc, JSON.stringify(payload)],
    });
    const storeIds = result.rows.map((row) => String(row.store_id));
    await this.markBusinessInvalidated({
      storeIds,
      eventType: "out_of_stock_notice",
      webhookEventId,
    });
    return { matchedCount: result.rowCount, storeIds, skipped: false };
  }

  async markBusinessInvalidated({ storeIds = [], eventType, webhookEventId = null } = {}) {
    const ids = [...new Set(storeIds.map((value) => textOrNull(value)).filter(Boolean))];
    if (!ids.length) return [];
    return withTransaction(this.pool, async (client) => {
      await client.query({
        text: `INSERT INTO store_business_snapshots (tenant_id, store_id, state, snapshot)
               SELECT store_row.tenant_id, store_row.id, 'idle', '{}'::jsonb
               FROM stores store_row
               WHERE store_row.id = ANY($1::uuid[])
                 AND store_row.status <> 'disabled'
               ON CONFLICT (store_id) DO NOTHING`,
        values: [ids],
      });
      const result = await client.query({
        text: `UPDATE store_business_snapshots
               SET webhook_version=COALESCE(webhook_version, 0) + 1,
                   last_webhook_at=now(),
                   last_webhook_event_type=$2,
                   last_webhook_event_id=$3,
                   updated_at=now()
               WHERE store_id = ANY($1::uuid[])
               RETURNING store_id`,
        values: [ids, textOrNull(eventType), textOrNull(webhookEventId)],
      });
      return [...new Set(result.rows.map((row) => String(row.store_id)))];
    });
  }
}
