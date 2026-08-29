import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  extractOperationsFromSql,
  renderRuntimeCapabilityAuditSql,
  renderRuntimeCapabilityMatrix,
  runtimeEntrypoints,
  schemaInventory,
} from "./runtime-database-capabilities.js";

test("runtime SQL extraction keeps real tables and ignores CTE aliases", () => {
  const knownTables = new Set([
    "api_audit_logs",
    "membership_store_access",
    "stores",
    "tenants",
  ]);
  const operations = extractOperationsFromSql(
    `
      WITH selected_tenants AS (
        SELECT id FROM tenants
      )
      INSERT INTO api_audit_logs (tenant_id)
      SELECT id FROM selected_tenants
      RETURNING id;

      INSERT INTO stores (tenant_id, open_key_id)
      VALUES ($1, $2)
      ON CONFLICT (open_key_id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id;

      DELETE FROM membership_store_access
      WHERE tenant_id = $1;
    `,
    knownTables,
  );

  assert.deepEqual(
    [...operations.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    ),
    [
      ["api_audit_logs", ["SELECT", "INSERT"]],
      ["membership_store_access", ["DELETE"]],
      ["stores", ["SELECT", "INSERT", "UPDATE"]],
      ["tenants", ["SELECT"]],
    ],
  );
});

test("runtime SQL extraction treats RETURNING as a read requirement", () => {
  const knownTables = new Set(["jobs", "logs", "sessions"]);
  const operations = extractOperationsFromSql(
    `
      INSERT INTO logs (message) VALUES ($1) RETURNING id;
      UPDATE jobs SET state = 'done' WHERE id = $2 RETURNING id;
      DELETE FROM sessions WHERE id = $3 RETURNING id;
    `,
    knownTables,
  );

  assert.deepEqual([...operations.entries()], [
    ["jobs", ["SELECT", "UPDATE"]],
    ["logs", ["SELECT", "INSERT"]],
    ["sessions", ["SELECT", "DELETE"]],
  ]);
});

test("runtime capability entrypoints match the long-running cloud services", () => {
  assert.deepEqual(runtimeEntrypoints, [
    "compliance-sync-worker-server.js",
    "control-server.js",
    "media-cleanup-worker-server.js",
    "outbox-dispatcher.js",
    "product-publish-worker-server.js",
    "rule-refresh-worker-server.js",
    "store-business-refresh-worker-server.js",
    "webhook-server.js",
    "webhook-worker-server.js",
  ]);
});

test("schema inventory ignores migration comments that mention CREATE TABLE", async () => {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
  );
  const { tables } = await schemaInventory(root);

  assert.equal(tables.has("compliance_templates"), true);
  assert.equal(tables.has("deliberately"), false);
});

test("checked-in runtime capability matrix matches current repository SQL", async () => {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
  );
  const expected = await renderRuntimeCapabilityMatrix({ root });
  const actual = await fs.readFile(
    path.join(root, "deploy/postgres/runtime-role-capabilities.md"),
    "utf8",
  );

  assert.equal(actual, expected);
  assert.doesNotMatch(actual, /\b(GRANT|REVOKE)\b/i);
  assert.doesNotMatch(
    actual,
    /server\/cloud\/(?:audit-runtime|migrate|provision|rehearse|web-demo)[^`]*\.js/,
  );
  assert.match(actual, /compliance_preflight_runs[\s\S]*INSERT/);
  assert.match(actual, /compliance_preflight_reviews[\s\S]*INSERT/);
  assert.match(actual, /api_audit_logs_id_seq[\s\S]*USAGE/);
});

test("checked-in runtime capability audit matches the same static model", async () => {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
  );
  const expected = await renderRuntimeCapabilityAuditSql({ root });
  const actual = await fs.readFile(
    path.join(root, "deploy/postgres/audit-runtime-capabilities.sql"),
    "utf8",
  );

  assert.equal(actual, expected);
  assert.doesNotMatch(actual, /\b(GRANT|REVOKE)\b/i);
  assert.match(actual, /has_table_privilege/);
  assert.match(actual, /has_sequence_privilege/);
  assert.match(
    actual,
    /\('compliance_preflight_runs', 'table', ARRAY\['SELECT', 'INSERT'\]::text\[\]\)/,
  );
  assert.match(
    actual,
    /\('api_audit_logs_id_seq', 'sequence', ARRAY\['USAGE'\]::text\[\]\)/,
  );
});
