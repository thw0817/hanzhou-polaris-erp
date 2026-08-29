-- ERP-06 foundation rollback rehearsal only.
-- This is intentionally destructive and is guarded for a disposable database
-- with empty new facts. Never run this against production.
DO $$
DECLARE
  table_name text;
  row_count bigint;
BEGIN
  IF current_database() !~* '(^|[-_])(test|rehearsal|scratch)([-_]|$)' THEN
    RAISE EXCEPTION 'ERP06 rollback requires a disposable database name';
  END IF;

  FOREACH table_name IN ARRAY ARRAY[
    'product_publish_outbox', 'product_events', 'platform_product_links',
    'official_event_inbox', 'product_publish_receipts', 'publish_commands', 'publish_attempts',
    'product_version_media', 'product_version_skus', 'product_versions',
    'draft_revisions', 'catalog_skus', 'catalog_products'
  ] LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', table_name) INTO row_count;
    IF row_count <> 0 THEN
      RAISE EXCEPTION 'ERP06 rollback requires empty table %, found % rows',
        table_name, row_count;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM product_drafts
    WHERE catalog_product_id IS NOT NULL
       OR base_version_id IS NOT NULL
       OR revision_no <> 1
       OR lock_version <> 0
       OR schema_version <> 'erp06.v1'
       OR editing_status <> 'editing'
  ) THEN
    RAISE EXCEPTION 'ERP06 rollback found populated additive product_drafts fields';
  END IF;

  IF EXISTS (
    SELECT 1 FROM media_assets
    WHERE integrity_state <> 'unknown'
       OR verified_at IS NOT NULL
       OR verified_size_bytes IS NOT NULL
       OR verified_sha256 IS NOT NULL
       OR verification_source IS NOT NULL
       OR legacy_disposition <> 'none'
  ) THEN
    RAISE EXCEPTION 'ERP06 rollback found populated additive media fields';
  END IF;
END
$$;

DROP TRIGGER IF EXISTS product_events_immutable_guard ON product_events;
DROP TRIGGER IF EXISTS product_version_media_immutable_guard ON product_version_media;
DROP TRIGGER IF EXISTS product_version_skus_immutable_guard ON product_version_skus;
DROP TRIGGER IF EXISTS product_versions_immutable_guard ON product_versions;
DROP TRIGGER IF EXISTS draft_revisions_immutable_guard ON draft_revisions;
DROP TRIGGER IF EXISTS publish_command_result_unknown_guard ON publish_commands;
DROP TRIGGER IF EXISTS publish_attempt_result_unknown_guard ON publish_attempts;
DROP TRIGGER IF EXISTS product_version_media_verified_asset_guard ON product_version_media;
DROP TRIGGER IF EXISTS product_publish_receipts_immutable_guard ON product_publish_receipts;

DROP TABLE product_publish_outbox;
DROP TABLE product_events;
DROP TABLE platform_product_links;
DROP TABLE official_event_inbox;
DROP TABLE product_publish_receipts;
DROP TABLE publish_commands;
DROP TABLE publish_attempts;
DROP TABLE product_version_media;
DROP TABLE product_version_skus;
DROP TABLE product_versions;
DROP TABLE draft_revisions;
DROP TABLE catalog_skus;
DROP TABLE catalog_products;

ALTER TABLE product_drafts
  DROP CONSTRAINT product_drafts_base_version_fk,
  DROP CONSTRAINT product_drafts_catalog_product_fk,
  DROP CONSTRAINT product_drafts_editing_status_chk,
  DROP CONSTRAINT product_drafts_lock_version_chk,
  DROP CONSTRAINT product_drafts_revision_no_chk;

ALTER TABLE media_assets
  DROP CONSTRAINT media_assets_verified_fields_chk,
  DROP CONSTRAINT media_assets_legacy_disposition_chk,
  DROP CONSTRAINT media_assets_verified_size_chk,
  DROP CONSTRAINT media_assets_integrity_state_chk;

ALTER TABLE product_drafts
  DROP COLUMN catalog_product_id,
  DROP COLUMN base_version_id,
  DROP COLUMN revision_no,
  DROP COLUMN lock_version,
  DROP COLUMN schema_version,
  DROP COLUMN editing_status;

ALTER TABLE media_assets
  DROP COLUMN integrity_state,
  DROP COLUMN verified_at,
  DROP COLUMN verified_size_bytes,
  DROP COLUMN verified_sha256,
  DROP COLUMN verification_source,
  DROP COLUMN legacy_disposition;

ALTER TABLE media_assets DROP CONSTRAINT media_assets_tenant_id_key;
ALTER TABLE product_drafts DROP CONSTRAINT product_drafts_scope_id_key;
ALTER TABLE stores DROP CONSTRAINT stores_tenant_id_key;

DROP FUNCTION erp06_reject_immutable_mutation();
DROP FUNCTION erp06_block_result_unknown_command();
DROP FUNCTION erp06_block_result_unknown_transition();
DROP FUNCTION erp06_assert_verified_version_media();

DELETE FROM schema_migrations
 WHERE filename = '047_erp06_model_foundation.sql';
