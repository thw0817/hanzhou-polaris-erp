import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

import { loadConfig } from "../config.js";
import { requestShein as defaultRequestShein } from "../shein-client.js";
import {
  ERP07_SHEIN_ENDPOINT_CONTRACT_VERSION,
} from "./erp07-shein-endpoint-contract.js";
import { CloudCredentialCipher } from "./credential-cipher.js";
import {
  ERP07_SHEIN_ADAPTER_CONTRACT_VERSION,
  Erp07SheinAdapter,
} from "./erp07-shein-adapter.js";

const { Pool } = pg;

export const ERP07_READ_ONLY_EVIDENCE_RUNNER_VERSION =
  "erp07-read-only-evidence-runner-v1";

export const ERP07_READ_ONLY_CONFIRMATION =
  "I_UNDERSTAND_READ_ONLY";

export const ERP07_SOURCE_PENDING_CONFIRMATION =
  "I_UNDERSTAND_EVIDENCE";

const OFFICIAL_SHEIN_API_HOST = "openapi.sheincorp.cn";

const PLATFORM_IDENTITY_PATTERN = /^[A-Za-z0-9._:-]+$/;

const EVIDENCE_ENDPOINTS = Object.freeze([
  Object.freeze({
    endpoint: "product.spu_info",
    method: "POST",
    path: "/open-api/goods/spu-info",
    body: ({ documentStateIdentity }) => ({
      languageList: ["zh-cn"],
      spuName: documentStateIdentity.spuName,
    }),
    sourceKey: "spu-info",
  }),
  Object.freeze({
    endpoint: "sales.sku",
    method: "POST",
    path: "/open-api/goods/query-sku-sales",
    body: ({ skuCodes }) => ({ skuCodeList: skuCodes }),
    sourceKey: "sales",
  }),
  Object.freeze({
    endpoint: "preflight.publish_quota",
    method: "POST",
    path: "/open-api/goods-publish-quotas/detail",
    body: () => ({}),
    sourceKey: "publish-quota",
  }),
  Object.freeze({
    endpoint: "review.document_state",
    method: "POST",
    path: "/open-api/goods/query-document-state",
    body: ({ documentStateIdentity }) => ({
      version: documentStateIdentity.version,
      spuList: [{ spuName: documentStateIdentity.spuName }],
    }),
    sourceKey: "document",
  }),
]);

export const AUTHORIZED_STORE_LOOKUP_SQL = `
  SELECT s.id, s.tenant_id, s.supplier_id, s.open_key_id, s.status,
         c.ciphertext, c.iv, c.auth_tag, c.key_version
  FROM stores AS s
  JOIN store_credentials AS c ON c.store_id = s.id
  WHERE s.supplier_id = $1
    AND s.status = 'active'
  ORDER BY s.id
`;

export const PLATFORM_IDENTITY_LOOKUP_SQL = `
  SELECT DISTINCT
         COALESCE(
           NULLIF(job.request_summary->>'spuName', ''),
           NULLIF(job.receipt->>'spuName', '')
         ) AS spu_name,
         job.shein_version AS version
  FROM publish_jobs AS job
  WHERE job.tenant_id = $1
    AND job.store_id = $2
    AND NULLIF(job.shein_version, '') IS NOT NULL
    AND (
      (
        jsonb_typeof(job.request_summary->'skcNames') = 'array'
        AND job.request_summary->'skcNames' ? $3
      )
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(job.receipt->'skcs', '[]'::jsonb)) AS skc
        WHERE skc->>'skcName' = $3
      )
    )
  ORDER BY version, spu_name
`;

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function text(value, max = 200) {
  const normalized = String(value ?? "").trim();
  return normalized && normalized.length <= max ? normalized : "";
}

function safeIdentifier(value, pattern, label) {
  const normalized = text(value, 160);
  if (!normalized || !pattern.test(normalized)) {
    const error = new Error(`${label} 格式无效`);
    error.code = "ERP07_EVIDENCE_INPUT_INVALID";
    throw error;
  }
  return normalized;
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

function officialApiBaseUrl(value) {
  const normalized = text(value, 500);
  let url;
  try {
    url = new URL(normalized);
  } catch {
    const error = new Error("SHEIN API 地址无效");
    error.code = "ERP07_EVIDENCE_API_BASE_URL_INVALID";
    throw error;
  }
  if (url.protocol !== "https:" || url.hostname !== OFFICIAL_SHEIN_API_HOST ||
      url.username || url.password || url.search || url.hash) {
    const error = new Error("SHEIN API 地址不是允许的官方 HTTPS 地址");
    error.code = "ERP07_EVIDENCE_API_BASE_URL_NOT_ALLOWED";
    throw error;
  }
  return normalized.replace(/\/+$/, "");
}

function normalizeScope(scope, supplierId) {
  const source = object(scope);
  const normalized = {
    tenantId: text(source?.tenantId, 160),
    storeId: text(source?.storeId, 160),
    supplierId: text(source?.supplierId, 160),
  };
  if (!normalized.tenantId || !normalized.storeId ||
      normalized.supplierId !== supplierId) {
    const error = new Error("授权记录与目标 Supplier ID 不一致或作用域不完整");
    error.code = "ERP07_EVIDENCE_SCOPE_MISMATCH";
    throw error;
  }
  return Object.freeze(normalized);
}

function normalizeDocumentStateIdentity(value, { optional = false } = {}) {
  const source = object(value);
  const rawSpuName = text(source?.spuName, 160);
  const rawVersion = text(source?.version, 160);
  if (!rawSpuName && !rawVersion && optional) return null;
  if (
    !rawSpuName ||
    !PLATFORM_IDENTITY_PATTERN.test(rawSpuName) ||
    !rawVersion ||
    !PLATFORM_IDENTITY_PATTERN.test(rawVersion)
  ) {
    const error = new Error("单据状态回读需要完整的 SPU 和 version");
    error.code = "ERP07_EVIDENCE_PLATFORM_IDENTITY_INVALID";
    throw error;
  }
  return Object.freeze({ spuName: rawSpuName, version: rawVersion });
}

function normalizeAuthorization(value, supplierId) {
  const source = object(value);
  const scope = normalizeScope(source?.scope, supplierId);
  const credentials = object(source?.credentials);
  if (!text(credentials?.openKeyId, 500) || !text(credentials?.secretKey, 1000)) {
    const error = new Error("授权记录缺少 SHEIN 凭证");
    error.code = "ERP07_EVIDENCE_CREDENTIALS_INVALID";
    throw error;
  }
  return {
    scope,
    credentials,
    documentStateIdentity: normalizeDocumentStateIdentity(
      source?.documentStateIdentity,
      { optional: true },
    ),
  };
}

function extractSkuCodesForSkc(payload, targetSkc) {
  const root = object(payload);
  const info = object(root?.info);
  const skcInfoList = Array.isArray(info?.skcInfoList)
    ? info.skcInfoList
    : Array.isArray(info?.skc_info_list)
      ? info.skc_info_list
      : null;
  if (!skcInfoList) {
    return { status: "missing" };
  }
  const matches = skcInfoList.filter((entry) => {
    const source = object(entry);
    return text(source?.skcName ?? source?.skc_name, 160) === targetSkc;
  });
  if (matches.length !== 1) {
    return { status: matches.length === 0 ? "missing" : "ambiguous" };
  }
  const skuInfoList = Array.isArray(matches[0].skuInfoList)
    ? matches[0].skuInfoList
    : Array.isArray(matches[0].sku_info_list)
      ? matches[0].sku_info_list
      : null;
  if (!skuInfoList) {
    return { status: "missing" };
  }
  const skuCodes = Array.from(new Set(
    skuInfoList
      .map((entry) => {
        const source = object(entry);
        return text(source?.skuCode ?? source?.sku_code, 160);
      })
      .filter(Boolean),
  ));
  if (!skuCodes.length) return { status: "missing" };
  if (skuCodes.length > 100) return { status: "too_many" };
  return { status: "resolved", skuCodes };
}

function sourceRefFor(sourceKey, supplierId) {
  return `authorized-store-read:erp07-${sourceKey}-supplier-${supplierId}`;
}

function safeDiagnostics(result) {
  const diagnostics = object(result?.diagnostics);
  return {
    status: Number.isInteger(diagnostics?.status) ? diagnostics.status : null,
    code: text(diagnostics?.code, 100) || null,
    traceId: text(diagnostics?.traceId, 200) || null,
    ...(Number.isFinite(diagnostics?.durationMs)
      ? { durationMs: Math.max(0, Number(diagnostics.durationMs)) }
      : {}),
  };
}

function safeDigest(value) {
  const normalized = text(value, 64);
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

function safeFieldCoverage(value) {
  const source = object(value);
  if (!source) return null;
  return {
    expected: Number.isInteger(source.expected) ? source.expected : null,
    observed: Number.isInteger(source.observed) ? source.observed : null,
    missing: Array.isArray(source.missing)
      ? source.missing.map((field) => text(field, 160)).filter(Boolean)
      : [],
  };
}

function safeCatalogUpgrade(value) {
  const source = object(value);
  if (!source) return null;
  return {
    status: text(source.status, 120) || null,
    eligible: source.eligible === true,
    reasons: Array.isArray(source.reasons)
      ? source.reasons.map((reason) => text(reason, 160)).filter(Boolean)
      : [],
  };
}

const RESPONSE_SHAPE_PATH_PATTERN = /^(?:[A-Za-z0-9_-]+|<invalid-key>)(?:\[\])?(?:\.(?:[A-Za-z0-9_-]+|<invalid-key>)(?:\[\])?)*$/;
const SAFE_RESPONSE_SHAPE_TYPES = new Set([
  "null",
  "array",
  "integer",
  "number",
  "string",
  "boolean",
  "object",
  "unknown",
]);

function safeResponseShape(value) {
  const source = object(value);
  if (!source || typeof source.truncated !== "boolean" ||
      !Array.isArray(source.fields)) {
    return null;
  }
  const fields = source.fields
    .map((field) => {
      const entry = object(field);
      const fieldPath = text(entry?.path, 240);
      if (!fieldPath || !RESPONSE_SHAPE_PATH_PATTERN.test(fieldPath) ||
          !Array.isArray(entry.valueTypes) || entry.valueTypes.length === 0 ||
          new Set(entry.valueTypes).size !== entry.valueTypes.length ||
          entry.valueTypes.some((type) => !SAFE_RESPONSE_SHAPE_TYPES.has(type))) {
        return null;
      }
      return {
        path: fieldPath,
        valueTypes: entry.valueTypes.map((type) => type),
      };
    })
    .filter(Boolean)
    .slice(0, 256);
  return {
    fields,
    truncated: source.truncated,
  };
}

function safeDossier(dossier) {
  const source = object(dossier);
  if (!source) return null;
  return {
    dossierVersion: text(source.dossierVersion, 120),
    endpoint: text(source.endpoint, 120),
    method: text(source.method, 20),
    path: text(source.path, 200),
    contractVersion: text(source.contractVersion, 120),
    schemaVersion: text(source.schemaVersion, 120),
    sourceEvidenceStatus: text(source.sourceEvidenceStatus, 120),
    sourceRefDigestSha256: safeDigest(source.sourceRefDigestSha256),
    scopeDigestSha256: safeDigest(source.scopeDigestSha256),
    observedAt: text(source.observedAt, 80),
    traceId: text(source.traceId, 200),
    responseDigestSha256: safeDigest(source.responseDigestSha256),
    responseShape: safeResponseShape(source.responseShape),
    fieldCoverage: safeFieldCoverage(source.fieldCoverage),
    catalogUpgrade: safeCatalogUpgrade(source.catalogUpgrade),
  };
}

function safeEndpointResult(definition, result) {
  return {
    endpoint: definition.endpoint,
    method: definition.method,
    path: definition.path,
    outcome: text(result?.outcome, 80) || "unknown",
    retryClass: text(result?.retryClass, 80) || null,
    diagnostics: safeDiagnostics(result),
    responseEvidenceDossier: safeDossier(result?.responseEvidenceDossier),
  };
}

function safeRunnerError(error) {
  return {
    code: text(error?.code, 120) || "ERP07_EVIDENCE_RUNNER_FAILED",
    status: Number.isInteger(error?.status) ? error.status : null,
  };
}

export async function resolveAuthorizedStoreFromDatabase({
  pool,
  cipher,
  supplierId,
  apiBaseUrl,
} = {}) {
  if (!pool || typeof pool.query !== "function") {
    const error = new Error("缺少只读数据库连接");
    error.code = "ERP07_EVIDENCE_DATABASE_REQUIRED";
    throw error;
  }
  if (!(cipher instanceof CloudCredentialCipher)) {
    const error = new Error("缺少云端凭证解密器");
    error.code = "ERP07_EVIDENCE_CIPHER_REQUIRED";
    throw error;
  }
  const normalizedSupplierId = safeIdentifier(
    supplierId,
    /^[0-9]+$/,
    "Supplier ID",
  );
  const result = await pool.query(AUTHORIZED_STORE_LOOKUP_SQL, [normalizedSupplierId]);
  if (result.rowCount !== 1) {
    const error = new Error("Supplier ID 未映射到唯一的 active 授权店铺");
    error.code = result.rowCount === 0
      ? "ERP07_EVIDENCE_STORE_NOT_FOUND"
      : "ERP07_EVIDENCE_STORE_AMBIGUOUS";
    throw error;
  }
  const row = result.rows[0];
  const openKeyId = text(row.open_key_id, 500);
  if (!openKeyId || !row.ciphertext || !row.iv || !row.auth_tag) {
    const error = new Error("授权店铺凭证记录不完整");
    error.code = "ERP07_EVIDENCE_CREDENTIALS_INVALID";
    throw error;
  }
  const secretKey = cipher.decrypt(
    {
      ciphertext: row.ciphertext,
      iv: row.iv,
      authTag: row.auth_tag,
      keyVersion: row.key_version,
    },
    { storeId: row.id, openKeyId },
  );
  return {
    scope: normalizeScope({
      tenantId: row.tenant_id,
      storeId: row.id,
      supplierId: row.supplier_id,
    }, normalizedSupplierId),
    credentials: {
      baseUrl: officialApiBaseUrl(apiBaseUrl),
      openKeyId,
      secretKey,
    },
  };
}

export async function resolvePlatformIdentityFromDatabase({
  pool,
  scope,
  skc,
} = {}) {
  if (!pool || typeof pool.query !== "function") {
    const error = new Error("缺少只读数据库连接");
    error.code = "ERP07_EVIDENCE_DATABASE_REQUIRED";
    throw error;
  }
  const normalizedScope = normalizeScope(scope, text(scope?.supplierId, 160));
  const normalizedSkc = safeIdentifier(
    skc,
    /^[A-Za-z0-9._-]+$/,
    "SKC",
  );
  const result = await pool.query(PLATFORM_IDENTITY_LOOKUP_SQL, [
    normalizedScope.tenantId,
    normalizedScope.storeId,
    normalizedSkc,
  ]);
  const identities = (result.rows || [])
    .map((row) => normalizeDocumentStateIdentity({
      spuName: row.spu_name,
      version: row.version,
    }, { optional: true }))
    .filter(Boolean);
  const unique = Array.from(
    new Map(identities.map((identity) => [
      `${identity.version}\u0000${identity.spuName}`,
      identity,
    ])).values(),
  );
  if (unique.length > 1) {
    const error = new Error("SKC 对应的 SHEIN SPU/version 不唯一，已安全阻断回读");
    error.code = "ERP07_EVIDENCE_PLATFORM_IDENTITY_AMBIGUOUS";
    throw error;
  }
  return unique[0] || null;
}

export async function runErp07ReadOnlyEvidence({
  supplierId,
  skc,
  apiBaseUrl,
  documentStateIdentity = null,
  resolveAuthorization,
  request = defaultRequestShein,
  now = () => new Date(),
} = {}) {
  const normalizedSupplierId = safeIdentifier(
    supplierId,
    /^[0-9]+$/,
    "Supplier ID",
  );
  const normalizedSkc = safeIdentifier(
    skc,
    /^[A-Za-z0-9._-]+$/,
    "SKC",
  );
  const normalizedApiBaseUrl = officialApiBaseUrl(apiBaseUrl);
  if (typeof resolveAuthorization !== "function") {
    const error = new Error("缺少授权店铺解析器");
    error.code = "ERP07_EVIDENCE_AUTHORIZATION_RESOLVER_REQUIRED";
    throw error;
  }
  if (typeof request !== "function") {
    const error = new Error("缺少 SHEIN 只读传输器");
    error.code = "ERP07_EVIDENCE_TRANSPORT_REQUIRED";
    throw error;
  }

  const observedAt = new Date(now()).toISOString();
  const authorization = normalizeAuthorization(
    await resolveAuthorization(normalizedSupplierId),
    normalizedSupplierId,
  );
  const normalizedDocumentStateIdentity = normalizeDocumentStateIdentity(
    documentStateIdentity || authorization.documentStateIdentity,
    { optional: true },
  );
  const adapter = new Erp07SheinAdapter({
    apiBaseUrl: normalizedApiBaseUrl,
    resolveCredentials: async () => authorization.credentials,
    request,
    readEnabled: true,
    writeEnabled: false,
    sourcePendingEvidenceCaptureEnabled: true,
    timeoutMs: 15_000,
  });
  const endpoints = [];
  let resolvedSkuCodes = null;
  let skuResolutionFailure = null;

  for (const definition of EVIDENCE_ENDPOINTS) {
    if (!normalizedDocumentStateIdentity &&
        (definition.endpoint === "product.spu_info" ||
          definition.endpoint === "review.document_state")) {
      endpoints.push(safeEndpointResult(definition, {
        outcome: "input_required",
        retryClass: "terminal",
        diagnostics: {
          status: null,
          code: "ERP07_EVIDENCE_PLATFORM_IDENTITY_REQUIRED",
          traceId: null,
        },
      }));
      continue;
    }
    if (definition.endpoint === "sales.sku") {
      if (!normalizedDocumentStateIdentity) {
        endpoints.push(safeEndpointResult(definition, {
          outcome: "input_required",
          retryClass: "terminal",
          diagnostics: {
            status: null,
            code: "ERP07_EVIDENCE_PLATFORM_IDENTITY_REQUIRED",
            traceId: null,
          },
        }));
        continue;
      }
      if (!resolvedSkuCodes) {
        endpoints.push(safeEndpointResult(definition, {
          outcome: "input_required",
          retryClass: "terminal",
          diagnostics: {
            status: null,
            code: skuResolutionFailure || "ERP07_EVIDENCE_SKU_CODES_REQUIRED",
            traceId: null,
          },
        }));
        continue;
      }
    }
    const traceId = `erp07-evidence-${definition.sourceKey}-${Date.parse(observedAt)}`;
    const result = await adapter.execute({
      endpoint: definition.endpoint,
      body: definition.body({
        skc: normalizedSkc,
        skuCodes: resolvedSkuCodes,
        documentStateIdentity: normalizedDocumentStateIdentity,
      }),
      scope: authorization.scope,
      traceId,
      sendBoundary: "before_send",
      sourcePendingEvidenceCapture: {
        sourceRef: sourceRefFor(definition.sourceKey, normalizedSupplierId),
        observedAt,
      },
    });
    endpoints.push(safeEndpointResult(definition, result));
    if (definition.endpoint === "product.spu_info") {
      if (result.outcome !== "read_success") {
        skuResolutionFailure = "ERP07_EVIDENCE_SKU_LOOKUP_FAILED";
        continue;
      }
      const resolution = extractSkuCodesForSkc(result.payload, normalizedSkc);
      if (resolution.status === "resolved") {
        resolvedSkuCodes = resolution.skuCodes;
      } else if (resolution.status === "ambiguous") {
        skuResolutionFailure = "ERP07_EVIDENCE_SKU_MAPPING_AMBIGUOUS";
      } else if (resolution.status === "too_many") {
        skuResolutionFailure = "ERP07_EVIDENCE_SKU_CODE_LIMIT_EXCEEDED";
      } else {
        skuResolutionFailure = "ERP07_EVIDENCE_SKU_CODES_REQUIRED";
      }
    }
  }

  const allReadSuccess = endpoints.every(
    (endpoint) => endpoint.outcome === "read_success",
  );
  return Object.freeze({
    runnerVersion: ERP07_READ_ONLY_EVIDENCE_RUNNER_VERSION,
    adapterContractVersion: ERP07_SHEIN_ADAPTER_CONTRACT_VERSION,
    endpointContractVersion: ERP07_SHEIN_ENDPOINT_CONTRACT_VERSION,
    ok: allReadSuccess,
    readOnly: true,
    externalWrite: false,
    target: Object.freeze({
      supplierIdDigestSha256: sha256(normalizedSupplierId),
      skcDigestSha256: sha256(normalizedSkc),
      ...(normalizedDocumentStateIdentity
        ? {
            documentStateIdentityDigestSha256: sha256(JSON.stringify(
              normalizedDocumentStateIdentity,
            )),
          }
        : {}),
    }),
    observedAt,
    endpoints: Object.freeze(endpoints),
  });
}

function requiredEnvironment(env) {
  if (env.ERP07_READ_ONLY_CONFIRM !== ERP07_READ_ONLY_CONFIRMATION ||
      env.ERP07_SOURCE_PENDING_EVIDENCE_CAPTURE !== ERP07_SOURCE_PENDING_CONFIRMATION) {
    const error = new Error("真实证据采集需要两个精确只读确认词");
    error.code = "ERP07_EVIDENCE_CONFIRMATION_REQUIRED";
    throw error;
  }
  return {
    supplierId: env.ERP07_EVIDENCE_SUPPLIER_ID,
    skc: env.ERP07_EVIDENCE_SKC,
    documentStateIdentity: normalizeDocumentStateIdentity({
      spuName: env.ERP07_EVIDENCE_SPU_NAME,
      version: env.ERP07_EVIDENCE_VERSION,
    }, { optional: true }),
  };
}

export async function runErp07ReadOnlyEvidenceCli({
  env = process.env,
  logger = console,
} = {}) {
  const target = requiredEnvironment(env);
  const config = loadConfig(env);
  if (config.runtimeMode !== "cloud") {
    const error = new Error("真实证据采集必须在 cloud 配置下运行");
    error.code = "ERP07_EVIDENCE_CLOUD_MODE_REQUIRED";
    throw error;
  }
  const apiBaseUrl = officialApiBaseUrl(config.apiBaseUrl);
  if (!config.databaseUrl || !config.cloudEncryptionKey) {
    const error = new Error("真实证据采集缺少数据库或云端加密配置");
    error.code = "ERP07_EVIDENCE_RUNTIME_CONFIG_REQUIRED";
    throw error;
  }
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: 1,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 5_000,
    query_timeout: 7_000,
    options: "-c default_transaction_read_only=on",
  });
  try {
    const cipher = new CloudCredentialCipher({
      base64Key: config.cloudEncryptionKey,
    });
    const result = await runErp07ReadOnlyEvidence({
      ...target,
      apiBaseUrl,
      resolveAuthorization: async (supplierId) => {
        const authorization = await resolveAuthorizedStoreFromDatabase({
          pool,
          cipher,
          supplierId,
          apiBaseUrl,
        });
        if (target.documentStateIdentity) return authorization;
        const identity = await resolvePlatformIdentityFromDatabase({
          pool,
          scope: authorization.scope,
          skc: target.skc,
        });
        return { ...authorization, documentStateIdentity: identity };
      },
    });
    logger.log(JSON.stringify(result, null, 2));
    return result;
  } finally {
    await pool.end();
  }
}

const isMain = process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  runErp07ReadOnlyEvidenceCli()
    .then((result) => {
      if (!result.ok) process.exitCode = 2;
    })
    .catch((error) => {
      console.error(JSON.stringify({
        ok: false,
        readOnly: true,
        externalWrite: false,
        error: safeRunnerError(error),
      }));
      process.exitCode = 1;
    });
}
