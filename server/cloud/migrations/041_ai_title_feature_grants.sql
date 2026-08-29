CREATE TABLE IF NOT EXISTS ai_feature_grants (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature_code text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  granted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id, feature_code),
  CONSTRAINT ai_feature_grants_feature_check CHECK (feature_code IN ('ai_title'))
);

CREATE INDEX IF NOT EXISTS ai_feature_grants_user_idx
  ON ai_feature_grants (tenant_id, user_id, feature_code, enabled);

COMMENT ON TABLE ai_feature_grants IS
  'Tenant-scoped feature grants. AI title access is checked server-side; UI visibility is only a convenience.';
