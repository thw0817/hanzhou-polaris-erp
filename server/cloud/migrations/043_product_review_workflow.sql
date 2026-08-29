ALTER TABLE product_review_states
  ADD COLUMN IF NOT EXISTS workflow_stage text;

CREATE INDEX IF NOT EXISTS product_review_states_workflow_stage_idx
  ON product_review_states (tenant_id, store_id, workflow_stage)
  WHERE archived_at IS NULL;

COMMENT ON COLUMN product_review_states.workflow_stage IS
  'Explicit SHEIN workflow stage returned by the platform; null means the platform has not supplied a stage.';
