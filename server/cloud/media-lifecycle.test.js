import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMediaObjectKey,
  calculateMediaExpiry,
  evaluateMediaCleanup,
  MEDIA_DELETE_GRACE_DAYS,
  MEDIA_RETENTION_DAYS,
  MEDIA_UPLOAD_TIMEOUT_MS,
} from "./media-lifecycle.js";

test("assigns deterministic object keys and retention by image purpose", () => {
  const createdAt = new Date("2026-07-31T10:00:00.000Z");
  const key = buildMediaObjectKey({
    tenantId: "tenant-1",
    storeId: "store-1",
    purpose: "generated_unselected",
    assetId: "asset-1",
    extension: ".jpg",
    createdAt,
  });
  const expiresAt = calculateMediaExpiry({
    purpose: "generated_unselected",
    createdAt,
  });

  assert.equal(
    key,
    "tenant-1/store-1/generated_unselected/2026-07-31/asset-1.jpg",
  );
  assert.equal(MEDIA_RETENTION_DAYS.generated_unselected, 3);
  assert.equal(expiresAt.toISOString(), "2026-08-03T10:00:00.000Z");
});

test("protects referenced assets and compliance evidence from cleanup", () => {
  assert.deepEqual(
    evaluateMediaCleanup(
      {
        purpose: "temporary_upload",
        status: "ready",
        referenceCount: 1,
        expiresAt: "2026-07-01T00:00:00.000Z",
      },
      "2026-07-31T00:00:00.000Z",
    ),
    { action: "keep", reason: "referenced", deleteAfter: null },
  );
  assert.deepEqual(
    evaluateMediaCleanup(
      {
        purpose: "compliance_evidence",
        status: "ready",
        referenceCount: 0,
      },
      "2026-07-31T00:00:00.000Z",
    ),
    { action: "keep", reason: "protected_evidence", deleteAfter: null },
  );
});

test("expires legacy reusable creative sources after three days", () => {
  const marked = evaluateMediaCleanup(
    {
      purpose: "reusable_source",
      status: "ready",
      expiresAt: "2026-07-31T00:00:00.000Z",
      referenceCount: 0,
      activeJobCount: 0,
    },
    new Date("2026-08-01T00:00:00.000Z"),
  );
  assert.equal(marked.action, "mark_pending_delete");
  assert.equal(marked.deleteAfter.toISOString(), "2026-08-01T00:00:00.000Z");
});

test("cleans expired creative assets without an extra recovery window", () => {
  const marked = evaluateMediaCleanup(
    {
      purpose: "temporary_upload",
      status: "ready",
      referenceCount: 0,
      expiresAt: "2026-07-30T00:00:00.000Z",
    },
    "2026-07-31T00:00:00.000Z",
  );
  assert.equal(marked.action, "mark_pending_delete");
  assert.equal(MEDIA_DELETE_GRACE_DAYS, 7);
  assert.equal(marked.deleteAfter.toISOString(), "2026-07-31T00:00:00.000Z");

  const deleted = evaluateMediaCleanup(
    {
      purpose: "temporary_upload",
      status: "pending_delete",
      referenceCount: 0,
      deleteAfter: "2026-07-31T00:00:00.000Z",
    },
    "2026-08-08T00:00:00.000Z",
  );
  assert.equal(deleted.action, "delete");
});

test("marks uploads stuck past the upload timeout as retryable failures", () => {
  const decision = evaluateMediaCleanup({
    purpose: "compliance_evidence",
    status: "uploading",
    createdAt: "2026-07-31T00:00:00.000Z",
  }, new Date("2026-07-31T03:00:00.000Z"));
  assert.equal(MEDIA_UPLOAD_TIMEOUT_MS, 2 * 60 * 60 * 1000);
  assert.deepEqual(decision, {
    action: "mark_upload_failed",
    reason: "stale_upload",
    deleteAfter: null,
  });
});
