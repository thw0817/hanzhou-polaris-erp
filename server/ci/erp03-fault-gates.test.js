import assert from "node:assert/strict";
import test from "node:test";
import {
  simulateMediaFault,
  simulatePublishFault,
  simulateReadbackFault,
} from "./erp03-fault-gates.js";

test("DB commit followed by process crash keeps a durable unsent command", () => {
  const result = simulatePublishFault([{ type: "command_committed" }]);
  assert.equal(result.durable, true);
  assert.equal(result.outboxState, "pending");
  assert.equal(result.outcome, null);
});

test("Outbox retry is idempotent for one command", () => {
  const result = simulatePublishFault([
    { type: "command_committed" },
    { type: "outbox_delivered", jobId: "command-1" },
    { type: "outbox_delivered", jobId: "command-1" },
  ]);
  assert.deepEqual(result.deliveredJobIds, ["command-1"]);
});

test("duplicate jobId does not create a second delivery identity", () => {
  const result = simulatePublishFault([
    { type: "command_committed" },
    { type: "outbox_delivered", jobId: "command-1" },
    { type: "outbox_delivered", jobId: "command-1" },
  ]);
  assert.equal(result.deliveredJobIds.length, 1);
});

test("Worker crash before send is safe to retry", () => {
  const result = simulatePublishFault([
    { type: "command_committed" },
    { type: "worker_crash_before_send" },
  ]);
  assert.equal(result.retryable, true);
  assert.equal(result.outcome, null);
});

test("Worker crash after send becomes result unknown", () => {
  const result = simulatePublishFault([
    { type: "command_committed" },
    { type: "worker_send_started" },
    { type: "worker_crash_after_send" },
  ]);
  assert.equal(result.outcome, "unknown");
  assert.equal(result.retryable, false);
});

test("SHEIN timeout after send requires readback and no automatic retry", () => {
  const result = simulatePublishFault([
    { type: "worker_send_started" },
    { type: "shein_timeout_after_send" },
  ]);
  assert.equal(result.outcome, "unknown");
  assert.equal(result.safeAction, "readback_before_new_attempt");
});

test("SSE disconnect reconnects from durable state without another write", () => {
  const result = simulatePublishFault([
    { type: "command_committed" },
    { type: "worker_send_started" },
    { type: "sse_disconnect" },
    { type: "sse_reconnect" },
  ]);
  assert.equal(result.sseConnected, true);
  assert.equal(result.safeAction, "reconnect_from_durable_snapshot");
});

test("duplicate and out-of-order readback receipts are monotonic", () => {
  const result = simulateReadbackFault([
    { type: "receipt", id: "accepted-1", code: "accepted" },
    { type: "receipt", id: "rejected-old", code: "rejected" },
    { type: "receipt", id: "accepted-1", code: "accepted" },
  ]);
  assert.equal(result.receiptCount, 2);
  assert.equal(result.currentCode, "accepted");
});

test("document-state and SPU readback can converge on the same stable outcome", () => {
  const result = simulateReadbackFault([
    { type: "receipt", id: "document-1", code: "accepted" },
    { type: "receipt", id: "spu-1", code: "accepted" },
  ]);
  assert.equal(result.currentCode, "accepted");
});

test("ambiguous Attempt identity is a conflict, never a guessed current row", () => {
  const result = simulateReadbackFault([{ type: "ambiguous_attempt" }]);
  assert.equal(result.attemptState, "conflict");
});

test("projection transaction failure leaves the current projection unchanged", () => {
  const result = simulateReadbackFault([{ type: "projection_transaction_failed" }]);
  assert.equal(result.projectionState, "unchanged");
});

test("single-source failure preserves a stale last-known-good snapshot", () => {
  const result = simulateReadbackFault([{ type: "source_failed" }]);
  assert.equal(result.sourceHealth, "failed");
  assert.deepEqual(result.snapshot, { value: "last-known-good", stale: true });
});

test("upload interruption and repeated complete are recoverable and idempotent", () => {
  const result = simulateMediaFault([
    { type: "upload_interrupted" },
    { type: "complete" },
    { type: "complete" },
  ]);
  assert.equal(result.status, "ready");
  assert.equal(result.verified, true);
});

test("missing object is quarantined rather than referenced", () => {
  const result = simulateMediaFault([{ type: "object_missing" }]);
  assert.equal(result.status, "quarantined");
  assert.equal(result.verified, false);
});

test("hash, MIME and size conflicts all fail closed", () => {
  for (const code of ["MEDIA_HASH_CONFLICT", "MEDIA_MIME_CONFLICT", "MEDIA_SIZE_CONFLICT"]) {
    const result = simulateMediaFault([{ type: "integrity_conflict", code }]);
    assert.equal(result.status, "rejected");
    assert.equal(result.error, code);
  }
});

test("Draft to Version transaction failure creates no Version reference", () => {
  const result = simulateMediaFault([{ type: "version_transaction_failed" }]);
  assert.equal(result.referenceCreated, false);
});

test("missing SHEIN image receipt is unknown and cleanup resumes after restart", () => {
  const result = simulateMediaFault([
    { type: "platform_receipt_missing" },
    { type: "cleanup_worker_restart" },
  ]);
  assert.equal(result.platformReceipt, "unknown");
  assert.equal(result.cleanupResumes, true);
});
