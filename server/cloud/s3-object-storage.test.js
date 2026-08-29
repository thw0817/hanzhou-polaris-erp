import assert from "node:assert/strict";
import test from "node:test";
import { S3ObjectStorage } from "./s3-object-storage.js";

test("creates a short-lived S3-compatible upload URL without exposing the secret", () => {
  const storage = new S3ObjectStorage({
    endpoint: "https://bucket.example.test",
    region: "ap-hongkong",
    bucket: "shein-media",
    accessKeyId: "AKIDEXAMPLE",
    secretAccessKey: "secret-value-that-must-never-leak",
    now: () => new Date("2026-07-31T10:00:00.000Z"),
  });
  const ticket = storage.createUploadUrl({
    objectKey: "tenant-1/store-1/temporary_upload/2026-07-31/a b.jpg",
    contentType: "image/jpeg",
    expiresInSeconds: 600,
  });

  assert.match(ticket.url, /^https:\/\/bucket\.example\.test\//);
  assert.match(ticket.url, /X-Amz-Algorithm=AWS4-HMAC-SHA256/);
  assert.match(ticket.url, /X-Amz-Expires=600/);
  assert.match(ticket.url, /X-Amz-Signature=[a-f0-9]{64}/);
  assert.equal(ticket.url.includes("secret-value"), false);
  assert.deepEqual(ticket.headers, { "Content-Type": "image/jpeg" });
  assert.equal(ticket.expiresAt, "2026-07-31T10:10:00.000Z");
});

test("rejects a remote HTTP endpoint unless insecure staging access is explicit", () => {
  assert.throws(
    () => new S3ObjectStorage({
      endpoint: "http://minio:9000",
      region: "us-east-1",
      bucket: "shein-media",
      accessKeyId: "AKIDEXAMPLE",
      secretAccessKey: "secret-value",
    }),
    /对象存储Endpoint必须使用HTTPS/,
  );

  const storage = new S3ObjectStorage({
    endpoint: "http://minio:9000",
    region: "us-east-1",
    bucket: "shein-media",
    accessKeyId: "AKIDEXAMPLE",
    secretAccessKey: "secret-value",
    allowInsecureEndpoint: true,
  });
  assert.equal(storage.endpoint.href, "http://minio:9000/");
});

test("creates a signed browser download URL without requiring content headers", () => {
  const storage = new S3ObjectStorage({
    endpoint: "https://bucket.example.test",
    region: "ap-hongkong",
    bucket: "shein-media",
    accessKeyId: "AKIDEXAMPLE",
    secretAccessKey: "secret-value",
    now: () => new Date("2026-07-31T10:00:00.000Z"),
  });
  const ticket = storage.createDownloadUrl({
    objectKey: "tenant-1/store-1/result.png",
    expiresInSeconds: 300,
  });

  assert.match(ticket.url, /X-Amz-Expires=300/);
  assert.match(ticket.url, /X-Amz-Signature=[a-f0-9]{64}/);
  assert.deepEqual(ticket.headers, {});
});

test("verifies uploaded object metadata with a signed HEAD request", async () => {
  let received = null;
  const storage = new S3ObjectStorage({
    endpoint: "https://bucket.example.test",
    region: "ap-hongkong",
    bucket: "shein-media",
    accessKeyId: "AKIDEXAMPLE",
    secretAccessKey: "secret-value",
    now: () => new Date("2026-07-31T10:00:00.000Z"),
    async fetchImpl(url, options) {
      received = { url, options };
      return new Response(null, {
        status: 200,
        headers: {
          "content-length": "1024",
          "content-type": "image/png",
          etag: '"etag-value"',
        },
      });
    },
  });
  const metadata = await storage.statObject({ objectKey: "asset.png" });

  assert.equal(received.options.method, "HEAD");
  assert.match(received.url, /X-Amz-Signature=/);
  assert.deepEqual(metadata, {
    sizeBytes: 1024,
    contentType: "image/png",
    etag: "etag-value",
  });
});

test("downloads and uploads server-side objects without exposing credentials", async () => {
  const requests = [];
  const storage = new S3ObjectStorage({
    endpoint: "https://bucket.example.test",
    region: "ap-hongkong",
    bucket: "shein-media",
    accessKeyId: "AKIDEXAMPLE",
    secretAccessKey: "secret-value",
    now: () => new Date("2026-07-31T10:00:00.000Z"),
    async fetchImpl(url, options) {
      requests.push({ url, options });
      if (options.method === "GET") {
        return new Response(Buffer.from("image-bytes"), {
          status: 200,
          headers: { "content-type": "image/png", etag: '"download-etag"' },
        });
      }
      return new Response(null, { status: 200, headers: { etag: '"upload-etag"' } });
    },
  });

  const downloaded = await storage.getObject({ objectKey: "input.png" });
  const uploaded = await storage.putObject({
    objectKey: "output.png",
    bytes: downloaded.bytes,
    contentType: downloaded.contentType,
  });

  assert.equal(downloaded.bytes.toString(), "image-bytes");
  assert.equal(downloaded.etag, "download-etag");
  assert.equal(uploaded.sizeBytes, 11);
  assert.equal(uploaded.etag, "upload-etag");
  assert.deepEqual(requests.map((item) => item.options.method), ["GET", "PUT"]);
  assert.equal(requests.some((item) => item.url.includes("secret-value")), false);
});
