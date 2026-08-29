WITH checks (check_name, passed) AS (
  VALUES
    (
      'migration:030_recorded',
      EXISTS (
        SELECT 1
        FROM schema_migrations
        WHERE filename = '030_publish_execution_state.sql'
      )
    ),
    (
      'table:publish_execution_runs',
      to_regclass('public.publish_execution_runs') IS NOT NULL
    ),
    (
      'table:publish_jobs',
      to_regclass('public.publish_jobs') IS NOT NULL
    ),
    (
      'table:publish_receipts',
      to_regclass('public.publish_receipts') IS NOT NULL
    ),
    (
      'column:publish_jobs.claim_lease',
      (
        SELECT count(*) = 4
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'publish_jobs'
          AND column_name IN (
            'claim_id',
            'worker_id',
            'claimed_at',
            'claim_expires_at'
          )
      )
    ),
    (
      'constraint:publishing_disabled',
      EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.publish_execution_runs'::regclass
          AND conname = 'publish_execution_runs_execution_enabled_off'
          AND pg_get_constraintdef(oid) LIKE '%NOT execution_enabled%'
      ) AND
      EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.publish_execution_runs'::regclass
          AND conname = 'publish_execution_runs_authorizes_publishing_off'
          AND pg_get_constraintdef(oid) LIKE '%NOT authorizes_publishing%'
      )
    ),
    (
      'index:publish_jobs_claimable',
      to_regclass('public.publish_jobs_claimable_idx') IS NOT NULL
    ),
    (
      'index:publish_jobs_claim_expiry',
      to_regclass('public.publish_jobs_claim_expiry_idx') IS NOT NULL
    ),
    (
      'index:publish_jobs_platform_identity',
      to_regclass('public.publish_jobs_platform_identity_idx') IS NOT NULL
    )
)
SELECT check_name, passed
FROM checks
ORDER BY check_name;
