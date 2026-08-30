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
} from "./erp07-shein-endpoint-contract.js";

test("key ERP-07 endpoints expose versioned source, schema and evidence state", () => {
  const schemas = listErp07EndpointSchemas();
  assert.equal(schemas.length, 12);
  for (const schema of schemas) {
    assert.equal(schema.schemaVersion, ERP07_SHEIN_ENDPOINT_SCHEMA_VERSION);
    assert.ok(["read", "non_business_write", "business_write"].includes(schema.mode));
    assert.ok(schema.source.files.length > 0);
    assert.equal(schema.source.authorizedStoreRead, "not_observed");
    assert.ok(schema.request);
    assert.ok(schema.response);
    assert.ok(schema.fixtures);
  }
  assert.equal(getErp07EndpointSchema("POST /open-api/goods/searchProduct").id, "product.search");
});

test("fixture catalog is complete for read and write failure classes", () => {
  assert.equal(assertErp07FixtureCatalog(), true);
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
    () => getErp07EndpointSchema("inventory.stock_query"),
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
