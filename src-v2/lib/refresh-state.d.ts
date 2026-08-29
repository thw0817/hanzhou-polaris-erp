export function activeJobRefetchInterval(
  query: { state?: { status?: string; data?: unknown } },
  now?: number,
): number | false;

