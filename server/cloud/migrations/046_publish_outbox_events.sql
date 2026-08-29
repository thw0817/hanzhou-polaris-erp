CREATE TABLE IF NOT EXISTS publish_outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  publish_job_id uuid NOT NULL REFERENCES publish_jobs(id) ON DELETE RESTRICT,
  event_type text NOT NULL DEFAULT 'publish_command_requested'
    CHECK (event_type = 'publish_command_requested'),
  dedupe_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'dispatching', 'dispatched')),
  available_at timestamptz NOT NULL DEFAULT now(),
  dispatch_attempts integer NOT NULL DEFAULT 0 CHECK (dispatch_attempts >= 0),
  lease_id text,
  lease_expires_at timestamptz,
  queue_job_id text,
  dispatched_at timestamptz,
  last_error jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, store_id, publish_job_id, event_type),
  UNIQUE (tenant_id, store_id, dedupe_key),
  CHECK (
    state <> 'dispatching'
    OR (lease_id IS NOT NULL AND lease_expires_at IS NOT NULL)
  ),
  CHECK (state <> 'dispatched' OR dispatched_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS publish_outbox_pending_idx
  ON publish_outbox_events (available_at, created_at, id)
  WHERE state = 'pending';

CREATE INDEX IF NOT EXISTS publish_outbox_lease_expiry_idx
  ON publish_outbox_events (lease_expires_at, created_at, id)
  WHERE state = 'dispatching';

CREATE INDEX IF NOT EXISTS publish_outbox_command_idx
  ON publish_outbox_events (tenant_id, store_id, publish_job_id);

COMMENT ON TABLE publish_outbox_events IS
  'Durable publish command delivery intent. Queue delivery is retryable and never represents SHEIN success.';
