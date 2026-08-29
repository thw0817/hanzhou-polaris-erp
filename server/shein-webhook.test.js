import assert from "node:assert/strict";
import { createCipheriv } from "node:crypto";
import test from "node:test";
import { generateSheinSignature } from "./shein-crypto.js";
import {
  createSheinWebhookAdapter,
  MemoryWebhookReplayStore,
  normalizeSheinEventCode,
} from "./shein-webhook.js";

const APP_ID = "APP-ID";
const APP_SECRET = "0123456789ABCDEF0123456789ABCDEF";
const PATH = "/webhooks/shein";
const NOW = 1785432000000;

function encrypt(payload) {
  const key = Buffer.alloc(16);
  Buffer.from(APP_SECRET, "utf8").copy(key, 0, 0, 16);
  const iv = Buffer.from(
    "space-station-default-iv",
    "utf8",
  ).subarray(0, 16);
  const cipher = createCipheriv("aes-128-cbc", key, iv);
  return Buffer.concat([
    cipher.update(JSON.stringify(payload)),
    cipher.final(),
  ]).toString("base64");
}

function createInput(overrides = {}) {
  const timestamp = overrides.timestamp || String(NOW);
  const signature =
    overrides.signature ||
    generateSheinSignature({
      openKeyId: APP_ID,
      secretKey: APP_SECRET,
      path: PATH,
      timestamp,
      randomKey: "abc12",
    });
  return {
    path: PATH,
    eventData: encrypt({ data: '{"skc":"s1","status":2}' }),
    headers: {
      "x-lt-appid": APP_ID,
      "x-lt-openkeyid": "OPEN-1",
      "x-lt-eventcode": "/product_delete_audit",
      "x-lt-timestamp": timestamp,
      "x-lt-signature": signature,
    },
    ...overrides,
  };
}

test("normalizes a leading slash in SHEIN event codes", () => {
  assert.equal(
    normalizeSheinEventCode("/product_delete_audit"),
    "product_delete_audit",
  );
  assert.throws(
    () => normalizeSheinEventCode("../../bad"),
    /事件编码无效/,
  );
});

test("official adapter decrypts payload and resolves the authorized store", async () => {
  const adapter = createSheinWebhookAdapter({
    appId: APP_ID,
    appSecret: APP_SECRET,
    replayStore: new MemoryWebhookReplayStore({ now: () => NOW }),
    storeResolver: {
      async findByOpenKeyId(openKeyId) {
        assert.equal(openKeyId, "OPEN-1");
        return { tenantId: "tenant-1", storeId: "store-1" };
      },
    },
    now: () => NOW,
  });

  const result = await adapter(createInput());
  assert.equal(result.eventType, "product_delete_audit");
  assert.deepEqual(result.payload, {
    data: '{"skc":"s1","status":2}',
  });
  assert.equal(result.tenantId, "tenant-1");
  assert.equal(result.storeId, "store-1");
});

test("official adapter rejects stale timestamps before decryption", async () => {
  const adapter = createSheinWebhookAdapter({
    appId: APP_ID,
    appSecret: APP_SECRET,
    replayStore: new MemoryWebhookReplayStore({ now: () => NOW }),
    now: () => NOW,
  });
  const timestamp = String(NOW - 5 * 60 * 1000 - 1);

  await assert.rejects(
    adapter(
      createInput({
        timestamp,
        signature: generateSheinSignature({
          openKeyId: APP_ID,
          secretKey: APP_SECRET,
          path: PATH,
          timestamp,
          randomKey: "abc12",
        }),
      }),
    ),
    (error) =>
      error.code === "STALE_TIMESTAMP" && error.status === 401,
  );
});

test("official adapter releases replay reservation after decryption failure", async () => {
  const replayStore = new MemoryWebhookReplayStore({ now: () => NOW });
  const adapter = createSheinWebhookAdapter({
    appId: APP_ID,
    appSecret: APP_SECRET,
    replayStore,
    now: () => NOW,
  });
  const input = createInput({ eventData: "not-valid-ciphertext" });

  await assert.rejects(adapter(input), /解密失败/);
  await assert.rejects(adapter(input), /解密失败/);
});
