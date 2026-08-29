ALTER TABLE image_generation_jobs
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS image_generation_jobs_tenant_idempotency_idx
  ON image_generation_jobs (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS image_generation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES image_generation_jobs(id) ON DELETE CASCADE,
  task_key text NOT NULL,
  state text NOT NULL DEFAULT 'queued' CHECK (
    state IN ('queued', 'submitting', 'polling', 'succeeded', 'failed', 'cancelled')
  ),
  workflow text NOT NULL,
  primary_asset_id uuid REFERENCES media_assets(id) ON DELETE RESTRICT,
  reference_asset_id uuid REFERENCES media_assets(id) ON DELETE RESTRICT,
  dimension_code text NOT NULL DEFAULT '',
  supplemental boolean NOT NULL DEFAULT false,
  model text NOT NULL,
  resolution text NOT NULL,
  aspect_ratio text NOT NULL,
  prompt text NOT NULL,
  upstream_task_id text,
  result_asset_id uuid REFERENCES media_assets(id) ON DELETE SET NULL,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  error jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, task_key)
);

CREATE INDEX IF NOT EXISTS image_generation_items_job_state_idx
  ON image_generation_items (job_id, state, created_at);

COMMENT ON COLUMN image_generation_items.upstream_task_id IS
  'Persist immediately after provider submission so retries poll instead of submitting a duplicate billable request.';

