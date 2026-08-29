CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migrations (
  filename text PRIMARY KEY,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  display_name text NOT NULL DEFAULT '',
  password_hash text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (email)
);

CREATE TABLE IF NOT EXISTS memberships (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'operator', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  platform text NOT NULL DEFAULT 'shein',
  supplier_id text,
  open_key_id text NOT NULL,
  label text NOT NULL DEFAULT '',
  business_mode text NOT NULL DEFAULT '全托管',
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'reauthorization_required', 'disabled')),
  authorized_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, open_key_id)
);

CREATE INDEX IF NOT EXISTS stores_tenant_status_idx
  ON stores (tenant_id, status);

CREATE TABLE IF NOT EXISTS store_credentials (
  store_id uuid PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  ciphertext bytea NOT NULL,
  iv bytea NOT NULL,
  auth_tag bytea NOT NULL,
  encrypted_data_key bytea,
  key_version integer NOT NULL DEFAULT 1,
  algorithm text NOT NULL DEFAULT 'AES-256-GCM',
  rotated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS spus (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  spu_name text NOT NULL,
  title text NOT NULL DEFAULT '',
  category_id text,
  category_name text,
  audit_state integer,
  raw_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  platform_created_at timestamptz,
  platform_updated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, spu_name)
);

CREATE INDEX IF NOT EXISTS spus_tenant_store_updated_idx
  ON spus (tenant_id, store_id, platform_updated_at DESC);

CREATE TABLE IF NOT EXISTS skcs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  spu_id uuid REFERENCES spus(id) ON DELETE SET NULL,
  skc_name text NOT NULL,
  supplier_code text,
  shelf_status text,
  compliance_status text,
  compliance_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, skc_name)
);

CREATE INDEX IF NOT EXISTS skcs_tenant_store_compliance_idx
  ON skcs (tenant_id, store_id, compliance_status);

CREATE TABLE IF NOT EXISTS skus (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  skc_id uuid REFERENCES skcs(id) ON DELETE SET NULL,
  sku_code text NOT NULL,
  supplier_sku text,
  size_label text,
  inventory integer,
  raw_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, sku_code)
);

CREATE INDEX IF NOT EXISTS skus_tenant_store_supplier_idx
  ON skus (tenant_id, store_id, supplier_sku);

CREATE TABLE IF NOT EXISTS sku_sales_daily (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  sku_id uuid NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
  sale_date date NOT NULL,
  real_time_sale_count integer NOT NULL DEFAULT 0,
  yesterday_sale_count integer NOT NULL DEFAULT 0,
  seven_day_sale_count integer NOT NULL DEFAULT 0,
  thirty_day_sale_count integer NOT NULL DEFAULT 0,
  source_cutoff text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, sku_id, sale_date)
) PARTITION BY RANGE (sale_date);

CREATE TABLE IF NOT EXISTS sku_sales_daily_default
  PARTITION OF sku_sales_daily DEFAULT;

CREATE INDEX IF NOT EXISTS sku_sales_daily_tenant_date_idx
  ON sku_sales_daily (tenant_id, sale_date DESC);

CREATE TABLE IF NOT EXISTS store_sales_daily (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  sale_date date NOT NULL,
  real_time_sale_count bigint NOT NULL DEFAULT 0,
  yesterday_sale_count bigint NOT NULL DEFAULT 0,
  seven_day_sale_count bigint NOT NULL DEFAULT 0,
  thirty_day_sale_count bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, sale_date)
);

CREATE INDEX IF NOT EXISTS store_sales_daily_tenant_date_idx
  ON store_sales_daily (tenant_id, sale_date DESC);

CREATE TABLE IF NOT EXISTS inventory_snapshots (
  id bigserial,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  sku_id uuid NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
  warehouse_code text NOT NULL DEFAULT '',
  available_quantity integer NOT NULL DEFAULT 0,
  captured_at timestamptz NOT NULL DEFAULT now(),
  source_trace_id text,
  PRIMARY KEY (id, captured_at)
) PARTITION BY RANGE (captured_at);

CREATE TABLE IF NOT EXISTS inventory_snapshots_default
  PARTITION OF inventory_snapshots DEFAULT;

CREATE INDEX IF NOT EXISTS inventory_snapshots_store_sku_time_idx
  ON inventory_snapshots (tenant_id, store_id, sku_id, captured_at DESC);

CREATE TABLE IF NOT EXISTS skc_compliance_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  skc_id uuid NOT NULL REFERENCES skcs(id) ON DELETE CASCADE,
  requirement_type text NOT NULL,
  requirement_key text NOT NULL,
  status text,
  required boolean,
  requirement_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_trace_id text,
  checked_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, skc_id, requirement_type, requirement_key)
);

CREATE INDEX IF NOT EXISTS skc_compliance_records_store_status_idx
  ON skc_compliance_records (tenant_id, store_id, status);

CREATE TABLE IF NOT EXISTS product_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id uuid REFERENCES stores(id) ON DELETE SET NULL,
  name text NOT NULL,
  category_id text NOT NULL,
  schema_version text,
  template_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS size_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  category_id text,
  size_rows jsonb NOT NULL DEFAULT '[]'::jsonb,
  package_table_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS compliance_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id uuid REFERENCES stores(id) ON DELETE SET NULL,
  name text NOT NULL,
  category_id text,
  template_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS sync_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id uuid REFERENCES stores(id) ON DELETE CASCADE,
  job_type text NOT NULL,
  state text NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  cursor jsonb NOT NULL DEFAULT '{}'::jsonb,
  progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  error jsonb,
  requested_by uuid REFERENCES users(id) ON DELETE SET NULL,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sync_jobs_tenant_state_idx
  ON sync_jobs (tenant_id, state, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS sync_jobs_one_active_per_store_type_idx
  ON sync_jobs (store_id, job_type)
  WHERE state IN ('queued', 'running');

CREATE TABLE IF NOT EXISTS sync_job_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES sync_jobs(id) ON DELETE CASCADE,
  item_key text NOT NULL,
  state text NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued', 'running', 'succeeded', 'failed', 'skipped')),
  attempt_count integer NOT NULL DEFAULT 0,
  trace_id text,
  result jsonb,
  error jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, item_key)
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  store_id uuid REFERENCES stores(id) ON DELETE SET NULL,
  app_id text NOT NULL,
  event_type text NOT NULL,
  dedupe_key text NOT NULL,
  payload jsonb NOT NULL,
  safe_headers jsonb NOT NULL DEFAULT '{}'::jsonb,
  state text NOT NULL DEFAULT 'received'
    CHECK (state IN ('received', 'queued', 'processing', 'processed', 'failed', 'ignored')),
  queue_job_id text,
  attempt_count integer NOT NULL DEFAULT 0,
  last_error jsonb,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (app_id, event_type, dedupe_key)
);

CREATE INDEX IF NOT EXISTS webhook_events_state_received_idx
  ON webhook_events (state, received_at);

CREATE TABLE IF NOT EXISTS api_audit_logs (
  id bigserial PRIMARY KEY,
  tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
  store_id uuid REFERENCES stores(id) ON DELETE SET NULL,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  operation text NOT NULL,
  method text,
  path text,
  status_code integer,
  trace_id text,
  duration_ms integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS api_audit_logs_tenant_created_idx
  ON api_audit_logs (tenant_id, created_at DESC);

COMMENT ON TABLE store_credentials IS
  'Encrypted store secret material only. Plaintext secrets must never be persisted.';
COMMENT ON TABLE size_templates IS
  'Package spreadsheet metadata may be stored; original local files and image bytes remain on the desktop.';
