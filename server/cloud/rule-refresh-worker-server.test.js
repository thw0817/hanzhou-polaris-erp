import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../config.js";
import { startRuleRefreshWorkerServer } from "./rule-refresh-worker-server.js";

test("rule refresh worker rejects non-cloud configuration", async () => {
  await assert.rejects(
    startRuleRefreshWorkerServer({ runtimeMode: "local" }),
    /SHEIN_RUNTIME_MODE=cloud/,
  );
});

test("rule refresh worker requires database, Redis and read credentials", async () => {
  await assert.rejects(
    startRuleRefreshWorkerServer({
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

test("rule refresh execution is disabled by default", () => {
  const config = loadConfig({});
  assert.equal(config.ruleRefresh.executionEnabled, false);
  assert.equal(config.ruleRefresh.workerConcurrency, 1);
  assert.equal(config.ruleRefresh.targetConcurrency, 4);
  assert.equal(config.ruleRefresh.scheduleEnabled, false);
  assert.equal(config.ruleRefresh.scheduleIntervalMs, 60 * 1000);
  assert.equal(config.ruleRefresh.scheduleDay, 1);
  assert.equal(config.ruleRefresh.scheduleStartHour, 3);
  assert.equal(config.ruleRefresh.scheduleEndHour, 4);
  assert.equal(config.ruleRefresh.scheduleTimeZone, "Asia/Shanghai");
});

test("monthly rule refresh scheduling cannot run while rule refresh is disabled", async () => {
  await assert.rejects(
    startRuleRefreshWorkerServer({
      runtimeMode: "cloud",
      databaseUrl: "postgres://runtime",
      redisUrl: "redis://runtime",
      appId: "app",
      appSecret: "secret",
      cloudEncryptionKey: "key",
      ruleRefresh: {
        executionEnabled: false,
        scheduleEnabled: true,
      },
    }),
    /定时调度必须同时启用规则刷新/,
  );
});
