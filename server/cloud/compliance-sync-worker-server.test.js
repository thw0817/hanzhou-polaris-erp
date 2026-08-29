import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../config.js";
import { startComplianceSyncWorkerServer } from "./compliance-sync-worker-server.js";

test("compliance sync worker rejects non-cloud configuration", async () => {
  await assert.rejects(
    startComplianceSyncWorkerServer({ runtimeMode: "local" }),
    /SHEIN_RUNTIME_MODE=cloud/,
  );
});

test("compliance sync worker requires database, Redis and read credentials", async () => {
  await assert.rejects(
    startComplianceSyncWorkerServer({
      runtimeMode: "cloud",
      databaseUrl: "",
      redisUrl: "",
      appId: "",
      appSecret: "",
      cloudEncryptionKey: "",
    }),
    /PostgreSQL、Redis 或 SHEIN 凭证配置/,
  );
});

test("compliance sync execution is disabled by default", () => {
  const config = loadConfig({});
  assert.equal(config.complianceSync.executionEnabled, false);
  assert.equal(config.complianceSync.workerConcurrency, 1);
});
