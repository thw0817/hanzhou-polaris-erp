ALTER TABLE store_business_snapshots
  ADD COLUMN IF NOT EXISTS webhook_version bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS synced_webhook_version bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_webhook_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_webhook_event_type text,
  ADD COLUMN IF NOT EXISTS last_webhook_event_id text,
  ADD COLUMN IF NOT EXISTS last_manual_refresh_at timestamptz;

CREATE INDEX IF NOT EXISTS store_business_snapshots_webhook_idx
  ON store_business_snapshots (store_id, webhook_version, synced_webhook_version);
