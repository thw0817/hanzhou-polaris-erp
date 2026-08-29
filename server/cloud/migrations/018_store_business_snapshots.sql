CREATE TABLE IF NOT EXISTS store_business_snapshots (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id uuid PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  state text NOT NULL DEFAULT 'idle'
    CHECK (state IN ('idle', 'refreshing', 'ready', 'failed')),
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_cutoff text,
  synced_at timestamptz,
  refresh_started_at timestamptz,
  refresh_completed_at timestamptz,
  refresh_requested_by uuid REFERENCES users(id) ON DELETE SET NULL,
  last_error jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS store_business_snapshots_tenant_sync_idx
  ON store_business_snapshots (tenant_id, synced_at DESC);

COMMENT ON TABLE store_business_snapshots IS
  'Latest real SHEIN product, sales and inventory snapshot for one store. Browser reads never call SHEIN directly.';
