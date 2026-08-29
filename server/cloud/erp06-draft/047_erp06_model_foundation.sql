-- ERP-06 model foundation: ISOLATED DRAFT ONLY.
--
-- This file is intentionally outside server/cloud/migrations/. The production
-- migration runner must not discover or execute it in this run.
-- COS remains the file authority; PostgreSQL stores metadata and business
-- references only. No legacy row is backfilled by this draft.

-- Scope keys make every new store-scoped foreign key tenant-safe.
ALTER TABLE stores
  ADD CONSTRAINT stores_tenant_id_key UNIQUE (tenant_id, id);

ALTER TABLE product_drafts
  ADD CONSTRAINT product_drafts_scope_id_key UNIQUE (tenant_id, store_id, id);

ALTER TABLE media_assets
  ADD CONSTRAINT media_assets_tenant_id_key UNIQUE (tenant_id, id);

-- Existing mutable tables receive only additive, nullable/defaulted model
-- metadata. The old status column and old read path remain untouched.
ALTER TABLE product_drafts
  ADD COLUMN catalog_product_id uuid,
  ADD COLUMN base_version_id uuid,
  ADD COLUMN revision_no integer NOT NULL DEFAULT 1,
  ADD COLUMN lock_version bigint NOT NULL DEFAULT 0,
  ADD COLUMN schema_version text NOT NULL DEFAULT 'erp06.v1',
  ADD COLUMN editing_status text NOT NULL DEFAULT 'editing';

ALTER TABLE product_drafts
  ADD CONSTRAINT product_drafts_revision_no_chk CHECK (revision_no > 0),
  ADD CONSTRAINT product_drafts_lock_version_chk CHECK (lock_version >= 0),
  ADD CONSTRAINT product_drafts_editing_status_chk CHECK (
    editing_status IN ('editing', 'blocked', 'ready', 'handed_off', 'archived')
  );

ALTER TABLE media_assets
  ADD COLUMN integrity_state text NOT NULL DEFAULT 'unknown',
  ADD COLUMN verified_at timestamptz,
  ADD COLUMN verified_size_bytes bigint,
  ADD COLUMN verified_sha256 text,
  ADD COLUMN verification_source text,
  ADD COLUMN legacy_disposition text NOT NULL DEFAULT 'none';

ALTER TABLE media_assets
  ADD CONSTRAINT media_assets_integrity_state_chk CHECK (
    integrity_state IN (
      'pending_verification', 'verified', 'failed', 'missing', 'unknown'
    )
  ),
  ADD CONSTRAINT media_assets_verified_size_chk CHECK (
    verified_size_bytes IS NULL OR verified_size_bytes >= 0
  ),
  ADD CONSTRAINT media_assets_legacy_disposition_chk CHECK (
    legacy_disposition IN ('none', 'legacy_unversioned', 'frozen_missing')
  ),
  ADD CONSTRAINT media_assets_verified_fields_chk CHECK (
    integrity_state <> 'verified'
    OR (
      verified_at IS NOT NULL
      AND verified_size_bytes IS NOT NULL
      AND verified_sha256 IS NOT NULL
      AND verification_source IS NOT NULL
      AND verification_source <> ''
    )
  );

-- PublishBatch/BatchItem already exist in the legacy schema. These columns are
-- additive and remain nullable so historical rows stay distinguishable and
-- are never backfilled into the ERP-06 model.
ALTER TABLE publish_batches
  ADD COLUMN selection_fingerprint text,
  ADD COLUMN source text,
  ADD COLUMN policy_snapshot jsonb,
  ADD COLUMN confirmed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN confirmed_at timestamptz,
  ADD CONSTRAINT publish_batches_scope_id_key UNIQUE (tenant_id, store_id, id),
  ADD CONSTRAINT publish_batches_source_chk CHECK (
    source IS NULL OR source IN ('drafts', 'relaunch', 'mixed')
  ),
  ADD CONSTRAINT publish_batches_selection_fingerprint_chk CHECK (
    selection_fingerprint IS NULL OR selection_fingerprint <> ''
  );

ALTER TABLE publish_batch_items
  ADD COLUMN tenant_id uuid,
  ADD COLUMN store_id uuid,
  ADD COLUMN catalog_product_id uuid,
  ADD COLUMN product_version_id uuid,
  ADD COLUMN publish_attempt_id uuid,
  ADD COLUMN item_key text,
  ADD COLUMN handoff_state text,
  ADD CONSTRAINT publish_batch_items_scope_id_key UNIQUE (tenant_id, store_id, id),
  ADD CONSTRAINT publish_batch_items_version_key UNIQUE (
    tenant_id, store_id, batch_id, product_version_id
  ),
  ADD CONSTRAINT publish_batch_items_handoff_state_chk CHECK (
    handoff_state IS NULL OR handoff_state IN (
      'pending', 'handed_off', 'result_unknown', 'completed'
    )
  );

ALTER TABLE publish_batch_items
  ADD CONSTRAINT publish_batch_items_scope_batch_fk
    FOREIGN KEY (tenant_id, store_id, batch_id)
    REFERENCES publish_batches (tenant_id, store_id, id) ON DELETE CASCADE;

CREATE TABLE catalog_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  store_id uuid NOT NULL,
  stable_key text NOT NULL,
  title text NOT NULL DEFAULT '',
  lifecycle_status text NOT NULL DEFAULT 'active'
    CHECK (lifecycle_status IN ('active', 'retired', 'archived')),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, store_id, stable_key),
  UNIQUE (tenant_id, store_id, id),
  FOREIGN KEY (tenant_id, store_id)
    REFERENCES stores (tenant_id, id) ON DELETE RESTRICT
);

-- These are mutable read projections only. The immutable ProductVersion and
-- PublishAttempt facts remain the source of truth for reconstruction.
ALTER TABLE catalog_products
  ADD COLUMN current_version_id uuid,
  ADD COLUMN current_attempt_id uuid;

CREATE TABLE catalog_skus (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  store_id uuid NOT NULL,
  catalog_product_id uuid NOT NULL,
  stable_key text NOT NULL,
  supplier_sku text NOT NULL DEFAULT '',
  size_label text NOT NULL DEFAULT '',
  lifecycle_status text NOT NULL DEFAULT 'active'
    CHECK (lifecycle_status IN ('active', 'retired', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, store_id, stable_key),
  UNIQUE (tenant_id, store_id, id),
  FOREIGN KEY (tenant_id, store_id)
    REFERENCES stores (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, store_id, catalog_product_id)
    REFERENCES catalog_products (tenant_id, store_id, id) ON DELETE RESTRICT
);

CREATE TABLE draft_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  store_id uuid NOT NULL,
  product_draft_id uuid NOT NULL,
  catalog_product_id uuid NOT NULL,
  revision_no integer NOT NULL CHECK (revision_no > 0),
  schema_version text NOT NULL,
  input_fingerprint text NOT NULL,
  draft_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  preflight_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, store_id, product_draft_id, revision_no),
  UNIQUE (tenant_id, store_id, id),
  FOREIGN KEY (tenant_id, store_id)
    REFERENCES stores (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, store_id, product_draft_id)
    REFERENCES product_drafts (tenant_id, store_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, store_id, catalog_product_id)
    REFERENCES catalog_products (tenant_id, store_id, id) ON DELETE RESTRICT
);

CREATE TABLE product_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  store_id uuid NOT NULL,
  catalog_product_id uuid NOT NULL,
  source_draft_revision_id uuid NOT NULL,
  version_no integer NOT NULL CHECK (version_no > 0),
  schema_version text NOT NULL,
  version_fingerprint text NOT NULL,
  template_fingerprint text NOT NULL DEFAULT '',
  preflight_fingerprint text NOT NULL DEFAULT '',
  product_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  sku_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  media_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, store_id, catalog_product_id, version_no),
  UNIQUE (tenant_id, store_id, version_fingerprint),
  UNIQUE (tenant_id, store_id, id),
  FOREIGN KEY (tenant_id, store_id)
    REFERENCES stores (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, store_id, catalog_product_id)
    REFERENCES catalog_products (tenant_id, store_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, store_id, source_draft_revision_id)
    REFERENCES draft_revisions (tenant_id, store_id, id) ON DELETE RESTRICT
);

ALTER TABLE product_drafts
  ADD CONSTRAINT product_drafts_catalog_product_fk
    FOREIGN KEY (tenant_id, store_id, catalog_product_id)
    REFERENCES catalog_products (tenant_id, store_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT product_drafts_base_version_fk
    FOREIGN KEY (tenant_id, store_id, base_version_id)
    REFERENCES product_versions (tenant_id, store_id, id) ON DELETE RESTRICT;

CREATE TABLE product_version_skus (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  store_id uuid NOT NULL,
  product_version_id uuid NOT NULL,
  catalog_sku_id uuid NOT NULL,
  sku_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  sku_fingerprint text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, store_id, product_version_id, catalog_sku_id),
  UNIQUE (tenant_id, store_id, product_version_id, sort_order),
  UNIQUE (tenant_id, store_id, id),
  FOREIGN KEY (tenant_id, store_id)
    REFERENCES stores (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, store_id, product_version_id)
    REFERENCES product_versions (tenant_id, store_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, store_id, catalog_sku_id)
    REFERENCES catalog_skus (tenant_id, store_id, id) ON DELETE RESTRICT
);

CREATE TABLE product_version_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  store_id uuid NOT NULL,
  product_version_id uuid NOT NULL,
  asset_id uuid NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,
  role text NOT NULL,
  slot text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  variant_role text NOT NULL DEFAULT '',
  content_sha256 text NOT NULL,
  content_size_bytes bigint NOT NULL CHECK (content_size_bytes >= 0),
  source_fingerprint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (
    tenant_id, store_id, product_version_id, asset_id, role, slot, sort_order
  ),
  UNIQUE (tenant_id, store_id, id),
  FOREIGN KEY (tenant_id, store_id)
    REFERENCES stores (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, store_id, product_version_id)
    REFERENCES product_versions (tenant_id, store_id, id) ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION erp06_assert_verified_version_media()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  asset_tenant_id uuid;
  asset_store_id uuid;
  asset_integrity_state text;
  asset_status text;
  asset_verified_size_bytes bigint;
  asset_verified_sha256 text;
BEGIN
  SELECT tenant_id, store_id, integrity_state, status,
         verified_size_bytes, verified_sha256
    INTO asset_tenant_id, asset_store_id, asset_integrity_state, asset_status,
         asset_verified_size_bytes, asset_verified_sha256
    FROM media_assets
   WHERE id = NEW.asset_id;

  IF NOT FOUND
     OR asset_tenant_id <> NEW.tenant_id
     OR asset_store_id IS DISTINCT FROM NEW.store_id
     OR asset_integrity_state <> 'verified'
     OR asset_status NOT IN ('ready', 'referenced')
     OR NEW.content_sha256 <> asset_verified_sha256
     OR NEW.content_size_bytes <> asset_verified_size_bytes THEN
    RAISE EXCEPTION
      'ERP06_MEDIA_NOT_VERIFIED_OR_OUT_OF_SCOPE asset_id=% tenant_id=% store_id=%',
      NEW.asset_id, NEW.tenant_id, NEW.store_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER product_version_media_verified_asset_guard
BEFORE INSERT OR UPDATE ON product_version_media
FOR EACH ROW EXECUTE FUNCTION erp06_assert_verified_version_media();

CREATE TABLE publish_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  store_id uuid NOT NULL,
  product_version_id uuid NOT NULL,
  publish_batch_id uuid,
  publish_batch_item_id uuid,
  attempt_no integer NOT NULL CHECK (attempt_no > 0),
  request_key text NOT NULL,
  reason text NOT NULL DEFAULT '',
  state text NOT NULL DEFAULT 'created'
    CHECK (state IN (
      'created',
      'preflight_passed',
      'authorized',
      'dispatched',
      'submitted',
      'readback_pending',
      'completed',
      'known_failed',
      'failed_terminal',
      'result_unknown',
      'resolved_by_official_readback',
      'superseded_by_new_attempt'
    )),
  supersedes_attempt_id uuid,
  result_unknown_at timestamptz,
  resolved_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, store_id, product_version_id, attempt_no),
  UNIQUE (tenant_id, store_id, request_key),
  UNIQUE (tenant_id, store_id, id),
  FOREIGN KEY (tenant_id, store_id)
    REFERENCES stores (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, store_id, product_version_id)
    REFERENCES product_versions (tenant_id, store_id, id) ON DELETE RESTRICT,
  CONSTRAINT publish_attempts_publish_batch_fk
    FOREIGN KEY (tenant_id, store_id, publish_batch_id)
    REFERENCES publish_batches (tenant_id, store_id, id) ON DELETE RESTRICT,
  CONSTRAINT publish_attempts_publish_batch_item_fk
    FOREIGN KEY (tenant_id, store_id, publish_batch_item_id)
    REFERENCES publish_batch_items (tenant_id, store_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, store_id, supersedes_attempt_id)
    REFERENCES publish_attempts (tenant_id, store_id, id) ON DELETE RESTRICT,
  CHECK (
    state <> 'result_unknown' OR result_unknown_at IS NOT NULL
  ),
  CHECK (
    state NOT IN ('resolved_by_official_readback', 'superseded_by_new_attempt')
    OR resolved_at IS NOT NULL
  ),
  CHECK (
    supersedes_attempt_id IS NULL OR reason <> ''
  ),
  CHECK (
    (publish_batch_id IS NULL) = (publish_batch_item_id IS NULL)
  )
);

ALTER TABLE publish_batch_items
  ADD CONSTRAINT publish_batch_items_catalog_product_fk
    FOREIGN KEY (tenant_id, store_id, catalog_product_id)
    REFERENCES catalog_products (tenant_id, store_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT publish_batch_items_product_version_fk
    FOREIGN KEY (tenant_id, store_id, product_version_id)
    REFERENCES product_versions (tenant_id, store_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT publish_batch_items_publish_attempt_fk
    FOREIGN KEY (tenant_id, store_id, publish_attempt_id)
    REFERENCES publish_attempts (tenant_id, store_id, id) ON DELETE RESTRICT;

ALTER TABLE catalog_products
  ADD CONSTRAINT catalog_products_current_version_fk
    FOREIGN KEY (tenant_id, store_id, current_version_id)
    REFERENCES product_versions (tenant_id, store_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT catalog_products_current_attempt_fk
    FOREIGN KEY (tenant_id, store_id, current_attempt_id)
    REFERENCES publish_attempts (tenant_id, store_id, id) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION erp06_block_result_unknown_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.state = 'result_unknown'
     AND NEW.state <> OLD.state
     AND NEW.state NOT IN (
       'resolved_by_official_readback', 'superseded_by_new_attempt'
     ) THEN
    RAISE EXCEPTION
      'ERP06_RESULT_UNKNOWN_RESEND_BLOCKED attempt_id=% new_state=%',
      OLD.id, NEW.state;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER publish_attempt_result_unknown_guard
BEFORE UPDATE OF state ON publish_attempts
FOR EACH ROW EXECUTE FUNCTION erp06_block_result_unknown_transition();

CREATE TABLE publish_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  store_id uuid NOT NULL,
  publish_attempt_id uuid NOT NULL,
  request_key text NOT NULL,
  command_fingerprint text NOT NULL,
  capability text NOT NULL DEFAULT '',
  state text NOT NULL DEFAULT 'queued'
    CHECK (state IN (
      'queued', 'dispatching', 'dispatched', 'succeeded', 'failed',
      'result_unknown', 'cancelled'
    )),
  payload_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  dispatched_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  worker_id text,
  worker_claim_id text,
  worker_claimed_at timestamptz,
  worker_lease_expires_at timestamptz,
  UNIQUE (tenant_id, store_id, publish_attempt_id),
  UNIQUE (tenant_id, store_id, request_key),
  UNIQUE (tenant_id, store_id, id),
  FOREIGN KEY (tenant_id, store_id)
    REFERENCES stores (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, store_id, publish_attempt_id)
    REFERENCES publish_attempts (tenant_id, store_id, id) ON DELETE RESTRICT,
  CHECK (state NOT IN ('dispatched', 'succeeded') OR dispatched_at IS NOT NULL)
);

ALTER TABLE publish_commands
  ADD CONSTRAINT publish_commands_worker_claim_pair_chk
    CHECK ((worker_claim_id IS NULL) = (worker_lease_expires_at IS NULL)),
  ADD CONSTRAINT publish_commands_worker_dispatch_claim_chk
    CHECK (state <> 'dispatching'
      OR (worker_claim_id IS NOT NULL AND worker_lease_expires_at IS NOT NULL));

CREATE OR REPLACE FUNCTION erp06_block_result_unknown_command()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  attempt_state text;
BEGIN
  SELECT state
    INTO attempt_state
    FROM publish_attempts
   WHERE tenant_id = NEW.tenant_id
     AND store_id = NEW.store_id
     AND id = NEW.publish_attempt_id;

  IF attempt_state = 'result_unknown'
     AND NEW.state IN ('queued', 'dispatching', 'dispatched', 'succeeded') THEN
    RAISE EXCEPTION
      'ERP06_RESULT_UNKNOWN_COMMAND_BLOCKED attempt_id=%',
      NEW.publish_attempt_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER publish_command_result_unknown_guard
BEFORE INSERT OR UPDATE ON publish_commands
FOR EACH ROW EXECUTE FUNCTION erp06_block_result_unknown_command();

CREATE TABLE product_publish_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  store_id uuid NOT NULL,
  publish_attempt_id uuid NOT NULL,
  receipt_type text NOT NULL CHECK (
    receipt_type IN ('submitted', 'accepted', 'readback', 'webhook', 'compliance')
  ),
  evidence_source text NOT NULL CHECK (
    evidence_source IN ('shein_api_response', 'official_readback', 'official_webhook')
  ),
  dedupe_key text NOT NULL,
  status text NOT NULL CHECK (
    status IN ('accepted', 'pending', 'failed', 'withdrawn', 'unknown')
  ),
  platform_document_sn text,
  platform_version text,
  trace_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload_sha256 text NOT NULL,
  occurred_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, store_id, publish_attempt_id, receipt_type, dedupe_key),
  UNIQUE (tenant_id, store_id, id),
  FOREIGN KEY (tenant_id, store_id)
    REFERENCES stores (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, store_id, publish_attempt_id)
    REFERENCES publish_attempts (tenant_id, store_id, id) ON DELETE RESTRICT
);

CREATE INDEX product_publish_receipts_attempt_idx
  ON product_publish_receipts (tenant_id, store_id, publish_attempt_id, occurred_at DESC);

CREATE TABLE official_event_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  store_id uuid NOT NULL,
  source text NOT NULL,
  source_event_id text NOT NULL,
  event_type text NOT NULL,
  dedupe_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload_sha256 text NOT NULL,
  verification_state text NOT NULL DEFAULT 'received'
    CHECK (verification_state IN ('received', 'accepted', 'rejected', 'processed', 'unknown')),
  error_code text,
  received_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  processed_at timestamptz,
  UNIQUE (tenant_id, store_id, source, source_event_id),
  UNIQUE (tenant_id, store_id, dedupe_key),
  UNIQUE (tenant_id, store_id, id),
  FOREIGN KEY (tenant_id, store_id)
    REFERENCES stores (tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE platform_product_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  store_id uuid NOT NULL,
  catalog_product_id uuid NOT NULL,
  catalog_sku_id uuid,
  product_version_id uuid NOT NULL,
  publish_attempt_id uuid,
  platform text NOT NULL DEFAULT 'shein',
  object_type text NOT NULL CHECK (object_type IN ('spu', 'skc', 'sku', 'document')),
  platform_id text NOT NULL,
  platform_version text NOT NULL DEFAULT '',
  link_status text NOT NULL DEFAULT 'active'
    CHECK (link_status IN ('active', 'unmatched', 'revoked', 'unknown')),
  evidence_source text NOT NULL
    CHECK (evidence_source IN ('official_readback', 'official_webhook', 'official_receipt')),
  evidence_ref text NOT NULL,
  evidence_fingerprint text NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_verified_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, store_id, platform, object_type, platform_id, platform_version),
  UNIQUE (tenant_id, store_id, id),
  FOREIGN KEY (tenant_id, store_id)
    REFERENCES stores (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, store_id, catalog_product_id)
    REFERENCES catalog_products (tenant_id, store_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, store_id, catalog_sku_id)
    REFERENCES catalog_skus (tenant_id, store_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, store_id, product_version_id)
    REFERENCES product_versions (tenant_id, store_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, store_id, publish_attempt_id)
    REFERENCES publish_attempts (tenant_id, store_id, id) ON DELETE RESTRICT,
  CHECK (evidence_ref <> '' AND evidence_fingerprint <> '')
);

CREATE TABLE product_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  store_id uuid NOT NULL,
  aggregate_type text NOT NULL CHECK (
    aggregate_type IN (
      'catalog_product', 'catalog_sku', 'draft', 'draft_revision',
      'product_version', 'product_version_media', 'publish_attempt',
      'publish_command', 'platform_product_link', 'media_asset'
    )
  ),
  aggregate_id uuid NOT NULL,
  event_type text NOT NULL,
  schema_version text NOT NULL,
  event_version integer NOT NULL CHECK (event_version > 0),
  occurred_at timestamptz NOT NULL,
  written_at timestamptz NOT NULL DEFAULT now(),
  producer text NOT NULL,
  dedupe_key text NOT NULL,
  previous_event_id uuid REFERENCES product_events(id) ON DELETE RESTRICT,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload_sha256 text NOT NULL,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (tenant_id, store_id, aggregate_type, aggregate_id, event_version),
  UNIQUE (tenant_id, store_id, dedupe_key),
  UNIQUE (tenant_id, store_id, id),
  FOREIGN KEY (tenant_id, store_id)
    REFERENCES stores (tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE product_publish_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  store_id uuid NOT NULL,
  publish_command_id uuid NOT NULL,
  event_type text NOT NULL DEFAULT 'publish_command_requested',
  dedupe_key text NOT NULL,
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'dispatching', 'dispatched', 'failed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_id text,
  lease_expires_at timestamptz,
  payload_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  queue_job_id text,
  dispatched_at timestamptz,
  last_error jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, store_id, publish_command_id),
  UNIQUE (tenant_id, store_id, dedupe_key),
  UNIQUE (tenant_id, store_id, id),
  FOREIGN KEY (tenant_id, store_id)
    REFERENCES stores (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, store_id, publish_command_id)
    REFERENCES publish_commands (tenant_id, store_id, id) ON DELETE RESTRICT,
  CHECK (
    state <> 'dispatching'
    OR (lease_id IS NOT NULL AND lease_expires_at IS NOT NULL)
  ),
  CONSTRAINT product_publish_outbox_dispatched_evidence_chk
    CHECK (state <> 'dispatched' OR (queue_job_id IS NOT NULL AND dispatched_at IS NOT NULL))
);

-- New-query indexes are scoped first, so tenant/store predicates remain part
-- of every intended access path.
CREATE INDEX catalog_products_scope_status_idx
  ON catalog_products (tenant_id, store_id, lifecycle_status, updated_at DESC);
CREATE INDEX catalog_skus_product_idx
  ON catalog_skus (tenant_id, store_id, catalog_product_id, lifecycle_status);
CREATE INDEX draft_revisions_draft_idx
  ON draft_revisions (tenant_id, store_id, product_draft_id, revision_no DESC);
CREATE INDEX product_versions_product_idx
  ON product_versions (tenant_id, store_id, catalog_product_id, version_no DESC);
CREATE INDEX publish_batch_items_version_idx
  ON publish_batch_items (tenant_id, store_id, product_version_id, updated_at DESC)
  WHERE product_version_id IS NOT NULL;
CREATE INDEX publish_batch_items_handoff_idx
  ON publish_batch_items (tenant_id, store_id, handoff_state, updated_at DESC)
  WHERE handoff_state IS NOT NULL;
CREATE INDEX product_version_media_version_idx
  ON product_version_media (tenant_id, store_id, product_version_id, sort_order);
CREATE INDEX publish_attempts_claimable_idx
  ON publish_attempts (tenant_id, store_id, state, created_at)
  WHERE state IN ('created', 'preflight_passed', 'authorized');
CREATE INDEX publish_attempts_version_idx
  ON publish_attempts (tenant_id, store_id, product_version_id, attempt_no DESC);
CREATE INDEX publish_commands_dispatch_idx
  ON publish_commands (tenant_id, store_id, state, created_at)
  WHERE state IN ('queued', 'dispatching');
CREATE INDEX publish_commands_worker_lease_idx
  ON publish_commands (tenant_id, store_id, worker_lease_expires_at, created_at)
  WHERE state = 'dispatching';
CREATE INDEX official_event_inbox_state_idx
  ON official_event_inbox (tenant_id, store_id, verification_state, received_at);
CREATE INDEX platform_product_links_product_idx
  ON platform_product_links (tenant_id, store_id, catalog_product_id, last_verified_at DESC);
CREATE INDEX product_events_aggregate_idx
  ON product_events (tenant_id, store_id, aggregate_type, aggregate_id, event_version);
CREATE INDEX product_publish_receipts_source_idx
  ON product_publish_receipts (tenant_id, store_id, evidence_source, created_at DESC);
CREATE INDEX product_publish_outbox_dispatch_idx
  ON product_publish_outbox (tenant_id, store_id, state, available_at, created_at)
  WHERE state IN ('pending', 'failed');

CREATE OR REPLACE FUNCTION erp06_reject_immutable_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'ERP06_IMMUTABLE_FACT_UPDATE_BLOCKED table=% id=%',
      TG_TABLE_NAME, OLD.id;
  END IF;
  RAISE EXCEPTION 'ERP06_IMMUTABLE_FACT_DELETE_BLOCKED table=% id=%',
    TG_TABLE_NAME, OLD.id;
END;
$$;

CREATE TRIGGER draft_revisions_immutable_guard
BEFORE UPDATE OR DELETE ON draft_revisions
FOR EACH ROW EXECUTE FUNCTION erp06_reject_immutable_mutation();

CREATE TRIGGER product_versions_immutable_guard
BEFORE UPDATE OR DELETE ON product_versions
FOR EACH ROW EXECUTE FUNCTION erp06_reject_immutable_mutation();

CREATE TRIGGER product_version_skus_immutable_guard
BEFORE UPDATE OR DELETE ON product_version_skus
FOR EACH ROW EXECUTE FUNCTION erp06_reject_immutable_mutation();

CREATE TRIGGER product_version_media_immutable_guard
BEFORE UPDATE OR DELETE ON product_version_media
FOR EACH ROW EXECUTE FUNCTION erp06_reject_immutable_mutation();

CREATE TRIGGER product_events_immutable_guard
BEFORE UPDATE OR DELETE ON product_events
FOR EACH ROW EXECUTE FUNCTION erp06_reject_immutable_mutation();

CREATE TRIGGER product_publish_receipts_immutable_guard
BEFORE UPDATE OR DELETE ON product_publish_receipts
FOR EACH ROW EXECUTE FUNCTION erp06_reject_immutable_mutation();

COMMENT ON TABLE catalog_products IS
  'ERP-06 stable local product identity; never a SHEIN platform identity.';
COMMENT ON TABLE product_versions IS
  'ERP-06 immutable handoff snapshot. New corrections create a new version.';
COMMENT ON TABLE publish_attempts IS
  'ERP-06 attempt facts and state protection; result_unknown cannot be resent.';
COMMENT ON TABLE platform_product_links IS
  'ERP-06 platform identity mapping; only official evidence may establish it.';
COMMENT ON TABLE product_publish_receipts IS
  'ERP-06 immutable platform facts scoped to a new PublishAttempt.';
COMMENT ON TABLE product_events IS
  'ERP-06 tenant/store-scoped append-only product event ledger.';
COMMENT ON TABLE product_publish_outbox IS
  'ERP-06 delivery intent. Dispatch success never means SHEIN success.';
