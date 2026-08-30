import { STORE_DATA_PATHS } from "../store-data-sync.js";
import {
  SHEIN_COMPLIANCE_PATHS,
} from "../shein-compliance.js";
import { SHEIN_COMPLIANCE_RULE_PATHS } from "../compliance-rules.js";
import {
  SHEIN_IMAGE_MAX_BYTES,
  SHEIN_IMAGE_MIME_TYPES,
  SHEIN_PRICE_PROOF_MAX_BYTES,
  SHEIN_PRICE_PROOF_MIME_TYPES,
  SHEIN_IMAGE_UPLOAD_PATH,
  SHEIN_PRICE_PROOF_UPLOAD_PATH,
} from "../shein-upload.js";
import {
  SHEIN_COMPLIANCE_WRITE_PATHS,
  SHEIN_PHOTO_MAX_BYTES,
  SHEIN_COMPLIANCE_PHOTO_MIME_TYPES,
} from "../compliance-write-contract.js";
import { PRODUCT_REMOTE_PREFLIGHT_ENDPOINTS } from "./product-remote-preflight.js";
import {
  ERP06_DOCUMENT_STATE_READBACK_ENDPOINT,
  ERP06_SHEIN_PUBLISH_ENDPOINT,
} from "./erp06-shein-publish-adapter-contract.js";

export const ERP07_SHEIN_ENDPOINT_CONTRACT_VERSION =
  "erp07-shein-endpoints-v1";

const SOURCE_CATALOG =
  "docs/HANZHOU_POLARIS_API_SOURCE_CATALOG_2026-08-29.md";
const CAPABILITY_MATRIX = "docs/V2_SHEIN_API_CAPABILITY_MATRIX.md";

const READ_RETRY = Object.freeze({
  retryOn: ["network", "429", "5xx"],
  classBeforeSend: "safe_before_send_retry",
  classAfterSend: "not_applicable",
});

const WRITE_RETRY = Object.freeze({
  retryOn: ["network", "429", "5xx"],
  classBeforeSend: "safe_before_send_retry",
  classAfterSend: "readback_only",
});

function contract({
  id,
  title,
  method = "POST",
  path,
  mode = "read",
  status = "catalogued",
  owner,
  source = CAPABILITY_MATRIX,
  limits = {},
  retry = READ_RETRY,
  writePolicy = mode === "read" ? "read_only" : "explicit_one_time",
  successEvidence = null,
}) {
  const normalizedSuccessEvidence = successEvidence
    ? Object.freeze({
        ...successEvidence,
        fields: successEvidence.fields
          ? Object.freeze([...successEvidence.fields])
          : undefined,
      })
    : null;
  return Object.freeze({
    id,
    title,
    method,
    path,
    mode,
    status,
    owner,
    source,
    limits: Object.freeze({ ...limits }),
    retry,
    writePolicy,
    successEvidence: normalizedSuccessEvidence,
  });
}

const CONTRACTS = [
  contract({
    id: "product.search",
    title: "商品综合查询",
    path: STORE_DATA_PATHS.productSearch,
    owner: "server/shein-product.js + store-data-sync",
    limits: { pageSize: 10 },
  }),
  contract({
    id: "product.spu_info",
    title: "SPU 详情",
    path: STORE_DATA_PATHS.productDetail,
    owner: "server/shein-product.js + store-data-sync",
  }),
  contract({
    id: "sales.sku",
    title: "SKU 销量",
    path: STORE_DATA_PATHS.skuSales,
    owner: "server/store-data-sync.js",
    limits: { maxSkuCount: 100, qps: 40 },
  }),
  contract({
    id: "inventory.stock_query",
    title: "商家库存查询",
    path: STORE_DATA_PATHS.stockQuery,
    status: "archived_requires_revalidation",
    owner: "future business refresh owner",
  }),
  contract({
    id: "rules.category_tree",
    title: "类目树",
    path: "/open-api/goods/query-category-tree",
    owner: "rule snapshot service",
  }),
  contract({
    id: "rules.attribute_template",
    title: "属性模板",
    path: "/open-api/goods/query-attribute-template",
    owner: "rule snapshot service",
  }),
  contract({
    id: "rules.publish_fill_in_standard",
    title: "发布字段规范",
    path: "/open-api/goods/query-publish-fill-in-standard",
    owner: "rule snapshot service + product preflight",
  }),
  contract({
    id: "preflight.publish_permission",
    title: "发品权限",
    method: "GET",
    path: "/open-api/goods/product/check-publish-permission",
    owner: "server/cloud/product-remote-preflight.js",
  }),
  contract({
    id: "preflight.publish_quota",
    title: "发品额度",
    path: "/open-api/goods/query-shelf-quota",
    owner: "server/cloud/product-remote-preflight.js",
  }),
  contract({
    id: "preflight.supplier_sku_duplicate",
    title: "商家 SKU 查重",
    path: "/open-api/goods/product/check-supplierSku-repeated",
    owner: "server/cloud/product-remote-preflight.js",
    limits: { maxSkuCount: 200 },
  }),
  contract({
    id: "rules.associated_attribute",
    title: "属性关联规则",
    path: "/open-api/goods/get-associated-attribute-rules",
    owner: "server/cloud/web-business-service.js + product preflight",
    limits: { maxAttributeCount: 500 },
  }),
  contract({
    id: "rules.custom_attribute_permission",
    title: "自定义属性权限配置",
    path: "/open-api/goods/get-custom-attribute-permission-config",
    owner: "server/cloud/web-business-service.js",
  }),
  contract({
    id: "media.product_upload",
    title: "商品图片上传",
    path: SHEIN_IMAGE_UPLOAD_PATH,
    mode: "non_business_write",
    status: "real_upload_recorded",
    owner: "server/shein-upload.js + media service",
    limits: {
      maxBytes: SHEIN_IMAGE_MAX_BYTES,
      mimeTypes: [...SHEIN_IMAGE_MIME_TYPES].sort(),
    },
    retry: WRITE_RETRY,
    successEvidence: { kind: "payload_fields", fields: ["info.image_url"] },
  }),
  contract({
    id: "product.publish_or_edit",
    title: "新增/编辑商品",
    path: ERP06_SHEIN_PUBLISH_ENDPOINT,
    mode: "business_write",
    status: "contract_tested_frozen",
    owner: "ERP-06 publish command worker only",
    source: SOURCE_CATALOG,
    limits: { maxSkcCount: 40, maxSkuPerSkc: 400 },
    retry: WRITE_RETRY,
    successEvidence: { kind: "explicit_upper_layer" },
  }),
  contract({
    id: "product.transform_image",
    title: "商品图片转换",
    path: PRODUCT_REMOTE_PREFLIGHT_ENDPOINTS.transformPic,
    mode: "non_business_write",
    status: "archived_frozen",
    owner: "legacy preflight; not required for COS-first upload",
    source: CAPABILITY_MATRIX,
    writePolicy: "frozen",
    retry: WRITE_RETRY,
  }),
  contract({
    id: "review.document_state",
    title: "单据状态回读",
    path: ERP06_DOCUMENT_STATE_READBACK_ENDPOINT,
    owner: "ERP-06 official readback orchestrator",
    source: SOURCE_CATALOG,
  }),
  contract({
    id: "compliance.requirements",
    title: "商品合规要求",
    path: SHEIN_COMPLIANCE_PATHS.requirements,
    owner: "server/shein-compliance.js + compliance sync",
  }),
  contract({
    id: "compliance.photo_requirements",
    title: "SKC 实拍图要求",
    path: SHEIN_COMPLIANCE_PATHS.photoRequirements,
    owner: "server/shein-compliance.js + compliance sync",
  }),
  contract({
    id: "compliance.photo_upload",
    title: "实拍图上传",
    path: SHEIN_COMPLIANCE_WRITE_PATHS.photoUpload,
    mode: "non_business_write",
    status: "contract_tested_frozen",
    owner: "server/shein-upload.js + compliance write",
    source: SOURCE_CATALOG,
    limits: {
      maxBytes: SHEIN_PHOTO_MAX_BYTES,
      mimeTypes: [...SHEIN_COMPLIANCE_PHOTO_MIME_TYPES].sort(),
      qps: 20,
      maxPixels: 8000,
    },
    retry: WRITE_RETRY,
    successEvidence: {
      kind: "payload_fields",
      fields: ["info.imageUrl", "info.imageMd5"],
    },
  }),
  contract({
    id: "compliance.photo_bind",
    title: "SKC 实拍图保存",
    path: SHEIN_COMPLIANCE_WRITE_PATHS.photoBind,
    mode: "business_write",
    status: "contract_tested_frozen",
    owner: "compliance command owner",
    source: SOURCE_CATALOG,
    limits: { qps: 20 },
    retry: WRITE_RETRY,
    successEvidence: { kind: "explicit_upper_layer" },
  }),
  contract({
    id: "compliance.certificate_schema",
    title: "证书 Schema",
    path: SHEIN_COMPLIANCE_RULE_PATHS.certificateSchema,
    owner: "server/compliance-rules.js + compliance workspace",
    limits: { maxCertificateTypeCount: 10 },
  }),
  contract({
    id: "compliance.certificate_search",
    title: "有效证书列表",
    path: SHEIN_COMPLIANCE_RULE_PATHS.certificateSearch,
    owner: "server/compliance-rules.js + compliance workspace",
    limits: { maxCertificateTypeCount: 10, pageSize: 100, qps: 20 },
  }),
  contract({
    id: "compliance.agency_list",
    title: "代理公司列表",
    path: SHEIN_COMPLIANCE_RULE_PATHS.agencyList,
    owner: "server/compliance-rules.js + compliance workspace",
    limits: { pageSize: 100 },
  }),
  contract({
    id: "compliance.warning_rules",
    title: "警示语/证书规则",
    path: SHEIN_COMPLIANCE_RULE_PATHS.warningRules,
    owner: "server/compliance-rules.js + compliance workspace",
  }),
  contract({
    id: "compliance.certificate_upload",
    title: "证书文件上传",
    path: SHEIN_COMPLIANCE_WRITE_PATHS.certificateUpload,
    mode: "non_business_write",
    status: "contract_tested_frozen",
    owner: "server/shein-upload.js + compliance write",
    source: SOURCE_CATALOG,
    limits: { maxBytes: 20 * 1024 * 1024 },
    retry: WRITE_RETRY,
    successEvidence: {
      kind: "payload_fields",
      fields: ["info.fileUrl", "info.fileMd5", "info.fileName"],
    },
  }),
  contract({
    id: "compliance.certificate_save",
    title: "证书创建/编辑",
    path: SHEIN_COMPLIANCE_WRITE_PATHS.certificateSave,
    mode: "business_write",
    status: "contract_tested_frozen",
    owner: "server/compliance-write-contract.js",
    source: SOURCE_CATALOG,
    limits: { maxSkcCount: 400 },
    retry: WRITE_RETRY,
    successEvidence: { kind: "explicit_upper_layer" },
  }),
  contract({
    id: "compliance.certificate_bind",
    title: "证书绑定",
    path: SHEIN_COMPLIANCE_WRITE_PATHS.certificateBind,
    mode: "business_write",
    status: "contract_tested_frozen",
    owner: "server/compliance-write-contract.js",
    source: SOURCE_CATALOG,
    limits: { maxSkcCount: 400 },
    retry: WRITE_RETRY,
    successEvidence: { kind: "explicit_upper_layer" },
  }),
  contract({
    id: "compliance.agency_bind",
    title: "SKC 代理公司保存",
    path: SHEIN_COMPLIANCE_WRITE_PATHS.agencyBind,
    mode: "business_write",
    status: "contract_tested_frozen",
    owner: "server/compliance-write-executor.js",
    source: SOURCE_CATALOG,
    retry: WRITE_RETRY,
    successEvidence: { kind: "explicit_upper_layer" },
  }),
  contract({
    id: "compliance.warning_update",
    title: "更新警示语",
    path: SHEIN_COMPLIANCE_WRITE_PATHS.warningUpdate,
    mode: "business_write",
    status: "contract_tested_frozen",
    owner: "server/compliance-write-executor.js",
    source: SOURCE_CATALOG,
    retry: WRITE_RETRY,
    successEvidence: { kind: "explicit_upper_layer" },
  }),
  contract({
    id: "pricing.proof_upload",
    title: "价格证明上传",
    path: SHEIN_PRICE_PROOF_UPLOAD_PATH,
    mode: "non_business_write",
    status: "real_upload_recorded",
    owner: "server/shein-upload.js + price discussion service",
    source: CAPABILITY_MATRIX,
    limits: {
      maxBytes: SHEIN_PRICE_PROOF_MAX_BYTES,
      qps: 10,
      supportedTypes: [...SHEIN_PRICE_PROOF_MIME_TYPES.entries()].map(
        ([type, mimeTypes]) => ({
          type,
          mimeTypes: [...mimeTypes].sort(),
        }),
      ),
    },
    retry: WRITE_RETRY,
    successEvidence: { kind: "payload_fields", fields: ["info.objectKey"] },
  }),
  contract({
    id: "pricing.discussion_list",
    title: "议价单列表",
    path: "/open-api/goods/discuss/query-discuss-list",
    status: "archived_requires_revalidation",
    owner: "server/cloud/web-business-service.js",
    source: CAPABILITY_MATRIX,
    writePolicy: "read_only",
  }),
  contract({
    id: "pricing.discussion_process",
    title: "议价单处理",
    path: "/open-api/goods/discuss/process-discuss",
    mode: "business_write",
    status: "archived_frozen",
    owner: "server/cloud/web-business-service.js",
    source: CAPABILITY_MATRIX,
    writePolicy: "frozen",
    retry: WRITE_RETRY,
    successEvidence: { kind: "explicit_upper_layer" },
  }),
  contract({
    id: "auth.token_exchange",
    title: "授权临时令牌换凭证",
    path: "/open-api/auth/get-by-token",
    mode: "credential_write",
    status: "contract_tested_frozen",
    owner: "server/cloud/web-shein-authorization.js + shein-device-authorization.js",
    source: SOURCE_CATALOG,
    writePolicy: "explicit_one_time",
    retry: WRITE_RETRY,
    successEvidence: { kind: "explicit_upper_layer" },
  }),
];

export const ERP07_SHEIN_ENDPOINT_CONTRACTS = Object.freeze(
  Object.fromEntries(CONTRACTS.map((item) => [item.id, item])),
);

const CONTRACT_BY_PATH = new Map(
  CONTRACTS.map((item) => [`${item.method} ${item.path}`, item]),
);
const SENSITIVE_KEY =
  /(?:secret(?:id|key)?|token|password|credential|authorization|signature|private[_-]?key|access[_-]?key|open[_-]?key[_-]?id|cookie)/i;
const REMOTE_EXECUTION_BLOCKED_STATUSES = new Set([
  "archived_frozen",
  "archived_requires_revalidation",
]);

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function text(value, fieldName, max = 300) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new Erp07EndpointContractError(
      "ERP07_ENDPOINT_SCOPE_INVALID",
      `${fieldName} 不能为空`,
    );
  }
  if (normalized.length > max) {
    throw new Erp07EndpointContractError(
      "ERP07_ENDPOINT_SCOPE_INVALID",
      `${fieldName} 超出长度上限 ${max}`,
    );
  }
  return normalized;
}

function findSensitiveKey(value, currentPath = "body") {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const match = findSensitiveKey(item, `${currentPath}[${index}]`);
      if (match) return match;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) return `${currentPath}.${key}`;
    const match = findSensitiveKey(child, `${currentPath}.${key}`);
    if (match) return match;
  }
  return null;
}

function normalizeEndpoint(endpoint) {
  const byId = ERP07_SHEIN_ENDPOINT_CONTRACTS[String(endpoint || "")];
  if (byId) return byId;
  const byPath = CONTRACT_BY_PATH.get(String(endpoint || ""));
  if (byPath) return byPath;
  throw new Erp07EndpointContractError(
    "ERP07_ENDPOINT_NOT_ALLOWLISTED",
    "SHEIN endpoint 不在 ERP-07 允许列表中",
  );
}

function normalizeScope(scope) {
  const source = object(scope);
  if (!source) {
    throw new Erp07EndpointContractError(
      "ERP07_ENDPOINT_SCOPE_INVALID",
      "SHEIN 请求缺少 tenant/store/supplier 作用域",
    );
  }
  return Object.freeze({
    tenantId: text(source.tenantId, "tenantId"),
    storeId: text(source.storeId, "storeId"),
    supplierId: text(source.supplierId, "supplierId"),
  });
}

export class Erp07EndpointContractError extends Error {
  constructor(code, message, status = 409) {
    super(message);
    this.name = "Erp07EndpointContractError";
    this.code = code;
    this.status = status;
  }
}

export function getErp07EndpointContract(endpoint) {
  return normalizeEndpoint(endpoint);
}

export function listErp07EndpointContracts({ mode = null } = {}) {
  return CONTRACTS.filter((item) => !mode || item.mode === mode);
}

export function buildErp07EndpointRequest({
  endpoint,
  body = {},
  query,
  scope,
  traceId,
  allowWrite = false,
} = {}) {
  const contractItem = normalizeEndpoint(endpoint);
  const normalizedBody = object(body);
  if (!normalizedBody) {
    throw new Erp07EndpointContractError(
      "ERP07_ENDPOINT_BODY_INVALID",
      "SHEIN 请求 body 必须是对象",
    );
  }
  const sensitivePath = findSensitiveKey(normalizedBody);
  if (sensitivePath) {
    throw new Erp07EndpointContractError(
      "ERP07_ENDPOINT_SENSITIVE_BODY",
      `SHEIN 请求 body 不得携带凭证字段: ${sensitivePath}`,
    );
  }
  const normalizedQuery = query === undefined ? null : object(query);
  if (query !== undefined && !normalizedQuery) {
    throw new Erp07EndpointContractError(
      "ERP07_ENDPOINT_QUERY_INVALID",
      "SHEIN 请求 query 必须是对象",
    );
  }
  const sensitiveQueryPath = normalizedQuery
    ? findSensitiveKey(normalizedQuery, "query")
    : null;
  if (sensitiveQueryPath) {
    throw new Erp07EndpointContractError(
      "ERP07_ENDPOINT_SENSITIVE_QUERY",
      `SHEIN 请求 query 不得携带凭证字段: ${sensitiveQueryPath}`,
    );
  }
  if (
    contractItem.mode !== "read" &&
    (allowWrite !== true || contractItem.writePolicy === "frozen")
  ) {
    throw new Erp07EndpointContractError(
      "ERP07_ENDPOINT_WRITE_DISABLED",
      "SHEIN 非读取 endpoint 默认关闭，必须由上层一次性授权",
    );
  }
  if (REMOTE_EXECUTION_BLOCKED_STATUSES.has(contractItem.status)) {
    throw new Erp07EndpointContractError(
      "ERP07_ENDPOINT_STATUS_BLOCKED",
      `SHEIN endpoint ${contractItem.id} 当前状态 ${contractItem.status}，完成重新验证前禁止远程请求`,
    );
  }
  if (contractItem.mode === "credential_write") {
    throw new Erp07EndpointContractError(
      "ERP07_ENDPOINT_CREDENTIAL_EXCHANGE_DISABLED",
      "SHEIN 凭证交换 endpoint 禁止由 ERP-07 请求构建器执行",
    );
  }
  return Object.freeze({
    contractVersion: ERP07_SHEIN_ENDPOINT_CONTRACT_VERSION,
    endpoint: contractItem.id,
    method: contractItem.method,
    path: contractItem.path,
    mode: contractItem.mode,
    scope: normalizeScope(scope),
    traceId: text(traceId, "traceId", 200),
    body: normalizedBody,
    ...(normalizedQuery ? { query: normalizedQuery } : {}),
  });
}

function responseObject(response) {
  return object(response?.payload) || object(response) || {};
}

function responseCode(response, error) {
  return String(
    error?.code || response?.code || response?.errorCode || response?.diagnostics?.code || "",
  ).trim() || null;
}

function responseStatus(response, error) {
  const value = Number(error?.status ?? response?.status ?? response?.diagnostics?.status);
  return Number.isInteger(value) ? value : null;
}

function responseTraceId(response, error) {
  return String(
    error?.traceId || response?.traceId || response?.trace_id || response?.diagnostics?.traceId || "",
  ).trim().slice(0, 200) || null;
}

function valueAtPath(value, path) {
  return path.split(".").reduce((current, key) => current?.[key], value);
}

function hasSuccessEvidence(contractItem, payload, acceptedEvidence) {
  const evidence = contractItem.successEvidence;
  if (!evidence) return false;
  if (evidence.kind === "explicit_upper_layer") return acceptedEvidence === true;
  if (evidence.kind !== "payload_fields") return false;
  return evidence.fields.every((path) => {
    const value = valueAtPath(payload, path);
    return value !== null && value !== undefined && String(value).trim() !== "";
  });
}

function failureClass(contractItem, { status, code, sendBoundary }) {
  const rateLimited = status === 429 || code === "832213";
  const serverFailure = status >= 500 && status <= 599;
  const networkFailure = status === null;
  const transient = rateLimited || serverFailure || networkFailure;
  if (!transient) return "terminal";
  if (contractItem.mode === "read") return contractItem.retry.classBeforeSend;
  if (sendBoundary === "before_send") return contractItem.retry.classBeforeSend;
  return contractItem.retry.classAfterSend;
}

export function classifyErp07Response({
  endpoint,
  response = null,
  error = null,
  sendBoundary = "unknown",
  acceptedEvidence = false,
} = {}) {
  const contractItem = normalizeEndpoint(endpoint);
  const payload = responseObject(response);
  const status = responseStatus(response, error);
  const code = responseCode(payload, error);
  const traceId = responseTraceId(payload, error);
  const message = String(
    payload.msg || payload.message || error?.message || "SHEIN 请求失败",
  ).trim().slice(0, 1000);

  const successfulTransport =
    !error && status !== null && status >= 200 && status < 300 && code === "0";
  if (successfulTransport && contractItem.mode === "read") {
    return {
      contractVersion: ERP07_SHEIN_ENDPOINT_CONTRACT_VERSION,
      endpoint: contractItem.id,
      outcome: contractItem.mode === "read" ? "read_success" : "accepted",
      status,
      code,
      traceId,
      retryClass: "none",
      effective: false,
    };
  }

  if (successfulTransport) {
    if (!traceId || !hasSuccessEvidence(contractItem, payload, acceptedEvidence)) {
      return {
        contractVersion: ERP07_SHEIN_ENDPOINT_CONTRACT_VERSION,
        endpoint: contractItem.id,
        outcome: "result_unknown",
        status,
        code,
        traceId,
        retryClass: "readback_only",
        effective: false,
        message: "SHEIN 返回成功码但缺少完整接收/文件证据，必须先核对，不得重发",
      };
    }
    return {
      contractVersion: ERP07_SHEIN_ENDPOINT_CONTRACT_VERSION,
      endpoint: contractItem.id,
      outcome: "accepted",
      status,
      code,
      traceId,
      retryClass: "none",
      effective: false,
    };
  }

  if (code === "openapi00001") {
    return {
      contractVersion: ERP07_SHEIN_ENDPOINT_CONTRACT_VERSION,
      endpoint: contractItem.id,
      outcome: "known_failed",
      status,
      code,
      traceId,
      retryClass: "manual_new_attempt",
      requiresReauthorization: true,
      effective: false,
      message,
    };
  }

  const transient = status === null || status === 429 || (status >= 500 && status <= 599) || code === "832213";
  if (contractItem.mode !== "read" && transient && sendBoundary !== "before_send") {
    return {
      contractVersion: ERP07_SHEIN_ENDPOINT_CONTRACT_VERSION,
      endpoint: contractItem.id,
      outcome: "result_unknown",
      status,
      code,
      traceId,
      retryClass: "readback_only",
      effective: false,
      message: "业务写入边界结果不确定，必须先官方回读，不得重发",
    };
  }

  return {
    contractVersion: ERP07_SHEIN_ENDPOINT_CONTRACT_VERSION,
    endpoint: contractItem.id,
    outcome: "known_failed",
    status,
    code,
    traceId,
    retryClass: failureClass(contractItem, { status, code, sendBoundary }),
    effective: false,
    message,
  };
}
