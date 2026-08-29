WITH checks (check_name, passed) AS (
  VALUES
    (
      'migration:034_recorded',
      EXISTS (
        SELECT 1
        FROM schema_migrations
        WHERE filename = '034_publish_execution_enablement.sql'
      )
    ),
    (
      'constraint:execution_flags_consistent',
      EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.publish_execution_runs'::regclass
          AND conname = 'publish_execution_runs_execution_flags_consistent'
          AND contype = 'c'
          AND convalidated
      )
    ),
    (
      'constraint:execution_flags_state',
      EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.publish_execution_runs'::regclass
          AND conname = 'publish_execution_runs_execution_flags_state'
          AND contype = 'c'
          AND convalidated
      )
    ),
    (
      'constraint:legacy_execution_enabled_off_absent',
      NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.publish_execution_runs'::regclass
          AND conname = 'publish_execution_runs_execution_enabled_off'
      )
    ),
    (
      'constraint:legacy_authorizes_publishing_off_absent',
      NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.publish_execution_runs'::regclass
          AND conname = 'publish_execution_runs_authorizes_publishing_off'
      )
    )
)
SELECT check_name, passed
FROM checks
ORDER BY check_name;
