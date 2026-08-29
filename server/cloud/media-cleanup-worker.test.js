import assert from "node:assert/strict";
import test from "node:test";
import { MediaCleanupWorker } from "./media-cleanup-worker.js";

test("marks expired creative media for immediate cleanup", async () => {
  const actions = [];
  const repository = {
    async listCandidates() {
      return [
        {
          id: "asset-expired",
          tenant_id: "tenant-1",
          object_key: "expired.jpg",
          purpose: "temporary_upload",
          status: "ready",
          expires_at: "2026-07-30T00:00:00.000Z",
          delete_after: null,
          actual_reference_count: 0,
          active_job_count: 0,
        },
        {
          id: "asset-delete",
          tenant_id: "tenant-1",
          object_key: "delete.jpg",
          purpose: "temporary_upload",
          status: "pending_delete",
          expires_at: "2026-07-20T00:00:00.000Z",
          delete_after: "2026-07-30T00:00:00.000Z",
          actual_reference_count: 0,
          active_job_count: 0,
        },
      ];
    },
    async markPendingDelete(input) {
      actions.push(["pending", input.assetId, input.deleteAfter.toISOString()]);
      return true;
    },
    async markDeleted(input) {
      actions.push(["deleted", input.assetId]);
      return true;
    },
    async claimDelete() {
      return true;
    },
    async releaseDelete() {},
    async restoreProtected() {},
  };
  const storage = {
    async deleteObject({ objectKey }) {
      actions.push(["storage-delete", objectKey]);
    },
  };
  const worker = new MediaCleanupWorker({
    repository,
    storage,
    now: () => new Date("2026-07-31T00:00:00.000Z"),
  });
  const result = await worker.runOnce();

  assert.deepEqual(result, {
    scanned: 2,
    markedPendingDelete: 1,
    deleted: 1,
    restored: 0,
    kept: 0,
    failed: 0,
    markedUploadFailed: 0,
  });
  assert.deepEqual(actions, [
    ["pending", "asset-expired", "2026-07-31T00:00:00.000Z"],
    ["storage-delete", "delete.jpg"],
    ["deleted", "asset-delete"],
  ]);
});

test("restores pending media when a reference or running job appears", async () => {
  const restored = [];
  const worker = new MediaCleanupWorker({
    repository: {
      async listCandidates() {
        return [
          {
            id: "asset-1",
            tenant_id: "tenant-1",
            object_key: "asset-1.jpg",
            purpose: "temporary_upload",
            status: "pending_delete",
            expires_at: "2026-07-20T00:00:00.000Z",
            delete_after: "2026-07-30T00:00:00.000Z",
            actual_reference_count: 1,
            active_job_count: 0,
          },
        ];
      },
      async restoreProtected(input) {
        restored.push(input);
      },
    },
    storage: {
      async deleteObject() {
        throw new Error("protected media must not be deleted");
      },
    },
    now: () => new Date("2026-07-31T00:00:00.000Z"),
  });
  const result = await worker.runOnce();

  assert.equal(result.restored, 1);
  assert.equal(restored[0].assetId, "asset-1");
  assert.equal(restored[0].referenceCount, 1);
});

test("marks stale uploads failed without deleting their object", async () => {
  const marked = [];
  const worker = new MediaCleanupWorker({
    repository: {
      async listCandidates() {
        return [{
          id: "asset-stuck",
          tenant_id: "tenant-1",
          object_key: "stuck.jpg",
          purpose: "compliance_evidence",
          status: "uploading",
          created_at: "2026-07-31T00:00:00.000Z",
          actual_reference_count: 0,
          active_job_count: 0,
        }];
      },
      async markUploadFailed(input) { marked.push(input); return true; },
    },
    storage: {
      async deleteObject() { throw new Error("stale upload must remain retryable"); },
    },
    now: () => new Date("2026-07-31T03:00:00.000Z"),
  });
  const result = await worker.runOnce();
  assert.equal(result.markedUploadFailed, 1);
  assert.deepEqual(marked, [{ assetId: "asset-stuck", tenantId: "tenant-1" }]);
});

test("allows unreferenced stale compliance evidence to expire after its recovery window", async () => {
  const { evaluateMediaCleanup } = await import("./media-lifecycle.js");
  const decision = evaluateMediaCleanup({
    purpose: "compliance_evidence",
    status: "failed",
    metadata: { cleanupError: "stale_upload" },
    expiresAt: "2026-07-30T00:00:00.000Z",
    referenceCount: 0,
    activeJobCount: 0,
  }, new Date("2026-07-31T00:00:00.000Z"));
  assert.equal(decision.action, "mark_pending_delete");
  assert.equal(decision.reason, "expired_unreferenced");
});

test("passes stale-upload metadata through the worker before deleting evidence", async () => {
  const pending = [];
  const worker = new MediaCleanupWorker({
    repository: {
      async listCandidates() {
        return [{
          id: "stale-evidence",
          tenant_id: "tenant-1",
          object_key: "stale.pdf",
          purpose: "compliance_evidence",
          status: "failed",
          expires_at: "2026-07-30T00:00:00.000Z",
          delete_after: null,
          metadata: { cleanupError: "stale_upload" },
          actual_reference_count: 0,
          active_job_count: 0,
        }];
      },
      async markPendingDelete(input) {
        pending.push(input);
        return true;
      },
    },
    storage: {
      async deleteObject() {
        throw new Error("evidence should first enter pending_delete");
      },
    },
    now: () => new Date("2026-07-31T00:00:00.000Z"),
  });

  const result = await worker.runOnce();
  assert.equal(result.markedPendingDelete, 1);
  assert.equal(pending[0].assetId, "stale-evidence");
});
