import assert from "node:assert/strict";
import test from "node:test";
import { classifyReviewCenterStatus } from "./review-center-status.js";

const cases = [
  ["blocked draft", { draftStatus: "blocked" }, "preflight_blocked", "needs_action"],
  ["queued job", { execution: { state: "queued" } }, "publish_queued", "all"],
  ["submitted job without official evidence", { execution: { state: "submitted" } }, "publish_submitted_waiting_receipt", "all"],
  ["unknown result", { execution: { state: "result_unknown" } }, "publish_result_unknown", "needs_action"],
  ["terminal local failure", { execution: { state: "failed_terminal" } }, "publish_failed_terminal", "needs_action"],
  ["retryable local failure", { execution: { state: "failed_retryable" } }, "publish_failed_retryable", "needs_action"],
  ["accepted receive", { receive: { state: "accepted" } }, "official_received_waiting_review", "awaiting_review"],
  ["failed receive", { receive: { state: "failed" } }, "official_receive_failed", "needs_action"],
  ["audit pending", { audit: { state: 1 } }, "official_awaiting_review", "awaiting_review"],
  ["audit pending with price stage", { audit: { state: 1, workflowStage: "awaiting_price" } }, "official_awaiting_price", "awaiting_price"],
  ["audit rejected", { audit: { state: 3, workflowStage: "awaiting_review" } }, "official_rejected", "rejected"],
  ["audit withdrawn", { audit: { state: 4 } }, "official_withdrawn", "needs_action"],
  ["audit passed without listing", { audit: { state: 2 }, listing: { state: "not_listed" } }, "official_passed", "all"],
  ["listed wins over audit", { audit: { state: 2 }, listing: { state: "listed" } }, "listed", "all"],
  ["unknown official state", { audit: { state: "unknown" } }, "official_state_unknown", "all"],
  ["incomplete draft", { draftStatus: "draft" }, "draft_incomplete", "all"],
];

test("review center status classifier covers the fixed resolution matrix", () => {
  for (const [name, input, code, tab] of cases) {
    const resolution = classifyReviewCenterStatus(input);
    assert.equal(resolution.code, code, name);
    assert.equal(resolution.tab, tab, name);
    assert.ok(resolution.displayLabel, `${name} should have a display label`);
    assert.ok(resolution.actionability, `${name} should have an actionability`);
    assert.ok(resolution.confidence, `${name} should have a confidence`);
  }
});

test("every recognized official workflow stage keeps its own tab", () => {
  const stages = [
    ["awaiting_review", "official_awaiting_review", "awaiting_review"],
    ["awaiting_price", "official_awaiting_price", "awaiting_price"],
    ["awaiting_sample", "official_awaiting_sample", "awaiting_sample"],
    ["awaiting_version_review", "official_awaiting_version_review", "awaiting_version_review"],
    ["awaiting_sample_review", "official_awaiting_sample_review", "awaiting_sample_review"],
    ["awaiting_final_review", "official_awaiting_final_review", "awaiting_final_review"],
  ];
  for (const [stage, code, tab] of stages) {
    const resolution = classifyReviewCenterStatus({ audit: { workflowStage: stage } });
    assert.equal(resolution.code, code, stage);
    assert.equal(resolution.tab, tab, stage);
  }
  assert.equal(
    classifyReviewCenterStatus({ audit: { workflowStage: "rejected" } }).code,
    "official_rejected",
  );
});

test("local execution states retain distinct meanings when official evidence is absent", () => {
  assert.equal(classifyReviewCenterStatus({ execution: { state: "authorized" } }).code, "publish_queued");
  assert.equal(classifyReviewCenterStatus({ execution: { state: "claimed" } }).code, "publish_executing");
  assert.equal(classifyReviewCenterStatus({ execution: { state: "preflighting" } }).code, "publish_executing");
  assert.equal(classifyReviewCenterStatus({ execution: { state: "failed_retryable" } }).code, "publish_failed_retryable");
  assert.equal(classifyReviewCenterStatus({ execution: { state: "failed_terminal" } }).code, "publish_failed_terminal");
  assert.equal(classifyReviewCenterStatus({ draftStatus: "ready" }).code, "official_state_unknown");
});

test("official facts outrank local execution and generic workflow hints", () => {
  assert.equal(
    classifyReviewCenterStatus({
      execution: { state: "submitted" },
      audit: { state: 3, workflowStage: "awaiting_review" },
    }).code,
    "official_rejected",
  );
  assert.equal(
    classifyReviewCenterStatus({
      execution: { state: "completed" },
      audit: { state: 1, workflowStage: "awaiting_price" },
    }).code,
    "official_awaiting_price",
  );
  assert.equal(
    classifyReviewCenterStatus({
      execution: { state: "completed" },
      audit: { state: 2 },
    }).code,
    "official_passed",
  );
});

test("result unknown and audit withdrawal are never treated as rejection or success", () => {
  const unknown = classifyReviewCenterStatus({ execution: { state: "result_unknown" } });
  const withdrawn = classifyReviewCenterStatus({ audit: { state: 4 } });
  assert.notEqual(unknown.code, "official_rejected");
  assert.notEqual(unknown.code, "listed");
  assert.notEqual(withdrawn.code, "official_rejected");
  assert.notEqual(withdrawn.code, "listed");
});

test("unsupported official workflow values remain explicitly unknown", () => {
  const result = classifyReviewCenterStatus({
    execution: { state: "submitted" },
    audit: { workflowStage: "new_platform_stage" },
  });
  assert.equal(result.code, "publish_submitted_waiting_receipt");
  assert.equal(
    classifyReviewCenterStatus({ audit: { workflowStage: "new_platform_stage" } }).code,
    "official_state_unknown",
  );
});
