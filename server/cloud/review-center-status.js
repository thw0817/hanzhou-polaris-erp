const AUDIT_STATE_LABELS = new Map([
  [1, "pending"],
  [2, "passed"],
  [3, "failed"],
  [4, "withdrawn"],
]);

const WORKFLOW_STAGE_ALIASES = new Map([
  ["awaiting_review", "awaiting_review"],
  ["pending_review", "awaiting_review"],
  ["待审核", "awaiting_review"],
  ["审核中", "awaiting_review"],
  ["提交中", "awaiting_review"],
  ["已提交，待审核", "awaiting_review"],
  ["已接收，待审核", "awaiting_review"],
  ["awaiting_price", "awaiting_price"],
  ["pending_price", "awaiting_price"],
  ["待核价", "awaiting_price"],
  ["awaiting_sample", "awaiting_sample"],
  ["pending_sample", "awaiting_sample"],
  ["待寄样", "awaiting_sample"],
  ["awaiting_version_review", "awaiting_version_review"],
  ["pending_version_review", "awaiting_version_review"],
  ["待审版", "awaiting_version_review"],
  ["awaiting_sample_review", "awaiting_sample_review"],
  ["pending_sample_review", "awaiting_sample_review"],
  ["待核样", "awaiting_sample_review"],
  ["awaiting_final_review", "awaiting_final_review"],
  ["pending_final_review", "awaiting_final_review"],
  ["待终审", "awaiting_final_review"],
  ["rejected", "rejected"],
  ["failed", "rejected"],
  ["已驳回", "rejected"],
  ["审核失败", "rejected"],
  ["passed", "passed"],
  ["approved", "passed"],
  ["已通过", "passed"],
]);

const RESOLUTIONS = Object.freeze({
  listed: ["已上架", "all", "continue_workflow", "high"],
  draft_incomplete: ["待完善", "all", "edit", "medium"],
  preflight_blocked: ["需处理", "needs_action", "edit", "medium"],
  publish_queued: ["排队中", "all", "wait", "medium"],
  publish_executing: ["发布执行中", "all", "wait", "medium"],
  publish_submitted_waiting_receipt: ["已提交，待回执", "all", "wait_and_refresh", "medium"],
  publish_result_unknown: ["结果待确认", "needs_action", "refresh_before_retry", "medium"],
  publish_failed_retryable: ["发布失败，可重试", "needs_action", "retry_same_attempt", "medium"],
  publish_failed_terminal: ["发布失败，需处理", "needs_action", "edit_or_resolve", "medium"],
  official_received_waiting_review: ["已接收，待审核", "awaiting_review", "wait", "high"],
  official_receive_failed: ["接收失败", "needs_action", "resolve_and_retry", "high"],
  official_awaiting_review: ["待审核", "awaiting_review", "wait", "high"],
  official_awaiting_price: ["待核价", "awaiting_price", "platform_action", "high"],
  official_awaiting_sample: ["待寄样", "awaiting_sample", "platform_action", "high"],
  official_awaiting_version_review: ["待审版", "awaiting_version_review", "platform_action", "high"],
  official_awaiting_sample_review: ["待核样", "awaiting_sample_review", "platform_action", "high"],
  official_awaiting_final_review: ["待终审", "awaiting_final_review", "wait", "high"],
  official_rejected: ["已驳回", "rejected", "relaunch_or_edit", "high"],
  official_withdrawn: ["已撤回", "needs_action", "relaunch_or_edit", "high"],
  official_passed: ["审核通过", "all", "continue_workflow", "high"],
  official_state_unknown: ["官方状态待确认", "all", "refresh", "low"],
});

function text(value) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function normalizeAuditState(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isInteger(numeric) && AUDIT_STATE_LABELS.has(numeric)
    ? numeric
    : null;
}

function normalizeAuditLabel(value) {
  return text(value).toLowerCase();
}

export function normalizeWorkflowStageValue(value) {
  const normalized = text(value).toLowerCase();
  if (!normalized) return null;
  return WORKFLOW_STAGE_ALIASES.get(normalized) || null;
}

function auditStateOf(audit) {
  const state = normalizeAuditState(audit?.state ?? audit?.auditState ?? audit?.audit_state);
  if (state !== null) return state;
  const label = normalizeAuditLabel(
    audit?.stateLabel ?? audit?.auditStateLabel ?? audit?.audit_state_label,
  );
  for (const [value, knownLabel] of AUDIT_STATE_LABELS) {
    if (label === knownLabel) return value;
  }
  if (["rejected", "reject", "审核失败", "驳回", "已驳回"].includes(label)) return 3;
  if (["withdraw", "撤回", "已撤回"].includes(label)) return 4;
  if (["approved", "已通过"].includes(label)) return 2;
  if (["审核中", "待审核"].includes(label)) return 1;
  return null;
}

function resolution(code, asOf, confidenceOverride = null) {
  const [displayLabel, tab, actionability, confidence] = RESOLUTIONS[code] || RESOLUTIONS.official_state_unknown;
  return {
    code,
    displayLabel,
    tab,
    actionability,
    confidence: confidenceOverride || confidence,
    asOf: asOf || null,
  };
}

/**
 * Resolve one already-bound current attempt. Attempt selection and history
 * filtering happen outside this pure classifier.
 */
export function classifyReviewCenterStatus(input = {}) {
  const execution = input.execution || {};
  const receive = input.receive || {};
  const audit = input.audit || {};
  const listing = input.listing || {};
  const preflight = input.preflight || {};
  const executionState = text(
    execution.state ?? input.executionState ?? input.localState,
  ).toLowerCase();
  const auditState = auditStateOf(audit);
  const auditLabel = normalizeAuditLabel(
    audit.stateLabel
      ?? audit.auditStateLabel
      ?? audit.audit_state_label
      ?? (typeof audit.state === "string" ? audit.state : ""),
  );
  const workflowRaw = text(
    audit.workflowStage ?? audit.workflow_stage ?? input.workflowStage,
  );
  const workflowStage = normalizeWorkflowStageValue(workflowRaw);
  const hasUnsupportedWorkflowStage = Boolean(workflowRaw) && !workflowStage;
  const receiveState = text(receive.state ?? input.receiveState).toLowerCase();
  const listingState = text(listing.state ?? input.listingState).toLowerCase();
  const draftStatus = text(input.draftStatus ?? input.status).toLowerCase();
  const asOf = input.asOf
    || audit.occurredAt
    || receive.occurredAt
    || execution.updatedAt
    || null;

  // A definitive platform listing fact removes the item from the current
  // review queue, regardless of stale local or audit projections.
  if (listingState === "listed" || listingState === "已上架") {
    return resolution("listed", asOf);
  }

  // Official terminal audit facts always outrank stale workflow/local data.
  if (auditState === 3 || ["failed", "rejected", "reject", "审核失败", "驳回", "已驳回"].includes(auditLabel)) {
    return resolution("official_rejected", asOf);
  }
  if (auditState === 4 || ["withdrawn", "withdraw", "撤回", "已撤回"].includes(auditLabel)) {
    return resolution("official_withdrawn", asOf);
  }

  // A recognized specific workflow stage outranks generic audit pending.
  if (workflowStage && workflowStage !== "rejected" && workflowStage !== "passed") {
    return resolution(`official_${workflowStage}`, asOf);
  }
  if (workflowStage === "rejected") {
    return resolution("official_rejected", asOf);
  }
  if (auditState === 1 || auditLabel === "pending" || ["审核中", "待审核"].includes(auditLabel)) {
    return resolution("official_awaiting_review", asOf);
  }
  if (auditState === 2 || auditLabel === "passed" || workflowStage === "passed") {
    return resolution("official_passed", asOf);
  }

  // Receive evidence is official, but it cannot be promoted to an audit
  // result without a corresponding official audit fact.
  if (["failed", "rejected"].includes(receiveState)) {
    return resolution("official_receive_failed", asOf);
  }
  if (["accepted", "received", "success"].includes(receiveState)) {
    return resolution("official_received_waiting_review", asOf);
  }

  // Local execution facts are only used after official evidence is exhausted.
  if (["failed_retryable", "failed"].includes(executionState)) {
    return resolution("publish_failed_retryable", asOf);
  }
  if (executionState === "failed_terminal") {
    return resolution("publish_failed_terminal", asOf);
  }
  if (executionState === "result_unknown") {
    return resolution("publish_result_unknown", asOf);
  }
  if (executionState === "submitted") {
    return resolution("publish_submitted_waiting_receipt", asOf);
  }
  if (["claimed", "preflighting", "running", "executing"].includes(executionState)) {
    return resolution("publish_executing", asOf);
  }
  if (["authorized", "queued", "ready"].includes(executionState)) {
    return resolution("publish_queued", asOf);
  }
  if (draftStatus === "blocked" || preflight.passed === false) {
    return resolution("preflight_blocked", asOf);
  }
  if (["draft", "incomplete"].includes(draftStatus)) {
    return resolution("draft_incomplete", asOf);
  }

  // An unsupported official stage is evidence that the platform state is not
  // safely understood; never silently turn it into a normal pending row.
  if (hasUnsupportedWorkflowStage || Object.keys(audit).length > 0) {
    return resolution("official_state_unknown", asOf, "low");
  }
  return resolution("official_state_unknown", asOf, "low");
}

export const reviewCenterResolutionCodes = Object.freeze(Object.keys(RESOLUTIONS));
