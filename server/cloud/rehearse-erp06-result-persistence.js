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

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const activeMigrationDirectory = path.join(currentDirectory, "migrations");
const draftDirectory = path.join(currentDirectory, "erp06-draft");
const foundationMigrationFilename = "047_erp06_model_foundation.sql";
const resultMigrationFilename = "048_erp06_publish_result_persistence.sql";

export const confirmationValue =
  "REHEARSE_ERP06_RESULT_PERSISTENCE_ON_EMPTY_LOCAL_DATABASE";

function assertRehearsalConfirmation(value) {
  if (value !== confirmationValue) {
    throw new Error(
      `必须设置 SHEIN_ERP06_RESULT_REHEARSAL_CONFIRM=${confirmationValue}`,
    );
  }
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

async function createRehearsalDirectory() {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "shein-erp06-result-persistence-"),
  );
  const activeFilenames = (await fs.readdir(activeMigrationDirectory))
    .filter((filename) => /^\d{3}_[A-Za-z0-9_-]+\.sql$/.test(filename))
    .sort();
  await Promise.all(
    activeFilenames.map((filename) => fs.copyFile(
      path.join(activeMigrationDirectory, filename),
      path.join(directory, filename),
    )),
  );
  await fs.copyFile(
    path.join(draftDirectory, foundationMigrationFilename),
    path.join(directory, foundationMigrationFilename),
  );
  return directory;
}

async function queryDraftSql(pool, filename) {
  return pool.query({
    text: await fs.readFile(path.join(draftDirectory, filename), "utf8"),
    queryMode: "simple",
  });
}

function assertPreflight(result) {
  const row = result.rows[0];
  if (row?.disposable_name !== true || row?.target_columns_absent !== true) {
    throw new Error("ERP-06 048 部署前检查失败");
  }
}

async function assertResultPersistenceRemoved(pool) {
  const result = await pool.query({
    text: `SELECT count(*)::integer AS remaining
           FROM information_schema.columns
           WHERE table_schema='public'
             AND table_name='publish_commands'
             AND column_name IN ('send_started_at', 'result_recorded_at')`,
    queryMode: "simple",
  });
  assert.equal(Number(result.rows[0]?.remaining || 0), 0);
}

export async function runErp06ResultPersistenceRehearsal({
  pool,
  connectionString,
  confirmation,
} = {}) {
  assertDisposableDatabaseUrl(connectionString);
  assertRehearsalConfirmation(confirmation);
  await assertEmptyDatabase(pool);

  const directory = await createRehearsalDirectory();
  try {
    const foundationApplied = await runMigrations({ pool, directory });
    assert(foundationApplied.includes("046_publish_outbox_events.sql"));
    assert(foundationApplied.includes(foundationMigrationFilename));

    assertPreflight(await queryDraftSql(pool, "preflight-048.sql"));
    await fs.copyFile(
      path.join(draftDirectory, resultMigrationFilename),
      path.join(directory, resultMigrationFilename),
    );
    const firstApplied = await runMigrations({ pool, directory });
    assert(firstApplied.includes(resultMigrationFilename));
    assertSuccessfulChecks(
      await queryDraftSql(pool, "verify-048.sql"),
      "ERP-06 048 应用后验证",
    );

    await queryDraftSql(pool, "rollback-048_empty.sql");
    await assertResultPersistenceRemoved(pool);
    await pool.query({
      text: "DELETE FROM schema_migrations WHERE filename=$1",
      values: [resultMigrationFilename],
    });

    const secondApplied = await runMigrations({ pool, directory });
    assert(secondApplied.includes(resultMigrationFilename));
    assertSuccessfulChecks(
      await queryDraftSql(pool, "verify-048.sql"),
      "ERP-06 048 重新应用验证",
    );

    return { foundationApplied, firstApplied, rollbackVerified: true, secondApplied };
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

async function main() {
  const connectionString =
    process.env.SHEIN_ERP06_REHEARSAL_DATABASE_URL || "";
  const confirmation =
    process.env.SHEIN_ERP06_RESULT_REHEARSAL_CONFIRM || "";
  const pool = createPostgresPool({ connectionString });
  try {
    await runErp06ResultPersistenceRehearsal({
      pool,
      connectionString,
      confirmation,
    });
    console.log("ERP-06 048 发布结果持久化非生产演练通过");
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
