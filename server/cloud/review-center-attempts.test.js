import assert from "node:assert/strict";
import test from "node:test";
import { projectPublishAttempts } from "./review-center-attempts.js";

test("attempt projection keeps stable job identity, chronology and persisted relations", () => {
  const result = projectPublishAttempts([
    {
      publish_job_id: "job-old",
      request_key: "request-old",
      publish_batch_id: "batch-old",
      execution_run_id: "run-old",
      version: "version-old",
      publish_job_state: "failed_terminal",
      attempt_count: 1,
      job_created_at: "2026-08-28T05:00:00.000Z",
      job_updated_at: "2026-08-28T05:01:00.000Z",
      request_skc_names: ["SKC-1"],
      request_summary: { attemptReason: "first_publish" },
    },
    {
      publish_job_id: "job-new",
      request_key: "request-new",
      publish_batch_id: "batch-new",
      execution_run_id: "run-new",
      version: null,
      publish_job_state: "submitted",
      attempt_count: 2,
      job_created_at: "2026-08-28T06:00:00.000Z",
      job_updated_at: "2026-08-28T06:01:00.000Z",
      request_skc_names: JSON.stringify(["SKC-1", "SKC-2"]),
      request_summary: {
        attemptReason: "rejected_relaunch",
        parentAttemptId: "job-old",
      },
    },
  ]);

  const skc1 = result.bySkc.get("SKC-1");
  const skc2 = result.bySkc.get("SKC-2");
  assert.equal(skc1.current.businessAttemptId, "job:job-new");
  assert.equal(skc1.current.current, true);
  assert.equal(skc1.current.businessAttemptNo, 2);
  assert.equal(skc1.current.reason, "rejected_relaunch");
  assert.equal(skc1.current.parentAttemptId, "job-old");
  assert.equal(skc1.history[1].businessAttemptId, "job:job-old");
  assert.equal(skc1.history[1].current, false);
  assert.equal(skc2.current.businessAttemptId, "job:job-new");
  assert.equal(result.byReviewKey.get("job:job-new").requestKey, "request-new");
  assert.equal(result.byReviewKey.get("version:version-old").current, false);
});

test("missing parent and reason fields stay unknown instead of being fabricated", () => {
  const [attempt] = projectPublishAttempts([{
    publish_job_id: "job-1",
    request_key: "request-1",
    request_skc_names: ["SKC-1"],
  }]).bySkc.get("SKC-1").history;

  assert.equal(attempt.reason, null);
  assert.equal(attempt.reasonSource, "unavailable");
  assert.equal(attempt.parentAttemptId, null);
  assert.equal(attempt.supersedesAttemptId, null);
  assert.equal(attempt.sheinVersion, null);
  assert.equal(attempt.reviewKey, "job:job-1");
});

test("attempt projection preserves the latest official audit receipt", () => {
  const [attempt] = projectPublishAttempts([{
    publish_job_id: "job-rejected",
    version: "version-rejected",
    publish_job_state: "submitted",
    request_skc_names: ["SKC-REJECTED"],
    publish_audit_version: "version-rejected",
    publish_audit_state: "3",
    publish_audit_state_label: "failed",
    publish_audit_receipt_status: "failed",
    publish_audit_received_at: "2026-08-28T06:00:00.000Z",
  }]).bySkc.get("SKC-REJECTED").history;

  assert.equal(attempt.documentAuditVersion, "version-rejected");
  assert.equal(attempt.documentAuditState, "3");
  assert.equal(attempt.documentAuditStateLabel, "failed");
  assert.equal(attempt.documentAuditReceiptStatus, "failed");
});
