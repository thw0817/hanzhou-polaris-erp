import crypto from "node:crypto";
import { withTransaction } from "./postgres.js";

const ACCESS_TOKEN_BYTES = 32;
const ENROLLMENT_CODE_BYTES = 18;
const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_ENROLLMENT_TTL_MS = 24 * 60 * 60 * 1000;

function sha256(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest();
}

function cleanText(value, { name, maxLength, required = true }) {
  const cleaned = typeof value === "string" ? value.trim() : "";
  if (required && !cleaned) {
    throw new DeviceAuthError("INVALID_REQUEST", `${name}不能为空`, 400);
  }
  if (cleaned.length > maxLength) {
    throw new DeviceAuthError(
      "INVALID_REQUEST",
      `${name}不能超过${maxLength}个字符`,
      400,
    );
  }
  return cleaned;
}

export class DeviceAuthError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "DeviceAuthError";
    this.code = code;
    this.status = status;
  }
}

export function generateEnrollmentCode(randomBytes = crypto.randomBytes) {
  return `SHEIN-${randomBytes(ENROLLMENT_CODE_BYTES).toString("base64url")}`;
}

export function generateAccessToken(randomBytes = crypto.randomBytes) {
  return `scs_${randomBytes(ACCESS_TOKEN_BYTES).toString("base64url")}`;
}

export function hashOpaqueSecret(value) {
  return sha256(value);
}

export function parseBearerToken(authorizationHeader) {
  if (typeof authorizationHeader !== "string") return null;
  const match = authorizationHeader.match(/^Bearer ([A-Za-z0-9_-]+)$/);
  return match ? match[1] : null;
}

export class PostgresDeviceAuthService {
  constructor({
    pool,
    sessionTtlMs = DEFAULT_SESSION_TTL_MS,
    now = () => new Date(),
    randomBytes = crypto.randomBytes,
  } = {}) {
    if (!pool) throw new Error("PostgresDeviceAuthService 缺少 pool");
    this.pool = pool;
    this.sessionTtlMs = sessionTtlMs;
    this.now = now;
    this.randomBytes = randomBytes;
  }

  async createEnrollmentCode({
    tenantId = null,
    tenantName = "",
    expiresInMs = DEFAULT_ENROLLMENT_TTL_MS,
  } = {}) {
    if (!tenantId && !tenantName.trim()) {
      throw new DeviceAuthError(
        "INVALID_REQUEST",
        "tenantId与tenantName至少填写一个",
        400,
      );
    }
    if (!Number.isFinite(expiresInMs) || expiresInMs <= 0) {
      throw new DeviceAuthError("INVALID_REQUEST", "授权码有效期无效", 400);
    }

    const code = generateEnrollmentCode(this.randomBytes);
    const expiresAt = new Date(this.now().getTime() + expiresInMs);
    const result = await withTransaction(this.pool, async (client) => {
      let tenant;
      if (tenantId) {
        const tenantResult = await client.query(
          `SELECT id, name, status
           FROM tenants
           WHERE id = $1
           FOR UPDATE`,
          [tenantId],
        );
        tenant = tenantResult.rows[0];
        if (!tenant || tenant.status !== "active") {
          throw new DeviceAuthError(
            "TENANT_UNAVAILABLE",
            "租户不存在或不可用",
            404,
          );
        }
      } else {
        const name = cleanText(tenantName, {
          name: "租户名称",
          maxLength: 120,
        });
        const tenantResult = await client.query(
          `INSERT INTO tenants (name)
           VALUES ($1)
           RETURNING id, name, status`,
          [name],
        );
        tenant = tenantResult.rows[0];
      }

      await client.query(
        `INSERT INTO device_enrollment_codes (
          tenant_id, code_hash, expires_at
        ) VALUES ($1, $2, $3)`,
        [tenant.id, hashOpaqueSecret(code), expiresAt],
      );
      return tenant;
    });

    return {
      code,
      tenantId: result.id,
      tenantName: result.name,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async enroll({ code, deviceName, installationId = "" } = {}) {
    const normalizedCode = cleanText(code, {
      name: "设备授权码",
      maxLength: 160,
    });
    const normalizedDeviceName = cleanText(deviceName, {
      name: "设备名称",
      maxLength: 120,
    });
    const normalizedInstallationId = cleanText(installationId, {
      name: "安装标识",
      maxLength: 200,
      required: false,
    });
    const now = this.now();

    return withTransaction(this.pool, async (client) => {
      const codeResult = await client.query(
        `SELECT ec.id, ec.tenant_id, ec.status, ec.max_uses,
                ec.used_count, ec.expires_at, t.name AS tenant_name,
                t.status AS tenant_status
         FROM device_enrollment_codes ec
         JOIN tenants t ON t.id = ec.tenant_id
         WHERE ec.code_hash = $1
         FOR UPDATE`,
        [hashOpaqueSecret(normalizedCode)],
      );
      const enrollment = codeResult.rows[0];
      if (
        !enrollment ||
        enrollment.status !== "active" ||
        enrollment.tenant_status !== "active"
      ) {
        throw new DeviceAuthError(
          "ENROLLMENT_CODE_INVALID",
          "设备授权码无效或已使用",
          401,
        );
      }
      if (new Date(enrollment.expires_at) <= now) {
        await client.query(
          `UPDATE device_enrollment_codes
           SET status = 'expired', updated_at = now()
           WHERE id = $1`,
          [enrollment.id],
        );
        throw new DeviceAuthError(
          "ENROLLMENT_CODE_EXPIRED",
          "设备授权码已过期",
          401,
        );
      }
      if (enrollment.used_count >= enrollment.max_uses) {
        throw new DeviceAuthError(
          "ENROLLMENT_CODE_INVALID",
          "设备授权码无效或已使用",
          401,
        );
      }

      const session = await this.#issueSessionWithClient(client, {
        tenantId: enrollment.tenant_id,
        tenantName: enrollment.tenant_name,
        installationId: normalizedInstallationId,
        deviceName: normalizedDeviceName,
        now,
      });
      const nextUsedCount = Number(enrollment.used_count) + 1;
      await client.query(
        `UPDATE device_enrollment_codes
         SET used_count = $2,
             status = CASE WHEN $2 >= max_uses THEN 'used' ELSE status END,
             updated_at = now()
         WHERE id = $1`,
        [enrollment.id, nextUsedCount],
      );
      await client.query(
        `INSERT INTO api_audit_logs (
          tenant_id, operation, method, path, status_code, metadata
        ) VALUES ($1, 'device.enroll', 'POST', '/v1/auth/enroll', 200, $2)`,
        [
          enrollment.tenant_id,
          JSON.stringify({ deviceId: session.device.id }),
        ],
      );
      return session;
    });
  }

  async issueAuthorizedSession({
    tenantId,
    tenantName,
    installationId,
    deviceName,
  } = {}) {
    const normalizedTenantId = cleanText(tenantId, {
      name: "租户ID",
      maxLength: 100,
    });
    const normalizedTenantName = cleanText(tenantName, {
      name: "租户名称",
      maxLength: 120,
    });
    const normalizedInstallationId = cleanText(installationId, {
      name: "安装标识",
      maxLength: 200,
    });
    const normalizedDeviceName = cleanText(deviceName, {
      name: "设备名称",
      maxLength: 120,
    });
    const now = this.now();

    return withTransaction(this.pool, async (client) => {
      const tenantResult = await client.query(
        `SELECT id, name, status
         FROM tenants
         WHERE id = $1
         FOR UPDATE`,
        [normalizedTenantId],
      );
      const tenant = tenantResult.rows[0];
      if (!tenant || tenant.status !== "active") {
        throw new DeviceAuthError(
          "TENANT_UNAVAILABLE",
          "授权店铺所属租户不存在或不可用",
          404,
        );
      }
      const session = await this.#issueSessionWithClient(client, {
        tenantId: tenant.id,
        tenantName: tenant.name || normalizedTenantName,
        installationId: normalizedInstallationId,
        deviceName: normalizedDeviceName,
        now,
      });
      await client.query(
        `INSERT INTO api_audit_logs (
          tenant_id, operation, method, path, status_code, metadata
        ) VALUES (
          $1, 'device.shein_authorized', 'POST',
          '/v1/shein/auth/complete', 200, $2
        )`,
        [
          tenant.id,
          JSON.stringify({ deviceId: session.device.id }),
        ],
      );
      return session;
    });
  }

  async #issueSessionWithClient(client, {
    tenantId,
    tenantName,
    installationId,
    deviceName,
    now,
  }) {
    const accessToken = generateAccessToken(this.randomBytes);
    const expiresAt = new Date(now.getTime() + this.sessionTtlMs);
    const installationHash = installationId
      ? hashOpaqueSecret(installationId)
      : null;
    let device = null;
    if (installationHash) {
      const existingDevice = await client.query(
        `SELECT id, tenant_id, name, status
         FROM desktop_devices
         WHERE tenant_id = $1 AND installation_hash = $2
         FOR UPDATE`,
        [tenantId, installationHash],
      );
      device = existingDevice.rows[0] || null;
    }

    if (device) {
      if (device.status !== "active") {
        throw new DeviceAuthError(
          "DEVICE_REVOKED",
          "当前设备已被停用",
          403,
        );
      }
      const updated = await client.query(
        `UPDATE desktop_devices
         SET name = $2, last_seen_at = $3, updated_at = now()
         WHERE id = $1
         RETURNING id, tenant_id, name, status`,
        [device.id, deviceName, now],
      );
      device = updated.rows[0];
      await client.query(
        `UPDATE device_sessions
         SET revoked_at = COALESCE(revoked_at, now())
         WHERE device_id = $1 AND revoked_at IS NULL`,
        [device.id],
      );
    } else {
      const inserted = await client.query(
        `INSERT INTO desktop_devices (
          tenant_id, name, installation_hash, last_seen_at
        ) VALUES ($1, $2, $3, $4)
        RETURNING id, tenant_id, name, status`,
        [tenantId, deviceName, installationHash, now],
      );
      device = inserted.rows[0];
    }

    await client.query(
      `INSERT INTO device_sessions (
        device_id, token_hash, expires_at, last_seen_at
      ) VALUES ($1, $2, $3, $4)`,
      [device.id, hashOpaqueSecret(accessToken), expiresAt, now],
    );

    return {
      accessToken,
      tokenType: "Bearer",
      expiresAt: expiresAt.toISOString(),
      tenant: {
        id: tenantId,
        name: tenantName,
      },
      device: {
        id: device.id,
        name: device.name,
      },
    };
  }

  async authenticate(accessToken) {
    if (!accessToken) {
      throw new DeviceAuthError("UNAUTHORIZED", "缺少访问令牌", 401);
    }
    const now = this.now();
    const result = await this.pool.query(
      `SELECT ds.id AS session_id, ds.expires_at,
              d.id AS device_id, d.name AS device_name,
              d.tenant_id, d.status AS device_status,
              t.name AS tenant_name, t.status AS tenant_status
       FROM device_sessions ds
       JOIN desktop_devices d ON d.id = ds.device_id
       JOIN tenants t ON t.id = d.tenant_id
       WHERE ds.token_hash = $1
         AND ds.revoked_at IS NULL`,
      [hashOpaqueSecret(accessToken)],
    );
    const session = result.rows[0];
    if (
      !session ||
      session.device_status !== "active" ||
      session.tenant_status !== "active" ||
      new Date(session.expires_at) <= now
    ) {
      throw new DeviceAuthError(
        "UNAUTHORIZED",
        "访问令牌无效、已过期或已撤销",
        401,
      );
    }

    await this.pool.query(
      `UPDATE device_sessions
       SET last_seen_at = $2
       WHERE id = $1
         AND (
           last_seen_at IS NULL
           OR last_seen_at < $2::timestamptz - interval '15 minutes'
         )`,
      [session.session_id, now],
    );
    await this.pool.query(
      `UPDATE desktop_devices
       SET last_seen_at = $2, updated_at = now()
       WHERE id = $1
         AND (
           last_seen_at IS NULL
           OR last_seen_at < $2::timestamptz - interval '15 minutes'
         )`,
      [session.device_id, now],
    );

    return {
      sessionId: session.session_id,
      tenantId: session.tenant_id,
      tenantName: session.tenant_name,
      deviceId: session.device_id,
      deviceName: session.device_name,
      expiresAt: new Date(session.expires_at).toISOString(),
    };
  }

  async revoke(accessToken, context) {
    await this.pool.query(
      `UPDATE device_sessions
       SET revoked_at = now()
       WHERE id = $1 AND token_hash = $2 AND revoked_at IS NULL`,
      [context.sessionId, hashOpaqueSecret(accessToken)],
    );
    await this.pool.query(
      `INSERT INTO api_audit_logs (
        tenant_id, operation, method, path, status_code, metadata
      ) VALUES ($1, 'device.logout', 'POST', '/v1/auth/logout', 200, $2)`,
      [
        context.tenantId,
        JSON.stringify({ deviceId: context.deviceId }),
      ],
    );
  }
}

export function createFixedWindowRateLimiter({
  limit = 10,
  windowMs = 15 * 60 * 1000,
  now = () => Date.now(),
} = {}) {
  const buckets = new Map();
  return {
    consume(key) {
      const currentTime = now();
      const existing = buckets.get(key);
      if (!existing || existing.resetAt <= currentTime) {
        buckets.set(key, { count: 1, resetAt: currentTime + windowMs });
        return { allowed: true, retryAfterSeconds: 0 };
      }
      existing.count += 1;
      if (existing.count <= limit) {
        return { allowed: true, retryAfterSeconds: 0 };
      }
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((existing.resetAt - currentTime) / 1000),
        ),
      };
    },
  };
}
