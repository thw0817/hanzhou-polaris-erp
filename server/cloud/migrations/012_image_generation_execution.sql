ALTER TABLE image_generation_items
  DROP CONSTRAINT IF EXISTS image_generation_items_state_check;

ALTER TABLE image_generation_items
  ADD CONSTRAINT image_generation_items_state_check CHECK (
    state IN (
      'queued',
      'submitting',
      'submission_uncertain',
      'polling',
      'succeeded',
      'failed',
      'skipped',
      'cancelled'
    )
  );

ALTER TABLE image_generation_items
  ADD COLUMN IF NOT EXISTS result_data jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE image_generation_items
  ADD COLUMN IF NOT EXISTS last_polled_at timestamptz;

CREATE INDEX IF NOT EXISTS image_generation_items_upstream_task_idx
  ON image_generation_items (upstream_task_id)
  WHERE upstream_task_id IS NOT NULL;

COMMENT ON COLUMN image_generation_items.result_data IS
  'Sanitized execution metadata only. Provider credentials and raw input image bytes are forbidden.';

