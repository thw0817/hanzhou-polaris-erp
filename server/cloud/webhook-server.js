import http from "node:http";
import { pathToFileURL } from "node:url";
import { loadConfig } from "../config.js";
import {
  createTrustedProxyVerifier,
  createWebhookIngress,
} from "../webhook-ingress.js";
import { BullMqJobQueue } from "./job-queue.js";
import { createPostgresPool } from "./postgres.js";
import { PostgresWebhookEventStore } from "./webhook-event-store.js";
import { RedisWebhookReplayStore } from "./webhook-replay-store.js";
import { PostgresWebhookStoreResolver } from "./webhook-store-resolver.js";
import {
  createSheinWebhookAdapter,
  SheinWebhookError,
} from "../shein-webhook.js";

const MAX_WEBHOOK_BYTES = 1024 * 1024;
const OFFICIAL_WEBHOOK_PATHS = new Map([
  ["/webhooks/shein", "production"],
  ["/webhooks/shein/test", "test"],
]);

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json;charset=UTF-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function safeLogErrorMessage(error) {
  return String(error?.message || error || "unknown error")
    .replace(
      /([a-z][a-z0-9+.-]*:\/\/)([^@\s]+)@/gi,
      "$1***@",
    )
    .replace(
      /\b(password|secret|token|api[_-]?key)=([^\s&]+)/gi,
      "$1=***",
    )
    .slice(0, 500);
}

function writeWebhookLog(logger, level, event, fields) {
  const write = logger?.[level];
  if (typeof write !== "function") return;
  write.call(
    logger,
    `[shein-webhook] ${event} ${JSON.stringify(fields)}`,
  );
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_WEBHOOK_BYTES) {
      const error = new Error("Webhook 请求体超过 1MB");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(request) {
  try {
    return JSON.parse((await readBody(request)).toString("utf8") || "{}");
  } catch (cause) {
    if (cause?.status === 413) throw cause;
    const error = new Error("Webhook 请求体不是有效 JSON");
    error.status = 400;
    throw error;
  }
}

function parseMultipartField(body, boundary, fieldName) {
  const delimiter = `--${boundary}`;
  const parts = body.toString("utf8").split(delimiter);
  for (const part of parts) {
    const normalized = part.replace(/^\r\n/, "");
    if (!normalized || normalized === "--\r\n" || normalized === "--") {
      continue;
    }
    const separatorIndex = normalized.indexOf("\r\n\r\n");
    if (separatorIndex < 0) continue;
    const headerBlock = normalized.slice(0, separatorIndex);
    const disposition = headerBlock
      .split("\r\n")
      .find((line) => /^content-disposition:/i.test(line));
    const nameMatch = disposition?.match(
      /(?:^|;)\s*name="([^"]+)"/i,
    );
    if (nameMatch?.[1] !== fieldName) continue;
    return normalized
      .slice(separatorIndex + 4)
      .replace(/\r\n--$/, "")
      .replace(/\r\n$/, "");
  }
  return null;
}

async function readOfficialEventData(request) {
  const body = await readBody(request);
  const contentType = String(request.headers["content-type"] || "");
  const multipartMatch = contentType.match(
    /^multipart\/form-data(?:\s*;\s*boundary=(?:"([^"]+)"|([^;]+)))?/i,
  );
  let eventData = null;
  if (multipartMatch) {
    const boundary = (multipartMatch[1] || multipartMatch[2] || "").trim();
    if (!boundary) {
      throw new SheinWebhookError(
        "INVALID_MULTIPART",
        "Webhook multipart 缺少 boundary",
        400,
      );
    }
    eventData = parseMultipartField(body, boundary, "eventData");
  } else if (
    contentType.toLowerCase().startsWith("application/x-www-form-urlencoded")
  ) {
    eventData = new URLSearchParams(body.toString("utf8")).get("eventData");
  } else if (contentType.toLowerCase().startsWith("application/json")) {
    try {
      eventData = JSON.parse(body.toString("utf8") || "{}").eventData;
    } catch {
      throw new SheinWebhookError(
        "INVALID_JSON",
        "Webhook 请求体不是有效 JSON",
        400,
      );
    }
  } else {
    throw new SheinWebhookError(
      "UNSUPPORTED_CONTENT_TYPE",
      "Webhook Content-Type 不受支持",
      415,
    );
  }
  if (typeof eventData !== "string" || !eventData.trim()) {
    throw new SheinWebhookError(
      "EVENT_DATA_REQUIRED",
      "Webhook 请求缺少 eventData",
      400,
    );
  }
  return eventData.trim();
}

export function createWebhookRequestHandler({
  config,
  ingress,
  officialAdapter = null,
  logger = console,
}) {
  return async (request, response) => {
    const url = new URL(
      request.url,
      `http://${request.headers.host || "127.0.0.1"}`,
    );
    if (request.method === "GET" && url.pathname === "/health") {
      return sendJson(response, 200, {
        ok: true,
        service: "shein-webhook-ingress",
        verificationMode: config.webhookVerificationMode,
      });
    }
    const source = OFFICIAL_WEBHOOK_PATHS.get(url.pathname);
    if (request.method === "POST" && source && officialAdapter) {
      const startedAt = Date.now();
      const logContext = {
        path: url.pathname,
        source,
        eventType: String(
          request.headers["x-lt-eventcode"] || "",
        ).slice(0, 128),
        contentType: String(
          request.headers["content-type"] || "",
        )
          .split(";", 1)[0]
          .slice(0, 128),
      };
      writeWebhookLog(logger, "info", "received", logContext);
      let adapted = null;
      try {
        adapted = await officialAdapter({
          path: url.pathname,
          headers: request.headers,
          eventData: await readOfficialEventData(request),
          source,
        });
        if (adapted.duplicateRequest) {
          writeWebhookLog(logger, "info", "accepted", {
            ...logContext,
            status: 200,
            duplicate: true,
            durationMs: Date.now() - startedAt,
          });
          return sendJson(response, 200, {
            code: "0",
            msg: "OK",
            duplicate: true,
            eventId: null,
          });
        }
        const result = await ingress({
          eventType: adapted.eventType,
          payload: adapted.payload,
          headers: request.headers,
          tenantId: adapted.tenantId,
          storeId: adapted.storeId,
          source: adapted.source,
        });
        writeWebhookLog(logger, "info", "accepted", {
          ...logContext,
          status: 200,
          duplicate: result.duplicate,
          durationMs: Date.now() - startedAt,
        });
        return sendJson(response, 200, {
          code: "0",
          msg: "OK",
          duplicate: result.duplicate,
          eventId: result.eventId,
        });
      } catch (error) {
        if (adapted?.replayKey) {
          await officialAdapter
            .releaseReplay(adapted.replayKey)
            .catch(() => {});
        }
        const status = Number(error.status || 500);
        const code = error.code || "WEBHOOK_REJECTED";
        writeWebhookLog(logger, "warn", "rejected", {
          ...logContext,
          status,
          code,
          errorName: String(error.name || "Error").slice(0, 128),
          errorMessage: safeLogErrorMessage(error),
          durationMs: Date.now() - startedAt,
        });
        return sendJson(response, status, {
          code,
          msg:
            status >= 500
              ? "Webhook 服务暂时不可用"
              : error.message || "Webhook 接收失败",
        });
      }
    }
    const match = url.pathname.match(
      /^\/internal\/webhooks\/shein\/([^/]+)$/,
    );
    if (
      request.method === "POST" &&
      match &&
      config.webhookVerificationMode === "trusted-proxy"
    ) {
      try {
        const result = await ingress({
          eventType: decodeURIComponent(match[1]),
          payload: await readJson(request),
          headers: request.headers,
        });
        return sendJson(response, 200, {
          code: "0",
          msg: "OK",
          duplicate: result.duplicate,
          eventId: result.eventId,
        });
      } catch (error) {
        return sendJson(response, Number(error.status || 500), {
          code: "WEBHOOK_REJECTED",
          msg: error.message || "Webhook 接收失败",
        });
      }
    }
    return sendJson(response, 404, {
      code: "NOT_FOUND",
      msg: "接口不存在",
    });
  };
}

export function createWebhookHttpServer({
  config,
  ingress,
  officialAdapter = null,
  logger = console,
}) {
  return http.createServer(
    createWebhookRequestHandler({
      config,
      ingress,
      officialAdapter,
      logger,
    }),
  );
}

export async function startWebhookServer(config = loadConfig()) {
  if (config.runtimeMode !== "cloud") {
    throw new Error("Webhook 云端服务要求 SHEIN_RUNTIME_MODE=cloud");
  }
  if (
    !config.webhookIngressEnabled ||
    !["shein-direct", "trusted-proxy"].includes(
      config.webhookVerificationMode,
    )
  ) {
    throw new Error(
      "Webhook 入口未启用或验签模式无效",
    );
  }
  if (
    config.webhookVerificationMode === "trusted-proxy" &&
    !config.internalWebhookSecret
  ) {
    throw new Error("trusted-proxy 模式缺少 SHEIN_INTERNAL_WEBHOOK_SECRET");
  }
  if (
    config.webhookVerificationMode === "shein-direct" &&
    (!config.appId || !config.appSecret)
  ) {
    throw new Error("shein-direct 模式缺少 SHEIN_APP_ID 或 SHEIN_APP_SECRET");
  }
  const pool = createPostgresPool({
    connectionString: config.databaseUrl,
  });
  const queue = new BullMqJobQueue({ redisUrl: config.redisUrl });
  let replayStore = null;
  let officialAdapter = null;
  if (config.webhookVerificationMode === "shein-direct") {
    replayStore = new RedisWebhookReplayStore({
      redisUrl: config.redisUrl,
    });
    officialAdapter = createSheinWebhookAdapter({
      appId: config.appId,
      appSecret: config.appSecret,
      replayStore,
      storeResolver: new PostgresWebhookStoreResolver({ pool }),
      maxClockSkewMs: config.webhookMaxClockSkewMs,
    });
  }
  const ingress = createWebhookIngress({
    appId: config.appId,
    eventStore: new PostgresWebhookEventStore({ pool }),
    queue,
    verifyRequest:
      config.webhookVerificationMode === "trusted-proxy"
        ? createTrustedProxyVerifier(config.internalWebhookSecret)
        : () => true,
    allowUnknownEventTypes:
      config.webhookVerificationMode === "shein-direct",
  });
  const server = createWebhookHttpServer({
    config,
    ingress,
    officialAdapter,
  });
  server.on("close", async () => {
    await Promise.allSettled([
      queue.close(),
      replayStore?.close(),
      pool.end(),
    ]);
  });
  server.listen(config.webhookPort, config.webhookHost, () => {
    console.log(
      `[shein-webhook] http://${config.webhookHost}:${config.webhookPort} · ${config.webhookVerificationMode}`,
    );
  });
  return server;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  startWebhookServer().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
