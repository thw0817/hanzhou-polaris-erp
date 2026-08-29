BEGIN;

ALTER TABLE publish_execution_runs
  DROP CONSTRAINT publish_execution_runs_execution_enabled_off,
  DROP CONSTRAINT publish_execution_runs_authorizes_publishing_off;

ALTER TABLE publish_execution_runs
  ADD CONSTRAINT publish_execution_runs_execution_flags_consistent
    CHECK (execution_enabled = authorizes_publishing) NOT VALID,
  ADD CONSTRAINT publish_execution_runs_execution_flags_state
    CHECK (
      (NOT execution_enabled AND NOT authorizes_publishing)
      OR state = 'running'
    ) NOT VALID;

ALTER TABLE publish_execution_runs
  VALIDATE CONSTRAINT publish_execution_runs_execution_flags_consistent;

ALTER TABLE publish_execution_runs
  VALIDATE CONSTRAINT publish_execution_runs_execution_flags_state;

COMMENT ON TABLE publish_execution_runs IS
  'Single-use publish authorization. Only a consumed running run may enable and authorize SHEIN writes.';

COMMENT ON TABLE publish_jobs IS
  'One frozen SHEIN request summary per execution attempt. Raw publish request bodies remain forbidden.';

COMMIT;
