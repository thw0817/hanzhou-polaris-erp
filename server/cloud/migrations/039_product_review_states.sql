CREATE TABLE IF NOT EXISTS product_review_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  review_key text NOT NULL,
  version text,
  document_sn text,
  spu_name text,
  skc_name text,
  sku_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  audit_state integer CHECK (audit_state IS NULL OR audit_state IN (1, 2, 3, 4)),
  audit_state_label text CHECK (
    audit_state_label IS NULL OR
    audit_state_label IN ('pending', 'passed', 'failed', 'withdrawn', 'unknown')
  ),
  failed_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  occurred_at timestamptz,
  archived_at timestamptz,
  archived_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, store_id, review_key)
);

CREATE INDEX IF NOT EXISTS product_review_states_store_active_idx
  ON product_review_states (tenant_id, store_id, updated_at DESC)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS product_review_states_version_idx
  ON product_review_states (tenant_id, store_id, version)
  WHERE version IS NOT NULL;

COMMENT ON TABLE product_review_states IS
  'Store-scoped read projection for SHEIN product review status and local-only review-center archives. Archiving never deletes or mutates a SHEIN product.';
