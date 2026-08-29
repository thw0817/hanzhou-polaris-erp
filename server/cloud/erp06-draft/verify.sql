-- ERP-06 foundation verification. Execute only against the disposable local
-- rehearsal database after the draft SQL has been applied.
SELECT 'catalog_products' AS check_name,
       to_regclass('public.catalog_products') IS NOT NULL AS passed
UNION ALL SELECT 'catalog_skus', to_regclass('public.catalog_skus') IS NOT NULL
UNION ALL SELECT 'draft_revisions', to_regclass('public.draft_revisions') IS NOT NULL
UNION ALL SELECT 'product_versions', to_regclass('public.product_versions') IS NOT NULL
UNION ALL SELECT 'product_version_skus', to_regclass('public.product_version_skus') IS NOT NULL
UNION ALL SELECT 'product_version_media', to_regclass('public.product_version_media') IS NOT NULL
UNION ALL SELECT 'publish_attempts', to_regclass('public.publish_attempts') IS NOT NULL
UNION ALL SELECT 'publish_commands', to_regclass('public.publish_commands') IS NOT NULL
UNION ALL SELECT 'product_publish_receipts', to_regclass('public.product_publish_receipts') IS NOT NULL
UNION ALL SELECT 'official_event_inbox', to_regclass('public.official_event_inbox') IS NOT NULL
UNION ALL SELECT 'platform_product_links', to_regclass('public.platform_product_links') IS NOT NULL
UNION ALL SELECT 'product_events', to_regclass('public.product_events') IS NOT NULL
UNION ALL SELECT 'product_publish_outbox', to_regclass('public.product_publish_outbox') IS NOT NULL;

SELECT
  'scope_and_foreign_key_constraints' AS check_name,
  EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stores_tenant_id_key'
  )
  AND EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'product_drafts_scope_id_key'
  )
  AND EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'media_assets_tenant_id_key'
  )
  AND EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'product_drafts_catalog_product_fk'
  ) AS passed;

SELECT
  'immutable_and_result_unknown_guards' AS check_name,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'product_versions_immutable_guard'
  )
  AND EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'product_events_immutable_guard'
  )
  AND EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'publish_command_result_unknown_guard'
  ) AS passed;

SELECT
  'new_model_empty_after_ddl' AS check_name,
  NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN (
        'catalog_products', 'catalog_skus', 'draft_revisions',
        'product_versions', 'product_version_skus', 'product_version_media',
        'publish_attempts', 'publish_commands', 'official_event_inbox',
        'product_publish_receipts', 'platform_product_links', 'product_events',
        'product_publish_outbox'
      )
      AND c.reltuples > 0
  ) AS passed;

SELECT
  'media_integrity_columns' AS check_name,
  count(*) = 6 AS passed
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'media_assets'
  AND column_name IN (
    'integrity_state', 'verified_at', 'verified_size_bytes',
    'verified_sha256', 'verification_source', 'legacy_disposition'
  );

SELECT
  'catalog_product_current_projection_columns' AS check_name,
  count(*) = 2 AS passed
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'catalog_products'
  AND column_name IN ('current_version_id', 'current_attempt_id');

SELECT
  'catalog_product_current_projection_foreign_keys' AS check_name,
  EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'catalog_products_current_version_fk'
  )
  AND EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'catalog_products_current_attempt_fk'
  ) AS passed;

SELECT
  'publish_batch_additive_columns' AS check_name,
  (SELECT count(*) FROM information_schema.columns
   WHERE table_schema='public' AND table_name='publish_batches'
     AND column_name IN (
       'selection_fingerprint', 'source', 'policy_snapshot',
       'confirmed_by', 'confirmed_at'
     )) = 5
  AND (SELECT count(*) FROM information_schema.columns
   WHERE table_schema='public' AND table_name='publish_batch_items'
     AND column_name IN (
       'tenant_id', 'store_id', 'catalog_product_id', 'product_version_id',
       'publish_attempt_id', 'item_key', 'handoff_state'
     )) = 7 AS passed;

SELECT
  'publish_batch_association_constraints' AS check_name,
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'publish_batches_scope_id_key')
  AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'publish_batch_items_scope_id_key')
  AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'publish_batch_items_version_key')
  AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'publish_batch_items_scope_batch_fk')
  AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'publish_batch_items_catalog_product_fk')
  AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'publish_batch_items_product_version_fk')
  AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'publish_batch_items_publish_attempt_fk') AS passed;

SELECT
  'publish_attempt_batch_association_columns' AS check_name,
  (SELECT count(*) FROM information_schema.columns
   WHERE table_schema='public' AND table_name='publish_attempts'
     AND column_name IN ('publish_batch_id', 'publish_batch_item_id')) = 2
  AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'publish_attempts_publish_batch_fk')
  AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'publish_attempts_publish_batch_item_fk') AS passed;

SELECT
  'publish_dispatch_worker_claim_columns' AS check_name,
  (SELECT count(*) FROM information_schema.columns
   WHERE table_schema='public' AND table_name='publish_commands'
     AND column_name IN (
       'worker_id', 'worker_claim_id', 'worker_claimed_at',
       'worker_lease_expires_at'
     )) = 4
  AND (SELECT count(*) FROM information_schema.columns
   WHERE table_schema='public' AND table_name='product_publish_outbox'
     AND column_name IN ('queue_job_id', 'dispatched_at', 'last_error')) = 3
  AND EXISTS (SELECT 1 FROM pg_constraint
              WHERE conname = 'publish_commands_worker_claim_pair_chk')
  AND EXISTS (SELECT 1 FROM pg_constraint
              WHERE conname = 'publish_commands_worker_dispatch_claim_chk') AS passed;

SELECT
  'publish_outbox_dispatch_evidence_constraint' AS check_name,
  EXISTS (SELECT 1 FROM pg_constraint
          WHERE conname = 'product_publish_outbox_dispatched_evidence_chk') AS passed;

SELECT
  'legacy_history_not_backfilled' AS check_name,
  (SELECT count(*) FROM product_versions) = 0
  AND (SELECT count(*) FROM publish_attempts) = 0
  AND (SELECT count(*) FROM platform_product_links) = 0 AS passed;
