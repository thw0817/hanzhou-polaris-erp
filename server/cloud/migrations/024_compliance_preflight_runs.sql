CREATE TABLE IF NOT EXISTS compliance_preflight_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  skc_id uuid NOT NULL REFERENCES skcs(id) ON DELETE CASCADE,
  skc_name text NOT NULL,
  draft_id uuid NOT NULL REFERENCES compliance_drafts(id) ON DELETE CASCADE,
  requirement_rule_snapshot_id uuid NOT NULL
    REFERENCES shein_rule_snapshots(id) ON DELETE RESTRICT,
  certificate_rule_snapshot_id uuid
    REFERENCES shein_rule_snapshots(id) ON DELETE RESTRICT,
  input_fingerprint text NOT NULL,
  rule_fingerprint text NOT NULL,
  media_fingerprint text NOT NULL,
  status text NOT NULL
    CHECK (status IN ('compliant', 'blocked', 'rules_pending', 'ready', 'waiting_review')),
  executable boolean NOT NULL DEFAULT false,
  plan jsonb NOT NULL DEFAULT '{}'::jsonb,
  media_assets jsonb NOT NULL DEFAULT '[]'::jsonb,
  requested_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS compliance_preflight_runs_tenant_store_skc_idx
  ON compliance_preflight_runs (tenant_id, store_id, skc_name, created_at DESC);

COMMENT ON TABLE compliance_preflight_runs IS
  'Append-only server-computed compliance dry-run audit. This table does not authorize SHEIN writes.';
