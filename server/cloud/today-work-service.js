const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ACTIONS = new Set(["web.price.accept", "web.price.reject"]);

function text(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asDateRange(date, now) {
  const requested = DATE_PATTERN.test(String(date || ""))
    ? String(date)
    : new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(now).replaceAll("/", "-");
  const start = new Date(`${requested}T00:00:00+08:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { date: requested, start: start.toISOString(), end: end.toISOString() };
}

function emptyStore(store) {
  return {
    storeId: String(store.id),
    storeName: text(store.label, "未命名店铺"),
    published: 0,
    priceAccepted: 0,
    rejected: 0,
    sampled: 0,
    categories: [],
  };
}

function categoryName(row) {
  return text(row.category, "未标注类目");
}

export class WebTodayWorkService {
  constructor({ pool, now = () => new Date() } = {}) {
    if (!pool) throw new Error("WebTodayWorkService 缺少 pool");
    this.pool = pool;
    this.now = now;
  }

  async recordAction({ context, storeId, operation, metadata = {} } = {}) {
    if (!ACTIONS.has(operation) || !context?.tenantId || !storeId) return false;
    try {
      await this.pool.query({
        text: `INSERT INTO api_audit_logs (
                 tenant_id, store_id, user_id, operation, method, path,
                 status_code, metadata
               ) VALUES ($1, $2, $3, $4, 'POST',
                         '/v1/web/stores/:storeId/price-discussions/:discussSn/action',
                         200, $5::jsonb)`,
        values: [
          context.tenantId,
          String(storeId),
          context.userId || null,
          operation,
          JSON.stringify(metadata),
        ],
      });
      return true;
    } catch {
      // Activity recording must never make a successful SHEIN action look failed.
      return false;
    }
  }

  async list({ context, stores = [], storeId = "", date = "" } = {}) {
    const visibleStores = (Array.isArray(stores) ? stores : [])
      .filter((store) => store?.id)
      .filter((store, index, all) => all.findIndex((candidate) => candidate.id === store.id) === index);
    const selectedStoreId = String(storeId || "").trim();
    const scopedStores = selectedStoreId
      ? visibleStores.filter((store) => String(store.id) === selectedStoreId)
      : visibleStores;
    const range = asDateRange(date, this.now());
    if (!scopedStores.length) {
      return {
        date: range.date,
        timezone: "Asia/Shanghai",
        refreshedAt: this.now().toISOString(),
        scope: selectedStoreId ? "store" : ["owner", "admin"].includes(context?.role) ? "all" : "assigned",
        stores: [],
        totals: { published: 0, priceAccepted: 0, rejected: 0, sampled: 0 },
        activity: [],
      };
    }

    const storeIds = scopedStores.map((store) => String(store.id));
    const values = [context?.tenantId || null, storeIds, range.start, range.end];
    const [published, price, rejected, sampled, activity] = await Promise.all([
      this.pool.query({
        /* today_work_publish_summary */
        text: `/* today_work_publish_summary */
               SELECT job.store_id,
                      COALESCE(NULLIF(draft.draft_data->>'categoryName', ''),
                               NULLIF(draft.draft_data->>'categoryPath', ''),
                               NULLIF(draft.category_id::text, ''), '未标注类目') AS category,
                      COUNT(DISTINCT COALESCE(job.product_draft_id, job.id))::integer AS count
               FROM publish_jobs AS job
               LEFT JOIN product_drafts AS draft
                 ON draft.id = job.product_draft_id
                AND draft.tenant_id = job.tenant_id
                AND draft.store_id = job.store_id
               WHERE job.tenant_id = $1
                 AND job.store_id = ANY($2::uuid[])
                 AND job.submitted_at >= $3::timestamptz
                 AND job.submitted_at < $4::timestamptz
                 AND job.state IN ('submitted', 'result_unknown', 'completed')
               GROUP BY job.store_id, category
               ORDER BY job.store_id, category`,
        values,
      }),
      this.pool.query({
        /* today_work_price_summary */
        text: `/* today_work_price_summary */
               SELECT store_id, operation, COUNT(*)::integer AS count
               FROM api_audit_logs
               WHERE tenant_id = $1
                 AND store_id = ANY($2::uuid[])
                 AND created_at >= $3::timestamptz
                 AND created_at < $4::timestamptz
                 AND operation IN ('web.price.accept', 'web.price.reject')
               GROUP BY store_id, operation`,
        values,
      }),
      this.pool.query({
        /* today_work_rejection_summary */
        text: `/* today_work_rejection_summary */
               SELECT store_id,
                      COALESCE(NULLIF(skc_name, ''), '未标注商品') AS title,
                      COALESCE(NULLIF(skc_name, ''), '未标注类目') AS category,
                      COUNT(*)::integer AS count
               FROM product_review_states
               WHERE tenant_id = $1
                 AND store_id = ANY($2::uuid[])
                 AND occurred_at >= $3::timestamptz
                 AND occurred_at < $4::timestamptz
                 AND audit_state_label = 'failed'
                 AND archived_at IS NULL
               GROUP BY store_id, title, category`,
        values,
      }),
      this.pool.query({
        /* today_work_sample_summary */
        text: `/* today_work_sample_summary */
               SELECT store_id, COUNT(DISTINCT id)::integer AS count
               FROM webhook_events
               WHERE tenant_id = $1
                 AND store_id = ANY($2::uuid[])
                 AND received_at >= $3::timestamptz
                 AND received_at < $4::timestamptz
                 AND source = 'production'
                 AND (
                   event_type ILIKE '%sample%' OR event_type ILIKE '%寄样%' OR
                   COALESCE(payload::text, '') ILIKE '%寄样%' OR
                   COALESCE(payload::text, '') ILIKE '%sample%'
                 )
               GROUP BY store_id`,
        values,
      }),
      this.pool.query({
        /* today_work_activity_feed */
        text: `/* today_work_activity_feed */
               WITH publish_events AS (
                 SELECT job.store_id, '发布提交' AS event_type,
                        COALESCE(
                          NULLIF(job.request_summary->>'spuName', ''),
                          NULLIF(job.receipt->>'spuName', ''),
                          job.shein_version,
                          '商品'
                        ) AS title,
                        job.submitted_at AS occurred_at
                 FROM publish_jobs AS job
                 WHERE job.tenant_id = $1
                   AND job.store_id = ANY($2::uuid[])
                   AND job.submitted_at >= $3::timestamptz
                   AND job.submitted_at < $4::timestamptz
                   AND job.state IN ('submitted', 'result_unknown', 'completed')
               ), review_events AS (
                 SELECT store_id,
                        CASE WHEN audit_state_label = 'failed' THEN '商品驳回' ELSE '审核状态更新' END AS event_type,
                        COALESCE(NULLIF(skc_name, ''), review_key) AS title,
                        COALESCE(occurred_at, updated_at) AS occurred_at
                 FROM product_review_states
                 WHERE tenant_id = $1 AND store_id = ANY($2::uuid[])
                   AND COALESCE(occurred_at, updated_at) >= $3::timestamptz
                   AND COALESCE(occurred_at, updated_at) < $4::timestamptz
                   AND audit_state_label IN ('failed', 'passed')
               ), price_events AS (
                 SELECT store_id,
                        CASE WHEN operation = 'web.price.accept' THEN '核价通过' ELSE '核价拒绝' END AS event_type,
                        COALESCE(metadata->>'skcName', metadata->>'discussSn', '核价单') AS title,
                        created_at AS occurred_at
                 FROM api_audit_logs
                 WHERE tenant_id = $1 AND store_id = ANY($2::uuid[])
                   AND created_at >= $3::timestamptz AND created_at < $4::timestamptz
                   AND operation IN ('web.price.accept', 'web.price.reject')
               ), webhook_events_feed AS (
                 SELECT store_id,
                        CASE event_type
                          WHEN 'product_document_receive_status_notice' THEN '平台接收'
                          WHEN 'product_document_audit_status_notice' THEN '平台审核状态'
                          WHEN 'product_document_audit_status_notice_all_channels' THEN '平台审核状态'
                          WHEN 'product_quota_change_notice' THEN '发品额度变更'
                          WHEN 'product_compliance_change_notice' THEN '合规状态变更'
                          WHEN 'authorization_change_notice' THEN '店铺授权变更'
                          WHEN 'out_of_stock_notice' THEN '库存预警'
                          ELSE '平台动态'
                        END AS event_type,
                        'SHEIN 平台回读' AS title,
                        received_at AS occurred_at
                 FROM webhook_events
                 WHERE tenant_id = $1 AND store_id = ANY($2::uuid[])
                   AND received_at >= $3::timestamptz AND received_at < $4::timestamptz
                   AND source = 'production'
                   AND event_type IN (
                     'product_document_receive_status_notice',
                     'product_document_audit_status_notice',
                     'product_document_audit_status_notice_all_channels',
                     'product_quota_change_notice',
                     'product_compliance_change_notice',
                     'authorization_change_notice',
                     'out_of_stock_notice'
                   )
               )
               SELECT * FROM publish_events
               UNION ALL SELECT * FROM review_events
               UNION ALL SELECT * FROM price_events
               UNION ALL SELECT * FROM webhook_events_feed
               ORDER BY occurred_at DESC NULLS LAST
               LIMIT 50`,
        values,
      }),
    ]);

    const byStore = new Map(scopedStores.map((store) => [String(store.id), emptyStore(store)]));
    const categoriesByStore = new Map();
    for (const row of published.rows || []) {
      const store = byStore.get(String(row.store_id));
      if (!store) continue;
      const category = categoryName(row);
      const list = categoriesByStore.get(store.storeId) || [];
      const existing = list.find((item) => item.name === category);
      if (existing) existing.published += number(row.count);
      else list.push({ name: category, published: number(row.count), rejected: 0 });
      store.published += number(row.count);
      categoriesByStore.set(store.storeId, list);
    }
    for (const row of price.rows || []) {
      const store = byStore.get(String(row.store_id));
      if (!store) continue;
      if (row.operation === "web.price.accept") store.priceAccepted += number(row.count);
    }
    for (const row of rejected.rows || []) {
      const store = byStore.get(String(row.store_id));
      if (!store) continue;
      store.rejected += number(row.count);
      const category = categoryName(row);
      const list = categoriesByStore.get(store.storeId) || [];
      const existing = list.find((item) => item.name === category);
      if (existing) existing.rejected += number(row.count);
      else list.push({ name: category, published: 0, rejected: number(row.count) });
      categoriesByStore.set(store.storeId, list);
    }
    for (const row of sampled.rows || []) {
      const store = byStore.get(String(row.store_id));
      if (store) store.sampled += number(row.count);
    }
    const storeResults = Array.from(byStore.values()).map((store) => ({
      ...store,
      categories: (categoriesByStore.get(store.storeId) || []).sort((a, b) => b.published + b.rejected - (a.published + a.rejected)),
    }));
    const totals = storeResults.reduce((result, store) => ({
      published: result.published + store.published,
      priceAccepted: result.priceAccepted + store.priceAccepted,
      rejected: result.rejected + store.rejected,
      sampled: result.sampled + store.sampled,
    }), { published: 0, priceAccepted: 0, rejected: 0, sampled: 0 });
    const labels = new Map(scopedStores.map((store) => [String(store.id), text(store.label, "未命名店铺")]));
    return {
      date: range.date,
      timezone: "Asia/Shanghai",
      refreshedAt: this.now().toISOString(),
      scope: selectedStoreId ? "store" : ["owner", "admin"].includes(context?.role) ? "all" : "assigned",
      stores: storeResults,
      totals,
      activity: (activity.rows || []).map((row) => ({
        storeId: String(row.store_id),
        storeName: labels.get(String(row.store_id)) || "未命名店铺",
        type: text(row.event_type, "动态"),
        title: text(row.title, "未命名商品"),
        occurredAt: row.occurred_at ? new Date(row.occurred_at).toISOString() : null,
      })),
    };
  }
}
