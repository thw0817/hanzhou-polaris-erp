import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrations } from "./migrate.js";
import { createPostgresPool } from "./postgres.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const migrationDirectory = path.join(currentDirectory, "migrations");
const deployMigrationDirectory = path.resolve(
  currentDirectory,
  "../../deploy/migrations",
);
const confirmationValue = "REHEARSE_028_ON_EMPTY_LOCAL_DATABASE";

export function assertDisposableDatabaseUrl(value) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    throw new Error("028 演练只允许一次性本机 PostgreSQL 数据库");
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
    throw new Error("028 演练只允许一次性本机 PostgreSQL 数据库");
  }
}

export function assertRehearsalConfirmation(value) {
  if (value !== confirmationValue) {
    throw new Error(
      `必须设置 SHEIN_MIGRATION_REHEARSAL_CONFIRM=${confirmationValue}`,
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

function assertEmptyReviewCount(result, label) {
  const results = Array.isArray(result) ? result : [result];
  const row = results
    .flatMap((item) => item?.rows || [])
    .find((item) => item && "review_count" in item);
  if (!row || Number(row.review_count) !== 0) {
    throw new Error(`${label}要求审阅表为空`);
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
    throw new Error("028 演练数据库不是空库，已停止");
  }
}

async function createThrough027Directory() {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "shein-migrations-through-027-"),
  );
  const filenames = (await fs.readdir(migrationDirectory))
    .filter((filename) => /^\d{3}_[A-Za-z0-9_-]+\.sql$/.test(filename))
    .filter((filename) => filename.slice(0, 3) <= "027");
  await Promise.all(
    filenames.map((filename) =>
      fs.copyFile(
        path.join(migrationDirectory, filename),
        path.join(directory, filename),
      ),
    ),
  );
  return directory;
}

async function readDeploySql(filename) {
  return fs.readFile(path.join(deployMigrationDirectory, filename), "utf8");
}

export async function runComplianceReviewMigrationRehearsal({
  pool,
  connectionString,
  confirmation,
} = {}) {
  assertDisposableDatabaseUrl(connectionString);
  assertRehearsalConfirmation(confirmation);
  await assertEmptyDatabase(pool);

  const through027Directory = await createThrough027Directory();
  try {
    await runMigrations({ pool, directory: through027Directory });

    const preflight = await pool.query({
      text: await readDeploySql(
        "028_compliance_preflight_reviews_preflight.sql",
      ),
      queryMode: "simple",
    });
    assertSuccessfulChecks(preflight, "部署前检查");

    const firstApply = await runMigrations({
      pool,
      directory: migrationDirectory,
    });
    if (!firstApply.includes("028_compliance_preflight_reviews.sql")) {
      throw new Error("首次演练没有执行第 028 号迁移");
    }

    const firstVerify = await pool.query({
      text: await readDeploySql(
        "028_compliance_preflight_reviews_verify.sql",
      ),
      queryMode: "simple",
    });
    assertSuccessfulChecks(firstVerify, "首次迁移验证");
    assertEmptyReviewCount(firstVerify, "首次迁移验证");

    await pool.query({
      text: await readDeploySql(
        "028_compliance_preflight_reviews_rollback_empty.sql",
      ),
      queryMode: "simple",
    });

    const rollbackVerify = await pool.query({
      text: `SELECT
               to_regclass('public.compliance_preflight_reviews') IS NULL
                 AS table_removed,
               NOT EXISTS (
                 SELECT 1 FROM schema_migrations
                 WHERE filename = '028_compliance_preflight_reviews.sql'
               ) AS migration_removed`,
      queryMode: "simple",
    });
    if (
      rollbackVerify.rows[0]?.table_removed !== true ||
      rollbackVerify.rows[0]?.migration_removed !== true
    ) {
      throw new Error("空表回滚验证失败");
    }

    const secondApply = await runMigrations({
      pool,
      directory: migrationDirectory,
    });
    if (!secondApply.includes("028_compliance_preflight_reviews.sql")) {
      throw new Error("重新迁移没有执行第 028 号迁移");
    }

    const secondVerify = await pool.query({
      text: await readDeploySql(
        "028_compliance_preflight_reviews_verify.sql",
      ),
      queryMode: "simple",
    });
    assertSuccessfulChecks(secondVerify, "重新迁移验证");
    assertEmptyReviewCount(secondVerify, "重新迁移验证");

    return {
      through027Applied: true,
      firstApply,
      rollbackVerified: true,
      secondApply,
    };
  } finally {
    await fs.rm(through027Directory, { recursive: true, force: true });
  }
}

async function main() {
  const connectionString = process.env.DATABASE_URL || "";
  const confirmation = process.env.SHEIN_MIGRATION_REHEARSAL_CONFIRM || "";
  assertDisposableDatabaseUrl(connectionString);
  assertRehearsalConfirmation(confirmation);
  const pool = createPostgresPool({ connectionString });
  try {
    await runComplianceReviewMigrationRehearsal({
      pool,
      connectionString,
      confirmation,
    });
    console.log("028 非生产迁移演练通过");
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
