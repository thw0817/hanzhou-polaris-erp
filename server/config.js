import path from "node:path";
import { DEFAULT_WORKSPACE_QUOTA } from "./cloud/workspace-quota.js";

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

export function loadConfig(env = process.env) {
  const runtimeMode = env.SHEIN_RUNTIME_MODE || "local";
  if (!["local", "cloud"].includes(runtimeMode)) {
    throw new Error("SHEIN_RUNTIME_MODE 仅支持 local 或 cloud");
  }
  const appId = env.SHEIN_APP_ID || "";
  const appSecret = env.SHEIN_APP_SECRET || "";
  const apiBaseUrl = stripTrailingSlash(
    env.SHEIN_API_BASE_URL || "https://openapi.sheincorp.cn",
  );
  const authorizationHost =
    env.SHEIN_AUTHORIZATION_HOST || "openapi-sem.sheincorp.com";

  return {
    runtimeMode,
    localDirectAuthEnabled: env.SHEIN_LOCAL_DIRECT_AUTH === "true",
    host: env.SHEIN_PROXY_HOST || "127.0.0.1",
    port: Number(env.SHEIN_PROXY_PORT || 8787),
    appId,
    appSecret,
    apiBaseUrl,
    authorizationHost,
    redirectUrl: env.SHEIN_REDIRECT_URL || "http://127.0.0.1:5173/",
    desktopAuthorizationRedirectUrl:
      env.SHEIN_DESKTOP_REDIRECT_URL ||
      "http://127.0.0.1:8787/api/shein/auth/callback",
    webAuthorizationRedirectUrl:
      env.SHEIN_WEB_AUTHORIZATION_REDIRECT_URL ||
      "https://app.hanzhou.icu/v1/web/shein/auth/callback",
    webAppBaseUrl: stripTrailingSlash(
      env.SHEIN_WEB_APP_BASE_URL || "https://app.hanzhou.icu",
    ),
    webPublicRegistrationTenantId:
      env.SHEIN_PUBLIC_REGISTRATION_TENANT_ID || "",
    webEmail: {
      provider: env.SHEIN_EMAIL_PROVIDER || "resend",
      apiKey: env.SHEIN_EMAIL_API_KEY || "",
      from: env.SHEIN_EMAIL_FROM || "",
      replyTo: env.SHEIN_EMAIL_REPLY_TO || "",
      smtpHost: env.SHEIN_SMTP_HOST || "",
      smtpPort: Number(env.SHEIN_SMTP_PORT || 465),
      smtpSecure: env.SHEIN_SMTP_SECURE !== "false",
      smtpUser: env.SHEIN_SMTP_USER || "",
      smtpPassword: env.SHEIN_SMTP_PASSWORD || "",
    },
    environment: env.SHEIN_ENVIRONMENT || "production-full-managed",
    credentialFile:
      env.SHEIN_CREDENTIAL_FILE ||
      path.resolve(process.cwd(), ".data/shein-stores.v1.json"),
    credentialKeyFile:
      env.SHEIN_CREDENTIAL_KEY_FILE ||
      path.resolve(process.cwd(), ".data/shein-stores.v2.key"),
    templateFile:
      env.SHEIN_TEMPLATE_FILE ||
      path.resolve(process.cwd(), ".data/shein-templates.v1.json"),
    schemaCacheFile:
      env.SHEIN_SCHEMA_CACHE_FILE ||
      path.resolve(process.cwd(), ".data/shein-schema-cache.v1.json"),
    businessDataFile:
      env.SHEIN_BUSINESS_DATA_FILE ||
      path.resolve(process.cwd(), ".data/shein-business-data.v1.json"),
    sizeTemplateFile:
      env.SHEIN_SIZE_TEMPLATE_FILE ||
      path.resolve(process.cwd(), ".data/shein-size-templates.v1.json"),
    attributeTemplateFile:
      env.SHEIN_ATTRIBUTE_TEMPLATE_FILE ||
      path.resolve(process.cwd(), ".data/shein-attribute-templates.v1.json"),
    mainImageTemplateFile:
      env.SHEIN_MAIN_IMAGE_TEMPLATE_FILE ||
      path.resolve(process.cwd(), ".data/shein-main-image-templates.v1.json"),
    mainImageAssetDir:
      env.SHEIN_MAIN_IMAGE_ASSET_DIR ||
      path.resolve(process.cwd(), ".data/main-image-assets"),
    databaseUrl: env.DATABASE_URL || "",
    migrationDatabaseUrl:
      env.SHEIN_MIGRATION_DATABASE_URL || env.DATABASE_URL || "",
    redisUrl: env.REDIS_URL || "",
    cloudEncryptionKey: env.SHEIN_CLOUD_ENCRYPTION_KEY || "",
    cloudControlHost: env.SHEIN_CLOUD_CONTROL_HOST || "127.0.0.1",
    cloudControlPort: Number(env.SHEIN_CLOUD_CONTROL_PORT || 8790),
    cloudAllowedOrigins: (env.SHEIN_CLOUD_ALLOWED_ORIGINS || "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    webCookieName: env.SHEIN_WEB_COOKIE_NAME || "shein_web_session",
    webCookieSecure:
      env.SHEIN_WEB_COOKIE_SECURE !== "false" && runtimeMode === "cloud",
    webSheinModulesEnabled:
      env.SHEIN_WEB_SHEIN_MODULE_ENABLED === "true",
    titleAi: {
      apiUrl: stripTrailingSlash(env.SHEIN_TITLE_AI_API_URL || ""),
      apiKey: env.SHEIN_TITLE_AI_API_KEY || "",
      model: env.SHEIN_TITLE_AI_MODEL || "",
      modelUrl: env.SHEIN_TITLE_AI_MODEL_URL || "",
      timeoutMs: Number(env.SHEIN_TITLE_AI_TIMEOUT_MS || 30 * 1000),
      maxConcurrent: Number(env.SHEIN_TITLE_AI_MAX_CONCURRENT || 2),
      maxQueue: Number(env.SHEIN_TITLE_AI_MAX_QUEUE || 8),
    },
    mediaStorage:
      env.SHEIN_MEDIA_STORAGE_PROVIDER === "s3" &&
      env.SHEIN_MEDIA_S3_ENDPOINT &&
      env.SHEIN_MEDIA_S3_REGION &&
      env.SHEIN_MEDIA_S3_BUCKET &&
      env.SHEIN_MEDIA_S3_ACCESS_KEY_ID &&
      env.SHEIN_MEDIA_S3_SECRET_ACCESS_KEY
        ? {
            provider: "s3",
            endpoint: stripTrailingSlash(env.SHEIN_MEDIA_S3_ENDPOINT),
            region: env.SHEIN_MEDIA_S3_REGION,
            bucket: env.SHEIN_MEDIA_S3_BUCKET,
            accessKeyId: env.SHEIN_MEDIA_S3_ACCESS_KEY_ID,
            secretAccessKey: env.SHEIN_MEDIA_S3_SECRET_ACCESS_KEY,
            allowInsecureEndpoint:
              env.SHEIN_MEDIA_S3_ALLOW_INSECURE === "true" &&
              env.SHEIN_ENVIRONMENT === "staging",
            maxUploadBytes: Number(
              env.SHEIN_MEDIA_MAX_UPLOAD_BYTES || 20 * 1024 * 1024,
            ),
          }
        : null,
    mediaCleanupIntervalMs: Number(
      env.SHEIN_MEDIA_CLEANUP_INTERVAL_MS || 60 * 1000,
    ),
    mediaCleanupBatchSize: Number(
      env.SHEIN_MEDIA_CLEANUP_BATCH_SIZE || 100,
    ),
    workspaceQuota: {
      draftPerStore: Number(
        env.SHEIN_DRAFT_LIMIT_PER_STORE || DEFAULT_WORKSPACE_QUOTA.draftPerStore,
      ),
      draftPerTenant: Number(
        env.SHEIN_DRAFT_LIMIT_PER_ACCOUNT || DEFAULT_WORKSPACE_QUOTA.draftPerTenant,
      ),
      mediaAssetsPerStore: Number(
        env.SHEIN_MEDIA_LIMIT_PER_STORE || DEFAULT_WORKSPACE_QUOTA.mediaAssetsPerStore,
      ),
      mediaAssetsPerTenant: Number(
        env.SHEIN_MEDIA_LIMIT_PER_ACCOUNT || DEFAULT_WORKSPACE_QUOTA.mediaAssetsPerTenant,
      ),
      mediaBytesPerStore: Number(
        env.SHEIN_MEDIA_BYTES_LIMIT_PER_STORE || DEFAULT_WORKSPACE_QUOTA.mediaBytesPerStore,
      ),
      mediaBytesPerTenant: Number(
        env.SHEIN_MEDIA_BYTES_LIMIT_PER_ACCOUNT || DEFAULT_WORKSPACE_QUOTA.mediaBytesPerTenant,
      ),
    },
    storeBusinessRefresh: {
      executionEnabled:
        env.SHEIN_STORE_BUSINESS_REFRESH_ENABLED === "true",
      workerConcurrency: Number(
        env.SHEIN_STORE_BUSINESS_REFRESH_CONCURRENCY || 1,
      ),
      schedulerEnabled:
        env.SHEIN_STORE_BUSINESS_SCHEDULER_ENABLED === "true",
      scheduleIntervalMs: Number(
        env.SHEIN_STORE_BUSINESS_SCHEDULE_INTERVAL_MS || 15 * 60 * 1000,
      ),
    },
    ruleRefresh: {
      executionEnabled: env.SHEIN_RULE_REFRESH_ENABLED === "true",
      workerConcurrency: Number(env.SHEIN_RULE_REFRESH_CONCURRENCY || 1),
      targetConcurrency: Number(
        env.SHEIN_RULE_REFRESH_TARGET_CONCURRENCY || 4,
      ),
      scheduleEnabled:
        env.SHEIN_RULE_REFRESH_SCHEDULE_ENABLED === "true",
      scheduleIntervalMs: Number(
        env.SHEIN_RULE_REFRESH_SCHEDULE_INTERVAL_MS || 60 * 1000,
      ),
      scheduleDay: Number(env.SHEIN_RULE_REFRESH_SCHEDULE_DAY || 1),
      scheduleStartHour: Number(
        env.SHEIN_RULE_REFRESH_SCHEDULE_START_HOUR || 3,
      ),
      scheduleEndHour: Number(
        env.SHEIN_RULE_REFRESH_SCHEDULE_END_HOUR || 4,
      ),
      scheduleTimeZone:
        env.SHEIN_RULE_REFRESH_SCHEDULE_TIME_ZONE || "Asia/Shanghai",
    },
    complianceSync: {
      executionEnabled: env.SHEIN_COMPLIANCE_SYNC_ENABLED === "true",
      workerConcurrency: Number(env.SHEIN_COMPLIANCE_SYNC_CONCURRENCY || 1),
    },
    productPublish: {
      executionEnabled:
        env.SHEIN_PRODUCT_PUBLISH_EXECUTION_ENABLED === "true",
      workerConcurrency: Number(
        env.SHEIN_PRODUCT_PUBLISH_CONCURRENCY || 1,
      ),
      fastAckTimeoutMs: Number(
        env.SHEIN_PRODUCT_PUBLISH_FAST_ACK_TIMEOUT_MS || 8 * 1000,
      ),
      fastAckPollMs: Number(
        env.SHEIN_PRODUCT_PUBLISH_FAST_ACK_POLL_MS || 150,
      ),
    },
    cloudApiBaseUrl: stripTrailingSlash(
      env.SHEIN_CLOUD_API_BASE_URL || "https://api.hanzhou.icu",
    ),
    cloudSessionFile:
      env.SHEIN_CLOUD_SESSION_FILE ||
      path.resolve(process.cwd(), ".data/cloud-session.v1.json"),
    internalWebhookSecret: env.SHEIN_INTERNAL_WEBHOOK_SECRET || "",
    webhookIngressEnabled:
      env.SHEIN_WEBHOOK_INGRESS_ENABLED === "true",
    webhookVerificationMode:
      env.SHEIN_WEBHOOK_VERIFICATION_MODE || "disabled",
    webhookHost: env.SHEIN_WEBHOOK_HOST || "127.0.0.1",
    webhookPort: Number(env.SHEIN_WEBHOOK_PORT || 8791),
    webhookMaxClockSkewMs: Number(
      env.SHEIN_WEBHOOK_MAX_CLOCK_SKEW_MS || 5 * 60 * 1000,
    ),
    complianceWritesEnabled:
      env.SHEIN_COMPLIANCE_WRITES_ENABLED === "true",
    complianceConfirmationSecret:
      env.SHEIN_COMPLIANCE_CONFIRMATION_SECRET || "",
    bootstrapStore:
      env.SHEIN_STORE_OPEN_KEY_ID && env.SHEIN_STORE_SECRET_KEY
        ? {
            openKeyId: env.SHEIN_STORE_OPEN_KEY_ID,
            secretKey: env.SHEIN_STORE_SECRET_KEY,
            supplierId: env.SHEIN_STORE_SUPPLIER_ID || null,
            label: env.SHEIN_STORE_LABEL || "",
            businessMode: env.SHEIN_STORE_BUSINESS_MODE || "全托管",
            source: "environment",
          }
        : null,
  };
}
