import crypto from "node:crypto";
import { requestShein } from "../shein-client.js";
import { decryptStoreSecretKey } from "../shein-crypto.js";
import { hashOpaqueSecret } from "./device-auth.js";

const TOKEN_EXCHANGE_PATH = "/open-api/auth/get-by-token";
const DEFAULT_ATTEMPT_TTL_MS = 10 * 60 * 1000;

function cleanText(value, { name, maxLength }) {
  const cleaned = typeof value === "string" ? value.trim() : "";
  if (!cleaned) {
    const error = new Error(`${name}不能为空`);
    error.code = "INVALID_REQUEST";
    error.status = 400;
    throw error;
  }
  if (cleaned.length > maxLength) {
    const error = new Error(`${name}不能超过${maxLength}个字符`);
    error.code = "INVALID_REQUEST";
    error.status = 400;
    throw error;
  }
  return cleaned;
}

function authorizationUrl({ authorizationHost, appId, redirectUrl, state }) {
  const params = new URLSearchParams({
    appid: appId,
    redirectUrl: Buffer.from(redirectUrl, "utf8").toString("base64"),
    state,
  });
  return `https://${authorizationHost}/#/empower?${params.toString()}`;
}

function publicBusinessMode(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "全托管";
  return normalized;
}

export class SheinAuthorizationError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "SheinAuthorizationError";
    this.code = code;
    this.status = status;
  }
}

export class SheinDeviceAuthorizationService {
  constructor({
    pool,
    appId,
    appSecret,
    apiBaseUrl,
    authorizationHost,
    redirectUrl,
    storeRepository,
    deviceAuth,
    requestSheinImpl = requestShein,
    decryptStoreSecretKeyImpl = decryptStoreSecretKey,
    now = () => new Date(),
    randomBytes = crypto.randomBytes,
    attemptTtlMs = DEFAULT_ATTEMPT_TTL_MS,
  } = {}) {
    if (!pool) throw new Error("SheinDeviceAuthorizationService 缺少 pool");
    if (!appId || !appSecret) {
      throw new Error("SheinDeviceAuthorizationService 缺少 SHEIN 应用凭证");
    }
    if (!apiBaseUrl || !authorizationHost || !redirectUrl) {
      throw new Error("SheinDeviceAuthorizationService 缺少 SHEIN 地址配置");
    }
    if (!storeRepository || !deviceAuth) {
      throw new Error("SheinDeviceAuthorizationService 缺少仓储或设备认证服务");
    }
    this.pool = pool;
    this.appId = appId;
    this.appSecret = appSecret;
    this.apiBaseUrl = apiBaseUrl;
    this.authorizationHost = authorizationHost;
    this.redirectUrl = redirectUrl;
    this.storeRepository = storeRepository;
    this.deviceAuth = deviceAuth;
    this.requestShein = requestSheinImpl;
    this.decryptStoreSecretKey = decryptStoreSecretKeyImpl;
    this.now = now;
    this.randomBytes = randomBytes;
    this.attemptTtlMs = attemptTtlMs;
  }

  async start({ installationId, deviceName, tenantId = null } = {}) {
    const normalizedInstallationId = cleanText(installationId, {
      name: "安装标识",
      maxLength: 200,
    });
    const normalizedDeviceName = cleanText(deviceName, {
      name: "设备名称",
      maxLength: 120,
    });
    const state = `sha_${this.randomBytes(32).toString("base64url")}`;
    const expiresAt = new Date(this.now().getTime() + this.attemptTtlMs);

    await this.pool.query(
      `INSERT INTO shein_authorization_attempts (
        state_hash, installation_hash, device_name, tenant_id, expires_at
      ) VALUES ($1, $2, $3, $4, $5)`,
      [
        hashOpaqueSecret(state),
        hashOpaqueSecret(normalizedInstallationId),
        normalizedDeviceName,
        tenantId || null,
        expiresAt,
      ],
    );

    return {
      authorizationUrl: authorizationUrl({
        authorizationHost: this.authorizationHost,
        appId: this.appId,
        redirectUrl: this.redirectUrl,
        state,
      }),
      state,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async complete({
    state,
    tempToken,
    installationId,
    deviceName = "",
  } = {}) {
    const normalizedState = cleanText(state, {
      name: "授权state",
      maxLength: 200,
    });
    const normalizedTempToken = cleanText(tempToken, {
      name: "临时令牌",
      maxLength: 500,
    });
    const normalizedInstallationId = cleanText(installationId, {
      name: "安装标识",
      maxLength: 200,
    });
    const normalizedDeviceName =
      typeof deviceName === "string" ? deviceName.trim() : "";
    if (normalizedDeviceName.length > 120) {
      throw new SheinAuthorizationError(
        "INVALID_REQUEST",
        "设备名称不能超过120个字符",
        400,
      );
    }
    const now = this.now();
    const claimed = await this.pool.query(
      `UPDATE shein_authorization_attempts
       SET status = 'exchanging', updated_at = now(), last_error = NULL
       WHERE state_hash = $1
         AND installation_hash = $2
         AND status = 'pending'
         AND expires_at > $3
       RETURNING id, device_name, tenant_id, expires_at`,
      [
        hashOpaqueSecret(normalizedState),
        hashOpaqueSecret(normalizedInstallationId),
        now,
      ],
    );
    const attempt = claimed.rows[0];
    if (!attempt) {
      const existing = await this.pool.query(
        `SELECT status, expires_at
         FROM shein_authorization_attempts
         WHERE state_hash = $1 AND installation_hash = $2`,
        [
          hashOpaqueSecret(normalizedState),
          hashOpaqueSecret(normalizedInstallationId),
        ],
      );
      const row = existing.rows[0];
      if (row && new Date(row.expires_at) <= now) {
        await this.pool.query(
          `UPDATE shein_authorization_attempts
           SET status = 'expired', updated_at = now()
           WHERE state_hash = $1 AND status = 'pending'`,
          [hashOpaqueSecret(normalizedState)],
        );
        throw new SheinAuthorizationError(
          "AUTHORIZATION_EXPIRED",
          "SHEIN 授权已过期，请重新发起",
          401,
        );
      }
      throw new SheinAuthorizationError(
        "AUTHORIZATION_INVALID",
        "SHEIN 授权state无效、已使用或与当前电脑不匹配",
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
        throw new SheinAuthorizationError(
          "SHEIN_AUTHORIZATION_RESPONSE_INVALID",
          "SHEIN 授权响应缺少店铺凭证或商户信息",
          502,
        );
      }
      const secretKey = this.decryptStoreSecretKey(
        info.secretKey,
        this.appSecret,
      );
      const defaultTenantName = `SHEIN 店铺 ${info.supplierId}`;
      const tenantResult = attempt.tenant_id
        ? await this.pool.query(
            `SELECT id, name, status
             FROM tenants
             WHERE id = $1`,
            [attempt.tenant_id],
          )
        : await this.pool.query(
            `INSERT INTO tenants (name)
             VALUES ($1)
             RETURNING id, name, status`,
            [defaultTenantName],
          );
      const selectedTenant = tenantResult.rows[0];
      if (!selectedTenant || selectedTenant.status === "suspended" ||
          selectedTenant.status === "closed") {
        throw new SheinAuthorizationError(
          "TENANT_UNAVAILABLE",
          "当前工作空间不存在或不可用",
          403,
        );
      }
      const store = await this.storeRepository.upsertAuthorizedStore({
        tenantId: selectedTenant.id,
        supplierId: String(info.supplierId),
        openKeyId: String(info.openKeyId),
        secretKey,
        label: defaultTenantName,
        businessMode: publicBusinessMode(info.supplierBusinessMode),
      });
      if (!attempt.tenant_id && store.tenant_id !== selectedTenant.id) {
        await this.pool.query(
          `DELETE FROM tenants
           WHERE id = $1
             AND NOT EXISTS (SELECT 1 FROM stores WHERE tenant_id = $1)
             AND NOT EXISTS (SELECT 1 FROM desktop_devices WHERE tenant_id = $1)`,
          [selectedTenant.id],
        );
      }
      const tenant = await this.pool.query(
        `SELECT id, name FROM tenants WHERE id = $1`,
        [store.tenant_id],
      );
      const session = await this.deviceAuth.issueAuthorizedSession({
        tenantId: store.tenant_id,
        tenantName: tenant.rows[0]?.name || selectedTenant.name ||
          defaultTenantName,
        installationId: normalizedInstallationId,
        deviceName: normalizedDeviceName || attempt.device_name,
      });

      await this.pool.query(
        `UPDATE shein_authorization_attempts
         SET status = 'completed',
             tenant_id = $2,
             store_id = $3,
             completed_at = now(),
             updated_at = now()
         WHERE id = $1`,
        [attempt.id, store.tenant_id, store.id],
      );

      return {
        ...session,
        store: {
          id: String(info.supplierId || info.openKeyId),
          supplierId: String(info.supplierId),
          openKeyId: String(info.openKeyId),
          secretKey,
          label: store.label || defaultTenantName,
          businessMode: store.business_mode || "全托管",
          source: "cloud-authorization",
        },
        diagnostics: {
          traceId: diagnostics.traceId || null,
        },
      };
    } catch (error) {
      await this.pool.query(
        `UPDATE shein_authorization_attempts
         SET status = 'failed',
             last_error = $2::jsonb,
             updated_at = now()
         WHERE id = $1`,
        [
          attempt.id,
          JSON.stringify({
            code: error.code || null,
            message: error.message || "SHEIN 授权失败",
          }),
        ],
      );
      throw error;
    }
  }
}

export const SHEIN_AUTHORIZATION_TOKEN_PATH = TOKEN_EXCHANGE_PATH;
