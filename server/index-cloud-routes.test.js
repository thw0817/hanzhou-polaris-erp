import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { loadConfig } from "./config.js";
import { createSheinProxy } from "./index.js";

async function invoke(server, {
  method = "GET",
  url = "/",
  body = undefined,
} = {}) {
  const headers = { host: "127.0.0.1" };
  if (body !== undefined) headers["content-type"] = "application/json";
  const request = Readable.from(
    body === undefined ? [] : [Buffer.from(JSON.stringify(body), "utf8")],
  );
  Object.assign(request, { method, url, headers });
  return new Promise((resolve) => {
    const response = {
      status: null,
      headers: null,
      writeHead(status, responseHeaders) {
        this.status = status;
        this.headers = responseHeaders;
      },
      end(responseBody) {
        resolve({
          status: this.status,
          headers: this.headers,
          body: JSON.parse(responseBody || "{}"),
        });
      },
    };
    server.emit("request", request, response);
  });
}

async function withServer(cloudClient, run, env = {}) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "shein-index-cloud-"));
  const server = createSheinProxy({
    config: loadConfig({
      ...env,
      SHEIN_CLOUD_API_BASE_URL: "https://api.example.test",
      SHEIN_CREDENTIAL_FILE: path.join(directory, "stores.json"),
      SHEIN_CREDENTIAL_KEY_FILE: path.join(directory, "stores.key"),
      SHEIN_TEMPLATE_FILE: path.join(directory, "templates.json"),
      SHEIN_SCHEMA_CACHE_FILE: path.join(directory, "schemas.json"),
      SHEIN_BUSINESS_DATA_FILE: path.join(directory, "business.json"),
      SHEIN_SIZE_TEMPLATE_FILE: path.join(directory, "sizes.json"),
      SHEIN_ATTRIBUTE_TEMPLATE_FILE: path.join(directory, "attributes.json"),
      SHEIN_MAIN_IMAGE_TEMPLATE_FILE: path.join(directory, "main-images.json"),
      SHEIN_MAIN_IMAGE_ASSET_DIR: path.join(directory, "assets"),
    }),
    cloudClient,
  });
  try {
    await run(server);
  } finally {
    server.close();
  }
}

test("local cloud enrollment endpoint never exposes the access token", async () => {
  let received = null;
  await withServer(
    {
      getLocalStatus() {
        return { configured: true, connected: false };
      },
      async enroll(input) {
        received = input;
        return {
          configured: true,
          connected: true,
          tenant: { id: "tenant-1", name: "测试租户" },
          device: { id: "device-1", name: "测试电脑" },
          expiresAt: "2026-08-30T00:00:00.000Z",
          cloudBaseUrl: "https://api.example.test",
        };
      },
    },
    async (server) => {
      const response = await invoke(server, {
        method: "POST",
        url: "/api/cloud/enroll",
        body: {
          code: "SHEIN-ONE-TIME",
          deviceName: "测试电脑",
        },
      });
      const payload = response.body;

      assert.equal(response.status, 200);
      assert.deepEqual(received, {
        code: "SHEIN-ONE-TIME",
        deviceName: "测试电脑",
      });
      assert.equal(payload.connected, true);
      assert.equal("accessToken" in payload, false);
      assert.equal("tokenType" in payload, false);
    },
  );
});

test("local cloud routes support status, verification, and disconnect", async () => {
  const calls = [];
  const publicStatus = {
    configured: true,
    connected: true,
    tenant: { id: "tenant-1", name: "测试租户" },
    device: { id: "device-1", name: "测试电脑" },
    expiresAt: "2026-08-30T00:00:00.000Z",
    cloudBaseUrl: "https://api.example.test",
  };
  await withServer(
    {
      getLocalStatus() {
        calls.push("status");
        return publicStatus;
      },
      async verify() {
        calls.push("verify");
        return { ...publicStatus, verified: true };
      },
      async disconnect() {
        calls.push("disconnect");
        return { ...publicStatus, connected: false };
      },
    },
    async (server) => {
      const statusResponse = await invoke(server, {
        url: "/api/cloud/session",
      });
      assert.equal(statusResponse.body.connected, true);

      const verifyResponse = await invoke(server, {
        method: "POST",
        url: "/api/cloud/session/verify",
      });
      assert.equal(verifyResponse.body.verified, true);

      const disconnectResponse = await invoke(server, {
        method: "DELETE",
        url: "/api/cloud/session",
      });
      assert.equal(disconnectResponse.body.connected, false);
    },
  );

  assert.deepEqual(calls, ["status", "verify", "disconnect"]);
});

test("local webhook audit route forwards only public store filters", async () => {
  let received = null;
  await withServer(
    {
      getLocalStatus() {
        return { configured: true, connected: true };
      },
      async listWebhookAudits(input) {
        received = input;
        return {
          items: [
            {
              id: "event-1",
              projection: {
                records: [{ skcName: "SKC-1", auditStateLabel: "passed" }],
              },
            },
          ],
          hasMore: false,
          limit: 50,
        };
      },
    },
    async (server) => {
      const response = await invoke(server, {
        url: "/api/cloud/webhook-audits?supplierId=123&limit=50",
      });

      assert.equal(response.status, 200);
      assert.deepEqual(received, {
        supplierId: "123",
        limit: "50",
      });
      assert.equal(
        response.body.items[0].projection.records[0].skcName,
        "SKC-1",
      );
    },
  );
});

test("local automatic SHEIN authorization never returns store credentials to the browser", async () => {
  const calls = [];
  await withServer(
    {
      getLocalStatus() {
        return { configured: true, connected: false };
      },
      async startSheinAuthorization(input) {
        calls.push(["start", input]);
        return {
          authorizationUrl: "https://authorize.example.test",
          expiresAt: "2026-07-30T12:10:00.000Z",
        };
      },
      async completeSheinAuthorization(input) {
        calls.push(["complete", input]);
        return {
          status: {
            configured: true,
            connected: true,
            tenant: { id: "tenant-1", name: "测试租户" },
          },
          store: {
            supplierId: "123",
            openKeyId: "OPEN-1",
            secretKey: "STORE-SECRET",
            label: "测试店铺",
            businessMode: "全托管",
          },
          diagnostics: { traceId: "trace-1" },
        };
      },
    },
    async (server) => {
      const started = await invoke(server, {
        method: "POST",
        url: "/api/shein/cloud-auth/start",
        body: { deviceName: "测试电脑" },
      });
      const completed = await invoke(server, {
        method: "POST",
        url: "/api/shein/cloud-auth/complete",
        body: {
          deviceName: "测试电脑",
          state: "sha-state",
          tempToken: "temp-token",
        },
      });

      assert.equal(started.body.url, "https://authorize.example.test");
      assert.equal(completed.body.store.label, "测试店铺");
      assert.equal(
        JSON.stringify(completed.body).includes("STORE-SECRET"),
        false,
      );
      const stores = await invoke(server, {
        url: "/api/shein/stores",
      });
      assert.equal(stores.body.stores.length, 1);
    },
  );

  assert.deepEqual(calls, [
    ["start", { deviceName: "测试电脑" }],
    [
      "complete",
      {
        state: "sha-state",
        tempToken: "temp-token",
        deviceName: "测试电脑",
      },
    ],
  ]);
});

test("local direct authorization mode exposes the local auth contract", async () => {
  await withServer(
    null,
    async (server) => {
      const health = await invoke(server, { url: "/api/health" });
      const started = await invoke(server, {
        method: "POST",
        url: "/api/shein/auth/url",
        body: {},
      });

      assert.equal(health.status, 200);
      assert.equal(health.body.localDirectAuthEnabled, true);
      assert.equal(health.body.configured, true);
      assert.equal(started.status, 200);
      assert.match(started.body.url, /appid=APP-ID/);
      assert.equal(started.body.redirectUrl, "http://127.0.0.1:5173/");
      const authQuery = new URLSearchParams(started.body.url.split("?")[1]);
      assert.equal(
        Buffer.from(authQuery.get("redirectUrl"), "base64").toString("utf8"),
        "http://127.0.0.1:8787/api/shein/auth/callback",
      );
    },
    {
      SHEIN_APP_ID: "APP-ID",
      SHEIN_APP_SECRET: "APP-SECRET",
      SHEIN_LOCAL_DIRECT_AUTH: "true",
      SHEIN_REDIRECT_URL: "http://127.0.0.1:5173/",
    },
  );
});

test("local loopback callback completes authorization and redirects without credentials", async () => {
  await withServer(
    {
      getLocalStatus() {
        return { configured: true, connected: false };
      },
      async completeSheinAuthorization(input) {
        assert.deepEqual(input, {
          state: "sha-state",
          tempToken: "temp-token",
        });
        return {
          status: { configured: true, connected: true },
          store: {
            supplierId: "123",
            openKeyId: "OPEN-1",
            secretKey: "STORE-SECRET",
            label: "测试店铺",
            businessMode: "全托管",
          },
        };
      },
    },
    async (server) => {
      const response = await invoke(server, {
        url: "/api/shein/auth/callback?tempToken=temp-token&state=sha-state",
      });

      assert.equal(response.status, 302);
      assert.equal(
        response.headers.Location,
        "http://127.0.0.1:5173/?sheinAuthorized=1&storeLabel=%E6%B5%8B%E8%AF%95%E5%BA%97%E9%93%BA",
      );
      assert.equal(response.headers.Location.includes("STORE-SECRET"), false);
      assert.equal(response.headers.Location.includes("temp-token"), false);
    },
  );
});
