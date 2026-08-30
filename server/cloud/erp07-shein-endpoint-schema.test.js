import assert from "node:assert/strict";
import test from "node:test";
import {
  ERP07_SHEIN_ENDPOINT_SCHEMA_VERSION,
  Erp07EndpointSchemaError,
  assertErp07FixtureCatalog,
  getErp07EndpointFixture,
  getErp07EndpointSchema,
  listErp07EndpointSchemas,
  validateErp07EndpointPayload,
} from "./erp07-shein-endpoint-schema.js";
import {
  classifyErp07Response,
  listErp07EndpointContracts,
} from "./erp07-shein-endpoint-contract.js";

test("key ERP-07 endpoints expose versioned source, schema and evidence state", () => {
  const schemas = listErp07EndpointSchemas();
  assert.equal(schemas.length, 33);
  for (const schema of schemas) {
    assert.equal(schema.schemaVersion, ERP07_SHEIN_ENDPOINT_SCHEMA_VERSION);
    assert.ok(["read", "non_business_write", "business_write", "credential_write"].includes(schema.mode));
    assert.ok(schema.source.files.length > 0);
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
