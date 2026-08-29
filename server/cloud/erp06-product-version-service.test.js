import assert from "node:assert/strict";
import test from "node:test";

import {
  Erp06ProductVersionError,
  PostgresErp06ProductVersionRepository,
} from "./erp06-product-version-service.js";

const tenantId = "11111111-1111-4111-8111-111111111111";
const storeId = "22222222-2222-4222-8222-222222222222";
const draftId = "33333333-3333-4333-8333-333333333333";
const catalogProductId = "44444444-4444-4444-8444-444444444444";
const userId = "55555555-5555-4555-8555-555555555555";
const skuId = "66666666-6666-4666-8666-666666666666";
const revisionId = "77777777-7777-4777-8777-777777777777";
const versionId = "88888888-8888-4888-8888-888888888888";
const eventId = "99999999-9999-4999-8999-999999999999";

function draft(overrides = {}) {
  return {
    id: draftId,
    tenant_id: tenantId,
    store_id: storeId,
    catalog_product_id: catalogProductId,
    name: "云朵地毯",
    category_id: "3155",
    product_type_id: "991",
    draft_data: {
      title: "云朵地毯",
      skuRows: [{ supplierSku: "RUG-40X60", sizeText: "40×60" }],
    },
    preflight: { passed: true, blockers: [] },
    status: "ready",
    lock_version: 0,
    revision_no: 1,
    schema_version: "erp06.v1",
    editing_status: "ready",
    ...overrides,
  };
}

function catalogProduct() {
  return { id: catalogProductId, tenant_id: tenantId, store_id: storeId };
}

function revision(overrides = {}) {
  return {
    id: revisionId,
    tenant_id: tenantId,
    store_id: storeId,
    product_draft_id: draftId,
    catalog_product_id: catalogProductId,
    revision_no: 1,
    input_fingerprint: "input-fingerprint",
    ...overrides,
  };
}

function version(overrides = {}) {
  return {
    id: versionId,
    tenant_id: tenantId,
    store_id: storeId,
    catalog_product_id: catalogProductId,
    source_draft_revision_id: revisionId,
    version_no: 1,
    version_fingerprint: "version-fingerprint",
    ...overrides,
  };
}

class FakeClient {
  constructor({ failOn = "" } = {}) {
    this.failOn = failOn;
    this.calls = [];
    this.committed = false;
    this.rolledBack = false;
    this.revision = null;
    this.version = null;
    this.events = [];
  }

  async query(input) {
    const sql = typeof input === "string" ? input : input.text;
    this.calls.push({ sql, input });
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
      if (sql === "COMMIT") this.committed = true;
      if (sql === "ROLLBACK") this.rolledBack = true;
      return { rows: [], rowCount: 0 };
    }
    if (this.failOn && sql.includes(this.failOn)) {
      throw new Error(`forced failure: ${this.failOn}`);
    }
    if (sql.includes("FROM product_drafts")) return { rows: [draft()], rowCount: 1 };
    if (sql.includes("FROM catalog_products")) {
      return { rows: [catalogProduct()], rowCount: 1 };
    }
    if (sql.includes("FROM media_assets")) return { rows: [], rowCount: 0 };
    if (sql.includes("FROM draft_revisions")) return { rows: [], rowCount: 0 };
    if (sql.includes("FROM product_versions") && sql.includes("version_fingerprint")) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes("FROM product_versions") && sql.includes("source_draft_revision_id")) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes("INSERT INTO catalog_skus")) {
      return {
        rows: [{
          id: skuId,
          tenant_id: tenantId,
          store_id: storeId,
          catalog_product_id: catalogProductId,
          stable_key: "RUG-40X60",
        }],
        rowCount: 1,
      };
    }
    if (sql.includes("INSERT INTO draft_revisions")) {
      const row = revision({ input_fingerprint: input.values[6] });
      this.revision = row;
      return { rows: [row], rowCount: 1 };
    }
    if (sql.includes("COALESCE(MAX(version_no)")) {
      return { rows: [{ version_no: 1 }], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO product_versions")) {
      const row = version({ version_fingerprint: input.values[6] });
      this.version = row;
      return { rows: [row], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO product_version_skus")) {
      return { rows: [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO product_events")) {
      const row = { id: eventId };
      this.events.push(input.values);
      return { rows: [row], rowCount: 1 };
    }
    throw new Error(`unhandled fake SQL: ${sql}`);
  }

  release() {}
}

class FakePool {
  constructor(options = {}) {
    this.client = new FakeClient(options);
  }

  async connect() {
    return this.client;
  }
}

async function freeze(pool, overrides = {}) {
  const repository = new PostgresErp06ProductVersionRepository({ pool });
  return repository.freezeDraftVersion({
    tenantId,
    storeId,
    draftId,
    expectedLockVersion: 0,
    userId,
    ...overrides,
  });
}

test("freezes a scoped draft into one immutable version without publish side effects", async () => {
  const pool = new FakePool();
  const result = await freeze(pool);

  assert.equal(result.stage, "frozen_not_handed_off");
  assert.equal(result.catalogProductId, catalogProductId);
  assert.equal(result.revisionNo, 1);
  assert.equal(result.versionNo, 1);
  assert.equal(result.skuCount, 1);
  assert.equal(result.mediaCount, 0);
  assert.equal(result.publishAttemptCreated, false);
  assert.equal(result.queueDeliveryCreated, false);
  assert.equal(pool.client.committed, true);
  assert.equal(pool.client.rolledBack, false);
  assert.equal(
    pool.client.calls.some(({ sql }) => sql.includes("INSERT INTO publish_attempts")),
    false,
  );
  assert.equal(
    pool.client.calls.some(({ sql }) => sql.includes("INSERT INTO product_publish_outbox")),
    false,
  );
});

test("stale lockVersion fails closed before any immutable fact is written", async () => {
  const pool = new FakePool();
  await assert.rejects(
    () => freeze(pool, { expectedLockVersion: 1 }),
    (error) => {
      assert(error instanceof Erp06ProductVersionError);
      assert.equal(error.code, "DRAFT_VERSION_CONFLICT");
      assert.equal(error.status, 409);
      return true;
    },
  );
  assert.equal(pool.client.committed, false);
  assert.equal(pool.client.rolledBack, true);
  assert.equal(
    pool.client.calls.some(({ sql }) => sql.includes("INSERT INTO draft_revisions")),
    false,
  );
});

test("cross-tenant or cross-store draft lookup is not treated as a new product", async () => {
  const pool = new FakePool();
  pool.client.query = async function query(input) {
    const sql = typeof input === "string" ? input : input.text;
    this.calls.push({ sql, input });
    if (sql === "BEGIN") return { rows: [], rowCount: 0 };
    if (sql === "ROLLBACK") {
      this.rolledBack = true;
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes("FROM product_drafts")) return { rows: [], rowCount: 0 };
    throw new Error(`unexpected cross-scope SQL: ${sql}`);
  };

  await assert.rejects(
    () => freeze(pool),
    (error) => {
      assert.equal(error.code, "DRAFT_NOT_FOUND");
      assert.equal(error.status, 404);
      return true;
    },
  );
  assert.equal(pool.client.rolledBack, true);
  assert.equal(pool.client.committed, false);
});

test("database failure after revision insertion rolls back the whole freeze", async () => {
  const pool = new FakePool({ failOn: "INSERT INTO product_versions" });
  await assert.rejects(() => freeze(pool), /forced failure/);

  assert.equal(pool.client.committed, false);
  assert.equal(pool.client.rolledBack, true);
  assert.notEqual(pool.client.revision, null);
  assert.equal(pool.client.version, null);
});

test("a draft containing credentials never persists them in version snapshots or event payloads", async () => {
  const pool = new FakePool();
  const originalQuery = pool.client.query.bind(pool.client);
  pool.client.query = async (input) => {
    const sql = typeof input === "string" ? input : input.text;
    if (sql.includes("FROM product_drafts")) {
      const result = await originalQuery(input);
      return { ...result, rows: [draft({
        draft_data: {
          title: "安全快照",
          secretKey: "must-not-persist",
          nested: { access_token: "also-must-not-persist" },
          skuRows: [{ supplierSku: "RUG-40X60" }],
        },
      })] };
    }
    return originalQuery(input);
  };
  // Keep this test focused on the actual SQL parameters generated by the
  // repository, rather than trusting a source-code regex.
  const repository = new PostgresErp06ProductVersionRepository({ pool });
  await repository.freezeDraftVersion({
    tenantId,
    storeId,
    draftId,
    expectedLockVersion: 0,
    userId,
  });
  const versionInsert = pool.client.calls.find(({ sql }) => sql.includes("INSERT INTO product_versions"));
  assert(versionInsert);
  assert.doesNotMatch(String(versionInsert.input.values[9]), /must-not-persist/);
  assert.doesNotMatch(String(versionInsert.input.values[9]), /also-must-not-persist/);
});
