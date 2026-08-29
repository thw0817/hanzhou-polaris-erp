import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../config.js";
import { startStoreBusinessRefreshWorkerServer } from "./store-business-refresh-worker-server.js";

test("store business refresh worker rejects non-cloud configuration", async () => {
  await assert.rejects(
    startStoreBusinessRefreshWorkerServer({ runtimeMode: "local" }),
    /SHEIN_RUNTIME_MODE=cloud/,
  );
});

test("store business refresh worker requires read credentials before connecting", async () => {
  await assert.rejects(
    startStoreBusinessRefreshWorkerServer({
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

test("store business refresh schedule is disabled by default", () => {
  const config = loadConfig({});

  assert.equal(config.storeBusinessRefresh.schedulerEnabled, false);
  assert.equal(config.storeBusinessRefresh.scheduleIntervalMs, 15 * 60 * 1000);
});

test("store business refresh schedule requires the refresh execution gate", async () => {
  await assert.rejects(
    startStoreBusinessRefreshWorkerServer({
      runtimeMode: "cloud",
      databaseUrl: "postgres://database",
      redisUrl: "redis://redis",
      appId: "app-id",
      appSecret: "app-secret",
      cloudEncryptionKey: "encryption-key",
      storeBusinessRefresh: {
        executionEnabled: false,
        schedulerEnabled: true,
      },
    }),
    /必须同时启用经营数据刷新/,
  );
});
