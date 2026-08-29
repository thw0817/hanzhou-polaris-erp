-- ISOLATED DRAFT ONLY: execute only after the disposable rehearsal database is empty.
DO $$
BEGIN
  IF current_database() !~* '(^|[-_])(test|rehearsal|scratch)([-_]|$)' THEN
    RAISE EXCEPTION 'ERP06_048_ROLLBACK_REQUIRES_DISPOSABLE_DATABASE';
  END IF;
  IF EXISTS (
    SELECT 1 FROM publish_commands
    WHERE send_started_at IS NOT NULL OR result_recorded_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'ERP06_048_ROLLBACK_REQUIRES_EMPTY_COMMAND_TIMESTAMPS';
  END IF;
END;
$$;

DROP INDEX publish_commands_result_recorded_idx;

ALTER TABLE publish_commands
  DROP CONSTRAINT publish_commands_send_started_timing_chk,
  DROP CONSTRAINT publish_commands_result_recorded_timing_chk,
  DROP COLUMN send_started_at,
  DROP COLUMN result_recorded_at;
