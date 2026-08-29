CREATE TABLE IF NOT EXISTS publish_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name text NOT NULL,
  idempotency_key text NOT NULL,
  state text NOT NULL DEFAULT 'queued'
    CHECK (state IN (
      'queued',
      'preflighting',
      'ready',
      'paused',
      'failed',
      'completed'
    )),
  preflight jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, store_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS publish_batches_tenant_store_state_idx
  ON publish_batches (tenant_id, store_id, state, updated_at DESC);

CREATE TABLE IF NOT EXISTS publish_batch_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES publish_batches(id) ON DELETE CASCADE,
  product_draft_id uuid NOT NULL REFERENCES product_drafts(id) ON DELETE CASCADE,
  state text NOT NULL DEFAULT 'queued'
    CHECK (state IN (
      'queued',
      'preflighting',
      'ready',
      'paused',
      'failed',
      'completed'
    )),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  preflight jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, product_draft_id)
);

CREATE INDEX IF NOT EXISTS publish_batch_items_batch_state_idx
  ON publish_batch_items (batch_id, state, updated_at DESC);

COMMENT ON TABLE publish_batches IS
  'Idempotent web publishing batches. The ready state means preflight passed; production SHEIN publishing remains disabled.';

COMMENT ON TABLE publish_batch_items IS
  'Per-draft preflight state for a publish batch. No row authorizes a SHEIN write.';
