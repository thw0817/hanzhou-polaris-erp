import assert from "node:assert/strict";
import test from "node:test";

import {
  ERP06_OUTBOX_JOB_CONTRACT_VERSION,
  ERP06_OUTBOX_JOB_NAME,
} from "./erp06-outbox-dispatcher-service.js";
import { ERP06_SHEIN_PUBLISH_ADAPTER_CONTRACT_VERSION } from "./erp06-shein-publish-adapter-contract.js";
import {
  ERP06_PUBLISH_READBACK_PIPELINE_CONTRACT_VERSION,
  processErp06PublishReadbackJob,
} from "./erp06-publish-readback-pipeline.js";

const tenantId = "11111111-1111-4111-8111-111111111111";
const storeId = "22222222-2222-4222-8222-222222222222";
const commandId = "33333333-3333-4333-8333-333333333333";
const attemptId = "44444444-4444-4444-8444-444444444444";
const versionId = "55555555-5555-4555-8555-555555555555";
const batchId = "66666666-6666-4666-8666-666666666666";
const batchItemId = "77777777-7777-4777-8777-777777777777";
const revisionId = "88888888-8888-4888-8888-888888888888";
const versionFingerprint = "version-fingerprint-1";
const claimId = "worker-1:claim-1";
const version = "VERSION-1";

function job() {
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
    },
  };
}

function claimedCommand() {
  return {
    id: commandId,
    tenant_id: tenantId,
    store_id: storeId,
    publish_attempt_id: attemptId,
    product_version_id: versionId,
    state: "dispatching",
    worker_claim_id: claimId,
    attempt_state: "dispatched",
    payload_summary: {
      publishBatchId: batchId,
      publishBatchItemId: batchItemId,
      publishAttemptId: attemptId,
      productVersionId: versionId,
      sourceDraftRevisionId: revisionId,
      versionFingerprint,
    },
  };
}

function source() {
  return {
    commandId,
    tenantId,
    storeId,
    publishAttemptId: attemptId,
    productVersionId: versionId,
    sourceDraftRevisionId: revisionId,
    versionFingerprint,
    endpoint: "/open-api/goods/product/publishOrEdit",
    requestBody: { spu_name: "SPU-1", version },
  };
}

function publishResponse({ complete = true } = {}) {
  return {
    payload: {
      code: "0",
      info: complete
        ? {
          success: true,
          spu_name: "SPU-1",
          version,
          skc_list: [{
            skc_name: "SKC-1",
            sku_list: [{ sku_code: "SKU-1", supplier_sku: "SUPPLIER-1" }],
          }],
        }
        : { success: true },
    },
    diagnostics: { status: 200, code: "0", traceId: "publish-trace-1" },
  };
}

function readbackResponse({ resolves = false } = {}) {
  return {
    contractVersion: "erp06-shein-remote-v1",
    commandId,
    publishAttemptId: attemptId,
    productVersionId: versionId,
    stage: "document_state",
    path: "/open-api/goods/query-document-state",
    method: "POST",
    status: "read",
    externalRead: true,
    resolvesResultUnknown: resolves,
    projection: {
      projectionVersion: "product-document-state-v1",
      mode: "dry-run",
      externalWrite: false,
      projection: {
        eventFamily: "query-document-state",
        records: resolves
          ? [{ spuName: "SPU-1", version, status: "passed", documentSn: "DOC-1" }]
          : [],
      },
      summary: {
        disposition: resolves ? "read-only-document-state" : "read-only-document-state-empty",
        recordCount: resolves ? 1 : 0,
      },
    },
    diagnostics: { status: 200, code: "0", traceId: "readback-trace-1" },
  };
}

function dependencies({ publish = publishResponse(), readback = readbackResponse(), failReadback = null } = {}) {
  const calls = [];
  const commandRepository = {
    async claimCommand(input) {
      calls.push(["claim", input]);
      return claimedCommand();
    },
    async releaseCommandDryRun(input) {
      calls.push(["release", input]);
      return { id: commandId, state: "queued" };
    },
  };
  const resultRepository = {
    async recordSendStarted(input) {
      calls.push(["send_started", input]);
      return { eventId: "send-event-1" };
    },
    async recordPublishResult(input) {
      calls.push(["publish_result", input]);
      return { eventId: "publish-event-1", outcome: input.result.outcome };
    },
  };
  const remoteBoundary = {
    executionEnabled: true,
    readbackEnabled: true,
    async sendPublish(input) {
      calls.push(["remote_publish", input]);
      assert.equal(input.request.commandId, commandId);
      assert.equal(input.authorization.commandId, commandId);
      assert.equal(input.authorization.attemptState, "claimed");
      return publish;
    },
    async readDocumentState(input) {
      calls.push(["remote_readback", input]);
      assert.equal(input.authorization.commandId, commandId);
      assert.ok(["submitted", "result_unknown"].includes(input.authorization.attemptState));
      return readback;
    },
    async readSpuInfo() {
      throw new Error("pipeline must not call a second readback stage");
    },
  };
  const readbackRepository = {
    async recordReadback(input) {
      calls.push(["readback_result", input]);
      if (failReadback) throw failReadback;
      return { eventId: "readback-event-1", receiptStatus: "accepted" };
    },
  };
  return {
    calls,
    commandRepository,
    resultRepository,
    remoteBoundary,
    readbackRepository,
  };
}

function baseInput(overrides = {}) {
  return {
    job: job(),
    sourceLoader: async (input) => {
      assert.equal(input.commandId, commandId);
      assert.equal(input.claimId, claimId);
      return source();
    },
    executionEnabled: true,
    authorizesPublishing: true,
    authorizesReadback: true,
    readback: { stage: "document_state", version, spuNames: ["SPU-1"] },
    workerId: "worker-1",
    claimId,
    ...overrides,
  };
}

test("composition runs claim, publish, result persistence, one readback stage, and readback persistence in order", async () => {
  const deps = dependencies();
  const result = await processErp06PublishReadbackJob({
    ...baseInput(),
    ...deps,
  });

  assert.equal(result.contractVersion, ERP06_PUBLISH_READBACK_PIPELINE_CONTRACT_VERSION);
  assert.equal(result.state, "completed");
  assert.equal(result.publish.outcome, "accepted");
  assert.equal(result.readback.state, "persisted");
  assert.deepEqual(deps.calls.map(([name]) => name), [
    "claim",
    "send_started",
    "remote_publish",
    "publish_result",
    "remote_readback",
    "readback_result",
  ]);
  assert.equal(deps.calls[4][1].authorization.attemptState, "submitted");
  assert.equal(deps.calls.filter(([name]) => name === "remote_readback").length, 1);
});

test("closed execution stays not_sent and performs no remote publish or readback", async () => {
  const deps = dependencies();
  deps.remoteBoundary.executionEnabled = false;
  const result = await processErp06PublishReadbackJob({
    ...baseInput({ executionEnabled: false }),
    ...deps,
  });

  assert.equal(result.state, "not_sent");
  assert.equal(result.publish.outcome, "not_sent");
  assert.equal(result.readback, null);
  assert.deepEqual(deps.calls.map(([name]) => name), ["claim", "release"]);
});

test("result_unknown is read back once but remains pending when evidence is incomplete", async () => {
  const deps = dependencies({ publish: publishResponse({ complete: false }) });
  const result = await processErp06PublishReadbackJob({
    ...baseInput(),
    ...deps,
  });

  assert.equal(result.publish.outcome, "unknown");
  assert.equal(result.readback.resolvesResultUnknown, false);
  assert.equal(result.state, "readback_pending");
  assert.equal(deps.calls.filter(([name]) => name === "remote_readback").length, 1);
  assert.equal(deps.calls.some(([name]) => name === "release"), false);
  assert.equal(deps.calls[4][1].authorization.attemptState, "result_unknown");
});

test("scope and readback persistence failures fail closed without retry or second stage", async () => {
  const failure = new Error("readback persistence unavailable");
  const deps = dependencies({ failReadback: failure });
  await assert.rejects(
    processErp06PublishReadbackJob({
      ...baseInput(),
      ...deps,
    }),
    (error) => error === failure,
  );
  assert.equal(deps.calls.filter(([name]) => name === "remote_publish").length, 1);
  assert.equal(deps.calls.filter(([name]) => name === "remote_readback").length, 1);
  assert.equal(deps.calls.filter(([name]) => name === "readback_result").length, 1);
  assert.equal(deps.calls.some(([name]) => name === "release"), false);
  assert.equal(deps.calls.some(([name]) => name === "spu_info"), false);
});

test("a missing readback specification never invents completion or retries", async () => {
  const deps = dependencies();
  const result = await processErp06PublishReadbackJob({
    ...baseInput({ readback: null }),
    ...deps,
  });

  assert.equal(result.publish.outcome, "accepted");
  assert.equal(result.state, "readback_required");
  assert.equal(result.readback, null);
  assert.equal(deps.calls.some(([name]) => name === "remote_readback"), false);
});

test("invalid readback scope is rejected before claiming or sending anything", async () => {
  const deps = dependencies();
  await assert.rejects(
    processErp06PublishReadbackJob({
      ...baseInput({
        readback: {
          stage: "document_state",
          version,
          versionFingerprint: "drifted-version-fingerprint",
          spuNames: ["SPU-1"],
        },
      }),
      ...deps,
    }),
    (error) => error.code === "ERP06_PIPELINE_SCOPE_MISMATCH",
  );
  assert.deepEqual(deps.calls, []);
});

test("publish result fixture remains within the adapter contract and contains no secret material", () => {
  assert.equal(ERP06_SHEIN_PUBLISH_ADAPTER_CONTRACT_VERSION, "erp06-shein-publish-v1");
  assert.equal(JSON.stringify(source()).includes("secret"), false);
});
