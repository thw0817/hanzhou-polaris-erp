import crypto from "node:crypto";
import { promisify } from "node:util";
import { withTransaction } from "./postgres.js";

const scryptAsync = promisify(crypto.scrypt);
const PASSWORD_KEY_BYTES = 64;
const PASSWORD_MIN_LENGTH = 10;
const PASSWORD_MAX_LENGTH = 200;
const SESSION_TOKEN_BYTES = 32;
const INVITATION_TOKEN_BYTES = 32;
const PASSWORD_RESET_TOKEN_BYTES = 32;
const DEFAULT_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const DEFAULT_INVITATION_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SCRYPT_OPTIONS = Object.freeze({
  N: 32768,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024,
});
const ROLE_PRIORITY = Object.freeze({
  owner: 4,
  admin: 3,
  operator: 2,
  viewer: 1,
});

function requireAdministrator(context) {
  if (!["owner", "admin"].includes(context?.role)) {
    throw new WebAuthError("ADMIN_REQUIRED", "仅管理员可以管理成员权限", 403);
  }
}

function normalizeStoreIds(storeIds) {
  if (!Array.isArray(storeIds)) {
    throw new WebAuthError("INVALID_STORE_ACCESS", "店铺权限必须是数组", 400);
  }
  const normalized = Array.from(new Set(storeIds.map((value) => String(value || "").trim())));
  if (normalized.some((value) => !UUID_PATTERN.test(value)) || normalized.length > 100) {
    throw new WebAuthError("INVALID_STORE_ACCESS", "店铺权限列表无效", 400);
  }
  return normalized;
}

function normalizeManagedMemberInput(input) {
  const role = input?.role == null ? null : String(input.role).trim();
  const status = input?.status == null ? null : String(input.status).trim();
  if (role === null && status === null) {
    throw new WebAuthError("INVALID_MEMBER_UPDATE", "没有可更新的成员字段", 400);
  }
  if (role !== null && !["operator", "viewer"].includes(role)) {
    throw new WebAuthError("INVALID_MEMBER_ROLE", "普通成员角色无效", 400);
  }
  if (status !== null && !["active", "disabled"].includes(status)) {
    throw new WebAuthError("INVALID_MEMBER_STATUS", "成员状态无效", 400);
  }
  return { role, status };
}

function normalizeAdminAlias(value) {
  const normalized = String(value ?? "").trim().replace(/\s+/g, " ");
  if (normalized.length > 120) {
    throw new WebAuthError("INVALID_MEMBER_ALIAS", "管理员账户别名不能超过120个字符", 400);
  }
  return normalized;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest();
}

function cleanText(value, { name, maxLength, required = true }) {
  const cleaned = typeof value === "string" ? value.trim() : "";
  if (required && !cleaned) {
    throw new WebAuthError("INVALID_REQUEST", `${name}不能为空`, 400);
  }
  if (cleaned.length > maxLength) {
    throw new WebAuthError(
      "INVALID_REQUEST",
      `${name}不能超过${maxLength}个字符`,
      400,
    );
  }
  return cleaned;
}

function normalizeEmail(value) {
  const email = cleanText(value, { name: "邮箱", maxLength: 254 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new WebAuthError("INVALID_REQUEST", "邮箱格式无效", 400);
  }
  return email;
}

function validatePassword(value, { enforceMinimum = true } = {}) {
  const password = typeof value === "string" ? value : "";
  if (
    (enforceMinimum && password.length < PASSWORD_MIN_LENGTH) ||
    password.length > PASSWORD_MAX_LENGTH
  ) {
    throw new WebAuthError(
      "INVALID_REQUEST",
      `密码长度必须为${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH}个字符`,
      400,
    );
  }
  return password;
}

function timingSafeEqual(left, right) {
  return (
    left.length === right.length &&
    crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right))
  );
}

export class WebAuthError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "WebAuthError";
    this.code = code;
    this.status = status;
  }
}

export function generateWebSessionToken(randomBytes = crypto.randomBytes) {
  return `sws_${randomBytes(SESSION_TOKEN_BYTES).toString("base64url")}`;
}

export function generateMemberInvitationToken(randomBytes = crypto.randomBytes) {
  return `swi_${randomBytes(INVITATION_TOKEN_BYTES).toString("base64url")}`;
}

export function generatePasswordResetToken(randomBytes = crypto.randomBytes) {
  return `swr_${randomBytes(PASSWORD_RESET_TOKEN_BYTES).toString("base64url")}`;
}

function hashInvitationToken(token) {
  const normalized = String(token || "").trim();
  if (!/^swi_[A-Za-z0-9_-]{43}$/.test(normalized)) {
    throw new WebAuthError("INVALID_INVITATION", "邀请链接无效", 404);
  }
  return sha256(normalized);
}

function hashPasswordResetToken(token) {
  const normalized = String(token || "").trim();
  if (!/^swr_[A-Za-z0-9_-]{43}$/.test(normalized)) {
    throw new WebAuthError("INVALID_RESET_TOKEN", "重置链接无效或已过期", 400);
  }
  return sha256(normalized);
}

function assertInvitationAvailable(invitation, now) {
  if (!invitation) {
    throw new WebAuthError("INVALID_INVITATION", "邀请链接无效", 404);
  }
  if (invitation.accepted_at || invitation.revoked_at) {
    throw new WebAuthError("INVITATION_UNAVAILABLE", "邀请链接已失效", 410);
  }
  if (new Date(invitation.expires_at) <= now) {
    throw new WebAuthError("INVITATION_EXPIRED", "邀请链接已过期", 410);
  }
  if (invitation.tenant_status !== "active") {
    throw new WebAuthError("TENANT_UNAVAILABLE", "工作空间当前不可用", 409);
  }
}

function publicInvitation(invitation) {
  return {
    id: invitation.id,
    email: invitation.email,
    displayName: invitation.display_name,
    role: invitation.role,
    storeCount: Array.isArray(invitation.store_ids) ? invitation.store_ids.length : 0,
    tenant: { id: invitation.tenant_id, name: invitation.tenant_name },
    expiresAt: new Date(invitation.expires_at).toISOString(),
  };
}

export async function hashWebPassword(
  password,
  {
    randomBytes = crypto.randomBytes,
    derive = scryptAsync,
  } = {},
) {
  const normalized = validatePassword(password);
  const salt = randomBytes(16);
  const derived = await derive(
    normalized,
    salt,
    PASSWORD_KEY_BYTES,
    SCRYPT_OPTIONS,
  );
  return [
    "scrypt",
    SCRYPT_OPTIONS.N,
    SCRYPT_OPTIONS.r,
    SCRYPT_OPTIONS.p,
    salt.toString("base64url"),
    Buffer.from(derived).toString("base64url"),
  ].join("$");
}

export async function verifyWebPassword(
  password,
  encoded,
  { derive = scryptAsync } = {},
) {
  const normalized = validatePassword(password, { enforceMinimum: false });
  const [
    algorithm,
    rawN,
    rawR,
    rawP,
    encodedSalt,
    encodedHash,
  ] = String(encoded || "").split("$");
  if (
    algorithm !== "scrypt" ||
    !rawN ||
    !rawR ||
    !rawP ||
    !encodedSalt ||
    !encodedHash
  ) {
    return false;
  }
  const options = {
    N: Number(rawN),
    r: Number(rawR),
    p: Number(rawP),
    maxmem: 64 * 1024 * 1024,
  };
  if (
    options.N !== SCRYPT_OPTIONS.N ||
    options.r !== SCRYPT_OPTIONS.r ||
    options.p !== SCRYPT_OPTIONS.p
  ) {
    return false;
  }
  const expected = Buffer.from(encodedHash, "base64url");
  const actual = await derive(
    normalized,
    Buffer.from(encodedSalt, "base64url"),
    expected.length,
    options,
  );
  return timingSafeEqual(Buffer.from(actual), expected);
}

export function parseCookieHeader(cookieHeader = "") {
  return String(cookieHeader)
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const separator = part.indexOf("=");
      if (separator <= 0) return cookies;
      const name = part.slice(0, separator).trim();
      const value = part.slice(separator + 1).trim();
      cookies[name] = decodeURIComponent(value);
      return cookies;
    }, {});
}

export function serializeWebSessionCookie({
  name,
  token = "",
  maxAgeSeconds = 0,
  secure = true,
} = {}) {
  const attributes = [
    `${name}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
  ];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}

export class PostgresWebAuthService {
  constructor({
    pool,
    sessionTtlMs = DEFAULT_SESSION_TTL_MS,
    invitationTtlMs = DEFAULT_INVITATION_TTL_MS,
    passwordResetTtlMs = DEFAULT_PASSWORD_RESET_TTL_MS,
    emailService = null,
    webAppBaseUrl = "",
    now = () => new Date(),
    randomBytes = crypto.randomBytes,
  } = {}) {
    if (!pool) throw new Error("PostgresWebAuthService 缺少 pool");
    this.pool = pool;
    this.sessionTtlMs = sessionTtlMs;
    this.invitationTtlMs = invitationTtlMs;
    this.passwordResetTtlMs = passwordResetTtlMs;
    this.emailService = emailService;
    this.webAppBaseUrl = String(webAppBaseUrl || "").replace(/\/+$/, "");
    this.now = now;
    this.randomBytes = randomBytes;
  }

  async resolvePublicRegistrationTenant(configuredTenantId = null) {
    const values = configuredTenantId ? [String(configuredTenantId)] : [];
    const result = await this.pool.query(
      `SELECT id, name, status
       FROM tenants
       WHERE status = 'active'
         ${configuredTenantId ? "AND id = $1" : ""}
       ORDER BY created_at ASC
       ${configuredTenantId ? "LIMIT 1" : "LIMIT 2"}`,
      values,
    );
    if (result.rows.length !== 1) {
      throw new WebAuthError(
        "REGISTRATION_UNAVAILABLE",
        "当前未配置可注册的工作空间，请联系管理员",
        503,
      );
    }
    return { id: result.rows[0].id, name: result.rows[0].name };
  }

  async register({ tenantId, email, displayName = "", password } = {}) {
    const tenant = await this.resolvePublicRegistrationTenant(tenantId);
    const normalizedEmail = normalizeEmail(email);
    const normalizedName = cleanText(displayName, {
      name: "显示名称",
      maxLength: 120,
      required: false,
    });
    const passwordHash = await hashWebPassword(password, {
      randomBytes: this.randomBytes,
    });

    return withTransaction(this.pool, async (client) => {
      const existing = await client.query(
        `SELECT id FROM users WHERE lower(email) = $1`,
        [normalizedEmail],
      );
      if (existing.rowCount) {
        throw new WebAuthError(
          "EMAIL_ALREADY_REGISTERED",
          "该邮箱已注册，请直接登录或使用忘记密码",
          409,
        );
      }
      const userResult = await client.query(
        `INSERT INTO users (email, display_name, password_hash, status)
         VALUES ($1, $2, $3, 'active')
         RETURNING id, email, display_name, status`,
        [normalizedEmail, normalizedName, passwordHash],
      );
      const user = userResult.rows[0];
      await client.query(
        `INSERT INTO memberships (tenant_id, user_id, role)
         VALUES ($1, $2, 'operator')`,
        [tenant.id, user.id],
      );
      await client.query(
        `INSERT INTO api_audit_logs (
           tenant_id, user_id, operation, method, path, status_code, metadata
         ) VALUES ($1, $2, 'web.user.register', 'POST',
                   '/v1/web/register', 201, $3)`,
        [tenant.id, user.id, JSON.stringify({ email: normalizedEmail })],
      );
      return {
        registered: true,
        tenant,
        user: {
          id: user.id,
          email: user.email,
          displayName: user.display_name,
          role: "operator",
        },
      };
    });
  }

  async requestPasswordReset({ email } = {}) {
    if (!this.emailService || !this.webAppBaseUrl) {
      throw new WebAuthError(
        "SERVICE_UNAVAILABLE",
        "密码重置邮件服务尚未配置",
        503,
      );
    }
    const normalizedEmail = normalizeEmail(email);
    const result = await this.pool.query(
      `SELECT id, email, status
       FROM users
       WHERE lower(email) = $1`,
      [normalizedEmail],
    );
    const user = result.rows[0];
    if (!user || user.status !== "active") {
      return { accepted: true };
    }

    const token = generatePasswordResetToken(this.randomBytes);
    const tokenHash = sha256(token);
    const now = this.now();
    const expiresAt = new Date(now.getTime() + this.passwordResetTtlMs);
    await this.pool.query(
      `UPDATE password_reset_tokens
       SET used_at = $2
       WHERE user_id = $1 AND used_at IS NULL AND expires_at > $2`,
      [user.id, now],
    );
    await this.pool.query(
      `INSERT INTO password_reset_tokens (
         user_id, token_hash, expires_at, requested_at
       ) VALUES ($1, $2, $3, $4)`,
      [user.id, tokenHash, expiresAt, now],
    );
    try {
      await this.emailService.sendPasswordReset({
        to: user.email,
        resetUrl: `${this.webAppBaseUrl}/reset-password?token=${encodeURIComponent(token)}`,
        expiresAt: expiresAt.toISOString(),
      });
    } catch (error) {
      await this.pool.query(
        `UPDATE password_reset_tokens
         SET used_at = $2
         WHERE user_id = $1 AND token_hash = $3 AND used_at IS NULL`,
        [user.id, this.now(), tokenHash],
      );
      throw new WebAuthError(
        "EMAIL_DELIVERY_UNAVAILABLE",
        "重置邮件暂时发送失败，请稍后重试",
        503,
      );
    }
    await this.pool.query(
      `INSERT INTO api_audit_logs (
         tenant_id, user_id, operation, method, path, status_code, metadata
       )
       SELECT m.tenant_id, $1, 'web.password.reset.request', 'POST',
              '/v1/web/password-reset/request', 202, $2
       FROM memberships m
       WHERE m.user_id = $1
       ORDER BY CASE m.role WHEN 'owner' THEN 4 WHEN 'admin' THEN 3 ELSE 1 END DESC
       LIMIT 1`,
      [user.id, JSON.stringify({ expiresAt })],
    );
    return { accepted: true };
  }

  async resetPassword(token, password) {
    const tokenHash = hashPasswordResetToken(token);
    const passwordHash = await hashWebPassword(password, {
      randomBytes: this.randomBytes,
    });
    const now = this.now();
    return withTransaction(this.pool, async (client) => {
      const result = await client.query(
        `SELECT reset.id, reset.user_id, reset.token_hash,
                reset.expires_at, reset.used_at,
                user_row.status AS user_status,
                membership.tenant_id
         FROM password_reset_tokens reset
         JOIN users user_row ON user_row.id = reset.user_id
         LEFT JOIN memberships membership ON membership.user_id = reset.user_id
         WHERE reset.token_hash = $1
         FOR UPDATE OF reset`,
        [tokenHash],
      );
      const reset = result.rows[0];
      if (
        !reset ||
        !timingSafeEqual(Buffer.from(reset.token_hash), tokenHash) ||
        reset.used_at ||
        new Date(reset.expires_at) <= now ||
        reset.user_status !== "active"
      ) {
        throw new WebAuthError("INVALID_RESET_TOKEN", "重置链接无效或已过期", 400);
      }
      await client.query(
        `UPDATE users
         SET password_hash = $2, updated_at = now()
         WHERE id = $1`,
        [reset.user_id, passwordHash],
      );
      await client.query(
        `UPDATE password_reset_tokens
         SET used_at = $2
         WHERE id = $1`,
        [reset.id, now],
      );
      await client.query(
        `UPDATE web_sessions
         SET revoked_at = $2
         WHERE user_id = $1 AND revoked_at IS NULL`,
        [reset.user_id, now],
      );
      await client.query(
        `INSERT INTO api_audit_logs (
           tenant_id, user_id, operation, method, path, status_code
         ) VALUES ($1, $2, 'web.password.reset.complete', 'POST',
                   '/v1/web/password-reset/confirm', 200)`,
        [reset.tenant_id, reset.user_id],
      );
      return { reset: true };
    });
  }

  async provisionUser({
    tenantId = null,
    tenantName = "",
    email,
    displayName = "",
    password,
    role = "operator",
  } = {}) {
    if (!ROLE_PRIORITY[role]) {
      throw new WebAuthError("INVALID_REQUEST", "成员角色无效", 400);
    }
    const normalizedEmail = normalizeEmail(email);
    const normalizedName = cleanText(displayName, {
      name: "显示名称",
      maxLength: 120,
      required: false,
    });
    const passwordHash = await hashWebPassword(password, {
      randomBytes: this.randomBytes,
    });

    return withTransaction(this.pool, async (client) => {
      let tenant = null;
      if (tenantId) {
        const result = await client.query(
          `SELECT id, name, status
           FROM tenants
           WHERE id = $1
           FOR UPDATE`,
          [tenantId],
        );
        tenant = result.rows[0] || null;
      } else {
        const normalizedTenantName = cleanText(tenantName, {
          name: "工作空间名称",
          maxLength: 120,
        });
        const result = await client.query(
          `INSERT INTO tenants (name)
           VALUES ($1)
           RETURNING id, name, status`,
          [normalizedTenantName],
        );
        tenant = result.rows[0];
      }
      if (!tenant || tenant.status !== "active") {
        throw new WebAuthError(
          "TENANT_UNAVAILABLE",
          "工作空间不存在或不可用",
          404,
        );
      }

      const userResult = await client.query(
        `INSERT INTO users (email, display_name, password_hash, status)
         VALUES ($1, $2, $3, 'active')
         ON CONFLICT (email) DO UPDATE SET
           display_name = EXCLUDED.display_name,
           password_hash = EXCLUDED.password_hash,
           status = 'active',
           updated_at = now()
         RETURNING id, email, display_name, status`,
        [normalizedEmail, normalizedName, passwordHash],
      );
      const user = userResult.rows[0];
      await client.query(
        `INSERT INTO memberships (tenant_id, user_id, role)
         VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, user_id) DO UPDATE SET
           role = EXCLUDED.role`,
        [tenant.id, user.id, role],
      );
      await client.query(
        `UPDATE web_sessions
         SET revoked_at = COALESCE(revoked_at, now())
         WHERE user_id = $1 AND tenant_id = $2 AND revoked_at IS NULL`,
        [user.id, tenant.id],
      );
      await client.query(
        `INSERT INTO api_audit_logs (
          tenant_id, user_id, operation, method, path, status_code, metadata
        ) VALUES ($1, $2, 'web.user.provision', 'CLI',
                  'web:provision-user', 200, $3)`,
        [tenant.id, user.id, JSON.stringify({ role })],
      );
      return {
        tenant: { id: tenant.id, name: tenant.name },
        user: {
          id: user.id,
          email: user.email,
          displayName: user.display_name,
          role,
        },
      };
    });
  }

  async createMemberInvitation(context, input) {
    requireAdministrator(context);
    const email = normalizeEmail(input?.email);
    const displayName = cleanText(input?.displayName, {
      name: "显示名称",
      maxLength: 120,
    });
    const role = String(input?.role || "").trim();
    if (!["operator", "viewer"].includes(role)) {
      throw new WebAuthError("INVALID_MEMBER_ROLE", "普通成员角色无效", 400);
    }
    const storeIds = normalizeStoreIds(input?.storeIds || []);
    const token = generateMemberInvitationToken(this.randomBytes);
    const tokenHash = hashInvitationToken(token);
    const createdAt = this.now();
    const expiresAt = new Date(createdAt.getTime() + this.invitationTtlMs);

    const invitation = await withTransaction(this.pool, async (client) => {
      const tenantResult = await client.query(
        `SELECT id, name, status
         FROM tenants
         WHERE id = $1
         FOR UPDATE`,
        [context.tenantId],
      );
      const tenant = tenantResult.rows[0];
      if (!tenant || tenant.status !== "active") {
        throw new WebAuthError("TENANT_UNAVAILABLE", "工作空间当前不可用", 409);
      }
      const existingUser = await client.query(
        `SELECT id
         FROM users
         WHERE lower(email) = $1`,
        [email],
      );
      if (existingUser.rowCount) {
        throw new WebAuthError(
          "INVITED_EMAIL_EXISTS",
          "该邮箱已存在账号，暂不支持通过邀请合并工作空间",
          409,
        );
      }
      if (storeIds.length) {
        const storeResult = await client.query(
          `SELECT id
           FROM stores
           WHERE tenant_id = $1
             AND status = 'active'
             AND id = ANY($2::uuid[])`,
          [context.tenantId, storeIds],
        );
        if (storeResult.rows.length !== storeIds.length) {
          throw new WebAuthError(
            "STORE_ACCESS_INVALID",
            "部分店铺不存在、未授权或不属于当前工作空间",
            400,
          );
        }
      }
      await client.query(
        `UPDATE member_invitations
         SET revoked_at = $3
         WHERE tenant_id = $1
           AND lower(email) = $2
           AND accepted_at IS NULL
           AND revoked_at IS NULL`,
        [context.tenantId, email, createdAt],
      );
      const inserted = await client.query(
        `INSERT INTO member_invitations (
           tenant_id, email, display_name, role, store_ids,
           token_hash, expires_at, invited_by, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          context.tenantId,
          email,
          displayName,
          role,
          storeIds,
          tokenHash,
          expiresAt,
          context.userId,
          createdAt,
        ],
      );
      await client.query(
        `INSERT INTO api_audit_logs (
           tenant_id, user_id, operation, method, path, status_code, metadata
         ) VALUES ($1, $2, 'web.member.invitation.create', 'POST',
                   '/v1/web/admin/invitations', 201, $3)`,
        [
          context.tenantId,
          context.userId,
          JSON.stringify({ email, role, storeCount: storeIds.length, expiresAt }),
        ],
      );
      return {
        id: inserted.rows[0].id,
        email,
        displayName,
        role,
        storeIds,
        expiresAt: expiresAt.toISOString(),
      };
    });
    return { invitation, token };
  }

  async getMemberInvitation(token) {
    const tokenHash = hashInvitationToken(token);
    const result = await this.pool.query(
      `SELECT invitation.id, invitation.tenant_id, invitation.email,
              invitation.display_name, invitation.role, invitation.store_ids,
              invitation.expires_at, invitation.accepted_at, invitation.revoked_at,
              tenant.name AS tenant_name, tenant.status AS tenant_status
       FROM member_invitations invitation
       JOIN tenants tenant ON tenant.id = invitation.tenant_id
       WHERE invitation.token_hash = $1`,
      [tokenHash],
    );
    const invitation = result.rows[0];
    assertInvitationAvailable(invitation, this.now());
    return { invitation: publicInvitation(invitation) };
  }

  async acceptMemberInvitation(token, password) {
    const tokenHash = hashInvitationToken(token);
    const passwordHash = await hashWebPassword(password, {
      randomBytes: this.randomBytes,
    });
    const now = this.now();
    return withTransaction(this.pool, async (client) => {
      const invitationResult = await client.query(
        `SELECT invitation.id, invitation.tenant_id, invitation.email,
                invitation.display_name, invitation.role, invitation.store_ids,
                invitation.expires_at, invitation.accepted_at, invitation.revoked_at,
                invitation.invited_by,
                tenant.name AS tenant_name, tenant.status AS tenant_status
         FROM member_invitations invitation
         JOIN tenants tenant ON tenant.id = invitation.tenant_id
         WHERE invitation.token_hash = $1
         FOR UPDATE OF invitation`,
        [tokenHash],
      );
      const invitation = invitationResult.rows[0];
      assertInvitationAvailable(invitation, now);
      const existingUser = await client.query(
        `SELECT id FROM users WHERE lower(email) = $1`,
        [invitation.email],
      );
      if (existingUser.rowCount) {
        throw new WebAuthError(
          "INVITED_EMAIL_EXISTS",
          "该邮箱已存在账号，请联系管理员重新处理",
          409,
        );
      }
      const storeIds = Array.isArray(invitation.store_ids)
        ? invitation.store_ids.map(String)
        : [];
      if (storeIds.length) {
        const storeResult = await client.query(
          `SELECT id
           FROM stores
           WHERE tenant_id = $1
             AND status = 'active'
             AND id = ANY($2::uuid[])`,
          [invitation.tenant_id, storeIds],
        );
        if (storeResult.rows.length !== storeIds.length) {
          throw new WebAuthError(
            "INVITATION_STORES_CHANGED",
            "邀请中的店铺权限已变化，请联系管理员重新邀请",
            409,
          );
        }
      }
      const userResult = await client.query(
        `INSERT INTO users (email, display_name, password_hash, status)
         VALUES ($1, $2, $3, 'active')
         RETURNING id, email, display_name, status`,
        [invitation.email, invitation.display_name, passwordHash],
      );
      const user = userResult.rows[0];
      await client.query(
        `INSERT INTO memberships (tenant_id, user_id, role)
         VALUES ($1, $2, $3)`,
        [invitation.tenant_id, user.id, invitation.role],
      );
      if (storeIds.length) {
        await client.query(
          `INSERT INTO membership_store_access (
             tenant_id, user_id, store_id, granted_by
           )
           SELECT $1, $2, selected_store_id, $4
           FROM unnest($3::uuid[]) AS selected_store(selected_store_id)`,
          [invitation.tenant_id, user.id, storeIds, invitation.invited_by],
        );
      }
      await client.query(
        `UPDATE member_invitations
         SET accepted_at = $2
         WHERE id = $1`,
        [invitation.id, now],
      );
      await client.query(
        `INSERT INTO api_audit_logs (
           tenant_id, user_id, operation, method, path, status_code, metadata
         ) VALUES ($1, $2, 'web.member.invitation.accept', 'POST',
                   '/v1/web/invitations/:token/accept', 200, $3)`,
        [
          invitation.tenant_id,
          user.id,
          JSON.stringify({
            invitationId: invitation.id,
            role: invitation.role,
            storeCount: storeIds.length,
          }),
        ],
      );
      return {
        accepted: true,
        tenant: { id: invitation.tenant_id, name: invitation.tenant_name },
        user: {
          id: user.id,
          email: user.email,
          displayName: user.display_name,
          role: invitation.role,
        },
      };
    });
  }

  async login({ email, password, tenantId = null } = {}) {
    const normalizedEmail = normalizeEmail(email);
    const normalizedPassword = validatePassword(password, {
      enforceMinimum: false,
    });
    const values = [normalizedEmail];
    let tenantFilter = "";
    if (tenantId) {
      values.push(String(tenantId));
      tenantFilter = `AND t.id = $${values.length}`;
    }
    const result = await this.pool.query(
      `SELECT u.id AS user_id, u.email, u.display_name, u.password_hash,
              u.status AS user_status, m.tenant_id, m.role,
              t.name AS tenant_name, t.status AS tenant_status
       FROM users u
       JOIN memberships m ON m.user_id = u.id
       JOIN tenants t ON t.id = m.tenant_id
       WHERE lower(u.email) = $1
         ${tenantFilter}
       ORDER BY CASE m.role
         WHEN 'owner' THEN 4
         WHEN 'admin' THEN 3
         WHEN 'operator' THEN 2
         ELSE 1
       END DESC`,
      values,
    );
    const candidates = result.rows.filter(
      (row) =>
        row.user_status === "active" &&
        row.tenant_status === "active" &&
        row.password_hash,
    );
    let selected = null;
    for (const candidate of candidates) {
      if (await verifyWebPassword(normalizedPassword, candidate.password_hash)) {
        selected = candidate;
        break;
      }
    }
    if (!selected) {
      throw new WebAuthError(
        "INVALID_CREDENTIALS",
        "邮箱或密码错误",
        401,
      );
    }

    const token = generateWebSessionToken(this.randomBytes);
    const now = this.now();
    const expiresAt = new Date(now.getTime() + this.sessionTtlMs);
    const inserted = await this.pool.query(
      `INSERT INTO web_sessions (
        user_id, tenant_id, token_hash, expires_at, last_seen_at
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING id`,
      [
        selected.user_id,
        selected.tenant_id,
        sha256(token),
        expiresAt,
        now,
      ],
    );
    await this.pool.query(
      `INSERT INTO api_audit_logs (
        tenant_id, user_id, operation, method, path, status_code, metadata
      ) VALUES ($1, $2, 'web.login', 'POST', '/v1/web/login', 200, $3)`,
      [
        selected.tenant_id,
        selected.user_id,
        JSON.stringify({ sessionId: inserted.rows[0]?.id || null }),
      ],
    );
    return {
      token,
      expiresAt: expiresAt.toISOString(),
      tenant: {
        id: selected.tenant_id,
        name: selected.tenant_name,
      },
      user: {
        id: selected.user_id,
        email: selected.email,
        displayName: selected.display_name,
        role: selected.role,
      },
    };
  }

  async authenticate(token) {
    if (!token) {
      throw new WebAuthError("UNAUTHORIZED", "请先登录", 401);
    }
    const now = this.now();
    const result = await this.pool.query(
      `SELECT ws.id AS session_id, ws.expires_at,
              u.id AS user_id, u.email, u.display_name,
              u.status AS user_status,
              t.id AS tenant_id, t.name AS tenant_name,
              t.status AS tenant_status, m.role
       FROM web_sessions ws
       JOIN users u ON u.id = ws.user_id
       JOIN tenants t ON t.id = ws.tenant_id
       JOIN memberships m
         ON m.tenant_id = ws.tenant_id AND m.user_id = ws.user_id
       WHERE ws.token_hash = $1 AND ws.revoked_at IS NULL`,
      [sha256(token)],
    );
    const session = result.rows[0];
    if (
      !session ||
      session.user_status !== "active" ||
      session.tenant_status !== "active" ||
      new Date(session.expires_at) <= now
    ) {
      throw new WebAuthError(
        "UNAUTHORIZED",
        "登录已过期，请重新登录",
        401,
      );
    }
    await this.pool.query(
      `UPDATE web_sessions
       SET last_seen_at = $2
       WHERE id = $1
         AND (
           last_seen_at IS NULL
           OR last_seen_at < $2::timestamptz - interval '15 minutes'
         )`,
      [session.session_id, now],
    );
    return {
      sessionId: session.session_id,
      expiresAt: new Date(session.expires_at).toISOString(),
      tenantId: session.tenant_id,
      tenantName: session.tenant_name,
      userId: session.user_id,
      email: session.email,
      displayName: session.display_name,
      role: session.role,
    };
  }

  async revoke(token, context) {
    await this.pool.query(
      `UPDATE web_sessions
       SET revoked_at = now()
       WHERE id = $1 AND token_hash = $2 AND revoked_at IS NULL`,
      [context.sessionId, sha256(token)],
    );
    await this.pool.query(
      `INSERT INTO api_audit_logs (
        tenant_id, user_id, operation, method, path, status_code
      ) VALUES ($1, $2, 'web.logout', 'POST', '/v1/web/logout', 200)`,
      [context.tenantId, context.userId],
    );
  }

  async listStores(context) {
    const roleAllowsAll = ["owner", "admin"].includes(context.role);
    const values = roleAllowsAll
      ? [context.tenantId]
      : [context.tenantId, context.userId];
    const accessClause = roleAllowsAll
      ? ""
      : `AND EXISTS (
           SELECT 1
           FROM membership_store_access msa
           WHERE msa.tenant_id = s.tenant_id
             AND msa.user_id = $2
             AND msa.store_id = s.id
         )`;
    const result = await this.pool.query(
      `SELECT s.id, s.supplier_id, s.label, s.admin_label, s.business_mode,
              s.status, s.authorized_at, s.last_synced_at,
              s.authorized_by, au.email AS authorized_by_email,
              au.display_name AS authorized_by_name
       FROM stores s
       LEFT JOIN users au ON au.id = s.authorized_by
       WHERE s.tenant_id = $1
         ${accessClause}
       ORDER BY s.label ASC, s.created_at ASC`,
      values,
    );
    return result.rows.map((store) => ({
      id: store.id,
      supplierId: store.supplier_id,
      label: roleAllowsAll && String(store.admin_label || "").trim()
        ? store.admin_label
        : store.label,
      ...(roleAllowsAll
        ? {
            baseLabel: store.label,
            adminAlias: String(store.admin_label || "").trim() || null,
          }
        : {}),
      businessMode: store.business_mode,
      status: store.status,
      authorizedAt: store.authorized_at
        ? new Date(store.authorized_at).toISOString()
        : null,
      lastSyncedAt: store.last_synced_at
        ? new Date(store.last_synced_at).toISOString()
        : null,
      authorizedBy: roleAllowsAll && store.authorized_by
        ? {
            id: store.authorized_by,
            email: store.authorized_by_email,
            displayName: store.authorized_by_name,
          }
        : null,
    }));
  }

  async listMembers(context) {
    requireAdministrator(context);
    const [memberResult, accessResult, featureResult] = await Promise.all([
      this.pool.query(
        `SELECT u.id, u.email, u.display_name, u.admin_label, u.status,
                m.role, m.created_at
         FROM memberships m
         JOIN users u ON u.id = m.user_id
         WHERE m.tenant_id = $1
         ORDER BY CASE m.role
           WHEN 'owner' THEN 1
           WHEN 'admin' THEN 2
           WHEN 'operator' THEN 3
           ELSE 4
         END, u.display_name ASC, u.email ASC`,
        [context.tenantId],
      ),
      this.pool.query(
        `SELECT msa.user_id, s.id, s.label, s.admin_label, s.status
         FROM membership_store_access msa
         JOIN stores s
           ON s.id = msa.store_id AND s.tenant_id = msa.tenant_id
         WHERE msa.tenant_id = $1
         ORDER BY s.label ASC, s.created_at ASC`,
        [context.tenantId],
      ),
      this.pool.query(
        `SELECT user_id, feature_code
         FROM ai_feature_grants
         WHERE tenant_id = $1 AND enabled = true`,
        [context.tenantId],
      ),
    ]);
    const accessByUser = new Map();
    for (const row of accessResult.rows) {
      const stores = accessByUser.get(row.user_id) || [];
      stores.push({
        id: row.id,
        label: String(row.admin_label || "").trim() || row.label,
        status: row.status,
      });
      accessByUser.set(row.user_id, stores);
    }
    const featuresByUser = new Map();
    for (const row of featureResult.rows) {
      const features = featuresByUser.get(row.user_id) || new Set();
      features.add(row.feature_code);
      featuresByUser.set(row.user_id, features);
    }
    const members = memberResult.rows.map((row) => ({
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      adminAlias: String(row.admin_label || "").trim() || null,
      status: row.status,
      role: row.role,
      allStores: ["owner", "admin"].includes(row.role),
      stores: accessByUser.get(row.id) || [],
      features: {
        aiTitle: ["owner", "admin"].includes(row.role) ||
          featuresByUser.get(row.id)?.has("ai_title") === true,
      },
      joinedAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    }));
    return { members, count: members.length };
  }

  async updateMemberFeatureAccess(context, userId, feature, enabled) {
    requireAdministrator(context);
    const targetUserId = String(userId || "").trim();
    if (!UUID_PATTERN.test(targetUserId)) {
      throw new WebAuthError("INVALID_MEMBER", "成员ID无效", 400);
    }
    if (String(feature || "") !== "ai_title") {
      throw new WebAuthError("INVALID_FEATURE", "功能权限无效", 400);
    }
    const memberResult = await this.pool.query(
      `SELECT u.id, m.role
       FROM memberships m
       JOIN users u ON u.id = m.user_id
       WHERE m.tenant_id = $1 AND m.user_id = $2`,
      [context.tenantId, targetUserId],
    );
    const member = memberResult.rows[0];
    if (!member) throw new WebAuthError("MEMBER_NOT_FOUND", "成员不存在", 404);
    if (["owner", "admin"].includes(member.role)) {
      throw new WebAuthError("MEMBER_FEATURE_INHERITED", "管理员默认拥有AI标题功能，无需单独分配", 409);
    }
    if (enabled === true) {
      await this.pool.query(
        `INSERT INTO ai_feature_grants
           (tenant_id, user_id, feature_code, enabled, granted_by)
         VALUES ($1, $2, 'ai_title', true, $3)
         ON CONFLICT (tenant_id, user_id, feature_code)
         DO UPDATE SET enabled=true, granted_by=$3, updated_at=now()`,
        [context.tenantId, targetUserId, context.userId],
      );
    } else {
      await this.pool.query(
        `DELETE FROM ai_feature_grants
         WHERE tenant_id=$1 AND user_id=$2 AND feature_code='ai_title'`,
        [context.tenantId, targetUserId],
      );
    }
    await this.pool.query(
      `INSERT INTO api_audit_logs
         (tenant_id, user_id, operation, method, path, status_code, metadata)
       VALUES ($1, $2, 'web.member.feature_access.update', 'PUT',
               '/v1/web/admin/members/:userId/feature-access', 200, $3)`,
      [context.tenantId, context.userId, JSON.stringify({ targetUserId, feature, enabled: enabled === true })],
    );
    const result = await this.listMembers(context);
    return { member: result.members.find((item) => item.id === targetUserId) };
  }

  async updateMemberStoreAccess(context, userId, storeIds) {
    requireAdministrator(context);
    const targetUserId = String(userId || "").trim();
    if (!UUID_PATTERN.test(targetUserId)) {
      throw new WebAuthError("INVALID_MEMBER", "成员ID无效", 400);
    }
    const normalizedStoreIds = normalizeStoreIds(storeIds);
    return withTransaction(this.pool, async (client) => {
      const memberResult = await client.query(
        `SELECT u.id, u.email, u.display_name, u.admin_label, u.status,
                m.role, m.created_at
         FROM memberships m
         JOIN users u ON u.id = m.user_id
         WHERE m.tenant_id = $1 AND m.user_id = $2
         FOR UPDATE`,
        [context.tenantId, targetUserId],
      );
      const member = memberResult.rows[0];
      if (!member) {
        throw new WebAuthError("MEMBER_NOT_FOUND", "成员不存在", 404);
      }
      if (["owner", "admin"].includes(member.role)) {
        throw new WebAuthError(
          "MEMBER_INHERITS_ALL_STORES",
          "管理员默认拥有全部店铺，无需单独分配",
          409,
        );
      }

      let selectedStores = [];
      if (normalizedStoreIds.length) {
        const storeResult = await client.query(
          `SELECT id, label, status
           FROM stores
           WHERE tenant_id = $1
             AND status = 'active'
             AND id = ANY($2::uuid[])
           ORDER BY label ASC, created_at ASC`,
          [context.tenantId, normalizedStoreIds],
        );
        selectedStores = storeResult.rows;
        if (selectedStores.length !== normalizedStoreIds.length) {
          throw new WebAuthError(
            "STORE_ACCESS_INVALID",
            "部分店铺不存在、未授权或不属于当前工作空间",
            400,
          );
        }
      }

      await client.query(
        `DELETE FROM membership_store_access
         WHERE tenant_id = $1 AND user_id = $2`,
        [context.tenantId, targetUserId],
      );
      if (normalizedStoreIds.length) {
        await client.query(
          `INSERT INTO membership_store_access (
             tenant_id, user_id, store_id, granted_by
           )
           SELECT $1, $2, selected_store_id, $4
           FROM unnest($3::uuid[]) AS selected_store(selected_store_id)`,
          [
            context.tenantId,
            targetUserId,
            normalizedStoreIds,
            context.userId,
          ],
        );
      }
      await client.query(
        `INSERT INTO api_audit_logs (
           tenant_id, user_id, operation, method, path, status_code, metadata
         ) VALUES ($1, $2, 'web.member.store_access.update', 'PUT',
                   '/v1/web/admin/members/:userId/store-access', 200, $3)`,
        [
          context.tenantId,
          context.userId,
          JSON.stringify({
            targetUserId,
            storeIds: normalizedStoreIds,
            storeCount: normalizedStoreIds.length,
          }),
        ],
      );
      return {
        member: {
          id: member.id,
          email: member.email,
          displayName: member.display_name,
          adminAlias: String(member.admin_label || "").trim() || null,
          status: member.status,
          role: member.role,
          allStores: false,
          stores: selectedStores.map((store) => ({
            id: store.id,
            label: store.label,
            status: store.status,
          })),
          joinedAt: member.created_at
            ? new Date(member.created_at).toISOString()
            : null,
        },
      };
    });
  }

  async updateManagedMember(context, userId, input) {
    requireAdministrator(context);
    const targetUserId = String(userId || "").trim();
    if (!UUID_PATTERN.test(targetUserId)) {
      throw new WebAuthError("INVALID_MEMBER", "成员ID无效", 400);
    }
    const update = normalizeManagedMemberInput(input);
    return withTransaction(this.pool, async (client) => {
      const memberResult = await client.query(
        `SELECT u.id, u.email, u.display_name, u.admin_label, u.status,
                m.role, m.created_at
         FROM memberships m
         JOIN users u ON u.id = m.user_id
         WHERE m.tenant_id = $1 AND m.user_id = $2
         FOR UPDATE`,
        [context.tenantId, targetUserId],
      );
      const member = memberResult.rows[0];
      if (!member) {
        throw new WebAuthError("MEMBER_NOT_FOUND", "成员不存在", 404);
      }
      if (["owner", "admin"].includes(member.role)) {
        throw new WebAuthError(
          "PROTECTED_MEMBER",
          "管理员和所有者账号不能在此修改",
          409,
        );
      }

      const nextRole = update.role || member.role;
      const nextStatus = update.status || member.status;
      const changed = nextRole !== member.role || nextStatus !== member.status;
      if (changed) {
        if (nextRole !== member.role) {
          await client.query(
            `UPDATE memberships
             SET role = $3
             WHERE tenant_id = $1 AND user_id = $2`,
            [context.tenantId, targetUserId, nextRole],
          );
        }
        if (nextStatus !== member.status) {
          const membershipCountResult = await client.query(
            `SELECT count(*)::integer AS membership_count
             FROM memberships
             WHERE user_id = $1`,
            [targetUserId],
          );
          if (Number(membershipCountResult.rows[0]?.membership_count || 0) > 1) {
            throw new WebAuthError(
              "SHARED_USER_STATUS_UNSUPPORTED",
              "该账号属于多个工作空间，暂不能在此修改全局状态",
              409,
            );
          }
          await client.query(
            `UPDATE users
             SET status = $2, updated_at = now()
             WHERE id = $1`,
            [targetUserId, nextStatus],
          );
        }
        await client.query(
          `UPDATE web_sessions
           SET revoked_at = COALESCE(revoked_at, now())
           WHERE tenant_id = $1 AND user_id = $2 AND revoked_at IS NULL`,
          [context.tenantId, targetUserId],
        );
        await client.query(
          `INSERT INTO api_audit_logs (
             tenant_id, user_id, operation, method, path, status_code, metadata
           ) VALUES ($1, $2, 'web.member.profile.update', 'PATCH',
                     '/v1/web/admin/members/:userId', 200, $3)`,
          [
            context.tenantId,
            context.userId,
            JSON.stringify({
              targetUserId,
              previousRole: member.role,
              nextRole,
              previousStatus: member.status,
              nextStatus,
            }),
          ],
        );
      }

      const accessResult = await client.query(
        `SELECT s.id, s.label, s.status
         FROM membership_store_access msa
         JOIN stores s
           ON s.id = msa.store_id AND s.tenant_id = msa.tenant_id
         WHERE msa.tenant_id = $1 AND msa.user_id = $2
         ORDER BY s.label ASC, s.created_at ASC`,
        [context.tenantId, targetUserId],
      );
      return {
        member: {
          id: member.id,
          email: member.email,
          displayName: member.display_name,
          adminAlias: String(member.admin_label || "").trim() || null,
          status: nextStatus,
          role: nextRole,
          allStores: false,
          stores: accessResult.rows.map((store) => ({
            id: store.id,
            label: store.label,
            status: store.status,
          })),
          joinedAt: member.created_at
            ? new Date(member.created_at).toISOString()
            : null,
        },
      };
    });
  }

  async updateMemberAdminAlias(context, userId, alias) {
    requireAdministrator(context);
    const targetUserId = String(userId || "").trim();
    if (!UUID_PATTERN.test(targetUserId)) {
      throw new WebAuthError("INVALID_MEMBER", "成员ID无效", 400);
    }
    const normalizedAlias = normalizeAdminAlias(alias);
    return withTransaction(this.pool, async (client) => {
      const memberResult = await client.query(
        `SELECT u.id, u.email, u.display_name, u.admin_label, u.status,
                m.role, m.created_at
         FROM memberships m
         JOIN users u ON u.id = m.user_id
         WHERE m.tenant_id = $1 AND m.user_id = $2
         FOR UPDATE`,
        [context.tenantId, targetUserId],
      );
      const member = memberResult.rows[0];
      if (!member) {
        throw new WebAuthError("MEMBER_NOT_FOUND", "成员不存在", 404);
      }
      await client.query(
        `UPDATE users
         SET admin_label = $2, updated_at = now()
         WHERE id = $1`,
        [targetUserId, normalizedAlias],
      );
      await client.query(
        `INSERT INTO api_audit_logs (
           tenant_id, user_id, operation, method, path, status_code, metadata
         ) VALUES ($1, $2, 'web.member.admin_alias.update', 'PATCH',
                   '/v1/web/admin/members/:userId/alias', 200, $3)`,
        [
          context.tenantId,
          context.userId,
          JSON.stringify({ targetUserId, hasAlias: Boolean(normalizedAlias) }),
        ],
      );
      const accessResult = await client.query(
        `SELECT s.id, s.label, s.admin_label, s.status
         FROM membership_store_access msa
         JOIN stores s
           ON s.id = msa.store_id AND s.tenant_id = msa.tenant_id
         WHERE msa.tenant_id = $1 AND msa.user_id = $2
         ORDER BY s.label ASC, s.created_at ASC`,
        [context.tenantId, targetUserId],
      );
      return {
        member: {
          id: member.id,
          email: member.email,
          displayName: member.display_name,
          adminAlias: normalizedAlias || null,
          status: member.status,
          role: member.role,
          allStores: ["owner", "admin"].includes(member.role),
          stores: accessResult.rows.map((store) => ({
            id: store.id,
            label: String(store.admin_label || "").trim() || store.label,
            status: store.status,
          })),
          joinedAt: member.created_at
            ? new Date(member.created_at).toISOString()
            : null,
        },
      };
    });
  }

  async requireStoreAccess(context, storeId) {
    const roleAllowsAll = ["owner", "admin"].includes(context.role);
    const values = roleAllowsAll
      ? [context.tenantId, String(storeId)]
      : [context.tenantId, String(storeId), context.userId];
    const accessClause = roleAllowsAll
      ? ""
      : `AND EXISTS (
           SELECT 1
           FROM membership_store_access msa
           WHERE msa.tenant_id = s.tenant_id
             AND msa.store_id = s.id
             AND msa.user_id = $3
         )`;
    const result = await this.pool.query(
      `SELECT s.id, s.tenant_id, s.supplier_id, s.label,
              s.business_mode, s.status
       FROM stores s
       WHERE s.tenant_id = $1
         AND s.id = $2
         ${accessClause}`,
      values,
    );
    const store = result.rows[0];
    if (!store) {
      throw new WebAuthError(
        "STORE_FORBIDDEN",
        "当前账号无权访问该店铺",
        403,
      );
    }
    if (store.status !== "active") {
      throw new WebAuthError(
        "STORE_UNAVAILABLE",
        "店铺当前不可用，请先完成重新授权",
        409,
      );
    }
    return {
      id: store.id,
      tenantId: store.tenant_id,
      supplierId: store.supplier_id,
      label: store.label,
      businessMode: store.business_mode,
      status: store.status,
    };
  }

  async renameStore(context, storeId, label) {
    await this.requireStoreAccess(context, storeId);
    const adminView = ["owner", "admin"].includes(context.role);
    const normalized = String(label || "").trim().replace(/\s+/g, " ");
    if ((!adminView && !normalized) || normalized.length > 40) {
      throw new WebAuthError(
        "INVALID_STORE_LABEL",
        adminView ? "管理员店铺别名不能超过40个字符" : "店铺名称需为1至40个字符",
        400,
      );
    }
    const result = await this.pool.query(
      adminView
        ? `UPDATE stores
           SET admin_label = $3, updated_at = now()
           WHERE tenant_id = $1 AND id = $2
           RETURNING id, supplier_id, label, admin_label, business_mode, status`
        : `UPDATE stores
           SET label = $3, updated_at = now()
           WHERE tenant_id = $1 AND id = $2
           RETURNING id, supplier_id, label, admin_label, business_mode, status`,
      [context.tenantId, String(storeId), normalized],
    );
    if (!result.rowCount) {
      throw new WebAuthError("STORE_NOT_FOUND", "店铺不存在", 404);
    }
    const store = result.rows[0];
    return {
      id: store.id,
      supplierId: store.supplier_id,
      label: adminView && String(store.admin_label || "").trim()
        ? store.admin_label
        : store.label,
      ...(adminView
        ? {
            baseLabel: store.label,
            adminAlias: String(store.admin_label || "").trim() || null,
          }
        : {}),
      businessMode: store.business_mode,
      status: store.status,
    };
  }

  async revokeStoreAuthorization(context, storeId) {
    requireAdministrator(context);
    const normalizedStoreId = String(storeId || "").trim();
    if (!UUID_PATTERN.test(normalizedStoreId)) {
      throw new WebAuthError("STORE_NOT_FOUND", "店铺不存在", 404);
    }
    return withTransaction(this.pool, async (client) => {
      const storeResult = await client.query(
        `SELECT id, tenant_id, supplier_id, label, business_mode,
                status, authorized_at, last_synced_at
         FROM stores
         WHERE tenant_id = $1 AND id = $2
         FOR UPDATE`,
        [context.tenantId, normalizedStoreId],
      );
      const store = storeResult.rows[0];
      if (!store) {
        throw new WebAuthError("STORE_NOT_FOUND", "店铺不存在", 404);
      }
      const [executionResult, jobResult] = await Promise.all([
        client.query(
          `SELECT 1
           FROM publish_execution_runs
           WHERE tenant_id = $1 AND store_id = $2
             AND state = 'running'
           LIMIT 1`,
          [context.tenantId, normalizedStoreId],
        ),
        client.query(
          `SELECT 1
           FROM publish_jobs
           WHERE tenant_id = $1 AND store_id = $2
             AND state IN ('claimed', 'submitted')
           LIMIT 1`,
          [context.tenantId, normalizedStoreId],
        ),
      ]);
      if (executionResult.rows.length || jobResult.rows.length) {
        throw new WebAuthError(
          "STORE_PUBLISH_IN_PROGRESS",
          "该店铺有正在执行的商品发布任务，请完成或暂停后再删除授权",
          409,
        );
      }

      await client.query(
        `UPDATE stores
         SET status = 'disabled', supplier_id = NULL,
             authorized_at = NULL, updated_at = now()
         WHERE tenant_id = $1 AND id = $2`,
        [context.tenantId, normalizedStoreId],
      );
      await client.query(
        `DELETE FROM store_credentials WHERE store_id = $1`,
        [normalizedStoreId],
      );
      await client.query(
        `DELETE FROM membership_store_access
         WHERE tenant_id = $1 AND store_id = $2`,
        [context.tenantId, normalizedStoreId],
      );
      await client.query(
        `INSERT INTO api_audit_logs (
          tenant_id, store_id, user_id, operation, method, path,
          status_code, metadata
        ) VALUES ($1, $2, $3, 'web.store.authorization.revoke', 'DELETE',
                  '/v1/web/stores/:storeId', 200, $4)`,
        [
          context.tenantId,
          normalizedStoreId,
          context.userId,
          JSON.stringify({
            label: store.label,
            previousStatus: store.status,
            credentialsCleared: true,
            historyRetained: true,
          }),
        ],
      );

      return {
        id: store.id,
        supplierId: null,
        label: store.label,
        businessMode: store.business_mode,
        status: "disabled",
        authorizedAt: null,
        lastSyncedAt: store.last_synced_at
          ? new Date(store.last_synced_at).toISOString()
          : null,
        authorizationRevoked: true,
      };
    });
  }
}
