import assert from "node:assert/strict";
import test from "node:test";
import { startWebhookWorkerServer } from "./webhook-worker-server.js";

test("webhook worker server can be imported without a CLI entry path", () => {
  assert.equal(typeof startWebhookWorkerServer, "function");
});

test("webhook worker server rejects non-cloud configuration before connecting", async () => {
  await assert.rejects(
    startWebhookWorkerServer({
      runtimeMode: "local",
      databaseUrl: "",
      redisUrl: "",
    }),
    /SHEIN_RUNTIME_MODE=cloud/,
  );
});
