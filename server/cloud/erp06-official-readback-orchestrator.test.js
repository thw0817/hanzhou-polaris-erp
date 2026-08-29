import assert from "node:assert/strict";
import test from "node:test";

import {
  ERP06_OUTBOX_JOB_CONTRACT_VERSION,
  ERP06_OUTBOX_JOB_NAME,
} from "./erp06-outbox-dispatcher-service.js";
import { Erp06SheinRemoteBoundary } from "./erp06-shein-remote-boundary.js";
import {
  ERP06_OFFICIAL_READBACK_ORCHESTRATOR_CONTRACT_VERSION,
  Erp06OfficialReadbackOrchestratorError,
  processErp06OfficialReadback,
} from "./erp06-official-readback-orchestrator.js";

const tenantId = "11111111-1111-4111-8111-111111111111";
const storeId = "22222222-2222-4222-8222-222222222222";
const commandId = "33333333-3333-4333-8333-333333333333";
const attemptId = "44444444-4444-4444-8444-444444444444";
const versionId = "55555555-5555-4555-8555-555555555555";
const batchId = "66666666-6666-4666-8666-666666666666";
const batchItemId = "77777777-7777-4777-8777-777777777777";
const revisionId = "88888888-8888-4888-8888-888888888888";
const version = "VERSION-1";
const versionFingerprint = "version-fingerprint-1";
const occurredAt = new Date("2026-08-30T12:00:00.000Z");

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

function authorization(overrides = {}) {
  return {
    tenantId,
    storeId,
    commandId,
    publishAttemptId: attemptId,
    productVersionId: versionId,
    attemptState: "result_unknown",
    authorizesReadback: true,
    ...overrides,
  };
}

function documentResult(overrides = {}) {
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
    resolvesResultUnknown: false,
    projection: {
      projectionVersion: "product-document-state-v1",
      mode: "dry-run",
      externalWrite: false,
      projection: { eventFamily: "query-document-state", records: [] },
      summary: { disposition: "read-only-document-state-empty", recordCount: 0 },
    },
    diagnostics: { status: 200, code: "0", traceId: "readback-trace-1" },
    ...overrides,
  };
}

function spuResult(overrides = {}) {
  return {
    contractVersion: "erp06-shein-remote-v1",
    commandId,
    publishAttemptId: attemptId,
    productVersionId: versionId,
    stage: "spu_info",
    path: "/open-api/goods/spu-info",
    method: "POST",
    status: "read",
    externalRead: true,
    resolvesResultUnknown: true,
    projection: {
      projectionVersion: "spu-readback-v1",
      mode: "dry-run",
      externalWrite: false,
      projection: { eventFamily: "goods/spu-info", spuName: "SPU-1" },
      summary: { disposition: "read-only-spu-relationship-readback", spuName: "SPU-1" },
    },
    diagnostics: { status: 200, code: "0", traceId: "spu-trace-1" },
    ...overrides,
  };
}

function input(overrides = {}) {
  return {
    stage: "document_state",
    job: job(),
    authorization: authorization(),
    version,
    versionFingerprint,
    spuNames: ["SPU-1"],
    occurredAt,
    ...overrides,
  };
}

test("ERP-06 readback orchestration stays closed without a repository write", async () => {
  let repositoryCalls = 0;
  let credentialCalls = 0;
  const remoteBoundary = new Erp06SheinRemoteBoundary({
    apiBaseUrl: "https://openapi.example",
    resolveCredentials: async () => {
      credentialCalls += 1;
      throw new Error("credentials must not be resolved while disabled");
    },
    request: async () => {
      throw new Error("network must not be called while disabled");
    },
  });

  const result = await processErp06OfficialReadback({
    ...input(),
    remoteBoundary,
    readbackRepository: {
      async recordReadback() {
        repositoryCalls += 1;
      },
    },
  });

  assert.deepEqual(result, {
    contractVersion: ERP06_OFFICIAL_READBACK_ORCHESTRATOR_CONTRACT_VERSION,
    state: "disabled",
    stage: "document_state",
    externalRead: false,
    persisted: false,
    resolvesResultUnknown: false,
  });
  assert.equal(repositoryCalls, 0);
  assert.equal(credentialCalls, 0);
});

test("document_state orchestration calls exactly one remote stage and records one readback", async () => {
  const remoteCalls = [];
  const repositoryCalls = [];
  const result = await processErp06OfficialReadback({
    ...input(),
    remoteBoundary: {
      async readDocumentState(args) {
        remoteCalls.push(["document_state", args]);
        return documentResult();
      },
      async readSpuInfo() {
        throw new Error("document_state orchestration must not call spu_info");
      },
    },
    readbackRepository: {
      async recordReadback(args) {
        repositoryCalls.push(args);
        return { eventId: "event-1", receiptStatus: "unknown" };
      },
    },
  });

  assert.equal(remoteCalls.length, 1);
  assert.equal(remoteCalls[0][0], "document_state");
  assert.equal(remoteCalls[0][1].version, version);
  assert.deepEqual(remoteCalls[0][1].spuNames, ["SPU-1"]);
  assert.equal(repositoryCalls.length, 1);
  assert.equal(repositoryCalls[0].tenantId, tenantId);
  assert.equal(repositoryCalls[0].publishAttemptId, attemptId);
  assert.equal(repositoryCalls[0].productVersionId, versionId);
  assert.equal(repositoryCalls[0].versionFingerprint, versionFingerprint);
  assert.equal(repositoryCalls[0].result.stage, "document_state");
  assert.equal(repositoryCalls[0].occurredAt, occurredAt);
  assert.deepEqual(result, {
    contractVersion: ERP06_OFFICIAL_READBACK_ORCHESTRATOR_CONTRACT_VERSION,
    state: "persisted",
    stage: "document_state",
    externalRead: true,
    persisted: true,
    resolvesResultUnknown: false,
    persistence: { eventId: "event-1", receiptStatus: "unknown" },
  });
});

test("spu_info orchestration calls only the explicit SPU stage", async () => {
  const remoteCalls = [];
  const repositoryCalls = [];
  const result = await processErp06OfficialReadback({
    ...input({ stage: "spu_info", spuNames: undefined, spuName: "SPU-1" }),
    remoteBoundary: {
      async readDocumentState() {
        throw new Error("spu_info orchestration must not call document_state");
      },
      async readSpuInfo(args) {
        remoteCalls.push(args);
        return spuResult();
      },
    },
    readbackRepository: {
      async recordReadback(args) {
        repositoryCalls.push(args);
        return { eventId: "event-2", receiptStatus: "accepted" };
      },
    },
  });

  assert.equal(remoteCalls.length, 1);
  assert.equal(remoteCalls[0].version, version);
  assert.equal(remoteCalls[0].spuName, "SPU-1");
  assert.equal(repositoryCalls.length, 1);
  assert.equal(repositoryCalls[0].result.stage, "spu_info");
  assert.equal(result.resolvesResultUnknown, true);
  assert.equal(result.persistence.eventId, "event-2");
});

test("invalid stage or inputs fail closed before either dependency is called", async () => {
  let remoteCalls = 0;
  let repositoryCalls = 0;
  const dependencies = {
    remoteBoundary: {
      async readDocumentState() {
        remoteCalls += 1;
      },
      async readSpuInfo() {
        remoteCalls += 1;
      },
    },
    readbackRepository: {
      async recordReadback() {
        repositoryCalls += 1;
      },
    },
  };

  await assert.rejects(
    processErp06OfficialReadback({
      ...input({ stage: "publish" }),
      ...dependencies,
    }),
    (error) => error instanceof Erp06OfficialReadbackOrchestratorError
      && error.code === "ERP06_ORCHESTRATOR_INPUT_INVALID",
  );
  await assert.rejects(
    processErp06OfficialReadback({
      ...input({ spuNames: [] }),
      ...dependencies,
    }),
    (error) => error.code === "ERP06_ORCHESTRATOR_INPUT_INVALID",
  );
  await assert.rejects(
    processErp06OfficialReadback({
      ...input({ versionFingerprint: "drifted-version-fingerprint" }),
      ...dependencies,
    }),
    (error) => error.code === "ERP06_ORCHESTRATOR_INPUT_INVALID",
  );
  assert.equal(remoteCalls, 0);
  assert.equal(repositoryCalls, 0);
});

test("readback authorization failure propagates and never records evidence", async () => {
  let repositoryCalls = 0;
  const remoteBoundary = new Erp06SheinRemoteBoundary({
    readbackEnabled: true,
    resolveCredentials: async () => ({ openKeyId: "OPEN-1", secretKey: "SECRET-1" }),
    request: async () => ({ payload: { info: {} } }),
  });

  await assert.rejects(
    processErp06OfficialReadback({
      ...input({ authorization: authorization({ authorizesReadback: false }) }),
      remoteBoundary,
      readbackRepository: {
        async recordReadback() {
          repositoryCalls += 1;
        },
      },
    }),
    (error) => error.code === "ERP06_REMOTE_READBACK_AUTHORIZATION_REQUIRED",
  );
  assert.equal(repositoryCalls, 0);
});

test("an empty document projection is persisted once and does not trigger another stage", async () => {
  let remoteCalls = 0;
  let repositoryCalls = 0;
  const result = await processErp06OfficialReadback({
    ...input(),
    remoteBoundary: {
      async readDocumentState() {
        remoteCalls += 1;
        return documentResult();
      },
    },
    readbackRepository: {
      async recordReadback() {
        repositoryCalls += 1;
        return { eventId: "event-empty", receiptStatus: "unknown" };
      },
    },
  });

  assert.equal(remoteCalls, 1);
  assert.equal(repositoryCalls, 1);
  assert.equal(result.resolvesResultUnknown, false);
});

test("an unsafe or non-read result is rejected before persistence", async () => {
  let repositoryCalls = 0;
  await assert.rejects(
    processErp06OfficialReadback({
      ...input(),
      remoteBoundary: {
        async readDocumentState() {
          return documentResult({ status: "error", externalRead: false });
        },
      },
      readbackRepository: {
        async recordReadback() {
          repositoryCalls += 1;
        },
      },
    }),
    (error) => error.code === "ERP06_ORCHESTRATOR_RESULT_INVALID",
  );
  assert.equal(repositoryCalls, 0);
});

test("repository failure is propagated without a second remote call or automatic retry", async () => {
  let remoteCalls = 0;
  let repositoryCalls = 0;
  const upstream = new Error("persistence unavailable");

  await assert.rejects(
    processErp06OfficialReadback({
      ...input(),
      remoteBoundary: {
        async readDocumentState() {
          remoteCalls += 1;
          return documentResult();
        },
      },
      readbackRepository: {
        async recordReadback() {
          repositoryCalls += 1;
          throw upstream;
        },
      },
    }),
    (error) => error === upstream,
  );
  assert.equal(remoteCalls, 1);
  assert.equal(repositoryCalls, 1);
});
