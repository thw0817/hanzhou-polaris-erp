import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config.js";
import { createPostgresPool } from "./postgres.js";

const auditSqlPaths = [
  "audit-runtime-role.sql",
  "audit-runtime-capabilities.sql",
].map((filename) =>
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../deploy/postgres",
    filename,
  )
);

function namedAuditChecks(result) {
  const checks = (result?.rows || []).filter(
    (row) => row && "check_name" in row,
  );
  if (!checks.length) {
    throw new Error("运行时数据库角色审计没有返回检查结果");
  }
  return checks;
}

export function assertSuccessfulRoleAudit(result) {
  const checks = namedAuditChecks(result);
  const failed = checks
    .filter((row) => row.passed !== true)
    .map((row) => row.check_name);
  if (failed.length) {
    const boundary = failed.filter(
      (checkName) => !checkName.startsWith("capability:"),
    );
    const capabilities = failed
      .filter((checkName) => checkName.startsWith("capability:"))
      .map((checkName) => checkName.slice("capability:".length));
    const groups = [];
    if (boundary.length) {
      groups.push(`角色边界: ${boundary.join(", ")}`);
    }
    if (capabilities.length) {
      groups.push(`能力覆盖: ${capabilities.join(", ")}`);
    }
    throw new Error(`运行时数据库角色审计失败: ${groups.join("; ")}`);
  }
}

export async function runRuntimeDatabaseRoleAudit({ pool } = {}) {
  const rows = [];
  for (const auditSqlPath of auditSqlPaths) {
    const result = await pool.query({
      text: await fs.readFile(auditSqlPath, "utf8"),
      queryMode: "simple",
    });
    rows.push(...namedAuditChecks(result));
  }
  assertSuccessfulRoleAudit({ rows });
  return rows;
}

async function main() {
  const config = loadConfig();
  const pool = createPostgresPool({
    connectionString: config.databaseUrl,
  });
  try {
    const checks = await runRuntimeDatabaseRoleAudit({ pool });
    console.log(`运行时数据库角色审计通过: ${checks.length} 项`);
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
