import assert from "node:assert/strict";
import test from "node:test";
import {
  startStoreBusinessRefreshScheduleLoop,
  StoreBusinessRefreshScheduler,
} from "./store-business-refresh-scheduler.js";

function createPool({ acquired = true, stores = [], listError = null } = {}) {
  const queries = [];
  let released = false;
  const client = {
    async query(input) {
      queries.push(input);
      const text = typeof input === "string" ? input : input.text;
      if (text.includes("pg_try_advisory_lock")) {
        return { rows: [{ acquired }] };
      }
      if (text.includes("pg_advisory_unlock")) {
        return { rows: [{ unlocked: true }] };
      }
      if (listError) throw listError;
      return { rows: stores };
    },
    release() { released = true; },
  };
  return {
    pool: { async connect() { return client; } },
    queries,
    wasReleased: () => released,
  };
}

test("store business scheduler does no work when another instance owns the lock", async () => {
  const database = createPool({ acquired: false });
  let refreshes = 0;
  const scheduler = new StoreBusinessRefreshScheduler({
    pool: database.pool,
    service: { async startRefresh() { refreshes += 1; } },
  });

  const result = await scheduler.runOnce();

  assert.deepEqual(result, {
    acquired: false,
    scanned: 0,
    enqueued: 0,
    reused: 0,
    failed: 0,
  });
  assert.equal(refreshes, 0);
  assert.equal(database.wasReleased(), true);
});

test("store business scheduler enqueues each due store with scheduler context", async () => {
  const database = createPool({
    stores: [
      { tenant_id: "tenant-1", store_id: "store-1" },
      { tenant_id: "tenant-1", store_id: "store-2" },
      { tenant_id: "tenant-2", store_id: "store-3" },
    ],
  });
  const calls = [];
  const scheduler = new StoreBusinessRefreshScheduler({
    pool: database.pool,
    now: () => new Date("2026-08-04T12:00:00.000Z"),
    staleAfterMs: 15 * 60 * 1000,
    service: {
      async startRefresh(input) {
        calls.push(input);
        if (input.storeId === "store-2") return { started: false };
        if (input.storeId === "store-3") throw new Error("redis unavailable");
        return { started: true };
      },
    },
  });

  const result = await scheduler.runOnce();

  assert.deepEqual(result, {
    acquired: true,
    scanned: 3,
    enqueued: 1,
    reused: 1,
    failed: 1,
  });
  assert.deepEqual(calls[0], {
    context: { tenantId: "tenant-1", userId: null, trigger: "scheduler" },
    storeId: "store-1",
  });
  const storeQuery = database.queries.find((query) =>
    typeof query !== "string" && query.text.includes("FROM stores store"));
  assert.equal(storeQuery.values[0].toISOString(), "2026-08-04T11:45:00.000Z");
  assert.match(storeQuery.text, /tenant\.status = 'active'/);
  assert.match(storeQuery.text, /store\.status = 'active'/);
  assert.match(storeQuery.text, /JOIN store_credentials/);
  assert.ok(database.queries.some((query) =>
    String(typeof query === "string" ? query : query.text).includes("pg_advisory_unlock")));
  assert.equal(database.wasReleased(), true);
});

test("store business scheduler releases its lock after a database failure", async () => {
  const database = createPool({ listError: new Error("database unavailable") });
  const scheduler = new StoreBusinessRefreshScheduler({
    pool: database.pool,
    service: { async startRefresh() {} },
  });

  await assert.rejects(scheduler.runOnce(), /database unavailable/);

  assert.ok(database.queries.some((query) =>
    String(typeof query === "string" ? query : query.text).includes("pg_advisory_unlock")));
  assert.equal(database.wasReleased(), true);
});

test("schedule loop runs immediately, avoids overlap and closes cleanly", async () => {
  let runs = 0;
  let resolveFirst;
  let intervalCallback = null;
  let clearedTimer = null;
  const results = [];
  const loop = startStoreBusinessRefreshScheduleLoop({
    scheduler: {
      async runOnce() {
        runs += 1;
        if (runs === 1) {
          return new Promise((resolve) => { resolveFirst = resolve; });
        }
        return { scanned: 0 };
      },
    },
    intervalMs: 900_000,
    onResult: (result) => results.push(result),
    setIntervalFn(callback, intervalMs) {
      assert.equal(intervalMs, 900_000);
      intervalCallback = callback;
      return "timer-1";
    },
    clearIntervalFn(timer) { clearedTimer = timer; },
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runs, 1);
  assert.equal(intervalCallback(), loop.ready);
  assert.equal(runs, 1);
  resolveFirst({ scanned: 2 });
  await loop.ready;
  await intervalCallback();
  assert.equal(runs, 2);

  await loop.close();
  assert.equal(clearedTimer, "timer-1");
  assert.deepEqual(results, [{ scanned: 2 }, { scanned: 0 }]);
});
