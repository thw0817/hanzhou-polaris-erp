ALTER TABLE image_generation_items
  ADD COLUMN IF NOT EXISTS quality_state text NOT NULL DEFAULT 'not_requested';

ALTER TABLE image_generation_items
  ADD COLUMN IF NOT EXISTS quality_result jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE image_generation_items
  ADD CONSTRAINT image_generation_items_quality_state_check CHECK (
    quality_state IN ('not_requested', 'pending', 'passed', 'failed')
  );

CREATE INDEX IF NOT EXISTS image_generation_items_quality_idx
  ON image_generation_items (job_id, quality_state)
  WHERE quality_state IN ('pending', 'failed');

COMMENT ON COLUMN image_generation_items.quality_result IS
  'Strict visual consistency verdict and token usage; never stores images or API credentials.';

