import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertSuccessfulRoleAudit,
  runRuntimeDatabaseRoleAudit,
} from "./audit-runtime-database-role.js";

test("runtime role audit requires every named check to pass", () => {
  assert.doesNotThrow(() => assertSuccessfulRoleAudit({
    rows: [
      { check_name: "role:not_elevated", passed: true },
      { check_name: "objects:not_owner_member", passed: true },
    ],
  }));

  for (const result of [
    { rows: [] },
    { rows: [{ check_name: "role:not_elevated", passed: false }] },
    { rows: [{ check_name: "objects:protected_present", passed: null }] },
  ]) {
    assert.throws(
      () => assertSuccessfulRoleAudit(result),
      /运行时数据库角色审计/,
    );
  }

  assert.throws(
    () => assertSuccessfulRoleAudit({
      rows: [
        { check_name: "role:not_elevated", passed: false },
        { check_name: "capability:table:stores", passed: false },
      ],
    }),
    /角色边界: role:not_elevated; 能力覆盖: table:stores/,
  );
});

test("runtime role audit executes the repository SQL with simple query mode", async () => {
  const queries = [];
  const pool = {
    async query(query) {
      queries.push(query);
      return {
        rows: [{
          check_name: `audit:${queries.length}`,
          passed: true,
        }],
      };
    },
  };

  const checks = await runRuntimeDatabaseRoleAudit({ pool });

  assert.equal(queries.length, 2);
  assert.deepEqual(checks, [
    { check_name: "audit:1", passed: true },
    { check_name: "audit:2", passed: true },
  ]);
  assert.equal(
    queries.every((query) => query.queryMode === "simple"),
    true,
  );
  assert.match(queries[0].text, /compliance_preflight_runs/);
  assert.match(queries[0].text, /schema_migrations/);
  assert.match(queries[1].text, /expected_capabilities/);
  assert.match(queries[1].text, /has_sequence_privilege/);
});

test("runtime role audit requires results from both audit files", async () => {
  let queryCount = 0;
  const pool = {
    async query() {
      queryCount += 1;
      return queryCount === 1
        ? { rows: [{ check_name: "role:not_elevated", passed: true }] }
        : { rows: [] };
    },
  };

  await assert.rejects(
    () => runRuntimeDatabaseRoleAudit({ pool }),
    /运行时数据库角色审计没有返回检查结果/,
  );
});

test("runtime role audit reports failures from both audit files", async () => {
  let queryCount = 0;
  const pool = {
    async query() {
      queryCount += 1;
      return queryCount === 1
        ? { rows: [{ check_name: "schema:public_usage", passed: false }] }
        : {
            rows: [{
              check_name: "capability:sequence:api_audit_logs_id_seq",
              passed: false,
            }],
          };
    },
  };

  await assert.rejects(
    () => runRuntimeDatabaseRoleAudit({ pool }),
    /角色边界: schema:public_usage; 能力覆盖: sequence:api_audit_logs_id_seq/,
  );
  assert.equal(queryCount, 2);
});

test("runtime role audit command receives only the runtime database URL", async () => {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
  );
  const source = await fs.readFile(
    path.join(root, "server/cloud/audit-runtime-database-role.js"),
    "utf8",
  );
  const compose = await fs.readFile(
    path.join(root, "deploy/docker-compose.cloud.yml"),
    "utf8",
  );
  const packageJson = JSON.parse(await fs.readFile(
    path.join(root, "package.json"),
    "utf8",
  ));
  const runbook = await fs.readFile(
    path.join(root, "deploy/postgres/runtime-role-hardening.md"),
    "utf8",
  );

  assert.match(source, /config\.databaseUrl/);
  assert.doesNotMatch(source, /config\.migrationDatabaseUrl/);
  assert.match(
    compose,
    /\n  runtime-database-audit:\n[\s\S]*command: \["npm", "run", "db:audit:runtime-role"\]/,
  );
  assert.match(
    compose,
    /runtime-database-audit:[\s\S]*DATABASE_URL: \$\{SHEIN_RUNTIME_DATABASE_URL:\?SHEIN_RUNTIME_DATABASE_URL is required\}/,
  );
  assert.equal(
    packageJson.scripts["db:audit:runtime-role"],
    "node --env-file-if-exists=.env server/cloud/audit-runtime-database-role.js",
  );
  assert.match(runbook, /run --rm --build runtime-database-audit/);
});
