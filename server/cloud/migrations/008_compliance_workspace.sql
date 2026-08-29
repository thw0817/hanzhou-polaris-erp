CREATE TABLE IF NOT EXISTS compliance_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id uuid REFERENCES stores(id) ON DELETE CASCADE,
  name text NOT NULL,
  reference_skc text NOT NULL DEFAULT '',
  defaults jsonb NOT NULL DEFAULT '{}'::jsonb,
  rule_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  rule_snapshot_at timestamptz,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, store_id, name)
);

-- Early cloud releases created compliance_templates before the collaborative
-- web workspace schema was finalized. CREATE TABLE IF NOT EXISTS deliberately
-- preserves that table, so add every newer column explicitly before indexes
-- or repositories depend on them. Legacy columns remain untouched.
ALTER TABLE compliance_templates
  ADD COLUMN IF NOT EXISTS reference_skc text NOT NULL DEFAULT '';

ALTER TABLE compliance_templates
  ADD COLUMN IF NOT EXISTS defaults jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE compliance_templates
  ADD COLUMN IF NOT EXISTS rule_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE compliance_templates
  ADD COLUMN IF NOT EXISTS rule_snapshot_at timestamptz;

ALTER TABLE compliance_templates
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived'));

ALTER TABLE compliance_templates
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1
    CHECK (version > 0);

ALTER TABLE compliance_templates
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS compliance_templates_tenant_store_name_uidx
  ON compliance_templates (tenant_id, store_id, name);

CREATE INDEX IF NOT EXISTS compliance_templates_tenant_store_idx
  ON compliance_templates (tenant_id, store_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS compliance_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  skc_name text NOT NULL,
  template_id uuid REFERENCES compliance_templates(id) ON DELETE SET NULL,
  requirement_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  inputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  preflight jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft'
    CHECK (
      status IN (
        'draft',
        'blocked',
        'ready',
        'waiting_review',
        'submitted',
        'archived'
      )
    ),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, skc_name)
);

CREATE INDEX IF NOT EXISTS compliance_drafts_tenant_store_status_idx
  ON compliance_drafts (tenant_id, store_id, status, updated_at DESC);

COMMENT ON TABLE compliance_templates IS
  'Reusable compliance defaults only. Per-SKC 1630/1631 evidence must remain in compliance_drafts.';

COMMENT ON TABLE compliance_drafts IS
  'Collaborative web drafts. Real SHEIN writes remain gated behind server-side preflight and explicit confirmation.';
