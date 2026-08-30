import http from "node:http";
import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { pathToFileURL } from "node:url";
import Redis from "ioredis";
import { loadConfig } from "../config.js";
import {
  createFixedWindowRateLimiter,
  DeviceAuthError,
  parseBearerToken,
  PostgresDeviceAuthService,
} from "./device-auth.js";
import { CloudCredentialCipher } from "./credential-cipher.js";
import { createPostgresPool } from "./postgres.js";
import {
  SheinAuthorizationError,
  SheinDeviceAuthorizationService,
} from "./shein-device-authorization.js";
import {
  WebSheinAuthorizationError,
  WebSheinAuthorizationService,
} from "./web-shein-authorization.js";
import { PostgresStoreRepository } from "./store-repository.js";
import { PostgresWebhookAuditRepository } from "./webhook-audit-repository.js";
import {
  DiagnosticEventError,
  PostgresDiagnosticEventRepository,
} from "./diagnostic-events.js";
import {
  parseCookieHeader,
  PostgresWebAuthService,
  serializeWebSessionCookie,
  WebAuthError,
} from "./web-auth.js";
import { ResendWebEmailService, SmtpWebEmailService } from "./web-email.js";
import { SheinWebReadService } from "./web-business-service.js";
import { PostgresRuleSnapshotRepository } from "./rule-snapshot-service.js";
import {
  PostgresRuleRefreshRepository,
  WebRuleRefreshService,
} from "./rule-refresh-service.js";
import {
  PostgresComplianceSyncRepository,
  WebComplianceSyncService,
} from "./compliance-sync-service.js";
import {
  MediaServiceError,
  PostgresMediaRepository,
  WebMediaService,
} from "./media-service.js";
import { S3ObjectStorage } from "./s3-object-storage.js";
import {
  PostgresStoreBusinessRepository,
  WebStoreBusinessService,
} from "./store-business-service.js";
import {
  PostgresSyncJobRepository,
  WebSyncJobService,
} from "./sync-job-service.js";
import {
  BullMqJobQueue,
  COMPLIANCE_SYNC_QUEUE_NAME,
  RULE_REFRESH_QUEUE_NAME,
  STORE_BUSINESS_REFRESH_QUEUE_NAME,
} from "./job-queue.js";
import {
  ComplianceWorkspaceError,
  PostgresComplianceWorkspaceRepository,
  WebComplianceWorkspaceService,
} from "./compliance-workspace-service.js";
import { WebComplianceWriteService } from "./compliance-write-service.js";
import {
  PostgresProductDraftRepository,
  ProductDraftError,
  WebProductDraftService,
} from "./product-draft-service.js";
import { WebWorkspaceUsageService } from "./workspace-usage-service.js";
import { WebTodayWorkService } from "./today-work-service.js";
import {
  AiTitleError,
  PostgresAiTitleRepository,
  PostgresAiTitleSettingsRepository,
  WebAiTitleService,
} from "./ai-title-service.js";
import {
  PostgresPublishBatchRepository,
  PublishBatchError,
  WebPublishBatchService,
} from "./publish-batch-service.js";
import { PostgresPublishExecutionRepository } from "./publish-execution-repository.js";
import { runProductRemotePreflight } from "./product-remote-preflight.js";
import {
  PostgresPublishTemplateRepository,
  PublishTemplateError,
  WebPublishTemplateService,
} from "./publish-template-service.js";
import {
  PostgresProductReviewRepository,
  WebProductReviewService,
} from "./product-review-service.js";
import { WebReviewCenterSnapshotService } from "./review-center-snapshot-service.js";

const SERVICE_NAME = "shein-cloud-control";
// POST /v1/web/stores/:storeId/compliance-workspace/batch-drafts
const AUTH_PATHS = new Set([
  "/v1/auth/enroll",
  "/v1/auth/logout",
  "/v1/session",
  "/v1/shein/auth/start",
  "/v1/shein/auth/complete",
  "/v1/webhook-audits",
  "/v1/web/login",
  "/v1/web/register",
  "/v1/web/password-reset/request",
  "/v1/web/password-reset/confirm",
  "/v1/web/logout",
  "/v1/web/session",
  "/v1/web/diagnostics/events",
  "/v1/internal/diagnostics/events",
  "/v1/web/stores",
  "/v1/web/shein/auth/start",
  "/v1/web/shein/auth/callback",
]);

function sendJson(response, status, payload, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json;charset=UTF-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  response.end(JSON.stringify(payload));
}

function sendImage(response, { fileBytes, mimeType, headers: imageHeaders = {} } = {}, headers = {}) {
  const body = Buffer.isBuffer(fileBytes) ? fileBytes : Buffer.from(fileBytes || "");
  response.writeHead(200, {
    "Content-Type": String(mimeType || "image/jpeg"),
    "Content-Length": String(body.length),
    // Asset IDs are immutable: replacing an uploaded image creates a new ID.
    // Keep persisted previews in the browser cache across page switches while
    // retaining private, authenticated semantics for tenant-scoped media.
    "Cache-Control": "private, max-age=86400, stale-while-revalidate=3600",
    "X-Content-Type-Options": "nosniff",
    ...imageHeaders,
    ...headers,
  });
  response.end(body);
}

function sendRedirect(response, location) {
  response.writeHead(303, {
    Location: location,
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  response.end();
}

function getCorsHeaders(request, allowedOrigins) {
  const origin = request.headers.origin;
  if (!origin || !allowedOrigins.includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Expose-Headers": "X-Trace-Id",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

async function readJsonBody(request, maxBytes = 16 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) {
      throw new DeviceAuthError(
        "PAYLOAD_TOO_LARGE",
        `请求内容不能超过${Math.ceil(maxBytes / 1024)}KB`,
        413,
      );
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new DeviceAuthError("INVALID_JSON", "请求JSON格式无效", 400);
  }
}

function getClientKey(request) {
  const forwardedAddress = request.headers["x-real-ip"];
  if (
    typeof forwardedAddress === "string" &&
    isIP(forwardedAddress.trim())
  ) {
    return forwardedAddress.trim();
  }
  return request.socket?.remoteAddress || "unknown";
}

function getWebSessionToken(request, cookieName) {
  return parseCookieHeader(request.headers.cookie || "")[cookieName] || null;
}

function requireTrustedWebOrigin(request, allowedOrigins) {
  const origin = request.headers.origin;
  if (!origin) return;
  if (!allowedOrigins.includes(origin)) {
    throw new WebAuthError(
      "ORIGIN_NOT_ALLOWED",
      "当前网页来源未获授权",
      403,
    );
  }
}

function requireAdministrator(context) {
  if (["owner", "admin"].includes(context?.role)) return;
  throw new WebAuthError(
    "ADMIN_REQUIRED",
    "仅管理员可以同步 SHEIN 类目和商品属性",
    403,
  );
}

export function createCloudControlRequestHandler({
  readiness,
  deviceAuth = null,
  webAuth = null,
  webBusiness = null,
  webMedia = null,
  webStoreBusiness = null,
  webRuleRefresh = null,
  webComplianceSync = null,
  webSyncJobs = null,
  webComplianceWorkspace = null,
  webComplianceWrites = null,
  webProductDrafts = null,
  webWorkspaceUsage = null,
  webPublishBatches = null,
  webProductReviews = null,
  webReviewCenterSnapshot = null,
  webPublishTemplates = null,
  webTodayWork = null,
  webAiTitle = null,
  sheinAuthorization = null,
  webSheinAuthorization = null,
  webhookAudits = null,
  diagnosticEvents = null,
  enrollmentLimiter = createFixedWindowRateLimiter(),
  authorizationLimiter = createFixedWindowRateLimiter({
    limit: 20,
    windowMs: 15 * 60 * 1000,
  }),
  webLoginLimiter = createFixedWindowRateLimiter({
    limit: 10,
    windowMs: 15 * 60 * 1000,
  }),
  webPasswordResetLimiter = createFixedWindowRateLimiter({
    limit: 5,
    windowMs: 15 * 60 * 60 * 1000,
  }),
  webRegistrationTenantId = "",
  allowedOrigins = [],
  webCookieName = "shein_web_session",
  webCookieSecure = false,
  webSheinModulesEnabled = true,
  webAppBaseUrl = "https://app.hanzhou.icu",
}) {
  return async (request, response) => {
    const url = new URL(
      request.url,
      `http://${request.headers.host || "127.0.0.1"}`,
    );
    const corsHeaders = getCorsHeaders(request, allowedOrigins);
    const startedAt = process.hrtime.bigint();
    const suppliedTraceId = String(request.headers["x-request-id"] || "").trim();
    const traceId = /^[A-Za-z0-9._:-]{1,128}$/.test(suppliedTraceId)
      ? suppliedTraceId
      : randomUUID();
    let requestErrorCode = null;
    response.setHeader("X-Trace-Id", traceId);

    try {
      if (
        request.method === "OPTIONS" &&
        (AUTH_PATHS.has(url.pathname) || url.pathname.startsWith("/v1/web/"))
      ) {
        if (
          request.headers.origin &&
          !allowedOrigins.includes(request.headers.origin)
        ) {
          return sendJson(response, 403, {
            code: "ORIGIN_NOT_ALLOWED",
            msg: "当前网页来源未获授权",
          });
        }
        response.writeHead(204, corsHeaders);
        return response.end();
      }

      if (request.method === "GET" && url.pathname === "/health") {
        return sendJson(
          response,
          200,
          {
            ok: true,
            service: SERVICE_NAME,
          },
          corsHeaders,
        );
      }

      if (request.method === "GET" && url.pathname === "/ready") {
        const status = await readiness.check();
        return sendJson(
          response,
          status.ok ? 200 : 503,
          {
            ok: status.ok,
            service: SERVICE_NAME,
            dependencies: status.dependencies,
          },
          corsHeaders,
        );
      }

      // Diagnostic events are intentionally API-only. There is no navigation
      // entry for them in the normal web UI; the endpoint accepts only bounded,
      // already-redacted event descriptors from an authenticated session.
      if (
        request.method === "POST" &&
        url.pathname === "/v1/web/diagnostics/events"
      ) {
        if (!webAuth || !diagnosticEvents) {
          throw new WebAuthError(
            "SERVICE_UNAVAILABLE",
            "诊断日志服务尚未启用",
            503,
          );
        }
        requireTrustedWebOrigin(request, allowedOrigins);
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        const body = await readJsonBody(request, 64 * 1024);
        const result = await diagnosticEvents.recordClientEvents({
          context,
          events: body.events,
        });
        return sendJson(response, 202, { ok: true, ...result }, corsHeaders);
      }

      if (
        request.method === "GET" &&
        url.pathname === "/v1/internal/diagnostics/events"
      ) {
        if (!webAuth || !diagnosticEvents) {
          throw new WebAuthError(
            "SERVICE_UNAVAILABLE",
            "诊断日志服务尚未启用",
            503,
          );
        }
        requireTrustedWebOrigin(request, allowedOrigins);
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        requireAdministrator(context);
        const result = await diagnosticEvents.list({
          tenantId: context.tenantId,
          limit: url.searchParams.get("limit") || 50,
        });
        return sendJson(response, 200, result, corsHeaders);
      }

      if (request.method === "POST" && url.pathname === "/v1/web/login") {
        if (!webAuth) {
          throw new WebAuthError(
            "SERVICE_UNAVAILABLE",
            "网页登录服务尚未启用",
            503,
          );
        }
        requireTrustedWebOrigin(request, allowedOrigins);
        const rateLimit = webLoginLimiter.consume(getClientKey(request));
        if (!rateLimit.allowed) {
          return sendJson(
            response,
            429,
            {
              code: "RATE_LIMITED",
              msg: "登录尝试过于频繁，请稍后再试",
            },
            {
              ...corsHeaders,
              "Retry-After": String(rateLimit.retryAfterSeconds),
            },
          );
        }
        const session = await webAuth.login(await readJsonBody(request));
        const maxAgeSeconds = Math.max(
          0,
          Math.floor(
            (new Date(session.expiresAt).getTime() - Date.now()) / 1000,
          ),
        );
        return sendJson(
          response,
          200,
          {
            authenticated: true,
            tenant: session.tenant,
            user: session.user,
            expiresAt: session.expiresAt,
          },
          {
            ...corsHeaders,
            "Set-Cookie": serializeWebSessionCookie({
              name: webCookieName,
              token: session.token,
              maxAgeSeconds,
              secure: webCookieSecure,
            }),
          },
        );
      }

      if (request.method === "POST" && url.pathname === "/v1/web/register") {
        if (!webAuth) {
          throw new WebAuthError(
            "SERVICE_UNAVAILABLE",
            "网页登录服务尚未启用",
            503,
          );
        }
        requireTrustedWebOrigin(request, allowedOrigins);
        const rateLimit = webLoginLimiter.consume(getClientKey(request));
        if (!rateLimit.allowed) {
          return sendJson(
            response,
            429,
            { code: "RATE_LIMITED", msg: "操作过于频繁，请稍后再试" },
            { ...corsHeaders, "Retry-After": String(rateLimit.retryAfterSeconds) },
          );
        }
        const input = await readJsonBody(request);
        const tenant = await webAuth.resolvePublicRegistrationTenant(
          webRegistrationTenantId,
        );
        const result = await webAuth.register({ ...input, tenantId: tenant.id });
        return sendJson(response, 201, result, corsHeaders);
      }

      if (
        request.method === "POST" &&
        url.pathname === "/v1/web/password-reset/request"
      ) {
        if (!webAuth) {
          throw new WebAuthError(
            "SERVICE_UNAVAILABLE",
            "网页登录服务尚未启用",
            503,
          );
        }
        requireTrustedWebOrigin(request, allowedOrigins);
        const rateLimit = webPasswordResetLimiter.consume(getClientKey(request));
        if (!rateLimit.allowed) {
          return sendJson(
            response,
            429,
            { code: "RATE_LIMITED", msg: "请求过于频繁，请稍后再试" },
            { ...corsHeaders, "Retry-After": String(rateLimit.retryAfterSeconds) },
          );
        }
        const result = await webAuth.requestPasswordReset(await readJsonBody(request));
        return sendJson(response, 202, result, corsHeaders);
      }

      if (
        request.method === "POST" &&
        url.pathname === "/v1/web/password-reset/confirm"
      ) {
        if (!webAuth) {
          throw new WebAuthError(
            "SERVICE_UNAVAILABLE",
            "网页登录服务尚未启用",
            503,
          );
        }
        requireTrustedWebOrigin(request, allowedOrigins);
        const rateLimit = webPasswordResetLimiter.consume(getClientKey(request));
        if (!rateLimit.allowed) {
          return sendJson(
            response,
            429,
            { code: "RATE_LIMITED", msg: "请求过于频繁，请稍后再试" },
            { ...corsHeaders, "Retry-After": String(rateLimit.retryAfterSeconds) },
          );
        }
        const input = await readJsonBody(request);
        const result = await webAuth.resetPassword(input.token, input.password);
        return sendJson(response, 200, result, corsHeaders);
      }

      if (request.method === "GET" && url.pathname === "/v1/web/session") {
        if (!webAuth) {
          throw new WebAuthError(
            "SERVICE_UNAVAILABLE",
            "网页登录服务尚未启用",
            503,
          );
        }
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        return sendJson(
          response,
          200,
          {
            authenticated: true,
            tenant: {
              id: context.tenantId,
              name: context.tenantName,
            },
            user: {
              id: context.userId,
              email: context.email,
              displayName: context.displayName,
              role: context.role,
            },
            expiresAt: context.expiresAt,
          },
          corsHeaders,
        );
      }

      if (request.method === "GET" && url.pathname === "/v1/web/admin/members") {
        if (!webAuth) {
          throw new WebAuthError(
            "SERVICE_UNAVAILABLE",
            "成员权限服务尚未启用",
            503,
          );
        }
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        return sendJson(
          response,
          200,
          await webAuth.listMembers(context),
          corsHeaders,
        );
      }

      if (request.method === "POST" && url.pathname === "/v1/web/admin/invitations") {
        requireTrustedWebOrigin(request, allowedOrigins);
        if (!webAuth) {
          throw new WebAuthError("SERVICE_UNAVAILABLE", "成员邀请服务尚未启用", 503);
        }
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        const result = await webAuth.createMemberInvitation(
          context,
          await readJsonBody(request, 16 * 1024),
        );
        return sendJson(response, 201, result, corsHeaders);
      }

      const webInvitationAcceptMatch = url.pathname.match(
        /^\/v1\/web\/invitations\/([^/]+)\/accept$/,
      );
      if (request.method === "POST" && webInvitationAcceptMatch) {
        requireTrustedWebOrigin(request, allowedOrigins);
        if (!webAuth) {
          throw new WebAuthError("SERVICE_UNAVAILABLE", "成员邀请服务尚未启用", 503);
        }
        const input = await readJsonBody(request, 2048);
        const result = await webAuth.acceptMemberInvitation(
          decodeURIComponent(webInvitationAcceptMatch[1]),
          input.password,
        );
        return sendJson(response, 200, result, corsHeaders);
      }

      const webInvitationMatch = url.pathname.match(
        /^\/v1\/web\/invitations\/([^/]+)$/,
      );
      if (request.method === "GET" && webInvitationMatch) {
        if (!webAuth) {
          throw new WebAuthError("SERVICE_UNAVAILABLE", "成员邀请服务尚未启用", 503);
        }
        const result = await webAuth.getMemberInvitation(
          decodeURIComponent(webInvitationMatch[1]),
        );
        return sendJson(response, 200, result, corsHeaders);
      }

      const webManagedMemberMatch = url.pathname.match(
        /^\/v1\/web\/admin\/members\/([^/]+)$/,
      );
      if (request.method === "PATCH" && webManagedMemberMatch) {
        requireTrustedWebOrigin(request, allowedOrigins);
        if (!webAuth) {
          throw new WebAuthError(
            "SERVICE_UNAVAILABLE",
            "成员权限服务尚未启用",
            503,
          );
        }
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        const userId = decodeURIComponent(webManagedMemberMatch[1]);
        const result = await webAuth.updateManagedMember(
          context,
          userId,
          await readJsonBody(request, 2048),
        );
        return sendJson(response, 200, result, corsHeaders);
      }

      const webMemberAliasMatch = url.pathname.match(
        /^\/v1\/web\/admin\/members\/([^/]+)\/alias$/,
      );
      if (request.method === "PATCH" && webMemberAliasMatch) {
        requireTrustedWebOrigin(request, allowedOrigins);
        if (!webAuth) {
          throw new WebAuthError(
            "SERVICE_UNAVAILABLE",
            "成员权限服务尚未启用",
            503,
          );
        }
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        const userId = decodeURIComponent(webMemberAliasMatch[1]);
        const input = await readJsonBody(request, 2048);
        const result = await webAuth.updateMemberAdminAlias(
          context,
          userId,
          input.alias,
        );
        return sendJson(response, 200, result, corsHeaders);
      }

      const webMemberStoreAccessMatch = url.pathname.match(
        /^\/v1\/web\/admin\/members\/([^/]+)\/store-access$/,
      );
      if (request.method === "PUT" && webMemberStoreAccessMatch) {
        requireTrustedWebOrigin(request, allowedOrigins);
        if (!webAuth) {
          throw new WebAuthError(
            "SERVICE_UNAVAILABLE",
            "成员权限服务尚未启用",
            503,
          );
        }
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        const userId = decodeURIComponent(webMemberStoreAccessMatch[1]);
        const input = await readJsonBody(request, 16 * 1024);
        const result = await webAuth.updateMemberStoreAccess(
          context,
          userId,
          input.storeIds,
        );
        return sendJson(response, 200, result, corsHeaders);
      }

      const webMemberFeatureAccessMatch = url.pathname.match(
        /^\/v1\/web\/admin\/members\/([^/]+)\/feature-access$/,
      );
      if (request.method === "PUT" && webMemberFeatureAccessMatch) {
        requireTrustedWebOrigin(request, allowedOrigins);
        if (!webAuth) {
          throw new WebAuthError("SERVICE_UNAVAILABLE", "成员权限服务尚未启用", 503);
        }
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        const userId = decodeURIComponent(webMemberFeatureAccessMatch[1]);
        const input = await readJsonBody(request, 8 * 1024);
        return sendJson(
          response,
          200,
          await webAuth.updateMemberFeatureAccess(
            context,
            userId,
            input.feature,
            input.enabled,
          ),
          corsHeaders,
        );
      }

      if (request.method === "GET" && url.pathname === "/v1/web/stores") {
        if (!webAuth) {
          throw new WebAuthError(
            "SERVICE_UNAVAILABLE",
            "网页店铺服务尚未启用",
            503,
          );
        }
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        const stores = await webAuth.listStores(context);
        return sendJson(
          response,
          200,
          {
            stores,
            count: stores.length,
            generatedAt: new Date().toISOString(),
          },
          corsHeaders,
        );
      }

      const webStoreRenameMatch = url.pathname.match(
        /^\/v1\/web\/stores\/([^/]+)$/,
      );
      if (request.method === "DELETE" && webStoreRenameMatch) {
        requireTrustedWebOrigin(request, allowedOrigins);
        if (!webAuth) {
          throw new WebAuthError(
            "SERVICE_UNAVAILABLE",
            "网页店铺服务尚未启用",
            503,
          );
        }
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        const storeId = decodeURIComponent(webStoreRenameMatch[1]);
        await readJsonBody(request, 2048);
        const store = await webAuth.revokeStoreAuthorization(context, storeId);
        return sendJson(response, 200, { store }, corsHeaders);
      }
      if (request.method === "PATCH" && webStoreRenameMatch) {
        requireTrustedWebOrigin(request, allowedOrigins);
        if (!webAuth) {
          throw new WebAuthError(
            "SERVICE_UNAVAILABLE",
            "网页店铺服务尚未启用",
            503,
          );
        }
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        const storeId = decodeURIComponent(webStoreRenameMatch[1]);
        const input = await readJsonBody(request, 2048);
        const store = await webAuth.renameStore(context, storeId, input.label);
        return sendJson(response, 200, { store }, corsHeaders);
      }

      const webStoreBusinessMatch = url.pathname.match(
        /^\/v1\/web\/stores\/([^/]+)\/business-dashboard$/,
      );
      if (
        webStoreBusinessMatch &&
        ["GET", "POST"].includes(request.method)
      ) {
        if (!webAuth || !webStoreBusiness) {
          throw new WebAuthError(
            "SERVICE_UNAVAILABLE",
            "店铺经营数据服务尚未启用",
            503,
          );
        }
        if (request.method === "POST") {
          requireTrustedWebOrigin(request, allowedOrigins);
        }
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        const storeId = decodeURIComponent(webStoreBusinessMatch[1]);
        await webAuth.requireStoreAccess(context, storeId);
        let refresh = null;
        if (request.method === "POST") {
          refresh = await webStoreBusiness.startRefresh({ context, storeId });
        }
        const result = await webStoreBusiness.getDashboard({
          context,
          storeId,
          // SRF-01: a browser GET only reads the persisted projection. A
          // refresh is an explicit POST and must never be hidden in a page
          // load or an arbitrary query parameter.
          refreshIfEmpty: false,
        });
        const payload = {
          ...result,
          ...(refresh?.job ? { refreshJob: refresh.job } : {}),
          ...(refresh?.refreshControl ? { refreshControl: refresh.refreshControl } : {}),
        };
        return sendJson(response, 200, payload, corsHeaders);
      }

      const webSyncJobMatch = url.pathname.match(
        /^\/v1\/web\/stores\/([^/]+)\/sync-jobs(?:\/([^/]+))?$/,
      );
      if (request.method === "GET" && webSyncJobMatch) {
        if (!webAuth || !webSyncJobs) {
          throw new WebAuthError(
            "SERVICE_UNAVAILABLE",
            "同步任务查询服务尚未启用",
            503,
          );
        }
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        const storeId = decodeURIComponent(webSyncJobMatch[1]);
        await webAuth.requireStoreAccess(context, storeId);
        const jobId = webSyncJobMatch[2]
          ? decodeURIComponent(webSyncJobMatch[2])
          : null;
        if (jobId) {
          return sendJson(
            response,
            200,
            await webSyncJobs.get({ context, storeId, jobId }),
            corsHeaders,
          );
        }
        return sendJson(
          response,
          200,
          await webSyncJobs.list({
            context,
            storeId,
            filters: {
              state: url.searchParams.get("state"),
              jobType: url.searchParams.get("jobType"),
              limit: url.searchParams.get("limit"),
            },
          }),
          corsHeaders,
        );
      }

      const webRuleRefreshMatch = url.pathname.match(
        /^\/v1\/web\/stores\/([^/]+)\/rules\/refresh$/,
      );
      if (request.method === "POST" && webRuleRefreshMatch) {
        requireTrustedWebOrigin(request, allowedOrigins);
        if (!webAuth || !webRuleRefresh) {
          throw new WebAuthError("SERVICE_UNAVAILABLE", "规则刷新服务尚未启用", 503);
        }
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        const storeId = decodeURIComponent(webRuleRefreshMatch[1]);
        await webAuth.requireStoreAccess(context, storeId);
        requireAdministrator(context);
        return sendJson(
          response,
          202,
          await webRuleRefresh.startRefresh({ context, storeId }),
          corsHeaders,
        );
      }

      const webRuleRefreshRetryMatch = url.pathname.match(
        /^\/v1\/web\/stores\/([^/]+)\/rules\/refresh\/retry$/,
      );
      if (request.method === "POST" && webRuleRefreshRetryMatch) {
        requireTrustedWebOrigin(request, allowedOrigins);
        if (!webAuth || !webRuleRefresh) {
          throw new WebAuthError("SERVICE_UNAVAILABLE", "规则刷新服务尚未启用", 503);
        }
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        const storeId = decodeURIComponent(webRuleRefreshRetryMatch[1]);
        await webAuth.requireStoreAccess(context, storeId);
        requireAdministrator(context);
        const input = await readJsonBody(request, 4 * 1024);
        return sendJson(
          response,
          202,
          await webRuleRefresh.startRefresh({
            context,
            storeId,
            retryJobId: input?.jobId,
          }),
          corsHeaders,
        );
      }

      const webPublishSchemaSyncMatch = url.pathname.match(
        /^\/v1\/web\/stores\/([^/]+)\/publish\/schema-sync$/,
      );
      if (request.method === "POST" && webPublishSchemaSyncMatch) {
        requireTrustedWebOrigin(request, allowedOrigins);
        if (!webAuth || !webRuleRefresh) {
          throw new WebAuthError("SERVICE_UNAVAILABLE", "规则刷新服务尚未启用", 503);
        }
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        const storeId = decodeURIComponent(webPublishSchemaSyncMatch[1]);
        await webAuth.requireStoreAccess(context, storeId);
        requireAdministrator(context);
        return sendJson(
          response,
          202,
          await webRuleRefresh.startRefresh({
            context,
            storeId,
            scope: "all",
          }),
          corsHeaders,
        );
      }

      const webComplianceRefreshMatch = url.pathname.match(
        /^\/v1\/web\/stores\/([^/]+)\/compliance\/refresh$/,
      );
      if (request.method === "POST" && webComplianceRefreshMatch) {
        requireTrustedWebOrigin(request, allowedOrigins);
        if (!webAuth || !webComplianceSync) {
          throw new WebAuthError("SERVICE_UNAVAILABLE", "合规同步服务尚未启用", 503);
        }
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        const storeId = decodeURIComponent(webComplianceRefreshMatch[1]);
        await webAuth.requireStoreAccess(context, storeId);
        return sendJson(
          response,
          202,
          await webComplianceSync.startSync({ context, storeId }),
          corsHeaders,
        );
      }

      if (
        request.method === "POST" &&
        url.pathname === "/v1/web/shein/auth/start"
      ) {
        requireTrustedWebOrigin(request, allowedOrigins);
        if (!webAuth || !webSheinAuthorization) {
          throw new WebAuthError(
            "SHEIN_AUTHORIZATION_UNAVAILABLE",
            "SHEIN网页授权服务尚未配置",
            503,
          );
        }
        const rateLimit = authorizationLimiter.consume(
          `web-start:${getClientKey(request)}`,
        );
        if (!rateLimit.allowed) {
          return sendJson(
            response,
            429,
            { code: "RATE_LIMITED", msg: "SHEIN授权尝试过于频繁，请稍后再试" },
            { ...corsHeaders, "Retry-After": String(rateLimit.retryAfterSeconds) },
          );
        }
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        const result = await webSheinAuthorization.start(context);
        return sendJson(response, 200, result, corsHeaders);
      }

      if (
        request.method === "GET" &&
        url.pathname === "/v1/web/shein/auth/callback"
      ) {
        const destination = new URL("/app/settings/stores", webAppBaseUrl);
        try {
          if (!webSheinAuthorization) {
            throw new WebSheinAuthorizationError(
              "SHEIN_AUTHORIZATION_UNAVAILABLE",
              "SHEIN网页授权服务尚未配置",
              503,
            );
          }
          const result = await webSheinAuthorization.complete({
            state: url.searchParams.get("state"),
            tempToken: url.searchParams.get("tempToken"),
          });
          destination.searchParams.set("sheinAuthorized", "1");
          destination.searchParams.set("storeLabel", result.store.label);
        } catch (error) {
          destination.searchParams.set(
            "sheinAuthError",
            error?.message || "SHEIN授权失败",
          );
        }
        return sendRedirect(response, destination.toString());
      }

      if (request.method === "GET" && url.pathname === "/v1/web/today-work") {
        if (!webAuth || !webTodayWork) {
          throw new WebAuthError("SERVICE_UNAVAILABLE", "今日工作服务尚未启用", 503);
        }
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        const stores = await webAuth.listStores(context);
        const storeId = String(url.searchParams.get("storeId") || "").trim();
        if (storeId && !stores.some((store) => String(store.id) === storeId)) {
          throw new WebAuthError("STORE_FORBIDDEN", "当前账号无权访问该店铺", 403);
        }
        return sendJson(response, 200, await webTodayWork.list({
          context,
          stores,
          storeId,
          date: url.searchParams.get("date") || "",
        }), corsHeaders);
      }

      const webAiTitleCapabilityMatch = url.pathname.match(
        /^\/v1\/web\/stores\/([^/]+)\/ai\/title\/capability$/,
      );
      if (request.method === "GET" && webAiTitleCapabilityMatch) {
        if (!webAuth || !webAiTitle) {
          throw new WebAuthError("SERVICE_UNAVAILABLE", "AI标题服务尚未启用", 503);
        }
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        const storeId = decodeURIComponent(webAiTitleCapabilityMatch[1]);
        await webAuth.requireStoreAccess(context, storeId);
        return sendJson(
          response,
          200,
          await webAiTitle.capabilities({ context }),
          corsHeaders,
        );
      }

      const webAiTitleSuggestMatch = url.pathname.match(
        /^\/v1\/web\/stores\/([^/]+)\/ai\/title\/suggest$/,
      );
      if (request.method === "POST" && webAiTitleSuggestMatch) {
        requireTrustedWebOrigin(request, allowedOrigins);
        if (!webAuth || !webAiTitle) {
          throw new WebAuthError("SERVICE_UNAVAILABLE", "AI标题服务尚未启用", 503);
        }
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        const storeId = decodeURIComponent(webAiTitleSuggestMatch[1]);
        await webAuth.requireStoreAccess(context, storeId);
        return sendJson(
          response,
          200,
          await webAiTitle.suggest({
            context,
            storeId,
            input: await readJsonBody(request, 64 * 1024),
          }),
          corsHeaders,
        );
      }

      if (request.method === "GET" && url.pathname === "/v1/web/admin/ai-title-settings") {
        if (!webAuth || !webAiTitle) {
          throw new WebAuthError("SERVICE_UNAVAILABLE", "AI标题服务尚未启用", 503);
        }
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        return sendJson(response, 200, await webAiTitle.getSettings({ context }), corsHeaders);
      }

      if (request.method === "PUT" && url.pathname === "/v1/web/admin/ai-title-settings") {
        requireTrustedWebOrigin(request, allowedOrigins);
        if (!webAuth || !webAiTitle) {
          throw new WebAuthError("SERVICE_UNAVAILABLE", "AI标题服务尚未启用", 503);
        }
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        return sendJson(
          response,
          200,
          await webAiTitle.saveSettings({ context, input: await readJsonBody(request, 16 * 1024) }),
          corsHeaders,
        );
      }

      if (
        !webSheinModulesEnabled &&
        /^\/v1\/web\/stores\/[^/]+\//.test(url.pathname) &&
        !/^\/v1\/web\/stores\/[^/]+\/media(?:\/|$)/.test(url.pathname)
      ) {
        return sendJson(
          response,
          404,
          {
            code: "SHEIN_WEB_MODULE_FROZEN",
            msg: "SHEIN商品、合规和发布模块当前已冻结",
          },
          corsHeaders,
        );
      }

      const webProductsMatch = url.pathname.match(
        /^\/v1\/web\/stores\/([^/]+)\/products$/,
      );
      if (request.method === "GET" && webProductsMatch) {
        if (!webAuth || !webBusiness) {
          throw new WebAuthError(
            "SERVICE_UNAVAILABLE",
            "网页商品服务尚未启用",
            503,
          );
        }
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        const storeId = decodeURIComponent(webProductsMatch[1]);
        await webAuth.requireStoreAccess(context, storeId);
        const result = await webBusiness.listProducts({
          context,
          storeId,
          pageNum: url.searchParams.get("pageNum"),
          pageSize: url.searchParams.get("pageSize"),
          skc: url.searchParams.get("skc"),
        });
        return sendJson(response, 200, result, corsHeaders);
      }

      const webPublishCategoriesMatch = url.pathname.match(
        /^\/v1\/web\/stores\/([^/]+)\/publish\/categories$/,
      );
      if (request.method === "GET" && webPublishCategoriesMatch) {
        if (!webAuth || !webBusiness) {
          throw new WebAuthError("SERVICE_UNAVAILABLE", "发品规则服务尚未启用", 503);
        }
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        const storeId = decodeURIComponent(webPublishCategoriesMatch[1]);
        await webAuth.requireStoreAccess(context, storeId);
        return sendJson(
          response,
          200,
          await webBusiness.getPublishCategories({ context, storeId }),
          corsHeaders,
        );
      }

      const webPublishSchemaCoverageMatch = url.pathname.match(
        /^\/v1\/web\/stores\/([^/]+)\/publish\/schema-coverage$/,
      );
      if (request.method === "GET" && webPublishSchemaCoverageMatch) {
        if (!webAuth || !webBusiness) {
          throw new WebAuthError("SERVICE_UNAVAILABLE", "发品规则服务尚未启用", 503);
        }
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        const storeId = decodeURIComponent(webPublishSchemaCoverageMatch[1]);
        await webAuth.requireStoreAccess(context, storeId);
        return sendJson(
          response,
          200,
          await webBusiness.getPublishSchemaCoverage({
            context,
            storeId,
          }),
          corsHeaders,
        );
      }

      const webDocumentStateMatch = url.pathname.match(
        /^\/v1\/web\/stores\/([^/]+)\/publish\/document-state$/,
      );
      if (request.method === "POST" && webDocumentStateMatch) {
        requireTrustedWebOrigin(request, allowedOrigins);
        if (!webAuth || !webBusiness) {
          throw new WebAuthError(
            "SERVICE_UNAVAILABLE",
            "商品文档状态查询服务尚未启用",
            503,
          );
        }
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        const storeId = decodeURIComponent(webDocumentStateMatch[1]);
        await webAuth.requireStoreAccess(context, storeId);
        const input = await readJsonBody(request);
        return sendJson(
          response,
          200,
          await webBusiness.queryDocumentState({
            context,
            storeId,
            version: input.version,
            spuNames: input.spuNames,
            spuName: input.spuName,
          }),
          corsHeaders,
        );
      }

      const webSpuInfoMatch = url.pathname.match(
        /^\/v1\/web\/stores\/([^/]+)\/publish\/spu-info$/,
      );
      if (request.method === "POST" && webSpuInfoMatch) {
        requireTrustedWebOrigin(request, allowedOrigins);
        if (!webAuth || !webBusiness) {
          throw new WebAuthError(
            "SERVICE_UNAVAILABLE",
            "SPU关系回读服务尚未启用",
            503,
          );
        }
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        const storeId = decodeURIComponent(webSpuInfoMatch[1]);
        await webAuth.requireStoreAccess(context, storeId);
        const input = await readJsonBody(request);
        return sendJson(
          response,
          200,
          await webBusiness.querySpuInfo({
            context,
            storeId,
            spuName: input.spuName,
            version: input.version,
          }),
          corsHeaders,
        );
      }

      const webComplianceRevalidationMatch = url.pathname.match(
        /^\/v1\/web\/stores\/([^/]+)\/publish\/compliance-revalidation$/,
      );
      if (request.method === "POST" && webComplianceRevalidationMatch) {
        requireTrustedWebOrigin(request, allowedOrigins);
        if (!webAuth || !webBusiness) {
          throw new WebAuthError(
            "SERVICE_UNAVAILABLE",
            "合规复验服务尚未启用",
            503,
          );
        }
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        const storeId = decodeURIComponent(webComplianceRevalidationMatch[1]);
        await webAuth.requireStoreAccess(context, storeId);
        const input = await readJsonBody(request);
        return sendJson(
          response,
          200,
          await webBusiness.revalidatePublishCompliance({
            context,
            storeId,
            jobId: input.jobId,
            spuName: input.spuName,
            version: input.version,
          }),
          corsHeaders,
        );
      }

      const webPublishSchemaMatch = url.pathname.match(
        /^\/v1\/web\/stores\/([^/]+)\/publish\/schema$/,
      );
      if (request.method === "POST" && webPublishSchemaMatch) {
        requireTrustedWebOrigin(request, allowedOrigins);
        if (!webAuth || !webBusiness) {
          throw new WebAuthError("SERVICE_UNAVAILABLE", "发品规则服务尚未启用", 503);
        }
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        const storeId = decodeURIComponent(webPublishSchemaMatch[1]);
        await webAuth.requireStoreAccess(context, storeId);
        const input = await readJsonBody(request);
        return sendJson(
          response,
          200,
          await webBusiness.getPublishSchema({
            context,
            storeId,
            categoryId: input.categoryId,
            productTypeId: input.productTypeId,
          }),
          corsHeaders,
        );
      }

      const webAssociatedRulesMatch = url.pathname.match(
        /^\/v1\/web\/stores\/([^/]+)\/publish\/associated-rules$/,
      );
      if (request.method === "POST" && webAssociatedRulesMatch) {
        requireTrustedWebOrigin(request, allowedOrigins);
        if (!webAuth || !webBusiness) {
          throw new WebAuthError("SERVICE_UNAVAILABLE", "关联属性规则服务尚未启用", 503);
        }
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        const storeId = decodeURIComponent(webAssociatedRulesMatch[1]);
        await webAuth.requireStoreAccess(context, storeId);
        const input = await readJsonBody(request, 256 * 1024);
        return sendJson(
          response,
          200,
          await webBusiness.getAssociatedAttributeRules({
            context,
            storeId,
            categoryId: input.categoryId,
            productTypeId: input.productTypeId,
            attributeList: input.attributeList,
          }),
          corsHeaders,
        );
      }

      const webPublishPreflightMatch = url.pathname.match(
        /^\/v1\/web\/stores\/([^/]+)\/publish\/preflight$/,
      );
      if (request.method === "POST" && webPublishPreflightMatch) {
        requireTrustedWebOrigin(request, allowedOrigins);
        if (!webAuth || !webBusiness) {
          throw new WebAuthError("SERVICE_UNAVAILABLE", "发品预检服务尚未启用", 503);
        }
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        const storeId = decodeURIComponent(webPublishPreflightMatch[1]);
        await webAuth.requireStoreAccess(context, storeId);
        const input = await readJsonBody(request, 256 * 1024);
        return sendJson(
          response,
          200,
          await webBusiness.preflightPublish({
            context,
            storeId,
            supplierSkuList: input.supplierSkuList,
            brandCode: input.brandCode,
          }),
          corsHeaders,
        );
      }

      const webPublishTemplateMediaMatch = url.pathname.match(
        /^\/v1\/web\/stores\/([^/]+)\/publish-templates\/([^/]+)\/media\/([^/]+)\/download-ticket$/,
      );
      if (request.method === "GET" && webPublishTemplateMediaMatch) {
        if (!webAuth || !webPublishTemplates || !webMedia) {
          throw new WebAuthError("SERVICE_UNAVAILABLE", "模板图片服务尚未启用", 503);
        }
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        const storeId = decodeURIComponent(webPublishTemplateMediaMatch[1]);
        const templateId = decodeURIComponent(webPublishTemplateMediaMatch[2]);
        const assetId = decodeURIComponent(webPublishTemplateMediaMatch[3]);
        await webAuth.requireStoreAccess(context, storeId);
        const visibleMedia = await webPublishTemplates.resolveVisibleMedia({
          context,
          storeId,
          id: templateId,
          assetId,
        });
        return sendJson(
          response,
          200,
          await webMedia.createDownloadTicket({
            context,
            storeId: visibleMedia.originStoreId,
            assetId: visibleMedia.assetId,
          }),
          corsHeaders,
        );
      }

      const webPublishTemplateMediaContentMatch = url.pathname.match(
        /^\/v1\/web\/stores\/([^/]+)\/publish-templates\/([^/]+)\/media\/([^/]+)\/content$/,
      );
      if (request.method === "GET" && webPublishTemplateMediaContentMatch) {
        if (!webAuth || !webPublishTemplates || !webMedia) {
          throw new WebAuthError("SERVICE_UNAVAILABLE", "模板图片服务尚未启用", 503);
        }
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        const storeId = decodeURIComponent(webPublishTemplateMediaContentMatch[1]);
        const templateId = decodeURIComponent(webPublishTemplateMediaContentMatch[2]);
        const assetId = decodeURIComponent(webPublishTemplateMediaContentMatch[3]);
        await webAuth.requireStoreAccess(context, storeId);
        const visibleMedia = await webPublishTemplates.resolveVisibleMedia({
          context,
          storeId,
          id: templateId,
          assetId,
        });
        const media = await webMedia.readReadySheinImage({
          context,
          storeId: visibleMedia.originStoreId,
          assetId: visibleMedia.assetId,
        });
        return sendImage(response, media, corsHeaders);
      }

      const webPublishTemplatesMatch = url.pathname.match(
        /^\/v1\/web\/stores\/([^/]+)\/publish-templates(?:\/([^/]+))?$/,
      );
      if (
        ["GET", "POST", "PUT", "DELETE"].includes(request.method) &&
        webPublishTemplatesMatch
      ) {
        if (!webAuth || !webPublishTemplates) {
          throw new WebAuthError("SERVICE_UNAVAILABLE", "发布模板服务尚未启用", 503);
        }
        if (request.method !== "GET") {
          requireTrustedWebOrigin(request, allowedOrigins);
        }
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        const storeId = decodeURIComponent(webPublishTemplatesMatch[1]);
        const templateId = webPublishTemplatesMatch[2]
          ? decodeURIComponent(webPublishTemplatesMatch[2])
          : null;
        await webAuth.requireStoreAccess(context, storeId);
        if (request.method === "GET") {
          return sendJson(
            response,
            200,
            await webPublishTemplates.list({
              context,
              storeId,
              templateType: url.searchParams.get("type") || undefined,
            }),
            corsHeaders,
          );
        }
        if (request.method === "DELETE") {
          if (!templateId) {
            throw new PublishTemplateError("TEMPLATE_ID_REQUIRED", "模板ID不能为空");
          }
          return sendJson(
            response,
            200,
            await webPublishTemplates.remove({ context, storeId, id: templateId }),
            corsHeaders,
          );
        }
        const input = await readJsonBody(request, 2 * 1024 * 1024);
        return sendJson(
          response,
          request.method === "POST" ? 201 : 200,
          await webPublishTemplates.save({
            context,
            storeId,
            input,
            id: request.method === "PUT" ? templateId : null,
          }),
          corsHeaders,
        );
      }

      const webProductDraftsMatch = url.pathname.match(
        /^\/v1\/web\/stores\/([^/]+)\/product-drafts$/,
      );
      if (
        ["GET", "POST", "DELETE"].includes(request.method) &&
        webProductDraftsMatch
      ) {
        if (!webAuth || !webProductDrafts) {
          throw new WebAuthError("SERVICE_UNAVAILABLE", "商品草稿服务尚未启用", 503);
        }
        if (["POST", "DELETE"].includes(request.method)) {
          requireTrustedWebOrigin(request, allowedOrigins);
        }
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        const storeId = decodeURIComponent(webProductDraftsMatch[1]);
        await webAuth.requireStoreAccess(context, storeId);
        const result = request.method === "GET"
          ? await webProductDrafts.list({
              context,
              storeId,
              includePublishHistory: url.searchParams.get("includePublishHistory") === "1",
            })
          : request.method === "POST"
            ? await webProductDrafts.save({
                context,
                storeId,
                input: await readJsonBody(request, 512 * 1024),
              })
            : await webProductDrafts.archiveMany({
                context,
                storeId,
                draftIds: (await readJsonBody(request, 128 * 1024)).draftIds,
              });
        return sendJson(
          response,
          request.method === "POST" ? 201 : 200,
          result,
          corsHeaders,
        );
      }

      const webProductDraftRevalidateMatch = url.pathname.match(
        /^\/v1\/web\/stores\/([^/]+)\/product-drafts\/revalidate$/,
      );
      if (request.method === "POST" && webProductDraftRevalidateMatch) {
        if (!webAuth || !webProductDrafts) {
          throw new WebAuthError("SERVICE_UNAVAILABLE", "商品草稿服务尚未启用", 503);
        }
        requireTrustedWebOrigin(request, allowedOrigins);
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        const storeId = decodeURIComponent(webProductDraftRevalidateMatch[1]);
        await webAuth.requireStoreAccess(context, storeId);
        const body = await readJsonBody(request, 64 * 1024);
        return sendJson(
          response,
          200,
          await webProductDrafts.revalidate({
            context,
            storeId,
            draftIds: body.draftIds,
            force: body.force === true,
          }),
          corsHeaders,
        );
      }

      const webProductDraftArchiveMatch = url.pathname.match(
        /^\/v1\/web\/stores\/([^/]+)\/product-drafts\/([^/]+)$/,
      );
      if (request.method === "DELETE" && webProductDraftArchiveMatch) {
        if (!webAuth || !webProductDrafts) {
          throw new WebAuthError("SERVICE_UNAVAILABLE", "商品草稿服务尚未启用", 503);
        }
        requireTrustedWebOrigin(request, allowedOrigins);
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        const storeId = decodeURIComponent(webProductDraftArchiveMatch[1]);
        const draftId = decodeURIComponent(webProductDraftArchiveMatch[2]);
        await webAuth.requireStoreAccess(context, storeId);
        return sendJson(
          response,
          200,
          await webProductDrafts.archive({ context, storeId, draftId }),
          corsHeaders,
        );
      }

      const webWorkspaceUsageMatch = url.pathname.match(
        /^\/v1\/web\/stores\/([^/]+)\/workspace-usage$/,
      );
      if (request.method === "GET" && webWorkspaceUsageMatch) {
        if (!webAuth || !webWorkspaceUsage) {
          throw new WebAuthError(
            "SERVICE_UNAVAILABLE",
            "工作区容量服务尚未启用",
            503,
          );
        }
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        const storeId = decodeURIComponent(webWorkspaceUsageMatch[1]);
        await webAuth.requireStoreAccess(context, storeId);
        return sendJson(
          response,
          200,
          await webWorkspaceUsage.get({ context, storeId }),
          corsHeaders,
        );
      }

      const webPublishBatchesMatch = url.pathname.match(
        /^\/v1\/web\/stores\/([^/]+)\/publish-batches$/,
      );
      if (
        ["GET", "POST"].includes(request.method) &&
        webPublishBatchesMatch
      ) {
        if (!webAuth || !webPublishBatches) {
          throw new WebAuthError("SERVICE_UNAVAILABLE", "发布批次服务尚未启用", 503);
        }
        if (request.method === "POST") {
          requireTrustedWebOrigin(request, allowedOrigins);
        }
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        const storeId = decodeURIComponent(webPublishBatchesMatch[1]);
        await webAuth.requireStoreAccess(context, storeId);
        const result =
          request.method === "GET"
            ? await webPublishBatches.list({ context, storeId })
            : await webPublishBatches.create({
                context,
                storeId,
                input: await readJsonBody(request, 256 * 1024),
              });
        return sendJson(
          response,
          request.method === "POST" ? 201 : 200,
          result,
          corsHeaders,
        );
      }

      const webProductReviewsMatch = url.pathname.match(
        /^\/v1\/web\/stores\/([^/]+)\/product-reviews(?:\/([^/]+))?$/,
      );
      if (
        webProductReviewsMatch &&
        (request.method === "GET" || request.method === "DELETE")
      ) {
        if (!webAuth || !webProductReviews) {
          throw new WebAuthError("SERVICE_UNAVAILABLE", "商品审核中心服务尚未启用", 503);
        }
        if (request.method === "DELETE") requireTrustedWebOrigin(request, allowedOrigins);
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        const storeId = decodeURIComponent(webProductReviewsMatch[1]);
        const reviewKey = webProductReviewsMatch[2]
          ? decodeURIComponent(webProductReviewsMatch[2])
          : null;
        await webAuth.requireStoreAccess(context, storeId);
        if (request.method === "GET") {
          return sendJson(
            response,
            200,
            await webProductReviews.list({ context, storeId }),
            corsHeaders,
          );
        }
        if (!reviewKey && typeof webProductReviews.archiveMany === "function") {
          const body = await readJsonBody(request, 64 * 1024);
          return sendJson(
            response,
            200,
            await webProductReviews.archiveMany({
              context,
              storeId,
              reviewKeys: body.reviewKeys,
            }),
            corsHeaders,
          );
        }
        return sendJson(
          response,
          200,
          await webProductReviews.archive({ context, storeId, reviewKey }),
          corsHeaders,
        );
      }

      const webReviewCenterSnapshotMatch = url.pathname.match(
        /^\/v1\/web\/stores\/([^/]+)\/review-center\/snapshot$/,
      );
      if (request.method === "GET" && webReviewCenterSnapshotMatch) {
        if (!webAuth || !webReviewCenterSnapshot) {
          throw new WebAuthError(
            "SERVICE_UNAVAILABLE",
            "商品审核中心快照服务尚未启用",
            503,
          );
        }
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        const storeId = decodeURIComponent(webReviewCenterSnapshotMatch[1]);
        await webAuth.requireStoreAccess(context, storeId);
        return sendJson(
          response,
          200,
          await webReviewCenterSnapshot.get({ context, storeId }),
          corsHeaders,
        );
      }

      const webPublishNowMatch = url.pathname.match(
        /^\/v1\/web\/stores\/([^/]+)\/publish-now$/,
      );
      if (request.method === "POST" && webPublishNowMatch) {
        requireTrustedWebOrigin(request, allowedOrigins);
        if (!webAuth || !webPublishBatches) {
          throw new WebAuthError("SERVICE_UNAVAILABLE", "商品发布服务尚未启用", 503);
        }
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        const storeId = decodeURIComponent(webPublishNowMatch[1]);
        await webAuth.requireStoreAccess(context, storeId);
        return sendJson(
          response,
          200,
          await webPublishBatches.publishNow({
            context,
            storeId,
            input: await readJsonBody(request, 256 * 1024),
          }),
          corsHeaders,
        );
      }

      const webPriceDiscussionsMatch = url.pathname.match(
        /^\/v1\/web\/stores\/([^/]+)\/price-discussions(?:\/([^/]+)\/(accept|reject))?$/,
      );
      if (["GET", "POST"].includes(request.method) && webPriceDiscussionsMatch) {
        if (!webAuth || !webBusiness) {
          throw new WebAuthError("SERVICE_UNAVAILABLE", "核价服务尚未启用", 503);
        }
        if (request.method === "POST") requireTrustedWebOrigin(request, allowedOrigins);
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        const storeId = decodeURIComponent(webPriceDiscussionsMatch[1]);
        const discussSn = webPriceDiscussionsMatch[2]
          ? decodeURIComponent(webPriceDiscussionsMatch[2])
          : null;
        const action = webPriceDiscussionsMatch[3] || null;
        await webAuth.requireStoreAccess(context, storeId);
        if (request.method === "GET") {
          return sendJson(response, 200, await webBusiness.listPriceDiscussions({
            context,
            storeId,
            discussStatus: url.searchParams.get("status") || 1,
            pageNum: url.searchParams.get("pageNum") || 1,
            pageSize: url.searchParams.get("pageSize") || 100,
          }), corsHeaders);
        }
        if (!discussSn) throw new WebAuthError("INVALID_REQUEST", "核价单号不能为空", 400);
        const processDiscussion = action === "reject"
          ? webBusiness.rejectPriceDiscussion.bind(webBusiness)
          : webBusiness.acceptPriceDiscussion.bind(webBusiness);
        const result = await processDiscussion({
          context,
          storeId,
          discussSn,
        });
        if (webTodayWork && Number(result?.successCount || 0) > 0) {
          await webTodayWork.recordAction({
            context,
            storeId,
            operation: action === "reject" ? "web.price.reject" : "web.price.accept",
            metadata: { discussSn },
          });
        }
        return sendJson(response, 200, result, corsHeaders);
      }

      const webPublishBatchReadbackStatusMatch = url.pathname.match(
        /^\/v1\/web\/stores\/([^/]+)\/publish-batches\/([^/]+)\/readback-status$/,
      );
      if (request.method === "GET" && webPublishBatchReadbackStatusMatch) {
        if (!webAuth || !webPublishBatches) {
          throw new WebAuthError("SERVICE_UNAVAILABLE", "发布批次服务尚未启用", 503);
        }
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        const storeId = decodeURIComponent(webPublishBatchReadbackStatusMatch[1]);
        const batchId = decodeURIComponent(webPublishBatchReadbackStatusMatch[2]);
        await webAuth.requireStoreAccess(context, storeId);
        return sendJson(
          response,
          200,
          await webPublishBatches.listReadbackStatus({
            context,
            storeId,
            batchId,
          }),
          corsHeaders,
        );
      }

      const webPublishBatchActionMatch = url.pathname.match(
        /^\/v1\/web\/stores\/([^/]+)\/publish-batches\/([^/]+)\/actions$/,
      );
      if (request.method === "POST" && webPublishBatchActionMatch) {
        requireTrustedWebOrigin(request, allowedOrigins);
        if (!webAuth || !webPublishBatches) {
          throw new WebAuthError("SERVICE_UNAVAILABLE", "发布批次服务尚未启用", 503);
        }
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        const storeId = decodeURIComponent(webPublishBatchActionMatch[1]);
        const batchId = decodeURIComponent(webPublishBatchActionMatch[2]);
        await webAuth.requireStoreAccess(context, storeId);
        const input = await readJsonBody(request);
        return sendJson(
          response,
          200,
          await webPublishBatches.act({
            context,
            storeId,
            batchId,
            action: input.action,
            confirmation: input.confirmation,
          }),
          corsHeaders,
        );
      }

      const webComplianceMatch = url.pathname.match(
        /^\/v1\/web\/stores\/([^/]+)\/compliance\/query$/,
      );

      const webComplianceWorkspaceDetailMatch = url.pathname.match(
        /^\/v1\/web\/stores\/([^/]+)\/compliance-workspace\/([^/]+)$/,
      );
      const webComplianceWorkspaceRefreshMatch = url.pathname.match(
        /^\/v1\/web\/stores\/([^/]+)\/compliance-workspace\/([^/]+)\/rules\/refresh$/,
      );
      const webComplianceWorkspaceBatchDraftMatch = url.pathname.match(
        /^\/v1\/web\/stores\/([^/]+)\/compliance-workspace\/batch-drafts$/,
      );
      const webCompliancePhotoCheckMatch = url.pathname.match(
        /^\/v1\/web\/stores\/([^/]+)\/compliance-workspace\/([^/]+)\/photos\/bind-contract-check$/,
      );
      const webCompliancePhotoSubmitMatch = url.pathname.match(
        /^\/v1\/web\/stores\/([^/]+)\/compliance-workspace\/([^/]+)\/photos\/submit$/,
      );
      const webComplianceReportCheckMatch = url.pathname.match(
        /^\/v1\/web\/stores\/([^/]+)\/compliance-workspace\/([^/]+)\/reports\/contract-check$/,
      );
      const webComplianceReportSubmitMatch = url.pathname.match(
        /^\/v1\/web\/stores\/([^/]+)\/compliance-workspace\/([^/]+)\/reports\/submit$/,
      );

      const webComplianceWorkspacePreflightMatch = url.pathname.match(
        /^\/v1\/web\/stores\/([^/]+)\/compliance-workspace\/([^/]+)\/preflight$/,
      );

      const webComplianceWorkspaceReviewMatch = url.pathname.match(
        /^\/v1\/web\/stores\/([^/]+)\/compliance-workspace\/([^/]+)\/preflight\/([^/]+)\/review$/,
      );
      if (request.method === "POST" && webComplianceWorkspaceReviewMatch) {
        requireTrustedWebOrigin(request, allowedOrigins);
        if (!webAuth || !webComplianceWorkspace) {
          throw new WebAuthError(
            "SERVICE_UNAVAILABLE",
            "网页合规工作台服务尚未启用",
            503,
          );
        }
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        const storeId = decodeURIComponent(webComplianceWorkspaceReviewMatch[1]);
        const skc = decodeURIComponent(webComplianceWorkspaceReviewMatch[2]);
        const preflightRunId = decodeURIComponent(webComplianceWorkspaceReviewMatch[3]);
        await webAuth.requireStoreAccess(context, storeId);
        return sendJson(
          response,
          201,
          await webComplianceWorkspace.reviewPreflight({
            context,
            storeId,
            skc,
            preflightRunId,
          }),
          corsHeaders,
        );
      }

      if (request.method === "POST" && webComplianceWorkspacePreflightMatch) {
        requireTrustedWebOrigin(request, allowedOrigins);
        if (!webAuth || !webComplianceWorkspace) {
          throw new WebAuthError(
            "SERVICE_UNAVAILABLE",
            "网页合规工作台服务尚未启用",
            503,
          );
        }
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        const storeId = decodeURIComponent(webComplianceWorkspacePreflightMatch[1]);
        const skc = decodeURIComponent(webComplianceWorkspacePreflightMatch[2]);
        await webAuth.requireStoreAccess(context, storeId);
        return sendJson(
          response,
          201,
          await webComplianceWorkspace.runPreflight({ context, storeId, skc }),
          corsHeaders,
        );
      }

      if (request.method === "POST" && webComplianceWorkspaceRefreshMatch) {
        requireTrustedWebOrigin(request, allowedOrigins);
        if (!webAuth || !webComplianceWorkspace) {
          throw new WebAuthError(
            "SERVICE_UNAVAILABLE",
            "网页合规回读服务尚未启用",
            503,
          );
        }
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        const storeId = decodeURIComponent(webComplianceWorkspaceRefreshMatch[1]);
        const skc = decodeURIComponent(webComplianceWorkspaceRefreshMatch[2]);
        await webAuth.requireStoreAccess(context, storeId);
        return sendJson(
          response,
          200,
          await webComplianceWorkspace.refreshSkc({ context, storeId, skc }),
          corsHeaders,
        );
      }

      if (
        request.method === "POST" &&
        (webCompliancePhotoCheckMatch ||
          webCompliancePhotoSubmitMatch ||
          webComplianceReportCheckMatch ||
          webComplianceReportSubmitMatch)
      ) {
        requireTrustedWebOrigin(request, allowedOrigins);
        if (!webAuth || !webComplianceWrites) {
          throw new WebAuthError(
            "SERVICE_UNAVAILABLE",
            "网页合规真实提交服务尚未启用",
            503,
          );
        }
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        const match = webCompliancePhotoCheckMatch ||
          webCompliancePhotoSubmitMatch ||
          webComplianceReportCheckMatch ||
          webComplianceReportSubmitMatch;
        const storeId = decodeURIComponent(match[1]);
        const skc = decodeURIComponent(match[2]);
        await webAuth.requireStoreAccess(context, storeId);
        const input = await readJsonBody(request, 512 * 1024);
        const result = webCompliancePhotoCheckMatch
          ? await webComplianceWrites.checkPhotos({ context, storeId, skc, input })
          : webCompliancePhotoSubmitMatch
            ? await webComplianceWrites.submitPhotos({ context, storeId, skc, input })
            : webComplianceReportCheckMatch
              ? await webComplianceWrites.checkReport({ context, storeId, skc, input })
              : await webComplianceWrites.submitReport({ context, storeId, skc, input });
        return sendJson(response, 200, result, corsHeaders);
      }

      if (request.method === "GET" && webComplianceWorkspaceDetailMatch) {
        if (!webAuth || !webComplianceWorkspace) {
          throw new WebAuthError(
            "SERVICE_UNAVAILABLE",
            "网页合规工作台服务尚未启用",
            503,
          );
        }
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        const storeId = decodeURIComponent(webComplianceWorkspaceDetailMatch[1]);
        const skc = decodeURIComponent(webComplianceWorkspaceDetailMatch[2]);
        await webAuth.requireStoreAccess(context, storeId);
        return sendJson(
          response,
          200,
          await webComplianceWorkspace.getSkcDetail({ context, storeId, skc }),
          corsHeaders,
        );
      }

      if (request.method === "POST" && webComplianceWorkspaceBatchDraftMatch) {
        requireTrustedWebOrigin(request, allowedOrigins);
        if (!webAuth || !webComplianceWorkspace || !webBusiness) {
          throw new WebAuthError(
            "SERVICE_UNAVAILABLE",
            "网页合规批量资料服务尚未启用",
            503,
          );
        }
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        const storeId = decodeURIComponent(webComplianceWorkspaceBatchDraftMatch[1]);
        await webAuth.requireStoreAccess(context, storeId);
        const input = await readJsonBody(request, 512 * 1024);
        return sendJson(
          response,
          200,
          await webComplianceWorkspace.saveBatchDrafts({
            context,
            storeId,
            skcNames: input.skcNames,
            photos: input.photos,
            reports: input.reports,
            readCompliance: ({ context: readContext, storeId: readStoreId, skc }) =>
              webBusiness.getComplianceBundle({
                context: readContext,
                storeId: readStoreId,
                skc,
              }),
          }),
          corsHeaders,
        );
      }

      const webComplianceWorkspaceListMatch = url.pathname.match(
        /^\/v1\/web\/stores\/([^/]+)\/compliance-workspace$/,
      );
      if (request.method === "GET" && webComplianceWorkspaceListMatch) {
        if (!webAuth || !webComplianceWorkspace) {
          throw new WebAuthError(
            "SERVICE_UNAVAILABLE",
            "网页合规工作台服务尚未启用",
            503,
          );
        }
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        const storeId = decodeURIComponent(webComplianceWorkspaceListMatch[1]);
        await webAuth.requireStoreAccess(context, storeId);
        return sendJson(
          response,
          200,
          await webComplianceWorkspace.listSkcs({
            context,
            storeId,
            filters: {
              query: url.searchParams.get("q"),
              status: url.searchParams.get("status"),
              reviewStatus: url.searchParams.get("reviewStatus"),
              page: url.searchParams.get("page"),
              pageSize: url.searchParams.get("pageSize"),
            },
          }),
          corsHeaders,
        );
      }

      if (request.method === "POST" && webComplianceMatch) {
        if (!webAuth || !webBusiness) {
          throw new WebAuthError(
            "SERVICE_UNAVAILABLE",
            "网页合规服务尚未启用",
            503,
          );
        }
        requireTrustedWebOrigin(request, allowedOrigins);
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        const storeId = decodeURIComponent(webComplianceMatch[1]);
        await webAuth.requireStoreAccess(context, storeId);
        const input = await readJsonBody(request);
        const result = await webBusiness.queryCompliance({
          context,
          storeId,
          skcNames: input.skcNames,
        });
        return sendJson(response, 200, result, corsHeaders);
      }

      const webComplianceRulesMatch = url.pathname.match(
        /^\/v1\/web\/stores\/([^/]+)\/compliance\/rules$/,
      );
      if (request.method === "POST" && webComplianceRulesMatch) {
        if (!webAuth || !webBusiness) {
          throw new WebAuthError(
            "SERVICE_UNAVAILABLE",
            "网页合规规则服务尚未启用",
            503,
          );
        }
        requireTrustedWebOrigin(request, allowedOrigins);
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        const storeId = decodeURIComponent(webComplianceRulesMatch[1]);
        await webAuth.requireStoreAccess(context, storeId);
        const input = await readJsonBody(request);
        const result = await webBusiness.getComplianceBundle({
          context,
          storeId,
          skc: input.skc,
        });
        return sendJson(response, 200, result, corsHeaders);
      }

      const webCompliancePreflightMatch = url.pathname.match(
        /^\/v1\/web\/stores\/([^/]+)\/compliance\/preflight$/,
      );
      if (request.method === "POST" && webCompliancePreflightMatch) {
        if (!webAuth || !webBusiness) {
          throw new WebAuthError(
            "SERVICE_UNAVAILABLE",
            "网页合规预检服务尚未启用",
            503,
          );
        }
        requireTrustedWebOrigin(request, allowedOrigins);
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        const storeId = decodeURIComponent(webCompliancePreflightMatch[1]);
        await webAuth.requireStoreAccess(context, storeId);
        const input = await readJsonBody(request, 512 * 1024);
        const result = await webBusiness.preflightCompliance({
          context,
          storeId,
          skcNames: input.skcNames,
          inputsBySkc: input.inputsBySkc,
          template: input.template,
        });
        return sendJson(response, 200, result, corsHeaders);
      }

      const webComplianceTemplateApplyMatch = url.pathname.match(
        /^\/v1\/web\/stores\/([^/]+)\/compliance\/templates\/([^/]+)\/apply$/,
      );
      if (request.method === "POST" && webComplianceTemplateApplyMatch) {
        if (!webAuth || !webComplianceWorkspace || !webPublishTemplates || !webBusiness) {
          throw new WebAuthError(
            "SERVICE_UNAVAILABLE",
            "网页合规模板引用服务尚未启用",
            503,
          );
        }
        requireTrustedWebOrigin(request, allowedOrigins);
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        const storeId = decodeURIComponent(webComplianceTemplateApplyMatch[1]);
        const templateId = decodeURIComponent(webComplianceTemplateApplyMatch[2]);
        await webAuth.requireStoreAccess(context, storeId);
        const input = await readJsonBody(request, 512 * 1024);
        const templateResult = await webPublishTemplates.list({
          context,
          storeId,
          templateType: "compliance",
        });
        const template = templateResult.templates.find(
          (item) => String(item.id) === templateId,
        );
        if (!template) {
          throw new WebAuthError(
            "COMPLIANCE_TEMPLATE_NOT_FOUND",
            "合规模板不存在或当前账号无权使用",
            404,
          );
        }
        const result = await webComplianceWorkspace.applyTemplate({
          context,
          storeId,
          skcNames: input.skcNames,
          template,
          sections: input.sections,
          readCompliance: ({ context: readContext, storeId: readStoreId, skc }) =>
            webBusiness.getComplianceBundle({
              context: readContext,
              storeId: readStoreId,
              skc,
            }),
        });
        return sendJson(response, 200, result, corsHeaders);
      }

      const webComplianceDraftMatch = url.pathname.match(
        /^\/v1\/web\/stores\/([^/]+)\/compliance\/drafts\/([^/]+)$/,
      );
      if (
        ["GET", "PUT"].includes(request.method) &&
        webComplianceDraftMatch
      ) {
        if (!webAuth || !webComplianceWorkspace) {
          throw new WebAuthError(
            "SERVICE_UNAVAILABLE",
            "网页合规草稿服务尚未启用",
            503,
          );
        }
        if (request.method === "PUT") {
          requireTrustedWebOrigin(request, allowedOrigins);
        }
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        const storeId = decodeURIComponent(webComplianceDraftMatch[1]);
        const skc = decodeURIComponent(webComplianceDraftMatch[2]);
        await webAuth.requireStoreAccess(context, storeId);
        const result =
          request.method === "GET"
            ? await webComplianceWorkspace.getDraft({
                context,
                storeId,
                skc,
              })
            : await webComplianceWorkspace.saveDraft({
                context,
                storeId,
                skc,
                input: await readJsonBody(request, 512 * 1024),
              });
        return sendJson(response, 200, result, corsHeaders);
      }

      const webComplianceTemplatesMatch = url.pathname.match(
        /^\/v1\/web\/stores\/([^/]+)\/compliance\/templates$/,
      );
      if (
        ["GET", "POST"].includes(request.method) &&
        webComplianceTemplatesMatch
      ) {
        if (!webAuth || !webComplianceWorkspace) {
          throw new WebAuthError(
            "SERVICE_UNAVAILABLE",
            "网页合规模板服务尚未启用",
            503,
          );
        }
        if (request.method === "POST") {
          requireTrustedWebOrigin(request, allowedOrigins);
        }
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        const storeId = decodeURIComponent(webComplianceTemplatesMatch[1]);
        await webAuth.requireStoreAccess(context, storeId);
        const result =
          request.method === "GET"
            ? await webComplianceWorkspace.listTemplates({
                context,
                storeId,
              })
            : await webComplianceWorkspace.saveTemplate({
                context,
                storeId,
                input: await readJsonBody(request, 512 * 1024),
              });
        return sendJson(
          response,
          request.method === "POST" ? 201 : 200,
          result,
          corsHeaders,
        );
      }

      const webMediaCollectionMatch = url.pathname.match(
        /^\/v1\/web\/stores\/([^/]+)\/media$/,
      );
      if (request.method === "GET" && webMediaCollectionMatch) {
        if (!webAuth || !webMedia) {
          throw new WebAuthError(
            "SERVICE_UNAVAILABLE",
            "网页图片服务尚未启用",
            503,
          );
        }
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        const storeId = decodeURIComponent(webMediaCollectionMatch[1]);
        await webAuth.requireStoreAccess(context, storeId);
        const result = await webMedia.listAssets({
          context,
          storeId,
          purpose: url.searchParams.get("purpose"),
          limit: url.searchParams.get("limit"),
        });
        return sendJson(response, 200, result, corsHeaders);
      }

      const webMediaTicketMatch = url.pathname.match(
        /^\/v1\/web\/stores\/([^/]+)\/media\/upload-ticket$/,
      );
      if (request.method === "POST" && webMediaTicketMatch) {
        if (!webAuth || !webMedia) {
          throw new WebAuthError(
            "SERVICE_UNAVAILABLE",
            "网页图片服务尚未启用",
            503,
          );
        }
        requireTrustedWebOrigin(request, allowedOrigins);
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        const storeId = decodeURIComponent(webMediaTicketMatch[1]);
        await webAuth.requireStoreAccess(context, storeId);
        const result = await webMedia.createUploadTicket({
          context,
          storeId,
          input: await readJsonBody(request),
        });
        return sendJson(response, 201, result, corsHeaders);
      }

      const webMediaDownloadMatch = url.pathname.match(
        /^\/v1\/web\/stores\/([^/]+)\/media\/([^/]+)\/download-ticket$/,
      );
      if (request.method === "GET" && webMediaDownloadMatch) {
        if (!webAuth || !webMedia) {
          throw new WebAuthError(
            "SERVICE_UNAVAILABLE",
            "网页图片服务尚未启用",
            503,
          );
        }
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        const storeId = decodeURIComponent(webMediaDownloadMatch[1]);
        const assetId = decodeURIComponent(webMediaDownloadMatch[2]);
        await webAuth.requireStoreAccess(context, storeId);
        const result = await webMedia.createDownloadTicket({
          context,
          storeId,
          assetId,
        });
        return sendJson(response, 200, result, corsHeaders);
      }

      const webMediaContentMatch = url.pathname.match(
        /^\/v1\/web\/stores\/([^/]+)\/media\/([^/]+)\/content$/,
      );
      if (request.method === "GET" && webMediaContentMatch) {
        if (!webAuth || !webMedia) {
          throw new WebAuthError("SERVICE_UNAVAILABLE", "网页图片服务尚未启用", 503);
        }
        requireTrustedWebOrigin(request, allowedOrigins);
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        const storeId = decodeURIComponent(webMediaContentMatch[1]);
        const assetId = decodeURIComponent(webMediaContentMatch[2]);
        await webAuth.requireStoreAccess(context, storeId);
        const media = await webMedia.readReadySheinImage({
          context,
          storeId,
          assetId,
        });
        return sendImage(response, media, corsHeaders);
      }

      const webMediaCompleteMatch = url.pathname.match(
        /^\/v1\/web\/stores\/([^/]+)\/media\/([^/]+)\/complete$/,
      );
      if (request.method === "POST" && webMediaCompleteMatch) {
        if (!webAuth || !webMedia) {
          throw new WebAuthError(
            "SERVICE_UNAVAILABLE",
            "网页图片服务尚未启用",
            503,
          );
        }
        requireTrustedWebOrigin(request, allowedOrigins);
        const context = await webAuth.authenticate(
          getWebSessionToken(request, webCookieName),
        );
        const storeId = decodeURIComponent(webMediaCompleteMatch[1]);
        const assetId = decodeURIComponent(webMediaCompleteMatch[2]);
        await webAuth.requireStoreAccess(context, storeId);
        const result = await webMedia.completeUpload({
          context,
          storeId,
          assetId,
          input: await readJsonBody(request),
        });
        return sendJson(response, 200, result, corsHeaders);
      }

      if (request.method === "POST" && url.pathname === "/v1/web/logout") {
        if (!webAuth) {
          throw new WebAuthError(
            "SERVICE_UNAVAILABLE",
            "网页登录服务尚未启用",
            503,
          );
        }
        requireTrustedWebOrigin(request, allowedOrigins);
        const token = getWebSessionToken(request, webCookieName);
        const context = await webAuth.authenticate(token);
        await webAuth.revoke(token, context);
        return sendJson(
          response,
          200,
          { ok: true },
          {
            ...corsHeaders,
            "Set-Cookie": serializeWebSessionCookie({
              name: webCookieName,
              token: "",
              maxAgeSeconds: 0,
              secure: webCookieSecure,
            }),
          },
        );
      }

      if (request.method === "POST" && url.pathname === "/v1/auth/enroll") {
        if (!deviceAuth) {
          throw new DeviceAuthError(
            "SERVICE_UNAVAILABLE",
            "设备认证服务尚未启用",
            503,
          );
        }
        const rateLimit = enrollmentLimiter.consume(getClientKey(request));
        if (!rateLimit.allowed) {
          return sendJson(
            response,
            429,
            {
              code: "RATE_LIMITED",
              msg: "设备授权尝试过于频繁，请稍后再试",
            },
            {
              ...corsHeaders,
              "Retry-After": String(rateLimit.retryAfterSeconds),
            },
          );
        }
        const enrollment = await deviceAuth.enroll(
          await readJsonBody(request),
        );
        return sendJson(response, 200, enrollment, corsHeaders);
      }

      if (
        request.method === "POST" &&
        url.pathname === "/v1/shein/auth/start"
      ) {
        if (!sheinAuthorization) {
          throw new DeviceAuthError(
            "SHEIN_AUTHORIZATION_UNAVAILABLE",
            "SHEIN 自动授权服务尚未配置",
            503,
          );
        }
        const rateLimit = authorizationLimiter.consume(
          `start:${getClientKey(request)}`,
        );
        if (!rateLimit.allowed) {
          return sendJson(
            response,
            429,
            {
              code: "RATE_LIMITED",
              msg: "SHEIN 授权尝试过于频繁，请稍后再试",
            },
            {
              ...corsHeaders,
              "Retry-After": String(rateLimit.retryAfterSeconds),
            },
          );
        }
        const input = await readJsonBody(request);
        const accessToken = parseBearerToken(request.headers.authorization);
        const context = accessToken
          ? await deviceAuth.authenticate(accessToken)
          : null;
        const result = await sheinAuthorization.start({
          ...input,
          tenantId: context?.tenantId || null,
        });
        return sendJson(response, 200, result, corsHeaders);
      }

      if (
        request.method === "POST" &&
        url.pathname === "/v1/shein/auth/complete"
      ) {
        if (!sheinAuthorization) {
          throw new DeviceAuthError(
            "SHEIN_AUTHORIZATION_UNAVAILABLE",
            "SHEIN 自动授权服务尚未配置",
            503,
          );
        }
        const rateLimit = authorizationLimiter.consume(
          `complete:${getClientKey(request)}`,
        );
        if (!rateLimit.allowed) {
          return sendJson(
            response,
            429,
            {
              code: "RATE_LIMITED",
              msg: "SHEIN 授权提交过于频繁，请稍后再试",
            },
            {
              ...corsHeaders,
              "Retry-After": String(rateLimit.retryAfterSeconds),
            },
          );
        }
        const result = await sheinAuthorization.complete(
          await readJsonBody(request),
        );
        return sendJson(response, 200, result, corsHeaders);
      }

      if (request.method === "GET" && url.pathname === "/v1/session") {
        if (!deviceAuth) {
          throw new DeviceAuthError(
            "SERVICE_UNAVAILABLE",
            "设备认证服务尚未启用",
            503,
          );
        }
        const accessToken = parseBearerToken(
          request.headers.authorization,
        );
        const context = await deviceAuth.authenticate(accessToken);
        return sendJson(
          response,
          200,
          {
            authenticated: true,
            tenant: {
              id: context.tenantId,
              name: context.tenantName,
            },
            device: {
              id: context.deviceId,
              name: context.deviceName,
            },
            expiresAt: context.expiresAt,
          },
          corsHeaders,
        );
      }

      if (
        request.method === "GET" &&
        url.pathname === "/v1/webhook-audits"
      ) {
        if (!deviceAuth || !webhookAudits) {
          throw new DeviceAuthError(
            "SERVICE_UNAVAILABLE",
            "审核事件查询服务尚未启用",
            503,
          );
        }
        const accessToken = parseBearerToken(
          request.headers.authorization,
        );
        const context = await deviceAuth.authenticate(accessToken);
        const result = await webhookAudits.listProductAuditEvents({
          tenantId: context.tenantId,
          supplierId: url.searchParams.get("supplierId"),
          limit: url.searchParams.get("limit"),
        });
        return sendJson(
          response,
          200,
          {
            ...result,
            generatedAt: new Date().toISOString(),
          },
          corsHeaders,
        );
      }

      if (request.method === "POST" && url.pathname === "/v1/auth/logout") {
        if (!deviceAuth) {
          throw new DeviceAuthError(
            "SERVICE_UNAVAILABLE",
            "设备认证服务尚未启用",
            503,
          );
        }
        const accessToken = parseBearerToken(
          request.headers.authorization,
        );
        const context = await deviceAuth.authenticate(accessToken);
        await deviceAuth.revoke(accessToken, context);
        return sendJson(
          response,
          200,
          { ok: true },
          corsHeaders,
        );
      }

      return sendJson(
        response,
        404,
        {
          code: "NOT_FOUND",
          msg: "接口不存在",
        },
        corsHeaders,
      );
    } catch (error) {
      requestErrorCode = typeof error?.code === "string" ? error.code : "INTERNAL_ERROR";
      if (error instanceof DeviceAuthError) {
        return sendJson(
          response,
          error.status,
          {
            code: error.code,
            msg: error.message,
          },
          corsHeaders,
        );
      }
      if (error instanceof WebAuthError) {
        return sendJson(
          response,
          error.status,
          {
            code: error.code,
            msg: error.message,
          },
          corsHeaders,
        );
      }
      if (error instanceof MediaServiceError) {
        return sendJson(
          response,
          error.status,
          {
            code: error.code,
            msg: error.message,
            traceId: error.traceId || null,
            diagnostics: error.diagnostics || null,
          },
          corsHeaders,
        );
      }
      if (error instanceof AiTitleError) {
        return sendJson(
          response,
          error.status,
          {
            code: error.code,
            msg: error.message,
            traceId: error.traceId || null,
            diagnostics: error.diagnostics || null,
          },
          corsHeaders,
        );
      }
      if (error instanceof ComplianceWorkspaceError) {
        return sendJson(
          response,
          error.status,
          {
            code: error.code,
            msg: error.message,
          },
          corsHeaders,
        );
      }
      if (error instanceof ProductDraftError) {
        return sendJson(
          response,
          error.status,
          { code: error.code, msg: error.message },
          corsHeaders,
        );
      }
      if (error instanceof PublishBatchError) {
        return sendJson(
          response,
          error.status,
          { code: error.code, msg: error.message },
          corsHeaders,
        );
      }
      if (error instanceof PublishTemplateError) {
        return sendJson(
          response,
          error.status,
          { code: error.code, msg: error.message },
          corsHeaders,
        );
      }
      if (error instanceof SheinAuthorizationError) {
        return sendJson(
          response,
          error.status,
          {
            code: error.code,
            msg: error.message,
          },
          corsHeaders,
        );
      }
      if (error instanceof WebSheinAuthorizationError) {
        return sendJson(
          response,
          error.status,
          { code: error.code, msg: error.message },
          corsHeaders,
        );
      }
      if (error instanceof DiagnosticEventError) {
        return sendJson(
          response,
          error.status,
          { code: error.code, msg: error.message },
          corsHeaders,
        );
      }
      if (
        Number.isInteger(error?.status) &&
        error.status >= 400 &&
        error.status < 600 &&
        typeof error?.code === "string"
      ) {
        return sendJson(
          response,
          error.status,
          {
            code: error.code,
            msg: error.message || "SHEIN 授权失败",
          },
          corsHeaders,
        );
      }
      console.error("[cloud-control]", error);
      return sendJson(
        response,
        500,
        {
          code: "INTERNAL_ERROR",
          msg: "服务暂时不可用",
        },
        corsHeaders,
      );
    } finally {
      if (
        diagnosticEvents &&
        typeof diagnosticEvents.recordServerRequest === "function" &&
        url.pathname !== "/v1/web/diagnostics/events"
      ) {
        const durationMs = Math.round(
          Number(process.hrtime.bigint() - startedAt) / 1_000_000,
        );
        void Promise.resolve(
          diagnosticEvents.recordServerRequest({
            method: request.method,
            path: url.pathname,
            traceId,
            statusCode: response.statusCode || 500,
            durationMs,
            errorCode: requestErrorCode,
          }),
        ).catch(() => {
          // Diagnostics must never turn a completed business response into a failure.
        });
      }
    }
  };
}

export function createCloudReadiness({ databaseUrl, redisUrl }) {
  const pool = createPostgresPool({
    connectionString: databaseUrl,
    max: 3,
  });
  const redis = new Redis(redisUrl, {
    lazyConnect: true,
    connectTimeout: 3_000,
    commandTimeout: 3_000,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
  redis.on("error", () => {});
  let redisConnectPromise = null;

  const pingRedis = async () => {
    if (redis.status === "wait") {
      redisConnectPromise ||= redis.connect().finally(() => {
        redisConnectPromise = null;
      });
      await redisConnectPromise;
    } else if (redis.status === "connecting" && redisConnectPromise) {
      await redisConnectPromise;
    }
    return redis.ping();
  };

  return {
    async check() {
      const [postgresResult, redisResult] = await Promise.allSettled([
        pool.query("SELECT 1"),
        pingRedis(),
      ]);
      const dependencies = {
        postgres: postgresResult.status === "fulfilled" ? "up" : "down",
        redis: redisResult.status === "fulfilled" ? "up" : "down",
      };
      return {
        ok: dependencies.postgres === "up" && dependencies.redis === "up",
        dependencies,
      };
    },
    async close() {
      redis.disconnect();
      await pool.end();
    },
  };
}

export function createCloudControlHttpServer(options) {
  return http.createServer(createCloudControlRequestHandler(options));
}

export async function startCloudControlServer(config = loadConfig()) {
  if (config.runtimeMode !== "cloud") {
    throw new Error("云端控制服务要求 SHEIN_RUNTIME_MODE=cloud");
  }
  if (!config.databaseUrl || !config.redisUrl) {
    throw new Error("云端控制服务缺少 DATABASE_URL 或 REDIS_URL");
  }

  const readiness = createCloudReadiness({
    databaseUrl: config.databaseUrl,
    redisUrl: config.redisUrl,
  });
  const authPool = createPostgresPool({
    connectionString: config.databaseUrl,
    max: 5,
  });
  const webEmail =
    config.webEmail?.provider === "smtp" &&
    config.webEmail.smtpHost &&
    config.webEmail.smtpUser &&
    config.webEmail.smtpPassword &&
    config.webEmail.from
      ? new SmtpWebEmailService({
          host: config.webEmail.smtpHost,
          port: config.webEmail.smtpPort,
          secure: config.webEmail.smtpSecure,
          user: config.webEmail.smtpUser,
          password: config.webEmail.smtpPassword,
          from: config.webEmail.from,
          replyTo: config.webEmail.replyTo,
        })
      : config.webEmail?.provider === "resend" &&
          config.webEmail.apiKey &&
          config.webEmail.from
        ? new ResendWebEmailService({
            apiKey: config.webEmail.apiKey,
            from: config.webEmail.from,
            replyTo: config.webEmail.replyTo,
          })
        : null;
  const deviceAuth = new PostgresDeviceAuthService({
    pool: authPool,
  });
  const webAuth = new PostgresWebAuthService({
    pool: authPool,
    emailService: webEmail,
    webAppBaseUrl: config.webAppBaseUrl,
  });
  const webhookAudits = new PostgresWebhookAuditRepository({
    pool: authPool,
  });
  const diagnosticEvents = new PostgresDiagnosticEventRepository({
    pool: authPool,
  });
  const credentialCipher = config.cloudEncryptionKey
    ? new CloudCredentialCipher({ base64Key: config.cloudEncryptionKey })
    : null;
  let sheinAuthorization = null;
  let webSheinAuthorization = null;
  let webBusiness = null;
  let storeRepository = null;
  let webStoreBusiness = null;
  let storeBusinessRefreshQueue = null;
  let webRuleRefresh = null;
  let ruleRefreshQueue = null;
  let webComplianceSync = null;
  let complianceSyncQueue = null;
  let webMedia = null;
  let webComplianceWrites = null;
  let webPublishTemplates = null;
  let webAiTitle = null;
  const webTodayWork = new WebTodayWorkService({ pool: authPool });
  const mediaRepository = new PostgresMediaRepository({ pool: authPool });
  const complianceWorkspaceRepository = new PostgresComplianceWorkspaceRepository({
    pool: authPool,
  });
  const webSyncJobs = new WebSyncJobService({
    repository: new PostgresSyncJobRepository({ pool: authPool }),
  });
  const webComplianceWorkspace = new WebComplianceWorkspaceService({
    repository: complianceWorkspaceRepository,
    readCompliance: ({ context, storeId, skc }) => {
      if (!webBusiness) {
        throw new WebAuthError(
          "SERVICE_UNAVAILABLE",
          "SHEIN 合规回读服务尚未启用",
          503,
        );
      }
      return webBusiness.getComplianceBundle({ context, storeId, skc });
    },
    capabilityProvider: () => ({
      refreshCurrentSkc: Boolean(webBusiness),
      photoTemplateApply: Boolean(webBusiness && webPublishTemplates),
      reportTemplateApply: Boolean(webBusiness && webPublishTemplates),
      ...(webComplianceWrites?.capabilities() || {}),
    }),
  });
  const productDraftRepository = new PostgresProductDraftRepository({
    pool: authPool,
  });
  const productReviewRepository = new PostgresProductReviewRepository({
    pool: authPool,
  });
  const publishExecutionRepository = new PostgresPublishExecutionRepository({
    pool: authPool,
  });
  const webProductReviews = new WebProductReviewService({
    repository: productReviewRepository,
  });
  const webProductDrafts = new WebProductDraftService({
    repository: productDraftRepository,
    quota: config.workspaceQuota,
    packagingTemplateProvider: async ({ context, storeId }) =>
      webPublishTemplates
        ? webPublishTemplates.list({ context, storeId, templateType: "packaging" })
        : { templates: [] },
    associatedAttributeRules: async (input) => {
      if (!webBusiness) {
        throw new ProductDraftError(
          "ASSOCIATED_RULES_UNAVAILABLE",
          "SHEIN关联属性规则服务尚未配置",
          503,
        );
      }
      return webBusiness.getAssociatedAttributeRules(input);
    },
  });
  const webWorkspaceUsage = new WebWorkspaceUsageService({
    draftRepository: productDraftRepository,
    mediaRepository,
    quota: config.workspaceQuota,
  });
  webPublishTemplates = new WebPublishTemplateService({
    repository: new PostgresPublishTemplateRepository({ pool: authPool }),
  });
  let webPublishBatches = null;
  if (config.appId && config.appSecret && config.cloudEncryptionKey) {
    storeRepository = new PostgresStoreRepository({
      pool: authPool,
      credentialCipher,
    });
    sheinAuthorization = new SheinDeviceAuthorizationService({
      pool: authPool,
      appId: config.appId,
      appSecret: config.appSecret,
      apiBaseUrl: config.apiBaseUrl,
      authorizationHost: config.authorizationHost,
      redirectUrl: config.desktopAuthorizationRedirectUrl,
      storeRepository,
      deviceAuth,
    });
    webSheinAuthorization = new WebSheinAuthorizationService({
      pool: authPool,
      appId: config.appId,
      appSecret: config.appSecret,
      apiBaseUrl: config.apiBaseUrl,
      authorizationHost: config.authorizationHost,
      redirectUrl: config.webAuthorizationRedirectUrl,
      storeRepository,
    });
    webBusiness = new SheinWebReadService({
      storeRepository,
      ruleSnapshotRepository: new PostgresRuleSnapshotRepository({
        pool: authPool,
      }),
      apiBaseUrl: config.apiBaseUrl,
      publishExecutionRepository,
      productReviewRepository,
    });
    storeBusinessRefreshQueue = config.storeBusinessRefresh.executionEnabled
      ? new BullMqJobQueue({
          redisUrl: config.redisUrl,
          queueName: STORE_BUSINESS_REFRESH_QUEUE_NAME,
        })
      : null;
    webStoreBusiness = new WebStoreBusinessService({
      repository: new PostgresStoreBusinessRepository({ pool: authPool }),
      queue: storeBusinessRefreshQueue,
      executionEnabled: config.storeBusinessRefresh.executionEnabled,
    });
    ruleRefreshQueue = config.ruleRefresh?.executionEnabled
      ? new BullMqJobQueue({
          redisUrl: config.redisUrl,
          queueName: RULE_REFRESH_QUEUE_NAME,
        })
      : null;
    webRuleRefresh = new WebRuleRefreshService({
      repository: new PostgresRuleRefreshRepository({ pool: authPool }),
      queue: ruleRefreshQueue,
      executionEnabled: config.ruleRefresh?.executionEnabled === true,
    });
    complianceSyncQueue = config.complianceSync?.executionEnabled
      ? new BullMqJobQueue({
          redisUrl: config.redisUrl,
          queueName: COMPLIANCE_SYNC_QUEUE_NAME,
        })
      : null;
    webComplianceSync = new WebComplianceSyncService({
      repository: new PostgresComplianceSyncRepository({ pool: authPool }),
      queue: complianceSyncQueue,
      executionEnabled: config.complianceSync?.executionEnabled === true,
    });
  }
  if (config.mediaStorage) {
    const storage = new S3ObjectStorage({
      endpoint: config.mediaStorage.endpoint,
      region: config.mediaStorage.region,
      bucket: config.mediaStorage.bucket,
      accessKeyId: config.mediaStorage.accessKeyId,
      secretAccessKey: config.mediaStorage.secretAccessKey,
      allowInsecureEndpoint: config.mediaStorage.allowInsecureEndpoint,
    });
    webMedia = new WebMediaService({
      repository: mediaRepository,
      storage,
      provider: config.mediaStorage.provider,
      bucket: config.mediaStorage.bucket,
      maxUploadBytes: config.mediaStorage.maxUploadBytes,
      quota: config.workspaceQuota,
    });
    webAiTitle = new WebAiTitleService({
      repository: new PostgresAiTitleRepository({ pool: authPool }),
      settingsRepository: new PostgresAiTitleSettingsRepository({
        pool: authPool,
        cipher: credentialCipher,
      }),
      mediaService: webMedia,
      apiUrl: config.titleAi.apiUrl,
      apiKey: config.titleAi.apiKey,
      model: config.titleAi.model,
      modelUrl: config.titleAi.modelUrl,
      timeoutMs: config.titleAi.timeoutMs,
      maxConcurrent: config.titleAi.maxConcurrent,
      maxQueue: config.titleAi.maxQueue,
      diagnosticSink: (event) => {
        console.info("[ai-title-diagnostic]", JSON.stringify(event));
      },
    });
  }
  if (storeRepository && webBusiness && webMedia) {
    webComplianceWrites = new WebComplianceWriteService({
      workspaceRepository: complianceWorkspaceRepository,
      storeRepository,
      mediaService: webMedia,
      complianceReader: webBusiness,
      complianceSync: webComplianceSync,
      apiBaseUrl: config.apiBaseUrl,
      confirmationSecret: config.complianceConfirmationSecret,
      executionEnabled: config.complianceWritesEnabled,
    });
  }
  webPublishBatches = new WebPublishBatchService({
    repository: new PostgresPublishBatchRepository({ pool: authPool }),
    readbackRepository: publishExecutionRepository,
    preflightPublish: async (input) => {
      if (!webBusiness) {
        throw new PublishBatchError(
          "PREFLIGHT_UNAVAILABLE",
          "SHEIN只读预检服务尚未配置",
          503,
        );
      }
      return webBusiness.preflightPublish(input);
    },
    preparePublishCandidate: async ({
      context,
      storeId,
      candidate,
      publishPreflight,
      previousRemoteCandidate,
    }) => {
      if (!webBusiness || !webMedia) {
        throw new PublishBatchError(
          "IMAGE_PREFLIGHT_UNAVAILABLE",
          "SHEIN图片远程预检服务尚未配置",
          503,
        );
      }
      return runProductRemotePreflight({
        candidate,
        publishPreflight,
        previousRemoteCandidate,
        uploadImage: async ({ assetId, templateId, imageType }) => {
          const sourceStoreId = templateId
            ? (await webPublishTemplates.resolveVisibleMedia({
                context,
                storeId,
                id: templateId,
                assetId,
              })).originStoreId
            : storeId;
          const media = await webMedia.readReadySheinImage({
            context,
            storeId: sourceStoreId,
            assetId,
          });
          return webBusiness.uploadProductImage({
            context,
            storeId,
            imageType,
            fileBytes: media.fileBytes,
            fileName: media.fileName,
            mimeType: media.mimeType,
          });
        },
      });
    },
    executionEnabled: config.productPublish?.executionEnabled === true,
    fastAckTimeoutMs: config.productPublish?.fastAckTimeoutMs,
    fastAckPollMs: config.productPublish?.fastAckPollMs,
    revalidateDrafts: ({ context, storeId, draftIds, force }) =>
      webProductDrafts.revalidate({ context, storeId, draftIds, force }),
  });
  const webReviewCenterSnapshot = new WebReviewCenterSnapshotService({
    productDrafts: webProductDrafts,
    publishBatches: webPublishBatches,
    productReviews: webProductReviews,
  });
  const server = createCloudControlHttpServer({
    readiness,
    deviceAuth,
    webAuth,
    webBusiness,
    webMedia,
    webStoreBusiness,
    webRuleRefresh,
    webComplianceSync,
    webSyncJobs,
    webComplianceWorkspace,
    webComplianceWrites,
    webProductDrafts,
    webWorkspaceUsage,
    webPublishBatches,
    webProductReviews,
    webReviewCenterSnapshot,
    webPublishTemplates,
    webTodayWork,
    webAiTitle,
    sheinAuthorization,
    webSheinAuthorization,
    webhookAudits,
    diagnosticEvents,
    allowedOrigins: config.cloudAllowedOrigins,
    webRegistrationTenantId: config.webPublicRegistrationTenantId,
    webCookieName: config.webCookieName,
    webCookieSecure: config.webCookieSecure,
    webSheinModulesEnabled: config.webSheinModulesEnabled,
    webAppBaseUrl: config.webAppBaseUrl,
  });
  server.on("close", () => {
    readiness.close().catch(() => {});
    storeBusinessRefreshQueue?.close().catch(() => {});
    ruleRefreshQueue?.close().catch(() => {});
    complianceSyncQueue?.close().catch(() => {});
    authPool.end().catch(() => {});
  });
  server.listen(config.cloudControlPort, config.cloudControlHost, () => {
    console.log(
      `[cloud-control] http://${config.cloudControlHost}:${config.cloudControlPort}`,
    );
  });
  return server;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  startCloudControlServer().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
