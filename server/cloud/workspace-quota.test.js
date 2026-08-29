import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWorkspaceQuotaProjection,
  canAddDraft,
  canAddMedia,
} from "./workspace-quota.js";

test("projects independent account and store draft limits", () => {
  const projection = buildWorkspaceQuotaProjection({
    draftUsage: { storeDraftCount: 80, tenantDraftCount: 80 },
    quota: { draftPerStore: 100, draftPerTenant: 200 },
  });

  assert.equal(projection.drafts.storeRemaining, 20);
  assert.equal(projection.drafts.tenantRemaining, 120);
  assert.equal(projection.drafts.blocked, false);
  assert.equal(projection.alerts[0].code, "DRAFT_QUOTA_NEAR_LIMIT");
  assert.equal(canAddDraft(projection), true);
});

test("blocks media by count or bytes before a signed upload is created", () => {
  const projection = buildWorkspaceQuotaProjection({
    mediaUsage: {
      storeAssetCount: 2,
      tenantAssetCount: 2,
      storeBytes: 900,
      tenantBytes: 900,
    },
    quota: {
      mediaAssetsPerStore: 3,
      mediaAssetsPerTenant: 10,
      mediaBytesPerStore: 1_000,
      mediaBytesPerTenant: 10_000,
    },
  });

  assert.equal(canAddMedia(projection, { sizeBytes: 101 }), false);
  assert.equal(projection.media.storeBytesRemaining, 100);
  assert.equal(projection.alerts[0].code, "MEDIA_QUOTA_NEAR_LIMIT");
});

test("reports hard quota errors when a store is full", () => {
  const projection = buildWorkspaceQuotaProjection({
    draftUsage: { storeDraftCount: 3, tenantDraftCount: 3 },
    mediaUsage: { storeAssetCount: 4, tenantAssetCount: 4 },
    quota: {
      draftPerStore: 3,
      draftPerTenant: 10,
      mediaAssetsPerStore: 4,
      mediaAssetsPerTenant: 10,
    },
  });

  assert.equal(projection.drafts.blocked, true);
  assert.equal(projection.media.blocked, true);
  assert.equal(projection.alerts[0].level, "error");
  assert.equal(canAddDraft(projection), false);
  assert.equal(canAddMedia(projection, { sizeBytes: 1 }), false);
});
