import assert from "node:assert/strict";
import { createCipheriv } from "node:crypto";
import { Readable } from "node:stream";
import test from "node:test";
import { generateSheinSignature } from "../shein-crypto.js";
import {
  createSheinWebhookAdapter,
  MemoryWebhookReplayStore,
} from "../shein-webhook.js";
import { createWebhookRequestHandler } from "./webhook-server.js";

function createRequest({ method = "GET", url = "/", headers = {}, body = "" }) {
  const request = Readable.from(body ? [Buffer.from(body)] : []);
  Object.assign(request, { method, url, headers });
  return request;
}

function createResponse() {
  return {
    status: null,
    headers: null,
    body: "",
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body) {
      this.body = body || "";
    },
  };
}

const APP_ID = "APP-1";
const APP_SECRET = "0123456789ABCDEF0123456789ABCDEF";
const NOW = 1785432000000;

function encryptEventData(payload) {
  const key = Buffer.alloc(16);
  Buffer.from(APP_SECRET, "utf8").copy(key, 0, 0, 16);
  const iv = Buffer.from(
    "space-station-default-iv",
    "utf8",
  ).subarray(0, 16);
  const cipher = createCipheriv("aes-128-cbc", key, iv);
  return Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]).toString("base64");
}

function createOfficialRequest({
  path = "/webhooks/shein",
  eventType = "product_delete_audit",
  eventData = encryptEventData({ skc_name: "s1", status: 2 }),
  timestamp = String(NOW),
  randomKey = "abc12",
  contentType = "multipart/form-data",
} = {}) {
  const boundary = "----shein-test-boundary";
  const body =
    `--${boundary}\r\n` +
    'Content-Disposition: form-data; name="eventData"\r\n\r\n' +
    `${eventData}\r\n` +
    `--${boundary}--\r\n`;
  const signature = generateSheinSignature({
    openKeyId: APP_ID,
    secretKey: APP_SECRET,
    path,
    timestamp,
    randomKey,
  });
  return createRequest({
    method: "POST",
    url: path,
    headers: {
      host: "api.example.test",
      "content-type":
        contentType === "multipart/form-data"
          ? `${contentType}; boundary=${boundary}`
          : contentType,
      "x-lt-openkeyid": "STORE-OPEN-1",
      "x-lt-eventcode": eventType,
      "x-lt-appid": APP_ID,
      "x-lt-timestamp": timestamp,
      "x-lt-signature": signature,
    },
    body,
  });
}

test("webhook HTTP service accepts an event and returns a small response", async () => {
  const calls = [];
  const handler = createWebhookRequestHandler({
    config: { webhookVerificationMode: "trusted-proxy" },
    ingress: async (event) => {
      calls.push(event);
      return {
        accepted: true,
        duplicate: false,
        eventId: "event-1",
      };
    },
  });
  const request = createRequest({
    method: "POST",
    url: "/internal/webhooks/shein/product_delete_audit",
    headers: {
      host: "127.0.0.1",
      "content-type": "application/json",
      "x-internal-webhook-secret": "secret",
    },
    body: JSON.stringify({ skc_name: "s1", status: 2 }),
  });
  const response = createResponse();
  await handler(request, response);

  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), {
    code: "0",
    msg: "OK",
    duplicate: false,
    eventId: "event-1",
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].eventType, "product_delete_audit");
});

test("official SHEIN multipart webhook is verified, decrypted, and routed", async () => {
  const calls = [];
  const officialAdapter = createSheinWebhookAdapter({
    appId: APP_ID,
    appSecret: APP_SECRET,
    replayStore: new MemoryWebhookReplayStore({ now: () => NOW }),
    storeResolver: {
      async findByOpenKeyId(openKeyId) {
        assert.equal(openKeyId, "STORE-OPEN-1");
        return { tenantId: "tenant-1", storeId: "store-1" };
      },
    },
    now: () => NOW,
  });
  const handler = createWebhookRequestHandler({
    config: { webhookVerificationMode: "shein-direct" },
    officialAdapter,
    ingress: async (event) => {
      calls.push(event);
      return {
        accepted: true,
        duplicate: false,
        eventId: "event-1",
      };
    },
  });
  const response = createResponse();
  await handler(createOfficialRequest(), response);

  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), {
    code: "0",
    msg: "OK",
    duplicate: false,
    eventId: "event-1",
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].payload, {
    skc_name: "s1",
    status: 2,
  });
  assert.equal(calls[0].eventType, "product_delete_audit");
  assert.equal(calls[0].tenantId, "tenant-1");
  assert.equal(calls[0].storeId, "store-1");
  assert.equal(calls[0].source, "production");
});

test("official SHEIN test webhook is isolated from production source", async () => {
  const calls = [];
  const officialAdapter = createSheinWebhookAdapter({
    appId: APP_ID,
    appSecret: APP_SECRET,
    replayStore: new MemoryWebhookReplayStore({ now: () => NOW }),
    now: () => NOW,
  });
  const handler = createWebhookRequestHandler({
    config: { webhookVerificationMode: "shein-direct" },
    officialAdapter,
    ingress: async (event) => {
      calls.push(event);
      return {
        accepted: true,
        duplicate: false,
        eventId: "event-test-1",
      };
    },
  });
  const response = createResponse();
  await handler(
    createOfficialRequest({ path: "/webhooks/shein/test" }),
    response,
  );

  assert.equal(response.status, 200);
  assert.equal(calls[0].source, "test");
});

test("official SHEIN webhook replay returns success without queuing twice", async () => {
  let ingressCalls = 0;
  const officialAdapter = createSheinWebhookAdapter({
    appId: APP_ID,
    appSecret: APP_SECRET,
    replayStore: new MemoryWebhookReplayStore({ now: () => NOW }),
    now: () => NOW,
  });
  const handler = createWebhookRequestHandler({
    config: { webhookVerificationMode: "shein-direct" },
    officialAdapter,
    ingress: async () => {
      ingressCalls += 1;
      return {
        accepted: true,
        duplicate: false,
        eventId: "event-1",
      };
    },
  });
  const firstResponse = createResponse();
  const secondResponse = createResponse();
  await handler(createOfficialRequest(), firstResponse);
  await handler(createOfficialRequest(), secondResponse);

  assert.equal(firstResponse.status, 200);
  assert.equal(secondResponse.status, 200);
  assert.equal(JSON.parse(secondResponse.body).duplicate, true);
  assert.equal(ingressCalls, 1);
});

test("official SHEIN webhook releases replay claim when persistence fails", async () => {
  let ingressCalls = 0;
  const officialAdapter = createSheinWebhookAdapter({
    appId: APP_ID,
    appSecret: APP_SECRET,
    replayStore: new MemoryWebhookReplayStore({ now: () => NOW }),
    now: () => NOW,
  });
  const handler = createWebhookRequestHandler({
    config: { webhookVerificationMode: "shein-direct" },
    officialAdapter,
    ingress: async () => {
      ingressCalls += 1;
      if (ingressCalls === 1) throw new Error("database unavailable");
      return {
        accepted: true,
        duplicate: false,
        eventId: "event-1",
      };
    },
  });
  const firstResponse = createResponse();
  const secondResponse = createResponse();
  await handler(createOfficialRequest(), firstResponse);
  await handler(createOfficialRequest(), secondResponse);

  assert.equal(firstResponse.status, 500);
  assert.equal(
    JSON.parse(firstResponse.body).msg,
    "Webhook 服务暂时不可用",
  );
  assert.equal(secondResponse.status, 200);
  assert.equal(ingressCalls, 2);
});

test("official SHEIN webhook rejects an invalid signature", async () => {
  const logLines = [];
  const officialAdapter = createSheinWebhookAdapter({
    appId: APP_ID,
    appSecret: APP_SECRET,
    replayStore: new MemoryWebhookReplayStore({ now: () => NOW }),
    now: () => NOW,
  });
  const handler = createWebhookRequestHandler({
    config: { webhookVerificationMode: "shein-direct" },
    officialAdapter,
    ingress: async () => {
      throw new Error("should not run");
    },
    logger: {
      info(line) {
        logLines.push(line);
      },
      warn(line) {
        logLines.push(line);
      },
    },
  });
  const request = createOfficialRequest();
  request.headers["x-lt-signature"] = "wrong-signature";
  const response = createResponse();
  await handler(request, response);

  assert.equal(response.status, 401);
  assert.equal(JSON.parse(response.body).code, "INVALID_SIGNATURE");
  assert.equal(
    logLines.some((line) => line.includes('"code":"INVALID_SIGNATURE"')),
    true,
  );
  assert.equal(
    logLines.some((line) => line.includes("wrong-signature")),
    false,
  );
});

test("official SHEIN webhook rejects unsupported bodies", async () => {
  const officialAdapter = createSheinWebhookAdapter({
    appId: APP_ID,
    appSecret: APP_SECRET,
    replayStore: new MemoryWebhookReplayStore({ now: () => NOW }),
    now: () => NOW,
  });
  const handler = createWebhookRequestHandler({
    config: { webhookVerificationMode: "shein-direct" },
    officialAdapter,
    ingress: async () => {
      throw new Error("should not run");
    },
  });
  const response = createResponse();
  await handler(
    createOfficialRequest({ contentType: "text/plain" }),
    response,
  );

  assert.equal(response.status, 415);
  assert.equal(
    JSON.parse(response.body).code,
    "UNSUPPORTED_CONTENT_TYPE",
  );
});

test("webhook HTTP service does not expose unsupported routes", async () => {
  const handler = createWebhookRequestHandler({
    config: { webhookVerificationMode: "trusted-proxy" },
    ingress: async () => {
      throw new Error("should not run");
    },
  });
  const request = createRequest({
    url: "/images",
    headers: { host: "127.0.0.1" },
  });
  const response = createResponse();
  await handler(request, response);
  assert.equal(response.status, 404);
});
