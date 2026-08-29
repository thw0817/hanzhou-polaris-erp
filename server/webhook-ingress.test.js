import assert from "node:assert/strict";
import test from "node:test";
import { MemoryJobQueue } from "./cloud/job-queue.js";
import { MemoryWebhookEventStore } from "./cloud/webhook-event-store.js";
import {
  createTrustedProxyVerifier,
  createWebhookDedupeKey,
  createWebhookIngress,
  normalizeSheinWebhookPayload,
  selectSafeWebhookHeaders,
} from "./webhook-ingress.js";

test("normalizes SHEIN data fields that contain JSON strings", () => {
  assert.deepEqual(
    normalizeSheinWebhookPayload({
      data: '{"skc":"s1","status":2}',
    }),
    { data: { skc: "s1", status: 2 } },
  );
});

test("ingress preserves decrypted raw payload beside normalized payload", async () => {
  const eventStore = new MemoryWebhookEventStore();
  const ingress = createWebhookIngress({
    appId: "app-1",
    eventStore,
    queue: new MemoryJobQueue(),
    verifyRequest: () => true,
  });
  const rawPayload = {
    data: '{"skc":"s1","status":2}',
  };

  await ingress({
    eventType: "product_delete_audit",
    payload: rawPayload,
    source: "production",
  });

  const stored = [...eventStore.events.values()][0];
  assert.deepEqual(stored.rawPayload, rawPayload);
  assert.deepEqual(stored.payload, {
    data: { skc: "s1", status: 2 },
  });
  assert.equal(stored.source, "production");
});

test("dedupe key is stable across object key order", () => {
  assert.equal(
    createWebhookDedupeKey("product_delete_audit", { status: 2, skc: "s1" }),
    createWebhookDedupeKey("product_delete_audit", { skc: "s1", status: 2 }),
  );
});

test("safe headers exclude credentials and signatures", () => {
  assert.deepEqual(
    selectSafeWebhookHeaders({
      "content-type": "application/json",
      "x-lt-signature": "secret",
      "x-lt-appid": "app-1",
      "x-lt-eventcode": "product_delete_audit",
      "x-lt-timestamp": "1785432000000",
      authorization: "secret",
      "x-request-id": "request-1",
    }),
    {
      "content-type": "application/json",
      "x-lt-appid": "app-1",
      "x-lt-eventcode": "product_delete_audit",
      "x-lt-timestamp": "1785432000000",
      "x-request-id": "request-1",
    },
  );
});

test("trusted proxy verification uses the configured internal secret", () => {
  const verify = createTrustedProxyVerifier("known-secret");
  assert.equal(
    verify({ headers: { "x-internal-webhook-secret": "known-secret" } }),
    true,
  );
  assert.equal(
    verify({ headers: { "x-internal-webhook-secret": "wrong-secret" } }),
    false,
  );
});

test("verified webhook is persisted and queued only once", async () => {
  const eventStore = new MemoryWebhookEventStore();
  const queue = new MemoryJobQueue();
  const ingress = createWebhookIngress({
    appId: "app-1",
    eventStore,
    queue,
    verifyRequest: () => true,
  });
  const request = {
    eventType: "product_delete_audit",
    payload: { skc_name: "s1", status: 2 },
  };
  const first = await ingress(request);
  const second = await ingress(request);

  assert.equal(first.accepted, true);
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(queue.jobs.length, 1);
});

test("webhook dedupe remains isolated when two stores receive the same payload", async () => {
  const eventStore = new MemoryWebhookEventStore();
  const queue = new MemoryJobQueue();
  const ingress = createWebhookIngress({
    appId: "app-1",
    eventStore,
    queue,
    verifyRequest: () => true,
  });
  const payload = { skc_name: "s1", status: 2 };

  const first = await ingress({
    eventType: "product_delete_audit",
    payload,
    tenantId: "tenant-1",
    storeId: "store-1",
  });
  const second = await ingress({
    eventType: "product_delete_audit",
    payload,
    tenantId: "tenant-2",
    storeId: "store-2",
  });

  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, false);
  assert.equal(eventStore.events.size, 2);
  assert.equal(queue.jobs.length, 2);
});

test("unverified webhook is rejected before persistence", async () => {
  const eventStore = new MemoryWebhookEventStore();
  const queue = new MemoryJobQueue();
  const ingress = createWebhookIngress({
    appId: "app-1",
    eventStore,
    queue,
    verifyRequest: () => false,
  });
  await assert.rejects(
    ingress({
      eventType: "product_delete_audit",
      payload: { skc_name: "s1", status: 2 },
    }),
    /验证失败/,
  );
  assert.equal(eventStore.events.size, 0);
  assert.equal(queue.jobs.length, 0);
});

test("official ingress accepts a signed but newly introduced event code", async () => {
  const eventStore = new MemoryWebhookEventStore();
  const queue = new MemoryJobQueue();
  const ingress = createWebhookIngress({
    appId: "app-1",
    eventStore,
    queue,
    verifyRequest: () => true,
    allowUnknownEventTypes: true,
  });

  const result = await ingress({
    eventType: "future_event_notice",
    payload: { data: { id: "1" } },
    source: "test",
  });

  assert.equal(result.accepted, true);
  assert.equal(queue.jobs[0].data.source, "test");
});

test("a persisted event is queued when SHEIN retries after Redis failure", async () => {
  const eventStore = new MemoryWebhookEventStore();
  let attempts = 0;
  const queue = {
    jobs: [],
    async add(name, data, options) {
      attempts += 1;
      if (attempts === 1) throw new Error("redis unavailable");
      const job = { id: options.jobId, name, data, options };
      this.jobs.push(job);
      return job;
    },
  };
  const ingress = createWebhookIngress({
    appId: "app-1",
    eventStore,
    queue,
    verifyRequest: () => true,
  });
  const request = {
    eventType: "product_delete_audit",
    payload: { skc_name: "s1", status: 2 },
  };

  await assert.rejects(ingress(request), /redis unavailable/);
  const recovered = await ingress(request);

  assert.equal(recovered.accepted, true);
  assert.equal(recovered.duplicate, true);
  assert.equal(queue.jobs.length, 1);
  assert.equal(
    [...eventStore.events.values()][0].state,
    "queued",
  );
});
