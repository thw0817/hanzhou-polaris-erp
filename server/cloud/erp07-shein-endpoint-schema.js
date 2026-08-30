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

function envelope(info = field(["object", "array"], { additionalProperties: "preserve" })) {
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

function source({
  files,
  officialUpdatedAt = null,
  evidenceStatus,
  responseEvidence = null,
}) {
  const evidence = responseEvidence || {
    status: "not_captured",
    fields: ["code", "msg", "traceId", "info"],
    sourceFiles: [],
    gaps: ["official_response_fields_not_captured"],
  };
  return {
    files,
    officialUpdatedAt,
    evidenceStatus,
    authorizedStoreRead: "not_observed",
    responseEvidence: {
      status: evidence.status,
      fields: evidence.fields,
      sourceFiles: evidence.sourceFiles || [],
      gaps: evidence.gaps || [],
      authorizedStoreRead: "not_observed",
    },
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

function readEndpoint({
  path,
  files,
  officialUpdatedAt,
  request,
  info = {},
  headers = COMMON_REQUEST_HEADERS,
  schemaStatus = "fixture_ready",
  evidenceStatus = "official_source_and_code_tested_request_schema",
}) {
  return {
    mode: "read",
    method: "POST",
    path,
    schemaStatus,
    source: source({ files, officialUpdatedAt, evidenceStatus }),
    headers,
    request,
    response: envelope(),
    fixtures: readFixtures(info),
  };
}

const SALES_RESPONSE_ROW = field("object", {
  fields: {
    skuCode: field("string"),
    realTimeSaleCnt: field(["integer", "string"]),
    cydSaleCnt: field(["integer", "string"]),
    c7dSaleCnt: field(["integer", "string"]),
    c30dSaleCnt: field(["integer", "string"]),
    dt: field("string"),
  },
  additionalProperties: "preserve",
});

const SALES_RESPONSE_INFO = field("object", {
  fields: {
    dataList: arrayOf(SALES_RESPONSE_ROW),
  },
  additionalProperties: "preserve",
});

const PUBLISH_PERMISSION_RESPONSE_INFO = field("object", {
  fields: {
    canPublishProduct: field("boolean"),
    can_publish_product: field("boolean"),
    reason: field("string"),
  },
  additionalProperties: "preserve",
});

const PUBLISH_QUOTA_RESPONSE_INFO = field("object", {
  fields: {
    isControlled: field("boolean"),
    availableQuota: field(["integer", "string"]),
    availableLimit: field(["integer", "string"]),
    totalQuota: field(["integer", "string"]),
    usedCount: field(["integer", "string"]),
  },
  additionalProperties: "preserve",
});

const SUPPLIER_SKU_RESPONSE_ROW = field("object", {
  fields: {
    supplierSku: field("string"),
    supplier_sku: field("string"),
    repeated: field("boolean"),
  },
  additionalProperties: "preserve",
});

const SUPPLIER_SKU_RESPONSE_INFO = field(["object", "array"], {
  fields: {
    data: arrayOf(SUPPLIER_SKU_RESPONSE_ROW),
    dataList: arrayOf(SUPPLIER_SKU_RESPONSE_ROW),
  },
  items: SUPPLIER_SKU_RESPONSE_ROW,
  additionalProperties: "preserve",
});

const DOCUMENT_STATE_SKU = field("object", {
  fields: {
    sku_code: field("string"),
    skuCode: field("string"),
  },
  additionalProperties: "preserve",
});

const DOCUMENT_STATE_RECORD = field("object", {
  fields: {
    spu_name: field(["string", "number"]),
    spuName: field(["string", "number"]),
    skc_name: field(["string", "number"]),
    skcName: field(["string", "number"]),
    sku_list: arrayOf(DOCUMENT_STATE_SKU),
    skuList: arrayOf(DOCUMENT_STATE_SKU),
    document_sn: field(["string", "number"]),
    documentSn: field(["string", "number"]),
    version: field(["string", "number"]),
    audit_time: field(["string", "number"]),
    auditTime: field(["string", "number"]),
    audit_state: field(["integer", "string"]),
    documentState: field(["integer", "string"]),
    failed_reason: arrayOf(field("object", { additionalProperties: "preserve" })),
    failedReason: arrayOf(field("object", { additionalProperties: "preserve" })),
    workflow_stage: field("string"),
    workflowStage: field("string"),
    stage: field("string"),
  },
  additionalProperties: "preserve",
});

const DOCUMENT_STATE_RESPONSE_INFO = field(["object", "array", "string"], {
  fields: {
    data: arrayOf(DOCUMENT_STATE_RECORD),
    skcList: arrayOf(DOCUMENT_STATE_RECORD),
  },
  items: DOCUMENT_STATE_RECORD,
  additionalProperties: "preserve",
});

function blockedEndpoint({
  path,
  mode,
  files,
  officialUpdatedAt = null,
  status = "archived_frozen",
  reason,
  request = { type: "object", fields: {}, additionalProperties: "fail" },
  headers = COMMON_REQUEST_HEADERS,
}) {
  const successPayload = {
    code: "0",
    msg: "OK",
    traceId: "fixture-blocked-success-never-executable",
    info: { blocked: true },
  };
  return {
    mode,
    method: "POST",
    path,
    schemaStatus: status,
    validationStatus: "blocked",
    blockReason: reason,
    source: source({
      files,
      officialUpdatedAt,
      evidenceStatus: "official_source_but_not_executable",
    }),
    headers,
    request,
    response: envelope(),
    fixtures: mode === "read"
      ? readFixtures({ blocked: true })
      : writeFixtures(successPayload),
  };
}

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
      files: [
        CAPABILITY_MATRIX,
        "docs/shein-api-raw/5e17972e-7544-4139-b348-e9e08037aaaf.txt:276",
        "server/store-data-sync.js",
      ],
      evidenceStatus: "code_tested_official_method_only",
      responseEvidence: {
        status: "internal_consumer_contract",
        fields: [
          "info.dataList[].skuCode",
          "info.dataList[].realTimeSaleCnt",
          "info.dataList[].cydSaleCnt",
          "info.dataList[].c7dSaleCnt",
          "info.dataList[].c30dSaleCnt",
          "info.dataList[].dt",
        ],
        sourceFiles: ["server/store-data-sync.js", "server/store-data-sync.test.js"],
        gaps: ["official_response_fields_not_captured"],
      },
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
    response: envelope(SALES_RESPONSE_INFO),
    fixtures: readFixtures({
      dataList: [{
        skuCode: "SKU-FIXTURE",
        realTimeSaleCnt: 1,
        cydSaleCnt: 2,
        c7dSaleCnt: 7,
        c30dSaleCnt: 30,
        dt: "20260830",
      }],
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
      responseEvidence: {
        status: "internal_consumer_contract",
        fields: [
          "info.canPublishProduct",
          "info.can_publish_product",
          "info.reason",
        ],
        sourceFiles: [CAPABILITY_MATRIX, "server/publish-preflight.js"],
        gaps: ["official_response_fields_not_captured"],
      },
    }),
    headers: COMMON_REQUEST_HEADERS,
    request: { type: "object", fields: {}, additionalProperties: "fail" },
    response: envelope(PUBLISH_PERMISSION_RESPONSE_INFO),
    fixtures: readFixtures({ canPublishProduct: true }),
  },
  "preflight.publish_quota": {
    mode: "read",
    method: "POST",
    path: "/open-api/goods-publish-quotas/detail",
    schemaStatus: "fixture_ready_source_pending",
    source: source({
      files: [CAPABILITY_MATRIX, "server/publish-preflight.js"],
      evidenceStatus: "code_tested_official_method_only",
      responseEvidence: {
        status: "internal_consumer_contract",
        fields: [
          "info.isControlled",
          "info.availableQuota",
          "info.availableLimit",
          "info.totalQuota",
          "info.usedCount",
        ],
        sourceFiles: [CAPABILITY_MATRIX, "server/publish-preflight.js"],
        gaps: ["official_response_fields_not_captured"],
      },
    }),
    headers: COMMON_REQUEST_HEADERS,
    request: { type: "object", fields: {}, additionalProperties: "fail" },
    response: envelope(PUBLISH_QUOTA_RESPONSE_INFO),
    fixtures: readFixtures({ availableLimit: 3 }),
  },
  "preflight.supplier_sku_duplicate": {
    mode: "read",
    method: "POST",
    path: "/open-api/goods/product/check-supplierSku-repeated",
    schemaStatus: "fixture_ready_source_pending",
    source: source({
      files: [
        CAPABILITY_MATRIX,
        "docs/shein-api-raw/05562b51-1db4-4f91-88dd-384ffb9af2b7.txt:662",
        "server/publish-preflight.js",
      ],
      officialUpdatedAt: "2026-06-12 13:55:48",
      evidenceStatus: "code_tested_official_method_only",
      responseEvidence: {
        status: "internal_consumer_contract",
        fields: [
          "info[].supplierSku",
          "info[].supplier_sku",
          "info[].repeated",
        ],
        sourceFiles: ["server/publish-preflight.js", "server/publish-preflight.test.js"],
        gaps: ["official_response_fields_not_captured"],
      },
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
    response: envelope(SUPPLIER_SKU_RESPONSE_INFO),
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
      responseEvidence: {
        status: "internal_consumer_contract",
        fields: [
          "info[].spu_name",
          "info[].skc_name",
          "info[].sku_list[].sku_code",
          "info[].document_sn",
          "info[].version",
          "info[].audit_time",
          "info[].audit_state",
          "info[].failed_reason[]",
        ],
        sourceFiles: [
          "server/cloud/document-state-projections.js",
          "server/cloud/erp06-shein-publish-adapter-contract.js",
        ],
        gaps: ["official_response_fields_not_captured"],
      },
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
    response: envelope(DOCUMENT_STATE_RESPONSE_INFO),
    fixtures: readFixtures({
      data: [{
        spu_name: "SPU-FIXTURE",
        skc_name: "SKC-FIXTURE",
        sku_list: [{ sku_code: "SKU-FIXTURE" }],
        document_sn: "DOC-FIXTURE",
        version: "1",
        audit_time: "2026-08-30T00:00:00Z",
        audit_state: 1,
        failed_reason: [],
      }],
    }),
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
      responseEvidence: {
        status: "internal_consumer_contract",
        fields: ["info.objectKey"],
        sourceFiles: ["server/shein-upload.js", "server/shein-upload.test.js"],
        gaps: ["official_response_fields_not_captured"],
      },
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
  "inventory.stock_query": readEndpoint({
    path: "/open-api/stock/stock-query",
    files: ["docs/shein-api-raw/4c50e94e-d6b0-4668-910f-f2b5efbbe478.txt"],
    officialUpdatedAt: "2026-04-27 20:38:29",
    schemaStatus: "fixture_ready_archived_revalidation",
    evidenceStatus: "official_request_and_response_fields_code_tested_archived_revalidation",
    request: {
      type: "object",
      required: ["warehouseType"],
      requiredExactlyOneOf: ["skuCodeList", "skcNameList", "spuNameList"],
      fields: {
        skuCodeList: arrayOf(field("string"), { minItems: 1, maxItems: 100 }),
        skcNameList: arrayOf(field("string"), { minItems: 1, maxItems: 100 }),
        spuNameList: arrayOf(field("string"), { minItems: 1, maxItems: 100 }),
        warehouseType: field("string", { enum: ["1", "2", "3"] }),
        invType: field("string", { enum: ["PI", "VI", "JI"] }),
      },
      additionalProperties: "fail",
    },
    info: {
      goodsInventory: [{
        spuName: "SPU-FIXTURE",
        skcName: "SKC-FIXTURE",
        skuList: [{
          skuCode: "SKU-FIXTURE",
          totalInventoryQuantity: 0,
          totalLockedQuantity: 0,
          totalTempLockQuantity: 0,
          totalUsableInventory: 0,
          warehouseInventoryList: [],
        }],
      }],
    },
  }),
  "rules.category_tree": readEndpoint({
    path: "/open-api/goods/query-category-tree",
    files: ["docs/shein-api-raw/eab38e01-950a-4687-8c99-0c2456f2fcb0.txt"],
    officialUpdatedAt: "2026-02-20 11:00:30",
    headers: ["language", ...COMMON_REQUEST_HEADERS],
    request: {
      type: "object",
      fields: {},
      additionalProperties: "fail",
    },
    info: {
      data: [{
        category_id: 1,
        product_type_id: 2,
        parent_category_id: 0,
        category_name: "Fixture",
        last_category: true,
        children: [],
      }],
    },
  }),
  "rules.attribute_template": readEndpoint({
    path: "/open-api/goods/query-attribute-template",
    files: ["docs/shein-api-raw/cd73132c-8485-43e0-839b-eaaff57c8087.txt"],
    officialUpdatedAt: "2026-07-10 10:40:10",
    headers: ["language", ...COMMON_REQUEST_HEADERS],
    request: {
      type: "object",
      required: ["product_type_id_list"],
      fields: {
        product_type_id_list: arrayOf(field("integer"), { minItems: 1, maxItems: 10 }),
      },
      additionalProperties: "fail",
    },
    info: {
      data: [{
        product_type_id: 2,
        attribute_infos: [{
          attribute_id: 3,
          attribute_name: "Fixture",
          attribute_is_show: 1,
          attribute_type: 4,
          attribute_label: 0,
          attribute_mode: 3,
          attribute_status: 2,
          attribute_value_info_list: [],
          rule_info_list: [],
        }],
      }],
    },
  }),
  "rules.publish_fill_in_standard": readEndpoint({
    path: "/open-api/goods/query-publish-fill-in-standard",
    files: ["docs/shein-api-raw/db52ff3f-2d55-463d-ba55-b7050a3ecb06.txt"],
    officialUpdatedAt: "2026-07-02 21:00:12",
    headers: ["language", ...COMMON_REQUEST_HEADERS],
    request: {
      type: "object",
      fields: {
        category_id: field(["integer", "string"]),
        spu_name: field("string"),
      },
      additionalProperties: "fail",
    },
    info: {
      fill_in_standard_list: [{
        field_key: "skc_title",
        module: "基本信息",
        required: true,
        show: true,
        currency: "CNY",
        default_language: "zh-cn",
      }],
    },
  }),
  "rules.associated_attribute": readEndpoint({
    path: "/open-api/goods/get-associated-attribute-rules",
    files: ["docs/shein-api-raw/5dc7f766-3173-498a-b76e-5978b652f502.txt"],
    officialUpdatedAt: "2026-04-21 17:39:13",
    request: {
      type: "object",
      required: ["get_linked_rule_req_list"],
      fields: {
        get_linked_rule_req_list: arrayOf(field("object", {
          required: ["category_id", "product_type_id", "attribute_list"],
          fields: {
            group_id: field(["string", "integer"]),
            category_id: field("integer"),
            product_type_id: field("integer"),
            attribute_list: arrayOf(field("object", {
              required: ["attribute_id"],
              fields: {
                attribute_id: field("integer"),
                attribute_value_id: field("integer"),
              },
              additionalProperties: "fail",
            }), { minItems: 1 }),
          },
          additionalProperties: "fail",
        }), { minItems: 1, maxItems: 10 }),
      },
      additionalProperties: "fail",
    },
    info: {
      data: [{ group_id: "1", link_rule_attribute_list: [] }],
    },
  }),
  "rules.custom_attribute_permission": blockedEndpoint({
    path: "/open-api/goods/get-custom-attribute-permission-config",
    mode: "read",
    status: "source_pending",
    files: [
      "docs/HANZHOU_POLARIS_API_SOURCE_CATALOG_2026-08-29.md",
      "docs/shein-api-raw/5f068191-dd13-485f-b709-b887047e2078.txt:379",
    ],
    reason: "官方独立请求/响应字段原文未归档，补齐来源证据前禁止猜测调用",
  }),
  "product.transform_image": blockedEndpoint({
    path: "/open-api/goods/transform-pic",
    mode: "non_business_write",
    files: [CAPABILITY_MATRIX, "docs/shein-api-raw/b8f93f3c-ef21-4cf4-a33f-99df4cd7b417.txt"],
    reason: "COS-first 已冻结旧图片转换链路，禁止从新上传流程旁路调用",
  }),
  "compliance.requirements": readEndpoint({
    path: "/open-api/goods-compliance-requirements/list",
    files: ["docs/shein-api-raw/ebf508e0-fbaa-4d93-a288-ab9749608417.txt"],
    officialUpdatedAt: "2026-06-29 19:34:41",
    request: {
      type: "object",
      required: ["pageNum", "pageSize"],
      fields: {
        certificateTypeCodes: arrayOf(field("string"), { maxItems: 20 }),
        pageNum: field("integer", { min: 1 }),
        pageSize: field("integer", { min: 1, max: 200 }),
        reviewStates: arrayOf(field("integer", { enum: [0, 1, 2, 3] })),
        skcNames: arrayOf(field("string"), { maxItems: 200 }),
      },
      additionalProperties: "fail",
    },
    info: {
      data: [{
        certificateTypeCode: "FIXTURE",
        complianceGroupCode: "ZSZZL",
        isRequired: 0,
        reviewState: 0,
        skcName: "SKC-FIXTURE",
      }],
    },
  }),
  "compliance.photo_requirements": readEndpoint({
    path: "/open-api/goods-compliance/skc-label-list",
    files: ["docs/shein-api-raw/1c4baafc-e545-4a42-9fe6-675a90e88d9c.txt"],
    officialUpdatedAt: "2025-09-24 19:40:32",
    request: {
      type: "object",
      required: ["pageSize", "pageNum", "skcList"],
      fields: {
        pageSize: field("integer", { min: 1, max: 100 }),
        pageNum: field("integer", { min: 1 }),
        skcList: arrayOf(field("string"), { minItems: 1 }),
        skcShelfStatusList: arrayOf(field("integer", { enum: [0, 1, 2, 3] })),
        reviewStatusList: arrayOf(field("integer", { enum: [1, 2, 3] })),
        isRequired: field("integer", { enum: [0, 1, 10] }),
      },
      additionalProperties: "fail",
    },
    info: [{
      skc: "SKC-FIXTURE",
      skcShelfStatus: ["1"],
      skcLabelInfoList: [],
    }],
  }),
  "compliance.certificate_schema": readEndpoint({
    path: "/open-api/goods-certificate-schemas/detail",
    files: ["docs/shein-api-raw/6645cacd-1dc3-40ad-9e16-57655f3e6028.txt"],
    officialUpdatedAt: "2026-06-30 20:30:58",
    request: {
      type: "object",
      fields: {
        certificateTypeCodes: arrayOf(field("string"), { maxItems: 10 }),
        certificateTypeIdList: arrayOf(field("integer"), { maxItems: 1000 }),
      },
      additionalProperties: "fail",
    },
    info: {
      certificateTypeInfoList: [{
        certificateTypeId: 1,
        certificateType: "Fixture",
        complianceGroupCode: "ZSZZL",
        isEnabled: 1,
        presetInfoList: [],
        otherPresetInfoList: [],
      }],
    },
  }),
  "compliance.certificate_search": readEndpoint({
    path: "/open-api/goods-certificates/search",
    files: ["docs/shein-api-raw/b48b87e0-24e6-4519-9468-a1abf1a9f5c6.txt"],
    officialUpdatedAt: "2026-07-03 14:20:15",
    request: {
      type: "object",
      required: ["pageNum", "pageSize"],
      fields: {
        certificateTypeCodeList: arrayOf(field("string"), { maxItems: 10 }),
        fileName: field("string"),
        pageNum: field("integer", { min: 1 }),
        pageSize: field("integer", { min: 1, max: 100 }),
        poolSnList: arrayOf(field("string")),
        statusList: arrayOf(field("integer", { enum: [1, 2, 3, 4, 5, 6] })),
      },
      additionalProperties: "fail",
    },
    info: { data: [] },
  }),
  "compliance.agency_list": readEndpoint({
    path: "/open-api/goods-compliance/agency-list",
    files: ["docs/shein-api-raw/8592d2a2-69b3-4aad-a18c-337b0cf88427.txt"],
    officialUpdatedAt: "2026-06-29 17:39:21",
    request: {
      type: "object",
      required: ["pageNum", "pageSize"],
      fields: {
        agencyId: field("integer"),
        agencyName: field("string"),
        pageNum: field("integer", { min: 1 }),
        pageSize: field("integer", { min: 1, max: 100 }),
      },
      additionalProperties: "fail",
    },
    info: [],
  }),
  "compliance.warning_rules": readEndpoint({
    path: "/open-api/goods-compliance/query-warning-certificate-rules",
    files: ["docs/shein-api-raw/9f9f5a62-577a-441a-966b-d6e219ec33b9.txt"],
    officialUpdatedAt: "2026-06-29 19:40:05",
    request: {
      type: "object",
      fields: {},
      additionalProperties: "fail",
    },
    info: [],
  }),
  "compliance.certificate_upload": blockedEndpoint({
    path: "/open-api/goods-certificate-files/upload",
    mode: "non_business_write",
    files: ["docs/shein-api-raw/ebf508e0-fbaa-4d93-a288-ab9749608417.txt"],
    reason: "证书文件上传属于冻结的业务写入链路，必须完成 ERP-07 写入审批和回读契约后才可放行",
    request: { type: "multipart", fields: {}, additionalProperties: "fail" },
  }),
  "compliance.certificate_save": blockedEndpoint({
    path: "/open-api/goods-certificates/save",
    mode: "business_write",
    files: ["docs/shein-api-raw/ebf508e0-fbaa-4d93-a288-ab9749608417.txt"],
    reason: "证书创建/编辑属于冻结的业务写入链路，禁止在 schema 未完成回读证明前执行",
  }),
  "compliance.certificate_bind": blockedEndpoint({
    path: "/open-api/goods-certificates/bind",
    mode: "business_write",
    files: ["docs/shein-api-raw/ebf508e0-fbaa-4d93-a288-ab9749608417.txt"],
    reason: "证书绑定属于冻结的业务写入链路，禁止在 schema 未完成回读证明前执行",
  }),
  "compliance.agency_bind": blockedEndpoint({
    path: "/open-api/goods-compliance/save-skc-agency",
    mode: "business_write",
    files: ["docs/shein-api-raw/ebf508e0-fbaa-4d93-a288-ab9749608417.txt"],
    reason: "代理公司绑定属于冻结的业务写入链路，禁止在 schema 未完成回读证明前执行",
  }),
  "compliance.warning_update": blockedEndpoint({
    path: "/open-api/goods-compliance/update-skc-warning-certificate",
    mode: "business_write",
    files: ["docs/shein-api-raw/ebf508e0-fbaa-4d93-a288-ab9749608417.txt"],
    reason: "警示语更新属于冻结的业务写入链路，禁止在 schema 未完成回读证明前执行",
  }),
  "pricing.discussion_list": blockedEndpoint({
    path: "/open-api/goods/discuss/query-discuss-list",
    mode: "read",
    status: "archived_requires_revalidation",
    files: ["docs/shein-api-raw/9e0c21e2-f5a6-4fc0-a2ec-ea6d3e009671.txt"],
    officialUpdatedAt: "2026-07-02 20:35:33",
    reason: "议价接口已标记待复核，完成当前官方字段与店铺证据复核前禁止继续调用",
  }),
  "pricing.discussion_process": blockedEndpoint({
    path: "/open-api/goods/discuss/process-discuss",
    mode: "business_write",
    files: ["docs/shein-api-raw/8b7e05c6-7edf-4c00-ac2c-965fc066939b.txt"],
    officialUpdatedAt: "2026-07-02 20:35:43",
    reason: "议价处理属于冻结的业务写入链路，禁止绕过 result_unknown 回读规则执行",
  }),
  "auth.token_exchange": blockedEndpoint({
    path: "/open-api/auth/get-by-token",
    mode: "credential_write",
    files: ["docs/shein-api-raw/53477f6a-7a28-4070-9b73-17305c89b241.txt"],
    officialUpdatedAt: "2025-12-26 14:35:50",
    status: "credential_exchange_frozen",
    reason: "授权令牌交换会产生凭证，当前只允许由既有授权流程管理，禁止 schema 层直接执行",
    headers: ["Content-Type", "x-lt-appid", "x-lt-timestamp", "x-lt-signature"],
    request: {
      type: "object",
      required: ["tempToken"],
      fields: { tempToken: field("string") },
      additionalProperties: "fail",
    },
  }),
};

deepFreeze(SCHEMAS);

const SCHEMA_BY_PATH = new Map(
  Object.entries(SCHEMAS).map(([id, schema]) => [
    `${schema.method} ${schema.path}`,
    { id, schema },
  ]),
);

const RESPONSE_EVIDENCE_STATUSES = Object.freeze([
  "not_captured",
  "internal_consumer_contract",
  "official_response_contract",
  "authorized_store_read",
]);

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
    validationStatus: schema.validationStatus || "executable",
    ...schema,
  });
}

export function listErp07EndpointSchemas() {
  return Object.entries(SCHEMAS).map(([id, schema]) => ({
    id,
    contractVersion: ERP07_SHEIN_ENDPOINT_CONTRACT_VERSION,
    schemaVersion: ERP07_SHEIN_ENDPOINT_SCHEMA_VERSION,
    validationStatus: schema.validationStatus || "executable",
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
  if (schema.validationStatus === "blocked") {
    throw new Erp07EndpointSchemaError(
      "ERP07_ENDPOINT_SCHEMA_BLOCKED",
      `endpoint ${id} 当前不可执行: ${schema.blockReason}`,
      id,
    );
  }
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
    responseEvidence: schema.source.responseEvidence,
    authorizedStoreRead: schema.source.authorizedStoreRead,
  });
}

export function assertErp07EndpointEvidenceCatalog() {
  for (const [id, schema] of Object.entries(SCHEMAS)) {
    const evidence = schema.source?.responseEvidence;
    if (!evidence) {
      throw new Erp07EndpointSchemaError(
        "ERP07_ENDPOINT_RESPONSE_EVIDENCE_MISSING",
        `endpoint ${id} 缺少 response evidence 清单`,
      );
    }
    if (!RESPONSE_EVIDENCE_STATUSES.includes(evidence.status)) {
      throw new Erp07EndpointSchemaError(
        "ERP07_ENDPOINT_RESPONSE_EVIDENCE_STATUS_INVALID",
        `endpoint ${id} 的 response evidence 状态不可识别: ${evidence.status}`,
      );
    }
    if (!Array.isArray(evidence.fields) || evidence.fields.length === 0 ||
        evidence.fields.some((fieldName) => typeof fieldName !== "string" || !fieldName.trim())) {
      throw new Erp07EndpointSchemaError(
        "ERP07_ENDPOINT_RESPONSE_EVIDENCE_FIELDS_INVALID",
        `endpoint ${id} 的 response evidence 字段清单无效`,
      );
    }
    if (!Array.isArray(evidence.sourceFiles) ||
        evidence.sourceFiles.some((sourceFile) => typeof sourceFile !== "string" || !sourceFile.trim())) {
      throw new Erp07EndpointSchemaError(
        "ERP07_ENDPOINT_RESPONSE_EVIDENCE_SOURCES_INVALID",
        `endpoint ${id} 的 response evidence 来源清单无效`,
      );
    }
    if (evidence.authorizedStoreRead !== schema.source.authorizedStoreRead) {
      throw new Erp07EndpointSchemaError(
        "ERP07_ENDPOINT_RESPONSE_EVIDENCE_STORE_STATUS_MISMATCH",
        `endpoint ${id} 的 response evidence 店铺读取状态与 source 不一致`,
      );
    }
    if (["not_captured", "internal_consumer_contract"].includes(evidence.status) &&
        !evidence.gaps.includes("official_response_fields_not_captured")) {
      throw new Erp07EndpointSchemaError(
        "ERP07_ENDPOINT_RESPONSE_EVIDENCE_GAP_MISSING",
        `endpoint ${id} 未捕获官方响应字段时必须声明证据缺口`,
      );
    }
  }
  return true;
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
