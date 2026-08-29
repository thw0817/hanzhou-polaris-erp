export class WebhookProcessingError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "WebhookProcessingError";
    this.code = code;
  }
}

function getEventField(event, camelCase, snakeCase) {
  return event?.[camelCase] ?? event?.[snakeCase] ?? null;
}

function writeLog(logger, level, event, fields) {
  const write = logger?.[level];
  if (typeof write !== "function") return;
  write.call(
    logger,
    `[shein-webhook-worker] ${event} ${JSON.stringify(fields)}`,
  );
}

export function createWebhookEventProcessor({
  logger = console,
  productionHandlers = {},
} = {}) {
  return async function processWebhookEvent(event) {
    const eventId = String(getEventField(event, "id", "id") || "");
    const eventType = String(
      getEventField(event, "eventType", "event_type") || "",
    );
    const source = String(
      getEventField(event, "source", "source") || "internal",
    );
    const payload = getEventField(event, "payload", "payload");

    if (!eventId || !eventType || !payload || typeof payload !== "object") {
      throw new WebhookProcessingError(
        "INVALID_STORED_EVENT",
        "Webhook 已存储事件缺少 id、eventType 或结构化 payload",
      );
    }

    if (source !== "test") {
      const handler = productionHandlers[eventType];
      if (typeof handler === "function") {
        const result = await handler(payload, event);
        writeLog(logger, "info", "projected-production-event", {
          eventId,
          eventType,
          source,
          projectionVersion: String(result?.projectionVersion || ""),
          disposition: String(
            result?.summary?.disposition || "read-only-projection",
          ),
          recordCount: Number(result?.summary?.recordCount || 0),
          failedRecordCount: Number(result?.summary?.failedRecordCount || 0),
          skuCount: Number(result?.summary?.skuCount || 0),
        });
        return result;
      }
      throw new WebhookProcessingError(
        "PRODUCTION_HANDLER_REQUIRED",
        `生产 Webhook 事件尚未配置业务投影器: ${eventType}`,
      );
    }

    writeLog(logger, "info", "validated-test-event", {
      eventId,
      eventType,
      source,
    });
    return {
      handled: true,
      disposition: "validated-test-event",
      eventId,
      eventType,
      source,
    };
  };
}
