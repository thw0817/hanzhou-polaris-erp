import http from "node:http";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.js";
import { CloudDesktopClient } from "./cloud-desktop-client.js";
import { LocalCloudSessionVault } from "./cloud-session-vault.js";
import { EncryptedCredentialVault } from "./credential-vault.js";
import { decryptStoreSecretKey } from "./shein-crypto.js";
import { requestShein, SheinApiError } from "./shein-client.js";
import {
  normalizeProductSearch,
  summarizeProductDetail,
} from "./shein-product.js";
import { StoreRegistry } from "./store-registry.js";
import { TemplateRegistry } from "./template-registry.js";
import { SchemaCache } from "./schema-cache.js";
import { SizeTemplateRegistry } from "./size-template-registry.js";
import { AttributeTemplateRegistry } from "./attribute-template-registry.js";
import { MainImageTemplateRegistry } from "./main-image-template-registry.js";
import { LocalImageAssetStore } from "./local-image-assets.js";
import { runPublishPreflight } from "./publish-preflight.js";
import { BusinessDataCache } from "./business-data-cache.js";
import {
  summarizeStoreBusinessData,
  syncStoreBusinessData,
} from "./store-data-sync.js";
import {
  SHEIN_COMPLIANCE_BATCH_SIZE,
  summarizeComplianceRow,
  syncStoreComplianceData,
} from "./shein-compliance.js";
import { buildCompliancePreflight } from "./compliance-workflow.js";
import { fetchComplianceRuleBundle } from "./compliance-rules.js";
import {
  ComplianceWriteExecutor,
  createWriteConfirmationToken,
  verifyWriteConfirmationToken,
} from "./compliance-write-executor.js";
import {
  SHEIN_IMAGE_MAX_BYTES,
  SHEIN_IMAGE_MIME_TYPES,
  SHEIN_PRICE_PROOF_MAX_BYTES,
  SHEIN_PRICE_PROOF_MIME_TYPES,
  uploadSheinCertificateDirect,
  uploadSheinCompliancePhotoDirect,
  uploadSheinImageDirect,
  uploadSheinPriceProofDirect,
} from "./shein-upload.js";
import {
  SHEIN_CERTIFICATE_MAX_BYTES,
  SHEIN_CERTIFICATE_MIME_TYPES,
  SHEIN_PHOTO_MAX_BYTES,
  buildPhotoBindBody,
  SHEIN_COMPLIANCE_WRITE_PATHS,
} from "./compliance-write-contract.js";

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const CATEGORY_TREE_PATH = "/open-api/goods/query-category-tree";
const ATTRIBUTE_TEMPLATE_PATH = "/open-api/goods/query-attribute-template";
const PUBLISH_STANDARD_PATH = "/open-api/goods/query-publish-fill-in-standard";
const PRODUCT_SEARCH_PATH = "/open-api/goods/searchProduct";
const PRODUCT_DETAIL_PATH = "/open-api/goods/spu-info";
const TOKEN_EXCHANGE_PATH = "/open-api/auth/get-by-token";

function json(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json;charset=UTF-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (Buffer.byteLength(raw) > MAX_BODY_BYTES) {
      const error = new Error("请求体过大");
      error.status = 413;
      throw error;
    }
  }
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error("请求体不是有效 JSON");
    error.status = 400;
    throw error;
  }
}

async function readBytes(
  request,
  maxBytes = MAX_IMAGE_BYTES,
  tooLargeMessage = "图片文件超过 3MB",
) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) {
      const error = new Error(tooLargeMessage);
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function authorizeUrl(config, state) {
  const redirectUrl = config.localDirectAuthEnabled
    ? config.desktopAuthorizationRedirectUrl
    : config.redirectUrl;
  const params = new URLSearchParams({
    appid: config.appId,
    redirectUrl: Buffer.from(redirectUrl, "utf8").toString("base64"),
    state,
  });
  return `https://${config.authorizationHost}/#/empower?${params.toString()}`;
}

function countCategories(data) {
  let total = 0;
  let leaves = 0;
  const visit = (items) => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      total += 1;
      const children =
        item.children || item.childList || item.categoryList || item.subCategoryList || [];
      if (Array.isArray(children) && children.length) visit(children);
      else leaves += 1;
    }
  };
  visit(data);
  return { total, leaves };
}

function mergeRowsBySkc(existingRows, nextRows) {
  return Array.from(
    new Map(
      [...(existingRows || []), ...(nextRows || [])].map((row) => [
        row.skc,
        row,
      ]),
    ).values(),
  );
}

function publicComplianceJob(job, { includeDiagnostics = true } = {}) {
  if (!job) return null;
  const result = {
    id: job.id,
    type: "compliance-sync",
    storeId: job.storeId,
    mode: job.mode || "full",
    state: job.state,
    total: job.total,
    processed: job.processed,
    success: job.success,
    failed: job.failed,
    progress: job.total
      ? Math.round((job.processed / job.total) * 100)
      : 0,
    batchCount: job.batchCount,
    completedBatches: job.completedBatches,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
    error: job.error,
    failedSkcNames: job.failedSkcNames,
  };
  if (includeDiagnostics) result.diagnostics = job.diagnostics;
  return result;
}

function summarizeComplianceData(compliance) {
  if (!compliance) return null;
  return {
    count: Number(compliance.count || compliance.rows?.length || 0),
    syncedAt: compliance.syncedAt || null,
    failedSkcNames: compliance.failedSkcNames || [],
  };
}

function toClientComplianceData(compliance) {
  if (!compliance) return null;
  return {
    ...compliance,
    rows: (compliance.rows || []).map(summarizeComplianceRow),
    diagnostics: undefined,
  };
}

function toClientBusinessData(value) {
  if (!value) return null;
  return {
    ...value,
    compliance: toClientComplianceData(value.compliance),
  };
}

export function createSheinProxy({
  config = loadConfig(),
  registry,
  templateRegistry,
  sizeTemplateRegistry,
  attributeTemplateRegistry,
  mainImageTemplateRegistry,
  imageAssetStore,
  schemaCache,
  businessDataCache,
  cloudClient,
  fetchImpl = fetch,
} = {}) {
  const activeRegistry =
    registry ||
    new StoreRegistry({
      vault: new EncryptedCredentialVault({
        filePath: config.credentialFile,
        keyPath: config.credentialKeyFile,
        appId: config.appId,
        appSecret: config.appSecret,
      }),
    });
  const activeTemplateRegistry =
    templateRegistry || new TemplateRegistry({ filePath: config.templateFile });
  const activeSizeTemplateRegistry =
    sizeTemplateRegistry ||
    new SizeTemplateRegistry({
      filePath:
        config.sizeTemplateFile ||
        `${config.templateFile || ".data/shein-templates.v1.json"}.sizes`,
    });
  const activeAttributeTemplateRegistry =
    attributeTemplateRegistry ||
    new AttributeTemplateRegistry({
      filePath:
        config.attributeTemplateFile ||
        `${config.templateFile || ".data/shein-templates.v1.json"}.attributes`,
    });
  const activeMainImageTemplateRegistry =
    mainImageTemplateRegistry ||
    new MainImageTemplateRegistry({
      filePath:
        config.mainImageTemplateFile ||
        `${config.templateFile || ".data/shein-templates.v1.json"}.main-images`,
    });
  const activeImageAssetStore =
    imageAssetStore ||
    new LocalImageAssetStore({
      directory: config.mainImageAssetDir || ".data/main-image-assets",
    });
  const activeSchemaCache =
    schemaCache || new SchemaCache({ filePath: config.schemaCacheFile });
  const activeBusinessDataCache =
    businessDataCache ||
    new BusinessDataCache({ filePath: config.businessDataFile });
  const activeCloudClient =
    cloudClient ||
    (config.cloudApiBaseUrl
      ? new CloudDesktopClient({
          baseUrl: config.cloudApiBaseUrl,
          vault: new LocalCloudSessionVault({
            filePath: config.cloudSessionFile,
          }),
          fetchImpl,
        })
      : null);
  const authorizationExchanges = new Map();
  const storeSyncs = new Map();
  const complianceJobs = new Map();
  if (config.bootstrapStore) activeRegistry.upsertStore(config.bootstrapStore);

  const requestStoreShein = async ({ storeId, ...options }) => {
    try {
      return await requestShein(options);
    } catch (error) {
      if (String(error?.code || "") === "openapi00001") {
        activeRegistry.markReauthorizationRequired(storeId);
      }
      throw error;
    }
  };

  const exchangeLocalAuthorization = async ({ state, tempToken }) => {
    if (!config.appId || !config.appSecret) {
      const error = new Error("服务端应用凭证未配置");
      error.status = 503;
      throw error;
    }
    const existingExchange = authorizationExchanges.get(state);
    if (existingExchange) {
      if (existingExchange.tempToken !== tempToken) {
        const error = new Error("授权 state 与 tempToken 不匹配");
        error.status = 400;
        throw error;
      }
      return existingExchange.promise;
    }
    if (!activeRegistry.consumeAuthorizationState(state)) {
      const error = new Error("授权 state 无效或已过期，请重新发起授权");
      error.status = 400;
      throw error;
    }

    const exchangePromise = (async () => {
      const { payload, diagnostics } = await requestShein({
        baseUrl: config.apiBaseUrl,
        method: "POST",
        path: TOKEN_EXCHANGE_PATH,
        body: { tempToken },
        openKeyId: config.appId,
        secretKey: config.appSecret,
        identityHeader: "x-lt-appid",
        fetchImpl,
      });
      const secretKey = decryptStoreSecretKey(
        payload.info.secretKey,
        config.appSecret,
      );
      const store = activeRegistry.upsertStore({
        openKeyId: payload.info.openKeyId,
        secretKey,
        supplierId: payload.info.supplierId,
        businessMode: payload.info.supplierBusinessMode || "全托管",
        source: "authorization",
        status: "active",
      });

      return {
        store,
        diagnostics,
        message: "授权密钥已交换并写入本机加密凭证库",
      };
    })();

    authorizationExchanges.set(state, { tempToken, promise: exchangePromise });
    try {
      const result = await exchangePromise;
      const expiryTimer = setTimeout(
        () => authorizationExchanges.delete(state),
        10 * 60 * 1000,
      );
      expiryTimer.unref?.();
      return result;
    } catch (error) {
      authorizationExchanges.delete(state);
      throw error;
    }
  };

  const runComplianceJob = async ({
    job,
    store,
    skcNames,
    products,
    replaceRows,
  }) => {
    try {
      const result = await syncStoreComplianceData({
        skcNames,
        products,
        continueOnError: true,
          request: ({ method, path, body: requestBody }) =>
          requestStoreShein({
            storeId: job.storeId,
            baseUrl: config.apiBaseUrl,
            method,
            path,
            body: requestBody,
            openKeyId: store.openKeyId,
            secretKey: store.secretKey,
            timeoutMs: 60_000,
            fetchImpl,
          }),
        onBatch: async ({
          skcNames: batchSkcNames,
          rows,
          diagnostics,
          error,
        }) => {
          const currentRecord = activeBusinessDataCache.get(job.storeId);
          const currentCompliance = currentRecord?.value?.compliance || {};
          const mergedRows = mergeRowsBySkc(currentCompliance.rows, rows);
          job.processed += batchSkcNames.length;
          job.success += rows.length;
          job.failed += error ? batchSkcNames.length : 0;
          job.completedBatches += 1;
          job.updatedAt = new Date().toISOString();
          job.diagnostics.push(...diagnostics);
          if (error) {
            job.failedSkcNames.push(...batchSkcNames);
            job.diagnostics.push({
              endpoint: "batch",
              traceId: error.traceId || "",
              durationMs: 0,
              code: error.code || null,
              message: error.message,
            });
          }
          activeBusinessDataCache.set(
            job.storeId,
            {
              ...(currentRecord?.value || {}),
              compliance: {
                ...currentCompliance,
                rows: mergedRows,
                count: mergedRows.length,
                syncJob: publicComplianceJob(job, {
                  includeDiagnostics: false,
                }),
              },
            },
            {
              syncedAt: currentRecord?.syncedAt,
              persist:
                job.completedBatches % 5 === 0 || Boolean(error),
            },
          );
        },
      });

      const finalRecord = activeBusinessDataCache.get(job.storeId);
      const finalRows = replaceRows
        ? result.rows
        : mergeRowsBySkc(
            finalRecord?.value?.compliance?.rows,
            result.rows,
          );
      job.state = result.failedSkcNames.length
        ? "completed_with_errors"
        : "completed";
      job.completedAt = new Date().toISOString();
      job.updatedAt = job.completedAt;
      job.error = result.failedSkcNames.length
        ? `${result.failedSkcNames.length} 个 SKC 查询失败，可重新同步补齐`
        : null;
      const compliance = {
        ...(finalRecord?.value?.compliance || {}),
        rows: finalRows,
        count: finalRows.length,
        syncedAt: job.completedAt,
        diagnostics: {
          batchCount: job.batchCount,
          requests: job.diagnostics,
        },
        failedSkcNames: Array.from(new Set(job.failedSkcNames)),
        syncJob: publicComplianceJob(job),
      };
      activeBusinessDataCache.set(
        job.storeId,
        {
          ...(finalRecord?.value || {}),
          compliance,
        },
        { syncedAt: finalRecord?.syncedAt },
      );
    } catch (error) {
      job.state = "failed";
      job.error = error.message || "合规同步失败";
      job.completedAt = new Date().toISOString();
      job.updatedAt = job.completedAt;
      const currentRecord = activeBusinessDataCache.get(job.storeId);
      activeBusinessDataCache.set(
        job.storeId,
        {
          ...(currentRecord?.value || {}),
          compliance: {
            ...(currentRecord?.value?.compliance || {}),
            syncJob: publicComplianceJob(job),
          },
        },
        { syncedAt: currentRecord?.syncedAt },
      );
    }
  };

  return http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);

    try {
      if (
        request.method === "GET" &&
        url.pathname === "/api/shein/auth/callback"
      ) {
        const redirect = new URL(config.redirectUrl);
        const tempToken = String(url.searchParams.get("tempToken") || "").trim();
        const state = String(url.searchParams.get("state") || "").trim();
        try {
          if (!tempToken || !state) {
            throw new Error("SHEIN 授权回调缺少 tempToken 或 state");
          }
          const result = config.localDirectAuthEnabled
            ? await exchangeLocalAuthorization({ state, tempToken })
            : activeCloudClient
              ? await activeCloudClient.completeSheinAuthorization({
                  state,
                  tempToken,
                })
              : (() => {
                  throw new Error("尚未配置云端服务地址");
                })();
          const store = activeRegistry.upsertStore(result.store);
          redirect.searchParams.set("sheinAuthorized", "1");
          redirect.searchParams.set("storeLabel", store.label);
        } catch (error) {
          redirect.searchParams.set(
            "sheinAuthError",
            error.message || "SHEIN 授权失败",
          );
        }
        response.writeHead(302, {
          Location: redirect.toString(),
          "Cache-Control": "no-store",
        });
        response.end();
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/health") {
        return json(response, 200, {
          ok: true,
          configured: Boolean(config.appId && config.appSecret),
          appIdMasked: config.appId
            ? `${config.appId.slice(0, 6)}...${config.appId.slice(-4)}`
            : "",
          environment: config.environment,
          runtimeMode: config.runtimeMode,
          localDirectAuthEnabled: config.localDirectAuthEnabled,
          apiBaseUrl: config.apiBaseUrl,
          authorizationHost: config.authorizationHost,
          redirectUrl: config.redirectUrl,
          storeCount: activeRegistry.listStores().length,
          credentialsStorage:
            config.appId && config.appSecret ? "encrypted-file" : "server-memory",
        });
      }

      if (request.method === "GET" && url.pathname === "/api/cloud/session") {
        return json(
          response,
          200,
          activeCloudClient
            ? activeCloudClient.getLocalStatus()
            : {
                configured: false,
                connected: false,
                tenant: null,
                device: null,
                expiresAt: null,
                cloudBaseUrl: "",
              },
        );
      }

      if (request.method === "POST" && url.pathname === "/api/cloud/enroll") {
        if (!activeCloudClient) {
          return json(response, 503, {
            message: "尚未配置云端服务地址",
            code: "CLOUD_NOT_CONFIGURED",
          });
        }
        const body = await readJson(request);
        const code = String(body.code || "").trim();
        const deviceName = String(body.deviceName || "").trim();
        if (!code) {
          return json(response, 400, {
            message: "请输入设备连接码",
            code: "ENROLLMENT_CODE_REQUIRED",
          });
        }
        if (!deviceName || deviceName.length > 80) {
          return json(response, 400, {
            message: "设备名称需为 1 至 80 个字符",
            code: "DEVICE_NAME_INVALID",
          });
        }
        const status = await activeCloudClient.enroll({ code, deviceName });
        return json(response, 200, {
          ok: true,
          ...status,
        });
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/cloud/session/verify"
      ) {
        if (!activeCloudClient) {
          return json(response, 503, {
            message: "尚未配置云端服务地址",
            code: "CLOUD_NOT_CONFIGURED",
          });
        }
        const status = await activeCloudClient.verify();
        return json(response, 200, {
          ok: true,
          ...status,
        });
      }

      if (
        request.method === "DELETE" &&
        url.pathname === "/api/cloud/session"
      ) {
        if (!activeCloudClient) {
          return json(response, 200, {
            ok: true,
            configured: false,
            connected: false,
          });
        }
        const status = await activeCloudClient.disconnect();
        return json(response, 200, {
          ok: true,
          ...status,
        });
      }

      if (
        request.method === "GET" &&
        url.pathname === "/api/cloud/webhook-audits"
      ) {
        if (!activeCloudClient) {
          return json(response, 503, {
            message: "尚未配置云端服务地址",
            code: "CLOUD_NOT_CONFIGURED",
          });
        }
        const result = await activeCloudClient.listWebhookAudits({
          supplierId: url.searchParams.get("supplierId") || "",
          limit: url.searchParams.get("limit") || 50,
        });
        return json(response, 200, result);
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/shein/cloud-auth/start"
      ) {
        if (!activeCloudClient) {
          return json(response, 503, {
            message: "尚未配置云端服务地址",
            code: "CLOUD_NOT_CONFIGURED",
          });
        }
        const body = await readJson(request);
        const deviceName = String(body.deviceName || "").trim();
        if (!deviceName || deviceName.length > 120) {
          return json(response, 400, {
            message: "设备名称需为 1 至 120 个字符",
            code: "DEVICE_NAME_INVALID",
          });
        }
        const result = await activeCloudClient.startSheinAuthorization({
          deviceName,
        });
        return json(response, 200, {
          ok: true,
          url: result.authorizationUrl,
          expiresAt: result.expiresAt,
        });
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/shein/cloud-auth/complete"
      ) {
        if (!activeCloudClient) {
          return json(response, 503, {
            message: "尚未配置云端服务地址",
            code: "CLOUD_NOT_CONFIGURED",
          });
        }
        const body = await readJson(request);
        const state = String(body.state || "").trim();
        const tempToken = String(body.tempToken || "").trim();
        const deviceName = String(body.deviceName || "").trim();
        if (!state || !tempToken) {
          return json(response, 400, {
            message: "SHEIN 授权回调缺少 tempToken 或 state",
            code: "AUTHORIZATION_CALLBACK_INVALID",
          });
        }
        const result = await activeCloudClient.completeSheinAuthorization({
          state,
          tempToken,
          deviceName,
        });
        const store = activeRegistry.upsertStore(result.store);
        return json(response, 200, {
          ok: true,
          store,
          cloud: result.status,
          diagnostics: result.diagnostics,
        });
      }

      if (request.method === "GET" && url.pathname === "/api/shein/stores") {
        return json(response, 200, { stores: activeRegistry.listStores() });
      }

      const storeRenameMatch = url.pathname.match(
        /^\/api\/shein\/stores\/([^/]+)$/,
      );
      if (request.method === "PATCH" && storeRenameMatch) {
        const id = decodeURIComponent(storeRenameMatch[1]);
        if (!activeRegistry.getStore(id)) {
          return json(response, 404, {
            message: "未找到已连接店铺",
            code: "STORE_NOT_FOUND",
          });
        }
        const body = await readJson(request);
        const label = String(body.label || "").trim().replace(/\s+/g, " ");
        if (!label || label.length > 40) {
          return json(response, 400, {
            message: "店铺名称需为1至40个字符",
            code: "INVALID_STORE_LABEL",
          });
        }
        return json(response, 200, {
          store: activeRegistry.renameStore(id, label),
        });
      }

      const storeDataMatch = url.pathname.match(
        /^\/api\/shein\/stores\/([^/]+)\/data$/,
      );
      if (request.method === "GET" && storeDataMatch) {
        const id = decodeURIComponent(storeDataMatch[1]);
        if (!activeRegistry.getStore(id)) {
          return json(response, 404, { message: "未找到已连接店铺" });
        }
        const record = activeBusinessDataCache.get(id);
        const summaryOnly = url.searchParams.get("summary") === "1";
        return json(response, 200, {
          ok: true,
          synced: Boolean(record),
          syncedAt: record?.syncedAt || null,
          data: summaryOnly
            ? summarizeStoreBusinessData(record?.value)
            : toClientBusinessData(record?.value),
        });
      }

      const storeSyncMatch = url.pathname.match(
        /^\/api\/shein\/stores\/([^/]+)\/sync$/,
      );
      if (request.method === "POST" && storeSyncMatch) {
        const id = decodeURIComponent(storeSyncMatch[1]);
        const store = activeRegistry.getStore(id);
        if (!store) return json(response, 404, { message: "未找到已连接店铺" });
        const existingCompliance =
          activeBusinessDataCache.get(id)?.value?.compliance || null;
        let syncPromise = storeSyncs.get(id);
        if (!syncPromise) {
          syncPromise = syncStoreBusinessData({
            request: ({ method, path, body }) =>
              requestStoreShein({
                storeId: id,
                baseUrl: config.apiBaseUrl,
                method,
                path,
                body,
                openKeyId: store.openKeyId,
                secretKey: store.secretKey,
                fetchImpl,
              }),
          }).finally(() => storeSyncs.delete(id));
          storeSyncs.set(id, syncPromise);
        }
        const businessSnapshot = await syncPromise;
        const snapshot = existingCompliance
          ? { ...businessSnapshot, compliance: existingCompliance }
          : businessSnapshot;
        const record = activeBusinessDataCache.set(id, snapshot);
        return json(response, 200, {
          ok: true,
          synced: true,
          syncedAt: record.syncedAt,
          data: snapshot,
        });
      }

      const storeComplianceMatch = url.pathname.match(
        /^\/api\/shein\/stores\/([^/]+)\/compliance$/,
      );
      if (request.method === "GET" && storeComplianceMatch) {
        const id = decodeURIComponent(storeComplianceMatch[1]);
        if (!activeRegistry.getStore(id)) {
          return json(response, 404, { message: "未找到已连接店铺" });
        }
        const record = activeBusinessDataCache.get(id);
        const requestedSkc = String(url.searchParams.get("skc") || "").trim();
        if (requestedSkc) {
          const row = record?.value?.compliance?.rows?.find(
            (item) => item.skc === requestedSkc,
          );
          if (!row) {
            return json(response, 404, {
              message: "当前合规缓存中未找到该 SKC",
            });
          }
          return json(response, 200, {
            ok: true,
            synced: true,
            syncedAt: record?.value?.compliance?.syncedAt || null,
            data: row,
          });
        }
        return json(response, 200, {
          ok: true,
          synced: Boolean(record?.value?.compliance),
          syncedAt: record?.value?.compliance?.syncedAt || null,
          data: toClientComplianceData(record?.value?.compliance),
          job: publicComplianceJob(complianceJobs.get(id)),
        });
      }

      const storeComplianceSyncStatusMatch = url.pathname.match(
        /^\/api\/shein\/stores\/([^/]+)\/compliance\/sync\/status$/,
      );
      if (request.method === "GET" && storeComplianceSyncStatusMatch) {
        const id = decodeURIComponent(storeComplianceSyncStatusMatch[1]);
        if (!activeRegistry.getStore(id)) {
          return json(response, 404, { message: "未找到已连接店铺" });
        }
        const record = activeBusinessDataCache.get(id);
        let job =
          complianceJobs.get(id) ||
          record?.value?.compliance?.syncJob ||
          null;
        if (!complianceJobs.has(id) && job?.state === "running") {
          const interruptedAt = new Date().toISOString();
          job = {
            ...job,
            state: "interrupted",
            error: "本地服务曾重启，本次任务已中断；可重新同步继续补齐",
            updatedAt: interruptedAt,
            completedAt: interruptedAt,
          };
          activeBusinessDataCache.set(
            id,
            {
              ...(record?.value || {}),
              compliance: {
                ...(record?.value?.compliance || {}),
                syncJob: job,
              },
            },
            { syncedAt: record?.syncedAt },
          );
        }
        return json(response, 200, {
          ok: true,
          job: publicComplianceJob(job, {
            includeDiagnostics: job?.state !== "running",
          }),
          data: summarizeComplianceData(record?.value?.compliance),
        });
      }

      const storeCompliancePreflightMatch = url.pathname.match(
        /^\/api\/shein\/stores\/([^/]+)\/compliance\/preflight$/,
      );
      if (request.method === "POST" && storeCompliancePreflightMatch) {
        const id = decodeURIComponent(storeCompliancePreflightMatch[1]);
        if (!activeRegistry.getStore(id)) {
          return json(response, 404, { message: "未找到已连接店铺" });
        }
        const body = await readJson(request);
        const record = activeBusinessDataCache.get(id);
        const complianceRows = record?.value?.compliance?.rows || [];
        const requestedSkcList = Array.isArray(body.skcList)
          ? Array.from(
              new Set(
                body.skcList
                  .map((value) => String(value || "").trim())
                  .filter(Boolean),
              ),
            )
          : [];
        const rows = requestedSkcList.length
          ? complianceRows.filter((row) => requestedSkcList.includes(row.skc))
          : complianceRows;
        if (!rows.length) {
          return json(response, 409, {
            message: requestedSkcList.length
              ? "当前合规缓存中未找到所选SKC"
              : "当前没有可预检的合规数据，请先同步合规要求",
          });
        }
        const missingSkcList = requestedSkcList.filter(
          (skc) => !rows.some((row) => row.skc === skc),
        );
        if (missingSkcList.length) {
          return json(response, 409, {
            message: "部分SKC尚未同步合规详情",
            missingSkcList,
          });
        }

        let template = null;
        if (body.templateId) {
          template = activeTemplateRegistry.get(body.templateId);
          if (
            !template ||
            template.storeId !== id ||
            template.templateType !== "compliance"
          ) {
            return json(response, 400, {
              message: "未找到当前店铺可用的合规模板",
            });
          }
        }
        const result = buildCompliancePreflight({
          rows,
          template,
          inputsBySkc: body.inputsBySkc,
        });
        return json(response, 200, {
          ok: true,
          mode: "dry-run",
          syncedAt: record?.value?.compliance?.syncedAt || null,
          ...result,
        });
      }

      const storeComplianceRulesMatch = url.pathname.match(
        /^\/api\/shein\/stores\/([^/]+)\/compliance\/rules$/,
      );
      if (request.method === "POST" && storeComplianceRulesMatch) {
        const id = decodeURIComponent(storeComplianceRulesMatch[1]);
        const store = activeRegistry.getStore(id);
        if (!store) {
          return json(response, 404, { message: "未找到已连接店铺" });
        }
        const body = await readJson(request);
        const skc = String(body.skc || "").trim();
        if (!skc) {
          return json(response, 400, { message: "请提供要读取规则的SKC" });
        }
        const record = activeBusinessDataCache.get(id);
        const row = record?.value?.compliance?.rows?.find(
          (item) => item.skc === skc,
        );
        if (!row) {
          return json(response, 409, {
            message: "当前合规缓存中未找到该SKC，请先同步合规要求",
          });
        }
        const bundle = await fetchComplianceRuleBundle({
          row,
          request: ({ method, path, body: requestBody }) =>
            requestStoreShein({
              storeId: id,
              baseUrl: config.apiBaseUrl,
              method,
              path,
              body: requestBody,
              openKeyId: store.openKeyId,
              secretKey: store.secretKey,
              timeoutMs: 60_000,
              fetchImpl,
            }),
        });
        return json(response, 200, {
          ok: true,
          mode: "read-only",
          data: bundle,
        });
      }

      const storeComplianceExecuteMatch = url.pathname.match(
        /^\/api\/shein\/stores\/([^/]+)\/compliance\/execute$/,
      );
      const storeCompliancePhotoBindMatch = url.pathname.match(
        /^\/api\/shein\/stores\/([^/]+)\/compliance\/photos\/bind$/,
      );
      if (request.method === "POST" && storeCompliancePhotoBindMatch) {
        const id = decodeURIComponent(storeCompliancePhotoBindMatch[1]);
        const store = activeRegistry.getStore(id);
        if (!store) {
          return json(response, 404, { message: "未找到已连接店铺" });
        }
        const body = await readJson(request);
        const bindBody = buildPhotoBindBody(body.payload);
        const confirmationPlan = {
          method: "POST",
          path: SHEIN_COMPLIANCE_WRITE_PATHS.photoBind,
          body: bindBody,
        };
        const writesEnabled =
          config.complianceWritesEnabled === true &&
          Boolean(config.complianceConfirmationSecret);
        if (body.execute !== true) {
          return json(response, 200, {
            ok: true,
            mode: "dry-run",
            externalWrite: false,
            requestPath: SHEIN_COMPLIANCE_WRITE_PATHS.photoBind,
            payload: bindBody,
            confirmationRequired: true,
            confirmationToken: writesEnabled
              ? createWriteConfirmationToken({
                  plan: confirmationPlan,
                  secret: config.complianceConfirmationSecret,
                })
              : null,
            writesEnabled,
          });
        }
        if (!writesEnabled) {
          return json(response, 409, {
            code: "WRITE_DISABLED",
            msg: "真实合规写入开关未开启；请在本地 .env 同时配置写入开关和确认密钥",
          });
        }
        if (!verifyWriteConfirmationToken({
          plan: confirmationPlan,
          secret: config.complianceConfirmationSecret,
          token: body.confirmationToken,
        })) {
          return json(response, 409, {
            code: "CONFIRMATION_REQUIRED",
            msg: "实拍图绑定载荷已变化，请重新确认后提交",
          });
        }
        const { payload, diagnostics } = await requestStoreShein({
          storeId: id,
          baseUrl: config.apiBaseUrl,
          method: "POST",
          path: SHEIN_COMPLIANCE_WRITE_PATHS.photoBind,
          body: bindBody,
          openKeyId: store.openKeyId,
          secretKey: store.secretKey,
          timeoutMs: 60_000,
          fetchImpl,
        });
        const info = payload.info || {};
        if (Number(info.faildCount || 0) > 0 || (info.faildList || []).length) {
          const failureSummary = (info.faildList || [])
            .map((item) => `${item.skc || "未知SKC"}：${item.reason || item.code || "绑定失败"}`)
            .join("；");
          return json(response, 409, {
            code: "SHEIN_PHOTO_BIND_PARTIAL_FAILURE",
            msg: failureSummary
              ? `SHEIN 实拍图绑定失败：${failureSummary}`
              : "SHEIN 实拍图绑定存在失败的 SKC",
            externalWrite: true,
            info,
            traceId: diagnostics.traceId || payload.traceId || null,
          });
        }
        return json(response, 200, {
          ok: true,
          mode: "executed",
          externalWrite: true,
          requestPath: SHEIN_COMPLIANCE_WRITE_PATHS.photoBind,
          info,
          traceId: diagnostics.traceId || payload.traceId || null,
        });
      }
      if (request.method === "POST" && storeComplianceExecuteMatch) {
        const id = decodeURIComponent(storeComplianceExecuteMatch[1]);
        const store = activeRegistry.getStore(id);
        if (!store) {
          return json(response, 404, { message: "未找到已连接店铺" });
        }
        const body = await readJson(request);
        const record = activeBusinessDataCache.get(id);
        const complianceRows = record?.value?.compliance?.rows || [];
        const requestedSkcList = Array.isArray(body.skcList)
          ? Array.from(
              new Set(
                body.skcList
                  .map((value) => String(value || "").trim())
                  .filter(Boolean),
              ),
            )
          : [];
        const rows = requestedSkcList.length
          ? complianceRows.filter((row) => requestedSkcList.includes(row.skc))
          : complianceRows;
        if (!rows.length) {
          return json(response, 409, {
            message: requestedSkcList.length
              ? "当前合规缓存中未找到所选SKC"
              : "当前没有可执行的合规数据，请先同步合规要求",
          });
        }
        const missingSkcList = requestedSkcList.filter(
          (skc) => !rows.some((row) => row.skc === skc),
        );
        if (missingSkcList.length) {
          return json(response, 409, {
            message: "部分SKC尚未同步合规详情",
            missingSkcList,
          });
        }

        let template = null;
        if (body.templateId) {
          template = activeTemplateRegistry.get(body.templateId);
          if (
            !template ||
            template.storeId !== id ||
            template.templateType !== "compliance"
          ) {
            return json(response, 400, {
              message: "未找到当前店铺可用的合规模板",
            });
          }
        }
        const preflight = buildCompliancePreflight({
          rows,
          template,
          inputsBySkc: body.inputsBySkc,
        });
        const requestUpstream = ({ method, path, body: requestBody }) =>
          requestStoreShein({
            storeId: id,
            baseUrl: config.apiBaseUrl,
            method,
            path,
            body: requestBody,
            openKeyId: store.openKeyId,
            secretKey: store.secretKey,
            timeoutMs: 60_000,
            fetchImpl,
          });
        const executor = new ComplianceWriteExecutor({
          enabled:
            config.complianceWritesEnabled === true &&
            Boolean(config.complianceConfirmationSecret),
          confirmationSecret: config.complianceConfirmationSecret,
          request: requestUpstream,
          verify: async ({ plans }) => {
            const skcNames = plans
              .filter((plan) => plan.status === "ready")
              .map((plan) => plan.skc);
            const verification = await syncStoreComplianceData({
              skcNames,
              products: record?.value?.products || [],
              request: requestUpstream,
            });
            const latestRecord = activeBusinessDataCache.get(id);
            const mergedRows = mergeRowsBySkc(
              latestRecord?.value?.compliance?.rows,
              verification.rows,
            );
            activeBusinessDataCache.set(
              id,
              {
                ...(latestRecord?.value || {}),
                compliance: {
                  ...(latestRecord?.value?.compliance || {}),
                  rows: mergedRows,
                  count: mergedRows.length,
                  syncedAt: new Date().toISOString(),
                  failedSkcNames: verification.failedSkcNames || [],
                  diagnostics: verification.diagnostics,
                },
              },
              { syncedAt: latestRecord?.syncedAt },
            );
            return {
              rows: verification.rows.map(summarizeComplianceRow),
              diagnostics: verification.diagnostics,
              failedSkcNames: verification.failedSkcNames || [],
            };
          },
        });
        const result = await executor.execute({
          plans: preflight.plans,
          execute: body.execute === true,
          confirmationToken: String(body.confirmationToken || ""),
        });
        const confirmationToken =
          body.execute !== true &&
          config.complianceWritesEnabled === true &&
          config.complianceConfirmationSecret
            ? createWriteConfirmationToken({
                plan: preflight.plans,
                secret: config.complianceConfirmationSecret,
              })
            : null;
        return json(
          response,
          body.execute === true && result.executed !== true ? 409 : 200,
          {
            ok: result.executed === true || body.execute !== true,
            preflight,
            confirmationRequired: true,
            confirmationToken,
            ...result,
          },
        );
      }

      const storeComplianceSyncMatch = url.pathname.match(
        /^\/api\/shein\/stores\/([^/]+)\/compliance\/sync$/,
      );
      if (request.method === "POST" && storeComplianceSyncMatch) {
        const id = decodeURIComponent(storeComplianceSyncMatch[1]);
        const store = activeRegistry.getStore(id);
        if (!store) return json(response, 404, { message: "未找到已连接店铺" });
        const record = activeBusinessDataCache.get(id);
        const products = record?.value?.products || [];
        const body = await readJson(request);
        const requestedSkcList = Array.isArray(body.skcList)
          ? body.skcList.map((value) => String(value || "").trim()).filter(Boolean)
          : [];
        const retryFailed = body.retryFailed === true;
        const previousFailedSkcNames = Array.isArray(
          record?.value?.compliance?.failedSkcNames,
        )
          ? record.value.compliance.failedSkcNames
          : [];
        const syncMode = requestedSkcList.length
          ? "selected"
          : retryFailed
            ? "retry-failed"
            : "full";
        const skcNames = Array.from(
          new Set(
            requestedSkcList.length
              ? requestedSkcList
              : retryFailed
                ? previousFailedSkcNames
                : products.map((product) => product.skc).filter(Boolean),
          ),
        );
        if (!skcNames.length) {
          return json(response, 409, {
            message: retryFailed
              ? "当前没有失败的 SKC 需要重试"
              : "当前店铺没有可查询的 SKC，请先同步店铺商品",
          });
        }
        if (skcNames.length > 5000) {
          return json(response, 400, {
            message: "单次合规同步最多处理 5000 个 SKC",
          });
        }

        const activeJob = complianceJobs.get(id);
        if (activeJob?.state === "running") {
          return json(response, 202, {
            ok: true,
            started: false,
            message: "当前店铺已有合规同步任务运行中",
            job: publicComplianceJob(activeJob, {
              includeDiagnostics: false,
            }),
            data: summarizeComplianceData(record?.value?.compliance),
          });
        }

        const startedAt = new Date().toISOString();
        const job = {
          id: `compliance-${id}-${Date.now()}`,
          storeId: id,
          mode: syncMode,
          state: "running",
          total: skcNames.length,
          processed: 0,
          success: 0,
          failed: 0,
          batchCount: Math.ceil(
            skcNames.length / SHEIN_COMPLIANCE_BATCH_SIZE,
          ),
          completedBatches: 0,
          startedAt,
          updatedAt: startedAt,
          completedAt: null,
          error: null,
          failedSkcNames: [],
          diagnostics: [],
        };
        complianceJobs.set(id, job);
        activeBusinessDataCache.set(
          id,
          {
            ...(record?.value || {}),
            compliance: {
              ...(record?.value?.compliance || {}),
              syncJob: publicComplianceJob(job, {
                includeDiagnostics: false,
              }),
            },
          },
          { syncedAt: record?.syncedAt },
        );
        void runComplianceJob({
          job,
          store,
          skcNames,
          products,
          replaceRows: syncMode === "full",
        });
        return json(response, 202, {
          ok: true,
          started: true,
          job: publicComplianceJob(job, {
            includeDiagnostics: false,
          }),
          data: summarizeComplianceData(record?.value?.compliance),
        });
      }

      if (request.method === "GET" && url.pathname === "/api/templates") {
        return json(response, 200, {
          templates: activeTemplateRegistry.list({
            storeId: url.searchParams.get("storeId") || undefined,
            type: url.searchParams.get("type") || undefined,
          }),
        });
      }

      if (request.method === "GET" && url.pathname === "/api/size-templates") {
        return json(response, 200, {
          templates: activeSizeTemplateRegistry.list({
            storeId: url.searchParams.get("storeId") || undefined,
            productTypeId:
              url.searchParams.get("productTypeId") || undefined,
          }),
        });
      }

      if (
        request.method === "GET" &&
        url.pathname === "/api/attribute-templates"
      ) {
        return json(response, 200, {
          templates: activeAttributeTemplateRegistry.list({
            storeId: url.searchParams.get("storeId") || undefined,
            productTypeId:
              url.searchParams.get("productTypeId") || undefined,
          }),
        });
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/attribute-templates"
      ) {
        const input = await readJson(request);
        if (!activeRegistry.getStore(input.storeId)) {
          return json(response, 400, {
            message: "商品属性模板绑定的店铺尚未授权",
          });
        }
        return json(response, 201, {
          template: activeAttributeTemplateRegistry.save(input),
        });
      }

      const attributeTemplateMatch = url.pathname.match(
        /^\/api\/attribute-templates\/([^/]+)$/,
      );
      if (request.method === "PUT" && attributeTemplateMatch) {
        const id = decodeURIComponent(attributeTemplateMatch[1]);
        const existing = activeAttributeTemplateRegistry.get(id);
        if (!existing) {
          return json(response, 404, {
            message: "未找到要更新的商品属性模板",
          });
        }
        const input = await readJson(request);
        return json(response, 200, {
          template: activeAttributeTemplateRegistry.save({
            ...input,
            id,
            storeId: existing.storeId,
          }),
        });
      }

      if (request.method === "DELETE" && attributeTemplateMatch) {
        const removed = activeAttributeTemplateRegistry.remove(
          decodeURIComponent(attributeTemplateMatch[1]),
        );
        return json(response, removed ? 200 : 404, {
          ok: removed,
          message: removed
            ? "商品属性模板已删除"
            : "未找到商品属性模板",
        });
      }

      if (
        request.method === "GET" &&
        url.pathname === "/api/main-image-templates"
      ) {
        return json(response, 200, {
          templates: activeMainImageTemplateRegistry.list({
            storeId: url.searchParams.get("storeId") || undefined,
          }),
        });
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/main-image-templates"
      ) {
        const input = await readJson(request);
        if (!activeRegistry.getStore(input.storeId)) {
          return json(response, 400, { message: "主图模板绑定的店铺尚未授权" });
        }
        return json(response, 201, {
          template: activeMainImageTemplateRegistry.save(input),
        });
      }

      const mainImageTemplateMatch = url.pathname.match(
        /^\/api\/main-image-templates\/([^/]+)$/,
      );
      if (request.method === "PUT" && mainImageTemplateMatch) {
        const id = decodeURIComponent(mainImageTemplateMatch[1]);
        const existing = activeMainImageTemplateRegistry.get(id);
        if (!existing) {
          return json(response, 404, { message: "未找到要更新的主图模板" });
        }
        const input = await readJson(request);
        return json(response, 200, {
          template: activeMainImageTemplateRegistry.save({
            ...input,
            id,
            storeId: existing.storeId,
          }),
        });
      }

      if (request.method === "DELETE" && mainImageTemplateMatch) {
        const removed = activeMainImageTemplateRegistry.remove(
          decodeURIComponent(mainImageTemplateMatch[1]),
        );
        return json(response, removed ? 200 : 404, {
          ok: removed,
          message: removed ? "主图模板已删除" : "未找到主图模板",
        });
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/main-image-assets"
      ) {
        const mimeType = String(request.headers["content-type"] || "")
          .split(";")[0]
          .trim()
          .toLowerCase();
        const encodedName = String(request.headers["x-file-name"] || "");
        const originalName = encodedName
          ? decodeURIComponent(encodedName)
          : "image";
        const bytes = await readBytes(request);
        if (!bytes.length) {
          return json(response, 400, { message: "未读取到图片文件" });
        }
        return json(response, 201, {
          asset: activeImageAssetStore.save({
            bytes,
            mimeType,
            originalName,
          }),
        });
      }

      const localImageMatch = url.pathname.match(
        /^\/api\/local-assets\/main-images\/([^/]+)$/,
      );
      if (request.method === "GET" && localImageMatch) {
        const asset = activeImageAssetStore.get(
          decodeURIComponent(localImageMatch[1]),
        );
        if (!asset) return json(response, 404, { message: "图片不存在" });
        response.writeHead(200, {
          "Content-Type": asset.mimeType,
          "Content-Length": asset.bytes.length,
          "Cache-Control": "private, max-age=31536000, immutable",
        });
        response.end(asset.bytes);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/size-templates") {
        const input = await readJson(request);
        if (!activeRegistry.getStore(input.storeId)) {
          return json(response, 400, { message: "尺寸模板绑定的店铺尚未授权" });
        }
        return json(response, 201, {
          template: activeSizeTemplateRegistry.save(input),
        });
      }

      const sizeTemplateMatch = url.pathname.match(
        /^\/api\/size-templates\/([^/]+)$/,
      );
      if (request.method === "PUT" && sizeTemplateMatch) {
        const id = decodeURIComponent(sizeTemplateMatch[1]);
        const existing = activeSizeTemplateRegistry.get(id);
        if (!existing) {
          return json(response, 404, { message: "未找到要更新的尺寸模板" });
        }
        const input = await readJson(request);
        return json(response, 200, {
          template: activeSizeTemplateRegistry.save({
            ...input,
            id,
            storeId: existing.storeId,
          }),
        });
      }

      if (request.method === "DELETE" && sizeTemplateMatch) {
        const removed = activeSizeTemplateRegistry.remove(
          decodeURIComponent(sizeTemplateMatch[1]),
        );
        return json(response, removed ? 200 : 404, {
          ok: removed,
          message: removed ? "尺寸模板已删除" : "未找到尺寸模板",
        });
      }

      if (request.method === "POST" && url.pathname === "/api/templates") {
        const input = await readJson(request);
        if (!activeRegistry.getStore(input.storeId)) {
          return json(response, 400, { message: "模板绑定的店铺尚未授权" });
        }
        return json(response, 201, {
          template: activeTemplateRegistry.save(input),
        });
      }

      const templateMatch = url.pathname.match(/^\/api\/templates\/([^/]+)$/);
      if (request.method === "PUT" && templateMatch) {
        const id = decodeURIComponent(templateMatch[1]);
        const input = await readJson(request);
        const existing = activeTemplateRegistry.get(id);
        if (!existing) return json(response, 404, { message: "未找到要更新的模板" });
        if (!activeRegistry.getStore(existing.storeId)) {
          return json(response, 400, { message: "模板绑定的店铺尚未授权" });
        }
        return json(response, 200, {
          template: activeTemplateRegistry.save({
            ...input,
            id,
            storeId: existing.storeId,
            templateType: existing.templateType,
          }),
        });
      }

      if (request.method === "DELETE" && templateMatch) {
        const removed = activeTemplateRegistry.remove(
          decodeURIComponent(templateMatch[1]),
        );
        return json(response, removed ? 200 : 404, {
          ok: removed,
          message: removed ? "模板已删除" : "未找到模板",
        });
      }

      if (request.method === "POST" && url.pathname === "/api/shein/auth/url") {
        if (!config.appId || !config.appSecret) {
          return json(response, 503, {
            message: "服务端尚未配置 SHEIN_APP_ID 与 SHEIN_APP_SECRET",
          });
        }
        const state = activeRegistry.createAuthorizationState();
        return json(response, 200, {
          url: authorizeUrl(config, state),
          redirectUrl: config.redirectUrl,
        });
      }

      if (request.method === "POST" && url.pathname === "/api/shein/auth/exchange") {
        const { tempToken, state } = await readJson(request);
        if (!tempToken || !state) {
          return json(response, 400, { message: "tempToken 与 state 均为必填" });
        }
        return json(
          response,
          200,
          await exchangeLocalAuthorization({ state, tempToken }),
        );
      }

      const testMatch = url.pathname.match(/^\/api\/shein\/stores\/([^/]+)\/test$/);
      if (request.method === "POST" && testMatch) {
        const id = decodeURIComponent(testMatch[1]);
        const store = activeRegistry.getStore(id);
        if (!store) return json(response, 404, { message: "未找到已连接店铺" });

        const { payload, diagnostics } = await requestStoreShein({
          storeId: id,
          baseUrl: config.apiBaseUrl,
          method: "POST",
          path: CATEGORY_TREE_PATH,
          body: {},
          openKeyId: store.openKeyId,
          secretKey: store.secretKey,
          fetchImpl,
        });
        const categoryData = payload.info?.data || payload.info?.list || [];
        const counts = countCategories(categoryData);

        return json(response, 200, {
          ok: true,
          endpoint: CATEGORY_TREE_PATH,
          categoryCount: counts.total,
          leafCategoryCount: counts.leaves,
          diagnostics,
        });
      }

      const categoryMatch = url.pathname.match(
        /^\/api\/shein\/stores\/([^/]+)\/template\/categories$/,
      );
      if (request.method === "POST" && categoryMatch) {
        const id = decodeURIComponent(categoryMatch[1]);
        const store = activeRegistry.getStore(id);
        if (!store) return json(response, 404, { message: "未找到已连接店铺" });
        const { force = false } = await readJson(request);
        const cached = !force
          ? activeSchemaCache.get(id, "categories")
          : null;
        if (cached) {
          return json(response, 200, {
            ok: true,
            ...cached.value,
            cached: true,
            cachedAt: cached.cachedAt,
          });
        }

        const { payload, diagnostics } = await requestStoreShein({
          storeId: id,
          baseUrl: config.apiBaseUrl,
          method: "POST",
          path: CATEGORY_TREE_PATH,
          body: {},
          openKeyId: store.openKeyId,
          secretKey: store.secretKey,
          fetchImpl,
        });
        const categoryData = payload.info?.data || payload.info?.list || [];
        const counts = countCategories(categoryData);
        const result = {
          ok: true,
          info: { data: categoryData },
          categoryCount: counts.total,
          leafCategoryCount: counts.leaves,
          diagnostics,
        };
        const record = activeSchemaCache.set(id, "categories", "default", result);
        return json(response, 200, {
          ...result,
          cached: false,
          cachedAt: record.cachedAt,
        });
      }

      const attributeMatch = url.pathname.match(
        /^\/api\/shein\/stores\/([^/]+)\/template\/attributes$/,
      );
      if (request.method === "POST" && attributeMatch) {
        const id = decodeURIComponent(attributeMatch[1]);
        const store = activeRegistry.getStore(id);
        if (!store) return json(response, 404, { message: "未找到已连接店铺" });
        const { productTypeId, force = false } = await readJson(request);
        if (!productTypeId) {
          return json(response, 400, { message: "productTypeId 必填" });
        }
        const cached = !force
          ? activeSchemaCache.get(id, "attributes", productTypeId)
          : null;
        if (cached) {
          return json(response, 200, {
            ok: true,
            info: cached.value,
            cached: true,
            cachedAt: cached.cachedAt,
          });
        }
        const { payload, diagnostics } = await requestStoreShein({
          storeId: id,
          baseUrl: config.apiBaseUrl,
          method: "POST",
          path: ATTRIBUTE_TEMPLATE_PATH,
          body: { product_type_id_list: [productTypeId] },
          openKeyId: store.openKeyId,
          secretKey: store.secretKey,
          fetchImpl,
        });
        const info = payload.info || {};
        const record = activeSchemaCache.set(id, "attributes", productTypeId, info);
        return json(response, 200, {
          ok: true,
          info,
          diagnostics,
          cached: false,
          cachedAt: record.cachedAt,
        });
      }

      const standardMatch = url.pathname.match(
        /^\/api\/shein\/stores\/([^/]+)\/template\/publish-standard$/,
      );
      if (request.method === "POST" && standardMatch) {
        const id = decodeURIComponent(standardMatch[1]);
        const store = activeRegistry.getStore(id);
        if (!store) return json(response, 404, { message: "未找到已连接店铺" });
        const { categoryId, force = false } = await readJson(request);
        if (!categoryId) return json(response, 400, { message: "categoryId 必填" });
        const cached = !force
          ? activeSchemaCache.get(id, "publish-standard", categoryId)
          : null;
        if (cached) {
          return json(response, 200, {
            ok: true,
            info: cached.value,
            cached: true,
            cachedAt: cached.cachedAt,
          });
        }
        const { payload, diagnostics } = await requestStoreShein({
          storeId: id,
          baseUrl: config.apiBaseUrl,
          method: "POST",
          path: PUBLISH_STANDARD_PATH,
          body: { category_id: categoryId },
          openKeyId: store.openKeyId,
          secretKey: store.secretKey,
          fetchImpl,
        });
        const info = payload.info || {};
        const record = activeSchemaCache.set(
          id,
          "publish-standard",
          categoryId,
          info,
        );
        return json(response, 200, {
          ok: true,
          info,
          diagnostics,
          cached: false,
          cachedAt: record.cachedAt,
        });
      }

      const productSearchMatch = url.pathname.match(
        /^\/api\/shein\/stores\/([^/]+)\/products\/search$/,
      );
      if (request.method === "POST" && productSearchMatch) {
        const id = decodeURIComponent(productSearchMatch[1]);
        const store = activeRegistry.getStore(id);
        if (!store) return json(response, 404, { message: "未找到已连接店铺" });
        const { skc } = await readJson(request);
        const normalizedSkc = String(skc || "").trim();
        if (!normalizedSkc) {
          return json(response, 400, { message: "skc 必填" });
        }
        const { payload, diagnostics } = await requestStoreShein({
          storeId: id,
          baseUrl: config.apiBaseUrl,
          method: "POST",
          path: PRODUCT_SEARCH_PATH,
          body: {
            pageNum: 1,
            pageSize: 10,
            skcNameList: [normalizedSkc],
            languageList: ["zh-cn", "en"],
          },
          openKeyId: store.openKeyId,
          secretKey: store.secretKey,
          fetchImpl,
        });
        const products = normalizeProductSearch(payload.info, normalizedSkc);
        return json(response, 200, {
          ok: true,
          endpoint: PRODUCT_SEARCH_PATH,
          products,
          count: products.length,
          diagnostics,
        });
      }

      const publishPreflightMatch = url.pathname.match(
        /^\/api\/shein\/stores\/([^/]+)\/publish\/preflight$/,
      );
      if (request.method === "POST" && publishPreflightMatch) {
        const id = decodeURIComponent(publishPreflightMatch[1]);
        const store = activeRegistry.getStore(id);
        if (!store) return json(response, 404, { message: "未找到已连接店铺" });
        const { supplierSkuList, brandCode } = await readJson(request);
        const result = await runPublishPreflight({
          supplierSkuList,
          brandCode,
          request: ({ method, path, query, body }) =>
            requestStoreShein({
              storeId: id,
              baseUrl: config.apiBaseUrl,
              method,
              path,
              ...(query ? { query } : {}),
              body,
              openKeyId: store.openKeyId,
              secretKey: store.secretKey,
              fetchImpl,
            }),
        });
        return json(response, 200, {
          ok: true,
          ...result,
        });
      }

      const localImageUploadMatch = url.pathname.match(
        /^\/api\/local\/shein\/stores\/([^/]+)\/upload-image$/,
      );
      if (request.method === "POST" && localImageUploadMatch) {
        const id = decodeURIComponent(localImageUploadMatch[1]);
        const store = activeRegistry.getStore(id);
        if (!store) return json(response, 404, { message: "未找到已连接店铺" });
        const mimeType = String(request.headers["content-type"] || "")
          .split(";")[0]
          .trim()
          .toLowerCase();
        if (!SHEIN_IMAGE_MIME_TYPES.has(mimeType)) {
          return json(response, 400, {
            message: "本地图片仅支持 JPG、JPEG、PNG",
          });
        }
        const encodedName = String(request.headers["x-file-name"] || "");
        const fileName = encodedName
          ? decodeURIComponent(encodedName)
          : "upload.jpg";
        const fileBytes = await readBytes(request, SHEIN_IMAGE_MAX_BYTES);
        const { payload, diagnostics } = await uploadSheinImageDirect({
          baseUrl: config.apiBaseUrl,
          openKeyId: store.openKeyId,
          secretKey: store.secretKey,
          imageType: url.searchParams.get("imageType"),
          fileBytes,
          fileName,
          mimeType,
          fetchImpl,
        });
        return json(response, 200, {
          ok: true,
          info: payload.info,
          diagnostics,
        });
      }

      const localPriceProofUploadMatch = url.pathname.match(
        /^\/api\/local\/shein\/stores\/([^/]+)\/upload-price-proof$/,
      );
      if (request.method === "POST" && localPriceProofUploadMatch) {
        const id = decodeURIComponent(localPriceProofUploadMatch[1]);
        const store = activeRegistry.getStore(id);
        if (!store) return json(response, 404, { message: "未找到已连接店铺" });
        const proofType = Number(url.searchParams.get("type"));
        const allowedMimeTypes = SHEIN_PRICE_PROOF_MIME_TYPES.get(proofType);
        const mimeType = String(request.headers["content-type"] || "")
          .split(";")[0]
          .trim()
          .toLowerCase();
        if (!allowedMimeTypes?.has(mimeType)) {
          return json(response, 400, {
            message: "当前价格证明场景不支持此文件类型",
          });
        }
        const encodedName = String(request.headers["x-file-name"] || "");
        const fileName = encodedName
          ? decodeURIComponent(encodedName)
          : "proof-file";
        const fileBytes = await readBytes(
          request,
          SHEIN_PRICE_PROOF_MAX_BYTES,
          "价格证明文件超过 10MB",
        );
        const { payload, diagnostics } = await uploadSheinPriceProofDirect({
          baseUrl: config.apiBaseUrl,
          openKeyId: store.openKeyId,
          secretKey: store.secretKey,
          proofType,
          fileBytes,
          fileName,
          mimeType,
          fetchImpl,
        });
        return json(response, 200, {
          ok: true,
          info: payload.info,
          diagnostics,
        });
      }

      const localCertificateUploadMatch = url.pathname.match(
        /^\/api\/local\/shein\/stores\/([^/]+)\/upload-certificate$/,
      );
      if (request.method === "POST" && localCertificateUploadMatch) {
        const id = decodeURIComponent(localCertificateUploadMatch[1]);
        const store = activeRegistry.getStore(id);
        if (!store) return json(response, 404, { message: "未找到已连接店铺" });
        const mimeType = String(request.headers["content-type"] || "")
          .split(";")[0]
          .trim()
          .toLowerCase();
        if (!SHEIN_CERTIFICATE_MIME_TYPES.has(mimeType)) {
          return json(response, 400, {
            message: "资质证书仅支持 PDF、PNG、JPG、JPEG",
          });
        }
        const encodedName = String(request.headers["x-file-name"] || "");
        const fileName = encodedName
          ? decodeURIComponent(encodedName)
          : "certificate-file";
        const fileBytes = await readBytes(
          request,
          SHEIN_CERTIFICATE_MAX_BYTES,
          "资质证书文件超过 20MB",
        );
        const { payload, diagnostics } = await uploadSheinCertificateDirect({
          baseUrl: config.apiBaseUrl,
          openKeyId: store.openKeyId,
          secretKey: store.secretKey,
          fileBytes,
          fileName,
          mimeType,
          fetchImpl,
        });
        return json(response, 200, {
          ok: true,
          info: payload.info,
          diagnostics,
        });
      }

      const localCompliancePhotoUploadMatch = url.pathname.match(
        /^\/api\/local\/shein\/stores\/([^/]+)\/upload-compliance-photo$/,
      );
      if (request.method === "POST" && localCompliancePhotoUploadMatch) {
        const id = decodeURIComponent(localCompliancePhotoUploadMatch[1]);
        const store = activeRegistry.getStore(id);
        if (!store) return json(response, 404, { message: "未找到已连接店铺" });
        if (
          config.complianceWritesEnabled !== true ||
          !config.complianceConfirmationSecret
        ) {
          return json(response, 409, {
            code: "WRITE_DISABLED",
            msg: "真实合规写入开关未开启；未向 SHEIN 上传任何图片",
          });
        }
        const mimeType = String(request.headers["content-type"] || "")
          .split(";")[0]
          .trim()
          .toLowerCase();
        const encodedName = String(request.headers["x-file-name"] || "");
        const fileName = encodedName
          ? decodeURIComponent(encodedName)
          : "compliance-photo.jpg";
        const width = Number(request.headers["x-image-width"] || 0);
        const height = Number(request.headers["x-image-height"] || 0);
        const fileBytes = await readBytes(
          request,
          SHEIN_PHOTO_MAX_BYTES,
          "合规实拍图超过 SHEIN 规定的 10MB",
        );
        const { payload, diagnostics } = await uploadSheinCompliancePhotoDirect({
          baseUrl: config.apiBaseUrl,
          openKeyId: store.openKeyId,
          secretKey: store.secretKey,
          fileBytes,
          fileName,
          mimeType,
          width,
          height,
          fetchImpl,
        });
        return json(response, 200, {
          ok: true,
          info: payload.info,
          diagnostics,
        });
      }

      const productIdentifyMatch = url.pathname.match(
        /^\/api\/shein\/stores\/([^/]+)\/products\/identify$/,
      );
      if (request.method === "POST" && productIdentifyMatch) {
        const id = decodeURIComponent(productIdentifyMatch[1]);
        const store = activeRegistry.getStore(id);
        if (!store) return json(response, 404, { message: "未找到已连接店铺" });
        const { skc } = await readJson(request);
        const normalizedSkc = String(skc || "").trim();
        if (!normalizedSkc) {
          return json(response, 400, { message: "skc 必填" });
        }
        const searchResult = await requestStoreShein({
          storeId: id,
          baseUrl: config.apiBaseUrl,
          method: "POST",
          path: PRODUCT_SEARCH_PATH,
          body: {
            pageNum: 1,
            pageSize: 10,
            skcNameList: [normalizedSkc],
            languageList: ["zh-cn", "en"],
          },
          openKeyId: store.openKeyId,
          secretKey: store.secretKey,
          fetchImpl,
        });
        const [product] = normalizeProductSearch(
          searchResult.payload.info,
          normalizedSkc,
        );
        if (!product) {
          return json(response, 404, {
            message: "当前授权店铺未查询到该 SKC，或商品尚未审核通过",
            traceId: searchResult.diagnostics.traceId,
          });
        }
        const detailResult = await requestStoreShein({
          storeId: id,
          baseUrl: config.apiBaseUrl,
          method: "POST",
          path: PRODUCT_DETAIL_PATH,
          body: {
            spuName: product.spu,
            languageList: ["zh-cn", "en"],
          },
          openKeyId: store.openKeyId,
          secretKey: store.secretKey,
          fetchImpl,
        });
        const detail = detailResult.payload.info || {};
        return json(response, 200, {
          ok: true,
          endpoints: [PRODUCT_SEARCH_PATH, PRODUCT_DETAIL_PATH],
          product: {
            ...product,
            detailSummary: summarizeProductDetail(detail, normalizedSkc),
          },
          detail,
          diagnostics: {
            search: searchResult.diagnostics,
            detail: detailResult.diagnostics,
          },
        });
      }

      const disconnectMatch = url.pathname.match(/^\/api\/shein\/stores\/([^/]+)$/);
      if (request.method === "DELETE" && disconnectMatch) {
        const id = decodeURIComponent(disconnectMatch[1]);
        const removed = activeRegistry.removeStore(id);
        if (removed) activeBusinessDataCache.remove(id);
        return json(response, removed ? 200 : 404, {
          ok: removed,
          message: removed ? "已移除本机加密店铺凭证" : "未找到店铺",
        });
      }

      return json(response, 404, { message: "接口不存在" });
    } catch (error) {
      const status =
        error instanceof SheinApiError ? error.status : Number(error.status || 500);
      return json(response, status, {
        message: error.message || "服务异常",
        code: error.code || null,
        traceId: error.traceId || null,
      });
    }
  });
}

export function startSheinProxy(config = loadConfig()) {
  const server = createSheinProxy({ config });
  server.listen(config.port, config.host, () => {
    console.log(
      `[shein-proxy] http://${config.host}:${config.port} · ${config.environment} · ${config.apiBaseUrl}`,
    );
  });
  return server;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  startSheinProxy();
}
