import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config.js";
import { createPostgresPool } from "./postgres.js";

const migrationDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "migrations",
);

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function ensureMigrationTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

export async function runMigrations({ pool, directory = migrationDir } = {}) {
  await ensureMigrationTable(pool);
  const filenames = (await fs.readdir(directory))
    // Only accept versioned migration files. macOS may add AppleDouble
    // resource-fork files such as "._001_initial.sql" to deployment archives;
    // those are metadata, not executable SQL.
    .filter((filename) => /^\d{3}_[A-Za-z0-9_-]+\.sql$/.test(filename))
    .sort();
  const applied = [];

  for (const filename of filenames) {
    const sql = await fs.readFile(path.join(directory, filename), "utf8");
    const checksum = crypto.createHash("sha256").update(sql).digest("hex");
    // Keep the migration runner on PostgreSQL's simple query protocol from
    // lookup through commit. Mixing an extended-protocol parameterized lookup
    // with a following multi-statement simple query has produced 08P01
    // ("invalid message format") against the production PostgreSQL instance.
    const existing = await pool.query({
      text: `SELECT checksum FROM schema_migrations
             WHERE filename = ${sqlLiteral(filename)}`,
      queryMode: "simple",
    });
    if (existing.rowCount) {
      if (existing.rows[0].checksum !== checksum) {
        throw new Error(`已执行的迁移文件发生变化: ${filename}`);
      }
      continue;
    }
    const client = await pool.connect();
    try {
      await client.query({ text: "BEGIN", queryMode: "simple" });
      // Migrations are trusted, versioned SQL files that may contain multiple
      // statements. Force PostgreSQL's simple query protocol so the whole file
      // is executed as one transactional command instead of being interpreted
      // as an extended-protocol prepared statement.
      await client.query({ text: sql, queryMode: "simple" });
      await client.query({
        text: `INSERT INTO schema_migrations (filename, checksum)
               VALUES (${sqlLiteral(filename)}, ${sqlLiteral(checksum)})`,
        queryMode: "simple",
      });
      await client.query({ text: "COMMIT", queryMode: "simple" });
      applied.push(filename);
    } catch (error) {
      await client.query({ text: "ROLLBACK", queryMode: "simple" });
      throw error;
    } finally {
      client.release();
    }
  }
  return applied;
}

async function main() {
  const config = loadConfig();
  const pool = createPostgresPool({
    connectionString: config.migrationDatabaseUrl,
  });
  try {
    const applied = await runMigrations({ pool });
    console.log(
      applied.length
        ? `已执行迁移: ${applied.join(", ")}`
        : "数据库已是最新版本",
    );
  } finally {
    await pool.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
