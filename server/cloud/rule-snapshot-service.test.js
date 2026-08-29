import assert from "node:assert/strict";
import test from "node:test";
import {
  createRuleFingerprint,
  PostgresRuleSnapshotRepository,
} from "./rule-snapshot-service.js";

test("rule snapshot reads are scoped by tenant, store and the complete rule key", async () => {
  let query = null;
  const repository = new PostgresRuleSnapshotRepository({
    pool: {
      async query(input) {
        query = input;
        return { rows: [{ payload: { data: [] }, source_trace_id: "trace-1" }] };
      },
    },
  });

  const result = await repository.getFresh({
    tenantId: "tenant-1",
    storeId: "store-1",
    ruleType: "attribute_template",
    categoryId: "3155",
    productTypeId: "991",
    subjectKey: "",
    now: new Date("2026-08-04T12:00:00.000Z"),
  });

  assert.equal(result.source_trace_id, "trace-1");
  assert.match(query.text, /tenant_id = \$1\s+AND store_id = \$2/);
  assert.match(query.text, /rule_type = \$3/);
  assert.match(query.text, /category_id = \$4/);
  assert.match(query.text, /product_type_id = \$5/);
  assert.match(query.text, /subject_key = \$6/);
  assert.match(query.text, /expires_at > \$7/);
  assert.deepEqual(query.values.slice(0, 6), [
    "tenant-1",
    "store-1",
    "attribute_template",
    "3155",
    "991",
    "",
  ]);
});

test("shared publish-rule reads prefer the requested store and fall back within the tenant", async () => {
  let query = null;
  const repository = new PostgresRuleSnapshotRepository({
    pool: {
      async query(input) {
        query = input;
        return { rows: [{ store_id: "store-1", payload: { data: [] } }] };
      },
    },
  });

  const result = await repository.getFresh({
    tenantId: "tenant-1",
    storeId: "store-2",
    ruleType: "category_tree",
    shareWithinTenant: true,
    now: new Date("2026-08-04T12:00:00.000Z"),
  });

  assert.equal(result.store_id, "store-1");
  assert.match(query.text, /tenant_id = \$1/);
  assert.match(query.text, /store_id = \$2 OR \$8::boolean/);
  assert.match(query.text, /CASE WHEN store_id = \$2 THEN 0 ELSE 1 END/);
  assert.equal(query.values[7], true);
});

test("shared publish-rule coverage lists snapshots across stores in one tenant", async () => {
  let query = null;
  const repository = new PostgresRuleSnapshotRepository({
    pool: {
      async query(input) {
        query = input;
        return { rows: [{ category_id: "3155", product_type_id: "991" }] };
      },
    },
  });

  const result = await repository.listFresh({
    tenantId: "tenant-1",
    storeId: "store-2",
    ruleType: "publish_standard",
    shareWithinTenant: true,
    now: new Date("2026-08-04T12:00:00.000Z"),
  });

  assert.equal(result.length, 1);
  assert.match(query.text, /store_id = \$2 OR \$5::boolean/);
  assert.equal(query.values[4], true);
});

test("rule snapshot upsert stores a deterministic fingerprint without credentials", async () => {
  let query = null;
  const repository = new PostgresRuleSnapshotRepository({
    pool: {
      async query(input) {
        query = input;
        return { rows: [{ id: "snapshot-1" }], rowCount: 1 };
      },
    },
  });
  const first = createRuleFingerprint({ b: 2, a: { y: 2, x: 1 } });
  const second = createRuleFingerprint({ a: { x: 1, y: 2 }, b: 2 });

  await repository.upsert({
    tenantId: "tenant-1",
    storeId: "store-1",
    ruleType: "category_tree",
    payload: { data: [{ category_id: 3155 }] },
    sourceTraceId: "trace-1",
    fetchedAt: new Date("2026-08-04T12:00:00.000Z"),
    expiresAt: new Date("2026-08-04T18:00:00.000Z"),
  });

  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.match(query.text, /ON CONFLICT \(store_id, rule_type, category_id, product_type_id, subject_key\)/);
  assert.match(query.text, /shein_rule_snapshots\.tenant_id = EXCLUDED\.tenant_id/);
  assert.match(query.text, /authorized_store\.id = \$2/);
  assert.match(query.text, /authorized_store\.tenant_id = \$1/);
  assert.equal(JSON.stringify(query.values).includes("secret"), false);
  assert.equal(query.values[6], createRuleFingerprint({ data: [{ category_id: 3155 }] }));
});
