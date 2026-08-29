import { generateSheinSignature } from "./shein-crypto.js";

export class SheinApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "SheinApiError";
    this.status = details.status ?? 502;
    this.code = details.code ?? null;
    this.traceId = details.traceId ?? null;
    this.response = details.response ?? null;
  }
}

export async function requestShein({
  baseUrl,
  method = "POST",
  path,
  body,
  openKeyId,
  secretKey,
  identityHeader = "x-lt-openKeyId",
  language = "zh-cn",
  timeoutMs = 15_000,
  fetchImpl = fetch,
  now = () => Date.now(),
  randomKey,
}) {
  if (!baseUrl || !path || !openKeyId || !secretKey) {
    throw new TypeError("baseUrl, path, openKeyId and secretKey are required");
  }

  const startedAt = now();
  const timestamp = startedAt.toString();
  const signature = generateSheinSignature({
    openKeyId,
    secretKey,
    path,
    timestamp,
    randomKey,
  });
  const headers = {
    "Content-Type": "application/json;charset=UTF-8",
    "x-lt-timestamp": timestamp,
    "x-lt-signature": signature,
    language,
    [identityHeader]: openKeyId,
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const raw = await response.text();
    let payload;

    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      throw new SheinApiError("SHEIN 返回了无法解析的响应", {
        status: response.status,
      });
    }

    const durationMs = Math.max(0, now() - startedAt);
    if (!response.ok || payload.code !== "0") {
      throw new SheinApiError(payload.msg || `SHEIN 请求失败 (${response.status})`, {
        status: response.status,
        code: payload.code,
        traceId: payload.traceId,
        response: payload,
      });
    }

    return {
      payload,
      diagnostics: {
        status: response.status,
        code: payload.code,
        traceId: payload.traceId ?? null,
        durationMs,
      },
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new SheinApiError("SHEIN 请求超时", { status: 504 });
    }
    if (error instanceof SheinApiError) throw error;
    throw new SheinApiError(`无法连接 SHEIN：${error.message}`, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
