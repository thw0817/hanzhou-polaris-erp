import test from "node:test";
import assert from "node:assert/strict";
import {
  ERP07_SHEIN_ENDPOINT_CONTRACT_VERSION,
  buildErp07EndpointRequest,
  classifyErp07Response,
  getErp07EndpointContract,
  listErp07EndpointContracts,
  Erp07EndpointContractError,
} from "./erp07-shein-endpoint-contract.js";

const scope = {
  tenantId: "tenant-1",
  storeId: "store-1",
  supplierId: "supplier-1",
};

test("catalogue exposes exact method/path and separate endpoint modes", () => {
  const read = getErp07EndpointContract("product.search");
  assert.equal(read.method, "POST");
  assert.equal(read.path, "/open-api/goods/searchProduct");
  assert.equal(read.mode, "read");

  const writes = listErp07EndpointContracts({ mode: "business_write" });
  assert.deepEqual(
    writes.map((item) => item.id),
    [
      "product.publish_or_edit",
      "compliance.photo_bind",
      "compliance.certificate_save",
      "compliance.certificate_bind",
      "compliance.agency_bind",
      "compliance.warning_update",
      "pricing.discussion_process",
    ],
  );
  assert.equal(
    getErp07EndpointContract("preflight.publish_permission").method,
    "GET",
  );
  assert.equal(
    getErp07EndpointContract("media.product_upload").mode,
    "non_business_write",
  );
});

test("request builder only permits allowlisted paths and carries scope/trace", () => {
  const request = buildErp07EndpointRequest({
    endpoint: "product.search",
    scope,
    traceId: "trace-1",
    body: { page: 1, pageSize: 10 },
  });
  assert.deepEqual(request, {
    contractVersion: ERP07_SHEIN_ENDPOINT_CONTRACT_VERSION,
    endpoint: "product.search",
    method: "POST",
    path: "/open-api/goods/searchProduct",
    mode: "read",
    scope,
    traceId: "trace-1",
    body: { page: 1, pageSize: 10 },
  });

  assert.throws(
    () => buildErp07EndpointRequest({
      endpoint: "POST /open-api/not-allowlisted",
      scope,
      traceId: "trace-2",
    }),
    (error) => error instanceof Erp07EndpointContractError &&
      error.code === "ERP07_ENDPOINT_NOT_ALLOWLISTED",
  );
});

test("all writes fail closed until an explicit one-time upper-layer grant", () => {
  assert.throws(
    () => buildErp07EndpointRequest({
      endpoint: "product.publish_or_edit",
      scope,
      traceId: "trace-write-1",
      body: { category_id: "3155" },
    }),
    (error) => error.code === "ERP07_ENDPOINT_WRITE_DISABLED",
  );

  const request = buildErp07EndpointRequest({
    endpoint: "product.publish_or_edit",
    scope,
    traceId: "trace-write-2",
    allowWrite: true,
    body: { category_id: "3155" },
  });
  assert.equal(request.mode, "business_write");
  assert.equal(request.path, "/open-api/goods/product/publishOrEdit");

  assert.throws(
    () => buildErp07EndpointRequest({
      endpoint: "product.transform_image",
      scope,
      traceId: "trace-write-frozen",
      allowWrite: true,
      body: { imageUrl: "https://example.com/image.jpg" },
    }),
    (error) => error.code === "ERP07_ENDPOINT_WRITE_DISABLED",
  );
});

test("revalidation-gated reads and credential exchange never build remote requests", () => {
  for (const endpoint of ["inventory.stock_query", "pricing.discussion_list"]) {
    assert.throws(
      () => buildErp07EndpointRequest({
        endpoint,
        scope,
        traceId: `trace-blocked-${endpoint}`,
        body: {},
      }),
      (error) => error instanceof Erp07EndpointContractError &&
        error.code === "ERP07_ENDPOINT_STATUS_BLOCKED",
    );
  }

  assert.throws(
    () => buildErp07EndpointRequest({
      endpoint: "auth.token_exchange",
      scope,
      traceId: "trace-credential-exchange",
      allowWrite: true,
      body: {},
    }),
    (error) => error instanceof Erp07EndpointContractError &&
      error.code === "ERP07_ENDPOINT_CREDENTIAL_EXCHANGE_DISABLED",
  );
});

test("credentials never enter an endpoint body", () => {
  assert.throws(
    () => buildErp07EndpointRequest({
      endpoint: "product.search",
      scope,
      traceId: "trace-sensitive",
      body: { openKeyId: "not-a-real-key" },
    }),
    (error) => error.code === "ERP07_ENDPOINT_SENSITIVE_BODY",
  );
});

test("scope and trace identifiers reject overflow instead of being truncated", () => {
  assert.throws(
    () => buildErp07EndpointRequest({
      endpoint: "product.search",
      scope: { ...scope, tenantId: "t".repeat(301) },
      traceId: "trace-overflow",
    }),
    (error) => error.code === "ERP07_ENDPOINT_SCOPE_INVALID",
  );
  assert.throws(
    () => buildErp07EndpointRequest({
      endpoint: "product.search",
      scope,
      traceId: "t".repeat(201),
    }),
    (error) => error.code === "ERP07_ENDPOINT_SCOPE_INVALID",
  );
});

test("read transient failures are retryable before send", () => {
  assert.deepEqual(
    classifyErp07Response({
      endpoint: "sales.sku",
      response: { status: 429, payload: { code: "832213", msg: "限流", traceId: "t-429" } },
      error: { status: 429, code: "832213", traceId: "t-429" },
    }),
    {
      contractVersion: ERP07_SHEIN_ENDPOINT_CONTRACT_VERSION,
      endpoint: "sales.sku",
      outcome: "known_failed",
      status: 429,
      code: "832213",
      traceId: "t-429",
      retryClass: "safe_before_send_retry",
      effective: false,
      message: "限流",
    },
  );
});

test("business write timeout after send becomes result_unknown and readback-only", () => {
  const result = classifyErp07Response({
    endpoint: "product.publish_or_edit",
    error: { status: 504, message: "timeout", traceId: "t-timeout" },
    sendBoundary: "after_send",
  });
  assert.equal(result.outcome, "result_unknown");
  assert.equal(result.retryClass, "readback_only");
  assert.equal(result.effective, false);
  assert.equal(result.traceId, "t-timeout");
});

test("business write success code alone never becomes accepted", () => {
  const result = classifyErp07Response({
    endpoint: "product.publish_or_edit",
    response: {
      status: 200,
      payload: { code: "0", traceId: "t-no-receipt" },
    },
  });
  assert.equal(result.outcome, "result_unknown");
  assert.equal(result.retryClass, "readback_only");

  const accepted = classifyErp07Response({
    endpoint: "product.publish_or_edit",
    response: {
      status: 200,
      payload: { code: "0", traceId: "t-accepted" },
    },
    acceptedEvidence: true,
  });
  assert.equal(accepted.outcome, "accepted");
});

test("a write success without trace evidence remains result_unknown", () => {
  const result = classifyErp07Response({
    endpoint: "pricing.proof_upload",
    response: {
      status: 200,
      payload: { code: "0", info: { objectKey: "proof/object-key" } },
    },
  });
  assert.equal(result.outcome, "result_unknown");
  assert.equal(result.retryClass, "readback_only");
});

test("file upload requires the endpoint-specific immutable receipt fields", () => {
  const incomplete = classifyErp07Response({
    endpoint: "compliance.photo_upload",
    response: { status: 200, payload: { code: "0", info: {} } },
  });
  assert.equal(incomplete.outcome, "result_unknown");
  assert.equal(incomplete.retryClass, "readback_only");

  const complete = classifyErp07Response({
    endpoint: "compliance.photo_upload",
    response: {
      status: 200,
      payload: {
        code: "0",
        traceId: "t-photo",
        info: {
          imageUrl: "https://image.example/photo.jpg",
          imageMd5: "md5",
        },
      },
    },
  });
  assert.equal(complete.outcome, "accepted");
});

test("send-after-boundary uncertainty applies to every writable endpoint", () => {
  const result = classifyErp07Response({
    endpoint: "media.product_upload",
    error: { status: 504, message: "timeout", traceId: "t-upload-timeout" },
    sendBoundary: "after_send",
  });
  assert.equal(result.outcome, "result_unknown");
  assert.equal(result.retryClass, "readback_only");
});

test("permission failure requires reauthorization and is never auto-retried", () => {
  const result = classifyErp07Response({
    endpoint: "product.publish_or_edit",
    response: {
      status: 403,
      payload: {
        code: "openapi00001",
        msg: "无权限",
        traceId: "t-auth",
      },
    },
    error: { status: 403, code: "openapi00001", traceId: "t-auth" },
    sendBoundary: "before_send",
  });
  assert.equal(result.outcome, "known_failed");
  assert.equal(result.retryClass, "manual_new_attempt");
  assert.equal(result.requiresReauthorization, true);
  assert.equal(result.traceId, "t-auth");
});

test("HTTP 200 without business code zero is not accepted", () => {
  const result = classifyErp07Response({
    endpoint: "product.publish_or_edit",
    response: {
      status: 200,
      payload: { code: "BUSINESS_REJECTED", msg: "字段错误", traceId: "t-reject" },
    },
    error: { status: 200, code: "BUSINESS_REJECTED", traceId: "t-reject" },
    sendBoundary: "before_send",
  });
  assert.equal(result.outcome, "known_failed");
  assert.equal(result.retryClass, "terminal");
  assert.notEqual(result.outcome, "accepted");
});

test("successful transport result reads status/code/trace from requestShein diagnostics", () => {
  assert.deepEqual(
    classifyErp07Response({
      endpoint: "product.search",
      response: {
        payload: { code: "0", traceId: "payload-trace" },
        diagnostics: { status: 200, code: "0", traceId: "diagnostic-trace" },
      },
    }),
    {
      contractVersion: ERP07_SHEIN_ENDPOINT_CONTRACT_VERSION,
      endpoint: "product.search",
      outcome: "read_success",
      status: 200,
      code: "0",
      traceId: "payload-trace",
      retryClass: "none",
      effective: false,
    },
  );
});
