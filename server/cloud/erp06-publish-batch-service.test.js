import assert from "node:assert/strict";
import test from "node:test";

import {
  Erp06PublishBatchError,
  PostgresErp06PublishBatchRepository,
} from "./erp06-publish-batch-service.js";

const tenantId = "11111111-1111-4111-8111-111111111111";
const storeId = "22222222-2222-4222-8222-222222222222";
const userId = "55555555-5555-4555-8555-555555555555";
const versionOne = "88888888-8888-4888-8888-888888888888";
const versionTwo = "99999999-9999-4999-8999-999999999999";
const batchId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const itemOneId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const itemTwoId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function version(id, index) {
  return {
    id,
    tenant_id: tenantId,
    store_id: storeId,
    catalog_product_id: `product-${index}`,
    source_product_draft_id: `draft-${index}`,
    version_fingerprint: `version-fingerprint-${index}`,
    schema_version: "erp06.v1",
  };
}

class FakeClient {
  constructor() {
    this.calls = [];
    this.committed = false;
    this.rolledBack = false;
    this.batches = [];
    this.items = [];
    this.versions = [version(versionOne, 1), version(versionTwo, 2)];
  }

  async query(input) {
    const sql = typeof input === "string" ? input : input.text;
    this.calls.push({ sql, input });
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
      if (sql === "COMMIT") this.committed = true;
      if (sql === "ROLLBACK") this.rolledBack = true;
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes("FROM publish_batches") && sql.includes("idempotency_key=$3")) {
      const row = this.batches.find((item) => item.idempotency_key === input.values[2]);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (sql.includes("JOIN draft_revisions") && sql.includes("ANY($3::uuid[])")) {
      const ids = input.values[2];
      const rows = ids.map((id) => this.versions.find((item) => item.id === id)).filter(Boolean);
      return { rows, rowCount: rows.length };
    }
    if (sql.includes("INSERT INTO publish_batches")) {
      const row = {
        id: batchId,
        tenant_id: input.values[0],
        store_id: input.values[1],
        name: input.values[2],
        idempotency_key: input.values[3],
        selection_fingerprint: input.values[4],
        source: input.values[5],
        policy_snapshot: JSON.parse(input.values[6]),
        state: "queued",
      };
      this.batches.push(row);
      return { rows: [row], rowCount: 1 };
    }
    if (sql.includes("FROM publish_batch_items") && sql.includes("batch_id=$1")) {
      const rows = this.items.filter((item) => item.batch_id === input.values[0]);
      return { rows, rowCount: rows.length };
    }
    if (sql.includes("INSERT INTO publish_batch_items")) {
      const row = {
        id: this.items.length ? itemTwoId : itemOneId,
        batch_id: input.values[0],
        product_draft_id: input.values[1],
        tenant_id: input.values[2],
        store_id: input.values[3],
        catalog_product_id: input.values[4],
        product_version_id: input.values[5],
        item_key: input.values[6],
        state: "ready",
        handoff_state: "pending",
      };
      this.items.push(row);
      return { rows: [row], rowCount: 1 };
    }
    throw new Error(`unhandled fake SQL: ${sql}`);
  }

  release() {}
}

class FakePool {
  constructor() {
    this.client = new FakeClient();
  }

  async connect() {
    return this.client;
  }
}

const input = {
  tenantId,
  storeId,
  name: "批量发布候选",
  idempotencyKey: "batch-request-1",
  productVersionIds: [versionOne, versionTwo],
  source: "drafts",
  policySnapshot: { eligibleOnly: true },
  userId,
};

test("creates a scoped PublishBatch and Version-bound BatchItems", async () => {
  const pool = new FakePool();
  const result = await new PostgresErp06PublishBatchRepository({ pool }).createPublishBatch(input);

  assert.equal(result.idempotent, false);
  assert.equal(result.batchId, batchId);
  assert.equal(result.itemIds.length, 2);
  assert.equal(result.itemIds[0], itemOneId);
  assert.equal(result.selectionFingerprint.length, 64);
  assert.equal(pool.client.batches[0].source, "drafts");
  assert.deepEqual(pool.client.batches[0].policy_snapshot, { eligibleOnly: true });
  assert.equal(pool.client.items[0].product_version_id, versionOne);
  assert.equal(pool.client.items[1].product_version_id, versionTwo);
  assert.equal(pool.client.committed, true);
});

test("same batch idempotency key returns the same selection without duplicate items", async () => {
  const pool = new FakePool();
  const repository = new PostgresErp06PublishBatchRepository({ pool });
  const first = await repository.createPublishBatch(input);
  const repeat = await repository.createPublishBatch(input);

  assert.equal(repeat.idempotent, true);
  assert.equal(repeat.batchId, first.batchId);
  assert.deepEqual(repeat.itemIds, [itemOneId, itemTwoId]);
  assert.equal(pool.client.batches.length, 1);
  assert.equal(pool.client.items.length, 2);
});

test("same idempotency key cannot reuse a different selection", async () => {
  const pool = new FakePool();
  const repository = new PostgresErp06PublishBatchRepository({ pool });
  await repository.createPublishBatch(input);

  await assert.rejects(
    () => repository.createPublishBatch({ ...input, productVersionIds: [versionOne] }),
    (error) => {
      assert(error instanceof Erp06PublishBatchError);
      assert.equal(error.code, "SELECTION_FINGERPRINT_CONFLICT");
      assert.equal(error.status, 409);
      return true;
    },
  );
  assert.equal(pool.client.items.length, 2);
  assert.equal(pool.client.rolledBack, true);
});

test("rejects duplicate ProductVersion IDs before opening a transaction", async () => {
  const pool = new FakePool();
  await assert.rejects(
    () => new PostgresErp06PublishBatchRepository({ pool }).createPublishBatch({
      ...input,
      productVersionIds: [versionOne, versionOne],
    }),
    (error) => {
      assert(error instanceof Erp06PublishBatchError);
      assert.equal(error.code, "INVALID_BATCH_SELECTION");
      return true;
    },
  );
  assert.equal(pool.client.calls.length, 0);
});
