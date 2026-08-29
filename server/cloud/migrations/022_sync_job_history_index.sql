CREATE INDEX IF NOT EXISTS sync_jobs_tenant_store_history_idx
  ON sync_jobs (tenant_id, store_id, created_at DESC, id DESC);

COMMENT ON INDEX sync_jobs_tenant_store_history_idx IS
  'Supports recent sync task history reads scoped to one tenant and store.';
