import assert from "node:assert/strict";
import test from "node:test";
import {
  ERP06_SPU_INFO_READBACK_ENDPOINT,
  ERP06_SHEIN_REMOTE_BOUNDARY_CONTRACT_VERSION,
  Erp06SheinRemoteBoundary,
  buildErp06DocumentStateReadbackRequest,
  buildErp06SpuInfoReadbackRequest,
} from "./erp06-shein-remote-boundary.js";
import {
  ERP06_OUTBOX_JOB_CONTRACT_VERSION,
  ERP06_OUTBOX_JOB_NAME,
} from "./erp06-outbox-dispatcher-service.js";
import {
  ERP06_SHEIN_PUBLISH_ENDPOINT,
  ERP06_SHEIN_PUBLISH_ADAPTER_CONTRACT_VERSION,
} from "./erp06-shein-publish-adapter-contract.js";

const tenantId = "11111111-1111-4111-8111-111111111111";
const storeId = "22222222-2222-4222-8222-222222222222";
const commandId = "33333333-3333-4333-8333-333333333333";
const attemptId = "44444444-4444-4444-8444-444444444444";
const versionId = "55555555-5555-4555-8555-555555555555";
const batchId = "66666666-6666-4666-8666-666666666666";
const batchItemId = "77777777-7777-4777-8777-777777777777";
const revisionId = "88888888-8888-4888-8888-888888888888";
const versionFingerprint = "version-fingerprint-1";

function job(overrides = {}) {
  return {
    id: commandId,
    name: ERP06_OUTBOX_JOB_NAME,
    data: {
      contractVersion: ERP06_OUTBOX_JOB_CONTRACT_VERSION,
      commandId,
      tenantId,
      storeId,
      publishBatchId: batchId,
      publishBatchItemId: batchItemId,
      publishAttemptId: attemptId,
      productVersionId: versionId,
      sourceDraftRevisionId: revisionId,
      versionFingerprint,
      ...overrides,
    },
  };
}

function publishRequest(overrides = {}) {
  return {
    contractVersion: ERP06_SHEIN_PUBLISH_ADAPTER_CONTRACT_VERSION,
    method: "POST",
    path: ERP06_SHEIN_PUBLISH_ENDPOINT,
    commandId,
    tenantId,
    storeId,
    publishAttemptId: attemptId,
    productVersionId: versionId,
    sourceDraftRevisionId: revisionId,
    versionFingerprint,
    body: {
      category_id: "3155",
      product_type_id: "991",
      source_system: "OpenAPI",
      supplier_code: "SUPPLIER-1",
      spu_name: "SPU-1",
      skc_list: [{
        skc_name: "SKC-1",
        sku_list: [{ sku_code: "SKU-CODE-1", supplier_sku: "SKU-001" }],
      }],
    },
    ...overrides,
  };
}

function authorization(overrides = {}) {
  return {
    tenantId,
    storeId,
    commandId,
    publishAttemptId: attemptId,
    productVersionId: versionId,
    attemptState: "claimed",
    claimId: "worker-claim-1",
    authorizesPublishing: true,
    authorizesReadback: true,
    ...overrides,
  };
}

function boundary(overrides = {}) {
  return new Erp06SheinRemoteBoundary({
    apiBaseUrl: "https://openapi.example",
    resolveCredentials: async () => ({
      openKeyId: "OPEN-1",
      secretKey: "SECRET-1",
    }),
    ...overrides,
  });
}

test("ERP-06 remote boundary is disabled by default and never resolves credentials or sends", async () => {
  let credentialCalls = 0;
  let requestCalls = 0;
  const remote = boundary({
    resolveCredentials: async () => {
      credentialCalls += 1;
      return { openKeyId: "OPEN-1", secretKey: "SECRET-1" };
    },
    request: async () => {
      requestCalls += 1;
    },
  });

  await assert.rejects(
    remote.sendPublish({
      request: publishRequest(),
      authorization: authorization(),
    }),
    (error) => error.code === "ERP06_REMOTE_PUBLISH_DISABLED",
  );
  assert.equal(credentialCalls, 0);
  assert.equal(requestCalls, 0);
});

test("ERP-06 remote publisher rejects authorization and request drift before credential resolution", async () => {
  let credentialCalls = 0;
  const remote = boundary({
    executionEnabled: true,
    resolveCredentials: async () => {
      credentialCalls += 1;
      return { openKeyId: "OPEN-1", secretKey: "SECRET-1" };
    },
    request: async () => ({ payload: { code: "0" } }),
  });

  await assert.rejects(
    remote.sendPublish({
      request: publishRequest(),
      authorization: authorization({ authorizesPublishing: false }),
    }),
    (error) => error.code === "ERP06_REMOTE_PUBLISH_AUTHORIZATION_REQUIRED",
  );
  await assert.rejects(
    remote.sendPublish({
      request: publishRequest({ path: "/open-api/goods/product/partialEdit" }),
      authorization: authorization(),
    }),
    (error) => error.code === "ERP06_REMOTE_PUBLISH_REQUEST_INVALID",
  );
  await assert.rejects(
    remote.sendPublish({
      request: publishRequest({ storeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
      authorization: authorization(),
    }),
    (error) => error.code === "ERP06_REMOTE_PUBLISH_REQUEST_INVALID",
  );
  assert.equal(credentialCalls, 0);
});

test("ERP-06 remote publisher sends one exact publish request only after explicit authorization", async () => {
  const credentials = [];
  const requests = [];
  const remote = boundary({
    executionEnabled: true,
    resolveCredentials: async (scope) => {
      credentials.push(scope);
      return { openKeyId: "OPEN-1", secretKey: "SECRET-1" };
    },
    request: async (input) => {
      requests.push(input);
      return {
        payload: {
          code: "0",
          msg: "OK",
          info: { success: true, spu_name: "SPU-1" },
          traceId: "publish-trace-1",
        },
        diagnostics: { status: 200, code: "0", traceId: "publish-trace-1" },
      };
    },
  });

  const result = await remote.sendPublish({
    request: publishRequest(),
    authorization: authorization(),
  });

  assert.equal(requests.length, 1);
  assert.deepEqual(credentials, [{ tenantId, storeId }]);
  assert.deepEqual(requests[0], {
    baseUrl: "https://openapi.example",
    method: "POST",
    path: ERP06_SHEIN_PUBLISH_ENDPOINT,
    body: publishRequest().body,
    openKeyId: "OPEN-1",
    secretKey: "SECRET-1",
    language: "zh-cn",
    timeoutMs: 60_000,
  });
  assert.equal(result.payload.info.success, true);
  assert.equal(result.diagnostics.traceId, "publish-trace-1");
  assert.doesNotMatch(JSON.stringify(result), /SECRET-1|OPEN-1/);
});

test("ERP-06 remote publisher preserves upstream error identity and never retries", async () => {
  let calls = 0;
  const upstream = Object.assign(new Error("流量保护"), {
    status: 429,
    code: "4000004",
    traceId: "rate-trace-1",
    response: { code: "4000004", msg: "流量保护", traceId: "rate-trace-1" },
  });
  const remote = boundary({
    executionEnabled: true,
    request: async () => {
      calls += 1;
      throw upstream;
    },
  });

  await assert.rejects(
    remote.sendPublish({ request: publishRequest(), authorization: authorization() }),
    (error) => error === upstream && error.status === 429 && error.code === "4000004" && error.traceId === "rate-trace-1",
  );
  assert.equal(calls, 1);
});

test("ERP-06 document-state readback is disabled by default and cannot resolve result_unknown", async () => {
  let credentialCalls = 0;
  let requestCalls = 0;
  const remote = boundary({
    resolveCredentials: async () => {
      credentialCalls += 1;
      return { openKeyId: "OPEN-1", secretKey: "SECRET-1" };
    },
    request: async () => {
      requestCalls += 1;
      return {};
    },
  });

  const result = await remote.readDocumentState({
    job: job(),
    authorization: authorization({ attemptState: "result_unknown" }),
    version: "VERSION-1",
    spuNames: ["SPU-1"],
  });

  assert.deepEqual(result, {
    contractVersion: ERP06_SHEIN_REMOTE_BOUNDARY_CONTRACT_VERSION,
    commandId,
    publishAttemptId: attemptId,
    productVersionId: versionId,
    stage: "document_state",
    path: "/open-api/goods/query-document-state",
    method: "POST",
    status: "disabled",
    externalRead: false,
    resolvesResultUnknown: false,
    projection: null,
  });
  assert.equal(credentialCalls, 0);
  assert.equal(requestCalls, 0);
});

test("ERP-06 document-state readback uses the official body and returns a safe projection", async () => {
  const credentials = [];
  const requests = [];
  const remote = boundary({
    readbackEnabled: true,
    resolveCredentials: async (scope) => {
      credentials.push(scope);
      return { openKeyId: "OPEN-1", secretKey: "SECRET-1" };
    },
    request: async (input) => {
      requests.push(input);
      return {
        payload: {
          code: "0",
          msg: "OK",
          info: {
            data: [{
              spuName: "SPU-1",
              version: "VERSION-1",
              skcList: [{
                skcName: "SKC-1",
                documentSn: "DOC-1",
                documentState: 2,
              }],
            }],
          },
          traceId: "state-trace-1",
        },
        diagnostics: { status: 200, code: "0", traceId: "state-trace-1" },
      };
    },
  });

  const result = await remote.readDocumentState({
    job: job(),
    authorization: authorization({ attemptState: "result_unknown" }),
    version: "VERSION-1",
    spuNames: ["SPU-1", "SPU-1"],
  });

  assert.deepEqual(requests[0], {
    baseUrl: "https://openapi.example",
    method: "POST",
    path: "/open-api/goods/query-document-state",
    body: { version: "VERSION-1", spuList: [{ spuName: "SPU-1" }] },
    openKeyId: "OPEN-1",
    secretKey: "SECRET-1",
    language: "zh-cn",
    timeoutMs: 60_000,
  });
  assert.deepEqual(credentials, [{ tenantId, storeId }]);
  assert.equal(result.status, "read");
  assert.equal(result.externalRead, true);
  assert.equal(result.resolvesResultUnknown, true);
  assert.equal(result.projection.projection.records[0].status, "passed");
  assert.equal(result.diagnostics.traceId, "state-trace-1");
  assert.doesNotMatch(JSON.stringify(result), /SECRET-1|OPEN-1/);
});

test("ERP-06 empty document-state readback stays non-resolving and malformed records fail closed", async () => {
  const remote = boundary({
    readbackEnabled: true,
    request: async () => ({
      payload: { code: "0", msg: "OK", info: { data: [] }, traceId: "empty-trace" },
      diagnostics: { status: 200, code: "0", traceId: "empty-trace" },
    }),
  });
  const empty = await remote.readDocumentState({
    job: job(),
    authorization: authorization({ attemptState: "result_unknown" }),
    version: "VERSION-1",
    spuNames: ["SPU-1"],
  });
  assert.equal(empty.status, "read");
  assert.equal(empty.externalRead, true);
  assert.equal(empty.resolvesResultUnknown, false);
  assert.equal(empty.projection.empty, true);

  const invalid = boundary({
    readbackEnabled: true,
    request: async () => ({
      payload: {
        code: "0",
        info: { data: [{ version: "VERSION-1", audit_state: 99 }] },
      },
      diagnostics: { status: 200, code: "0", traceId: "invalid-trace" },
    }),
  });
  await assert.rejects(
    invalid.readDocumentState({
      job: job(),
      authorization: authorization({ attemptState: "submitted" }),
      version: "VERSION-1",
      spuNames: ["SPU-1"],
    }),
    (error) => error.code === "INVALID_PRODUCT_DOCUMENT_STATE",
  );
});

test("ERP-06 SPU readback uses the official body, requires submitted/unknown attempt, and normalizes relationships", async () => {
  const requests = [];
  const remote = boundary({
    readbackEnabled: true,
    request: async (input) => {
      requests.push(input);
      return {
        payload: {
          code: "0",
          msg: "OK",
          info: {
            spuName: "SPU-1",
            categoryId: 3155,
            productTypeId: 991,
            skcInfoList: [{
              skcName: "SKC-1",
              skuInfoList: [{ skuCode: "SKU-1", supplierSku: "SUPPLIER-1" }],
            }],
          },
          traceId: "spu-trace-1",
        },
        diagnostics: { status: 200, code: "0", traceId: "spu-trace-1" },
      };
    },
  });

  const result = await remote.readSpuInfo({
    job: job(),
    authorization: authorization({ attemptState: "submitted" }),
    version: "VERSION-1",
    spuName: "SPU-1",
  });

  assert.deepEqual(requests[0], {
    baseUrl: "https://openapi.example",
    method: "POST",
    path: ERP06_SPU_INFO_READBACK_ENDPOINT,
    body: { languageList: ["zh-cn", "en"], spuName: "SPU-1" },
    openKeyId: "OPEN-1",
    secretKey: "SECRET-1",
    language: "zh-cn",
    timeoutMs: 60_000,
  });
  assert.equal(result.status, "read");
  assert.equal(result.externalRead, true);
  assert.equal(result.resolvesResultUnknown, true);
  assert.equal(result.projection.projection.skcs[0].skuList[0].skuCode, "SKU-1");
  assert.equal(result.diagnostics.traceId, "spu-trace-1");
  assert.doesNotMatch(JSON.stringify(result), /SECRET-1|OPEN-1/);
});

test("ERP-06 readback request builders preserve exact scope and official request bodies", () => {
  const documentRequest = buildErp06DocumentStateReadbackRequest({
    job: job(),
    version: "VERSION-1",
    spuNames: ["SPU-1", "SPU-1", "SPU-2"],
  });
  assert.deepEqual(documentRequest, {
    contractVersion: ERP06_SHEIN_REMOTE_BOUNDARY_CONTRACT_VERSION,
    commandId,
    tenantId,
    storeId,
    publishAttemptId: attemptId,
    productVersionId: versionId,
    sourceDraftRevisionId: revisionId,
    versionFingerprint,
    method: "POST",
    path: "/open-api/goods/query-document-state",
    body: {
      version: "VERSION-1",
      spuList: [{ spuName: "SPU-1" }, { spuName: "SPU-2" }],
    },
  });

  const spuRequest = buildErp06SpuInfoReadbackRequest({
    job: job(),
    version: "VERSION-1",
    spuName: "SPU-1",
  });
  assert.equal(spuRequest.path, ERP06_SPU_INFO_READBACK_ENDPOINT);
  assert.equal(spuRequest.method, "POST");
  assert.deepEqual(spuRequest.body, {
    languageList: ["zh-cn", "en"],
    spuName: "SPU-1",
  });
  assert.equal(spuRequest.commandId, commandId);
  assert.equal(spuRequest.publishAttemptId, attemptId);
  assert.equal(spuRequest.productVersionId, versionId);
});
