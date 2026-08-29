import assert from "node:assert/strict";
import test from "node:test";
import { processWebhookJob } from "./webhook-worker.js";

test("persists production projections but excludes them from the queue result", async () => {
  const calls = [];
  const eventStore = {
    async claim(id) {
      calls.push(["claim", id]);
      return { id, source: "production", payload: {} };
    },
    async saveProjection(id, projection) {
      calls.push(["saveProjection", id, projection]);
    },
    async markProcessed(id) {
      calls.push(["markProcessed", id]);
    },
    async markFailed(id, error) {
      calls.push(["markFailed", id, error.message]);
    },
  };
  const result = await processWebhookJob({
    job: { data: { eventId: "event-1" } },
    eventStore,
    processor: async () => ({
      projectionVersion: "v1",
      projection: { skcName: "sensitive-skc" },
      summary: { disposition: "read-only" },
    }),
  });

  assert.deepEqual(calls, [
    ["claim", "event-1"],
    [
      "saveProjection",
      "event-1",
      {
        projectionVersion: "v1",
        projection: { skcName: "sensitive-skc" },
      },
    ],
    ["markProcessed", "event-1"],
  ]);
  assert.equal(result.projection, undefined);
  assert.equal(JSON.stringify(result).includes("sensitive-skc"), false);
});

test("marks the event failed when projection persistence fails", async () => {
  const calls = [];
  const eventStore = {
    async claim(id) {
      return { id, source: "production", payload: {} };
    },
    async saveProjection() {
      throw new Error("projection unavailable");
    },
    async markProcessed() {
      calls.push("processed");
    },
    async markFailed(id, error) {
      calls.push(["failed", id, error.message]);
    },
  };

  await assert.rejects(
    processWebhookJob({
      job: { data: { eventId: "event-2" } },
      eventStore,
      processor: async () => ({
        projectionVersion: "v1",
        projection: { auditState: 2 },
      }),
    }),
    /projection unavailable/,
  );
  assert.deepEqual(calls, [
    ["failed", "event-2", "projection unavailable"],
  ]);
});
