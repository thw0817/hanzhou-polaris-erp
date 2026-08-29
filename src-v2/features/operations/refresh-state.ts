import { useEffect, useState } from "react";

const MANUAL_REFRESH_COOLDOWN_MS = 60_000;

export function refreshCooldownSeconds({
  retryAfterSeconds = 0,
  lastManualRefreshAt,
  now = Date.now(),
}: {
  retryAfterSeconds?: number;
  lastManualRefreshAt?: string | null;
  now?: number;
} = {}) {
  const retryAfter = Number(retryAfterSeconds);
  const fallback = Number.isFinite(retryAfter) ? Math.max(0, Math.ceil(retryAfter)) : 0;
  const timestamp = lastManualRefreshAt ? Date.parse(lastManualRefreshAt) : NaN;
  if (!Number.isFinite(timestamp)) return fallback;
  const localRemaining = Math.max(0, Math.ceil((timestamp + MANUAL_REFRESH_COOLDOWN_MS - now) / 1000));
  // The server may impose a longer retry window (for example, upstream
  // rate-limiting). Never re-enable a refresh button before that authority.
  return Math.max(fallback, localRemaining);
}

/**
 * Whether the local cooldown still has time remaining. This intentionally
 * derives from both server retryAfter and the persisted manual-refresh
 * timestamp so a response with retryAfter=0 cannot freeze the countdown.
 */
export function refreshCooldownActive(
  retryAfterSeconds = 0,
  lastManualRefreshAt?: string | null,
  now = Date.now(),
) {
  return refreshCooldownSeconds({ retryAfterSeconds, lastManualRefreshAt, now }) > 0;
}

/**
 * Counts down a server-provided cooldown locally. The interval only exists
 * while a cooldown is visible and never triggers a network request.
 */
export function useRefreshCooldown(
  retryAfterSeconds = 0,
  lastManualRefreshAt?: string | null,
) {
  const cooling = refreshCooldownActive(retryAfterSeconds, lastManualRefreshAt);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!cooling) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [cooling, lastManualRefreshAt]);

  return refreshCooldownSeconds({ retryAfterSeconds, lastManualRefreshAt, now });
}
