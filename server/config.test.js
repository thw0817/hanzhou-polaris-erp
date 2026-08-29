import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "./config.js";

test("cloud database configuration separates runtime and migration URLs", () => {
  const config = loadConfig({
    DATABASE_URL: "postgres://runtime",
    SHEIN_MIGRATION_DATABASE_URL: "postgres://migration",
  });

  assert.equal(config.databaseUrl, "postgres://runtime");
  assert.equal(config.migrationDatabaseUrl, "postgres://migration");
});

test("migration URL falls back to the runtime URL for existing deployments", () => {
  const config = loadConfig({
    DATABASE_URL: "postgres://existing",
  });

  assert.equal(config.databaseUrl, "postgres://existing");
  assert.equal(config.migrationDatabaseUrl, "postgres://existing");
});

test("local direct browser authorization is opt-in", () => {
  assert.equal(loadConfig({}).localDirectAuthEnabled, false);
  assert.equal(
    loadConfig({ SHEIN_LOCAL_DIRECT_AUTH: "true" }).localDirectAuthEnabled,
    true,
  );
});
