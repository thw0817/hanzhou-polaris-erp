import assert from "node:assert/strict";
import test from "node:test";
import { WebReviewCenterSnapshotService } from "./review-center-snapshot-service.js";

test("review center snapshot reads the four review-center projections together", async () => {
  const calls = [];
  const service = new WebReviewCenterSnapshotService({
    productDrafts: {
      async list(input) {
        calls.push(["drafts", input]);
        return { drafts: [{ id: "draft-1" }], count: 1 };
      },
    },
    publishBatches: {
      async list(input) {
        calls.push(["batches", input]);
        return {
          batches: [{ id: "batch-1", items: [{ id: "item-1" }] }],
          count: 1,
          publishingEnabled: false,
        };
      },
      async listReadbackStatus(input) {
        calls.push(["readback", input]);
        return {
          batchId: input.batchId,
          items: [{ id: "job-1", draftId: "draft-1" }],
          readOnly: true,
        };
      },
    },
    productReviews: {
      async list(input) {
        calls.push(["reviews", input]);
        return {
          items: [{ reviewKey: "version:v1" }],
          count: 1,
          archivedKeys: [],
          readOnly: true,
          externalWrite: false,
        };
      },
    },
    now: () => new Date("2026-08-28T06:00:00.000Z"),
  });

  const result = await service.get({
    context: { tenantId: "tenant-1" },
    storeId: "store-1",
  });

  assert.equal(result.snapshotVersion, "review-center-snapshot-v1");
  assert.equal(result.storeId, "store-1");
  assert.equal(result.generatedAt, "2026-08-28T06:00:00.000Z");
  assert.equal(result.consistency.mode, "single-control-request");
  assert.equal(result.consistency.partial, false);
  assert.equal(result.consistency.sources.drafts.state, "ready");
  assert.equal(result.consistency.sources.batches.state, "ready");
  assert.equal(result.consistency.sources.readbacks.state, "ready");
  assert.equal(result.consistency.sources.reviews.state, "ready");
  assert.deepEqual(result.drafts.drafts, [{ id: "draft-1" }]);
  assert.deepEqual(result.readbacks.items, [{ id: "job-1", draftId: "draft-1", batchId: "batch-1" }]);
  assert.deepEqual(calls.map(([name]) => name).sort(), ["batches", "drafts", "readback", "reviews"]);
  assert.deepEqual(calls.find(([name]) => name === "readback")[1], {
    context: { tenantId: "tenant-1" },
    storeId: "store-1",
    batchId: "batch-1",
  });
});

test("review center snapshot reports partial source failures without pretending the page is current", async () => {
  const service = new WebReviewCenterSnapshotService({
    productDrafts: { async list() { throw Object.assign(new Error("database offline"), { code: "DB_DOWN" }); } },
    publishBatches: { async list() { return { batches: [], count: 0, publishingEnabled: false }; } },
    productReviews: { async list() { return { items: [], count: 0, archivedKeys: [], readOnly: true, externalWrite: false }; } },
    now: () => new Date("2026-08-28T06:00:00.000Z"),
  });

  const result = await service.get({
    context: { tenantId: "tenant-1" },
    storeId: "store-1",
  });

  assert.equal(result.consistency.partial, true);
  assert.equal(result.consistency.sources.drafts.state, "failed");
  assert.equal(result.consistency.sources.drafts.error.code, "DB_DOWN");
  assert.match(result.consistency.sources.drafts.error.message, /database offline/);
  assert.deepEqual(result.drafts, { drafts: [], count: 0 });
});
