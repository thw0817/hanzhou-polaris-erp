import assert from "node:assert/strict";
import test from "node:test";
import {
  SheinDeviceAuthorizationService,
  SHEIN_AUTHORIZATION_TOKEN_PATH,
} from "./shein-device-authorization.js";

function createService(overrides = {}) {
  return new SheinDeviceAuthorizationService({
    pool: overrides.pool || { async query() { return { rows: [] }; } },
    appId: "APP-1",
    appSecret: "APP-SECRET",
    apiBaseUrl: "https://openapi.example.test",
    authorizationHost: "authorize.example.test",
    redirectUrl: "http://127.0.0.1:5173/",
    storeRepository: overrides.storeRepository || {},
    deviceAuth: overrides.deviceAuth || {},
    requestSheinImpl: overrides.requestSheinImpl,
    decryptStoreSecretKeyImpl: overrides.decryptStoreSecretKeyImpl,
    now: overrides.now || (() => new Date("2026-07-30T12:00:00.000Z")),
    randomBytes:
      overrides.randomBytes || ((length) => Buffer.alloc(length, 9)),
  });
}

test("SHEIN authorization start persists only hashed state and installation", async () => {
  let insert = null;
  const service = createService({
    pool: {
      async query(sql, values) {
        insert = { sql, values };
        return { rows: [] };
      },
    },
  });

  const result = await service.start({
    installationId: "install-secret",
    deviceName: "运营电脑",
  });

  assert.match(result.state, /^sha_[A-Za-z0-9_-]+$/);
  assert.equal(
    result.authorizationUrl.startsWith(
      "https://authorize.example.test/#/empower?",
    ),
    true,
  );
  assert.equal(insert.sql.includes("shein_authorization_attempts"), true);
  assert.equal(Buffer.isBuffer(insert.values[0]), true);
  assert.equal(Buffer.isBuffer(insert.values[1]), true);
  assert.equal(
    insert.values.some((value) => value === result.state),
    false,
  );
  assert.equal(
    insert.values.some((value) => value === "install-secret"),
    false,
  );
});

test("SHEIN authorization completion exchanges credentials and issues a device session", async () => {
  const queries = [];
  const pool = {
    async query(sql, values) {
      queries.push({ sql, values });
      if (sql.includes("UPDATE shein_authorization_attempts") &&
          sql.includes("status = 'exchanging'")) {
        return {
          rows: [{
            id: "attempt-1",
            device_name: "保存的电脑名",
            expires_at: "2026-07-30T12:10:00.000Z",
          }],
        };
      }
      if (sql.includes("INSERT INTO tenants")) {
        return { rows: [{ id: "tenant-new", name: "SHEIN 店铺 123" }] };
      }
      if (sql.includes("SELECT id, name FROM tenants")) {
        return { rows: [{ id: "tenant-1", name: "已有工作空间" }] };
      }
      return { rows: [] };
    },
  };
  let exchange = null;
  let stored = null;
  let issued = null;
  const service = createService({
    pool,
    async requestSheinImpl(input) {
      exchange = input;
      return {
        payload: {
          info: {
            openKeyId: "OPEN-1",
            secretKey: "encrypted-secret",
            supplierId: 123,
            supplierBusinessMode: "SFS",
          },
        },
        diagnostics: { traceId: "trace-1" },
      };
    },
    decryptStoreSecretKeyImpl(value, appSecret) {
      assert.equal(value, "encrypted-secret");
      assert.equal(appSecret, "APP-SECRET");
      return "STORE-SECRET";
    },
    storeRepository: {
      async upsertAuthorizedStore(input) {
        stored = input;
        return {
          id: "store-1",
          tenant_id: "tenant-1",
          label: input.label,
          business_mode: input.businessMode,
        };
      },
    },
    deviceAuth: {
      async issueAuthorizedSession(input) {
        issued = input;
        return {
          accessToken: "scs-secret",
          tokenType: "Bearer",
          expiresAt: "2026-08-30T00:00:00.000Z",
          tenant: { id: "tenant-1", name: input.tenantName },
          device: { id: "device-1", name: input.deviceName },
        };
      },
    },
  });

  const result = await service.complete({
    state: "sha-state",
    tempToken: "temp-token",
    installationId: "install-1",
    deviceName: "当前电脑",
  });

  assert.equal(exchange.path, SHEIN_AUTHORIZATION_TOKEN_PATH);
  assert.equal(exchange.identityHeader, "x-lt-appid");
  assert.deepEqual(exchange.body, { tempToken: "temp-token" });
  assert.equal(stored.openKeyId, "OPEN-1");
  assert.equal(stored.secretKey, "STORE-SECRET");
  assert.equal(issued.tenantId, "tenant-1");
  assert.equal(issued.installationId, "install-1");
  assert.equal(result.accessToken, "scs-secret");
  assert.equal(result.store.secretKey, "STORE-SECRET");
  assert.equal(result.diagnostics.traceId, "trace-1");
  assert.equal(
    queries.some((item) => item.sql.includes("status = 'completed'")),
    true,
  );
});
