import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Bound inactive route data in long-lived browser sessions. Pages that
      // need a longer working set (for example the publish center) opt in with
      // their own gcTime, while manual-refresh pages never poll by default.
      gcTime: 5 * 60_000,
      staleTime: 30_000,
      retry: (failureCount, error) => {
        const status = Number((error as { status?: number })?.status || 0);
        return status >= 500 && failureCount < 1;
      },
      // A single bounded retry is enough for transient 5xx responses. Delay it
      // so several visible routes do not immediately stampede the API again.
      retryDelay: (attemptIndex) => Math.min(1000 * (2 ** attemptIndex), 4000),
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
    mutations: { retry: false },
  },
});
