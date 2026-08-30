import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("cloud deployment exposes separate runtime and migration database URLs", async () => {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
  );
  const compose = await fs.readFile(
    path.join(root, "deploy/docker-compose.cloud.yml"),
    "utf8",
  );
  const migrateSource = await fs.readFile(
    path.join(root, "server/cloud/migrate.js"),
    "utf8",
  );
  const envExample = await fs.readFile(
    path.join(root, ".env.cloud.example"),
    "utf8",
  );

  assert.doesNotMatch(
    compose,
    /DATABASE_URL:\s*postgres:\/\/shein:/,
  );
  assert.match(
    compose,
    /DATABASE_URL:\s*\$\{SHEIN_RUNTIME_DATABASE_URL:\?SHEIN_RUNTIME_DATABASE_URL is required\}/,
  );
  assert.match(
    compose,
    /SHEIN_MIGRATION_DATABASE_URL:\s*\$\{SHEIN_MIGRATION_DATABASE_URL:\?SHEIN_MIGRATION_DATABASE_URL is required\}/,
  );
  assert.match(compose, /\n  migration:\n[\s\S]*command: \["npm", "run", "db:migrate"\]/);
  assert.match(
    compose,
    /\n  product-publish-worker:\n[\s\S]*SHEIN_COMPLIANCE_WRITES_ENABLED:\s*\$\{SHEIN_COMPLIANCE_WRITES_ENABLED:-false\}/,
  );
  assert.equal(
    compose.match(/^\s+SHEIN_MIGRATION_DATABASE_URL:/gm)?.length,
    1,
  );
  assert.match(migrateSource, /config\.migrationDatabaseUrl/);
  assert.match(envExample, /^SHEIN_RUNTIME_DATABASE_URL=/m);
  assert.match(envExample, /^SHEIN_MIGRATION_DATABASE_URL=/m);
  assert.match(envExample, /^SHEIN_OUTBOX_DISPATCHER_ENABLED=false$/m);
});

test("cloud publish profile declares the durable outbox dispatcher", async () => {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
  );
  const compose = await fs.readFile(
    path.join(root, "deploy/docker-compose.cloud.yml"),
    "utf8",
  );

  assert.match(
    compose,
    /\n  outbox-dispatcher:\n    profiles: \["publish"\]/,
  );
  assert.match(
    compose,
    /\n  outbox-dispatcher:[\s\S]*?command: \["npm", "run", "outbox-dispatcher:cloud"\]/,
  );
  assert.match(
    compose,
    /\n      SHEIN_OUTBOX_DISPATCHER_ENABLED: \$\{SHEIN_OUTBOX_DISPATCHER_ENABLED:-false\}/,
  );
  assert.match(
    compose,
    /\n      outbox-dispatcher:\n        condition: service_started/,
  );
});

test("runtime database role audit is read-only and checks the protected boundary", async () => {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../deploy/postgres",
  );
  const audit = await fs.readFile(
    path.join(root, "audit-runtime-role.sql"),
    "utf8",
  );
  const capabilityAudit = await fs.readFile(
    path.join(root, "audit-runtime-capabilities.sql"),
    "utf8",
  );
  const runbook = await fs.readFile(
    path.join(root, "runtime-role-hardening.md"),
    "utf8",
  );

  assert.doesNotMatch(
    audit,
    /\b(INSERT INTO|UPDATE\s+\w|DELETE FROM|TRUNCATE TABLE|CREATE\s+\w|ALTER\s+\w|DROP\s+\w|GRANT\s+\w|REVOKE\s+\w)\b/i,
  );
  assert.match(audit, /rolsuper/);
  assert.match(audit, /rolcreaterole/);
  assert.match(audit, /rolreplication/);
  assert.match(audit, /pg_has_role/);
  assert.match(audit, /has_schema_privilege/);
  assert.match(audit, /compliance_preflight_runs/);
  assert.match(audit, /compliance_preflight_reviews/);
  assert.match(
    audit,
    /to_regclass\('public\.compliance_preflight_runs'\)/,
  );
  assert.match(
    audit,
    /to_regclass\('public\.compliance_preflight_reviews'\)/,
  );
  assert.match(audit, /schema_migrations/);
  assert.match(audit, /has_table_privilege/);
  assert.match(audit, /'schema:public_usage'/);
  assert.doesNotMatch(
    capabilityAudit,
    /\b(INSERT INTO|UPDATE\s+\w|DELETE FROM|TRUNCATE TABLE|CREATE\s+\w|ALTER\s+\w|DROP\s+\w|GRANT\s+\w|REVOKE\s+\w)\b/i,
  );
  assert.match(capabilityAudit, /has_table_privilege/);
  assert.match(capabilityAudit, /has_sequence_privilege/);
  assert.match(
    runbook,
    /当前 Compose 默认配置[\s\S]*不能通过运行时角色审计/,
  );
  assert.match(
    runbook,
    /不得自动修改生产数据库角色、密码或所有权/,
  );
});

test("runtime role acceptance record is a credential-free manual template", async () => {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../deploy",
  );
  const template = await fs.readFile(
    path.join(root, "postgres/runtime-role-acceptance-record.md"),
    "utf8",
  );
  const runbook = await fs.readFile(
    path.join(root, "postgres/runtime-role-hardening.md"),
    "utf8",
  );
  const deployReadme = await fs.readFile(
    path.join(root, "README.md"),
    "utf8",
  );

  for (const heading of [
    "变更识别",
    "安全边界确认",
    "备份与回滚准备",
    "静态基线",
    "角色准备记录",
    "只读审计记录",
    "失败修正记录",
    "上线决策",
    "签署与保存",
  ]) {
    assert.match(template, new RegExp(`^## \\d+\\. ${heading}$`, "m"));
  }
  assert.match(
    template,
    /run --rm --build runtime-database-audit/,
  );
  assert.match(template, /不得粘贴数据库 URL、密码、私钥、访问令牌或完整 `\.env`/);
  assert.match(template, /填写后的记录不得提交到代码仓库/);
  assert.doesNotMatch(template, /db:capabilities:write/);
  assert.doesNotMatch(template, /\b(GRANT|REVOKE)\b/i);
  assert.doesNotMatch(
    template,
    /(?:postgres(?:ql)?:\/\/|DATABASE_URL\s*=|PASSWORD\s*=|SECRET\s*=)/i,
  );
  assert.match(runbook, /runtime-role-acceptance-record\.md/);
  assert.match(deployReadme, /runtime-role-acceptance-record\.md/);
});
