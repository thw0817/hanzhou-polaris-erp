WITH checks (check_name, passed) AS (
  VALUES
    (
      'table:compliance_preflight_reviews',
      to_regclass('public.compliance_preflight_reviews') IS NOT NULL
    ),
    (
      'migration:028_recorded',
      EXISTS (
        SELECT 1
        FROM schema_migrations
        WHERE filename = '028_compliance_preflight_reviews.sql'
      )
    ),
    (
      'columns:review_snapshot',
      (
        SELECT count(*) = 16
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'compliance_preflight_reviews'
          AND column_name IN (
            'id',
            'tenant_id',
            'store_id',
            'skc_id',
            'skc_name',
            'preflight_run_id',
            'reviewed_by',
            'reviewer_display_name',
            'reviewed_status',
            'action_count',
            'blocker_count',
            'warning_count',
            'input_fingerprint',
            'rule_fingerprint',
            'media_fingerprint',
            'reviewed_at'
          )
      )
    ),
    (
      'index:compliance_preflight_reviews_run_user_idx',
      EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'compliance_preflight_reviews'
          AND indexname = 'compliance_preflight_reviews_run_user_idx'
      )
    ),
    (
      'index:compliance_preflight_reviews_scope_idx',
      EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'compliance_preflight_reviews'
          AND indexname = 'compliance_preflight_reviews_scope_idx'
      )
    )
)
SELECT check_name, passed
FROM checks
ORDER BY check_name;

SELECT count(*) AS review_count
FROM compliance_preflight_reviews;
