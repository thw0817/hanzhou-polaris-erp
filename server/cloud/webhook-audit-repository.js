const PRODUCT_AUDIT_EVENT = "product_document_audit_status_notice";
const MAX_LIMIT = 100;

function cleanSupplierId(value) {
  const supplierId = typeof value === "string" ? value.trim() : "";
  if (!supplierId) return null;
  if (
    supplierId.length > 100 ||
    !/^[A-Za-z0-9._-]+$/.test(supplierId)
  ) {
    throw new WebhookAuditQueryError(
      "INVALID_SUPPLIER_ID",
      "店铺供应商ID格式无效",
      400,
    );
  }
  return supplierId;
}

function cleanLimit(value) {
  if (value === undefined || value === null || value === "") return 50;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new WebhookAuditQueryError(
      "INVALID_LIMIT",
      `查询数量必须为1至${MAX_LIMIT}的整数`,
      400,
    );
  }
  return limit;
}

function safeText(value, maxLength = 500) {
  if (value === undefined || value === null) return null;
  return String(value).slice(0, maxLength);
}

function publicProjection(value) {
  const projection =
    value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {};
  const records = Array.isArray(projection.records)
    ? projection.records
    : [];
  return {
    eventFamily:
      safeText(projection.eventFamily, 128) || PRODUCT_AUDIT_EVENT,
    records: records.slice(0, 200).map((record) => ({
      spuName: safeText(record?.spuName, 200),
      skcName: safeText(record?.skcName, 200),
      skuCodes: Array.isArray(record?.skuCodes)
        ? record.skuCodes
            .slice(0, 200)
            .map((code) => safeText(code, 200))
            .filter(Boolean)
        : [],
      documentSn: safeText(record?.documentSn, 200),
      version: safeText(record?.version, 100),
      auditTime: safeText(record?.auditTime, 100),
      auditState: Number.isInteger(Number(record?.auditState))
        ? Number(record.auditState)
        : null,
      auditStateLabel: safeText(record?.auditStateLabel, 40),
      failedReasons: Array.isArray(record?.failedReasons)
        ? record.failedReasons.slice(0, 100).map((reason) => ({
            language: safeText(reason?.language, 40),
            content: safeText(reason?.content, 2_000),
          }))
        : [],
    })),
  };
}

function publicLastError(value) {
  if (!value || typeof value !== "object") return null;
  const message = safeText(value.message, 500);
  const code = safeText(value.code, 128);
  return message || code ? { code, message } : null;
}

export class WebhookAuditQueryError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "WebhookAuditQueryError";
    this.code = code;
    this.status = status;
  }
}

export class PostgresWebhookAuditRepository {
  constructor({ pool } = {}) {
    if (!pool) throw new Error("PostgresWebhookAuditRepository 缺少 pool");
    this.pool = pool;
  }

  async listProductAuditEvents({
    tenantId,
    supplierId = null,
    limit = 50,
  } = {}) {
    if (!tenantId) {
      throw new WebhookAuditQueryError(
        "TENANT_REQUIRED",
        "审核事件查询缺少租户上下文",
        401,
      );
    }
    const normalizedSupplierId = cleanSupplierId(supplierId);
    const normalizedLimit = cleanLimit(limit);
    const values = [tenantId, PRODUCT_AUDIT_EVENT];
    let storeFilter = "";
    if (normalizedSupplierId) {
      values.push(normalizedSupplierId);
      storeFilter = `AND s.supplier_id = $${values.length}`;
    }
    values.push(normalizedLimit + 1);
    const limitParameter = `$${values.length}`;
    const result = await this.pool.query(
      `SELECT we.id, we.event_type, we.state, we.source,
              we.attempt_count, we.received_at, we.processed_at,
              we.projection_version, we.projection, we.last_error,
              s.supplier_id, s.label AS store_label
       FROM webhook_events we
       JOIN stores s
         ON s.id = we.store_id
        AND s.tenant_id = we.tenant_id
       WHERE we.tenant_id = $1
         AND we.event_type = $2
         AND we.source = 'production'
         ${storeFilter}
       ORDER BY we.received_at DESC, we.id DESC
       LIMIT ${limitParameter}`,
      values,
    );
    const hasMore = result.rows.length > normalizedLimit;
    const rows = result.rows.slice(0, normalizedLimit);
    return {
      items: rows.map((row) => ({
        id: String(row.id),
        eventType: row.event_type,
        state: row.state,
        source: row.source,
        attemptCount: Number(row.attempt_count || 0),
        receivedAt: row.received_at,
        processedAt: row.processed_at,
        projectionVersion: row.projection_version,
        projection: publicProjection(row.projection),
        lastError: publicLastError(row.last_error),
        store: {
          supplierId: safeText(row.supplier_id, 100),
          label: safeText(row.store_label, 200),
        },
      })),
      hasMore,
      limit: normalizedLimit,
    };
  }
}

export const PRODUCT_DOCUMENT_AUDIT_EVENT = PRODUCT_AUDIT_EVENT;
