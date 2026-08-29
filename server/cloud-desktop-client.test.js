import assert from "node:assert/strict";
import test from "node:test";
import {
  CloudDesktopClient,
  CloudDesktopClientError,
} from "./cloud-desktop-client.js";

function createMemoryVault() {
  let value = {
    installationId: "install-1",
    session: null,
  };
  return {
    getOrCreateInstallation() {
      return structuredClone(value);
    },
    saveSession(session) {
      value = { ...value, session: structuredClone(session) };
    },
    clearSession() {
      value = { ...value, session: null };
    },
    inspect() {
      return structuredClone(value);
    },
  };
}

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("desktop enrollment stores the token locally but returns only public status", async () => {
  const vault = createMemoryVault();
  let request = null;
  const client = new CloudDesktopClient({
    baseUrl: "https://api.example.test/",
    vault,
    async fetchImpl(url, options) {
      request = { url, options };
      return jsonResponse(200, {
        accessToken: "scs_secret",
        tokenType: "Bearer",
        expiresAt: "2026-08-30T00:00:00.000Z",
        tenant: { id: "tenant-1", name: "测试租户" },
        device: { id: "device-1", name: "测试电脑" },
      });
    },
  });

  const status = await client.enroll({
    code: "SHEIN-ONE-TIME",
    deviceName: "测试电脑",
  });

  assert.equal(request.url, "https://api.example.test/v1/auth/enroll");
  assert.deepEqual(JSON.parse(request.options.body), {
    code: "SHEIN-ONE-TIME",
    deviceName: "测试电脑",
    installationId: "install-1",
  });
  assert.equal(vault.inspect().session.accessToken, "scs_secret");
  assert.equal(JSON.stringify(status).includes("scs_secret"), false);
  assert.equal(status.connected, true);
});

test("desktop verification sends the bearer token only from the local proxy", async () => {
  const vault = createMemoryVault();
  vault.saveSession({
    accessToken: "scs_secret",
    tokenType: "Bearer",
  });
  let authorization = null;
  const client = new CloudDesktopClient({
    baseUrl: "https://api.example.test",
    vault,
    async fetchImpl(_url, options) {
      authorization = options.headers.Authorization;
      return jsonResponse(200, {
        authenticated: true,
        expiresAt: "2026-08-30T00:00:00.000Z",
        tenant: { id: "tenant-1", name: "测试租户" },
        device: { id: "device-1", name: "测试电脑" },
      });
    },
  });

  const status = await client.verify();

  assert.equal(authorization, "Bearer scs_secret");
  assert.equal(status.verified, true);
  assert.equal(JSON.stringify(status).includes("scs_secret"), false);
});

test("desktop webhook audit query sends tenant token without exposing it", async () => {
  const vault = createMemoryVault();
  vault.saveSession({ accessToken: "scs_secret" });
  let request = null;
  const client = new CloudDesktopClient({
    baseUrl: "https://api.example.test",
    vault,
    async fetchImpl(url, options) {
      request = { url, options };
      return jsonResponse(200, {
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
      });
    },
  });

  const result = await client.listWebhookAudits({
    supplierId: "123",
    limit: 50,
  });

  assert.equal(
    request.url,
    "https://api.example.test/v1/webhook-audits?supplierId=123&limit=50",
  );
  assert.equal(request.options.headers.Authorization, "Bearer scs_secret");
  assert.equal(result.items[0].projection.records[0].skcName, "SKC-1");
  assert.equal(JSON.stringify(result).includes("scs_secret"), false);
});

test("desktop SHEIN authorization binds the installation and saves the returned session", async () => {
  const vault = createMemoryVault();
  const requests = [];
  const client = new CloudDesktopClient({
    baseUrl: "https://api.example.test",
    vault,
    async fetchImpl(url, options) {
      requests.push({ url, options });
      if (url.endsWith("/v1/shein/auth/start")) {
        return jsonResponse(200, {
          authorizationUrl: "https://authorize.example.test",
          state: "sha-state",
          expiresAt: "2026-07-30T12:10:00.000Z",
        });
      }
      return jsonResponse(200, {
        accessToken: "scs-secret",
        tokenType: "Bearer",
        expiresAt: "2026-08-30T00:00:00.000Z",
        tenant: { id: "tenant-1", name: "测试租户" },
        device: { id: "device-1", name: "测试电脑" },
        store: {
          openKeyId: "OPEN-1",
          secretKey: "STORE-SECRET",
          supplierId: "123",
        },
      });
    },
  });

  const start = await client.startSheinAuthorization({
    deviceName: "测试电脑",
  });
  const completed = await client.completeSheinAuthorization({
    state: "sha-state",
    tempToken: "temp-token",
    deviceName: "测试电脑",
  });

  assert.equal(start.authorizationUrl, "https://authorize.example.test");
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    installationId: "install-1",
    deviceName: "测试电脑",
  });
  assert.deepEqual(JSON.parse(requests[1].options.body), {
    state: "sha-state",
    tempToken: "temp-token",
    deviceName: "测试电脑",
    installationId: "install-1",
  });
  assert.equal(vault.inspect().session.accessToken, "scs-secret");
  assert.equal(completed.status.connected, true);
  assert.equal(completed.store.secretKey, "STORE-SECRET");
  assert.equal(
    JSON.stringify(completed.status).includes("scs-secret"),
    false,
  );
});

test("desktop client requires enrollment before authenticated requests", async () => {
  const client = new CloudDesktopClient({
    baseUrl: "https://api.example.test",
    vault: createMemoryVault(),
    async fetchImpl() {
      throw new Error("request must not be sent");
    },
  });

  await assert.rejects(
    () => client.verify(),
    (error) =>
      error instanceof CloudDesktopClientError &&
      error.status === 401 &&
      error.code === "CLOUD_NOT_CONNECTED",
  );
});

test("desktop disconnect keeps the local token when cloud logout can be retried", async () => {
  const vault = createMemoryVault();
  vault.saveSession({ accessToken: "scs_secret" });
  const client = new CloudDesktopClient({
    baseUrl: "https://api.example.test",
    vault,
    async fetchImpl() {
      return jsonResponse(503, {
        code: "TEMPORARY_FAILURE",
        msg: "暂时不可用",
      });
    },
  });

  await assert.rejects(() => client.disconnect());
  assert.equal(vault.inspect().session.accessToken, "scs_secret");
});

test("desktop disconnect clears an invalid local token after cloud returns 401", async () => {
  const vault = createMemoryVault();
  vault.saveSession({ accessToken: "scs_expired" });
  const client = new CloudDesktopClient({
    baseUrl: "https://api.example.test",
    vault,
    async fetchImpl() {
      return jsonResponse(401, {
        code: "UNAUTHORIZED",
        msg: "访问令牌无效、已过期或已撤销",
      });
    },
  });

  const status = await client.disconnect();

  assert.equal(vault.inspect().session, null);
  assert.equal(status.connected, false);
});
