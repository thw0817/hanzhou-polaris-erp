import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runMigrations } from "./migrate.js";

test("039商品审核中心状态迁移支持回读持久化和本地归档", async () => {
  const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
  const sql = await fs.readFile(
    path.join(currentDirectory, "migrations/039_product_review_states.sql"),
    "utf8",
  );

  assert.match(sql, /CREATE TABLE IF NOT EXISTS product_review_states/);
  assert.match(sql, /review_key text NOT NULL/);
  assert.match(sql, /failed_reasons jsonb NOT NULL/);
  assert.match(sql, /archived_at timestamptz/);
  assert.match(sql, /UNIQUE \(tenant_id, store_id, review_key\)/);
  assert.doesNotMatch(sql, /DELETE FROM|DROP TABLE/);
});

test("044管理员账户别名迁移不改变用户真实显示名称", async () => {
  const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
  const sql = await fs.readFile(
    path.join(currentDirectory, "migrations/044_user_admin_alias.sql"),
    "utf8",
  );

  assert.match(sql, /ALTER TABLE users/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS admin_label text NOT NULL DEFAULT ''/);
  assert.match(sql, /仅用于管理员视图/);
  assert.doesNotMatch(sql, /DROP TABLE|DELETE FROM/i);
});

test("045发布生命周期查询索引覆盖草稿和任务关联", async () => {
  const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
  const sql = await fs.readFile(
    path.join(currentDirectory, "migrations/045_publish_lifecycle_indexes.sql"),
    "utf8",
  );

  assert.match(sql, /CREATE INDEX IF NOT EXISTS publish_batch_items_product_draft_idx/);
  assert.match(sql, /ON publish_batch_items \(product_draft_id, batch_id\)/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS publish_jobs_product_draft_scope_idx/);
  assert.match(sql, /ON publish_jobs \(tenant_id, store_id, product_draft_id\)/);
  assert.doesNotMatch(sql, /DROP TABLE|DELETE FROM|TRUNCATE/i);
});

test("040运行时保留策略只清理未引用规则快照并回收失效证据", async () => {
  const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
  const sql = await fs.readFile(
    path.join(currentDirectory, "migrations/040_runtime_retention_hardening.sql"),
    "utf8",
  );

  assert.match(sql, /CREATE OR REPLACE FUNCTION prune_shein_rule_snapshots/);
  assert.match(sql, /SECURITY DEFINER/);
  assert.match(sql, /NOT EXISTS[\s\S]*compliance_preflight_runs/);
  assert.match(sql, /REVOKE ALL ON FUNCTION/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION[\s\S]*shein_runtime/);
  assert.match(sql, /UPDATE media_assets/);
  assert.match(sql, /cleanupError.*stale_upload/);
  assert.doesNotMatch(sql, /TRUNCATE|DROP TABLE/i);
});

test("compliance preflight migration creates an append-only audit table", async () => {
  const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
  const sql = await fs.readFile(
    path.join(currentDirectory, "migrations/024_compliance_preflight_runs.sql"),
    "utf8",
  );

  assert.match(sql, /CREATE TABLE IF NOT EXISTS compliance_preflight_runs/);
  assert.match(sql, /requirement_rule_snapshot_id uuid NOT NULL/);
  assert.match(sql, /input_fingerprint text NOT NULL/);
  assert.match(sql, /media_fingerprint text NOT NULL/);
  assert.doesNotMatch(sql, /ON CONFLICT|DO UPDATE/);
});

test("合规预检审阅迁移只创建不可变确认记录", async () => {
  const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
  const sql = await fs.readFile(
    path.join(currentDirectory, "migrations/028_compliance_preflight_reviews.sql"),
    "utf8",
  );

  assert.match(sql, /CREATE TABLE IF NOT EXISTS compliance_preflight_reviews/);
  assert.match(sql, /preflight_run_id uuid NOT NULL/);
  assert.match(sql, /reviewer_display_name text NOT NULL/);
  assert.match(sql, /input_fingerprint text NOT NULL/);
  assert.match(sql, /authoriz|does not authorize/i);
  assert.doesNotMatch(sql, /ON CONFLICT|DO UPDATE|DELETE FROM/);
});

test("028部署预检和验证SQL保持只读", async () => {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../deploy/migrations",
  );
  const preflight = await fs.readFile(
    path.join(root, "028_compliance_preflight_reviews_preflight.sql"),
    "utf8",
  );
  const verify = await fs.readFile(
    path.join(root, "028_compliance_preflight_reviews_verify.sql"),
    "utf8",
  );

  for (const sql of [preflight, verify]) {
    assert.doesNotMatch(
      sql,
      /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE)\b/i,
    );
  }
  assert.match(preflight, /compliance_preflight_runs/);
  assert.match(preflight, /schema_migrations/);
  assert.match(preflight, /028_compliance_preflight_reviews\.sql/);
  assert.match(verify, /compliance_preflight_reviews_run_user_idx/);
  assert.match(verify, /compliance_preflight_reviews_scope_idx/);
});

test("028回滚说明禁止删除已有审阅数据", async () => {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../deploy/migrations",
  );
  const runbook = await fs.readFile(
    path.join(root, "028_compliance_preflight_reviews.md"),
    "utf8",
  );
  const rollback = await fs.readFile(
    path.join(root, "028_compliance_preflight_reviews_rollback_empty.sql"),
    "utf8",
  );
  const guardAt = runbook.indexOf("IF EXISTS (SELECT 1 FROM compliance_preflight_reviews)");
  const dropAt = runbook.indexOf("DROP TABLE compliance_preflight_reviews");
  const rollbackGuardAt = rollback.indexOf(
    "IF EXISTS (SELECT 1 FROM compliance_preflight_reviews)",
  );
  const rollbackDropAt = rollback.indexOf(
    "DROP TABLE compliance_preflight_reviews",
  );

  assert.notEqual(guardAt, -1);
  assert.notEqual(dropAt, -1);
  assert.ok(guardAt < dropAt);
  assert.notEqual(rollbackGuardAt, -1);
  assert.notEqual(rollbackDropAt, -1);
  assert.ok(rollbackGuardAt < rollbackDropAt);
  assert.match(rollback, /LOCK TABLE compliance_preflight_reviews IN ACCESS EXCLUSIVE MODE/);
  assert.match(runbook, /存在任何审阅记录[\s\S]*不得删除表/);
  assert.match(runbook, /只回滚应用版本[\s\S]*保留表和迁移记录/);
  assert.doesNotMatch(runbook, /DROP TABLE[^;\n]*CASCADE/i);
  assert.doesNotMatch(rollback, /\bCASCADE\b/i);
});

test("029迁移在数据库层阻止合规审计记录被修改或删除", async () => {
  const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
  const sql = await fs.readFile(
    path.join(
      currentDirectory,
      "migrations/029_compliance_audit_immutability.sql",
    ),
    "utf8",
  );

  assert.match(sql, /CREATE OR REPLACE FUNCTION prevent_compliance_audit_mutation/);
  assert.match(
    sql,
    /BEFORE UPDATE OR DELETE ON compliance_preflight_runs[\s\S]*FOR EACH ROW/,
  );
  assert.match(
    sql,
    /BEFORE TRUNCATE ON compliance_preflight_runs[\s\S]*FOR EACH STATEMENT/,
  );
  assert.match(
    sql,
    /BEFORE UPDATE OR DELETE ON compliance_preflight_reviews[\s\S]*FOR EACH ROW/,
  );
  assert.match(
    sql,
    /BEFORE TRUNCATE ON compliance_preflight_reviews[\s\S]*FOR EACH STATEMENT/,
  );
  for (const [table, trigger] of [
    [
      "compliance_preflight_runs",
      "compliance_preflight_runs_immutable_row",
    ],
    [
      "compliance_preflight_runs",
      "compliance_preflight_runs_immutable_truncate",
    ],
    [
      "compliance_preflight_reviews",
      "compliance_preflight_reviews_immutable_row",
    ],
    [
      "compliance_preflight_reviews",
      "compliance_preflight_reviews_immutable_truncate",
    ],
  ]) {
    assert.match(
      sql,
      new RegExp(`ALTER TABLE ${table}\\s+ENABLE ALWAYS TRIGGER ${trigger}`),
    );
  }
  assert.match(sql, /RAISE EXCEPTION[\s\S]*append-only compliance audit/i);
  assert.doesNotMatch(sql, /\b(INSERT INTO|UPDATE\s+\w|DELETE FROM|TRUNCATE TABLE)\b/i);
});

test("029部署预检和验证SQL保持只读", async () => {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../deploy/migrations",
  );
  const preflight = await fs.readFile(
    path.join(root, "029_compliance_audit_immutability_preflight.sql"),
    "utf8",
  );
  const verify = await fs.readFile(
    path.join(root, "029_compliance_audit_immutability_verify.sql"),
    "utf8",
  );

  for (const sql of [preflight, verify]) {
    assert.doesNotMatch(
      sql,
      /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE)\b/i,
    );
  }
  assert.match(preflight, /029_compliance_audit_immutability\.sql/);
  assert.match(preflight, /compliance_preflight_runs/);
  assert.match(preflight, /compliance_preflight_reviews/);
  assert.match(verify, /compliance_preflight_runs_immutable_row/);
  assert.match(verify, /compliance_preflight_runs_immutable_truncate/);
  assert.match(verify, /compliance_preflight_reviews_immutable_row/);
  assert.match(verify, /compliance_preflight_reviews_immutable_truncate/);
  assert.match(
    verify,
    /tgfoid\s*=\s*to_regprocedure\('public\.prevent_compliance_audit_mutation\(\)'\)/,
  );
  assert.match(verify, /tgtype\s*=\s*expected\.trigger_type/);
  assert.match(verify, /tgenabled\s*=\s*'A'/);
  assert.doesNotMatch(verify, /tgenabled\s*=\s*'O'/);
  assert.match(verify, /'compliance_preflight_runs_immutable_row',\s*27/);
  assert.match(verify, /'compliance_preflight_runs_immutable_truncate',\s*34/);
  assert.match(
    verify,
    /append-only compliance audit[\s\S]*pg_get_functiondef/,
  );
});

test("029回滚只允许两个审计表均为空时移除不可变门禁", async () => {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../deploy/migrations",
  );
  const runbook = await fs.readFile(
    path.join(root, "029_compliance_audit_immutability.md"),
    "utf8",
  );
  const rollback = await fs.readFile(
    path.join(root, "029_compliance_audit_immutability_rollback_empty.sql"),
    "utf8",
  );
  const runGuardAt = rollback.indexOf(
    "IF EXISTS (SELECT 1 FROM compliance_preflight_runs)",
  );
  const reviewGuardAt = rollback.indexOf(
    "IF EXISTS (SELECT 1 FROM compliance_preflight_reviews)",
  );
  const dropAt = rollback.indexOf(
    "DROP TRIGGER compliance_preflight_runs_immutable_row",
  );

  assert.notEqual(runGuardAt, -1);
  assert.notEqual(reviewGuardAt, -1);
  assert.notEqual(dropAt, -1);
  assert.ok(runGuardAt < dropAt);
  assert.ok(reviewGuardAt < dropAt);
  assert.match(
    rollback,
    /LOCK TABLE compliance_preflight_runs, compliance_preflight_reviews IN ACCESS EXCLUSIVE MODE/,
  );
  assert.match(
    runbook,
    /任一审计表存在记录[\s\S]*不得移除不可变触发器/,
  );
  assert.match(
    runbook,
    /只回滚应用版本[\s\S]*保留第 029 号迁移/,
  );
  assert.doesNotMatch(runbook, /DROP TABLE/i);
  assert.doesNotMatch(rollback, /\bCASCADE\b/i);
});

test("迁移查询和执行全程使用 simple query protocol", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "shein-migrate-"));
  await fs.writeFile(
    path.join(directory, "001_test.sql"),
    "CREATE TABLE migration_protocol_probe (id integer);",
  );
  await fs.writeFile(
    path.join(directory, "._001_test.sql"),
    "this is an AppleDouble resource fork, not SQL",
  );
  await fs.writeFile(
    path.join(directory, ".hidden.sql"),
    "this hidden file must never be executed",
  );

  const poolQueries = [];
  const clientQueries = [];
  const client = {
    async query(config) {
      clientQueries.push(config);
      return { rowCount: 0, rows: [] };
    },
    release() {},
  };
  const pool = {
    async query(config) {
      poolQueries.push(config);
      if (typeof config === "string") {
        return { rowCount: 0, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    },
    async connect() {
      return client;
    },
  };

  try {
    assert.deepEqual(
      await runMigrations({ pool, directory }),
      ["001_test.sql"],
    );

    const lookup = poolQueries.find(
      (query) =>
        typeof query === "object" &&
        query.text.includes("SELECT checksum FROM schema_migrations"),
    );
    assert.equal(lookup.queryMode, "simple");
    assert.equal("values" in lookup, false);
    assert.match(lookup.text, /WHERE filename = '001_test\.sql'/);

    assert.equal(clientQueries.length, 4);
    for (const query of clientQueries) {
      assert.equal(query.queryMode, "simple");
      assert.equal("values" in query, false);
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("合规工作区迁移会在旧表上补列后再创建状态索引", async () => {
  const migrationPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "migrations",
    "008_compliance_workspace.sql",
  );
  const sql = await fs.readFile(migrationPath, "utf8");
  const addStatusAt = sql.indexOf(
    "ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'",
  );
  const createIndexAt = sql.indexOf(
    "CREATE INDEX IF NOT EXISTS compliance_templates_tenant_store_idx",
  );

  assert.notEqual(addStatusAt, -1);
  assert.notEqual(createIndexAt, -1);
  assert.ok(addStatusAt < createIndexAt);
});

test("网页SHEIN授权迁移保留用户归属和成员店铺白名单", async () => {
  const migrationPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "migrations",
    "017_web_shein_authorization.sql",
  );
  const sql = await fs.readFile(migrationPath, "utf8");

  assert.match(sql, /ALTER TABLE stores[\s\S]*authorized_by/);
  assert.match(sql, /ALTER TABLE membership_store_access[\s\S]*granted_by/);
  assert.match(sql, /ALTER TABLE shein_authorization_attempts[\s\S]*user_id/);
  assert.match(sql, /CHECK \(flow_type IN \('device', 'web'\)\)/);
});

test("成员邀请迁移只持久化一次性令牌哈希", async () => {
  const migrationPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "migrations",
    "021_member_invitations.sql",
  );
  const sql = await fs.readFile(migrationPath, "utf8");

  assert.match(sql, /CREATE TABLE IF NOT EXISTS member_invitations/);
  assert.match(sql, /token_hash bytea NOT NULL UNIQUE/);
  assert.match(sql, /CHECK \(role IN \('operator', 'viewer'\)\)/);
  assert.doesNotMatch(sql, /\btoken\s+text\b/i);
});

test("同步任务迁移补充租户店铺历史查询索引", async () => {
  const migrationPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "migrations",
    "022_sync_job_history_index.sql",
  );
  const sql = await fs.readFile(migrationPath, "utf8");

  assert.match(sql, /ON sync_jobs \(tenant_id, store_id, created_at DESC, id DESC\)/);
  assert.doesNotMatch(sql, /ALTER TABLE|DROP /i);
});

test("规则快照迁移使用非空复合键隔离店铺动态规则", async () => {
  const migrationPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "migrations",
    "023_shein_rule_snapshots.sql",
  );
  const sql = await fs.readFile(migrationPath, "utf8");

  assert.match(sql, /CREATE TABLE IF NOT EXISTS shein_rule_snapshots/);
  for (const column of ["category_id", "product_type_id", "subject_key"]) {
    assert.match(sql, new RegExp(`${column} text NOT NULL DEFAULT ''`));
  }
  assert.match(
    sql,
    /UNIQUE \(store_id, rule_type, category_id, product_type_id, subject_key\)/,
  );
  assert.match(sql, /CHECK \(rule_type IN \([\s\S]*'certificate_schema'[\s\S]*\)\)/);
  assert.doesNotMatch(sql, /DROP |TRUNCATE |DELETE FROM/i);
});

test("证书库迁移只扩展规则快照类型约束", async () => {
  const migrationPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "migrations",
    "025_certificate_library_snapshot.sql",
  );
  const sql = await fs.readFile(migrationPath, "utf8");

  assert.match(sql, /ALTER TABLE shein_rule_snapshots/);
  assert.match(sql, /'certificate_library'/);
  assert.match(sql, /ADD CONSTRAINT shein_rule_snapshots_rule_type_check/);
  assert.doesNotMatch(sql, /DROP TABLE|TRUNCATE|DELETE FROM/i);
});

test("代理公司迁移只扩展规则快照类型约束", async () => {
  const migrationPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "migrations",
    "026_agency_library_snapshot.sql",
  );
  const sql = await fs.readFile(migrationPath, "utf8");

  assert.match(sql, /ALTER TABLE shein_rule_snapshots/);
  assert.match(sql, /'certificate_library'/);
  assert.match(sql, /'agency_library'/);
  assert.match(sql, /ADD CONSTRAINT shein_rule_snapshots_rule_type_check/);
  assert.doesNotMatch(sql, /DROP TABLE|TRUNCATE|DELETE FROM/i);
});

test("警示语规则迁移只扩展规则快照类型约束", async () => {
  const migrationPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "migrations",
    "027_warning_rules_snapshot.sql",
  );
  const sql = await fs.readFile(migrationPath, "utf8");

  assert.match(sql, /ALTER TABLE shein_rule_snapshots/);
  assert.match(sql, /'agency_library'/);
  assert.match(sql, /'warning_rules'/);
  assert.match(sql, /ADD CONSTRAINT shein_rule_snapshots_rule_type_check/);
  assert.doesNotMatch(sql, /DROP TABLE|TRUNCATE|DELETE FROM/i);
});

test("030发布执行状态迁移固定真实发布关闭并保存原子领取字段", async () => {
  const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
  const sql = await fs.readFile(
    path.join(currentDirectory, "migrations/030_publish_execution_state.sql"),
    "utf8",
  );
  const preflight = await fs.readFile(
    path.join(
      currentDirectory,
      "../../deploy/migrations/030_publish_execution_state_preflight.sql",
    ),
    "utf8",
  );
  const verify = await fs.readFile(
    path.join(
      currentDirectory,
      "../../deploy/migrations/030_publish_execution_state_verify.sql",
    ),
    "utf8",
  );
  const rollback = await fs.readFile(
    path.join(
      currentDirectory,
      "../../deploy/migrations/030_publish_execution_state_rollback_empty.sql",
    ),
    "utf8",
  );

  assert.match(sql, /CREATE TABLE IF NOT EXISTS publish_execution_runs/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS publish_jobs/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS publish_receipts/);
  assert.match(sql, /publish_execution_runs_execution_enabled_off/);
  assert.match(sql, /publish_execution_runs_authorizes_publishing_off/);
  assert.match(sql, /claim_expires_at timestamptz/);
  assert.match(sql, /result_unknown/);
  assert.match(sql, /UNIQUE \(tenant_id, store_id, request_key\)/);
  assert.doesNotMatch(sql, /publishOrEdit|request_body|image_url/i);

  for (const deploymentSql of [preflight, verify]) {
    assert.doesNotMatch(
      deploymentSql,
      /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE)\b/i,
    );
  }
  assert.match(preflight, /publish_execution_runs/);
  assert.match(verify, /publish_jobs_claimable_idx/);
  assert.match(verify, /publish_execution_runs_authorizes_publishing_off/);
  assert.match(
    rollback,
    /LOCK TABLE publish_receipts, publish_jobs, publish_execution_runs/,
  );
  assert.match(rollback, /EXISTS \(SELECT 1 FROM publish_jobs\)/);
  assert.doesNotMatch(rollback, /\bCASCADE\b/i);
});

test("031标题规则迁移只扩展发布模板类型约束", async () => {
  const migrationPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "migrations",
    "031_title_rule_templates.sql",
  );
  const sql = await fs.readFile(migrationPath, "utf8");

  assert.match(sql, /ALTER TABLE publish_templates/);
  assert.match(sql, /ADD CONSTRAINT publish_templates_template_type_check/);
  assert.match(sql, /'title_rule'/);
  assert.match(sql, /'compliance'/);
  assert.doesNotMatch(sql, /DROP TABLE|TRUNCATE|DELETE FROM|UPDATE publish_templates/i);
});

test("032计价与克重迁移只扩展发布模板类型约束", async () => {
  const migrationPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "migrations",
    "032_commercial_templates.sql",
  );
  const sql = await fs.readFile(migrationPath, "utf8");

  assert.match(sql, /ALTER TABLE publish_templates/);
  assert.match(sql, /ADD CONSTRAINT publish_templates_template_type_check/);
  assert.match(sql, /'commercial'/);
  assert.match(sql, /'compliance'/);
  assert.doesNotMatch(sql, /DROP TABLE|TRUNCATE|DELETE FROM|UPDATE publish_templates/i);
});

test("033发布设置迁移只扩展发布模板类型约束", async () => {
  const migrationPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "migrations",
    "033_publish_settings_templates.sql",
  );
  const sql = await fs.readFile(migrationPath, "utf8");

  assert.match(sql, /ALTER TABLE publish_templates/);
  assert.match(sql, /ADD CONSTRAINT publish_templates_template_type_check/);
  assert.match(sql, /'publish_settings'/);
  assert.match(sql, /'commercial'/);
  assert.doesNotMatch(sql, /DROP TABLE|TRUNCATE|DELETE FROM|UPDATE publish_templates/i);
});

test("034发布执行门禁迁移只允许running状态持有一致的执行标志", async () => {
  const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
  const sql = await fs.readFile(
    path.join(currentDirectory, "migrations/034_publish_execution_enablement.sql"),
    "utf8",
  );
  const preflight = await fs.readFile(
    path.join(
      currentDirectory,
      "../../deploy/migrations/034_publish_execution_enablement_preflight.sql",
    ),
    "utf8",
  );
  const verify = await fs.readFile(
    path.join(
      currentDirectory,
      "../../deploy/migrations/034_publish_execution_enablement_verify.sql",
    ),
    "utf8",
  );
  const rollback = await fs.readFile(
    path.join(
      currentDirectory,
      "../../deploy/migrations/034_publish_execution_enablement_rollback.sql",
    ),
    "utf8",
  );

  assert.match(sql, /DROP CONSTRAINT publish_execution_runs_execution_enabled_off/);
  assert.match(sql, /publish_execution_runs_execution_flags_consistent/);
  assert.match(sql, /publish_execution_runs_execution_flags_state/);
  assert.match(sql, /NOT execution_enabled AND NOT authorizes_publishing/);
  assert.match(sql, /OR state = 'running'/);
  assert.doesNotMatch(sql, /UPDATE publish_execution_runs|DELETE FROM|TRUNCATE/i);

  for (const deploymentSql of [preflight, verify]) {
    assert.doesNotMatch(
      deploymentSql,
      /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE)\b/i,
    );
  }
  assert.match(preflight, /data:no_inconsistent_active_runs/);
  assert.match(verify, /legacy_execution_enabled_off_absent/);
  assert.match(rollback, /LOCK TABLE publish_execution_runs/);
  assert.match(rollback, /consumed_at IS NOT NULL/);
  assert.doesNotMatch(rollback, /\bCASCADE\b/i);
});
