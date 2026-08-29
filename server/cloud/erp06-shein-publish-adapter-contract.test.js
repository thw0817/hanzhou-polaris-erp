import assert from "node:assert/strict";
import test from "node:test";
import { ERP06_OUTBOX_JOB_CONTRACT_VERSION } from "./erp06-outbox-dispatcher-service.js";
import {
  ERP06_DOCUMENT_STATE_READBACK_ENDPOINT,
  ERP06_SHEIN_PUBLISH_ADAPTER_CONTRACT_VERSION,
  ERP06_SHEIN_PUBLISH_ENDPOINT,
  Erp06SheinPublishAdapter,
  Erp06SheinPublishAdapterError,
  buildErp06SheinPublishRequest,
} from "./erp06-shein-publish-adapter-contract.js";

const tenantId = "11111111-1111-4111-8111-111111111111";
const storeId = "22222222-2222-4222-8222-222222222222";
const commandId = "33333333-3333-4333-8333-333333333333";
const attemptId = "44444444-4444-4444-8444-444444444444";
const versionId = "55555555-5555-4555-8555-555555555555";
const batchId = "66666666-6666-4666-8666-666666666666";
const batchItemId = "77777777-7777-4777-8777-777777777777";
const revisionId = "88888888-8888-4888-8888-888888888888";

function job(overrides = {}) {
  return {
    name: "erp06-publish-command",
    data: {
      commandId,
      tenantId,
      storeId,
      contractVersion: ERP06_OUTBOX_JOB_CONTRACT_VERSION,
      publishBatchId: batchId,
      publishBatchItemId: batchItemId,
      publishAttemptId: attemptId,
      productVersionId: versionId,
      sourceDraftRevisionId: revisionId,
      versionFingerprint: "version-fingerprint-1",
      ...overrides,
    },
  };
}

function source(overrides = {}) {
  return {
    commandId,
    tenantId,
    storeId,
    publishAttemptId: attemptId,
    productVersionId: versionId,
    sourceDraftRevisionId: revisionId,
    versionFingerprint: "version-fingerprint-1",
    requestBody: {
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
    claimId: "worker-claim-1",
    attemptState: "claimed",
    executionEnabled: true,
    authorizesPublishing: true,
    ...overrides,
  };
}

function acceptedResponse(overrides = {}) {
  return {
    payload: {
      code: "0",
      msg: "OK",
      info: {
        success: true,
        spu_name: "SPU-1",
        version: "VERSION-1",
        skc_list: [{
          skc_name: "SKC-1",
          sku_list: [{ sku_code: "SKU-CODE-1", supplier_sku: "SKU-001" }],
        }],
      },
      traceId: "trace-1",
      ...overrides,
    },
    diagnostics: { traceId: "trace-1" },
  };
}

test("ERP-06 adapter request is bound to the official publishOrEdit endpoint and exact command identity", () => {
  const request = buildErp06SheinPublishRequest({
    job: job().data,
    source: source(),
  });

  assert.equal(request.path, ERP06_SHEIN_PUBLISH_ENDPOINT);
  assert.equal(request.method, "POST");
  assert.equal(request.commandId, commandId);
  assert.equal(request.publishAttemptId, attemptId);
  assert.equal(request.productVersionId, versionId);
  assert.equal(request.versionFingerprint, "version-fingerprint-1");
  assert.deepEqual(request.body, source().requestBody);
  assert.doesNotMatch(JSON.stringify(job().data), /secret|token|password|credential|requestBody|imageUrl/i);
});

test("ERP-06 adapter fails closed on scope, fingerprint, or sensitive source drift", () => {
  assert.throws(
    () => buildErp06SheinPublishRequest({
      job: job({ storeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }).data,
      source: source(),
    }),
    (error) => error instanceof Erp06SheinPublishAdapterError && error.code === "ERP06_ADAPTER_SCOPE_MISMATCH",
  );
  assert.throws(
    () => buildErp06SheinPublishRequest({
      job: job({ versionFingerprint: "changed" }).data,
      source: source(),
    }),
    (error) => error.code === "ERP06_ADAPTER_FINGERPRINT_MISMATCH",
  );
  assert.throws(
    () => buildErp06SheinPublishRequest({
      job: job().data,
      source: source({ requestBody: { ...source().requestBody, accessKeySecret: "must-not-enter" } }),
    }),
    (error) => error.code === "ERP06_ADAPTER_SENSITIVE_SOURCE",
  );
  assert.throws(
    () => buildErp06SheinPublishRequest({
      job: job().data,
      source: source({ endpoint: "/open-api/goods/product/partialEdit" }),
    }),
    (error) => error.code === "ERP06_ADAPTER_ENDPOINT_INVALID",
  );
});

test("default ERP-06 adapter is disabled and never loads a source or calls a sender", async () => {
  let sourceLoads = 0;
  let sends = 0;
  const adapter = new Erp06SheinPublishAdapter({
    send: async () => {
      sends += 1;
    },
  });

  const result = await adapter.execute({
    job: job(),
    authorization: authorization(),
    sourceLoader: async () => {
      sourceLoads += 1;
      return source();
    },
  });

  assert.deepEqual(result, {
    contractVersion: ERP06_SHEIN_PUBLISH_ADAPTER_CONTRACT_VERSION,
    commandId,
    publishAttemptId: attemptId,
    outcome: "not_sent",
    state: "not_sent",
    remoteCallMade: false,
    sendStarted: false,
    retryable: false,
    error: {
      code: "ERP06_SHEIN_PUBLISH_EXECUTION_DISABLED",
      message: "ERP-06 SHEIN真实发布边界当前关闭",
    },
  });
  assert.equal(sourceLoads, 0);
  assert.equal(sends, 0);
});

test("adapter requires explicit execution authorization before loading the frozen source", async () => {
  let sourceLoads = 0;
  let sends = 0;
  const adapter = new Erp06SheinPublishAdapter({
    executionEnabled: true,
    send: async () => {
      sends += 1;
    },
  });

  const result = await adapter.execute({
    job: job(),
    authorization: authorization({ authorizesPublishing: false }),
    sourceLoader: async () => {
      sourceLoads += 1;
      return source();
    },
  });

  assert.equal(result.outcome, "not_sent");
  assert.equal(result.error.code, "ERP06_SHEIN_PUBLISH_AUTHORIZATION_REQUIRED");
  assert.equal(result.remoteCallMade, false);
  assert.equal(sourceLoads, 0);
  assert.equal(sends, 0);
});

test("authorized adapter records send_started before one sanitized accepted receipt", async () => {
  const calls = [];
  const sendStarted = [];
  const adapter = new Erp06SheinPublishAdapter({
    executionEnabled: true,
    send: async (request) => {
      calls.push(request);
      return acceptedResponse();
    },
    onSendStarted: async (event) => {
      sendStarted.push(event);
    },
  });

  const result = await adapter.execute({
    job: job(),
    authorization: authorization(),
    sourceLoader: async () => source(),
  });

  assert.equal(result.outcome, "accepted");
  assert.equal(result.state, "submitted");
  assert.equal(result.remoteCallMade, true);
  assert.equal(result.sendStarted, true);
  assert.deepEqual(result.receipt, {
    success: true,
    spuName: "SPU-1",
    version: "VERSION-1",
    skcs: [{
      skcName: "SKC-1",
      skus: [{ skuCode: "SKU-CODE-1", supplierSku: "SKU-001" }],
    }],
    traceId: "trace-1",
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, ERP06_SHEIN_PUBLISH_ENDPOINT);
  assert.deepEqual(calls[0].body, source().requestBody);
  assert.doesNotMatch(JSON.stringify(sendStarted), /secret|token|password|requestBody|imageUrl/i);
  assert.deepEqual(sendStarted, [{
    contractVersion: ERP06_SHEIN_PUBLISH_ADAPTER_CONTRACT_VERSION,
    commandId,
    publishAttemptId: attemptId,
    productVersionId: versionId,
    versionFingerprint: "version-fingerprint-1",
    path: ERP06_SHEIN_PUBLISH_ENDPOINT,
  }]);
});

test("incomplete success and transport uncertainty become result_unknown without retry", async () => {
  const incomplete = new Erp06SheinPublishAdapter({
    executionEnabled: true,
    onSendStarted: async () => {},
    send: async () => ({
      payload: { code: "0", info: { success: true }, traceId: "trace-incomplete" },
    }),
  });
  const incompleteResult = await incomplete.execute({
    job: job(),
    authorization: authorization(),
    sourceLoader: async () => source(),
  });
  assert.equal(incompleteResult.outcome, "unknown");
  assert.equal(incompleteResult.state, "result_unknown");
  assert.equal(incompleteResult.retryable, false);
  assert.equal(incompleteResult.remoteCallMade, true);

  const timeout = new Erp06SheinPublishAdapter({
    executionEnabled: true,
    onSendStarted: async () => {},
    send: async () => {
      throw Object.assign(new Error("network timeout"), { code: "ETIMEDOUT" });
    },
  });
  const timeoutResult = await timeout.execute({
    job: job(),
    authorization: authorization(),
    sourceLoader: async () => source(),
  });
  assert.equal(timeoutResult.outcome, "unknown");
  assert.equal(timeoutResult.state, "result_unknown");
  assert.equal(timeoutResult.retryable, false);
  assert.equal(timeoutResult.error.code, "ETIMEDOUT");
});

test("explicit SHEIN responses are failures: signature rejection requires reauthorization, 429/5xx are retryable", async () => {
  const signatureError = Object.assign(new Error("签名错误"), {
    code: "openapi00001",
    status: 401,
    response: { code: "openapi00001", msg: "签名错误", traceId: "trace-auth" },
    traceId: "trace-auth",
  });
  const authResult = await new Erp06SheinPublishAdapter({
    executionEnabled: true,
    onSendStarted: async () => {},
    send: async () => { throw signatureError; },
  }).execute({
    job: job(),
    authorization: authorization(),
    sourceLoader: async () => source(),
  });
  assert.deepEqual(authResult.error, {
    code: "openapi00001",
    message: "签名错误",
    traceId: "trace-auth",
    requiresReauthorization: true,
  });
  assert.equal(authResult.outcome, "failed");
  assert.equal(authResult.state, "failed");
  assert.equal(authResult.retryable, false);

  const rateError = Object.assign(new Error("流量保护"), {
    code: "4000004",
    status: 429,
    response: { code: "4000004", msg: "流量保护", traceId: "trace-rate" },
  });
  const rateResult = await new Erp06SheinPublishAdapter({
    executionEnabled: true,
    onSendStarted: async () => {},
    send: async () => { throw rateError; },
  }).execute({
    job: job(),
    authorization: authorization(),
    sourceLoader: async () => source(),
  });
  assert.equal(rateResult.outcome, "failed");
  assert.equal(rateResult.retryable, true);
  assert.equal(rateResult.error.code, "4000004");
  assert.equal(rateResult.error.requiresReauthorization, undefined);

  const serverError = Object.assign(new Error("upstream unavailable"), {
    code: "UPSTREAM_503",
    status: 503,
    response: { code: "UPSTREAM_503", msg: "upstream unavailable" },
  });
  const serverResult = await new Erp06SheinPublishAdapter({
    executionEnabled: true,
    onSendStarted: async () => {},
    send: async () => { throw serverError; },
  }).execute({
    job: job(),
    authorization: authorization(),
    sourceLoader: async () => source(),
  });
  assert.equal(serverResult.outcome, "failed");
  assert.equal(serverResult.retryable, true);
});

test("official document-state readback is an explicit no-network placeholder and cannot resolve result_unknown", () => {
  let remoteCalls = 0;
  const adapter = new Erp06SheinPublishAdapter({
    executionEnabled: true,
    send: async () => {
      remoteCalls += 1;
    },
  });
  const placeholder = adapter.buildReadbackPlaceholder({
    job: job(),
    attemptState: "result_unknown",
  });

  assert.deepEqual(placeholder, {
    contractVersion: ERP06_SHEIN_PUBLISH_ADAPTER_CONTRACT_VERSION,
    commandId,
    publishAttemptId: attemptId,
    stage: "document_state",
    endpoint: ERP06_DOCUMENT_STATE_READBACK_ENDPOINT,
    method: "POST",
    status: "not_implemented",
    supported: false,
    externalRead: false,
    resolvesResultUnknown: false,
    message: "官方商品单据状态回读占位尚未接入，不得据此解除 result_unknown",
  });
  assert.equal(remoteCalls, 0);
});

test("send-start persistence failure is fail-closed and never sends the SHEIN request", async () => {
  let sends = 0;
  const adapter = new Erp06SheinPublishAdapter({
    executionEnabled: true,
    send: async () => {
      sends += 1;
      return acceptedResponse();
    },
    onSendStarted: async () => {
      throw new Error("ledger unavailable");
    },
  });
  const result = await adapter.execute({
    job: job(),
    authorization: authorization(),
    sourceLoader: async () => source(),
  });
  assert.equal(result.outcome, "not_sent");
  assert.equal(result.state, "not_sent");
  assert.equal(result.error.code, "ERP06_SEND_STARTED_PERSISTENCE_FAILED");
  assert.equal(result.remoteCallMade, false);
  assert.equal(sends, 0);
});

test("adapter never records send_started when the actual sender is not configured", async () => {
  let sendStarted = 0;
  const adapter = new Erp06SheinPublishAdapter({
    executionEnabled: true,
    onSendStarted: async () => {
      sendStarted += 1;
    },
  });
  const result = await adapter.execute({
    job: job(),
    authorization: authorization(),
    sourceLoader: async () => source(),
  });
  assert.equal(result.outcome, "not_sent");
  assert.equal(result.error.code, "ERP06_ADAPTER_SENDER_REQUIRED");
  assert.equal(result.remoteCallMade, false);
  assert.equal(sendStarted, 0);
});
