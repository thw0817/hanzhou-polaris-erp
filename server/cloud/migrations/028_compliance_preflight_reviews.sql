CREATE TABLE IF NOT EXISTS compliance_preflight_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  skc_id uuid NOT NULL REFERENCES skcs(id) ON DELETE CASCADE,
  skc_name text NOT NULL,
  preflight_run_id uuid NOT NULL
    REFERENCES compliance_preflight_runs(id) ON DELETE RESTRICT,
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewer_display_name text NOT NULL,
  reviewed_status text NOT NULL
    CHECK (reviewed_status IN ('compliant', 'blocked', 'rules_pending', 'ready', 'waiting_review')),
  action_count integer NOT NULL CHECK (action_count >= 0),
  blocker_count integer NOT NULL CHECK (blocker_count >= 0),
  warning_count integer NOT NULL CHECK (warning_count >= 0),
  input_fingerprint text NOT NULL,
  rule_fingerprint text NOT NULL,
  media_fingerprint text NOT NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS compliance_preflight_reviews_run_user_idx
  ON compliance_preflight_reviews (preflight_run_id, reviewed_by);

CREATE INDEX IF NOT EXISTS compliance_preflight_reviews_scope_idx
  ON compliance_preflight_reviews (
    tenant_id,
    store_id,
    skc_name,
    preflight_run_id,
    reviewed_at DESC
  );

COMMENT ON TABLE compliance_preflight_reviews IS
  'Append-only administrator acknowledgement of a server dry-run. This record does not authorize SHEIN writes or publishing.';
