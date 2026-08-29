import test from "node:test";
import assert from "node:assert/strict";
import { WebTodayWorkService } from "./today-work-service.js";

function poolFor(rowsByKey) {
  const calls = [];
  return {
    calls,
    async query(input) {
      const text = typeof input === "string" ? input : input.text;
      calls.push({ text, values: typeof input === "string" ? [] : input.values });
      for (const [key, rows] of Object.entries(rowsByKey)) {
        if (text.includes(key)) return { rows, rowCount: rows.length };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

test("today work aggregates only accessible stores and keeps category and activity detail", async () => {
  const pool = poolFor({
    "today_work_publish_summary": [
      { store_id: "store-1", category: "地毯", count: "2" },
      { store_id: "store-2", category: "门垫", count: "1" },
    ],
    "today_work_price_summary": [
      { store_id: "store-1", operation: "web.price.accept", count: "3" },
      { store_id: "store-1", operation: "web.price.reject", count: "1" },
    ],
    "today_work_rejection_summary": [
      { store_id: "store-2", category: "地毯", count: "2" },
    ],
    "today_work_sample_summary": [
      { store_id: "store-1", count: "1" },
    ],
    "today_work_activity_feed": [
      { store_id: "store-1", event_type: "发布提交", title: "商品 A", occurred_at: "2026-08-25T02:00:00.000Z" },
    ],
  });
  const service = new WebTodayWorkService({ pool, now: () => new Date("2026-08-25T05:00:00.000Z") });
  const result = await service.list({
    context: { tenantId: "tenant-1", userId: "user-1", role: "operator" },
    stores: [
      { id: "store-1", label: "A店" },
      { id: "store-2", label: "B店" },
    ],
    date: "2026-08-25",
  });

  assert.deepEqual(result.totals, {
    published: 3,
    priceAccepted: 3,
    rejected: 2,
    sampled: 1,
  });
  assert.equal(result.stores[0].storeId, "store-1");
  assert.deepEqual(result.stores[0].categories, [{ name: "地毯", published: 2, rejected: 0 }]);
  assert.equal(result.activity[0].type, "发布提交");
  assert.equal(pool.calls.every(({ values }) => values.some((value) => Array.isArray(value) && value.includes("store-1") && value.includes("store-2"))), true);
  const publishQuery = pool.calls.find(({ text }) => text.includes("today_work_publish_summary"));
  assert.match(publishQuery.text, /SELECT job\.store_id/);
  assert.match(publishQuery.text, /GROUP BY job\.store_id/);
  const activityQuery = pool.calls.find(({ text }) => text.includes("today_work_activity_feed"));
  assert.match(activityQuery.text, /webhook_events_feed/);
  assert.match(activityQuery.text, /发品额度变更/);
});

test("today work does not query when no stores are visible", async () => {
  const pool = poolFor({});
  const service = new WebTodayWorkService({ pool });
  const result = await service.list({
    context: { tenantId: "tenant-1", userId: "user-1", role: "operator" },
    stores: [],
    date: "2026-08-25",
  });
  assert.deepEqual(result.totals, { published: 0, priceAccepted: 0, rejected: 0, sampled: 0 });
  assert.equal(pool.calls.length, 0);
});
