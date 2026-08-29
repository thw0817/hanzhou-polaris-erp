-- ISOLATED DRAFT ONLY: run only against an empty disposable rehearsal database.
SELECT
  current_database() AS database_name,
  current_database() ~* '(^|[-_])(test|rehearsal|scratch)([-_]|$)' AS disposable_name,
  NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema='public'
      AND table_name='publish_commands'
      AND column_name IN ('send_started_at', 'result_recorded_at')
  ) AS target_columns_absent;
