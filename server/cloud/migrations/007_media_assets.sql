CREATE TABLE IF NOT EXISTS media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id uuid REFERENCES stores(id) ON DELETE CASCADE,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  provider text NOT NULL,
  bucket text NOT NULL,
  object_key text NOT NULL,
  purpose text NOT NULL CHECK (
    purpose IN (
      'temporary_upload',
      'generated_unselected',
      'selected_unpublished',
      'published_archive',
      'compliance_evidence',
      'thumbnail'
    )
  ),
  status text NOT NULL DEFAULT 'uploading' CHECK (
    status IN (
      'uploading',
      'ready',
      'referenced',
      'pending_delete',
      'deleting',
      'deleted',
      'failed'
    )
  ),
  original_name text NOT NULL DEFAULT '',
  content_type text NOT NULL DEFAULT '',
  size_bytes bigint NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
  sha256 text,
  width integer,
  height integer,
  reference_count integer NOT NULL DEFAULT 0 CHECK (reference_count >= 0),
  expires_at timestamptz,
  delete_after timestamptz,
  deleted_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, bucket, object_key)
);

CREATE INDEX IF NOT EXISTS media_assets_tenant_store_status_idx
  ON media_assets (tenant_id, store_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS media_assets_cleanup_idx
  ON media_assets (expires_at, delete_after)
  WHERE status IN ('ready', 'pending_delete', 'failed', 'deleting');

CREATE INDEX IF NOT EXISTS media_assets_sha256_idx
  ON media_assets (tenant_id, sha256)
  WHERE sha256 IS NOT NULL AND status <> 'deleted';

CREATE TABLE IF NOT EXISTS media_asset_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id uuid REFERENCES stores(id) ON DELETE CASCADE,
  reference_type text NOT NULL CHECK (
    reference_type IN (
      'product_draft',
      'product_template',
      'publish_job',
      'skc',
      'spu',
      'compliance_record',
      'generation_job'
    )
  ),
  reference_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (asset_id, reference_type, reference_key)
);

CREATE INDEX IF NOT EXISTS media_asset_references_lookup_idx
  ON media_asset_references (tenant_id, reference_type, reference_key);

CREATE TABLE IF NOT EXISTS image_generation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id uuid REFERENCES stores(id) ON DELETE CASCADE,
  requested_by uuid REFERENCES users(id) ON DELETE SET NULL,
  provider text NOT NULL,
  state text NOT NULL DEFAULT 'queued' CHECK (
    state IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')
  ),
  input_asset_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  selected_asset_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  request_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  error jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS image_generation_jobs_tenant_state_idx
  ON image_generation_jobs (tenant_id, state, created_at DESC);

COMMENT ON TABLE media_assets IS
  'Object-storage metadata only. Image bytes live in the configured object store, never in PostgreSQL.';

COMMENT ON COLUMN media_assets.delete_after IS
  'Seven-day recovery window after an expired unreferenced asset is marked pending_delete.';
