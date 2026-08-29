const MAX_BATCH_SIZE = 50;
const MAX_LIST_LIMIT = 100;
const MAX_STRING_LENGTH = 240;
const MAX_METADATA_BYTES = 4_000;
const MAX_DEPTH = 3;

const SAFE_KINDS = new Set([
  "ui.click",
  "ui.change",
  "ui.submit",
  "ui.route",
  "api.request",
  "api.error",
  "client.error",
]);

const SENSITIVE_KEY = /(?:authorization|cookie|password|passwd|secret|token|api[_-]?key|access[_-]?key|credential|signature|signed[_-]?url|request[_-]?body|response[_-]?body|raw[_-]?payload|payload|headers?|body|bytes?|file|image|content|input|value)/i;
const SECRET_VALUE = /(?:bearer\s+|(?:secret|token|password|signature|access[_-]?key)\s*[:=]\s*)[^\s,;&]+/gi;
const QUERY_SECRET = /([?&](?:token|sig|signature|x-amz-[^=&]+|authorization|password|secret)=[^&\s]*)/gi;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi;

function boundedText(value, maxLength = MAX_STRING_LENGTH) {
  if (value === undefined || value === null) return null;
  const text = String(value).replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return text ? text.slice(0, maxLength) : null;
}

function safeString(value, maxLength = MAX_STRING_LENGTH) {
  const text = boundedText(value, maxLength);
  if (!text) return null;
  return text
    .replace(QUERY_SECRET, "$1=[redacted]")
    .replace(SECRET_VALUE, "[redacted]");
}

function safeInteger(value, { min = 0, max = 2_147_483_647 } = {}) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) return null;
  return Math.min(Math.max(number, min), max);
}

export function redactDiagnosticValue(value, depth = 0) {
  if (depth > MAX_DEPTH) return "[truncated]";
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  if (typeof value === "string") return safeString(value);
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => redactDiagnosticValue(item, depth + 1));
  }
  if (!value || typeof value !== "object") return null;
  const output = {};
  for (const [key, child] of Object.entries(value).slice(0, 40)) {
    if (SENSITIVE_KEY.test(key)) continue;
    const safeKey = boundedText(key, 80);
    if (!safeKey || SENSITIVE_KEY.test(safeKey)) continue;
    const safeChild = redactDiagnosticValue(child, depth + 1);
    if (safeChild !== null && safeChild !== undefined) output[safeKey] = safeChild;
  }
  try {
    if (Buffer.byteLength(JSON.stringify(output), "utf8") > MAX_METADATA_BYTES) {
      return { summary: "metadata_truncated" };
    }
  } catch {
    return { summary: "metadata_unserializable" };
  }
  return output;
}

function classifyDestination(url) {
  const hostname = String(url.hostname || "").toLowerCase();
  if (!hostname) return "self";
  if (hostname.includes("cos") || hostname.includes("myqcloud")) return "external:cos";
  if (hostname.includes("sheincorp") || hostname.includes("shein")) return "external:shein";
  return "external:other";
}

export function normalizeDiagnosticPath(value, baseUrl = "http://127.0.0.1") {
  const raw = String(value || "").trim();
  if (!raw) return { path: "", destination: "self" };
  let url;
  try {
    url = new URL(raw, baseUrl);
  } catch {
    return { path: "unknown", destination: "unknown" };
  }
  const base = new URL(baseUrl);
  if (url.origin !== base.origin) {
    return { path: "external", destination: classifyDestination(url) };
  }
  const path = url.pathname
    .replace(UUID, ":id")
    .replace(/\/\d{6,}(?=\/|$)/g, "/:id")
    .replace(/\/[^/]{81,}/g, "/:segment");
  return { path: path || "/", destination: "self" };
}

export function normalizeDiagnosticEvent(input = {}, { now = () => new Date().toISOString() } = {}) {
  const kind = SAFE_KINDS.has(input.kind) ? input.kind : "client.error";
  const pathInfo = normalizeDiagnosticPath(input.path || input.route || "");
  const metadata = redactDiagnosticValue(input.metadata || {});
  return {
    eventId: safeString(input.eventId, 120),
    operation: `diagnostic.${kind}`,
    method: safeString(input.method, 12)?.toUpperCase() || null,
    path: pathInfo.path,
    statusCode: safeInteger(input.statusCode, { min: 100, max: 599 }),
    traceId: safeString(input.traceId, 160),
    durationMs: safeInteger(input.durationMs, { min: 0, max: 86_400_000 }),
    metadata: {
      ...(metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {}),
      ...(pathInfo.destination !== "self" ? { destination: pathInfo.destination } : {}),
      ...(input.module ? { module: safeString(input.module, 80) } : {}),
      ...(input.action ? { action: safeString(input.action, 120) } : {}),
    },
    occurredAt: safeString(typeof now === "function" ? now() : now, 64) || new Date().toISOString(),
  };
}

export class DiagnosticEventError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "DiagnosticEventError";
    this.code = code;
    this.status = status;
  }
}

function normalizeLimit(value) {
  if (value === undefined || value === null || value === "") return 50;
  const limit = safeInteger(value, { min: 1, max: MAX_LIST_LIMIT });
  if (!limit) throw new DiagnosticEventError("INVALID_LIMIT", "诊断日志查询数量无效");
  return limit;
}

export class PostgresDiagnosticEventRepository {
  constructor({ pool } = {}) {
    if (!pool) throw new Error("PostgresDiagnosticEventRepository 缺少 pool");
    this.pool = pool;
  }

  async recordClientEvents({ context, events } = {}) {
    if (!Array.isArray(events) || events.length > MAX_BATCH_SIZE) {
      throw new DiagnosticEventError("BATCH_TOO_LARGE", `诊断事件批次不能超过${MAX_BATCH_SIZE}条`);
    }
    const normalized = events
      .map((event) => normalizeDiagnosticEvent(event))
      .filter((event) => event.operation);
    if (!normalized.length) return { recorded: 0 };
    const values = [];
    const rows = normalized.map((event, index) => {
      const base = index * 9;
      values.push(
        context?.tenantId || null,
        context?.userId || null,
        event.operation,
        event.method,
        event.path,
        event.statusCode,
        event.traceId,
        event.durationMs,
        JSON.stringify({ ...event.metadata, clientEventId: event.eventId, occurredAt: event.occurredAt }),
      );
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}::jsonb)`;
    });
    await this.pool.query({
      text: `INSERT INTO api_audit_logs (
        tenant_id, user_id, operation, method, path, status_code,
        trace_id, duration_ms, metadata
      ) VALUES ${rows.join(", ")}`,
      values,
    });
    return { recorded: normalized.length };
  }

  async recordServerRequest({ context, method, path, traceId, statusCode, durationMs, errorCode } = {}) {
    return this.recordClientEvents({
      context,
      events: [{
        kind: "api.request",
        method,
        path,
        traceId,
        statusCode,
        durationMs,
        metadata: {
          source: "server",
          ...(errorCode ? { errorCode } : {}),
        },
      }],
    });
  }

  async list({ tenantId, limit = 50 } = {}) {
    if (!tenantId) throw new DiagnosticEventError("TENANT_REQUIRED", "诊断日志查询缺少租户上下文", 401);
    const normalizedLimit = normalizeLimit(limit);
    const result = await this.pool.query({
      text: `SELECT id, user_id, operation, method, path, status_code,
                    trace_id, duration_ms, metadata, created_at
             FROM api_audit_logs
             WHERE tenant_id = $1
               AND operation LIKE 'diagnostic.%'
             ORDER BY created_at DESC, id DESC
             LIMIT $2`,
      values: [tenantId, normalizedLimit + 1],
    });
    const hasMore = result.rows.length > normalizedLimit;
    return {
      events: result.rows.slice(0, normalizedLimit).map((row) => ({
        id: String(row.id),
        userId: row.user_id || null,
        operation: row.operation,
        method: row.method || null,
        path: row.path || "",
        statusCode: row.status_code ?? null,
        traceId: row.trace_id || null,
        durationMs: row.duration_ms ?? null,
        metadata: redactDiagnosticValue(row.metadata || {}),
        createdAt: row.created_at,
      })),
      hasMore,
      limit: normalizedLimit,
    };
  }
}
