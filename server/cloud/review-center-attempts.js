function text(value, maxLength = 500) {
  const result = typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
  return result.slice(0, maxLength);
}

function safeJson(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function skcNames(row) {
  const parsed = safeJson(row.request_skc_names);
  const values = Array.isArray(parsed)
    ? parsed
    : row.skc_name
      ? [row.skc_name]
      : [];
  return Array.from(new Set(values.map((value) => text(value, 200)).filter(Boolean)));
}

function timeValue(row) {
  const value = row.job_updated_at || row.job_submitted_at || row.job_created_at;
  const time = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(time) ? time : -Infinity;
}

function compareNewest(left, right) {
  const leftTime = timeValue(left);
  const rightTime = timeValue(right);
  if (leftTime !== rightTime) return rightTime - leftTime;
  return text(right.publish_job_id, 200).localeCompare(text(left.publish_job_id, 200));
}

function attemptReason(row) {
  return text(
    row.attempt_reason
      ?? row.request_attempt_reason
      ?? row.request_summary?.attemptReason
      ?? row.request_summary?.attempt_reason,
    80,
  ) || null;
}

function publicAttempt(row, businessAttemptNo, current) {
  const publishJobId = text(row.publish_job_id, 200) || null;
  const version = text(row.version, 200) || null;
  const documentSn = text(row.document_sn ?? row.shein_document_sn, 200) || null;
  const reviewKey = text(row.review_key, 400)
    || (version ? `version:${version}` : publishJobId ? `job:${publishJobId}` : null);
  return {
    businessAttemptId: publishJobId ? `job:${publishJobId}` : null,
    businessAttemptNo,
    current,
    reason: attemptReason(row),
    reasonSource: attemptReason(row) ? "persisted" : "unavailable",
    parentAttemptId: text(row.parent_attempt_id ?? row.request_summary?.parentAttemptId, 200) || null,
    supersedesAttemptId: text(row.supersedes_attempt_id ?? row.request_summary?.supersedesAttemptId, 200) || null,
    localAttemptId: publishJobId,
    requestKey: text(row.request_key, 400) || null,
    idempotencyKey: text(row.idempotency_key, 400) || null,
    sourceCandidateFingerprint: text(row.source_candidate_fingerprint, 400) || null,
    remoteCandidateFingerprint: text(row.remote_candidate_fingerprint, 400) || null,
    publishJobId,
    publishBatchId: text(row.publish_batch_id, 200) || null,
    executionRunId: text(row.execution_run_id, 200) || null,
    sheinVersion: version,
    sheinDocumentSn: documentSn,
    documentAuditVersion: text(row.publish_audit_version, 200) || null,
    documentAuditState: text(row.publish_audit_state, 40) || null,
    documentAuditStateLabel: text(row.publish_audit_state_label, 80) || null,
    documentAuditReceiptStatus: text(row.publish_audit_receipt_status, 40) || null,
    documentAuditOccurredAt: row.publish_audit_occurred_at || null,
    documentAuditReceivedAt: row.publish_audit_received_at || null,
    reviewKey,
    executionState: text(row.publish_job_state, 80) || null,
    executionAttemptCount: Number.isFinite(Number(row.execution_attempt_count ?? row.attempt_count))
      ? Number(row.execution_attempt_count ?? row.attempt_count)
      : 0,
    preflightAttemptCount: Number.isFinite(Number(row.preflight_attempt_count))
      ? Number(row.preflight_attempt_count)
      : null,
    submittedAt: row.job_submitted_at || null,
    createdAt: row.job_created_at || null,
    updatedAt: row.job_updated_at || null,
  };
}

/**
 * Build a read-only attempt projection from existing publish jobs. It never
 * invents a parent/relaunch relation when the old schema did not persist one.
 */
export function projectPublishAttempts(rows = []) {
  const bySkcRows = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!text(row.publish_job_id, 200)) continue;
    for (const skcName of skcNames(row)) {
      const current = bySkcRows.get(skcName) || [];
      current.push(row);
      bySkcRows.set(skcName, current);
    }
  }

  const bySkc = new Map();
  const byReviewKey = new Map();
  for (const [skcName, sourceRows] of bySkcRows) {
    const sorted = [...sourceRows].sort(compareNewest);
    const history = sorted.map((row, index) => publicAttempt(
      row,
      sorted.length - index,
      index === 0,
    ));
    const current = history[0] || null;
    if (current) {
      bySkc.set(skcName, { current, history });
      for (const attempt of history) {
        if (attempt.reviewKey) byReviewKey.set(attempt.reviewKey, attempt);
      }
    }
  }
  return { bySkc, byReviewKey };
}
