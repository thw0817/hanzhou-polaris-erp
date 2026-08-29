import crypto from "node:crypto";
import { requestShein } from "../shein-client.js";
import { decryptStoreSecretKey } from "../shein-crypto.js";
import { hashOpaqueSecret } from "./device-auth.js";

const TOKEN_EXCHANGE_PATH = "/open-api/auth/get-by-token";
const DEFAULT_ATTEMPT_TTL_MS = 10 * 60 * 1000;

function cleanText(value, { name, maxLength }) {
  const cleaned = typeof value === "string" ? value.trim() : "";
  if (!cleaned) {
    throw new WebSheinAuthorizationError("INVALID_REQUEST", `${name}不能为空`, 400);
  }
  if (cleaned.length > maxLength) {
    throw new WebSheinAuthorizationError(
      "INVALID_REQUEST",
      `${name}不能超过${maxLength}个字符`,
      400,
    );
  }
  return cleaned;
}

function buildAuthorizationUrl({ authorizationHost, appId, redirectUrl, state }) {
  const params = new URLSearchParams({
    appid: appId,
    redirectUrl: Buffer.from(redirectUrl, "utf8").toString("base64"),
    state,
  });
  return `https://${authorizationHost}/#/empower?${params.toString()}`;
}

export class WebSheinAuthorizationError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "WebSheinAuthorizationError";
    this.code = code;
    this.status = status;
  }
}

export class WebSheinAuthorizationService {
  constructor({
    pool,
    appId,
    appSecret,
    apiBaseUrl,
    authorizationHost,
    redirectUrl,
    storeRepository,
    requestSheinImpl = requestShein,
    decryptStoreSecretKeyImpl = decryptStoreSecretKey,
    now = () => new Date(),
    randomBytes = crypto.randomBytes,
    attemptTtlMs = DEFAULT_ATTEMPT_TTL_MS,
  } = {}) {
    if (!pool || !storeRepository) {
      throw new Error("WebSheinAuthorizationService缺少数据库或店铺仓储");
    }
    if (!appId || !appSecret || !apiBaseUrl || !authorizationHost || !redirectUrl) {
      throw new Error("WebSheinAuthorizationService缺少SHEIN应用或回调配置");
    }
    this.pool = pool;
    this.appId = appId;
    this.appSecret = appSecret;
    this.apiBaseUrl = apiBaseUrl;
    this.authorizationHost = authorizationHost;
    this.redirectUrl = redirectUrl;
    this.storeRepository = storeRepository;
    this.requestShein = requestSheinImpl;
    this.decryptStoreSecretKey = decryptStoreSecretKeyImpl;
    this.now = now;
    this.randomBytes = randomBytes;
    this.attemptTtlMs = attemptTtlMs;
  }

  async start(context) {
    if (!context?.tenantId || !context?.userId) {
      throw new WebSheinAuthorizationError("UNAUTHORIZED", "请先登录", 401);
    }
    const state = `shw_${this.randomBytes(32).toString("base64url")}`;
    const expiresAt = new Date(this.now().getTime() + this.attemptTtlMs);
    await this.pool.query(
      `INSERT INTO shein_authorization_attempts (
         state_hash, installation_hash, device_name, tenant_id, user_id,
         flow_type, expires_at
       ) VALUES ($1, $2, 'web', $3, $4, 'web', $5)`,
      [
        hashOpaqueSecret(state),
        hashOpaqueSecret(`web:${context.userId}`),
        context.tenantId,
        context.userId,
        expiresAt,
      ],
    );
    return {
      authorizationUrl: buildAuthorizationUrl({
        authorizationHost: this.authorizationHost,
        appId: this.appId,
        redirectUrl: this.redirectUrl,
        state,
      }),
      expiresAt: expiresAt.toISOString(),
    };
  }

  async complete({ state, tempToken } = {}) {
    const normalizedState = cleanText(state, { name: "授权state", maxLength: 200 });
    const normalizedTempToken = cleanText(tempToken, {
      name: "临时令牌",
      maxLength: 500,
    });
    const now = this.now();
    const claimed = await this.pool.query(
      `UPDATE shein_authorization_attempts
       SET status = 'exchanging', updated_at = now(), last_error = NULL
       WHERE state_hash = $1
         AND flow_type = 'web'
         AND status = 'pending'
         AND expires_at > $2
       RETURNING id, tenant_id, user_id, expires_at`,
      [hashOpaqueSecret(normalizedState), now],
    );
    const attempt = claimed.rows[0];
    if (!attempt?.tenant_id || !attempt?.user_id) {
      throw new WebSheinAuthorizationError(
        "AUTHORIZATION_INVALID",
        "SHEIN授权已过期、已使用或不属于网页会话",
        401,
      );
    }

    try {
      const { payload, diagnostics } = await this.requestShein({
        baseUrl: this.apiBaseUrl,
        method: "POST",
        path: TOKEN_EXCHANGE_PATH,
        body: { tempToken: normalizedTempToken },
        openKeyId: this.appId,
        secretKey: this.appSecret,
        identityHeader: "x-lt-appid",
      });
      const info = payload.info || {};
      if (!info.openKeyId || !info.secretKey || !info.supplierId) {
        throw new WebSheinAuthorizationError(
          "SHEIN_AUTHORIZATION_RESPONSE_INVALID",
          "SHEIN授权响应缺少店铺凭证或商户信息",
          502,
        );
      }
      const secretKey = this.decryptStoreSecretKey(info.secretKey, this.appSecret);
      const label = `SHEIN 店铺 ${info.supplierId}`;
      const store = await this.storeRepository.upsertAuthorizedStore({
        tenantId: attempt.tenant_id,
        supplierId: String(info.supplierId),
        openKeyId: String(info.openKeyId),
        secretKey,
        label,
        businessMode: String(info.supplierBusinessMode || "全托管"),
        authorizedBy: attempt.user_id,
      });
      await this.pool.query(
        `INSERT INTO membership_store_access (
           tenant_id, user_id, store_id, granted_by
         ) VALUES ($1, $2, $3, $2)
         ON CONFLICT (tenant_id, user_id, store_id) DO UPDATE SET
           granted_by = EXCLUDED.granted_by,
           created_at = now()`,
        [attempt.tenant_id, attempt.user_id, store.id],
      );
      await this.pool.query(
        `UPDATE shein_authorization_attempts
         SET status = 'completed', store_id = $2, completed_at = now(), updated_at = now()
         WHERE id = $1`,
        [attempt.id, store.id],
      );
      return {
        store: {
          id: store.id,
          supplierId: String(info.supplierId),
          label: store.label || label,
          businessMode: store.business_mode || "全托管",
          status: store.status || "active",
        },
        diagnostics: { traceId: diagnostics?.traceId || null },
      };
    } catch (error) {
      await this.pool.query(
        `UPDATE shein_authorization_attempts
         SET status = 'failed', last_error = $2::jsonb, updated_at = now()
         WHERE id = $1`,
        [
          attempt.id,
          JSON.stringify({
            code: error.code || null,
            message: error.message || "SHEIN授权失败",
          }),
        ],
      );
      throw error;
    }
  }
}

export const WEB_SHEIN_AUTHORIZATION_TOKEN_PATH = TOKEN_EXCHANGE_PATH;
