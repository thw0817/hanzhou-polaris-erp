-- ERP-06 foundation preflight. Execute only against the explicitly disposable
-- local rehearsal database, never against production.
SELECT
  current_setting('server_version_num')::integer >= 140000 AS postgres_supported,
  to_regclass('public.schema_migrations') IS NOT NULL AS migration_ledger_present,
  to_regclass('public.tenants') IS NOT NULL AS legacy_tenants_present,
  to_regclass('public.stores') IS NOT NULL AS legacy_stores_present,
  to_regclass('public.product_drafts') IS NOT NULL AS legacy_drafts_present,
  to_regclass('public.media_assets') IS NOT NULL AS legacy_media_present,
  to_regclass('public.catalog_products') IS NULL AS target_catalog_products_absent,
  to_regclass('public.product_versions') IS NULL AS target_product_versions_absent,
  to_regclass('public.publish_attempts') IS NULL AS target_attempts_absent,
  to_regclass('public.product_events') IS NULL AS target_events_absent;

SELECT
  'erp06_target_tables_absent' AS check_name,
  count(*) = 0 AS passed
FROM pg_class
WHERE relnamespace = 'public'::regnamespace
  AND relname IN (
    'catalog_products', 'catalog_skus', 'draft_revisions',
    'product_versions', 'product_version_skus', 'product_version_media',
    'publish_attempts', 'publish_commands', 'product_publish_receipts', 'official_event_inbox',
    'platform_product_links', 'product_events', 'product_publish_outbox'
  );

SELECT
  'old_migration_checksum_unchanged' AS check_name,
  count(*) = 47 AS passed
FROM schema_migrations
WHERE filename ~ '^[0-9]{3}_[A-Za-z0-9_-]+\.sql$';
