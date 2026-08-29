import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeDiagnosticEvent,
  normalizeDiagnosticPath,
  safeDiagnosticMessage,
} from "./diagnostics.js";

test("browser diagnostics never retain query strings or signed COS paths", () => {
  assert.deepEqual(
    normalizeDiagnosticPath(
      "https://cos.ap-hongkong.myqcloud.com/bucket/object.png?X-Amz-Signature=secret",
      "https://app.example.test/app",
    ),
    { path: "external", destination: "external:cos" },
  );
  assert.deepEqual(
    normalizeDiagnosticPath(
      "/v1/web/stores/11111111-1111-4111-8111-111111111111/media/22222222-2222-4222-8222-222222222222/content?secret=private",
      "https://app.example.test/app",
    ),
    { path: "/v1/web/stores/:id/media/:id/content", destination: "self" },
  );
});

test("browser event normalization drops input values and raw payloads", () => {
  const event = normalizeDiagnosticEvent({
    kind: "ui.submit",
    module: "publishing",
    action: "提交商品",
    metadata: {
      target: "form:publish",
      inputValue: "secret product title",
      requestBody: { title: "secret product title" },
    },
  }, { now: () => "2026-08-30T00:00:00.000Z" });

  assert.equal(event.operation, "diagnostic.ui.submit");
  assert.equal(event.metadata.target, "form:publish");
  assert.equal(event.metadata.inputValue, undefined);
  assert.equal(event.metadata.requestBody, undefined);
  assert.equal(event.occurredAt, "2026-08-30T00:00:00.000Z");
});

test("browser error summaries redact tokens and signed URLs", () => {
  const message = safeDiagnosticMessage(
    "Request failed https://cos.example.test/object?X-Amz-Signature=secret token=abcdef0123456789abcdef0123456789",
  );

  assert.equal(message.includes("X-Amz-Signature=secret"), false);
  assert.equal(message.includes("abcdef0123456789abcdef0123456789"), false);
  assert.ok(message.length <= 240);
});
