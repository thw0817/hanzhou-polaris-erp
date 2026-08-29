CREATE TABLE IF NOT EXISTS image_generation_usage_events (
  generation_item_id uuid PRIMARY KEY,
  generation_job_id uuid NOT NULL,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id uuid REFERENCES stores(id) ON DELETE SET NULL,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  user_email text NOT NULL,
  user_display_name text NOT NULL DEFAULT '',
  model_family text NOT NULL,
  provider_model text NOT NULL,
  unit_price_fen integer NOT NULL CHECK (unit_price_fen >= 0),
  succeeded_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS image_generation_usage_events_tenant_time_idx
  ON image_generation_usage_events (tenant_id, succeeded_at DESC);

CREATE INDEX IF NOT EXISTS image_generation_usage_events_user_time_idx
  ON image_generation_usage_events (tenant_id, user_id, succeeded_at DESC);

INSERT INTO image_generation_usage_events (
  generation_item_id,
  generation_job_id,
  tenant_id,
  store_id,
  user_id,
  user_email,
  user_display_name,
  model_family,
  provider_model,
  unit_price_fen,
  succeeded_at
)
SELECT
  item.id,
  job.id,
  job.tenant_id,
  job.store_id,
  user_row.id,
  user_row.email,
  user_row.display_name,
  CASE
    WHEN lower(item.model) LIKE '%nano-banana-pro%' THEN 'nano_banana_pro'
    WHEN lower(item.model) LIKE '%nano-banana-2%' THEN 'nano_banana_2'
    WHEN lower(item.model) LIKE '%nano-banana%' THEN 'nano_banana'
    ELSE 'other'
  END,
  item.model,
  CASE
    WHEN lower(item.model) LIKE '%nano-banana-pro%' THEN 30
    WHEN lower(item.model) LIKE '%nano-banana-2%' THEN 20
    WHEN lower(item.model) LIKE '%nano-banana%' THEN 10
    ELSE 0
  END,
  COALESCE(item.completed_at, item.updated_at, now())
FROM image_generation_items AS item
JOIN image_generation_jobs AS job ON job.id = item.job_id
JOIN users AS user_row ON user_row.id = job.requested_by
WHERE item.state = 'succeeded'
ON CONFLICT (generation_item_id) DO NOTHING;

COMMENT ON TABLE image_generation_usage_events IS
  'Immutable successful image-generation usage ledger. It survives deletion of operational generation records.';

COMMENT ON COLUMN image_generation_usage_events.unit_price_fen IS
  'Price snapshot in RMB fen at the time the image succeeds.';
