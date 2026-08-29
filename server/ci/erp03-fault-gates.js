const outcomeRank = Object.freeze({ unknown: 0, rejected: 1, accepted: 2 });

export function simulatePublishFault(events = []) {
  const state = {
    commandDurable: false,
    outboxState: "absent",
    deliveredJobIds: new Set(),
    sendStarted: false,
    outcome: null,
    sseConnected: true,
    safeAction: "none",
  };
  for (const event of events) {
    if (event.type === "command_committed") {
      state.commandDurable = true;
      state.outboxState = "pending";
    } else if (event.type === "outbox_delivered") {
      if (state.commandDurable) {
        state.deliveredJobIds.add(String(event.jobId));
        state.outboxState = "delivered";
      }
    } else if (event.type === "worker_send_started") {
      state.sendStarted = true;
      state.safeAction = "no_automatic_retry_after_send_boundary";
    } else if (event.type === "worker_crash_before_send") {
      state.safeAction = "safe_outbox_retry";
    } else if (event.type === "worker_crash_after_send") {
      state.outcome = "unknown";
      state.safeAction = "readback_before_new_attempt";
    } else if (event.type === "shein_accepted") {
      state.outcome = "accepted";
      state.safeAction = "no_retry";
    } else if (event.type === "shein_known_failed") {
      state.outcome = "rejected";
      state.safeAction = "no_retry";
    } else if (event.type === "shein_timeout_after_send") {
      state.outcome = "unknown";
      state.safeAction = "readback_before_new_attempt";
    } else if (event.type === "sse_disconnect") {
      state.sseConnected = false;
      state.safeAction = "reconnect_from_durable_snapshot";
    } else if (event.type === "sse_reconnect") {
      state.sseConnected = true;
    }
  }
  return {
    ...state,
    deliveredJobIds: [...state.deliveredJobIds].sort(),
    durable: state.commandDurable,
    retryable: state.safeAction === "safe_outbox_retry",
  };
}

export function simulateReadbackFault(events = []) {
  const receipts = new Set();
  let currentRank = -1;
  let currentCode = "unknown";
  let attemptState = "clear";
  let projectionState = "current";
  let sourceHealth = "healthy";
  let snapshot = { value: "last-known-good", stale: false };
  for (const event of events) {
    if (event.type === "receipt") {
      if (!receipts.has(event.id)) {
        receipts.add(event.id);
        const rank = outcomeRank[event.code] ?? -1;
        if (rank >= currentRank) {
          currentRank = rank;
          currentCode = event.code;
        }
      }
    } else if (event.type === "ambiguous_attempt") {
      attemptState = "conflict";
    } else if (event.type === "projection_transaction_failed") {
      projectionState = "unchanged";
    } else if (event.type === "source_failed") {
      sourceHealth = "failed";
      snapshot = { ...snapshot, stale: true };
    } else if (event.type === "source_empty_confirmed") {
      sourceHealth = "healthy";
      snapshot = { value: "empty", stale: false };
    }
  }
  return {
    receiptCount: receipts.size,
    currentCode,
    attemptState,
    projectionState,
    sourceHealth,
    snapshot,
  };
}

export function simulateMediaFault(events = []) {
  const state = {
    status: "pending_upload",
    verified: false,
    referenceCreated: false,
    cleanupResumes: false,
    platformReceipt: "missing",
    error: null,
  };
  for (const event of events) {
    if (event.type === "upload_interrupted") {
      state.status = "pending_upload";
    } else if (event.type === "complete") {
      if (state.status === "ready") continue;
      state.status = "ready";
      state.verified = true;
    } else if (event.type === "object_missing") {
      state.status = "quarantined";
      state.verified = false;
      state.error = "MEDIA_OBJECT_MISSING";
    } else if (event.type === "integrity_conflict") {
      state.status = "rejected";
      state.verified = false;
      state.error = event.code;
    } else if (event.type === "version_transaction_failed") {
      state.referenceCreated = false;
    } else if (event.type === "platform_receipt_missing") {
      state.platformReceipt = "unknown";
    } else if (event.type === "cleanup_worker_restart") {
      state.cleanupResumes = true;
    }
  }
  return state;
}
