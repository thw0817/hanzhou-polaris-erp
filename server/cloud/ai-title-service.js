import { randomUUID } from "node:crypto";
import {
  buildAiTitleRequest,
  normalizeAiPatternName,
  validateAiTitleProviderSettings,
} from "../../src-v2/lib/ai-title-contract.js";

export const AI_TITLE_FEATURE = "ai_title";

export class AiTitleError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "AiTitleError";
    this.code = code;
    this.status = status;
  }
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value, max = 500) {
  return String(value || "").trim().slice(0, max);
}

function parseJsonContent(value) {
  if (Array.isArray(value)) {
    value = value.map((part) => typeof part === "string" ? part : part?.text || "").join("");
  }
  const raw = String(value || "").trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced ? fenced[1] : raw;
  try {
    return object(JSON.parse(candidate));
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return object(JSON.parse(candidate.slice(start, end + 1)));
      } catch {
        return {};
      }
    }
    return {};
  }
}

function configuredValue(value) {
  return text(value, 2000);
}

export class PostgresAiTitleRepository {
  constructor({ pool } = {}) {
    if (!pool) throw new Error("PostgresAiTitleRepository 缺少 pool");
    this.pool = pool;
  }

  async hasGrant({ tenantId, userId, featureCode = AI_TITLE_FEATURE } = {}) {
    const result = await this.pool.query({
      text: `SELECT enabled
             FROM ai_feature_grants
             WHERE tenant_id=$1 AND user_id=$2 AND feature_code=$3`,
      values: [tenantId, userId, featureCode],
    });
    return result.rows[0]?.enabled === true;
  }

  async setGrant({ tenantId, userId, featureCode = AI_TITLE_FEATURE, enabled, grantedBy } = {}) {
    if (enabled) {
      await this.pool.query({
        text: `INSERT INTO ai_feature_grants
                 (tenant_id, user_id, feature_code, enabled, granted_by)
               VALUES ($1, $2, $3, true, $4)
               ON CONFLICT (tenant_id, user_id, feature_code)
               DO UPDATE SET enabled=true, granted_by=$4, updated_at=now()`,
        values: [tenantId, userId, featureCode, grantedBy],
      });
    } else {
      await this.pool.query({
        text: `DELETE FROM ai_feature_grants
               WHERE tenant_id=$1 AND user_id=$2 AND feature_code=$3`,
        values: [tenantId, userId, featureCode],
      });
    }
    return { enabled: Boolean(enabled) };
  }
}

const AI_TITLE_SETTINGS_SCOPE = (tenantId) => `tenant:${tenantId}:ai-title`;

export class PostgresAiTitleSettingsRepository {
  constructor({ pool, cipher } = {}) {
    if (!pool) throw new Error("PostgresAiTitleSettingsRepository 缺少 pool");
    this.pool = pool;
    this.cipher = cipher;
  }

  async get({ tenantId } = {}) {
    const result = await this.pool.query({
      text: `SELECT tenant_id, api_url, model, model_url, key_hint,
                    ciphertext, iv, auth_tag, key_version, algorithm,
                    updated_at
             FROM tenant_ai_title_settings
             WHERE tenant_id=$1`,
      values: [tenantId],
    });
    const row = result.rows[0];
    if (!row) return null;
    let apiKey = "";
    if (row.ciphertext) {
      if (!this.cipher) {
        throw new AiTitleError("AI_TITLE_SETTINGS_UNAVAILABLE", "云端加密密钥未配置，暂时无法读取 AI 设置", 503);
      }
      try {
        apiKey = this.cipher.decryptScoped({
          ciphertext: row.ciphertext,
          iv: row.iv,
          authTag: row.auth_tag,
          keyVersion: row.key_version,
          algorithm: row.algorithm,
        }, { scope: AI_TITLE_SETTINGS_SCOPE(tenantId) });
      } catch (error) {
        throw new AiTitleError("AI_TITLE_SETTINGS_UNAVAILABLE", error?.message || "AI 设置无法解密，请重新保存", 503);
      }
    }
    return {
      tenantId: row.tenant_id,
      apiUrl: configuredValue(row.api_url),
      model: configuredValue(row.model),
      modelUrl: configuredValue(row.model_url),
      apiKey,
      keyHint: configuredValue(row.key_hint, 32),
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    };
  }

  async save({ tenantId, apiUrl, model = "", modelUrl = "", apiKey = "", configuredBy } = {}) {
    const candidate = validateAiTitleProviderSettings({ apiUrl, model, modelUrl });
    if (!candidate.valid) throw new AiTitleError(candidate.code, candidate.error, 400);
    const current = await this.get({ tenantId });
    const nextApiKey = configuredValue(apiKey) || current?.apiKey || "";
    const validated = validateAiTitleProviderSettings({
      ...candidate.settings,
      apiKey: nextApiKey,
      requireApiKey: true,
    });
    if (!validated.valid) throw new AiTitleError(validated.code, validated.error, 400);
    if (!this.cipher) {
      throw new AiTitleError("AI_TITLE_SETTINGS_UNAVAILABLE", "云端加密密钥未配置，暂时无法保存 AI 设置", 503);
    }
    const encrypted = this.cipher.encryptScoped(nextApiKey, {
      scope: AI_TITLE_SETTINGS_SCOPE(tenantId),
    });
    await this.pool.query({
      text: `INSERT INTO tenant_ai_title_settings
               (tenant_id, api_url, model, model_url, key_hint,
                ciphertext, iv, auth_tag, key_version, algorithm, configured_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             ON CONFLICT (tenant_id)
             DO UPDATE SET api_url=$2, model=$3, model_url=$4, key_hint=$5,
                           ciphertext=$6, iv=$7, auth_tag=$8, key_version=$9,
                           algorithm=$10, configured_by=$11, updated_at=now()`,
      values: [
        tenantId,
        candidate.settings.apiUrl,
        candidate.settings.model,
        candidate.settings.modelUrl,
        `••••${nextApiKey.slice(-4)}`,
        encrypted.ciphertext,
        encrypted.iv,
        encrypted.authTag,
        encrypted.keyVersion,
        encrypted.algorithm,
        configuredBy,
      ],
    });
    return this.get({ tenantId });
  }
}

function isAdministrator(context) {
  return ["owner", "admin"].includes(context?.role);
}

function aiTitleCacheKey({ context, storeId, input } = {}) {
  return JSON.stringify({
    tenantId: text(context?.tenantId, 200),
    userId: text(context?.userId, 200),
    storeId: text(storeId, 200),
    mainImageAssetId: text(input?.mainImageAssetId, 500),
    titleRuleTemplateId: text(input?.titleRuleTemplateId, 500),
    titleRule: object(input?.titleRule),
    titleMaxLength: Number(input?.titleMaxLength) || 250,
    locale: text(input?.locale, 32),
  });
}

function aiTitleImageCacheKey({ context, storeId, assetId } = {}) {
  return JSON.stringify({
    tenantId: text(context?.tenantId, 200),
    storeId: text(storeId, 200),
    assetId: text(assetId, 500),
  });
}

function imageByteLength(image) {
  const bytes = image?.fileBytes;
  return Number(bytes?.byteLength || bytes?.length || 0);
}

const AI_TITLE_MAX_CONCURRENT = 8;
const AI_TITLE_MAX_QUEUE = 64;
const AI_TITLE_MAX_CACHE_ENTRIES = 1024;

export class WebAiTitleService {
  constructor({
    repository,
    settingsRepository = null,
    mediaService,
    apiUrl = "",
    apiKey = "",
    model = "",
    modelUrl = "",
    timeoutMs = 30_000,
    maxConcurrent = 2,
    maxQueue = 8,
    cacheMaxEntries = 128,
    cacheTtlMs = 120_000,
    imageCacheTtlMs = 300_000,
    imageCacheMaxEntries = 64,
    imageCacheMaxBytes = 16 * 1024 * 1024,
    fetchImpl = fetch,
    now = () => Date.now(),
    diagnosticSink = null,
  } = {}) {
    if (!repository) throw new Error("WebAiTitleService 缺少 repository");
    if (!mediaService) throw new Error("WebAiTitleService 缺少 mediaService");
    this.repository = repository;
    this.settingsRepository = settingsRepository;
    this.mediaService = mediaService;
    this.apiUrl = configuredValue(apiUrl);
    this.apiKey = configuredValue(apiKey);
    this.model = configuredValue(model);
    this.modelUrl = configuredValue(modelUrl);
    this.timeoutMs = Math.max(5_000, Number(timeoutMs) || 30_000);
    this.cacheTtlMs = Math.max(0, Number(cacheTtlMs) || 120_000);
    const parsedImageCacheTtlMs = Number(imageCacheTtlMs);
    this.imageCacheTtlMs = Number.isFinite(parsedImageCacheTtlMs)
      ? Math.max(0, parsedImageCacheTtlMs)
      : 300_000;
    this.imageCacheMaxEntries = Math.max(1, Number(imageCacheMaxEntries) || 64);
    this.imageCacheMaxBytes = Math.max(1, Number(imageCacheMaxBytes) || 16 * 1024 * 1024);
    const parsedMaxConcurrent = Number(maxConcurrent);
    this.maxConcurrent = parsedMaxConcurrent === Number.POSITIVE_INFINITY
      ? AI_TITLE_MAX_CONCURRENT
      : Number.isFinite(parsedMaxConcurrent)
        ? Math.min(AI_TITLE_MAX_CONCURRENT, Math.max(1, Math.floor(parsedMaxConcurrent) || 2))
        : 2;
    const parsedMaxQueue = Number(maxQueue);
    this.maxQueue = parsedMaxQueue === Number.POSITIVE_INFINITY
      ? AI_TITLE_MAX_QUEUE
      : Number.isFinite(parsedMaxQueue)
        ? Math.min(AI_TITLE_MAX_QUEUE, Math.max(0, Math.floor(parsedMaxQueue)))
        : 8;
    const parsedCacheMaxEntries = Number(cacheMaxEntries);
    this.cacheMaxEntries = parsedCacheMaxEntries === Number.POSITIVE_INFINITY
      ? AI_TITLE_MAX_CACHE_ENTRIES
      : Number.isFinite(parsedCacheMaxEntries)
        ? Math.min(AI_TITLE_MAX_CACHE_ENTRIES, Math.max(1, Math.floor(parsedCacheMaxEntries) || 128))
        : 128;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.diagnosticSink = diagnosticSink;
    this.inflight = 0;
    this.pending = new Map();
    this.cache = new Map();
    this.cacheEpoch = 0;
    this.aiQueue = [];
    this.imagePending = new Map();
    this.imageCache = new Map();
    this.imageCacheBytes = 0;
  }

  async resolveSettings(context) {
    const stored = this.settingsRepository
      ? await this.settingsRepository.get({ tenantId: context?.tenantId })
      : null;
    return stored || {
      apiUrl: this.apiUrl,
      apiKey: this.apiKey,
      model: this.model,
      modelUrl: this.modelUrl,
      keyHint: "",
      updatedAt: null,
    };
  }

  isConfigured(settings = null) {
    const value = settings || {
      apiUrl: this.apiUrl,
      apiKey: this.apiKey,
      model: this.model,
      modelUrl: this.modelUrl,
    };
    return validateAiTitleProviderSettings(value).valid && Boolean(value.apiKey);
  }

  async hasAccess(context) {
    if (isAdministrator(context)) return true;
    return this.repository.hasGrant({
      tenantId: context.tenantId,
      userId: context.userId,
      featureCode: AI_TITLE_FEATURE,
    });
  }

  async capabilities({ context } = {}) {
    const settings = await this.resolveSettings(context);
    return {
      feature: AI_TITLE_FEATURE,
      visible: await this.hasAccess(context),
      configured: this.isConfigured(settings),
      modelConfigured: Boolean(settings.model || settings.modelUrl),
    };
  }

  async getSettings({ context } = {}) {
    if (!isAdministrator(context)) {
      throw new AiTitleError("AI_TITLE_FORBIDDEN", "仅管理员可以配置 AI 标题服务", 403);
    }
    const settings = await this.resolveSettings(context);
    return {
      feature: AI_TITLE_FEATURE,
      apiUrl: settings.apiUrl,
      model: settings.model,
      modelUrl: settings.modelUrl,
      keyHint: settings.keyHint || "",
      configured: this.isConfigured(settings),
      modelConfigured: Boolean(settings.model || settings.modelUrl),
      updatedAt: settings.updatedAt,
    };
  }

  async saveSettings({ context, input = {} } = {}) {
    if (!isAdministrator(context)) {
      throw new AiTitleError("AI_TITLE_FORBIDDEN", "仅管理员可以配置 AI 标题服务", 403);
    }
    if (!this.settingsRepository) {
      throw new AiTitleError("AI_TITLE_SETTINGS_UNAVAILABLE", "AI 设置存储尚未启用，请联系部署管理员", 503);
    }
    await this.settingsRepository.save({
      tenantId: context.tenantId,
      configuredBy: context.userId,
      apiUrl: input.apiUrl,
      model: input.model,
      modelUrl: input.modelUrl,
      apiKey: input.apiKey,
    });
    this.cacheEpoch += 1;
    this.cache.clear();
    return this.getSettings({ context });
  }

  async suggest(args = {}) {
    const traceId = randomUUID();
    const startedAt = this.now();
    const diagnostics = {
      traceId,
      phase: "queued",
      cacheHit: false,
      imageDurationMs: null,
      providerDurationMs: null,
      imageCacheHit: false,
      imageCacheSource: null,
      queueWaitMs: null,
    };
    const cacheEpoch = this.cacheEpoch;
    const key = aiTitleCacheKey(args);
    const now = this.now();
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > now) {
      diagnostics.phase = "cache";
      diagnostics.cacheHit = true;
      diagnostics.durationMs = Math.max(0, this.now() - startedAt);
      this.cache.delete(key);
      this.cache.set(key, cached);
      const value = {
        ...cached.value,
        diagnostics: { ...diagnostics, source: "memory-cache" },
      };
      this.emitDiagnostic({ outcome: "cache_hit", ...value.diagnostics });
      return value;
    }
    if (cached) this.cache.delete(key);
    const pending = this.pending.get(key);
    if (pending) {
      this.emitDiagnostic({
        outcome: "deduplicated",
        traceId,
        phase: "deduplicated",
        cacheHit: false,
        durationMs: Math.max(0, this.now() - startedAt),
      });
      return pending;
    }
    const promise = this.performSuggest({ ...args, diagnostics })
      .then((value) => {
        const resultDiagnostics = {
          ...diagnostics,
          durationMs: Math.max(0, this.now() - startedAt),
          source: "provider",
        };
        const result = { ...value, diagnostics: resultDiagnostics };
        if (this.cacheTtlMs > 0 && this.cacheEpoch === cacheEpoch) {
          while (this.cache.size >= this.cacheMaxEntries) {
            const oldestKey = this.cache.keys().next().value;
            if (oldestKey === undefined) break;
            this.cache.delete(oldestKey);
          }
          this.cache.set(key, { value: result, expiresAt: this.now() + this.cacheTtlMs });
        }
        this.emitDiagnostic({ outcome: "success", ...resultDiagnostics });
        return result;
      })
      .catch((error) => {
        const resultDiagnostics = {
          ...diagnostics,
          durationMs: Math.max(0, this.now() - startedAt),
          source: diagnostics.phase === "provider" ? "provider" : "preflight",
        };
        if (error && typeof error === "object") {
          if (!error.traceId) error.traceId = traceId;
          if (!error.diagnostics) error.diagnostics = resultDiagnostics;
        }
        this.emitDiagnostic({
          outcome: "error",
          errorCode: String(error?.code || "AI_TITLE_FAILED"),
          status: Number(error?.status) || 500,
          ...resultDiagnostics,
        });
        throw error;
      })
      .finally(() => {
        this.pending.delete(key);
      });
    this.pending.set(key, promise);
    return promise;
  }

  emitDiagnostic(event = {}) {
    if (typeof this.diagnosticSink !== "function") return;
    try {
      this.diagnosticSink({
        event: "ai_title",
        ...event,
      });
    } catch {
      // Diagnostics must never affect the user-facing AI title request.
    }
  }

  removeImageCacheEntry(key) {
    const entry = this.imageCache.get(key);
    if (!entry) return;
    this.imageCache.delete(key);
    this.imageCacheBytes = Math.max(0, this.imageCacheBytes - entry.sizeBytes);
  }

  readImageCache(key) {
    const entry = this.imageCache.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.removeImageCacheEntry(key);
      return null;
    }
    // Map insertion order is used as a small LRU so hot images stay reusable.
    this.imageCache.delete(key);
    this.imageCache.set(key, entry);
    return entry.value;
  }

  storeImageCache(key, image) {
    if (this.imageCacheTtlMs <= 0) return;
    const sizeBytes = imageByteLength(image);
    if (!sizeBytes || sizeBytes > this.imageCacheMaxBytes) return;
    this.removeImageCacheEntry(key);
    while (
      this.imageCache.size >= this.imageCacheMaxEntries ||
      this.imageCacheBytes + sizeBytes > this.imageCacheMaxBytes
    ) {
      const oldestKey = this.imageCache.keys().next().value;
      if (oldestKey === undefined) break;
      this.removeImageCacheEntry(oldestKey);
    }
    this.imageCache.set(key, {
      value: image,
      sizeBytes,
      expiresAt: this.now() + this.imageCacheTtlMs,
    });
    this.imageCacheBytes += sizeBytes;
  }

  async readAiImage({ context, storeId, assetId, diagnostics } = {}) {
    const key = aiTitleImageCacheKey({ context, storeId, assetId });
    const cached = this.readImageCache(key);
    if (cached) {
      diagnostics.imageCacheHit = true;
      diagnostics.imageCacheSource = "memory";
      return cached;
    }

    let pending = this.imagePending.get(key);
    if (pending) {
      diagnostics.imageCacheHit = true;
      diagnostics.imageCacheSource = "inflight";
    } else {
      pending = (async () => {
        const image = await this.mediaService.readReadySheinImage({
          context,
          storeId,
          assetId,
        });
        this.storeImageCache(key, image);
        return image;
      })().finally(() => {
        if (this.imagePending.get(key) === pending) this.imagePending.delete(key);
      });
      this.imagePending.set(key, pending);
    }
    return pending;
  }

  acquireAiSlot(diagnostics) {
    if (this.inflight < this.maxConcurrent) {
      this.inflight += 1;
      diagnostics.queueWaitMs = 0;
      return Promise.resolve();
    }
    if (this.aiQueue.length >= this.maxQueue) {
      throw new AiTitleError("AI_TITLE_BUSY", "AI标题任务较多，请稍后再试", 429);
    }
    const queuedAt = this.now();
    return new Promise((resolve) => {
      this.aiQueue.push({ diagnostics, queuedAt, resolve });
    });
  }

  releaseAiSlot() {
    this.inflight = Math.max(0, this.inflight - 1);
    const next = this.aiQueue.shift();
    if (!next) return;
    this.inflight += 1;
    next.diagnostics.queueWaitMs = Math.max(0, this.now() - next.queuedAt);
    next.resolve();
  }

  async performSuggest({ context, storeId, input = {}, diagnostics = {} } = {}) {
    diagnostics.phase = "authorization";
    if (!(await this.hasAccess(context))) {
      throw new AiTitleError("AI_TITLE_FORBIDDEN", "当前账号未获得AI标题功能授权", 403);
    }
    diagnostics.phase = "configuration";
    const settings = await this.resolveSettings(context);
    if (!this.isConfigured(settings)) {
      throw new AiTitleError("AI_TITLE_NOT_CONFIGURED", "AI标题服务尚未配置，请联系管理员", 503);
    }
    const request = buildAiTitleRequest(input);
    if (!request.valid) throw new AiTitleError(request.code || "INVALID_AI_TITLE_INPUT", request.error, 400);
    diagnostics.phase = "capacity";
    await this.acquireAiSlot(diagnostics);
    try {
      diagnostics.phase = "image";
      const imageStartedAt = this.now();
      const image = await this.readAiImage({
        context,
        storeId,
        assetId: request.input.mainImageAssetId,
        diagnostics,
      });
      diagnostics.imageDurationMs = Math.max(0, this.now() - imageStartedAt);
      diagnostics.phase = "provider";
      const providerStartedAt = this.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      let response;
      try {
        response = await this.fetchImpl(settings.apiUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${settings.apiKey}`,
            "Content-Type": "application/json",
          },
          signal: controller.signal,
          body: JSON.stringify({
            model: settings.model || settings.modelUrl,
            temperature: 0.1,
            response_format: { type: "json_object" },
            messages: [
              {
                role: "system",
                content: '你是地毯图案识别器。只识别主图中地毯的图案，不能生成完整标题，不能猜测材质、尺寸、功能、品牌或营销词。只返回JSON：{"patternName":"不超过24个字符的简短图案名","confidence":0到1之间的数字,"warning":"无法确认时说明原因"}。看不清时patternName必须为空。',
              },
              {
                role: "user",
                content: [
                  { type: "text", text: "请识别这张商品主图中地毯的图案。" },
                  {
                    type: "image_url",
                    image_url: {
                      url: `data:${image.mimeType};base64,${Buffer.from(image.fileBytes).toString("base64")}`,
                    },
                  },
                ],
              },
            ],
          }),
        });
      } catch (error) {
        throw new AiTitleError(
          "AI_TITLE_UNAVAILABLE",
          error?.name === "AbortError" ? "AI标题识别超时，请稍后重试" : "AI标题识别服务暂时不可用",
          503,
        );
      } finally {
        clearTimeout(timeout);
      }
      diagnostics.providerDurationMs = Math.max(0, this.now() - providerStartedAt);
      if (!response.ok) {
        throw new AiTitleError("AI_TITLE_PROVIDER_FAILED", "AI标题识别服务返回失败，请稍后重试", 503);
      }
      const payload = await response.json().catch(() => ({}));
      const message = payload?.choices?.[0]?.message?.content;
      const parsed = parseJsonContent(message);
      const patternName = normalizeAiPatternName(parsed.patternName || parsed.pattern_name);
      if (!patternName) {
        throw new AiTitleError("AI_TITLE_UNCERTAIN", text(parsed.warning, 200) || "主图图案暂时无法可靠识别，请手动填写", 422);
      }
      const confidence = Number(parsed.confidence);
      return {
        feature: AI_TITLE_FEATURE,
        patternName,
        confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : null,
        warning: text(parsed.warning, 200),
        model: settings.model || settings.modelUrl,
      };
    } finally {
      this.releaseAiSlot();
    }
  }
}
