import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../config.js";
import { startProductPublishWorkerServer } from "./product-publish-worker-server.js";

test("product publish execution is disabled by default", () => {
  const config = loadConfig({});
  assert.equal(config.productPublish.executionEnabled, false);
  assert.equal(config.productPublish.workerConcurrency, 1);
});

test("product publish worker rejects non-cloud configuration before connecting", async () => {
  await assert.rejects(
    startProductPublishWorkerServer({
      runtimeMode: "local",
      productPublish: { executionEnabled: true },
    }),
    /SHEIN_RUNTIME_MODE=cloud/,
  );
});

test("product publish worker refuses to start while the execution switch is off", async () => {
  await assert.rejects(
    startProductPublishWorkerServer({
      runtimeMode: "cloud",
      productPublish: { executionEnabled: false },
    }),
    /总开关未启用/,
  );
});

test("product publish worker refuses to start without the durable outbox dispatcher", async () => {
  await assert.rejects(
    startProductPublishWorkerServer({
      runtimeMode: "cloud",
      productPublish: { executionEnabled: true },
      outboxDispatcher: { enabled: false },
    }),
    /Outbox Dispatcher 总开关未启用/,
  );
});

test("product publish worker requires database, Redis and credential decryption", async () => {
  await assert.rejects(
    startProductPublishWorkerServer({
      runtimeMode: "cloud",
      databaseUrl: "",
      redisUrl: "",
      cloudEncryptionKey: "",
      productPublish: { executionEnabled: true, workerConcurrency: 1 },
      outboxDispatcher: { enabled: true },
    }),
    /PostgreSQL、Redis 或店铺凭证解密配置/,
  );
});
