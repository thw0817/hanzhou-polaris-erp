-- ISOLATED DRAFT ONLY: do not copy into server/cloud/migrations or production.
-- ERP-06 result persistence adds durable timestamps to the existing command.
-- send_started and platform results remain append-only ProductEvent/Receipt facts.

ALTER TABLE publish_commands
  ADD COLUMN send_started_at timestamptz,
  ADD COLUMN result_recorded_at timestamptz;

ALTER TABLE publish_commands
  ADD CONSTRAINT publish_commands_send_started_timing_chk
    CHECK (send_started_at IS NULL OR state IN (
      'dispatching', 'succeeded', 'failed', 'result_unknown', 'cancelled'
    )),
  ADD CONSTRAINT publish_commands_result_recorded_timing_chk
    CHECK (result_recorded_at IS NULL OR state IN (
      'succeeded', 'failed', 'result_unknown', 'cancelled'
    ));

CREATE INDEX publish_commands_result_recorded_idx
  ON publish_commands (tenant_id, store_id, result_recorded_at DESC)
  WHERE result_recorded_at IS NOT NULL;

COMMENT ON COLUMN publish_commands.send_started_at IS
  'ERP-06 durable send_started boundary timestamp; does not mean SHEIN accepted the product.';
COMMENT ON COLUMN publish_commands.result_recorded_at IS
  'ERP-06 durable adapter result timestamp; platform success still requires official evidence.';
