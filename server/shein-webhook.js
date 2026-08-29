import crypto from "node:crypto";
import {
  decryptSheinAesPayload,
  generateSheinSignature,
} from "./shein-crypto.js";

const DEFAULT_MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const EVENT_CODE_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

function getHeader(headers, name) {
  const expected = name.toLowerCase();
  for (const [key, value] of Object.entries(headers || {})) {
    if (key.toLowerCase() === expected) {
      return Array.isArray(value) ? value[0] : value;
    }
  }
  return undefined;
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""), "utf8");
  const rightBuffer = Buffer.from(String(right || ""), "utf8");
  return (
    leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function parseJsonPayload(value) {
  try {
    return JSON.parse(value);
  } catch {
    throw new SheinWebhookError(
      "INVALID_EVENT_DATA",
      "Webhook eventData 解密后不是有效 JSON",
      400,
    );
  }
}

export class SheinWebhookError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "SheinWebhookError";
    this.code = code;
    this.status = status;
  }
}

export class MemoryWebhookReplayStore {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.entries = new Map();
  }

  async claim(key, ttlMs) {
    const currentTime = this.now();
    const expiresAt = this.entries.get(key);
    if (expiresAt && expiresAt > currentTime) return false;
    this.entries.set(key, currentTime + ttlMs);
    return true;
  }

  async release(key) {
    this.entries.delete(key);
  }

  async close() {}
}

export function normalizeSheinEventCode(value) {
  const normalized = String(value || "").trim().replace(/^\/+/, "");
  if (!EVENT_CODE_PATTERN.test(normalized)) {
    throw new SheinWebhookError(
      "INVALID_EVENT_CODE",
      "Webhook 事件编码无效",
      400,
    );
  }
  return normalized;
}

export function createSheinWebhookAdapter({
  appId,
  appSecret,
  replayStore,
  storeResolver = null,
  maxClockSkewMs = DEFAULT_MAX_CLOCK_SKEW_MS,
  now = () => Date.now(),
} = {}) {
  if (!appId || !appSecret) {
    throw new Error("SHEIN Webhook 适配器缺少 APP_ID 或 APP_SECRET");
  }
  if (!replayStore) {
    throw new Error("SHEIN Webhook 适配器缺少 replayStore");
  }
  if (!Number.isFinite(maxClockSkewMs) || maxClockSkewMs <= 0) {
    throw new Error("SHEIN Webhook 时间窗口配置无效");
  }

  const adapt = async ({
    path,
    headers = {},
    eventData,
    source = "production",
  }) => {
    const suppliedAppId = String(getHeader(headers, "x-lt-appid") || "");
    const timestamp = String(getHeader(headers, "x-lt-timestamp") || "");
    const signature = String(getHeader(headers, "x-lt-signature") || "");
    const openKeyId = String(
      getHeader(headers, "x-lt-openkeyid") || "",
    ).trim();
    const eventType = normalizeSheinEventCode(
      getHeader(headers, "x-lt-eventcode"),
    );

    if (!safeEqual(suppliedAppId, appId)) {
      throw new SheinWebhookError(
        "APP_ID_MISMATCH",
        "Webhook 应用标识不匹配",
        401,
      );
    }
    if (!/^\d{13}$/.test(timestamp)) {
      throw new SheinWebhookError(
        "INVALID_TIMESTAMP",
        "Webhook 时间戳无效",
        401,
      );
    }
    const timestampNumber = Number(timestamp);
    if (
      !Number.isSafeInteger(timestampNumber) ||
      Math.abs(now() - timestampNumber) > maxClockSkewMs
    ) {
      throw new SheinWebhookError(
        "STALE_TIMESTAMP",
        "Webhook 请求已过期",
        401,
      );
    }
    if (signature.length <= 5) {
      throw new SheinWebhookError(
        "INVALID_SIGNATURE",
        "Webhook 签名无效",
        401,
      );
    }

    let expectedSignature;
    try {
      expectedSignature = generateSheinSignature({
        openKeyId: appId,
        secretKey: appSecret,
        path,
        timestamp,
        randomKey: signature.slice(0, 5),
      });
    } catch {
      throw new SheinWebhookError(
        "INVALID_SIGNATURE",
        "Webhook 签名无效",
        401,
      );
    }
    if (!safeEqual(signature, expectedSignature)) {
      throw new SheinWebhookError(
        "INVALID_SIGNATURE",
        "Webhook 签名无效",
        401,
      );
    }

    const replayKey = crypto
      .createHash("sha256")
      .update(suppliedAppId)
      .update("\n")
      .update(timestamp)
      .update("\n")
      .update(path)
      .update("\n")
      .update(signature)
      .digest("hex");
    const claimed = await replayStore.claim(
      replayKey,
      maxClockSkewMs * 2,
    );
    if (!claimed) {
      return {
        duplicateRequest: true,
        eventType,
        source,
      };
    }

    try {
      let plaintext;
      try {
        plaintext = decryptSheinAesPayload(eventData, appSecret);
      } catch {
        throw new SheinWebhookError(
          "DECRYPTION_FAILED",
          "Webhook eventData 解密失败",
          400,
        );
      }
      const payload = parseJsonPayload(plaintext);
      const store =
        openKeyId && storeResolver
          ? await storeResolver.findByOpenKeyId(openKeyId)
          : null;
      return {
        duplicateRequest: false,
        replayKey,
        eventType,
        payload,
        tenantId: store?.tenantId || null,
        storeId: store?.storeId || null,
        source,
      };
    } catch (error) {
      await replayStore.release(replayKey);
      throw error;
    }
  };

  adapt.releaseReplay = (key) => replayStore.release(key);
  return adapt;
}
