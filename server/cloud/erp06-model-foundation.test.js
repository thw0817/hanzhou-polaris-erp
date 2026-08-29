import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertDisposableDatabaseUrl,
  assertRehearsalConfirmation,
  assertSuccessfulChecks,
  confirmationValue,
} from "./rehearse-erp06-model-foundation.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const draftDirectory = path.join(currentDirectory, "erp06-draft");
const activeMigrationDirectory = path.join(currentDirectory, "migrations");

async function readDraft(filename) {
  return fs.readFile(path.join(draftDirectory, filename), "utf8");
}

function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--[^\n]*/g, "");
}

test("ERP-06 rehearsal refuses non-local or non-disposable databases", () => {
  for (const value of [
    "postgres://user:secret@127.0.0.1:5432/shein_erp06_rehearsal",
    "postgresql://user:secret@localhost:5432/erp06-scratch",
    "postgres://user:secret@[::1]:5432/erp06-test",
  ]) {
    assert.doesNotThrow(() => assertDisposableDatabaseUrl(value));
  }
  for (const value of [
    "",
    "https://127.0.0.1/erp06-rehearsal",
    "postgres://user:secret@db.example.com:5432/erp06-rehearsal",
    "postgres://user:secret@127.0.0.1:5432/production",
    "postgres://user:secret@localhost:5432/shein_console",
  ]) {
    assert.throws(
      () => assertDisposableDatabaseUrl(value),
      /一次性本机 PostgreSQL/,
    );
  }
});

test("ERP-06 rehearsal requires its exact explicit confirmation", () => {
  assert.doesNotThrow(() => assertRehearsalConfirmation(confirmationValue));
  for (const value of ["", "yes", "REHEARSE_ERP06", "REHEARSE_028_ON_EMPTY_LOCAL_DATABASE"]) {
    assert.throws(
      () => assertRehearsalConfirmation(value),
      /REHEARSE_ERP06_MODEL_FOUNDATION_ON_EMPTY_LOCAL_DATABASE/,
    );
  }
});

test("ERP-06 draft stays outside the active migration directory", async () => {
  const activeFiles = await fs.readdir(activeMigrationDirectory);
  assert.equal(activeFiles.includes("047_erp06_model_foundation.sql"), false);
  const draft = await readDraft("047_erp06_model_foundation.sql");
  assert.match(draft, /ISOLATED DRAFT ONLY/);
  assert.match(draft, /CREATE TABLE catalog_products/);
  assert.match(draft, /CREATE TABLE product_versions/);
  assert.match(draft, /CREATE TABLE publish_attempts/);
  assert.match(draft, /CREATE TABLE product_publish_receipts/);
  assert.match(draft, /CREATE TABLE platform_product_links/);
  assert.match(draft, /CREATE TABLE product_events/);
  assert.match(draft, /CREATE TABLE official_event_inbox/);
  assert.match(draft, /CREATE TABLE product_publish_outbox/);
});

test("ERP-06 apply draft is additive and has no cleanup statements", async () => {
  const sql = stripSqlComments(await readDraft("047_erp06_model_foundation.sql"));
  assert.doesNotMatch(sql, /^\s*(DROP|DELETE|TRUNCATE)\b/im);
  assert.doesNotMatch(sql, /^\s*UPDATE\s+[A-Za-z_]/im);
  assert.match(sql, /ALTER TABLE stores\s+ADD CONSTRAINT/i);
  assert.match(sql, /ALTER TABLE product_drafts\s+ADD COLUMN/i);
  assert.match(sql, /ALTER TABLE media_assets\s+ADD COLUMN/i);
  assert.match(sql, /ON DELETE RESTRICT/i);
  assert.match(sql, /UNIQUE \(tenant_id, store_id, catalog_product_id, version_no\)/);
  assert.match(sql, /ERP06_RESULT_UNKNOWN_COMMAND_BLOCKED/);
  assert.match(sql, /ERP06_IMMUTABLE_FACT_UPDATE_BLOCKED/);
});

test("ERP-06 draft encodes the required failure protections", async () => {
  const sql = await readDraft("047_erp06_model_foundation.sql");
  const verify = await readDraft("verify.sql");
  const rollback = await readDraft("rollback_empty.sql");
  const readme = await readDraft("README.md");
  assert.match(sql, /integrity_state text NOT NULL DEFAULT 'unknown'/);
  assert.match(sql, /asset_integrity_state <> 'verified'/);
  assert.match(sql, /NEW\.content_sha256 <> asset_verified_sha256/);
  assert.match(sql, /NEW\.content_size_bytes <> asset_verified_size_bytes/);
  assert.match(sql, /supersedes_attempt_id uuid/);
  assert.match(sql, /CHECK \(\s*state <> 'result_unknown' OR result_unknown_at IS NOT NULL/s);
  assert.match(sql, /evidence_source text NOT NULL/);
  assert.match(sql, /evidence_fingerprint text NOT NULL/);
  assert.match(sql, /receipt_type text NOT NULL/);
  assert.match(sql, /FOREIGN KEY \(tenant_id, store_id, product_version_id\)/g);
  assert.match(sql, /CREATE TRIGGER product_events_immutable_guard/);
  assert.match(verify, /legacy_history_not_backfilled/);
  assert.match(rollback, /current_database\(\) !~\* '\(\^\|\[-_\]\)\(test\|rehearsal\|scratch\)\(\[-_\]\|\$\)'/);
  assert.match(rollback, /requires empty table/);
  assert.match(readme, /不连接生产 PostgreSQL、COS、Redis、队列或 SHEIN/);
});

test("ERP-06 check helper rejects any false gate", () => {
  assert.doesNotThrow(() =>
    assertSuccessfulChecks(
      { rows: [{ check_name: "target_absent", passed: true }] },
      "隔离验证",
    ),
  );
  assert.throws(
    () =>
      assertSuccessfulChecks(
        {
          rows: [
            { check_name: "target_absent", passed: true },
            { check_name: "checksum", passed: false },
          ],
        },
        "隔离验证",
      ),
    /checksum/,
  );
  assert.throws(
    () => assertSuccessfulChecks({ rows: [] }, "隔离验证"),
    /没有返回检查结果/,
  );
});
