import assert from "node:assert/strict";
import test from "node:test";
import {
  WebSheinAuthorizationService,
  WEB_SHEIN_AUTHORIZATION_TOKEN_PATH,
} from "./web-shein-authorization.js";

function createService(overrides = {}) {
  return new WebSheinAuthorizationService({
    pool: overrides.pool || { async query() { return { rows: [] }; } },
    appId: "APP-1",
    appSecret: "APP-SECRET",
    apiBaseUrl: "https://openapi.example.test",
    authorizationHost: "authorize.example.test",
    redirectUrl: "https://app.example.test/v1/web/shein/auth/callback",
    storeRepository: overrides.storeRepository || {},
    requestSheinImpl: overrides.requestSheinImpl,
    decryptStoreSecretKeyImpl: overrides.decryptStoreSecretKeyImpl,
    now: overrides.now || (() => new Date("2026-08-02T12:00:00.000Z")),
    randomBytes: overrides.randomBytes || ((length) => Buffer.alloc(length, 4)),
  });
}

test("web SHEIN authorization start binds hashed state to tenant and user", async () => {
  let inserted = null;
  const service = createService({
    pool: {
      async query(sql, values) {
        inserted = { sql, values };
        return { rows: [] };
      },
    },
  });

  const result = await service.start({ tenantId: "tenant-1", userId: "user-1" });

  assert.match(result.authorizationUrl, /^https:\/\/authorize\.example\.test\/#\/empower\?/);
  assert.equal(result.authorizationUrl.includes("shw_"), true);
  assert.equal(inserted.sql.includes("flow_type"), true);
  assert.equal(inserted.values.includes("tenant-1"), true);
  assert.equal(inserted.values.includes("user-1"), true);
  assert.equal(inserted.values.some((value) => String(value).startsWith("shw_")), false);
});

test("web SHEIN authorization stores encrypted credentials and grants only the authorizing user", async () => {
  const queries = [];
  const pool = {
    async query(sql, values) {
      queries.push({ sql, values });
      if (sql.includes("status = 'exchanging'")) {
        return {
          rows: [{
            id: "attempt-1",
            tenant_id: "tenant-1",
            user_id: "user-1",
            expires_at: "2026-08-02T12:10:00.000Z",
          }],
        };
      }
      return { rows: [], rowCount: 1 };
    },
  };
  let stored = null;
  let exchanged = null;
  const service = createService({
    pool,
    async requestSheinImpl(input) {
      exchanged = input;
      return {
        payload: {
          info: {
            openKeyId: "OPEN-1",
            secretKey: "encrypted-store-secret",
            supplierId: "supplier-1",
            supplierBusinessMode: "全托管",
          },
        },
        diagnostics: { traceId: "trace-1" },
      };
    },
    decryptStoreSecretKeyImpl(value, appSecret) {
      assert.equal(value, "encrypted-store-secret");
      assert.equal(appSecret, "APP-SECRET");
      return "STORE-SECRET";
    },
    storeRepository: {
      async upsertAuthorizedStore(input) {
        stored = input;
        return {
          id: "store-1",
          label: input.label,
          business_mode: input.businessMode,
          status: "active",
        };
      },
    },
  });

  const result = await service.complete({ state: "shw-state", tempToken: "temp-1" });

  assert.equal(exchanged.path, WEB_SHEIN_AUTHORIZATION_TOKEN_PATH);
  assert.deepEqual(exchanged.body, { tempToken: "temp-1" });
  assert.equal(stored.tenantId, "tenant-1");
  assert.equal(stored.authorizedBy, "user-1");
  assert.equal(stored.secretKey, "STORE-SECRET");
  assert.equal(
    queries.some((entry) => entry.sql.includes("membership_store_access") &&
      entry.values.includes("user-1") && entry.values.includes("store-1")),
    true,
  );
  assert.equal(JSON.stringify(result).includes("STORE-SECRET"), false);
  assert.equal(JSON.stringify(result).includes("OPEN-1"), false);
  assert.equal(result.store.id, "store-1");
});

