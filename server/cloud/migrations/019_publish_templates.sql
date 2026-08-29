CREATE TABLE IF NOT EXISTS publish_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  template_type text NOT NULL
    CHECK (template_type IN ('attribute', 'size', 'packaging', 'tail_image', 'compliance')),
  name text NOT NULL,
  category_id text NOT NULL DEFAULT '',
  product_type_id text NOT NULL DEFAULT '',
  schema_fingerprint text NOT NULL DEFAULT '',
  template_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS publish_templates_store_type_name_idx
  ON publish_templates (tenant_id, store_id, template_type, lower(name));

CREATE INDEX IF NOT EXISTS publish_templates_store_updated_idx
  ON publish_templates (tenant_id, store_id, updated_at DESC);

COMMENT ON TABLE publish_templates IS
  'Store-scoped reusable SHEIN publish templates. Dynamic API schemas must be revalidated before use.';
