import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runMigrations } from "./migrate.js";
import { createPostgresPool } from "./postgres.js";
import {
  assertDisposableDatabaseUrl,
} from "./rehearse-erp06-model-foundation.js";
import {
  Erp06ProductVersionError,
  PostgresErp06ProductVersionRepository,
} from "./erp06-product-version-service.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const activeMigrationDirectory = path.join(currentDirectory, "migrations");
const draftDirectory = path.join(currentDirectory, "erp06-draft");
const confirmationValue =
  "REHEARSE_ERP06_PRODUCT_VERSION_ON_EMPTY_LOCAL_DATABASE";

function assertVersionRehearsalConfirmation(value) {
  if (value !== confirmationValue) {
    throw new Error(
      `必须设置 SHEIN_ERP06_VERSION_REHEARSAL_CONFIRM=${confirmationValue}`,
    );
  }
}

async function createRehearsalDirectory() {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "shein-erp06-version-")
  );
  const activeFilenames = (await fs.readdir(activeMigrationDirectory))
    .filter((filename) => /^\d{3}_[A-Za-z0-9_-]+\.sql$/.test(filename))
    .sort();
  await Promise.all(
    activeFilenames.map((filename) =>
      fs.copyFile(
        path.join(activeMigrationDirectory, filename),
        path.join(directory, filename),
      ),
    ),
  );
  return directory;
}

async function queryFile(pool, filename) {
  return pool.query({
    text: await fs.readFile(path.join(draftDirectory, filename), "utf8"),
    queryMode: "simple",
  });
}

async function assertEmptyDatabase(pool) {
  const result = await pool.query({
    text: `SELECT count(*)::integer AS user_table_count
           FROM pg_tables
           WHERE schemaname='public'`,
    queryMode: "simple",
  });
  assert.equal(Number(result.rows[0]?.user_table_count || 0), 0);
}

async function fixture(pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const tenant = (
      await client.query(
        "INSERT INTO tenants (name) VALUES ($1) RETURNING id",
        ["ERP06 version rehearsal tenant"],
      )
    ).rows[0].id;
    const otherTenant = (
      await client.query(
        "INSERT INTO tenants (name) VALUES ($1) RETURNING id",
        ["ERP06 version rehearsal other tenant"],
      )
    ).rows[0].id;
    const userId = (
      await client.query(
        "INSERT INTO users (email, display_name) VALUES ($1,$2) RETURNING id",
        ["erp06-version-rehearsal@example.invalid", "ERP06 version rehearsal"],
      )
    ).rows[0].id;
    const store = (
      await client.query(
        `INSERT INTO stores (tenant_id, open_key_id, label)
         VALUES ($1,$2,$3) RETURNING id`,
        [tenant, "erp06-version-store", "ERP06 version store"],
      )
    ).rows[0].id;
    const otherStore = (
      await client.query(
        `INSERT INTO stores (tenant_id, open_key_id, label)
         VALUES ($1,$2,$3) RETURNING id`,
        [otherTenant, "erp06-version-other-store", "ERP06 other store"],
      )
    ).rows[0].id;
    const catalogProduct = (
      await client.query(
        `INSERT INTO catalog_products
           (tenant_id, store_id, stable_key, title, created_by)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [tenant, store, "erp06-version-product", "版本演练商品", userId],
      )
    ).rows[0].id;
    const verifiedAsset = (
      await client.query(
        `INSERT INTO media_assets
           (tenant_id, store_id, created_by, provider, bucket, object_key,
            purpose, status, content_type, size_bytes, sha256,
            integrity_state, verified_at, verified_size_bytes,
            verified_sha256, verification_source)
         VALUES ($1,$2,$3,'cos','erp06-version-rehearsal',$4,
                 'selected_unpublished','ready','image/png',12,$5,
                 'verified',now(),12,$5,'isolated-head') RETURNING id`,
        [tenant, store, userId, "version/verified.png", "version-hash-a"],
      )
    ).rows[0].id;
    const unverifiedAsset = (
      await client.query(
        `INSERT INTO media_assets
           (tenant_id, store_id, created_by, provider, bucket, object_key,
            purpose, status, content_type, size_bytes, sha256)
         VALUES ($1,$2,$3,'cos','erp06-version-rehearsal',$4,
                 'selected_unpublished','ready','image/png',12,$5) RETURNING id`,
        [tenant, store, userId, "version/unverified.png", "version-unknown"],
      )
    ).rows[0].id;
    const draft = (
      await client.query(
        `INSERT INTO product_drafts
           (tenant_id, store_id, catalog_product_id, name,
            category_id, product_type_id, draft_data, preflight,
            status, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,'ready',$9,$9)
         RETURNING id`,
        [
          tenant,
          store,
          catalogProduct,
          "版本演练商品",
          "3155",
          "991",
          JSON.stringify({
            title: "版本冻结前标题",
            skuRows: [{ supplierSku: "VERSION-RUG-40X60", sizeText: "40×60" }],
            imageAssets: { main: [{ assetId: verifiedAsset }] },
          }),
          JSON.stringify({ passed: true, blockers: [] }),
          userId,
        ],
      )
    ).rows[0].id;
    const blockedDraft = (
      await client.query(
        `INSERT INTO product_drafts
           (tenant_id, store_id, catalog_product_id, name, draft_data,
            status, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5::jsonb,'ready',$6,$6) RETURNING id`,
        [
          tenant,
          store,
          catalogProduct,
          "未核验素材商品",
          JSON.stringify({ imageAssets: { main: [{ assetId: unverifiedAsset }] } }),
          userId,
        ],
      )
    ).rows[0].id;
    await client.query("COMMIT");
    return {
      tenant,
      otherTenant,
      userId,
      store,
      otherStore,
      catalogProduct,
      verifiedAsset,
      unverifiedAsset,
      draft,
      blockedDraft,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function runVersionFreezeChecks(pool) {
  const ids = await fixture(pool);
  const repository = new PostgresErp06ProductVersionRepository({ pool });
  const input = {
    tenantId: ids.tenant,
    storeId: ids.store,
    draftId: ids.draft,
    expectedLockVersion: 0,
    userId: ids.userId,
  };
  const first = await repository.freezeDraftVersion(input);
  assert.equal(first.idempotent, false);
  assert.equal(first.stage, "frozen_not_handed_off");
  assert.equal(first.skuCount, 1);
  assert.equal(first.mediaCount, 1);
  assert.equal(first.publishAttemptCreated, false);
  assert.equal(first.queueDeliveryCreated, false);

  const repeat = await repository.freezeDraftVersion(input);
  assert.equal(repeat.idempotent, true);
  assert.equal(repeat.productVersionId, first.productVersionId);

  const client = await pool.connect();
  try {
    const frozen = await client.query(
      `SELECT product_snapshot, media_snapshot
       FROM product_versions
       WHERE id=$1 AND tenant_id=$2 AND store_id=$3`,
      [first.productVersionId, ids.tenant, ids.store],
    );
    assert.deepEqual(frozen.rows[0].product_snapshot.data.title, "版本冻结前标题");
    assert.equal(frozen.rows[0].media_snapshot.refs[0].assetId, ids.verifiedAsset);

    await client.query(
      `UPDATE product_drafts
       SET draft_data='{"title":"修改后的草稿"}'::jsonb
       WHERE id=$1 AND tenant_id=$2 AND store_id=$3`,
      [ids.draft, ids.tenant, ids.store],
    );
    const afterDraftEdit = await client.query(
      "SELECT product_snapshot FROM product_versions WHERE id=$1",
      [first.productVersionId],
    );
    assert.equal(afterDraftEdit.rows[0].product_snapshot.data.title, "版本冻结前标题");

    const facts = await client.query(
      `SELECT
         (SELECT count(*) FROM draft_revisions WHERE tenant_id=$1) AS revisions,
         (SELECT count(*) FROM product_versions WHERE tenant_id=$1) AS versions,
         (SELECT count(*) FROM product_version_media WHERE tenant_id=$1) AS media,
         (SELECT count(*) FROM product_events WHERE tenant_id=$1) AS events,
         (SELECT count(*) FROM publish_attempts WHERE tenant_id=$1) AS attempts,
         (SELECT count(*) FROM publish_commands WHERE tenant_id=$1) AS commands,
         (SELECT count(*) FROM product_publish_outbox WHERE tenant_id=$1) AS outbox`,
      [ids.tenant],
    );
    assert.deepEqual(facts.rows[0], {
      revisions: "1",
      versions: "1",
      media: "1",
      events: "4",
      attempts: "0",
      commands: "0",
      outbox: "0",
    });
  } finally {
    client.release();
  }

  await assert.rejects(
    () => repository.freezeDraftVersion({ ...input, expectedLockVersion: 1 }),
    (error) => {
      assert(error instanceof Erp06ProductVersionError);
      assert.equal(error.code, "DRAFT_VERSION_CONFLICT");
      return true;
    },
  );
  await assert.rejects(
    () => repository.freezeDraftVersion({
      ...input,
      draftId: ids.blockedDraft,
    }),
    (error) => {
      assert(error instanceof Erp06ProductVersionError);
      assert.equal(error.code, "MEDIA_NOT_VERIFIED");
      return true;
    },
  );
  await assert.rejects(
    () => repository.freezeDraftVersion({
      ...input,
      tenantId: ids.otherTenant,
      storeId: ids.otherStore,
    }),
    (error) => {
      assert(error instanceof Erp06ProductVersionError);
      assert.equal(error.code, "DRAFT_NOT_FOUND");
      return true;
    },
  );

  const blockedClient = await pool.connect();
  try {
    const blockedFacts = await blockedClient.query(
      `SELECT count(*) AS count
       FROM draft_revisions
       WHERE tenant_id=$1 AND store_id=$2 AND product_draft_id=$3`,
      [ids.tenant, ids.store, ids.blockedDraft],
    );
    assert.equal(blockedFacts.rows[0].count, "0");
  } finally {
    blockedClient.release();
  }
  return {
    immutableVersionPreserved: true,
    idempotentRepeatReturnedSameVersion: true,
    verifiedMediaAttached: true,
    staleLockBlocked: true,
    unverifiedMediaBlockedWithoutRevision: true,
    crossScopeBlocked: true,
    noPublishSideEffects: true,
  };
}

export async function runErp06ProductVersionRehearsal({
  pool,
  connectionString,
  confirmation,
} = {}) {
  assertDisposableDatabaseUrl(connectionString);
  assertVersionRehearsalConfirmation(confirmation);
  await assertEmptyDatabase(pool);
  const directory = await createRehearsalDirectory();
  try {
    const activeApplied = await runMigrations({ pool, directory });
    assert(activeApplied.includes("046_publish_outbox_events.sql"));
    await queryFile(pool, "preflight.sql");
    await fs.copyFile(
      path.join(draftDirectory, "047_erp06_model_foundation.sql"),
      path.join(directory, "047_erp06_model_foundation.sql"),
    );
    const targetApplied = await runMigrations({ pool, directory });
    assert(targetApplied.includes("047_erp06_model_foundation.sql"));
    return {
      activeApplied,
      targetApplied,
      versionFreeze: await runVersionFreezeChecks(pool),
    };
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

async function main() {
  const connectionString = process.env.SHEIN_ERP06_REHEARSAL_DATABASE_URL || "";
  const confirmation = process.env.SHEIN_ERP06_VERSION_REHEARSAL_CONFIRM || "";
  const pool = createPostgresPool({ connectionString });
  try {
    await runErp06ProductVersionRehearsal({
      pool,
      connectionString,
      confirmation,
    });
    console.log("ERP-06 ProductVersion 非生产演练通过");
  } finally {
    await pool.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
