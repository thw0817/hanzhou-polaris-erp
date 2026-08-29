WITH checks (check_name, passed) AS (
  VALUES
    (
      'migration:030_pending',
      NOT EXISTS (
        SELECT 1
        FROM schema_migrations
        WHERE filename = '030_publish_execution_state.sql'
      )
    ),
    (
      'table:publish_execution_runs_absent',
      to_regclass('public.publish_execution_runs') IS NULL
    ),
    (
      'table:publish_jobs_absent',
      to_regclass('public.publish_jobs') IS NULL
    ),
    (
      'table:publish_receipts_absent',
      to_regclass('public.publish_receipts') IS NULL
    )
)
SELECT check_name, passed
FROM checks
ORDER BY check_name;
