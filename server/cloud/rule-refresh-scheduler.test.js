import assert from "node:assert/strict";
import test from "node:test";
import {
  RuleRefreshScheduler,
  startRuleRefreshScheduleLoop,
} from "./rule-refresh-scheduler.js";

function createPool({ acquired = true, stores = [], expired = false } = {}) {
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
      return { rows: stores };
    },
    release() { released = true; },
  };
  return {
    pool: {
      async connect() { return client; },
      async query(input) {
        queries.push(input);
        return { rows: [{ expired }] };
      },
    },
    queries,
    wasReleased: () => released,
  };
}

test("monthly rule scheduler does nothing outside its configured window", async () => {
  const database = createPool();
  let refreshes = 0;
  const scheduler = new RuleRefreshScheduler({
    pool: database.pool,
    service: { async startRefresh() { refreshes += 1; } },
    now: () => new Date("2026-08-22T02:30:00.000Z"),
    timeZone: "Asia/Shanghai",
    day: 22,
    startHour: 3,
    endHour: 4,
  });

  const result = await scheduler.runOnce();

  assert.deepEqual(result, {
    due: false,
    acquired: false,
    scanned: 0,
    enqueued: 0,
    reused: 0,
    skipped: 0,
    failed: 0,
  });
  assert.equal(refreshes, 0);
  assert.equal(database.queries.length, 1);
});

test("monthly rule scheduler enqueues one all-category refresh per eligible store", async () => {
  const database = createPool({
    stores: [
      { tenant_id: "tenant-1", store_id: "store-1", has_full_refresh: false },
      { tenant_id: "tenant-1", store_id: "store-2", has_full_refresh: true },
      { tenant_id: "tenant-2", store_id: "store-3", has_full_refresh: false },
    ],
  });
  const calls = [];
  const scheduler = new RuleRefreshScheduler({
    pool: database.pool,
    service: {
      async startRefresh(input) {
        calls.push(input);
        if (input.storeId === "store-3") throw new Error("redis unavailable");
        return input.storeId === "store-1"
          ? { started: true }
          : { started: false };
      },
    },
    now: () => new Date("2026-08-22T19:15:00.000Z"),
    timeZone: "Asia/Shanghai",
    day: 23,
    startHour: 3,
    endHour: 4,
  });

  const result = await scheduler.runOnce();

  assert.deepEqual(result, {
    due: true,
    acquired: true,
    scanned: 3,
    enqueued: 1,
    reused: 0,
    skipped: 1,
    failed: 1,
  });
  assert.deepEqual(calls, [
    {
      context: {
        tenantId: "tenant-1",
        userId: null,
        trigger: "monthly-rule-refresh",
      },
      storeId: "store-1",
      scope: "all",
    },
    {
      context: {
        tenantId: "tenant-2",
        userId: null,
        trigger: "monthly-rule-refresh",
      },
      storeId: "store-3",
      scope: "all",
    },
  ]);
  assert.ok(database.queries.some((query) =>
    String(typeof query === "string" ? query : query.text)
      .includes("pg_try_advisory_lock")));
  assert.ok(database.queries.some((query) =>
    String(typeof query === "string" ? query : query.text)
      .includes("sync_jobs")));
  const lockQueries = database.queries.filter((query) =>
    String(typeof query === "string" ? query : query.text)
      .includes("pg_")
  );
  assert.equal(lockQueries[0].values[0], lockQueries[1].values[0]);
  assert.ok(database.queries.some((query) =>
    String(typeof query === "string" ? query : query.text)
      .includes("prune_shein_rule_snapshots")));
  assert.equal(database.wasReleased(), true);
});

test("expired snapshot scheduler releases the same advisory lock key it acquired", async () => {
  const database = createPool({ stores: [], expired: true });
  const scheduler = new RuleRefreshScheduler({
    pool: database.pool,
    service: { async startRefresh() {} },
    now: () => new Date("2026-08-22T19:15:00.000Z"),
    timeZone: "Asia/Shanghai",
    day: 24,
    startHour: 3,
    endHour: 4,
  });

  await scheduler.runOnce();
  const lockQueries = database.queries.filter((query) =>
    String(typeof query === "string" ? query : query.text)
      .includes("pg_")
  );
  assert.equal(lockQueries.length, 2);
  assert.equal(lockQueries[0].values[0], lockQueries[1].values[0]);
  assert.match(lockQueries[0].values[0], /:expired$/);
});

test("monthly rule scheduler does no work when another instance owns the lock", async () => {
  const database = createPool({ acquired: false });
  let refreshes = 0;
  const scheduler = new RuleRefreshScheduler({
    pool: database.pool,
    service: { async startRefresh() { refreshes += 1; } },
    now: () => new Date("2026-08-22T19:15:00.000Z"),
    timeZone: "Asia/Shanghai",
    day: 23,
    startHour: 3,
    endHour: 4,
  });

  const result = await scheduler.runOnce();

  assert.deepEqual(result, {
    due: true,
    acquired: false,
    scanned: 0,
    enqueued: 0,
    reused: 0,
    skipped: 0,
    failed: 0,
  });
  assert.equal(refreshes, 0);
  assert.equal(database.wasReleased(), true);
});

test("monthly rule schedule loop runs immediately, avoids overlap and closes cleanly", async () => {
  let runs = 0;
  let resolveFirst;
  let intervalCallback = null;
  let clearedTimer = null;
  const results = [];
  const loop = startRuleRefreshScheduleLoop({
    scheduler: {
      async runOnce() {
        runs += 1;
        if (runs === 1) {
          return new Promise((resolve) => { resolveFirst = resolve; });
        }
        return { due: false };
      },
    },
    intervalMs: 60_000,
    onResult: (result) => results.push(result),
    setIntervalFn(callback, intervalMs) {
      assert.equal(intervalMs, 60_000);
      intervalCallback = callback;
      return "timer-1";
    },
    clearIntervalFn(timer) { clearedTimer = timer; },
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runs, 1);
  assert.equal(intervalCallback(), loop.ready);
  assert.equal(runs, 1);
  resolveFirst({ due: true });
  await loop.ready;
  await intervalCallback();
  assert.equal(runs, 2);

  await loop.close();
  assert.equal(clearedTimer, "timer-1");
  assert.deepEqual(results, [{ due: true }, { due: false }]);
});
