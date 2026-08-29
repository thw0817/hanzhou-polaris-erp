const MAX_STRING_LENGTH = 240;
const MAX_METADATA_BYTES = 4_000;
const MAX_QUEUE_SIZE = 100;
const MAX_BATCH_SIZE = 20;
const DIAGNOSTIC_INGEST_PATH = "/v1/web/diagnostics/events";
const SAFE_KINDS = new Set(["ui.click", "ui.change", "ui.submit", "ui.route", "api.request", "api.error", "client.error"]);
const SENSITIVE_KEY = /(?:authorization|cookie|password|passwd|secret|token|api[_-]?key|access[_-]?key|credential|signature|signed[_-]?url|request[_-]?body|response[_-]?body|raw[_-]?payload|payload|headers?|body|bytes?|file|image|content|input|value)/i;
const SECRET_VALUE = /(?:bearer\s+|(?:secret|token|password|signature|access[_-]?key)\s*[:=]\s*)[^\s,;&]+/gi;
const QUERY_SECRET = /([?&](?:token|sig|signature|x-amz-[^=&]+|authorization|password|secret)=[^&\s]*)/gi;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi;

function boundedText(value, maxLength = MAX_STRING_LENGTH) {
  if (value === undefined || value === null) return null;
  const text = String(value).replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return text ? text.slice(0, maxLength) : null;
}

export function safeDiagnosticMessage(value) {
  const text = boundedText(value);
  if (!text) return null;
  return text
    .replace(/https?:\/\/[^\s]+/gi, "[url]")
    .replace(QUERY_SECRET, "$1=[redacted]")
    .replace(SECRET_VALUE, "[redacted]")
    .replace(/[A-Za-z0-9_-]{32,}/g, "[redacted]")
    .slice(0, MAX_STRING_LENGTH);
}

function safeMetadata(value, depth = 0) {
  if (depth > 3) return "[truncated]";
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return safeDiagnosticMessage(value);
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => safeMetadata(item, depth + 1));
  if (!value || typeof value !== "object") return null;
  const output = {};
  for (const [key, child] of Object.entries(value).slice(0, 40)) {
    if (SENSITIVE_KEY.test(key)) continue;
    const safeChild = safeMetadata(child, depth + 1);
    if (safeChild !== null && safeChild !== undefined) output[key.slice(0, 80)] = safeChild;
  }
  try {
    if (new TextEncoder().encode(JSON.stringify(output)).length > MAX_METADATA_BYTES) return { summary: "metadata_truncated" };
  } catch {
    return { summary: "metadata_unserializable" };
  }
  return output;
}

function classifyDestination(url) {
  const hostname = String(url.hostname || "").toLowerCase();
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
  if (url.origin !== base.origin) return { path: "external", destination: classifyDestination(url) };
  return {
    path: (url.pathname || "/")
      .replace(UUID, ":id")
      .replace(/\/\d{6,}(?=\/|$)/g, "/:id")
      .replace(/\/[^/]{81,}/g, "/:segment"),
    destination: "self",
  };
}

function randomId() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch {
    // Fall through to a non-secret correlation identifier.
  }
  return `client-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizeDiagnosticEvent(input = {}, { now = () => new Date().toISOString() } = {}) {
  const kind = SAFE_KINDS.has(input.kind) ? input.kind : "client.error";
  const pathInfo = normalizeDiagnosticPath(input.path || input.route || "", globalThis.location?.href || "http://127.0.0.1");
  const status = Number(input.statusCode);
  const duration = Number(input.durationMs);
  return {
    eventId: boundedText(input.eventId, 120) || randomId(),
    kind,
    operation: `diagnostic.${kind}`,
    module: boundedText(input.module, 80),
    action: safeDiagnosticMessage(input.action),
    method: boundedText(input.method, 12)?.toUpperCase() || null,
    path: pathInfo.path,
    statusCode: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
    traceId: boundedText(input.traceId, 160),
    durationMs: Number.isSafeInteger(duration) && duration >= 0 ? Math.min(duration, 86_400_000) : null,
    metadata: {
      ...(safeMetadata(input.metadata || {}) || {}),
      ...(pathInfo.destination !== "self" ? { destination: pathInfo.destination } : {}),
    },
    occurredAt: boundedText(typeof now === "function" ? now() : now, 64) || new Date().toISOString(),
  };
}

let installed = false;
let originalFetch = null;
let queue = [];
let flushTimer = null;
let flushing = false;

function targetElement(eventTarget) {
  const node = eventTarget?.nodeType === 3 ? eventTarget.parentElement : eventTarget;
  if (!node || typeof node.closest !== "function") return null;
  return node.closest("button,a,[role='button'],input[type='submit'],input[type='button'],summary,[data-diagnostic-action]");
}

function controlDescriptor(element) {
  if (!element) return null;
  const action = element.getAttribute("data-diagnostic-action") || element.getAttribute("aria-label") || element.getAttribute("title");
  const tag = String(element.tagName || "element").toLowerCase();
  const role = element.getAttribute("role") || tag;
  if (action) return { target: `${tag}:${role}`, label: safeDiagnosticMessage(action) };
  if (tag === "input") return { target: `${tag}:${element.getAttribute("type") || "control"}` };
  const text = safeDiagnosticMessage(element.textContent || "");
  return { target: `${tag}:${role}`, ...(text ? { label: text } : {}) };
}

function changedFieldDescriptor(eventTarget) {
  const element = eventTarget?.nodeType === 3 ? eventTarget.parentElement : eventTarget;
  if (!element || typeof element.matches !== "function" || !element.matches("input,select,textarea")) return null;
  const tag = String(element.tagName || "field").toLowerCase();
  const type = tag === "input" ? element.getAttribute("type") || "text" : tag;
  const name = safeDiagnosticMessage(element.getAttribute("name") || element.id || "");
  return { target: `field:${tag}:${type}`, ...(name ? { name } : {}) };
}

function moduleFromPath(pathname) {
  const match = String(pathname || "").match(/^\/app\/(?:operations\/[^/]+\/)?([^/?]+)/);
  return match?.[1] || "shell";
}

function enqueue(input) {
  if (!installed) return;
  const event = normalizeDiagnosticEvent(input);
  queue.push(event);
  if (queue.length > MAX_QUEUE_SIZE) queue.splice(0, queue.length - MAX_QUEUE_SIZE);
  if (queue.length >= MAX_BATCH_SIZE) void flush();
  else if (!flushTimer) flushTimer = window.setTimeout(() => { flushTimer = null; void flush(); }, 1_000);
}

async function flush() {
  if (!installed || flushing || !queue.length || !originalFetch) return;
  flushing = true;
  const batch = queue.splice(0, MAX_BATCH_SIZE);
  try {
    await originalFetch(DIAGNOSTIC_INGEST_PATH, {
      method: "POST",
      credentials: "include",
      keepalive: true,
      headers: { "Content-Type": "application/json;charset=UTF-8" },
      body: JSON.stringify({ events: batch }),
    });
  } catch {
    // Diagnostics must never break business requests. Failed batches are dropped
    // at the bounded queue boundary rather than persisted in browser storage.
  } finally {
    flushing = false;
    if (queue.length && !flushTimer) flushTimer = window.setTimeout(() => { flushTimer = null; void flush(); }, 1_000);
  }
}

export function recordDiagnosticEvent(input) {
  enqueue(input);
}

export function installBrowserDiagnostics() {
  if (typeof window === "undefined" || installed || typeof window.fetch !== "function") return () => {};
  installed = true;
  originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
    const requestUrl = input instanceof Request ? input.url : String(input || "");
    const method = init.method || (input instanceof Request ? input.method : "GET");
    const pathInfo = normalizeDiagnosticPath(requestUrl, window.location.href);
    if (pathInfo.path === DIAGNOSTIC_INGEST_PATH) return originalFetch(input, init);
    try {
      const response = await originalFetch(input, init);
      const endedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
      enqueue({
        kind: "api.request",
        method,
        path: requestUrl,
        statusCode: response.status,
        durationMs: Math.max(0, Math.round(endedAt - startedAt)),
        traceId: response.headers.get("x-trace-id"),
        module: moduleFromPath(window.location.pathname),
        metadata: { destination: pathInfo.destination, ok: response.ok },
      });
      return response;
    } catch (error) {
      const endedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
      enqueue({
        kind: "api.request",
        method,
        path: requestUrl,
        durationMs: Math.max(0, Math.round(endedAt - startedAt)),
        module: moduleFromPath(window.location.pathname),
        metadata: { destination: pathInfo.destination, errorName: error?.name || "FetchError", errorMessage: safeDiagnosticMessage(error?.message) },
      });
      throw error;
    }
  };
  const onClick = (event) => {
    const element = targetElement(event.target);
    const descriptor = controlDescriptor(element);
    if (!descriptor) return;
    enqueue({ kind: "ui.click", module: moduleFromPath(window.location.pathname), action: descriptor.label, metadata: descriptor });
  };
  const onChange = (event) => {
    const descriptor = changedFieldDescriptor(event.target);
    if (!descriptor) return;
    enqueue({ kind: "ui.change", module: moduleFromPath(window.location.pathname), metadata: descriptor });
  };
  const onSubmit = (event) => {
    const form = event.target;
    if (!form || typeof form.getAttribute !== "function") return;
    enqueue({
      kind: "ui.submit",
      module: moduleFromPath(window.location.pathname),
      action: form.getAttribute("data-diagnostic-action") || form.getAttribute("aria-label") || "form.submit",
      metadata: { target: "form", method: form.getAttribute("method") || "GET" },
    });
  };
  const onError = (event) => enqueue({
    kind: "client.error",
    module: moduleFromPath(window.location.pathname),
    metadata: { errorName: "window.error", errorMessage: safeDiagnosticMessage(event.message) },
  });
  const onRejection = (event) => enqueue({
    kind: "client.error",
    module: moduleFromPath(window.location.pathname),
    metadata: { errorName: "unhandledrejection", errorMessage: safeDiagnosticMessage(event.reason?.message || event.reason) },
  });
  window.addEventListener("click", onClick, true);
  window.addEventListener("change", onChange, true);
  window.addEventListener("submit", onSubmit, true);
  window.addEventListener("error", onError, true);
  window.addEventListener("unhandledrejection", onRejection, true);
  return () => {
    installed = false;
    window.fetch = originalFetch;
    window.removeEventListener("click", onClick, true);
    window.removeEventListener("change", onChange, true);
    window.removeEventListener("submit", onSubmit, true);
    window.removeEventListener("error", onError, true);
    window.removeEventListener("unhandledrejection", onRejection, true);
    if (flushTimer) window.clearTimeout(flushTimer);
    flushTimer = null;
    queue = [];
    originalFetch = null;
  };
}

export { DIAGNOSTIC_INGEST_PATH };
