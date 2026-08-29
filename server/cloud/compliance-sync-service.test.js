import assert from "node:assert/strict";
import test from "node:test";
import {
  flattenComplianceRequirements,
  WebComplianceSyncService,
} from "./compliance-sync-service.js";

function completeRow(skc = "SKC-1") {
  return {
    skc,
    state: "待补充",
    certificate: "待补充",
    agency: "无需",
    warning: "无需",
    platformOnly: "无需",
    packagePhoto: "无需",
    bodyPhoto: "无需",
    sourceCoverage: {
      requirementsReturned: true,
      photoRequirementsReturned: true,
    },
    certificateRequirements: [{
      certificateTypeCode: "CE",
      complianceGroupCode: "ZSZZL",
      isRequired: 1,
      reviewState: 0,
    }],
    agencyRequirements: [],
    warningRequirements: [],
    packagePhotoRequirements: [],
    bodyPhotoRequirements: [],
    unsupportedRequirements: [],
  };
}

test("compliance refresh API enqueues one persisted job without calling SHEIN", async () => {
  const added = [];
  let reads = 0;
  const service = new WebComplianceSyncService({
    repository: {
      async hasTargets() { return true; },
      async claimSync() {
        return { claimed: true, job: { id: "job-1", jobType: "compliance_sync", state: "queued" } };
      },
      async saveFailure() {},
    },
    queue: {
      async add(name, data, options) { added.push({ name, data, options }); },
    },
    complianceReader: {
      async syncCompliance() { reads += 1; },
    },
  });

  const result = await service.startSync({
    context: { tenantId: "tenant-1", userId: "user-1", role: "operator" },
    storeId: "store-1",
  });

  assert.equal(result.started, true);
  assert.equal(reads, 0);
  assert.equal(added[0].name, "compliance-sync");
  assert.deepEqual(added[0].options, {
    jobId: "job-1",
    attempts: 2,
    backoff: { type: "exponential", delay: 2_000 },
  });
});

test("compliance refresh reports the cooldown returned by the repository", async () => {
  const service = new WebComplianceSyncService({
    repository: {
      async hasTargets() { return true; },
      async claimSync() {
        return {
          claimed: false,
          job: null,
          cooldown: true,
          retryAfterSeconds: 29,
        };
      },
    },
    queue: { async add() { throw new Error("must not enqueue during cooldown"); } },
  });

  const result = await service.startSync({
    context: { tenantId: "tenant-1", userId: "user-1", role: "operator" },
    storeId: "store-1",
  });

  assert.equal(result.started, false);
  assert.deepEqual(result.refreshControl, {
    status: "cooldown",
    retryAfterSeconds: 29,
  });
});

test("compliance refresh refuses to create a job when the store has no persisted SKCs", async () => {
  const added = [];
  const service = new WebComplianceSyncService({
    repository: {
      async hasTargets() { return false; },
      async claimSync() { throw new Error("must not claim an empty sync"); },
    },
    queue: {
      async add(...args) { added.push(args); },
    },
    complianceReader: {},
  });

  await assert.rejects(
    service.startSync({
      context: { tenantId: "tenant-1", userId: "user-1", role: "operator" },
      storeId: "store-1",
    }),
    (error) => {
      assert.equal(error.code, "COMPLIANCE_SYNC_NO_TARGETS");
      assert.equal(error.status, 409);
      return true;
    },
  );
  assert.deepEqual(added, []);
});

test("compliance worker fails instead of succeeding when persisted SKCs disappear", async () => {
  let reads = 0;
  let success = null;
  let failure = null;
  const service = new WebComplianceSyncService({
    repository: {
      async markRunning() { return true; },
      async listTargets() { return []; },
      async prepareItems() {},
      async updateProgress() {},
      async saveSuccess(input) { success = input; },
      async saveFailure(input) { failure = input; },
    },
    complianceReader: {
      async syncCompliance() { reads += 1; },
    },
  });

  await assert.rejects(service.processSyncJob({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    jobId: "job-1",
  }), (error) => error.code === "COMPLIANCE_SYNC_NO_TARGETS");
  assert.equal(reads, 0);
  assert.equal(success, null);
  assert.equal(failure.error.code, "COMPLIANCE_SYNC_NO_TARGETS");
  assert.deepEqual(failure.progress, { total: 0, processed: 0, succeeded: 0, failed: 0 });
});

test("compliance worker persists only rows with complete source coverage", async () => {
  const batches = [];
  let failed = null;
  const service = new WebComplianceSyncService({
    repository: {
      async markRunning() { return true; },
      async listTargets() {
        return [{ id: "skc-id-1", skc_name: "SKC-1" }, { id: "skc-id-2", skc_name: "SKC-2" }];
      },
      async prepareItems() {},
      async saveBatch(input) { batches.push(input); },
      async updateProgress() {},
      async saveSuccess() {},
      async saveFailure(input) { failed = input; },
    },
    complianceReader: {
      async syncCompliance({ onBatch }) {
        await onBatch({
          skcNames: ["SKC-1", "SKC-2"],
          rows: [
            completeRow("SKC-1"),
            { ...completeRow("SKC-2"), sourceCoverage: { requirementsReturned: true, photoRequirementsReturned: false } },
          ],
          diagnostics: [{ traceId: "trace-1" }],
          error: null,
        });
        return { failedSkcNames: [] };
      },
    },
  });

  await assert.rejects(
    service.processSyncJob({
      context: { tenantId: "tenant-1", userId: "user-1" },
      storeId: "store-1",
      jobId: "job-1",
    }),
    (error) => error.code === "COMPLIANCE_SYNC_PARTIAL",
  );

  assert.deepEqual(batches[0].rows.map((row) => row.skc), ["SKC-1"]);
  assert.deepEqual(batches[0].failedSkcNames, ["SKC-2"]);
  assert.equal(failed.progress.succeeded, 1);
  assert.equal(failed.progress.failed, 1);
});

test("compliance worker persists official product attribute snapshots before rules", async () => {
  const savedSnapshots = [];
  const batches = [];
  const service = new WebComplianceSyncService({
    repository: {
      async markRunning() { return true; },
      async listTargets() {
        return [{
          id: "skc-id-1",
          skc_name: "SKC-1",
          spu_name: "SPU-1",
          raw_data: {},
        }];
      },
      async prepareItems() {},
      async saveAttributeSnapshots(input) { savedSnapshots.push(input); },
      async saveBatch(input) { batches.push(input); },
      async updateProgress() {},
      async saveSuccess() {},
      async saveFailure() {},
    },
    complianceReader: {
      async syncProductAttributeSnapshots() {
        return {
          snapshots: [{
            skc: "SKC-1",
            snapshot: {
              attributeSchemaSnapshot: {
                source: "/open-api/goods/query-attribute-template",
              },
              attributeValues: {},
            },
          }],
          failedSkcNames: [],
        };
      },
      async syncCompliance({ onBatch }) {
        await onBatch({
          skcNames: ["SKC-1"],
          rows: [completeRow("SKC-1")],
          diagnostics: [{ traceId: "trace-1" }],
          error: null,
        });
      },
    },
  });

  const result = await service.processSyncJob({
    context: { tenantId: "tenant-1", userId: "user-1" },
    storeId: "store-1",
    jobId: "job-1",
  });

  assert.deepEqual(result, { state: "succeeded", total: 1 });
  assert.equal(savedSnapshots.length, 1);
  assert.equal(savedSnapshots[0].snapshots[0].skc, "SKC-1");
  assert.equal(batches.length, 1);
  assert.deepEqual(batches[0].rows.map((row) => row.skc), ["SKC-1"]);
});

test("attribute snapshot failures remain a warning when compliance rows succeed", async () => {
  let saved = null;
  const service = new WebComplianceSyncService({
    repository: {
      async markRunning() { return true; },
      async listTargets() {
        return [
          { id: "skc-id-1", skc_name: "SKC-1", spu_name: "SPU-1" },
          { id: "skc-id-2", skc_name: "SKC-2", spu_name: "SPU-2" },
        ];
      },
      async prepareItems() {},
      async saveAttributeSnapshots() {},
      async saveBatch() {},
      async updateProgress() {},
      async saveSuccess(input) { saved = input; },
      async saveFailure() { throw new Error("must not fail a complete compliance sync"); },
    },
    complianceReader: {
      async syncProductAttributeSnapshots() {
        return { snapshots: [], failedSkcNames: ["SKC-2"] };
      },
      async syncCompliance({ onBatch }) {
        await onBatch({
          skcNames: ["SKC-1", "SKC-2"],
          rows: [completeRow("SKC-1"), completeRow("SKC-2")],
          diagnostics: [],
          error: null,
        });
      },
    },
  });

  const result = await service.processSyncJob({
    context: { tenantId: "tenant-1" },
    storeId: "store-1",
    jobId: "job-1",
  });
  assert.deepEqual(result, { state: "succeeded", total: 2 });
  assert.deepEqual(saved.progress.attributeSnapshotFailed, ["SKC-2"]);
});

test("compliance batch errors do not send rows to persistence", async () => {
  const batches = [];
  const service = new WebComplianceSyncService({
    repository: {
      async markRunning() { return true; },
      async listTargets() { return [{ id: "skc-id-1", skc_name: "SKC-1" }]; },
      async prepareItems() {},
      async saveBatch(input) { batches.push(input); },
      async updateProgress() {},
      async saveSuccess() {},
      async saveFailure() {},
    },
    complianceReader: {
      async syncCompliance({ onBatch }) {
        await onBatch({
          skcNames: ["SKC-1"],
          rows: [],
          diagnostics: [],
          error: { code: "UPSTREAM_TIMEOUT", message: "timeout" },
        });
        return { failedSkcNames: ["SKC-1"] };
      },
    },
  });

  await assert.rejects(service.processSyncJob({
    context: { tenantId: "tenant-1" },
    storeId: "store-1",
    jobId: "job-1",
  }));
  assert.deepEqual(batches[0].rows, []);
  assert.deepEqual(batches[0].failedSkcNames, ["SKC-1"]);
});

test("compliance requirements are flattened into stable typed records", () => {
  const records = flattenComplianceRequirements(completeRow());
  assert.deepEqual(records.map((record) => [
    record.requirementType,
    record.requirementKey,
    record.status,
    record.required,
  ]), [["certificate", "CE", "待补充", true]]);
});

test("duplicate requirement codes receive deterministic unique keys", () => {
  const row = completeRow();
  row.certificateRequirements.push({ ...row.certificateRequirements[0] });
  assert.deepEqual(
    flattenComplianceRequirements(row).map((record) => record.requirementKey),
    ["CE", "CE:2"],
  );
});
