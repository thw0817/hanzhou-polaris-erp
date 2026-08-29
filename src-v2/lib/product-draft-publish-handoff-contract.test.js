import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPublishBatchHandoff,
  consumePublishBatchHandoff,
} from "./product-draft-publish-handoff-contract.js";

const drafts = [
  { id: "ready-1", storeId: "store-1", status: "ready", name: "可预检1" },
  { id: "blocked-1", storeId: "store-1", status: "blocked", name: "待修正" },
  { id: "ready-other", storeId: "store-2", status: "ready", name: "跨店" },
  { id: "ready-2", storeId: "store-1", status: "ready", name: "可预检2" },
];

test("draft handoff carries only unique ready drafts from the current store", () => {
  const result = buildPublishBatchHandoff({
    drafts,
    selectedIds: ["ready-1", "blocked-1", "ready-other", "ready-1", "missing"],
    storeId: "store-1",
  });

  assert.deepEqual(result.readyDraftIds, ["ready-1"]);
  assert.equal(result.selectedCount, 4);
  assert.equal(result.rejectedCount, 3);
  assert.equal(result.externalWrite, false);
  assert.deepEqual(result.state, {
    source: "product-drafts",
    storeId: "store-1",
    draftIds: ["ready-1"],
  });
});

test("publish center rechecks transferred ids against its own ready draft list", () => {
  const result = consumePublishBatchHandoff({
    state: {
      source: "product-drafts",
      storeId: "store-1",
      draftIds: ["ready-1", "blocked-1", "missing", "ready-2"],
    },
    drafts,
    storeId: "store-1",
  });

  assert.equal(result.accepted, true);
  assert.deepEqual(result.readyDraftIds, ["ready-1", "ready-2"]);
  assert.equal(result.rejectedCount, 2);
  assert.equal(result.externalWrite, false);
});

test("publish center rejects a handoff from another store", () => {
  const result = consumePublishBatchHandoff({
    state: {
      source: "product-drafts",
      storeId: "store-2",
      draftIds: ["ready-other"],
    },
    drafts,
    storeId: "store-1",
  });

  assert.equal(result.accepted, false);
  assert.deepEqual(result.readyDraftIds, []);
  assert.equal(result.reason, "来源店铺与当前店铺不一致，未带入草稿");
});
