import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertAuditMutationBlocked,
  assertDisposableDatabaseUrl,
  assertRehearsalConfirmation,
  assertSuccessfulChecks,
} from "./rehearse-compliance-audit-immutability-migration.js";

test("029 rehearsal accepts only explicitly disposable local databases", () => {
  for (const value of [
    "postgres://user:secret@127.0.0.1:5432/shein_console_rehearsal",
    "postgresql://user:secret@localhost:5432/shein-console-test",
    "postgres://user:secret@[::1]:5432/compliance_scratch",
  ]) {
    assert.doesNotThrow(() => assertDisposableDatabaseUrl(value));
  }

  for (const value of [
    "",
    "https://127.0.0.1/shein_console_rehearsal",
    "postgres://user:secret@db.example.com:5432/shein_console_rehearsal",
    "postgres://user:secret@127.0.0.1:5432/shein_console",
    "postgres://user:secret@localhost:5432/production",
  ]) {
    assert.throws(
      () => assertDisposableDatabaseUrl(value),
      /一次性本机 PostgreSQL/,
    );
  }
});

test("029 rehearsal requires its exact destructive rehearsal confirmation", () => {
  assert.doesNotThrow(() => assertRehearsalConfirmation(
    "REHEARSE_029_ON_EMPTY_LOCAL_DATABASE",
  ));
  for (const value of [
    "",
    "yes",
    "REHEARSE_029",
    "REHEARSE_028_ON_EMPTY_LOCAL_DATABASE",
  ]) {
    assert.throws(
      () => assertRehearsalConfirmation(value),
      /REHEARSE_029_ON_EMPTY_LOCAL_DATABASE/,
    );
  }
});

test("029 rehearsal fails closed on checks and unexpected mutation errors", async () => {
  assert.doesNotThrow(() => assertSuccessfulChecks(
    { rows: [{ check_name: "triggers:enabled", passed: true }] },
    "迁移验证",
  ));
  assert.throws(
    () => assertSuccessfulChecks(
      { rows: [{ check_name: "triggers:enabled", passed: false }] },
      "迁移验证",
    ),
    /triggers:enabled/,
  );
  await assert.doesNotReject(() => assertAuditMutationBlocked(
    async () => {
      throw new Error("append-only compliance audit records cannot be changed");
    },
    "dry-run 修改",
  ));
  await assert.rejects(
    () => assertAuditMutationBlocked(async () => {}, "dry-run 修改"),
    /没有被数据库拒绝/,
  );
  await assert.rejects(
    () => assertAuditMutationBlocked(
      async () => {
        throw new Error("connection lost");
      },
      "dry-run 修改",
    ),
    /意外失败/,
  );
});

test("029 rehearsal covers both audit tables and every protected mutation", async () => {
  const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
  const source = await fs.readFile(
    path.join(
      currentDirectory,
      "rehearse-compliance-audit-immutability-migration.js",
    ),
    "utf8",
  );
  const packageJson = JSON.parse(await fs.readFile(
    path.resolve(currentDirectory, "../../package.json"),
    "utf8",
  ));
  const runbook = await fs.readFile(
    path.resolve(
      currentDirectory,
      "../../deploy/migrations/029_compliance_audit_immutability.md",
    ),
    "utf8",
  );

  assert.match(source, /029_compliance_audit_immutability_preflight\.sql/);
  assert.match(source, /029_compliance_audit_immutability_verify\.sql/);
  assert.match(source, /029_compliance_audit_immutability_rollback_empty\.sql/);
  for (const table of [
    "compliance_preflight_runs",
    "compliance_preflight_reviews",
  ]) {
    assert.match(source, new RegExp(`UPDATE ${table}`));
    assert.match(source, new RegExp(`DELETE FROM ${table}`));
    assert.match(source, new RegExp(`TRUNCATE ${table}`));
  }
  assert.match(source, /SAVEPOINT audit_mutation_probe/);
  assert.match(source, /ROLLBACK TO SAVEPOINT audit_mutation_probe/);
  assert.equal(
    packageJson.scripts["db:rehearse:029"],
    "node --env-file-if-exists=.env server/cloud/rehearse-compliance-audit-immutability-migration.js",
  );
  assert.match(runbook, /npm run db:rehearse:029/);
  assert.match(runbook, /REHEARSE_029_ON_EMPTY_LOCAL_DATABASE/);
  assert.match(
    runbook,
    /修改、删除和清空[\s\S]*数据库拒绝[\s\S]*空表回滚[\s\S]*重新迁移/,
  );
});
