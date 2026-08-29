import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrations } from "./migrate.js";
import { createPostgresPool } from "./postgres.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const activeMigrationDirectory = path.join(currentDirectory, "migrations");
const draftDirectory = path.join(currentDirectory, "erp06-draft");
const draftMigrationFilename = "047_erp06_model_foundation.sql";
export const confirmationValue =
  "REHEARSE_ERP06_MODEL_FOUNDATION_ON_EMPTY_LOCAL_DATABASE";

export function assertDisposableDatabaseUrl(value) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    throw new Error("ERP-06 演练只允许一次性本机 PostgreSQL 数据库");
  }
  const hostname = url.hostname.toLowerCase();
  const databaseName = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  const localHost = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(hostname);
  const disposableName =
    /(?:^|[-_])(test|rehearsal|scratch)(?:$|[-_])/i.test(databaseName);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !localHost ||
    !databaseName ||
    !disposableName
  ) {
    throw new Error("ERP-06 演练只允许一次性本机 PostgreSQL 数据库");
  }
}

export function assertRehearsalConfirmation(value) {
  if (value !== confirmationValue) {
    throw new Error(
      `必须设置 SHEIN_ERP06_REHEARSAL_CONFIRM=${confirmationValue}`,
    );
  }
}

export function assertSuccessfulChecks(result, label) {
  const results = Array.isArray(result) ? result : [result];
  const checks = results
    .flatMap((item) => item?.rows || [])
    .filter((row) => row && "check_name" in row);
  if (!checks.length) {
    throw new Error(`${label}没有返回检查结果`);
  }
  const failed = checks
    .filter((row) => row.passed !== true)
    .map((row) => row.check_name);
  if (failed.length) {
    throw new Error(`${label}失败: ${failed.join(", ")}`);
  }
}

async function assertEmptyDatabase(pool) {
  const result = await pool.query({
    text: `SELECT count(*)::integer AS user_table_count
           FROM pg_tables
           WHERE schemaname = 'public'`,
    queryMode: "simple",
  });
  if (Number(result.rows[0]?.user_table_count || 0) !== 0) {
    throw new Error("ERP-06 演练数据库不是空库，已停止");
  }
}

async function createRehearsalDirectory() {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "shein-erp06-foundation-")
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

async function addDraftMigration(directory) {
  await fs.copyFile(
    path.join(draftDirectory, draftMigrationFilename),
    path.join(directory, draftMigrationFilename),
  );
}

async function readDraftSql(filename) {
  return fs.readFile(path.join(draftDirectory, filename), "utf8");
}

async function queryDraftSql(pool, filename) {
  return pool.query({ text: await readDraftSql(filename), queryMode: "simple" });
}

async function expectFailure(client, text, values, expectedMessage) {
  await client.query("SAVEPOINT erp06_failure_case");
  try {
    await client.query(text, values);
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT erp06_failure_case");
    assert.match(String(error.message), expectedMessage);
    return;
  }
  await client.query("ROLLBACK TO SAVEPOINT erp06_failure_case");
  throw new Error(`失败回归没有失败: ${expectedMessage}`);
}

async function runFailureRegressionChecks(pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const tenantA = (
      await client.query(
        "INSERT INTO tenants (name) VALUES ($1) RETURNING id",
        ["ERP06 rehearsal tenant A"],
      )
    ).rows[0].id;
    const tenantB = (
      await client.query(
        "INSERT INTO tenants (name) VALUES ($1) RETURNING id",
        ["ERP06 rehearsal tenant B"],
      )
    ).rows[0].id;
    const userId = (
      await client.query(
        "INSERT INTO users (email, display_name) VALUES ($1, $2) RETURNING id",
        ["erp06-rehearsal@example.invalid", "ERP06 rehearsal"],
      )
    ).rows[0].id;
    const storeA = (
      await client.query(
        `INSERT INTO stores (tenant_id, open_key_id, label)
         VALUES ($1, $2, $3) RETURNING id`,
        [tenantA, "erp06-rehearsal-store-a", "ERP06 A"],
      )
    ).rows[0].id;
    const storeB = (
      await client.query(
        `INSERT INTO stores (tenant_id, open_key_id, label)
         VALUES ($1, $2, $3) RETURNING id`,
        [tenantB, "erp06-rehearsal-store-b", "ERP06 B"],
      )
    ).rows[0].id;

    const catalogProduct = (
      await client.query(
        `INSERT INTO catalog_products
           (tenant_id, store_id, stable_key, title, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [tenantA, storeA, "erp06-product-a", "ERP06 product A", userId],
      )
    ).rows[0].id;
    const catalogSku = (
      await client.query(
        `INSERT INTO catalog_skus
           (tenant_id, store_id, catalog_product_id, stable_key, size_label)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [tenantA, storeA, catalogProduct, "erp06-sku-a", "60x90"],
      )
    ).rows[0].id;
    const draft = (
      await client.query(
        `INSERT INTO product_drafts
           (tenant_id, store_id, catalog_product_id, name, draft_data, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $6)
         RETURNING id`,
        [
          tenantA,
          storeA,
          catalogProduct,
          "ERP06 draft A",
          JSON.stringify({ title: "version one" }),
          userId,
        ],
      )
    ).rows[0].id;
    const verifiedAsset = (
      await client.query(
        `INSERT INTO media_assets
           (tenant_id, store_id, created_by, provider, bucket, object_key,
            purpose, status, content_type, size_bytes, sha256,
            integrity_state, verified_at, verified_size_bytes,
            verified_sha256, verification_source)
         VALUES ($1, $2, $3, 'cos', 'erp06-rehearsal', $4,
                 'selected_unpublished', 'ready', 'image/png', 12, $5,
                 'verified', now(), 12, $5, 'isolated-head')
         RETURNING id`,
        [tenantA, storeA, userId, "verified/a.png", "hash-a"],
      )
    ).rows[0].id;
    const unverifiedAsset = (
      await client.query(
        `INSERT INTO media_assets
           (tenant_id, store_id, created_by, provider, bucket, object_key,
            purpose, status, content_type, size_bytes, sha256)
         VALUES ($1, $2, $3, 'cos', 'erp06-rehearsal', $4,
                 'selected_unpublished', 'ready', 'image/png', 12, $5)
         RETURNING id`,
        [tenantA, storeA, userId, "unknown/a.png", "hash-unknown"],
      )
    ).rows[0].id;

    const revision = (
      await client.query(
        `INSERT INTO draft_revisions
           (tenant_id, store_id, product_draft_id, catalog_product_id,
            revision_no, schema_version, input_fingerprint,
            draft_snapshot, preflight_snapshot, created_by)
         VALUES ($1, $2, $3, $4, 1, 'erp06.v1', 'draft-hash-a',
                 $5::jsonb, '{}'::jsonb, $6)
         RETURNING id`,
        [
          tenantA,
          storeA,
          draft,
          catalogProduct,
          JSON.stringify({ title: "version one" }),
          userId,
        ],
      )
    ).rows[0].id;
    const version = (
      await client.query(
        `INSERT INTO product_versions
           (tenant_id, store_id, catalog_product_id, source_draft_revision_id,
            version_no, schema_version, version_fingerprint,
            product_snapshot, sku_snapshot, media_snapshot, created_by)
         VALUES ($1, $2, $3, $4, 1, 'erp06.v1', 'version-hash-a',
                 $5::jsonb, $6::jsonb, $7::jsonb, $8)
         RETURNING id`,
        [
          tenantA,
          storeA,
          catalogProduct,
          revision,
          JSON.stringify({ title: "version one" }),
          JSON.stringify({ size: "60x90" }),
          JSON.stringify({ main: "hash-a" }),
          userId,
        ],
      )
    ).rows[0].id;

    await expectFailure(
      client,
      `INSERT INTO product_version_media
         (tenant_id, store_id, product_version_id, asset_id, role,
          content_sha256, content_size_bytes, source_fingerprint)
       VALUES ($1, $2, $3, $4, 'main', 'hash-unknown', 12, 'media-unknown')`,
      [tenantA, storeA, version, unverifiedAsset],
      /ERP06_MEDIA_NOT_VERIFIED_OR_OUT_OF_SCOPE/,
    );
    await expectFailure(
      client,
      `INSERT INTO product_version_media
         (tenant_id, store_id, product_version_id, asset_id, role,
          content_sha256, content_size_bytes, source_fingerprint)
       VALUES ($1, $2, $3, $4, 'main', 'wrong-hash', 12, 'media-wrong-hash')`,
      [tenantA, storeA, version, verifiedAsset],
      /ERP06_MEDIA_NOT_VERIFIED_OR_OUT_OF_SCOPE/,
    );
    await expectFailure(
      client,
      `INSERT INTO product_version_media
         (tenant_id, store_id, product_version_id, asset_id, role,
          content_sha256, content_size_bytes, source_fingerprint)
       VALUES ($1, $2, $3, $4, 'main', 'hash-a', 13, 'media-wrong-size')`,
      [tenantA, storeA, version, verifiedAsset],
      /ERP06_MEDIA_NOT_VERIFIED_OR_OUT_OF_SCOPE/,
    );
    await client.query(
      `INSERT INTO product_version_media
         (tenant_id, store_id, product_version_id, asset_id, role,
          content_sha256, content_size_bytes, source_fingerprint)
       VALUES ($1, $2, $3, $4, 'main', 'hash-a', 12, 'media-a')`,
      [tenantA, storeA, version, verifiedAsset],
    );
    await expectFailure(
      client,
      `INSERT INTO product_version_media
         (tenant_id, store_id, product_version_id, asset_id, role,
          content_sha256, content_size_bytes, source_fingerprint)
       VALUES ($1, $2, $3, $4, 'main', 'hash-a', 12, 'media-a')`,
      [tenantA, storeA, version, verifiedAsset],
      /duplicate key|product_version_media/,
    );

    await client.query(
      "UPDATE product_drafts SET draft_data = $1::jsonb WHERE id = $2",
      [JSON.stringify({ title: "draft changed after handoff" }), draft],
    );
    const frozenVersion = await client.query(
      "SELECT product_snapshot FROM product_versions WHERE id = $1",
      [version],
    );
    assert.deepEqual(frozenVersion.rows[0].product_snapshot, {
      title: "version one",
    });
    await expectFailure(
      client,
      "UPDATE product_versions SET product_snapshot = '{}'::jsonb WHERE id = $1",
      [version],
      /ERP06_IMMUTABLE_FACT_UPDATE_BLOCKED/,
    );

    const attemptUnknown = (
      await client.query(
        `INSERT INTO publish_attempts
           (tenant_id, store_id, product_version_id, attempt_no,
            request_key, state, result_unknown_at, created_by)
         VALUES ($1, $2, $3, 1, 'erp06-attempt-unknown',
                 'result_unknown', now(), $4)
         RETURNING id`,
        [tenantA, storeA, version, userId],
      )
    ).rows[0].id;
    await expectFailure(
      client,
      `INSERT INTO publish_commands
         (tenant_id, store_id, publish_attempt_id, request_key,
          command_fingerprint, state)
       VALUES ($1, $2, $3, 'erp06-command-blocked', 'command-blocked', 'queued')`,
      [tenantA, storeA, attemptUnknown],
      /ERP06_RESULT_UNKNOWN_COMMAND_BLOCKED/,
    );
    await expectFailure(
      client,
      "UPDATE publish_attempts SET state = 'dispatched' WHERE id = $1",
      [attemptUnknown],
      /ERP06_RESULT_UNKNOWN_RESEND_BLOCKED/,
    );

    const draftCorrection = (
      await client.query(
        `INSERT INTO product_drafts
           (tenant_id, store_id, catalog_product_id, base_version_id,
            name, draft_data, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $7)
         RETURNING id`,
        [
          tenantA,
          storeA,
          catalogProduct,
          version,
          "ERP06 correction draft",
          JSON.stringify({ title: "corrected" }),
          userId,
        ],
      )
    ).rows[0].id;
    const revisionCorrection = (
      await client.query(
        `INSERT INTO draft_revisions
           (tenant_id, store_id, product_draft_id, catalog_product_id,
            revision_no, schema_version, input_fingerprint,
            draft_snapshot, created_by)
         VALUES ($1, $2, $3, $4, 1, 'erp06.v1', 'draft-hash-correction',
                 $5::jsonb, $6)
         RETURNING id`,
        [
          tenantA,
          storeA,
          draftCorrection,
          catalogProduct,
          JSON.stringify({ title: "corrected" }),
          userId,
        ],
      )
    ).rows[0].id;
    const versionCorrection = (
      await client.query(
        `INSERT INTO product_versions
           (tenant_id, store_id, catalog_product_id, source_draft_revision_id,
            version_no, schema_version, version_fingerprint,
            product_snapshot, created_by)
         VALUES ($1, $2, $3, $4, 2, 'erp06.v1', 'version-hash-correction',
                 $5::jsonb, $6)
         RETURNING id`,
        [
          tenantA,
          storeA,
          catalogProduct,
          revisionCorrection,
          JSON.stringify({ title: "corrected" }),
          userId,
        ],
      )
    ).rows[0].id;
    const attemptCorrection = (
      await client.query(
        `INSERT INTO publish_attempts
           (tenant_id, store_id, product_version_id, attempt_no,
            request_key, reason, supersedes_attempt_id, created_by)
         VALUES ($1, $2, $3, 1, 'erp06-attempt-correction',
                 '用户批准修正并重发', $4, $5)
         RETURNING id`,
        [tenantA, storeA, versionCorrection, attemptUnknown, userId],
      )
    ).rows[0].id;
    assert.notEqual(versionCorrection, version);
    assert.notEqual(attemptCorrection, attemptUnknown);
    await client.query(
      `INSERT INTO publish_commands
         (tenant_id, store_id, publish_attempt_id, request_key,
          command_fingerprint, state)
       VALUES ($1, $2, $3, 'erp06-command-correction', 'command-correction', 'queued')`,
      [tenantA, storeA, attemptCorrection],
    );
    await expectFailure(
      client,
      `INSERT INTO publish_commands
         (tenant_id, store_id, publish_attempt_id, request_key,
          command_fingerprint, state)
       VALUES ($1, $2, $3, 'erp06-command-correction', 'command-correction', 'queued')`,
      [tenantA, storeA, attemptCorrection],
      /duplicate key|publish_commands/,
    );

    await expectFailure(
      client,
      `INSERT INTO product_versions
         (tenant_id, store_id, catalog_product_id, source_draft_revision_id,
          version_no, schema_version, version_fingerprint)
       VALUES ($1, $2, $3, $4, 99, 'erp06.v1', 'cross-tenant-version')`,
      [tenantB, storeB, catalogProduct, revision],
      /foreign key|product_versions/,
    );

    const event = (
      await client.query(
        `INSERT INTO product_events
           (tenant_id, store_id, aggregate_type, aggregate_id,
            event_type, schema_version, event_version, occurred_at,
            producer, dedupe_key, payload_sha256, actor_id)
         VALUES ($1, $2, 'product_version', $3, 'product_version_created',
                 'erp06.v1', 1, now(), 'erp06-rehearsal',
                 'erp06-event-1', 'event-hash-1', $4)
         RETURNING id`,
        [tenantA, storeA, version, userId],
      )
    ).rows[0].id;
    await expectFailure(
      client,
      "UPDATE product_events SET event_type = 'tampered' WHERE id = $1",
      [event],
      /ERP06_IMMUTABLE_FACT_UPDATE_BLOCKED/,
    );
    await expectFailure(
      client,
      "DELETE FROM product_events WHERE id = $1",
      [event],
      /ERP06_IMMUTABLE_FACT_DELETE_BLOCKED/,
    );

    await expectFailure(
      client,
      `INSERT INTO platform_product_links
         (tenant_id, store_id, catalog_product_id, product_version_id,
          platform, object_type, platform_id, evidence_source,
          evidence_ref, evidence_fingerprint)
       VALUES ($1, $2, $3, $4, 'shein', 'spu', 'local-only',
               'local_receipt', 'no-official-evidence', 'bad-evidence')`,
      [tenantA, storeA, catalogProduct, version],
      /violates check constraint|platform_product_links/,
    );

    const legacyRead = await client.query(
      "SELECT status, draft_data FROM product_drafts WHERE id = $1",
      [draft],
    );
    assert.equal(legacyRead.rows[0].status, "draft");
    assert.deepEqual(legacyRead.rows[0].draft_data, {
      title: "draft changed after handoff",
    });

    await client.query("ROLLBACK");
    return {
      verifiedAssetRejectedWhenUnverified: true,
      productVersionStayedFrozenAfterDraftEdit: true,
      resultUnknownResendRejected: true,
      correctionCreatedNewVersionAndAttempt: true,
      crossTenantReferenceRejected: true,
      immutableEventMutationRejected: true,
      nonOfficialLinkRejected: true,
      legacyReadPathStillAvailable: true,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function assertTargetsRemoved(pool) {
  const result = await pool.query({
    text: `SELECT count(*)::integer AS remaining
           FROM pg_class
           WHERE relnamespace = 'public'::regnamespace
             AND relname IN (
               'catalog_products', 'catalog_skus', 'draft_revisions',
               'product_versions', 'product_version_skus', 'product_version_media',
               'publish_attempts', 'publish_commands', 'official_event_inbox',
               'product_publish_receipts', 'platform_product_links', 'product_events',
               'product_publish_outbox'
             )`,
    queryMode: "simple",
  });
  if (Number(result.rows[0]?.remaining || 0) !== 0) {
    throw new Error("ERP-06 空库回滚后仍有目标表");
  }
}

export async function runErp06ModelFoundationRehearsal({
  pool,
  connectionString,
  confirmation,
} = {}) {
  assertDisposableDatabaseUrl(connectionString);
  assertRehearsalConfirmation(confirmation);
  await assertEmptyDatabase(pool);

  const rehearsalDirectory = await createRehearsalDirectory();
  try {
    const activeApplied = await runMigrations({
      pool,
      directory: rehearsalDirectory,
    });
    if (!activeApplied.includes("046_publish_outbox_events.sql")) {
      throw new Error("ERP-06 演练没有完整应用现有 001–046 迁移");
    }

    const preflight = await queryDraftSql(pool, "preflight.sql");
    assertSuccessfulChecks(preflight, "ERP-06 部署前检查");

    await addDraftMigration(rehearsalDirectory);
    const firstApplied = await runMigrations({
      pool,
      directory: rehearsalDirectory,
    });
    if (!firstApplied.includes(draftMigrationFilename)) {
      throw new Error("ERP-06 演练没有应用 additive 草案");
    }

    const failureRegression = await runFailureRegressionChecks(pool);
    const appliedVerify = await queryDraftSql(pool, "verify.sql");
    assertSuccessfulChecks(appliedVerify, "ERP-06 应用后验证");

    await queryDraftSql(pool, "rollback_empty.sql");
    await assertTargetsRemoved(pool);

    const secondApplied = await runMigrations({
      pool,
      directory: rehearsalDirectory,
    });
    if (!secondApplied.includes(draftMigrationFilename)) {
      throw new Error("ERP-06 回滚后重新应用失败");
    }
    const secondVerify = await queryDraftSql(pool, "verify.sql");
    assertSuccessfulChecks(secondVerify, "ERP-06 重新应用验证");

    return {
      activeMigrationsApplied: activeApplied,
      firstApplied,
      failureRegression,
      rollbackVerified: true,
      secondApplied,
    };
  } finally {
    await fs.rm(rehearsalDirectory, { recursive: true, force: true });
  }
}

async function main() {
  const connectionString =
    process.env.SHEIN_ERP06_REHEARSAL_DATABASE_URL || "";
  const confirmation = process.env.SHEIN_ERP06_REHEARSAL_CONFIRM || "";
  assertDisposableDatabaseUrl(connectionString);
  assertRehearsalConfirmation(confirmation);
  const pool = createPostgresPool({ connectionString });
  try {
    await runErp06ModelFoundationRehearsal({
      pool,
      connectionString,
      confirmation,
    });
    console.log("ERP-06 additive model foundation 非生产演练通过");
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
