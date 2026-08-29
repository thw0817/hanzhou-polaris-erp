import assert from "node:assert/strict";
import test from "node:test";
import {
  DiagnosticEventError,
  PostgresDiagnosticEventRepository,
  normalizeDiagnosticEvent,
  normalizeDiagnosticPath,
  redactDiagnosticValue,
} from "./diagnostic-events.js";

test("diagnostic redaction drops secrets, payloads, headers, and image bytes", () => {
  const safe = redactDiagnosticValue({
    action: "上传图片",
    traceId: "trace-1",
    authorization: "Bearer should-not-survive",
    SHEIN_MEDIA_S3_SECRET_ACCESS_KEY: "secret-should-not-survive",
    requestBody: { originalName: "private.png" },
    responseBody: { imageBytes: "base64-data" },
    headers: { cookie: "session=private" },
    signedUrl: "https://cos.example.test/object?X-Amz-Signature=private",
  });

  assert.deepEqual(safe, {
    action: "上传图片",
    traceId: "trace-1",
  });
  assert.equal(JSON.stringify(safe).includes("private"), false);
  assert.equal(
    JSON.stringify(redactDiagnosticValue({ message: "failure?token=private" })).includes("private"),
    false,
  );
});

test("diagnostic paths keep route shape but never persist external signed object paths", () => {
  assert.deepEqual(
    normalizeDiagnosticPath(
      "/v1/web/stores/11111111-1111-4111-8111-111111111111/media/22222222-2222-4222-8222-222222222222/content?token=secret",
    ),
    { path: "/v1/web/stores/:id/media/:id/content", destination: "self" },
  );
  assert.deepEqual(
    normalizeDiagnosticPath(
      "https://cos.ap-hongkong.myqcloud.com/private/object.png?X-Amz-Signature=secret",
    ),
    { path: "external", destination: "external:cos" },
  );
});

test("diagnostic event normalization is bounded and excludes unsafe metadata", () => {
  const event = normalizeDiagnosticEvent({
    kind: "ui.click",
    module: "products",
    action: "  新建商品  ",
    path: "/app/operations/store/products",
    traceId: "trace-1",
    metadata: {
      target: "button:create",
      label: "新建商品",
      inputValue: "must-not-survive",
      body: { title: "private" },
    },
  }, { now: () => "2026-08-30T00:00:00.000Z" });

  assert.equal(event.operation, "diagnostic.ui.click");
  assert.equal(event.path, "/app/operations/store/products");
  assert.equal(event.metadata.target, "button:create");
  assert.equal(event.metadata.inputValue, undefined);
  assert.equal(event.metadata.body, undefined);
  assert.equal(event.occurredAt, "2026-08-30T00:00:00.000Z");

  assert.equal(
    normalizeDiagnosticEvent({ kind: "api.error" }).operation,
    "diagnostic.api.error",
  );
  assert.equal(
    normalizeDiagnosticEvent({ kind: "ui.change", metadata: { target: "field:input:text" } }).operation,
    "diagnostic.ui.change",
  );
});

test("diagnostic repository inserts only tenant-scoped normalized records", async () => {
  let query = null;
  const repository = new PostgresDiagnosticEventRepository({
    pool: {
      async query(input) {
        query = input;
        return { rows: [], rowCount: 2 };
      },
    },
  });

  const result = await repository.recordClientEvents({
    context: { tenantId: "tenant-1", userId: "user-1", role: "admin" },
    events: [
      {
        kind: "ui.click",
        action: "刷新",
        path: "/app/overview",
        metadata: { target: "button:refresh" },
      },
      {
        kind: "api.request",
        method: "POST",
        path: "/v1/web/stores/store-1/media/upload-ticket",
        statusCode: 503,
        durationMs: 120,
        metadata: { source: "client", errorCode: "MEDIA_UPLOAD_FAILED" },
      },
    ],
  });

  assert.deepEqual(result, { recorded: 2 });
  assert.match(query.text, /INSERT INTO api_audit_logs/);
  assert.equal(query.values[0], "tenant-1");
  assert.equal(query.values[1], "user-1");
  assert.equal(query.values.includes("private"), false);
  assert.equal(query.text.includes("requestBody"), false);
});

test("diagnostic repository rejects oversized batches before touching the database", async () => {
  const repository = new PostgresDiagnosticEventRepository({
    pool: { async query() { throw new Error("must not query"); } },
  });

  await assert.rejects(
    repository.recordClientEvents({
      context: { tenantId: "tenant-1" },
      events: Array.from({ length: 51 }, () => ({ kind: "ui.click" })),
    }),
    (error) => error instanceof DiagnosticEventError && error.code === "BATCH_TOO_LARGE",
  );
});

test("diagnostic list query is tenant-scoped and bounded", async () => {
  let query = null;
  const repository = new PostgresDiagnosticEventRepository({
    pool: {
      async query(input) {
        query = input;
        return { rows: [] };
      },
    },
  });

  const result = await repository.list({ tenantId: "tenant-1", limit: 20 });

  assert.deepEqual(result, { events: [], hasMore: false, limit: 20 });
  assert.match(query.text, /tenant_id = \$1/);
  assert.match(query.text, /operation LIKE 'diagnostic\.%'/);
  assert.deepEqual(query.values, ["tenant-1", 21]);
});
