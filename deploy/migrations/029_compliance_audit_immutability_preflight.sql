WITH checks (check_name, passed) AS (
  VALUES
    (
      'table:compliance_preflight_runs',
      to_regclass('public.compliance_preflight_runs') IS NOT NULL
    ),
    (
      'table:compliance_preflight_reviews',
      to_regclass('public.compliance_preflight_reviews') IS NOT NULL
    ),
    (
      'language:plpgsql',
      EXISTS (
        SELECT 1
        FROM pg_language
        WHERE lanname = 'plpgsql'
      )
    ),
    (
      'migration:029_pending',
      NOT EXISTS (
        SELECT 1
        FROM schema_migrations
        WHERE filename = '029_compliance_audit_immutability.sql'
      )
    ),
    (
      'function:immutability_guard_absent',
      to_regprocedure('public.prevent_compliance_audit_mutation()') IS NULL
    ),
    (
      'triggers:immutability_guards_absent',
      NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname IN (
          'compliance_preflight_runs_immutable_row',
          'compliance_preflight_runs_immutable_truncate',
          'compliance_preflight_reviews_immutable_row',
          'compliance_preflight_reviews_immutable_truncate'
        )
          AND NOT tgisinternal
      )
    )
)
SELECT check_name, passed
FROM checks
ORDER BY check_name;

