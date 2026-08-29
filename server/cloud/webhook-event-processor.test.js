import assert from "node:assert/strict";
import test from "node:test";
import {
  createWebhookEventProcessor,
  WebhookProcessingError,
} from "./webhook-event-processor.js";
import { createDefaultWebhookProductionHandlers } from "./webhook-production-projections.js";

test("webhook processor completes test events without logging payloads", async () => {
  const lines = [];
  const processor = createWebhookEventProcessor({
    logger: {
      info(line) {
        lines.push(line);
      },
    },
  });

  const result = await processor({
    id: "event-1",
    event_type: "product_document_audit_status_notice",
    source: "test",
    payload: {
      skc_name: "sensitive-business-code",
      status: 2,
    },
  });

  assert.equal(result.disposition, "validated-test-event");
  assert.equal(lines.length, 1);
  assert.equal(lines[0].includes("sensitive-business-code"), false);
});

test("webhook processor fails closed for production events without a handler", async () => {
  const processor = createWebhookEventProcessor({
    logger: { info() {} },
  });

  await assert.rejects(
    processor({
      id: "event-2",
      event_type: "product_document_audit_status_notice",
      source: "production",
      payload: { skc_name: "s1" },
    }),
    (error) =>
      error instanceof WebhookProcessingError &&
      error.code === "PRODUCTION_HANDLER_REQUIRED",
  );
});

test("webhook processor rejects malformed stored events", async () => {
  const processor = createWebhookEventProcessor({
    logger: { info() {} },
  });

  await assert.rejects(
    processor({
      id: "event-3",
      event_type: "product_document_audit_status_notice",
      source: "test",
      payload: null,
    }),
    (error) =>
      error instanceof WebhookProcessingError &&
      error.code === "INVALID_STORED_EVENT",
  );
});

test("webhook processor projects the documented production audit event safely", async () => {
  const lines = [];
  const processor = createWebhookEventProcessor({
    logger: {
      info(line) {
        lines.push(line);
      },
    },
    productionHandlers: createDefaultWebhookProductionHandlers(),
  });

  const result = await processor({
    id: "event-4",
    event_type: "product_document_audit_status_notice",
    source: "production",
    payload: {
      skc_name: "sensitive-skc-code",
      document_sn: "sensitive-document-code",
      audit_state: 2,
      failed_reason: null,
    },
  });

  assert.equal(result.summary.disposition, "read-only-audit-projection");
  assert.equal(result.externalWrite, false);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].includes("sensitive-skc-code"), false);
  assert.equal(lines[0].includes("sensitive-document-code"), false);
});
