import assert from "node:assert/strict";
import test from "node:test";
import {
  createFixedWindowRateLimiter,
  generateAccessToken,
  generateEnrollmentCode,
  hashOpaqueSecret,
  parseBearerToken,
  PostgresDeviceAuthService,
} from "./device-auth.js";

function deterministicBytes(length) {
  return Buffer.alloc(length, 7);
}

test("device auth generates separate enrollment and access token formats", () => {
  const enrollmentCode = generateEnrollmentCode(deterministicBytes);
  const accessToken = generateAccessToken(deterministicBytes);

  assert.match(enrollmentCode, /^SHEIN-[A-Za-z0-9_-]+$/);
  assert.match(accessToken, /^scs_[A-Za-z0-9_-]+$/);
  assert.notEqual(enrollmentCode, accessToken);
});

test("device auth persists only deterministic opaque secret hashes", () => {
  const first = hashOpaqueSecret("scs_private");
  const second = hashOpaqueSecret("scs_private");
  const different = hashOpaqueSecret("scs_other");

  assert.equal(first.length, 32);
  assert.deepEqual(first, second);
  assert.notDeepEqual(first, different);
  assert.equal(first.includes(Buffer.from("scs_private")), false);
});

test("device auth accepts only a strict bearer token", () => {
  assert.equal(parseBearerToken("Bearer scs_abc-123"), "scs_abc-123");
  assert.equal(parseBearerToken("bearer scs_abc"), null);
  assert.equal(parseBearerToken("Bearer token with spaces"), null);
  assert.equal(parseBearerToken(undefined), null);
});

test("fixed-window enrollment limiter blocks attempts above the limit", () => {
  let currentTime = 1_000;
  const limiter = createFixedWindowRateLimiter({
    limit: 2,
    windowMs: 5_000,
    now: () => currentTime,
  });

  assert.equal(limiter.consume("client").allowed, true);
  assert.equal(limiter.consume("client").allowed, true);
  const blocked = limiter.consume("client");
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 5);

  currentTime += 5_000;
  assert.equal(limiter.consume("client").allowed, true);
});

test("device auth casts heartbeat timestamps before interval arithmetic", async () => {
  const now = new Date("2026-07-31T09:50:00.000Z");
  const queries = [];
  const pool = {
    async query(text, values) {
      queries.push({ text, values });
      if (text.includes("FROM device_sessions ds")) {
        return {
          rows: [
            {
              session_id: "session-1",
              expires_at: "2026-08-30T09:50:00.000Z",
              device_id: "device-1",
              device_name: "运营电脑",
              tenant_id: "tenant-1",
              device_status: "active",
              tenant_name: "测试工作空间",
              tenant_status: "active",
            },
          ],
        };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  const service = new PostgresDeviceAuthService({
    pool,
    now: () => now,
  });

  const context = await service.authenticate("scs_valid");

  assert.equal(context.tenantId, "tenant-1");
  const heartbeatQueries = queries.filter(({ text }) =>
    text.includes("last_seen_at <"),
  );
  assert.equal(heartbeatQueries.length, 2);
  for (const { text, values } of heartbeatQueries) {
    assert.match(
      text,
      /\$2::timestamptz - interval '15 minutes'/,
    );
    assert.equal(values[1], now);
  }
});
