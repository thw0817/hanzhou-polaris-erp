import assert from "node:assert/strict";
import test from "node:test";
import {
  ERP07_RESPONSE_EVIDENCE_CAPTURE_VERSION,
  Erp07ResponseEvidenceError,
  buildErp07ResponseEvidenceSnapshot,
} from "./erp07-response-evidence.js";
import { getErp07EndpointSchema } from "./erp07-shein-endpoint-schema.js";

const scope = {
  tenantId: "tenant-1",
  storeId: "store-1",
  supplierId: "supplier-1",
};

function response(payload, status = 200) {
  return {
    payload,
    diagnostics: {
      status,
      code: payload.code,
      traceId: payload.traceId,
      durationMs: 18,
    },
  };
}

test("ERP-07 response evidence snapshot keeps only field presence and digest", () => {
  const snapshot = buildErp07ResponseEvidenceSnapshot({
    endpoint: "sales.sku",
    scope,
    sourceRef: "authorized-store-read:erp07-sales-20260830-001",
    observedAt: "2026-08-30T02:00:00.000Z",
    response: response({
      code: "0",
      msg: "OK",
      traceId: "trace-sales-1",
      info: {
        dataList: [{
          skuCode: "SKU-1",
          realTimeSaleCnt: 3,
          cydSaleCnt: 4,
          c7dSaleCnt: 7,
          c30dSaleCnt: 30,
          dt: "20260830",
        }],
      },
    }),
  });

  assert.equal(snapshot.captureVersion, ERP07_RESPONSE_EVIDENCE_CAPTURE_VERSION);
  assert.equal(snapshot.endpoint, "sales.sku");
  assert.equal(snapshot.reviewStatus, "pending_manual_acceptance");
  assert.equal(snapshot.eligibleForCatalogUpgrade, false);
  assert.deepEqual(snapshot.scope, scope);
  assert.equal(snapshot.traceId, "trace-sales-1");
  assert.equal(snapshot.httpStatus, 200);
  assert.equal(snapshot.upstreamCode, "0");
  assert.match(snapshot.payloadSha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(snapshot.fieldObservations, [
    { field: "info.dataList[].skuCode", observed: true, occurrences: 1, valueTypes: ["string"] },
    { field: "info.dataList[].realTimeSaleCnt", observed: true, occurrences: 1, valueTypes: ["integer"] },
    { field: "info.dataList[].cydSaleCnt", observed: true, occurrences: 1, valueTypes: ["integer"] },
    { field: "info.dataList[].c7dSaleCnt", observed: true, occurrences: 1, valueTypes: ["integer"] },
    { field: "info.dataList[].c30dSaleCnt", observed: true, occurrences: 1, valueTypes: ["integer"] },
    { field: "info.dataList[].dt", observed: true, occurrences: 1, valueTypes: ["string"] },
  ]);
  assert.equal("payload" in snapshot, false);
  assert.equal("headers" in snapshot, false);
  assert.doesNotMatch(JSON.stringify(snapshot), /SKU-1|SECRET|should-not-enter/i);
  assert.throws(() => {
    snapshot.fieldObservations[0].observed = false;
  }, TypeError);
});

test("ERP-07 response evidence snapshot does not mutate the catalog or claim live evidence", () => {
  const before = getErp07EndpointSchema("sales.sku").source.responseEvidence;
  buildErp07ResponseEvidenceSnapshot({
    endpoint: "sales.sku",
    scope,
    sourceRef: "authorized-store-read:erp07-sales-20260830-002",
    observedAt: "2026-08-30T02:01:00.000Z",
    response: response({
      code: "0",
      traceId: "trace-sales-2",
      info: { dataList: [] },
    }),
  });
  const after = getErp07EndpointSchema("sales.sku").source.responseEvidence;
  assert.equal(after.status, "internal_consumer_contract");
  assert.equal(after.authorizedStoreRead, "not_observed");
  assert.deepEqual(after, before);
});

test("ERP-07 response evidence snapshot rejects non-success and invalid payloads", () => {
  assert.throws(
    () => buildErp07ResponseEvidenceSnapshot({
      endpoint: "sales.sku",
      scope,
      sourceRef: "authorized-store-read:erp07-sales-20260830-003",
      observedAt: "2026-08-30T02:02:00.000Z",
      response: response({ code: "BUSINESS_REJECTED", traceId: "trace-failed" }),
    }),
    (error) => error instanceof Erp07ResponseEvidenceError &&
      error.code === "ERP07_RESPONSE_EVIDENCE_UPSTREAM_NOT_SUCCESS",
  );
  assert.throws(
    () => buildErp07ResponseEvidenceSnapshot({
      endpoint: "sales.sku",
      scope,
      sourceRef: "authorized-store-read:erp07-sales-20260830-004",
      observedAt: "2026-08-30T02:03:00.000Z",
      response: response({
        code: "0",
        traceId: "trace-invalid",
        info: { dataList: [{ realTimeSaleCnt: {} }] },
      }),
    }),
    (error) => error instanceof Erp07ResponseEvidenceError &&
      error.code === "ERP07_RESPONSE_EVIDENCE_SCHEMA_INVALID",
  );
});

test("ERP-07 response evidence snapshot rejects forged source and sensitive response shapes", () => {
  assert.throws(
    () => buildErp07ResponseEvidenceSnapshot({
      endpoint: "sales.sku",
      scope,
      sourceRef: "manual-claim-without-authorized-read",
      observedAt: "2026-08-30T02:04:00.000Z",
      response: response({ code: "0", traceId: "trace-source", info: { dataList: [] } }),
    }),
    (error) => error.code === "ERP07_RESPONSE_EVIDENCE_SOURCE_REF_INVALID",
  );
  assert.throws(
    () => buildErp07ResponseEvidenceSnapshot({
      endpoint: "sales.sku",
      scope,
      sourceRef: "authorized-store-read:erp07-sales-20260830-005",
      observedAt: "2026-08-30T02:05:00.000Z",
      response: {
        ...response({ code: "0", traceId: "trace-sensitive", info: { dataList: [] } }),
        headers: { authorization: "Bearer should-not-enter-evidence" },
      },
    }),
    (error) => error.code === "ERP07_RESPONSE_EVIDENCE_SENSITIVE_INPUT",
  );
});

test("ERP-07 response evidence snapshot rejects sensitive diagnostics", () => {
  assert.throws(
    () => buildErp07ResponseEvidenceSnapshot({
      endpoint: "sales.sku",
      scope,
      sourceRef: "authorized-store-read:erp07-sales-20260830-006",
      observedAt: "2026-08-30T02:05:30.000Z",
      response: {
        ...response({ code: "0", traceId: "trace-diagnostics", info: { dataList: [] } }),
        diagnostics: {
          status: 200,
          code: "0",
          traceId: "trace-diagnostics",
          authorization: "Bearer should-not-enter-evidence",
        },
      },
    }),
    (error) => error.code === "ERP07_RESPONSE_EVIDENCE_SENSITIVE_INPUT",
  );
});

test("ERP-07 response evidence snapshot rejects unknown diagnostics metadata", () => {
  assert.throws(
    () => buildErp07ResponseEvidenceSnapshot({
      endpoint: "sales.sku",
      scope,
      sourceRef: "authorized-store-read:erp07-sales-20260830-008",
      observedAt: "2026-08-30T02:05:45.000Z",
      response: {
        ...response({ code: "0", traceId: "trace-diagnostics-metadata", info: { dataList: [] } }),
        diagnostics: {
          status: 200,
          code: "0",
          traceId: "trace-diagnostics-metadata",
          durationMs: 18,
          message: "Bearer should-not-enter-evidence",
        },
      },
    }),
    (error) => error.code === "ERP07_RESPONSE_EVIDENCE_SENSITIVE_INPUT",
  );
});

test("ERP-07 response evidence snapshot rejects unknown capture and scope fields", () => {
  assert.throws(
    () => buildErp07ResponseEvidenceSnapshot({
      endpoint: "sales.sku",
      scope,
      sourceRef: "authorized-store-read:erp07-sales-20260830-009",
      observedAt: "2026-08-30T02:05:50.000Z",
      response: response({ code: "0", traceId: "trace-input-extension", info: { dataList: [] } }),
      authorizationReceipt: "receipt-must-not-be-silently-dropped",
    }),
    (error) => error.code === "ERP07_RESPONSE_EVIDENCE_INPUT_INVALID",
  );
  assert.throws(
    () => buildErp07ResponseEvidenceSnapshot({
      endpoint: "sales.sku",
      scope: { ...scope, secretKey: "must-not-be-accepted" },
      sourceRef: "authorized-store-read:erp07-sales-20260830-010",
      observedAt: "2026-08-30T02:05:55.000Z",
      response: response({ code: "0", traceId: "trace-scope-extension", info: { dataList: [] } }),
    }),
    (error) => error.code === "ERP07_RESPONSE_EVIDENCE_SCOPE_INVALID",
  );
});

test("ERP-07 response evidence snapshot requires a scoped read receipt", () => {
  assert.throws(
    () => buildErp07ResponseEvidenceSnapshot({
      endpoint: "product.publish_or_edit",
      scope,
      sourceRef: "authorized-store-read:erp07-write-should-be-rejected",
      observedAt: "2026-08-30T02:06:00.000Z",
      response: response({ code: "0", traceId: "trace-write", info: {} }),
    }),
    (error) => error.code === "ERP07_RESPONSE_EVIDENCE_READ_ONLY_REQUIRED",
  );
  assert.throws(
    () => buildErp07ResponseEvidenceSnapshot({
      endpoint: "sales.sku",
      scope: { tenantId: "tenant-1", storeId: "", supplierId: "supplier-1" },
      sourceRef: "authorized-store-read:erp07-sales-20260830-007",
      observedAt: "2026-08-30T02:07:00.000Z",
      response: response({ code: "0", traceId: "trace-scope", info: { dataList: [] } }),
    }),
    (error) => error.code === "ERP07_RESPONSE_EVIDENCE_SCOPE_INVALID",
  );
});
