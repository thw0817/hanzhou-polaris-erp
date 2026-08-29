import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAppContext } from "../../app/AppShell";
import { ApiError, api } from "../../lib/api";
import { activeJobRefetchInterval } from "../../lib/refresh-state";

export function useBusinessDashboard(storeId: string) {
  const { session } = useAppContext();
  const queryClient = useQueryClient();
  const queryScope = `${session.tenant.id}:${session.user.id}`;
  // A hook instance survives a store switch in the shared operations shell.
  // Keep the active refresh job tied to the exact tenant/user/store scope so
  // the next store can never poll the previous store's job ID.
  const scopeKey = `${queryScope}:${storeId}`;
  const queryKey = ["store", queryScope, storeId, "business-dashboard"] as const;
  const query = useQuery({
    queryKey,
    queryFn: () => api.businessDashboard(storeId),
    enabled: Boolean(storeId),
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  });
  const [activeJob, setActiveJob] = useState<{ scopeKey: string; id: string } | null>(null);
  const activeJobId = activeJob?.scopeKey === scopeKey ? activeJob.id : null;
  const jobQuery = useQuery({
    queryKey: ["store", queryScope, storeId, "business-dashboard-refresh-job", activeJobId],
    queryFn: () => api.syncJob(storeId, activeJobId!),
    enabled: Boolean(storeId && activeJobId),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
    refetchInterval: activeJobRefetchInterval,
    refetchIntervalInBackground: false,
  });
  const refresh = useMutation({
    mutationFn: () => api.refreshBusinessDashboard(storeId),
    onSuccess: (result) => {
      queryClient.setQueryData(queryKey, result);
      const jobId = result.refreshJob?.id || "";
      setActiveJob(jobId ? { scopeKey, id: jobId } : null);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === "SHEIN_REAUTHORIZATION_REQUIRED") {
        void queryClient.invalidateQueries({ queryKey: ["stores"] });
      }
    },
  });
  useEffect(() => {
    const persistedJobId = query.data?.refreshJob?.id || null;
    if (!activeJobId && persistedJobId) setActiveJob({ scopeKey, id: persistedJobId });
  }, [activeJobId, query.data?.refreshJob?.id, scopeKey]);
  useEffect(() => {
    const state = jobQuery.data?.job?.state;
    if (!activeJobId || !state || !["succeeded", "completed", "completed_with_errors", "failed", "cancelled"].includes(state)) return;
    setActiveJob(null);
    void queryClient.invalidateQueries({ queryKey, refetchType: "active" });
  }, [activeJobId, jobQuery.data?.job?.state, queryClient, queryKey]);
  return {
    ...query,
    refresh,
    refreshError: refresh.error instanceof Error ? refresh.error : null,
    refreshJob: jobQuery.data?.job || query.data?.refreshJob || null,
  };
}
