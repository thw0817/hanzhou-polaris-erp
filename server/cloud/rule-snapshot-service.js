import crypto from "node:crypto";

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function createRuleFingerprint(payload) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(payload ?? {})))
    .digest("hex");
}

export class PostgresRuleSnapshotRepository {
  constructor({ pool } = {}) {
    if (!pool) throw new Error("SHEIN规则快照仓库缺少 pool");
    this.pool = pool;
  }

  async getFresh({
    tenantId,
    storeId,
    ruleType,
    categoryId = "",
    productTypeId = "",
    subjectKey = "",
    shareWithinTenant = false,
    now = new Date(),
  }) {
    const sharedStorePredicate = shareWithinTenant
      ? `AND (store_id = $2 OR $8::boolean)`
      : "AND store_id = $2";
    const sharedOrdering = shareWithinTenant
      ? "ORDER BY CASE WHEN store_id = $2 THEN 0 ELSE 1 END, fetched_at DESC"
      : "";
    const result = await this.pool.query({
      text: `
        SELECT id, rule_type, category_id, product_type_id, subject_key,
               fingerprint, payload, source_trace_id, fetched_at, expires_at
        FROM shein_rule_snapshots
        WHERE tenant_id = $1
          ${sharedStorePredicate}
          AND rule_type = $3
          AND category_id = $4
          AND product_type_id = $5
          AND subject_key = $6
          AND expires_at > $7
        ${sharedOrdering}
        LIMIT 1
      `,
      values: [
        tenantId,
        storeId,
        ruleType,
        String(categoryId || ""),
        String(productTypeId || ""),
        String(subjectKey || ""),
        now,
        ...(shareWithinTenant ? [shareWithinTenant] : []),
      ],
    });
    return result.rows[0] || null;
  }

  async listFresh({
    tenantId,
    storeId,
    ruleType,
    shareWithinTenant = false,
    now = new Date(),
  }) {
    const sharedStorePredicate = shareWithinTenant
      ? `AND (store_id = $2 OR $5::boolean)`
      : "AND store_id = $2";
    const sharedOrdering = shareWithinTenant
      ? "ORDER BY CASE WHEN store_id = $2 THEN 0 ELSE 1 END, category_id, product_type_id, fetched_at DESC"
      : "ORDER BY category_id, product_type_id";
    const result = await this.pool.query({
      text: `
        SELECT category_id, product_type_id, fetched_at, expires_at
        FROM shein_rule_snapshots
        WHERE tenant_id = $1
          ${sharedStorePredicate}
          AND rule_type = $3
          AND expires_at > $4
        ${sharedOrdering}
      `,
      values: [
        tenantId,
        storeId,
        ruleType,
        now,
        ...(shareWithinTenant ? [shareWithinTenant] : []),
      ],
    });
    return result.rows;
  }

  async upsert({
    tenantId,
    storeId,
    ruleType,
    categoryId = "",
    productTypeId = "",
    subjectKey = "",
    payload,
    sourceTraceId = null,
    fetchedAt,
    expiresAt,
  }) {
    const normalizedPayload = payload ?? {};
    const result = await this.pool.query({
      text: `
        INSERT INTO shein_rule_snapshots (
          tenant_id, store_id, rule_type, category_id, product_type_id,
          subject_key, fingerprint, payload, source_trace_id, fetched_at,
          expires_at
        )
        SELECT $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11
        FROM stores authorized_store
        WHERE authorized_store.id = $2
          AND authorized_store.tenant_id = $1
        ON CONFLICT (store_id, rule_type, category_id, product_type_id, subject_key)
        DO UPDATE SET
          fingerprint = EXCLUDED.fingerprint,
          payload = EXCLUDED.payload,
          source_trace_id = EXCLUDED.source_trace_id,
          fetched_at = EXCLUDED.fetched_at,
          expires_at = EXCLUDED.expires_at,
          updated_at = now()
        WHERE shein_rule_snapshots.tenant_id = EXCLUDED.tenant_id
        RETURNING id, fingerprint, fetched_at, expires_at
      `,
      values: [
        tenantId,
        storeId,
        ruleType,
        String(categoryId || ""),
        String(productTypeId || ""),
        String(subjectKey || ""),
        createRuleFingerprint(normalizedPayload),
        JSON.stringify(normalizedPayload),
        sourceTraceId || null,
        fetchedAt,
        expiresAt,
      ],
    });
    if (!result.rows[0]) {
      throw new Error("SHEIN规则快照租户与店铺不匹配");
    }
    return result.rows[0];
  }
}
