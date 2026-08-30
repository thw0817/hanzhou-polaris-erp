import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import test from "node:test";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ERP07_SHEIN_ENDPOINT_SCHEMA_VERSION,
  Erp07EndpointSchemaError,
  assertErp07EndpointEvidenceCatalog,
  assertErp07ResponseEvidenceStatusConsistency,
  assertErp07FixtureCatalog,
  getErp07EndpointFixture,
  getErp07EndpointSchema,
  listErp07EndpointSchemas,
  validateErp07EndpointQuery,
  validateErp07EndpointPayload,
} from "./erp07-shein-endpoint-schema.js";
import {
  classifyErp07Response,
  listErp07EndpointContracts,
} from "./erp07-shein-endpoint-contract.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function parseSourceReference(reference) {
  const match = /^(.*):(\d+)(?:-(\d+))?$/.exec(reference);
  if (!match) return { filePath: reference, startLine: null, endLine: null };
  return {
    filePath: match[1],
    startLine: Number(match[2]),
    endLine: Number(match[3] || match[2]),
  };
}

function assertSourceReference(reference, endpoint) {
  const parsed = parseSourceReference(reference);
  const absolutePath = resolve(REPO_ROOT, parsed.filePath);
  const relativePath = relative(REPO_ROOT, absolutePath);
  assert.ok(
    relativePath && !relativePath.startsWith("..") && !relativePath.startsWith("/"),
    `${endpoint}: source reference must stay inside repository: ${reference}`,
  );
  assert.equal(
    existsSync(absolutePath) && statSync(absolutePath).isFile(),
    true,
    `${endpoint}: source file does not exist: ${reference}`,
  );
  if (parsed.startLine === null) return;
  const lineCount = readFileSync(absolutePath, "utf8").split(/\r?\n/).length;
  assert.ok(parsed.startLine >= 1, `${endpoint}: source line must be positive: ${reference}`);
  assert.ok(parsed.endLine >= parsed.startLine, `${endpoint}: source line range is inverted: ${reference}`);
  assert.ok(parsed.endLine <= lineCount, `${endpoint}: source line is out of bounds: ${reference}`);
}

test("key ERP-07 endpoints expose versioned source, schema and evidence state", () => {
  const schemas = listErp07EndpointSchemas();
  assert.equal(schemas.length, 33);
  for (const schema of schemas) {
    assert.equal(schema.schemaVersion, ERP07_SHEIN_ENDPOINT_SCHEMA_VERSION);
    assert.ok(["read", "non_business_write", "business_write", "credential_write"].includes(schema.mode));
    assert.ok(schema.source.files.length > 0);
    assert.ok(Array.isArray(schema.source.officialSourceUrls));
    assert.equal(schema.source.authorizedStoreRead, "not_observed");
    assert.ok(schema.request);
    assert.ok(schema.response);
    assert.ok(schema.fixtures);
  }
  for (const endpoint of [
    "rules.category_tree",
    "rules.attribute_template",
    "rules.publish_fill_in_standard",
  ]) {
    assert.ok(getErp07EndpointSchema(endpoint).headers.includes("language"));
  }
  assert.equal(getErp07EndpointSchema("POST /open-api/goods/searchProduct").id, "product.search");
});

test("official response sources stay on the SHEIN Open API host", () => {
  for (const schema of listErp07EndpointSchemas()) {
    for (const sourceUrl of schema.source.officialSourceUrls) {
      const parsed = new URL(sourceUrl);
      assert.equal(parsed.protocol, "https:", schema.id);
      assert.equal(parsed.hostname, "open.sheincorp.com", schema.id);
    }
  }
});

test("publish quota is pinned to the verified official SHEIN endpoint contract", () => {
  const schema = getErp07EndpointSchema("preflight.publish_quota");

  assert.equal(schema.path, "/open-api/goods/query-shelf-quota");
  assert.deepEqual(schema.source.officialSourceUrls, [
    "https://open.sheincorp.com/documents/apidoc/detail/3001544-1000001",
  ]);
  assert.deepEqual(schema.source.responseEvidence.fields, [
    "code",
    "msg",
    "traceId",
    "info.need",
    "info.total_quota_count",
    "info.on_shelf_count",
    "info.remain_count",
  ]);
  assert.equal(schema.source.responseEvidence.status, "official_response_contract");
});

test("every ERP-07 contract has explicit schema coverage with matching route and mode", () => {
  const contracts = listErp07EndpointContracts();
  const schemas = listErp07EndpointSchemas();
  assert.equal(contracts.length, 33);
  assert.deepEqual(
    schemas.map((schema) => schema.id).sort(),
    contracts.map((contract) => contract.id).sort(),
  );
  for (const contract of contracts) {
    const schema = getErp07EndpointSchema(contract.id);
    assert.equal(schema.method, contract.method);
    assert.equal(schema.path, contract.path);
    assert.equal(schema.mode, contract.mode);
    assert.ok(["executable", "blocked"].includes(schema.validationStatus));
    if (schema.validationStatus === "blocked") {
      assert.match(schema.blockReason, /复核|冻结|未具备|COS-first|待|原文|凭证/);
    }
  }
});

test("fixture catalog is complete for read and write failure classes", () => {
  assert.equal(assertErp07FixtureCatalog(), true);
});

test("response evidence catalog is complete and internally consistent", () => {
  assert.equal(assertErp07EndpointEvidenceCatalog(), true);
});

test("endpoint source and response-evidence references remain readable and in bounds", () => {
  let sourceReferenceCount = 0;
  let lineReferenceCount = 0;
  for (const schema of listErp07EndpointSchemas()) {
    const references = [
      ...(schema.source?.files || []),
      ...(schema.source?.responseEvidence?.sourceFiles || []),
    ];
    for (const reference of references) {
      assert.equal(typeof reference, "string", `${schema.id}: source reference must be a string`);
      assertSourceReference(reference, schema.id);
      sourceReferenceCount += 1;
      if (/:(\d+)(?:-\d+)?$/.test(reference)) lineReferenceCount += 1;
    }
  }
  assert.ok(sourceReferenceCount > 0);
  assert.ok(lineReferenceCount > 0);
});

test("response evidence rejects endpoint/field provenance status mixing", () => {
  assert.throws(
    () => assertErp07ResponseEvidenceStatusConsistency({
      endpoint: "fixture.endpoint",
      evidence: {
        status: "internal_consumer_contract",
        fieldEvidence: [{
          field: "info.value",
          status: "official_response_field",
          observed: false,
          sourceFiles: ["fixture.test.js"],
        }],
      },
    }),
    (error) => error instanceof Erp07EndpointSchemaError &&
      error.code === "ERP07_ENDPOINT_RESPONSE_FIELD_EVIDENCE_STATUS_MISMATCH",
  );
  assert.equal(assertErp07ResponseEvidenceStatusConsistency({
    endpoint: "fixture.endpoint",
    evidence: {
      status: "official_response_contract",
      fieldEvidence: [{
        field: "info.value",
        status: "official_response_field",
        observed: false,
        sourceFiles: ["official-source.txt:1"],
      }],
    },
  }), true);
});

test("every executable endpoint has a response fixture that passes its own schema", () => {
  const executable = listErp07EndpointSchemas().filter(
    (schema) => schema.validationStatus === "executable",
  );
  assert.equal(executable.length, 23);
  for (const schema of executable) {
    assert.equal(
      validateErp07EndpointPayload({ endpoint: schema.id, fixtureKind: "success" }).valid,
      true,
      schema.id,
    );
  }
});

test("strict request schema rejects missing required, unknown and invalid enum values", () => {
  assert.throws(
    () => validateErp07EndpointPayload({
      endpoint: "product.search",
      direction: "request",
      payload: { pageNum: 1 },
    }),
    (error) => error instanceof Erp07EndpointSchemaError &&
      error.code === "ERP07_ENDPOINT_SCHEMA_INVALID",
  );
  assert.throws(
    () => validateErp07EndpointPayload({
      endpoint: "product.search",
      direction: "request",
      payload: { pageNum: 1, pageSize: 10, unsupported: true },
    }),
    /未识别字段/,
  );
  assert.throws(
    () => validateErp07EndpointPayload({
      endpoint: "media.product_upload",
      direction: "request",
      payload: { image_type: 9, file: new Blob(["fixture"]) },
    }),
    /未识别的枚举值/,
  );
});

test("officially documented request fields validate without exposing credentials", () => {
  const search = validateErp07EndpointPayload({
    endpoint: "product.search",
    direction: "request",
    payload: { pageNum: 1, pageSize: 10, languageList: ["en"] },
  });
  assert.equal(search.valid, true);
  const upload = validateErp07EndpointPayload({
    endpoint: "compliance.photo_upload",
    direction: "request",
    payload: { file: new Blob(["fixture"]) },
  });
  assert.equal(upload.valid, true);
  assert.doesNotMatch(JSON.stringify(upload), /secret|token|password/i);
});

test("official preflight query and supplier SKU limits match the current request contract", () => {
  assert.equal(validateErp07EndpointQuery({
    endpoint: "preflight.publish_permission",
    query: { brandCode: "2tgt1" },
  }).valid, true);
  assert.throws(
    () => validateErp07EndpointQuery({
      endpoint: "preflight.publish_permission",
      query: { unsupported: "value" },
    }),
    /未识别字段/,
  );
  assert.equal(validateErp07EndpointPayload({
    endpoint: "preflight.supplier_sku_duplicate",
    direction: "request",
    payload: { supplierSkuList: Array.from({ length: 200 }, (_, index) => `SKU-${index}`) },
  }).valid, true);
  assert.throws(
    () => validateErp07EndpointPayload({
      endpoint: "preflight.supplier_sku_duplicate",
      direction: "request",
      payload: { supplierSkuList: Array.from({ length: 201 }, (_, index) => `SKU-${index}`) },
    }),
    /最多允许 200 项/,
  );
});

test("source-pending endpoints expose honest response evidence and reject malformed consumer fields", () => {
  const expected = {
    "sales.sku": [
      "info.dataList[].skuCode",
      "info.dataList[].realTimeSaleCnt",
      "info.dataList[].cydSaleCnt",
      "info.dataList[].c7dSaleCnt",
      "info.dataList[].c30dSaleCnt",
      "info.dataList[].dt",
    ],
    "review.document_state": [
      "info.data[].spuName",
      "info.data[].version",
      "info.data[].skcList[].skcName",
      "info.data[].skcList[].documentSn",
      "info.data[].skcList[].documentState",
      "info.data[].skcList[].failedReason",
      "info.meta.count",
    ],
  };
  for (const [endpoint, fields] of Object.entries(expected)) {
    const evidence = getErp07EndpointSchema(endpoint).source.responseEvidence;
    assert.equal(evidence.status, "internal_consumer_contract", endpoint);
    assert.deepEqual(evidence.fields, fields, endpoint);
    assert.ok(evidence.gaps.includes("official_response_fields_not_captured"), endpoint);
    assert.equal(evidence.authorizedStoreRead, "not_observed", endpoint);
  }

  assert.equal(validateErp07EndpointPayload({
    endpoint: "sales.sku",
    payload: {
      code: "0",
      info: {
        dataList: [{
          skuCode: "SKU-FIXTURE",
          realTimeSaleCnt: 1,
          cydSaleCnt: 2,
          c7dSaleCnt: 7,
          c30dSaleCnt: 30,
          dt: "20260830",
        }],
      },
    },
  }).valid, true);
  assert.throws(
    () => validateErp07EndpointPayload({
      endpoint: "sales.sku",
      payload: { code: "0", info: { dataList: [{ c7dSaleCnt: {} }] } },
    }),
    /类型不符合 schema/,
  );
  assert.throws(
    () => validateErp07EndpointPayload({
      endpoint: "preflight.publish_permission",
      payload: { code: "0", info: { canPublishProduct: "true" } },
    }),
    /类型不符合 schema/,
  );
  assert.throws(
    () => validateErp07EndpointPayload({
      endpoint: "preflight.publish_quota",
      payload: { code: "0", info: { need: true, remain_count: {} } },
    }),
    /类型不符合 schema/,
  );
  assert.equal(validateErp07EndpointPayload({
    endpoint: "preflight.publish_quota",
    payload: {
      code: "0",
      msg: "OK",
      traceId: "quota-fixture",
      info: {
        need: true,
        total_quota_count: 2000,
        on_shelf_count: 37,
        remain_count: 1963,
      },
    },
  }).valid, true);
  assert.throws(
    () => validateErp07EndpointPayload({
      endpoint: "preflight.publish_quota",
      payload: { code: "0", info: { availableLimit: 3 } },
    }),
    /缺少必填字段/,
  );
  assert.throws(
    () => validateErp07EndpointPayload({
      endpoint: "preflight.supplier_sku_duplicate",
      payload: { code: "0", info: [{ supplierSku: "SKU-FIXTURE", repeated: "false" }] },
    }),
    /类型不符合 schema/,
  );
  assert.throws(
    () => validateErp07EndpointPayload({
      endpoint: "review.document_state",
      payload: { code: "0", info: [{ spu_name: "SPU-FIXTURE", audit_state: {} }] },
    }),
    /类型不符合 schema/,
  );
  assert.throws(
    () => validateErp07EndpointPayload({
      endpoint: "pricing.proof_upload",
      payload: { code: "0", info: { objectKey: 42 } },
    }),
    /类型不符合 schema/,
  );
});

test("official response evidence keeps source URLs, fields and live-read status separate", () => {
  const expected = {
    "preflight.publish_permission": {
      fields: [
        "code",
        "msg",
        "traceId",
        "info.canPublishProduct",
        "info.reason",
      ],
      sourceUrl: "https://open.sheincorp.com/zh/documents/apidoc/detail/3001589-1000001",
    },
    "preflight.supplier_sku_duplicate": {
      fields: [
        "code",
        "msg",
        "traceId",
        "info[].supplierSku",
        "info[].repeated",
      ],
      sourceUrl: "https://open.sheincorp.com/zh/documents/apidoc/detail/3001437",
    },
    "pricing.proof_upload": {
      fields: [
        "code",
        "msg",
        "traceId",
        "info.objectKey",
        "info.url",
        "bbl",
      ],
      sourceUrl: "https://open.sheincorp.com/zh/documents/apidoc/detail/3001728",
    },
  };
  for (const [endpoint, contract] of Object.entries(expected)) {
    const schema = getErp07EndpointSchema(endpoint);
    const evidence = schema.source.responseEvidence;
    assert.equal(evidence.status, "official_response_contract", endpoint);
    assert.deepEqual(evidence.fields, contract.fields, endpoint);
    assert.deepEqual(schema.source.officialSourceUrls, [contract.sourceUrl], endpoint);
    assert.deepEqual(evidence.gaps, [], endpoint);
    assert.equal(evidence.authorizedStoreRead, "not_observed", endpoint);
    assert.ok(evidence.fieldEvidence.every((entry) =>
      entry.status === "official_response_field" && entry.observed === false,
    ), endpoint);
  }
});

test("source-pending response fields carry field-level provenance and cannot claim live evidence", () => {
  const expected = {
    "sales.sku": {
      fields: [
        "info.dataList[].skuCode",
        "info.dataList[].realTimeSaleCnt",
        "info.dataList[].cydSaleCnt",
        "info.dataList[].c7dSaleCnt",
        "info.dataList[].c30dSaleCnt",
        "info.dataList[].dt",
      ],
      sourceFiles: ["server/store-data-sync.js", "server/store-data-sync.test.js"],
    },
    "preflight.publish_permission": {
      fields: [
        "code",
        "msg",
        "traceId",
        "info.canPublishProduct",
        "info.reason",
      ],
      sourceFiles: ["docs/ERP07_OFFICIAL_RESPONSE_SOURCE_AUDIT_2026-08-30.md"],
      status: "official_response_field",
    },
    "preflight.publish_quota": {
      fields: [
        "code",
        "msg",
        "traceId",
        "info.need",
        "info.total_quota_count",
        "info.on_shelf_count",
        "info.remain_count",
      ],
      sourceFiles: ["docs/ERP07_OFFICIAL_RESPONSE_SOURCE_AUDIT_2026-08-30.md"],
      status: "official_response_field",
    },
    "preflight.supplier_sku_duplicate": {
      fields: [
        "code",
        "msg",
        "traceId",
        "info[].supplierSku",
        "info[].repeated",
      ],
      sourceFiles: ["docs/ERP07_OFFICIAL_RESPONSE_SOURCE_AUDIT_2026-08-30.md"],
      status: "official_response_field",
    },
    "review.document_state": {
      fields: [
        "info.data[].spuName",
        "info.data[].version",
        "info.data[].skcList[].skcName",
        "info.data[].skcList[].documentSn",
        "info.data[].skcList[].documentState",
        "info.data[].skcList[].failedReason",
        "info.meta.count",
      ],
      sourceFiles: [
        "server/cloud/document-state-projections.js",
        "server/cloud/erp06-shein-publish-adapter-contract.js",
      ],
    },
    "pricing.proof_upload": {
      fields: [
        "code",
        "msg",
        "traceId",
        "info.objectKey",
        "info.url",
        "bbl",
      ],
      sourceFiles: ["docs/ERP07_OFFICIAL_RESPONSE_SOURCE_AUDIT_2026-08-30.md"],
      status: "official_response_field",
    },
  };

  for (const [endpoint, contract] of Object.entries(expected)) {
    const evidence = getErp07EndpointSchema(endpoint).source.responseEvidence;
    assert.deepEqual(
      evidence.fieldEvidence.map((entry) => entry.field),
      contract.fields,
      endpoint,
    );
    for (const entry of evidence.fieldEvidence) {
      assert.equal(
        entry.status,
        contract.status || "internal_consumer_contract",
        endpoint,
      );
      assert.deepEqual(entry.sourceFiles, contract.sourceFiles, endpoint);
      assert.equal(entry.observed, false, endpoint);
    }
    assert.equal(evidence.authorizedStoreRead, "not_observed", endpoint);
  }
});

test("official read schemas enforce the documented cardinality and paging limits", () => {
  assert.equal(validateErp07EndpointPayload({
    endpoint: "inventory.stock_query",
    direction: "request",
    payload: {
      skuCodeList: ["SKU-FIXTURE"],
      warehouseType: "2",
      invType: "VI",
    },
  }).valid, true);
  assert.throws(
    () => validateErp07EndpointPayload({
      endpoint: "inventory.stock_query",
      direction: "request",
      payload: {
        skuCodeList: ["SKU-FIXTURE"],
        skcNameList: ["SKC-FIXTURE"],
        warehouseType: "2",
      },
    }),
    /必须且只能提供一个字段/,
  );
  assert.equal(validateErp07EndpointPayload({
    endpoint: "rules.category_tree",
    direction: "request",
    payload: {},
  }).valid, true);
  assert.equal(validateErp07EndpointPayload({
    endpoint: "rules.attribute_template",
    direction: "request",
    payload: { product_type_id_list: [1, 2, 3] },
  }).valid, true);
  assert.throws(
    () => validateErp07EndpointPayload({
      endpoint: "rules.attribute_template",
      direction: "request",
      payload: { product_type_id_list: Array.from({ length: 11 }, (_, index) => index + 1) },
    }),
    /最多允许 10 项/,
  );
  assert.equal(validateErp07EndpointPayload({
    endpoint: "compliance.photo_requirements",
    direction: "request",
    payload: { pageSize: 100, pageNum: 1, skcList: ["SKC-FIXTURE"] },
  }).valid, true);
  assert.throws(
    () => validateErp07EndpointPayload({
      endpoint: "compliance.photo_requirements",
      direction: "request",
      payload: { pageSize: 101, pageNum: 1, skcList: ["SKC-FIXTURE"] },
    }),
    /不得大于 100/,
  );
  assert.equal(validateErp07EndpointPayload({
    endpoint: "compliance.certificate_search",
    direction: "request",
    payload: { pageNum: 1, pageSize: 100, statusList: [2] },
  }).valid, true);
  assert.throws(
    () => validateErp07EndpointPayload({
      endpoint: "compliance.certificate_search",
      direction: "request",
      payload: { pageNum: 1, pageSize: 101 },
    }),
    /不得大于 100/,
  );
  assert.equal(validateErp07EndpointPayload({
    endpoint: "compliance.agency_list",
    direction: "request",
    payload: { pageNum: 1, pageSize: 100 },
  }).valid, true);
  assert.equal(validateErp07EndpointPayload({
    endpoint: "compliance.warning_rules",
    direction: "request",
    payload: {},
  }).valid, true);
});

test("frozen, archived or source-pending endpoints fail closed before payload validation", () => {
  for (const endpoint of [
    "product.transform_image",
    "rules.custom_attribute_permission",
    "pricing.discussion_list",
    "pricing.discussion_process",
    "compliance.certificate_upload",
    "compliance.certificate_save",
    "compliance.certificate_bind",
    "compliance.agency_bind",
    "compliance.warning_update",
    "auth.token_exchange",
  ]) {
    assert.throws(
      () => validateErp07EndpointPayload({
        endpoint,
        direction: "request",
        payload: {},
      }),
      (error) => error instanceof Erp07EndpointSchemaError &&
        error.code === "ERP07_ENDPOINT_SCHEMA_BLOCKED",
    );
  }
});

test("success, empty and partial read fixtures stay distinguishable", () => {
  for (const kind of ["success", "empty", "partial"]) {
    const result = validateErp07EndpointPayload({
      endpoint: "product.search",
      fixtureKind: kind,
    });
    assert.equal(result.valid, true);
  }
  assert.equal(
    getErp07EndpointFixture("product.search", "empty").semantic,
    "empty_not_found_or_no_data_must_not_become_zero",
  );
  assert.equal(
    getErp07EndpointFixture("product.search", "partial").semantic,
    "partial_must_remain_partial_and_not_overwrite_last_known_good",
  );
});

test("write fixtures never turn missing receipt, rate limit or timeout into accepted", () => {
  for (const endpoint of ["media.product_upload", "product.publish_or_edit", "compliance.photo_upload", "pricing.proof_upload"]) {
    const schema = getErp07EndpointSchema(endpoint);
    const success = getErp07EndpointFixture(endpoint, "success");
    validateErp07EndpointPayload({ endpoint, fixtureKind: "success" });
    const classified = classifyErp07Response({
      endpoint,
      response: success.response,
      acceptedEvidence: success.acceptedEvidence,
    });
    assert.equal(classified.outcome, "accepted");
    assert.equal(schema.source.authorizedStoreRead, "not_observed");

    for (const kind of ["rate_limited", "timeout"]) {
      const fixture = getErp07EndpointFixture(endpoint, kind);
      const result = classifyErp07Response({
        endpoint,
        response: fixture.response,
        error: fixture.error,
        sendBoundary: "after_send",
      });
      assert.equal(result.outcome, "result_unknown");
      assert.equal(result.retryClass, "readback_only");
    }
  }
  assert.equal(
    classifyErp07Response({
      endpoint: "media.product_upload",
      response: getErp07EndpointFixture("media.product_upload", "missing_receipt").response,
    }).outcome,
    "result_unknown",
  );
});

test("unknown endpoint schema fails closed instead of guessing", () => {
  assert.throws(
    () => getErp07EndpointSchema("POST /open-api/not-allowlisted"),
    (error) => error instanceof Erp07EndpointSchemaError &&
      error.code === "ERP07_ENDPOINT_SCHEMA_MISSING",
  );
});

test("fixture direction cannot silently validate a response as a request", () => {
  assert.throws(
    () => validateErp07EndpointPayload({
      endpoint: "product.search",
      direction: "request",
      fixtureKind: "success",
    }),
    (error) => error.code === "ERP07_ENDPOINT_FIXTURE_DIRECTION_UNSUPPORTED",
  );
});
