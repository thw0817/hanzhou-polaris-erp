CREATE TABLE IF NOT EXISTS shein_rule_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  rule_type text NOT NULL
    CHECK (rule_type IN (
      'category_tree',
      'publish_standard',
      'attribute_template',
      'associated_rules',
      'compliance_requirement',
      'certificate_schema'
    )),
  category_id text NOT NULL DEFAULT '',
  product_type_id text NOT NULL DEFAULT '',
  subject_key text NOT NULL DEFAULT '',
  fingerprint text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_trace_id text,
  fetched_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, rule_type, category_id, product_type_id, subject_key)
);

CREATE INDEX IF NOT EXISTS shein_rule_snapshots_tenant_store_expiry_idx
  ON shein_rule_snapshots (tenant_id, store_id, expires_at);

COMMENT ON TABLE shein_rule_snapshots IS
  'Store-scoped snapshots of dynamic SHEIN rules. Live preflight must reject expired snapshots.';
