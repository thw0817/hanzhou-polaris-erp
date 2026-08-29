BEGIN;

LOCK TABLE publish_execution_runs IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM publish_execution_runs
    WHERE state IN ('running', 'completed')
       OR execution_enabled
       OR authorizes_publishing
       OR consumed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'publish execution has been consumed; enablement rollback is not permitted';
  END IF;
END;
$$;

ALTER TABLE publish_execution_runs
  DROP CONSTRAINT publish_execution_runs_execution_flags_state,
  DROP CONSTRAINT publish_execution_runs_execution_flags_consistent;

ALTER TABLE publish_execution_runs
  ADD CONSTRAINT publish_execution_runs_execution_enabled_off
    CHECK (NOT execution_enabled),
  ADD CONSTRAINT publish_execution_runs_authorizes_publishing_off
    CHECK (NOT authorizes_publishing);

DELETE FROM schema_migrations
WHERE filename = '034_publish_execution_enablement.sql';

COMMIT;
