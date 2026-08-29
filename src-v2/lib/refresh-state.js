const TERMINAL_STATES = new Set([
  "succeeded",
  "completed",
  "completed_with_errors",
  "failed",
  "cancelled",
]);

function jobFromData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const job = data.job ?? data.refreshJob;
  return job && typeof job === "object" && !Array.isArray(job) ? job : null;
}

/**
 * Poll active SHEIN tasks quickly at first, then back off for long-running
 * jobs. Terminal jobs stop polling so a page never creates a background loop.
 */
export function activeJobRefetchInterval(query, now = Date.now()) {
  if (query.state?.status === "error") return false;
  const job = jobFromData(query.state?.data);
  // A query can be pending before its first response. Without a persisted
  // active job there is nothing to poll, so avoid creating an unbounded loop.
  if (!job) return false;
  const state = typeof job?.state === "string" ? job.state : "";
  if (TERMINAL_STATES.has(state)) return false;
  const startedAt = Date.parse(String(job?.startedAt || job?.createdAt || ""));
  if (!Number.isFinite(startedAt)) return 1_500;
  const age = Math.max(0, now - startedAt);
  if (age < 10_000) return 1_500;
  if (age < 30_000) return 3_000;
  if (age < 90_000) return 5_000;
  return 10_000;
}
