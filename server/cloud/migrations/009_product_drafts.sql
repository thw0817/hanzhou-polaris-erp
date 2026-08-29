CREATE TABLE IF NOT EXISTS product_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name text NOT NULL,
  category_id text NOT NULL DEFAULT '',
  product_type_id text NOT NULL DEFAULT '',
  draft_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  preflight jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'blocked', 'ready', 'published', 'archived')),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_drafts_tenant_store_status_idx
  ON product_drafts (tenant_id, store_id, status, updated_at DESC);

COMMENT ON TABLE product_drafts IS
  'Collaborative web product drafts. Publishing remains disabled until server-side confirmation and post-write readback are enabled.';
