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
const confirmationValue = "REHEARSE_029_ON_EMPTY_LOCAL_DATABASE";

export function assertDisposableDatabaseUrl(value) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    throw new Error("029 演练只允许一次性本机 PostgreSQL 数据库");
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
    throw new Error("029 演练只允许一次性本机 PostgreSQL 数据库");
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

export async function assertAuditMutationBlocked(action, label) {
  try {
    await action();
  } catch (error) {
    if (/append-only compliance audit/i.test(String(error?.message || ""))) {
      return;
    }
    throw new Error(`${label}意外失败: ${error?.message || error}`, {
      cause: error,
    });
  }
  throw new Error(`${label}没有被数据库拒绝`);
}

function assertEmptyAuditCounts(result, label) {
  const results = Array.isArray(result) ? result : [result];
  const row = results
    .flatMap((item) => item?.rows || [])
    .find((item) => item && "run_count" in item && "review_count" in item);
  if (
    !row ||
    Number(row.run_count) !== 0 ||
    Number(row.review_count) !== 0
  ) {
    throw new Error(`${label}要求两张审计表均为空`);
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
    throw new Error("029 演练数据库不是空库，已停止");
  }
}

async function createThrough028Directory() {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "shein-migrations-through-028-"),
  );
  const filenames = (await fs.readdir(migrationDirectory))
    .filter((filename) => /^\d{3}_[A-Za-z0-9_-]+\.sql$/.test(filename))
    .filter((filename) => filename.slice(0, 3) <= "028");
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

async function probeMutation(client, text, label) {
  await client.query({
    text: "SAVEPOINT audit_mutation_probe",
    queryMode: "simple",
  });
  try {
    await assertAuditMutationBlocked(
      () => client.query({ text, queryMode: "simple" }),
      label,
    );
  } finally {
    await client.query({
      text: "ROLLBACK TO SAVEPOINT audit_mutation_probe",
      queryMode: "simple",
    });
    await client.query({
      text: "RELEASE SAVEPOINT audit_mutation_probe",
      queryMode: "simple",
    });
  }
}

async function verifyAuditMutationGuards(pool) {
  const client = await pool.connect();
  try {
    await client.query({ text: "BEGIN", queryMode: "simple" });
    await client.query({
      text: `
        INSERT INTO tenants (id, name)
        VALUES ('10000000-0000-0000-0000-000000000001', '029 rehearsal');

        INSERT INTO users (id, email, display_name)
        VALUES (
          '10000000-0000-0000-0000-000000000002',
          '029-rehearsal@example.invalid',
          '029 rehearsal'
        );

        INSERT INTO memberships (tenant_id, user_id, role)
        VALUES (
          '10000000-0000-0000-0000-000000000001',
          '10000000-0000-0000-0000-000000000002',
          'owner'
        );

        INSERT INTO stores (id, tenant_id, open_key_id, label)
        VALUES (
          '10000000-0000-0000-0000-000000000003',
          '10000000-0000-0000-0000-000000000001',
          '029-rehearsal-store',
          '029 rehearsal'
        );

        INSERT INTO skcs (id, tenant_id, store_id, skc_name)
        VALUES (
          '10000000-0000-0000-0000-000000000004',
          '10000000-0000-0000-0000-000000000001',
          '10000000-0000-0000-0000-000000000003',
          '029-REHEARSAL-SKC'
        );

        INSERT INTO compliance_drafts (
          id,
          tenant_id,
          store_id,
          skc_name,
          created_by,
          updated_by
        )
        VALUES (
          '10000000-0000-0000-0000-000000000005',
          '10000000-0000-0000-0000-000000000001',
          '10000000-0000-0000-0000-000000000003',
          '029-REHEARSAL-SKC',
          '10000000-0000-0000-0000-000000000002',
          '10000000-0000-0000-0000-000000000002'
        );

        INSERT INTO shein_rule_snapshots (
          id,
          tenant_id,
          store_id,
          rule_type,
          subject_key,
          fingerprint,
          fetched_at,
          expires_at
        )
        VALUES (
          '10000000-0000-0000-0000-000000000006',
          '10000000-0000-0000-0000-000000000001',
          '10000000-0000-0000-0000-000000000003',
          'compliance_requirement',
          '029-REHEARSAL-SKC',
          '029-rule-fingerprint',
          now(),
          now() + interval '1 day'
        );

        INSERT INTO compliance_preflight_runs (
          id,
          tenant_id,
          store_id,
          skc_id,
          skc_name,
          draft_id,
          requirement_rule_snapshot_id,
          input_fingerprint,
          rule_fingerprint,
          media_fingerprint,
          status,
          plan,
          media_assets,
          requested_by
        )
        VALUES (
          '10000000-0000-0000-0000-000000000007',
          '10000000-0000-0000-0000-000000000001',
          '10000000-0000-0000-0000-000000000003',
          '10000000-0000-0000-0000-000000000004',
          '029-REHEARSAL-SKC',
          '10000000-0000-0000-0000-000000000005',
          '10000000-0000-0000-0000-000000000006',
          '029-input-fingerprint',
          '029-rule-fingerprint',
          '029-media-fingerprint',
          'ready',
          '{}'::jsonb,
          '[]'::jsonb,
          '10000000-0000-0000-0000-000000000002'
        );

        INSERT INTO compliance_preflight_reviews (
          id,
          tenant_id,
          store_id,
          skc_id,
          skc_name,
          preflight_run_id,
          reviewed_by,
          reviewer_display_name,
          reviewed_status,
          action_count,
          blocker_count,
          warning_count,
          input_fingerprint,
          rule_fingerprint,
          media_fingerprint
        )
        VALUES (
          '10000000-0000-0000-0000-000000000008',
          '10000000-0000-0000-0000-000000000001',
          '10000000-0000-0000-0000-000000000003',
          '10000000-0000-0000-0000-000000000004',
          '029-REHEARSAL-SKC',
          '10000000-0000-0000-0000-000000000007',
          '10000000-0000-0000-0000-000000000002',
          '029 rehearsal',
          'ready',
          0,
          0,
          0,
          '029-input-fingerprint',
          '029-rule-fingerprint',
          '029-media-fingerprint'
        );
      `,
      queryMode: "simple",
    });

    await probeMutation(
      client,
      `UPDATE compliance_preflight_runs
       SET status = 'blocked'
       WHERE id = '10000000-0000-0000-0000-000000000007'`,
      "dry-run 修改",
    );
    await probeMutation(
      client,
      `DELETE FROM compliance_preflight_runs
       WHERE id = '10000000-0000-0000-0000-000000000007'`,
      "dry-run 删除",
    );
    await probeMutation(
      client,
      "TRUNCATE compliance_preflight_runs, compliance_preflight_reviews",
      "dry-run 清空",
    );
    await probeMutation(
      client,
      `UPDATE compliance_preflight_reviews
       SET reviewed_status = 'blocked'
       WHERE id = '10000000-0000-0000-0000-000000000008'`,
      "审阅修改",
    );
    await probeMutation(
      client,
      `DELETE FROM compliance_preflight_reviews
       WHERE id = '10000000-0000-0000-0000-000000000008'`,
      "审阅删除",
    );
    await probeMutation(
      client,
      "TRUNCATE compliance_preflight_reviews",
      "审阅清空",
    );
    await probeMutation(
      client,
      `DELETE FROM tenants
       WHERE id = '10000000-0000-0000-0000-000000000001'`,
      "外键级联删除",
    );

    const preserved = await client.query({
      text: `SELECT
               (
                 SELECT count(*) = 1
                 FROM compliance_preflight_runs
                 WHERE id = '10000000-0000-0000-0000-000000000007'
                   AND status = 'ready'
               ) AS run_preserved,
               (
                 SELECT count(*) = 1
                 FROM compliance_preflight_reviews
                 WHERE id = '10000000-0000-0000-0000-000000000008'
                   AND reviewed_status = 'ready'
               ) AS review_preserved`,
      queryMode: "simple",
    });
    if (
      preserved.rows[0]?.run_preserved !== true ||
      preserved.rows[0]?.review_preserved !== true
    ) {
      throw new Error("不可变门禁验证后审计样本发生变化");
    }
  } finally {
    await client.query({ text: "ROLLBACK", queryMode: "simple" });
    client.release();
  }
}

export async function runComplianceAuditImmutabilityMigrationRehearsal({
  pool,
  connectionString,
  confirmation,
} = {}) {
  assertDisposableDatabaseUrl(connectionString);
  assertRehearsalConfirmation(confirmation);
  await assertEmptyDatabase(pool);

  const through028Directory = await createThrough028Directory();
  try {
    await runMigrations({ pool, directory: through028Directory });

    const preflight = await pool.query({
      text: await readDeploySql(
        "029_compliance_audit_immutability_preflight.sql",
      ),
      queryMode: "simple",
    });
    assertSuccessfulChecks(preflight, "部署前检查");

    const firstApply = await runMigrations({
      pool,
      directory: migrationDirectory,
    });
    if (!firstApply.includes("029_compliance_audit_immutability.sql")) {
      throw new Error("首次演练没有执行第 029 号迁移");
    }

    const firstVerify = await pool.query({
      text: await readDeploySql(
        "029_compliance_audit_immutability_verify.sql",
      ),
      queryMode: "simple",
    });
    assertSuccessfulChecks(firstVerify, "首次迁移验证");
    assertEmptyAuditCounts(firstVerify, "首次迁移验证");

    await verifyAuditMutationGuards(pool);

    const emptyAfterProbe = await pool.query({
      text: `SELECT
               (SELECT count(*) FROM compliance_preflight_runs) AS run_count,
               (SELECT count(*) FROM compliance_preflight_reviews) AS review_count`,
      queryMode: "simple",
    });
    assertEmptyAuditCounts(emptyAfterProbe, "样本事务回滚验证");

    await pool.query({
      text: await readDeploySql(
        "029_compliance_audit_immutability_rollback_empty.sql",
      ),
      queryMode: "simple",
    });

    const rollbackVerify = await pool.query({
      text: `SELECT
               to_regprocedure(
                 'public.prevent_compliance_audit_mutation()'
               ) IS NULL AS function_removed,
               NOT EXISTS (
                 SELECT 1
                 FROM pg_trigger
                 WHERE tgname IN (
                   'compliance_preflight_runs_immutable_row',
                   'compliance_preflight_runs_immutable_truncate',
                   'compliance_preflight_reviews_immutable_row',
                   'compliance_preflight_reviews_immutable_truncate'
                 )
                   AND NOT tgisinternal
               ) AS triggers_removed,
               NOT EXISTS (
                 SELECT 1 FROM schema_migrations
                 WHERE filename = '029_compliance_audit_immutability.sql'
               ) AS migration_removed`,
      queryMode: "simple",
    });
    if (
      rollbackVerify.rows[0]?.function_removed !== true ||
      rollbackVerify.rows[0]?.triggers_removed !== true ||
      rollbackVerify.rows[0]?.migration_removed !== true
    ) {
      throw new Error("空表回滚验证失败");
    }

    const secondApply = await runMigrations({
      pool,
      directory: migrationDirectory,
    });
    if (!secondApply.includes("029_compliance_audit_immutability.sql")) {
      throw new Error("重新迁移没有执行第 029 号迁移");
    }

    const secondVerify = await pool.query({
      text: await readDeploySql(
        "029_compliance_audit_immutability_verify.sql",
      ),
      queryMode: "simple",
    });
    assertSuccessfulChecks(secondVerify, "重新迁移验证");
    assertEmptyAuditCounts(secondVerify, "重新迁移验证");

    return {
      through028Applied: true,
      firstApply,
      mutationGuardsVerified: true,
      rollbackVerified: true,
      secondApply,
    };
  } finally {
    await fs.rm(through028Directory, { recursive: true, force: true });
  }
}

async function main() {
  const connectionString = process.env.DATABASE_URL || "";
  const confirmation = process.env.SHEIN_MIGRATION_REHEARSAL_CONFIRM || "";
  assertDisposableDatabaseUrl(connectionString);
  assertRehearsalConfirmation(confirmation);
  const pool = createPostgresPool({ connectionString });
  try {
    await runComplianceAuditImmutabilityMigrationRehearsal({
      pool,
      connectionString,
      confirmation,
    });
    console.log("029 非生产迁移演练通过");
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

