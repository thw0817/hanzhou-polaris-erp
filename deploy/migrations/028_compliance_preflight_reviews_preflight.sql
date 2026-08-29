WITH checks (check_name, passed) AS (
  VALUES
    ('table:tenants', to_regclass('public.tenants') IS NOT NULL),
    ('table:stores', to_regclass('public.stores') IS NOT NULL),
    ('table:skcs', to_regclass('public.skcs') IS NOT NULL),
    ('table:users', to_regclass('public.users') IS NOT NULL),
    ('table:memberships', to_regclass('public.memberships') IS NOT NULL),
    (
      'table:compliance_preflight_runs',
      to_regclass('public.compliance_preflight_runs') IS NOT NULL
    ),
    (
      'column:compliance_preflight_runs.plan',
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'compliance_preflight_runs'
          AND column_name = 'plan'
          AND data_type = 'jsonb'
      )
    ),
    (
      'column:compliance_preflight_runs.fingerprints',
      (
        SELECT count(*) = 3
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'compliance_preflight_runs'
          AND column_name IN (
            'input_fingerprint',
            'rule_fingerprint',
            'media_fingerprint'
          )
          AND is_nullable = 'NO'
      )
    ),
    (
      'migration:028_pending',
      NOT EXISTS (
        SELECT 1
        FROM schema_migrations
        WHERE filename = '028_compliance_preflight_reviews.sql'
      )
    )
)
SELECT check_name, passed
FROM checks
ORDER BY check_name;
