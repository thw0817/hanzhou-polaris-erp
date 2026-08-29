import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";

export const runtimeEntrypoints = [
  "compliance-sync-worker-server.js",
  "control-server.js",
  "media-cleanup-worker-server.js",
  "product-publish-worker-server.js",
  "rule-refresh-worker-server.js",
  "store-business-refresh-worker-server.js",
  "webhook-server.js",
  "webhook-worker-server.js",
];

const operationOrder = ["SELECT", "INSERT", "UPDATE", "DELETE", "USAGE"];
const tableIdentifier =
  String.raw`(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?`;

function addOperation(operations, table, operation, knownTables) {
  if (!knownTables.has(table)) {
    return;
  }
  const existing = operations.get(table) || new Set();
  existing.add(operation);
  operations.set(table, existing);
}

export function extractOperationsFromSql(sql, knownTables) {
  const operations = new Map();
  const insertPattern = new RegExp(
    String.raw`\bINSERT\s+INTO\s+${tableIdentifier}`,
    "gi",
  );
  const updatePattern = new RegExp(
    String.raw`\bUPDATE\s+(?:ONLY\s+)?${tableIdentifier}`,
    "gi",
  );
  const deletePattern = new RegExp(
    String.raw`\bDELETE\s+FROM\s+${tableIdentifier}`,
    "gi",
  );
  const writes = [
    ...[...sql.matchAll(insertPattern)].map((match) => ({
      match,
      operation: "INSERT",
    })),
    ...[...sql.matchAll(updatePattern)].map((match) => ({
      match,
      operation: "UPDATE",
    })),
    ...[...sql.matchAll(deletePattern)].map((match) => ({
      match,
      operation: "DELETE",
    })),
  ]
    .map(({ match, operation }) => ({
      index: match.index,
      operation,
      table: match[1].toLowerCase(),
    }))
    .filter(({ table }) => knownTables.has(table))
    .sort((left, right) => left.index - right.index);

  for (let index = 0; index < writes.length; index += 1) {
    const write = writes[index];
    addOperation(operations, write.table, write.operation, knownTables);
    const nextIndex = writes[index + 1]?.index ?? sql.length;
    const statement = sql.slice(write.index, nextIndex);
    if (
      write.operation === "INSERT" &&
      /\bON\s+CONFLICT\b[\s\S]*?\bDO\s+UPDATE\b/i.test(statement)
    ) {
      addOperation(operations, write.table, "UPDATE", knownTables);
      // PostgreSQL requires SELECT on ON CONFLICT arbiter columns.
      addOperation(operations, write.table, "SELECT", knownTables);
    }
    if (/\bRETURNING\b/i.test(statement)) {
      addOperation(operations, write.table, "SELECT", knownTables);
    }
  }
  const readSql = sql.replace(
    deletePattern,
    "",
  );
  for (const match of readSql.matchAll(
    new RegExp(
      String.raw`\b(?:FROM|JOIN)\s+(?:ONLY\s+)?${tableIdentifier}`,
      "gi",
    ),
  )) {
    addOperation(operations, match[1].toLowerCase(), "SELECT", knownTables);
  }

  return new Map(
    [...operations.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([table, values]) => [
        table,
        operationOrder.filter((operation) => values.has(operation)),
      ]),
  );
}

function sourceStrings(sourceText, filename) {
  const sourceFile = parse(sourceText, {
    sourceFilename: filename,
    sourceType: "module",
  });
  const strings = [];

  function visit(node) {
    if (!node || typeof node !== "object") {
      return;
    }
    if (node.type === "StringLiteral") {
      strings.push(node.value);
      return;
    }
    if (node.type === "TemplateLiteral") {
      strings.push(
        node.quasis.map((quasi) => quasi.value.cooked || "").join(" "),
      );
      return;
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        value.forEach(visit);
      } else {
        visit(value);
      }
    }
  }

  visit(sourceFile.program);
  return { sourceFile, strings };
}

async function runtimeSourceFiles(root) {
  const cloudDirectory = path.join(root, "server/cloud");
  const pending = runtimeEntrypoints.map((filename) =>
    path.join(cloudDirectory, filename),
  );
  const visited = new Set();

  while (pending.length) {
    const filename = pending.pop();
    if (visited.has(filename)) {
      continue;
    }
    visited.add(filename);
    const sourceText = await fs.readFile(filename, "utf8");
    const { sourceFile } = sourceStrings(sourceText, filename);

    for (const statement of sourceFile.program.body) {
      if (
        statement.type !== "ImportDeclaration" ||
        statement.source.type !== "StringLiteral"
      ) {
        continue;
      }
      const specifier = statement.source.value;
      if (!specifier.startsWith(".")) {
        continue;
      }
      const imported = path.resolve(path.dirname(filename), specifier);
      if (
        imported.startsWith(`${cloudDirectory}${path.sep}`) &&
        imported.endsWith(".js")
      ) {
        pending.push(imported);
      }
    }
  }

  return [...visited].sort();
}

export async function schemaInventory(root) {
  const migrationDirectory = path.join(root, "server/cloud/migrations");
  const filenames = (await fs.readdir(migrationDirectory))
    .filter((filename) => /^\d{3}_[A-Za-z0-9_-]+\.sql$/.test(filename))
    .sort();
  const tables = new Set();
  const serialSequences = new Map();

  for (const filename of filenames) {
    const sql = await fs.readFile(
      path.join(migrationDirectory, filename),
      "utf8",
    );
    for (const match of sql.matchAll(
      /^\s*CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+([a-z_][a-z0-9_]*)/gim,
    )) {
      tables.add(match[1].toLowerCase());
    }
    for (const match of sql.matchAll(
      /^\s*CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+([a-z_][a-z0-9_]*)\s*\(([\s\S]*?)\);/gim,
    )) {
      const table = match[1].toLowerCase();
      for (const column of match[2].matchAll(
        /^\s*([a-z_][a-z0-9_]*)\s+(?:bigserial|serial)\b/gim,
      )) {
        serialSequences.set(
          table,
          `${table}_${column[1].toLowerCase()}_seq`,
        );
      }
    }
  }

  return { tables, serialSequences };
}

async function buildRuntimeCapabilityMatrix({ root }) {
  const { tables, serialSequences } = await schemaInventory(root);
  const tableCapabilities = new Map();

  for (const filename of await runtimeSourceFiles(root)) {
    const sourceText = await fs.readFile(filename, "utf8");
    const relativeSource = path.relative(root, filename);
    const { strings } = sourceStrings(sourceText, filename);
    for (const sql of strings) {
      if (!/\b(SELECT|INSERT|UPDATE|DELETE)\b/i.test(sql)) {
        continue;
      }
      for (const [table, operations] of extractOperationsFromSql(sql, tables)) {
        const capability = tableCapabilities.get(table) || {
          operations: new Set(),
          sources: new Set(),
        };
        for (const operation of operations) {
          capability.operations.add(operation);
        }
        capability.sources.add(relativeSource);
        tableCapabilities.set(table, capability);
      }
    }
  }

  const rows = [...tableCapabilities.entries()].map(
    ([object, capability]) => ({
      object,
      kind: "table",
      operations: operationOrder.filter((operation) =>
        capability.operations.has(operation),
      ),
      sources: [...capability.sources].sort(),
    }),
  );

  for (const [table, sequence] of serialSequences) {
    const capability = tableCapabilities.get(table);
    if (!capability?.operations.has("INSERT")) {
      continue;
    }
    rows.push({
      object: sequence,
      kind: "sequence",
      operations: ["USAGE"],
      sources: [...capability.sources].sort(),
    });
  }

  return rows.sort(
    (left, right) =>
      left.kind.localeCompare(right.kind) ||
      left.object.localeCompare(right.object),
  );
}

export async function renderRuntimeCapabilityAuditSql({ root }) {
  const rows = await buildRuntimeCapabilityMatrix({ root });
  const values = rows.map((row, index) => {
    const operations = row.operations
      .map((operation) => `'${operation}'`)
      .join(", ");
    const suffix = index === rows.length - 1 ? "" : ",";
    return `    ('${row.object}', '${row.kind}', ARRAY[${operations}]::text[])${suffix}`;
  });
  const lines = [
    "-- Generated from runtime-database-capabilities.js. Review only.",
    "WITH expected_capabilities (object_name, object_kind, expected_operations) AS (",
    "  VALUES",
    ...values,
    "),",
    "capability_objects AS (",
    "  SELECT",
    "    expected.*,",
    "    relation.oid AS object_oid,",
    "    relation.relkind",
    "  FROM expected_capabilities AS expected",
    "  LEFT JOIN pg_namespace AS schema",
    "    ON schema.nspname = 'public'",
    "  LEFT JOIN pg_class AS relation",
    "    ON relation.relnamespace = schema.oid",
    "   AND relation.relname = expected.object_name",
    "),",
    "checks (check_name, passed) AS (",
    "  SELECT",
    "    'capability:' || object_kind || ':' || object_name,",
    "    CASE",
    "      WHEN object_kind = 'table' AND relkind IN ('r', 'p') THEN (",
    "        SELECT bool_and(",
    "          has_table_privilege(",
    "            current_user,",
    "            object_oid,",
    "            privilege_name",
    "          ) IS NOT DISTINCT FROM (",
    "            privilege_name = ANY(expected_operations)",
    "          )",
    "        )",
    "        FROM unnest(ARRAY[",
    "          'SELECT',",
    "          'INSERT',",
    "          'UPDATE',",
    "          'DELETE',",
    "          'TRUNCATE',",
    "          'REFERENCES',",
    "          'TRIGGER'",
    "        ]::text[]) AS privilege(privilege_name)",
    "      )",
    "      WHEN object_kind = 'sequence' AND relkind = 'S' THEN (",
    "        SELECT bool_and(",
    "          has_sequence_privilege(",
    "            current_user,",
    "            object_oid,",
    "            privilege_name",
    "          ) IS NOT DISTINCT FROM (",
    "            privilege_name = ANY(expected_operations)",
    "          )",
    "        )",
    "        FROM unnest(ARRAY[",
    "          'USAGE',",
    "          'SELECT',",
    "          'UPDATE'",
    "        ]::text[]) AS privilege(privilege_name)",
    "      )",
    "      ELSE false",
    "    END",
    "  FROM capability_objects",
    ")",
    "SELECT check_name, passed",
    "FROM checks",
    "ORDER BY check_name;",
    "",
  ];
  return lines.join("\n");
}

export async function renderRuntimeCapabilityMatrix({ root }) {
  const rows = await buildRuntimeCapabilityMatrix({ root });
  const lines = [
    "# PostgreSQL Runtime Role Capability Matrix",
    "",
    "Generated from the import graph of these long-running cloud entrypoints:",
    "",
    ...runtimeEntrypoints.map((entrypoint) => `- \`${entrypoint}\``),
    "",
    "This is a review inventory only. It does not create roles, change privileges, or modify database objects.",
    "",
    "| Object | Kind | Operations | Runtime SQL sources |",
    "| --- | --- | --- | --- |",
    ...rows.map(
      (row) =>
        `| \`${row.object}\` | ${row.kind} | ${row.operations.join(", ")} | ${row.sources
          .map((source) => `\`${source}\``)
          .join("<br>")} |`,
    ),
    "",
    `Tables: ${rows.filter((row) => row.kind === "table").length}. Sequences: ${
      rows.filter((row) => row.kind === "sequence").length
    }.`,
    "",
  ];
  return lines.join("\n");
}

async function main() {
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
  );
  const output = await renderRuntimeCapabilityMatrix({ root });
  if (process.argv.includes("--write")) {
    const auditSql = await renderRuntimeCapabilityAuditSql({ root });
    await Promise.all([
      fs.writeFile(
        path.join(root, "deploy/postgres/runtime-role-capabilities.md"),
        output,
      ),
      fs.writeFile(
        path.join(root, "deploy/postgres/audit-runtime-capabilities.sql"),
        auditSql,
      ),
    ]);
    return;
  }
  process.stdout.write(output);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
