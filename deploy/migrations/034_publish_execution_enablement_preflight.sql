WITH checks (check_name, passed) AS (
  VALUES
    (
      'migration:034_pending',
      NOT EXISTS (
        SELECT 1
        FROM schema_migrations
        WHERE filename = '034_publish_execution_enablement.sql'
      )
    ),
    (
      'table:publish_execution_runs_present',
      to_regclass('public.publish_execution_runs') IS NOT NULL
    ),
    (
      'constraint:legacy_execution_enabled_off_present',
      EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.publish_execution_runs'::regclass
          AND conname = 'publish_execution_runs_execution_enabled_off'
      )
    ),
    (
      'constraint:legacy_authorizes_publishing_off_present',
      EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.publish_execution_runs'::regclass
          AND conname = 'publish_execution_runs_authorizes_publishing_off'
      )
    ),
    (
      'data:no_inconsistent_active_runs',
      NOT EXISTS (
        SELECT 1
        FROM publish_execution_runs
        WHERE state = 'running'
           OR execution_enabled
           OR authorizes_publishing
           OR consumed_at IS NOT NULL
      )
    )
)
SELECT check_name, passed
FROM checks
ORDER BY check_name;
