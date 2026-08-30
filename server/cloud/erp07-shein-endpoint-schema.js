import {
  ERP07_SHEIN_ENDPOINT_CONTRACT_VERSION,
} from "./erp07-shein-endpoint-contract.js";

export const ERP07_SHEIN_ENDPOINT_SCHEMA_VERSION =
  "erp07-shein-endpoint-schemas-v1";

const SOURCE_CATALOG =
  "docs/HANZHOU_POLARIS_API_SOURCE_CATALOG_2026-08-29.md";
const CAPABILITY_MATRIX = "docs/V2_SHEIN_API_CAPABILITY_MATRIX.md";

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function field(type, options = {}) {
  return { type, ...options };
}

function arrayOf(items, options = {}) {
  return field("array", { items, ...options });
}

function envelope(info = field("object", { additionalProperties: "preserve" })) {
  return {
    type: "object",
    required: ["code"],
    fields: {
      code: field(["string", "integer"]),
      msg: field("string"),
      traceId: field("string"),
      info,
    },
    additionalProperties: "preserve",
  };
}

function source({ files, officialUpdatedAt = null, evidenceStatus }) {
  return {
    files,
    officialUpdatedAt,
    evidenceStatus,
    authorizedStoreRead: "not_observed",
  };
}

function readFixtures(info = {}) {
  return {
    success: {
      response: {
        status: 200,
        payload: { code: "0", msg: "OK", traceId: "fixture-read-success", info },
      },
      expectedOutcome: "read_success",
    },
    empty: {
      response: {
        status: 200,
        payload: {
          code: "0",
          msg: "OK",
          traceId: "fixture-read-empty",
          info: { data: [], meta: { count: 0 } },
        },
      },
      semantic: "empty_not_found_or_no_data_must_not_become_zero",
      expectedOutcome: "read_success",
    },
    partial: {
      response: {
        status: 200,
        payload: {
          code: "0",
          msg: "OK",
          traceId: "fixture-read-partial",
          info: { data: [{}], partial: true },
        },
      },
      semantic: "partial_must_remain_partial_and_not_overwrite_last_known_good",
      expectedOutcome: "read_success",
    },
    business_failure: {
      response: {
        status: 200,
        payload: {
          code: "BUSINESS_REJECTED",
          msg: "业务条件不满足",
          traceId: "fixture-read-business-failure",
        },
      },
      expectedOutcome: "known_failed",
    },
    auth_failure: {
      response: {
        status: 403,
        payload: {
          code: "openapi00001",
          msg: "无权限",
          traceId: "fixture-read-auth-failure",
        },
      },
      expectedOutcome: "known_failed",
      expectedRetryClass: "manual_new_attempt",
    },
    rate_limited: {
      response: {
        status: 429,
        payload: {
          code: "832213",
          msg: "请求过于频繁",
          traceId: "fixture-read-rate-limited",
        },
      },
      expectedOutcome: "known_failed",
      expectedRetryClass: "safe_before_send_retry",
    },
    timeout: {
      error: { status: 504, code: "NETWORK_TIMEOUT", message: "请求超时" },
      expectedOutcome: "known_failed",
      expectedRetryClass: "safe_before_send_retry",
    },
  };
}

function writeFixtures(successPayload, { missingReceipt = null } = {}) {
  const fixtures = {
    success: {
      response: { status: 200, payload: successPayload },
      expectedOutcome: "accepted",
      acceptedEvidence: true,
    },
    business_failure: {
      response: {
        status: 200,
        payload: {
          code: "BUSINESS_REJECTED",
          msg: "业务校验失败",
          traceId: "fixture-write-business-failure",
        },
      },
      expectedOutcome: "known_failed",
    },
    auth_failure: {
      response: {
        status: 403,
        payload: {
          code: "openapi00001",
          msg: "无权限",
          traceId: "fixture-write-auth-failure",
        },
      },
      expectedOutcome: "known_failed",
      expectedRetryClass: "manual_new_attempt",
    },
    rate_limited: {
      response: {
        status: 429,
        payload: {
          code: "832213",
          msg: "请求过于频繁",
          traceId: "fixture-write-rate-limited",
        },
      },
      expectedOutcome: "result_unknown",
      expectedRetryClass: "readback_only",
    },
    timeout: {
      error: { status: 504, code: "NETWORK_TIMEOUT", message: "请求超时" },
      expectedOutcome: "result_unknown",
      expectedRetryClass: "readback_only",
    },
  };
  if (missingReceipt) {
    fixtures.missing_receipt = {
      response: {
        status: 200,
        payload: missingReceipt,
      },
      expectedOutcome: "result_unknown",
      expectedRetryClass: "readback_only",
    };
  }
  return fixtures;
}

const COMMON_REQUEST_HEADERS = Object.freeze([
  "Content-Type",
  "x-lt-openKeyId",
  "x-lt-timestamp",
  "x-lt-signature",
]);

const SCHEMAS = {
  "product.search": {
    mode: "read",
    method: "POST",
    path: "/open-api/goods/searchProduct",
    schemaStatus: "fixture_ready",
    source: source({
      files: ["docs/shein-api-raw/19ae8c53-b19f-4c27-b444-a91fe923280d.txt"],
      officialUpdatedAt: "2026-03-27 15:55:46",
      evidenceStatus: "official_source_and_code_tested",
    }),
    headers: COMMON_REQUEST_HEADERS,
    request: {
      type: "object",
      required: ["pageNum", "pageSize"],
      fields: {
        pageNum: field("integer", { min: 1 }),
        pageSize: field("integer", { min: 1, max: 10 }),
        categoryIds: arrayOf(field(["integer", "string"]), { maxItems: 10 }),
        spuNameList: arrayOf(field("string"), { maxItems: 10 }),
        skcNameList: arrayOf(field("string"), { maxItems: 10 }),
        skuCodeList: arrayOf(field("string"), { maxItems: 10 }),
        skcSupplierCodeList: arrayOf(field("string"), { maxItems: 10 }),
        supplierSkuList: arrayOf(field("string"), { maxItems: 10 }),
        skcShelfStatus: field("integer", { enum: [0, 1] }),
        languageList: arrayOf(field("string"), { maxItems: 5 }),
        createTimeStart: field("string"),
        createTimeEnd: field("string"),
        updateTimeStart: field("string"),
        updateTimeEnd: field("string"),
      },
      additionalProperties: "fail",
    },
    response: envelope(field("object", {
      fields: {
        meta: field("object", { additionalProperties: "preserve" }),
        count: field("integer", { min: 0 }),
        data: arrayOf(field("object", { additionalProperties: "preserve" })),
      },
      additionalProperties: "preserve",
    })),
    fixtures: readFixtures({
      meta: { count: 1 },
      count: 1,
      data: [{ spuName: "SPU-FIXTURE", skcList: [] }],
    }),
  },
  "product.spu_info": {
    mode: "read",
    method: "POST",
    path: "/open-api/goods/spu-info",
    schemaStatus: "fixture_ready",
    source: source({
      files: ["docs/shein-api-raw/70563550-c83f-4896-a26f-320b7e946771.txt"],
      officialUpdatedAt: "2026-07-10 10:46:54",
      evidenceStatus: "official_source_and_code_tested",
    }),
    headers: COMMON_REQUEST_HEADERS,
    request: {
      type: "object",
      required: ["languageList", "spuName"],
      fields: {
        languageList: arrayOf(field("string"), { minItems: 1, maxItems: 5 }),
        spuName: field("string"),
      },
      additionalProperties: "fail",
    },
    response: envelope(),
    fixtures: readFixtures({
      data: { spuName: "SPU-FIXTURE", skcList: [] },
    }),
  },
  "sales.sku": {
    mode: "read",
    method: "POST",
    path: "/open-api/goods/query-sku-sales",
    schemaStatus: "fixture_ready_source_pending",
    source: source({
      files: [CAPABILITY_MATRIX, "server/store-data-sync.js"],
      evidenceStatus: "code_tested_official_method_only",
    }),
    headers: COMMON_REQUEST_HEADERS,
    request: {
      type: "object",
      requiredExactlyOneOf: ["skuCodeList", "skcNameList", "spuNameList"],
      fields: {
        skuCodeList: arrayOf(field("string"), { minItems: 1, maxItems: 100 }),
        skcNameList: arrayOf(field("string"), { minItems: 1, maxItems: 100 }),
        spuNameList: arrayOf(field("string"), { minItems: 1, maxItems: 100 }),
      },
      additionalProperties: "fail",
    },
    response: envelope(),
    fixtures: readFixtures({
      data: [{ skuCode: "SKU-FIXTURE", sales: 3 }],
    }),
  },
  "preflight.publish_permission": {
    mode: "read",
    method: "GET",
    path: "/open-api/goods/product/check-publish-permission",
    schemaStatus: "fixture_ready_source_pending",
    source: source({
      files: [CAPABILITY_MATRIX, "docs/shein-api-raw/53ae21b9-3852-4fae-996e-b7a6ceb777c5.txt"],
      officialUpdatedAt: "2026-07-10 10:32:40",
      evidenceStatus: "code_tested_official_method_only",
    }),
    headers: COMMON_REQUEST_HEADERS,
    request: { type: "object", fields: {}, additionalProperties: "fail" },
    response: envelope(),
    fixtures: readFixtures({ canPublishProduct: true }),
  },
  "preflight.publish_quota": {
    mode: "read",
    method: "POST",
    path: "/open-api/goods-publish-quotas/detail",
    schemaStatus: "fixture_ready_source_pending",
    source: source({
      files: [CAPABILITY_MATRIX, "docs/shein-api-raw/b89edd4a-52b4-4077-abc2-51fdd9001701.txt"],
      officialUpdatedAt: "2026-07-21 20:27:37",
      evidenceStatus: "code_tested_official_method_only",
    }),
    headers: COMMON_REQUEST_HEADERS,
    request: { type: "object", fields: {}, additionalProperties: "fail" },
    response: envelope(),
    fixtures: readFixtures({ availableLimit: 3 }),
  },
  "preflight.supplier_sku_duplicate": {
    mode: "read",
    method: "POST",
    path: "/open-api/goods/product/check-supplierSku-repeated",
    schemaStatus: "fixture_ready_source_pending",
    source: source({
      files: [CAPABILITY_MATRIX, "docs/shein-api-raw/05562b51-1db4-4f91-88dd-384ffb9af2b7.txt"],
      officialUpdatedAt: "2026-06-12 13:55:48",
      evidenceStatus: "code_tested_official_method_only",
    }),
    headers: COMMON_REQUEST_HEADERS,
    request: {
      type: "object",
      fields: {
        supplierSkuList: arrayOf(field("string"), { minItems: 1, maxItems: 100 }),
        supplier_sku_list: arrayOf(field("string"), { minItems: 1, maxItems: 100 }),
      },
      additionalProperties: "preserve",
    },
    response: envelope(),
    fixtures: readFixtures({ data: [{ supplierSku: "SKU-FIXTURE", repeated: false }] }),
  },
  "media.product_upload": {
    mode: "non_business_write",
    method: "POST",
    path: "/open-api/goods/upload-pic",
    schemaStatus: "fixture_ready",
    source: source({
      files: [CAPABILITY_MATRIX, "docs/shein-api-raw/53ae21b9-3852-4fae-996e-b7a6ceb777c5.txt:1514-1518"],
      officialUpdatedAt: "2026-07-10 10:32:40",
      evidenceStatus: "official_field_reference_and_code_tested",
    }),
    headers: COMMON_REQUEST_HEADERS,
    request: {
      type: "multipart",
      required: ["image_type", "file"],
      fields: {
        image_type: field("integer", { enum: [1, 2, 5, 6, 7] }),
        file: field("blob"),
      },
      additionalProperties: "fail",
    },
    response: envelope(field("object", {
      required: ["image_url"],
      fields: {
        image_url: field("string"),
      },
      additionalProperties: "preserve",
    })),
    fixtures: writeFixtures({
      code: "0",
      msg: "OK",
      traceId: "fixture-upload-success",
      info: {
        image_url: "https://fixture.invalid/shein-upload.jpg",
      },
    }, {
      missingReceipt: {
        code: "0",
        msg: "OK",
        traceId: "fixture-upload-missing-receipt",
        info: {},
      },
    }),
  },
  "product.publish_or_edit": {
    mode: "business_write",
    method: "POST",
    path: "/open-api/goods/product/publishOrEdit",
    schemaStatus: "fixture_ready_partial",
    source: source({
      files: ["docs/shein-api-raw/53ae21b9-3852-4fae-996e-b7a6ceb777c5.txt"],
      officialUpdatedAt: "2026-07-10 10:32:40",
      evidenceStatus: "official_source_and_adapter_tested_request_schema_partial",
    }),
    headers: COMMON_REQUEST_HEADERS,
    request: {
      type: "object",
      required: ["category_id", "skc_list"],
      fields: {
        category_id: field(["string", "integer"]),
        product_type_id: field(["string", "integer"]),
        source_system: field("string", { enum: ["OpenAPI"] }),
        spu_name: field("string"),
        skc_list: arrayOf(field("object", { additionalProperties: "preserve" }), {
          minItems: 1,
          maxItems: 40,
        }),
      },
      additionalProperties: "preserve",
    },
    response: envelope(),
    fixtures: writeFixtures({
      code: "0",
      msg: "OK",
      traceId: "fixture-publish-success",
      info: { success: true },
    }, {
      code: "0",
      msg: "OK",
      traceId: "fixture-publish-missing-receipt",
      info: {},
    }),
  },
  "review.document_state": {
    mode: "read",
    method: "POST",
    path: "/open-api/goods/query-document-state",
    schemaStatus: "fixture_ready_source_pending",
    source: source({
      files: [CAPABILITY_MATRIX, "server/cloud/erp06-shein-publish-adapter-contract.js"],
      evidenceStatus: "adapter_tested_official_method_only",
    }),
    headers: COMMON_REQUEST_HEADERS,
    request: {
      type: "object",
      fields: {
        spu_name: field("string"),
        skc_name: field("string"),
        document_no: field("string"),
      },
      additionalProperties: "preserve",
    },
    response: envelope(),
    fixtures: readFixtures({ data: [{ status: "PENDING" }] }),
  },
  "compliance.photo_upload": {
    mode: "non_business_write",
    method: "POST",
    path: "/open-api/goods-compliance/upload-skc-label-picture",
    schemaStatus: "fixture_ready",
    source: source({
      files: ["docs/shein-api-raw/official-upload-skc-label-picture-2025-06-27.md"],
      officialUpdatedAt: "2025-06-27 15:10:05",
      evidenceStatus: "official_source_and_code_tested",
    }),
    headers: COMMON_REQUEST_HEADERS,
    request: {
      type: "multipart",
      required: ["file"],
      fields: { file: field("blob") },
      additionalProperties: "fail",
    },
    response: envelope(field("object", {
      required: ["imageUrl", "imageMd5"],
      fields: {
        imageUrl: field("string"),
        imageMd5: field("string"),
        code: field(["string", "integer"]),
        msg: field(["string", "null"]),
      },
      additionalProperties: "preserve",
    })),
    fixtures: writeFixtures({
      code: "0",
      msg: "OK",
      traceId: "fixture-photo-upload-success",
      info: {
        imageUrl: "https://fixture.invalid/photo.jpg",
        imageMd5: "fixture-md5",
      },
    }, {
      code: "0",
      msg: "OK",
      traceId: "fixture-photo-upload-missing-receipt",
      info: {},
    }),
  },
  "compliance.photo_bind": {
    mode: "business_write",
    method: "POST",
    path: "/open-api/goods-compliance/skc-save-label",
    schemaStatus: "fixture_ready",
    source: source({
      files: ["docs/shein-api-raw/official-skc-save-label-2025-09-29.md"],
      officialUpdatedAt: "2025-09-29 19:19:23",
      evidenceStatus: "official_source_and_code_tested",
    }),
    headers: COMMON_REQUEST_HEADERS,
    request: {
      type: "object",
      required: ["skcList"],
      fields: {
        skcList: arrayOf(field("string"), { minItems: 1 }),
        packageLableList: arrayOf(field("object", {
          required: ["imageUrl", "imageMd5"],
          fields: { imageUrl: field("string"), imageMd5: field("string") },
        })),
        bodyLableList: arrayOf(field("object", {
          required: ["imageUrl", "imageMd5"],
          fields: { imageUrl: field("string"), imageMd5: field("string") },
        })),
      },
      additionalProperties: "fail",
    },
    response: envelope(),
    fixtures: writeFixtures({
      code: "0",
      msg: "OK",
      traceId: "fixture-photo-bind-success",
      info: { totalCount: 1, successCount: 1, faildCount: 0, faildList: [] },
    }),
  },
  "pricing.proof_upload": {
    mode: "non_business_write",
    method: "POST",
    path: "/open-api/goods/discuss/upload-discuss-file",
    schemaStatus: "fixture_ready_source_pending",
    source: source({
      files: [CAPABILITY_MATRIX, "server/shein-upload.js"],
      evidenceStatus: "code_tested_official_method_only",
    }),
    headers: COMMON_REQUEST_HEADERS,
    request: {
      type: "multipart",
      required: ["type", "file"],
      fields: { type: field("integer", { enum: [1, 4, 5] }), file: field("blob") },
      additionalProperties: "fail",
    },
    response: envelope(field("object", {
      required: ["objectKey"],
      fields: { objectKey: field("string") },
      additionalProperties: "preserve",
    })),
    fixtures: writeFixtures({
      code: "0",
      msg: "OK",
      traceId: "fixture-proof-upload-success",
      info: { objectKey: "fixture/proof.pdf" },
    }, {
      code: "0",
      msg: "OK",
      traceId: "fixture-proof-upload-missing-receipt",
      info: {},
    }),
  },
};

deepFreeze(SCHEMAS);

const SCHEMA_BY_PATH = new Map(
  Object.entries(SCHEMAS).map(([id, schema]) => [
    `${schema.method} ${schema.path}`,
    { id, schema },
  ]),
);

function resolveSchema(endpoint) {
  const value = String(endpoint || "");
  if (SCHEMAS[value]) return { id: value, schema: SCHEMAS[value] };
  const byPath = SCHEMA_BY_PATH.get(value);
  if (byPath) return byPath;
  const error = new Erp07EndpointSchemaError(
    "ERP07_ENDPOINT_SCHEMA_MISSING",
    "ERP-07 endpoint 尚未具备可用的版本化 schema",
  );
  throw error;
}

export class Erp07EndpointSchemaError extends Error {
  constructor(code, message, path = null) {
    super(message);
    this.name = "Erp07EndpointSchemaError";
    this.code = code;
    this.path = path;
    this.status = 409;
  }
}

function typeMatches(value, expected) {
  if (expected === "any") return true;
  if (expected === "null") return value === null;
  if (expected === "blob") {
    const isBlob = typeof Blob !== "undefined" && value instanceof Blob;
    const isBuffer = typeof Buffer !== "undefined" && Buffer.isBuffer(value);
    return isBlob || isBuffer;
  }
  if (expected === "integer") return Number.isInteger(value);
  if (expected === "number") return typeof value === "number" && Number.isFinite(value);
  if (expected === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (expected === "array") return Array.isArray(value);
  return typeof value === expected;
}

function fail(path, message) {
  throw new Erp07EndpointSchemaError(
    "ERP07_ENDPOINT_SCHEMA_INVALID",
    `${path}: ${message}`,
    path,
  );
}

function validateNode(value, schema, path) {
  const multipart = schema.type === "multipart";
  if (multipart) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      fail(path, "必须是 multipart 对象");
    }
  } else {
    const expectedTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!expectedTypes.some((expected) => typeMatches(value, expected))) {
      fail(path, `类型不符合 schema (${expectedTypes.join("|")})`);
    }
  }
  if (schema.enum && !schema.enum.includes(value)) {
    fail(path, "包含未识别的枚举值，已拒绝继续");
  }
  if (schema.min !== undefined && value < schema.min) fail(path, `不得小于 ${schema.min}`);
  if (schema.max !== undefined && value > schema.max) fail(path, `不得大于 ${schema.max}`);
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      fail(path, `至少需要 ${schema.minItems} 项`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      fail(path, `最多允许 ${schema.maxItems} 项`);
    }
    if (schema.items) value.forEach((item, index) => validateNode(item, schema.items, `${path}[${index}]`));
  }
  if (value && typeof value === "object" && !Array.isArray(value) && schema.fields) {
    for (const key of schema.required || []) {
      if (!(key in value)) fail(`${path}.${key}`, "缺少必填字段");
    }
    if (schema.requiredExactlyOneOf) {
      const present = schema.requiredExactlyOneOf.filter((key) => key in value);
      if (present.length !== 1) {
        fail(path, `必须且只能提供一个字段: ${schema.requiredExactlyOneOf.join(", ")}`);
      }
    }
    if (schema.additionalProperties === "fail") {
      for (const key of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(schema.fields, key)) {
          fail(`${path}.${key}`, "未识别字段，已拒绝继续");
        }
      }
    }
    for (const [key, childSchema] of Object.entries(schema.fields)) {
      if (key in value) validateNode(value[key], childSchema, `${path}.${key}`);
    }
  }
}

export function getErp07EndpointSchema(endpoint) {
  const { id, schema } = resolveSchema(endpoint);
  return schema && Object.freeze({
    id,
    contractVersion: ERP07_SHEIN_ENDPOINT_CONTRACT_VERSION,
    schemaVersion: ERP07_SHEIN_ENDPOINT_SCHEMA_VERSION,
    ...schema,
  });
}

export function listErp07EndpointSchemas() {
  return Object.entries(SCHEMAS).map(([id, schema]) => ({
    id,
    contractVersion: ERP07_SHEIN_ENDPOINT_CONTRACT_VERSION,
    schemaVersion: ERP07_SHEIN_ENDPOINT_SCHEMA_VERSION,
    ...schema,
  }));
}

export function getErp07EndpointFixture(endpoint, kind) {
  const { id, schema } = resolveSchema(endpoint);
  const fixture = schema.fixtures?.[kind];
  if (!fixture) {
    throw new Erp07EndpointSchemaError(
      "ERP07_ENDPOINT_FIXTURE_MISSING",
      `endpoint ${id} 缺少 fixture: ${kind}`,
    );
  }
  return fixture;
}

export function validateErp07EndpointPayload({
  endpoint,
  direction = "response",
  payload,
  fixtureKind = null,
} = {}) {
  const { id, schema } = resolveSchema(endpoint);
  if (fixtureKind && direction !== "response") {
    throw new Erp07EndpointSchemaError(
      "ERP07_ENDPOINT_FIXTURE_DIRECTION_UNSUPPORTED",
      "fixture 只允许按 response schema 校验；request 必须提供实际请求对象",
    );
  }
  const target = fixtureKind ? getErp07EndpointFixture(id, fixtureKind) : { response: { payload } };
  if (target.response?.payload !== undefined) {
    const selectedSchema = direction === "request" ? schema.request : schema.response;
    validateNode(target.response.payload, selectedSchema, `${id}.${direction}`);
  } else if (fixtureKind !== "timeout") {
    fail(`${id}.${direction}`, "fixture 没有可验证 payload");
  }
  return Object.freeze({
    valid: true,
    endpoint: id,
    direction,
    fixtureKind,
    schemaVersion: ERP07_SHEIN_ENDPOINT_SCHEMA_VERSION,
    sourceEvidenceStatus: schema.source.evidenceStatus,
    authorizedStoreRead: schema.source.authorizedStoreRead,
  });
}

export function assertErp07FixtureCatalog() {
  const requiredRead = [
    "success",
    "empty",
    "partial",
    "business_failure",
    "auth_failure",
    "rate_limited",
    "timeout",
  ];
  const requiredWrite = [
    "success",
    "business_failure",
    "auth_failure",
    "rate_limited",
    "timeout",
  ];
  for (const [id, schema] of Object.entries(SCHEMAS)) {
    const required = schema.mode === "read"
      ? requiredRead
      : requiredWrite;
    for (const kind of required) {
      if (!schema.fixtures?.[kind]) {
        throw new Erp07EndpointSchemaError(
          "ERP07_ENDPOINT_FIXTURE_MISSING",
          `endpoint ${id} 缺少必需 fixture: ${kind}`,
        );
      }
    }
  }
  return true;
}
