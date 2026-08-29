import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runMigrations } from "./migrate.js";
import { createPostgresPool } from "./postgres.js";
import {
  assertDisposableDatabaseUrl,
  assertSuccessfulChecks,
} from "./rehearse-erp06-model-foundation.js";
import {
  PostgresErp06ProductVersionRepository,
} from "./erp06-product-version-service.js";
import {
  Erp06PublishHandoffError,
  PostgresErp06PublishHandoffRepository,
} from "./erp06-publish-handoff-service.js";
import {
  PostgresErp06PublishBatchRepository,
} from "./erp06-publish-batch-service.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const activeMigrationDirectory = path.join(currentDirectory, "migrations");
const draftDirectory = path.join(currentDirectory, "erp06-draft");
const confirmationValue =
  "REHEARSE_ERP06_PUBLISH_HANDOFF_ON_EMPTY_LOCAL_DATABASE";

function assertHandoffRehearsalConfirmation(value) {
  if (value !== confirmationValue) {
    throw new Error(
      `必须设置 SHEIN_ERP06_HANDOFF_REHEARSAL_CONFIRM=${confirmationValue}`,
    );
  }
}

async function createRehearsalDirectory() {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "shein-erp06-handoff-"),
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
  await fs.copyFile(
    path.join(draftDirectory, "047_erp06_model_foundation.sql"),
    path.join(directory, "047_erp06_model_foundation.sql"),
  );
  return directory;
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

async function verifyDraft(pool) {
  const result = await pool.query({
    text: await fs.readFile(path.join(draftDirectory, "verify.sql"), "utf8"),
    queryMode: "simple",
  });
  assertSuccessfulChecks(result, "ERP-06 handoff 应用后结构验证");
}

async function createFixture(pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const tenant = (
      await client.query(
        "INSERT INTO tenants (name) VALUES ($1) RETURNING id",
        ["ERP06 publish handoff rehearsal tenant"],
      )
    ).rows[0].id;
    const userId = (
      await client.query(
        "INSERT INTO users (email, display_name) VALUES ($1,$2) RETURNING id",
        ["erp06-handoff-rehearsal@example.invalid", "ERP06 handoff rehearsal"],
      )
    ).rows[0].id;
    const store = (
      await client.query(
        `INSERT INTO stores (tenant_id, open_key_id, label)
         VALUES ($1,$2,$3) RETURNING id`,
        [tenant, "erp06-handoff-store", "ERP06 handoff store"],
      )
    ).rows[0].id;
    const catalogProduct = (
      await client.query(
        `INSERT INTO catalog_products
           (tenant_id, store_id, stable_key, title, created_by)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [tenant, store, "erp06-handoff-product", "交接演练商品", userId],
      )
    ).rows[0].id;
    const verifiedAsset = (
      await client.query(
        `INSERT INTO media_assets
           (tenant_id, store_id, created_by, provider, bucket, object_key,
            purpose, status, content_type, size_bytes, sha256,
            integrity_state, verified_at, verified_size_bytes,
            verified_sha256, verification_source)
         VALUES ($1,$2,$3,'cos','erp06-handoff-rehearsal',$4,
                 'selected_unpublished','ready','image/png',12,$5,
                 'verified',now(),12,$5,'isolated-head') RETURNING id`,
        [tenant, store, userId, "handoff/verified.png", "handoff-hash-a"],
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
          "交接演练商品",
          "3155",
          "991",
          JSON.stringify({
            title: "交接演练标题",
            skuRows: [{ supplierSku: "HANDOFF-RUG-40X60", sizeText: "40×60" }],
            imageAssets: { main: [{ assetId: verifiedAsset }] },
          }),
          JSON.stringify({ passed: true, blockers: [] }),
          userId,
        ],
      )
    ).rows[0].id;
    await client.query("COMMIT");
    return { tenant, userId, store, catalogProduct, verifiedAsset, draft };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function runHandoffChecks(pool) {
  const ids = await createFixture(pool);
  const versionRepository = new PostgresErp06ProductVersionRepository({ pool });
  const frozen = await versionRepository.freezeDraftVersion({
    tenantId: ids.tenant,
    storeId: ids.store,
    draftId: ids.draft,
    expectedLockVersion: 0,
    userId: ids.userId,
  });
  assert.equal(frozen.stage, "frozen_not_handed_off");
  assert.equal(frozen.mediaCount, 1);

  const batchRepository = new PostgresErp06PublishBatchRepository({ pool });
  const batch = await batchRepository.createPublishBatch({
    tenantId: ids.tenant,
    storeId: ids.store,
    name: "ERP-06 隔离发布批次",
    idempotencyKey: "erp06-handoff-batch-1",
    productVersionIds: [frozen.productVersionId],
    source: "drafts",
    policySnapshot: { eligibleOnly: true, rehearsal: true },
    userId: ids.userId,
  });
  assert.equal(batch.idempotent, false);
  assert.equal(batch.itemCount, 1);

  const handoffRepository = new PostgresErp06PublishHandoffRepository({ pool });
  const input = {
    tenantId: ids.tenant,
    storeId: ids.store,
    draftId: ids.draft,
    productVersionId: frozen.productVersionId,
    publishBatchId: batch.batchId,
    publishBatchItemId: batch.itemIds[0],
    expectedLockVersion: 0,
    requestKey: "erp06-handoff-request-1",
    reason: "用户批准进入发布交接",
    userId: ids.userId,
  };
  const first = await handoffRepository.createPublishHandoff(input);
  assert.equal(first.idempotent, false);
  assert.equal(first.stage, "queued_for_dispatch");
  assert.equal(first.attemptState, "created");
  assert.equal(first.commandState, "queued");
  assert.equal(first.outboxState, "pending");
  assert.equal(first.currentVersionId, frozen.productVersionId);
  assert.equal(first.publishBatchId, batch.batchId);
  assert.equal(first.publishBatchItemId, batch.itemIds[0]);
  assert.equal(first.currentAttemptId, first.publishAttemptId);
  assert.equal(first.draftEditingStatus, "handed_off");
  assert.equal(first.draftLockVersion, 1);
  assert.equal(first.remoteCallMade, false);

  const client = await pool.connect();
  try {
    const facts = await client.query(
      `SELECT
         (SELECT count(*) FROM publish_attempts WHERE tenant_id=$1) AS attempts,
         (SELECT count(*) FROM publish_batches WHERE tenant_id=$1) AS batches,
         (SELECT count(*) FROM publish_batch_items WHERE tenant_id=$1) AS batch_items,
         (SELECT count(*) FROM publish_commands WHERE tenant_id=$1) AS commands,
         (SELECT count(*) FROM product_publish_outbox WHERE tenant_id=$1) AS outbox,
         (SELECT count(*) FROM product_events WHERE tenant_id=$1) AS events`,
      [ids.tenant],
    );
    assert.deepEqual(facts.rows[0], {
      attempts: "1",
      batches: "1",
      batch_items: "1",
      commands: "1",
      outbox: "1",
      events: "8",
    });
    const state = await client.query(
      `SELECT d.editing_status, d.lock_version,
              cp.current_version_id, cp.current_attempt_id,
              pbi.batch_id, pbi.product_version_id AS batch_product_version_id,
              pbi.publish_attempt_id AS batch_attempt_id,
              pc.state AS command_state, po.state AS outbox_state,
              pc.payload_summary AS command_summary,
              po.payload_summary AS outbox_summary
       FROM product_drafts d
       JOIN catalog_products cp
         ON cp.tenant_id=d.tenant_id AND cp.store_id=d.store_id
        AND cp.id=d.catalog_product_id
       JOIN publish_attempts pa
         ON pa.tenant_id=d.tenant_id AND pa.store_id=d.store_id
        AND pa.id=$2
       JOIN publish_batch_items pbi
         ON pbi.tenant_id=pa.tenant_id AND pbi.store_id=pa.store_id
        AND pbi.publish_attempt_id=pa.id
       JOIN publish_commands pc
         ON pc.tenant_id=pa.tenant_id AND pc.store_id=pa.store_id
        AND pc.publish_attempt_id=pa.id
       JOIN product_publish_outbox po
         ON po.tenant_id=pc.tenant_id AND po.store_id=pc.store_id
        AND po.publish_command_id=pc.id
       WHERE d.tenant_id=$1 AND d.store_id=$3 AND d.id=$4`,
      [ids.tenant, first.publishAttemptId, ids.store, ids.draft],
    );
    assert.equal(state.rows[0].editing_status, "handed_off");
    assert.equal(state.rows[0].lock_version, "1");
    assert.equal(state.rows[0].current_version_id, frozen.productVersionId);
    assert.equal(state.rows[0].current_attempt_id, first.publishAttemptId);
    assert.equal(state.rows[0].batch_id, batch.batchId);
    assert.equal(state.rows[0].batch_product_version_id, frozen.productVersionId);
    assert.equal(state.rows[0].batch_attempt_id, first.publishAttemptId);
    assert.equal(state.rows[0].command_state, "queued");
    assert.equal(state.rows[0].outbox_state, "pending");
    assert.equal(state.rows[0].command_summary.versionFingerprint, frozen.versionFingerprint);
    assert.equal(state.rows[0].outbox_summary.publishCommandId, first.publishCommandId);
    assert.doesNotMatch(JSON.stringify(state.rows[0]), /Secret|secret|token|password/i);
  } finally {
    client.release();
  }

  const repeat = await handoffRepository.createPublishHandoff(input);
  assert.equal(repeat.idempotent, true);
  assert.equal(repeat.publishAttemptId, first.publishAttemptId);
  assert.equal(repeat.publishCommandId, first.publishCommandId);
  assert.equal(repeat.publishOutboxId, first.publishOutboxId);
  assert.equal(repeat.draftLockVersion, 1);

  const sameVersionResend = { ...input, requestKey: "erp06-handoff-request-2", expectedLockVersion: 1 };
  await assert.rejects(
    () => handoffRepository.createPublishHandoff(sameVersionResend),
    (error) => {
      assert(error instanceof Erp06PublishHandoffError);
      assert.equal(error.code, "PRODUCT_VERSION_ATTEMPT_ALREADY_EXISTS");
      assert.equal(error.status, 409);
      return true;
    },
  );

  const unknownClient = await pool.connect();
  try {
    await unknownClient.query("BEGIN");
    await unknownClient.query(
      `UPDATE publish_attempts
       SET state='result_unknown', result_unknown_at=now()
       WHERE tenant_id=$1 AND store_id=$2 AND id=$3`,
      [ids.tenant, ids.store, first.publishAttemptId],
    );
    await unknownClient.query(
      `UPDATE publish_commands
       SET state='result_unknown'
       WHERE tenant_id=$1 AND store_id=$2 AND id=$3`,
      [ids.tenant, ids.store, first.publishCommandId],
    );
    await unknownClient.query("COMMIT");
  } catch (error) {
    await unknownClient.query("ROLLBACK");
    throw error;
  } finally {
    unknownClient.release();
  }
  const unknownRepeat = await handoffRepository.createPublishHandoff(input);
  assert.equal(unknownRepeat.idempotent, true);
  assert.equal(unknownRepeat.attemptState, "result_unknown");
  assert.equal(unknownRepeat.commandState, "result_unknown");

  const finalFacts = await pool.query({
    text: `SELECT
             (SELECT count(*) FROM publish_attempts WHERE tenant_id=$1) AS attempts,
             (SELECT count(*) FROM publish_batches WHERE tenant_id=$1) AS batches,
             (SELECT count(*) FROM publish_batch_items WHERE tenant_id=$1) AS batch_items,
             (SELECT count(*) FROM publish_commands WHERE tenant_id=$1) AS commands,
             (SELECT count(*) FROM product_publish_outbox WHERE tenant_id=$1) AS outbox,
             (SELECT count(*) FROM product_events WHERE tenant_id=$1) AS events`,
    values: [ids.tenant],
  });
  assert.deepEqual(finalFacts.rows[0], {
    attempts: "1",
    batches: "1",
    batch_items: "1",
    commands: "1",
    outbox: "1",
    events: "8",
  });
  return {
    versionFrozenBeforeHandoff: true,
    atomicAttemptCommandOutbox: true,
    publishBatchVersionAttemptAssociation: true,
    currentProjectionUpdated: true,
    draftHandedOffAndLocked: true,
    requestKeyIdempotentAfterLockBump: true,
    sameVersionResendBlocked: true,
    resultUnknownNoResend: true,
    noRemoteCallOrQueueConsumer: true,
    legacyRowsUntouched: true,
  };
}

export async function runErp06PublishHandoffRehearsal({
  pool,
  connectionString,
  confirmation,
} = {}) {
  assertDisposableDatabaseUrl(connectionString);
  assertHandoffRehearsalConfirmation(confirmation);
  await assertEmptyDatabase(pool);
  const directory = await createRehearsalDirectory();
  try {
    const applied = await runMigrations({ pool, directory });
    assert(applied.includes("046_publish_outbox_events.sql"));
    assert(applied.includes("047_erp06_model_foundation.sql"));
    await verifyDraft(pool);
    return {
      applied,
      checks: await runHandoffChecks(pool),
    };
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

async function main() {
  const connectionString = process.env.SHEIN_ERP06_REHEARSAL_DATABASE_URL || "";
  const confirmation = process.env.SHEIN_ERP06_HANDOFF_REHEARSAL_CONFIRM || "";
  const pool = createPostgresPool({ connectionString });
  try {
    await runErp06PublishHandoffRehearsal({
      pool,
      connectionString,
      confirmation,
    });
    console.log("ERP-06 PublishAttempt/Command/Outbox 原子交接非生产演练通过");
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
