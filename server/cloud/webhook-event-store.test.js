import assert from "node:assert/strict";
import test from "node:test";
import { PostgresWebhookEventStore } from "./webhook-event-store.js";

test("failed webhook attempts are counted only when the event is claimed", async () => {
  const calls = [];
  const store = new PostgresWebhookEventStore({
    pool: {
      async query(text, values) {
        calls.push({ text, values });
        return { rows: [], rowCount: 0 };
      },
    },
  });

  await store.markFailed("event-1", new Error("processor failed"));

  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /SET state = 'failed'/);
  assert.doesNotMatch(calls[0].text, /attempt_count/);
  assert.deepEqual(calls[0].values, [
    "event-1",
    JSON.stringify({ message: "processor failed" }),
  ]);
});

test("stores normalized webhook projections without rewriting raw payloads", async () => {
  const calls = [];
  const store = new PostgresWebhookEventStore({
    pool: {
      async query(text, values) {
        calls.push({ text, values });
        return { rows: [], rowCount: 0 };
      },
    },
  });

  await store.saveProjection("event-2", {
    projectionVersion: "product-document-audit-v1",
    projection: {
      eventFamily: "product_document_audit_status_notice",
      records: [{ auditState: 2 }],
    },
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /projection_version/);
  assert.match(calls[0].text, /projection = \$3::jsonb/);
  assert.doesNotMatch(calls[0].text, /raw_payload\s*=/);
  assert.equal(calls[0].values[0], "event-2");
  assert.equal(calls[0].values[1], "product-document-audit-v1");
});
