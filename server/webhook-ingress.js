import crypto from "node:crypto";

export const SHEIN_WEBHOOK_EVENT_TYPES = new Set([
  "product_document_receive_status_notice",
  "product_document_audit_status_notice",
  "product_price_audit_status_notice",
  "product_prices_abnormal_notice",
  "product_rrp_review_status_changed",
  "product_rrp_validity_changed",
  "product_shelves_notice",
  "product_quota_change_notice",
  "product_delete_audit",
  "order_push_notice",
  "logistics_order_result_notice",
  "return_order_push_notice",
  "purchase_order_notice",
  "delivery_modify_notice",
  "logistics_forecast_result_notice",
  "purchase_order_return_application_notice",
  "purchase_order_return_notice",
  "out_of_stock_notice",
  "inventory_warning_notice",
  "product_compliance_change_notice",
  "authorization_change_notice",
  "product_document_audit_status_notice_all_channels",
  "invoice_status_notice",
]);

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

function parseJsonString(value) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed || !["{", "["].includes(trimmed[0])) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

export function normalizeSheinWebhookPayload(input) {
  const parsed = parseJsonString(input);
  if (Array.isArray(parsed)) return parsed.map(normalizeSheinWebhookPayload);
  if (!parsed || typeof parsed !== "object") return parsed;
  return Object.fromEntries(
    Object.entries(parsed).map(([key, value]) => [
      key,
      key === "data"
        ? normalizeSheinWebhookPayload(parseJsonString(value))
        : value,
    ]),
  );
}

export function createWebhookDedupeKey(eventType, payload) {
  return crypto
    .createHash("sha256")
    .update(eventType)
    .update("\n")
    .update(JSON.stringify(canonicalize(payload)))
    .digest("hex");
}

export function selectSafeWebhookHeaders(headers = {}) {
  const allowed = new Set([
    "content-type",
    "user-agent",
    "x-request-id",
    "traceparent",
    "x-lt-eventcode",
    "x-lt-appid",
    "x-lt-timestamp",
    "x-shein-webhook-environment",
  ]);
  return Object.fromEntries(
    Object.entries(headers)
      .map(([key, value]) => [key.toLowerCase(), value])
      .filter(([key]) => allowed.has(key)),
  );
}

export function createTrustedProxyVerifier(secret) {
  if (!secret) return () => false;
  const expected = Buffer.from(secret);
  return ({ headers = {} }) => {
    const suppliedValue =
      headers["x-internal-webhook-secret"] ||
      headers["X-Internal-Webhook-Secret"] ||
      "";
    const supplied = Buffer.from(String(suppliedValue));
    return (
      supplied.length === expected.length &&
      crypto.timingSafeEqual(supplied, expected)
    );
  };
}

export function createWebhookIngress({
  appId,
  eventStore,
  queue,
  verifyRequest,
  allowUnknownEventTypes = false,
} = {}) {
  if (!appId) throw new Error("Webhook ingress 缺少 SHEIN_APP_ID");
  if (!eventStore) throw new Error("Webhook ingress 缺少 eventStore");
  if (!queue) throw new Error("Webhook ingress 缺少 queue");
  if (!verifyRequest) throw new Error("Webhook ingress 缺少验签适配器");

  return async function ingest({
    eventType,
    payload,
    headers = {},
    tenantId = null,
    storeId = null,
    source = "internal",
  }) {
    if (
      !allowUnknownEventTypes &&
      !SHEIN_WEBHOOK_EVENT_TYPES.has(eventType)
    ) {
      const error = new Error("不支持的 SHEIN Webhook 事件");
      error.status = 404;
      throw error;
    }
    const verified = await verifyRequest({ eventType, payload, headers });
    if (!verified) {
      const error = new Error("Webhook 请求验证失败");
      error.status = 401;
      throw error;
    }

    const normalizedPayload = normalizeSheinWebhookPayload(payload);
    // The same platform payload can legitimately be delivered for two stores
    // (or two tenants). Keep replay/idempotency inside the authenticated
    // store scope instead of allowing the global webhook unique key to drop
    // the second store's event.
    const scope = `${tenantId || "unscoped"}:${storeId || "unscoped"}`;
    const dedupeKey = createWebhookDedupeKey(
      `${source}:${eventType}:${scope}`,
      normalizedPayload,
    );
    const result = await eventStore.insert({
      tenantId,
      storeId,
      appId,
      eventType,
      dedupeKey,
      source,
      rawPayload: payload,
      payload: normalizedPayload,
      safeHeaders: selectSafeWebhookHeaders({
        ...headers,
        "x-shein-webhook-environment": source,
      }),
    });
    if (!result.inserted && result.event.state !== "received") {
      return { accepted: true, duplicate: true, eventId: result.event.id };
    }

    try {
      const job = await queue.add(
        "process-shein-webhook",
        {
          eventId: result.event.id,
          eventType,
          tenantId,
          storeId,
          source,
        },
        { jobId: result.event.id },
      );
      await eventStore.markQueued(result.event.id, job.id);
      return {
        accepted: true,
        duplicate: !result.inserted,
        eventId: result.event.id,
        jobId: job.id,
      };
    } catch (error) {
      await eventStore.markQueueFailed(result.event.id, error);
      throw error;
    }
  };
}
