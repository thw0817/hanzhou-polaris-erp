CREATE TABLE IF NOT EXISTS publish_execution_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  publish_batch_id uuid NOT NULL REFERENCES publish_batches(id) ON DELETE RESTRICT,
  authorization_id text NOT NULL,
  execution_plan_fingerprint text NOT NULL,
  authorization_fingerprint text NOT NULL,
  state text NOT NULL DEFAULT 'issued'
    CHECK (state IN ('issued', 'running', 'completed', 'expired', 'failed')),
  single_use boolean NOT NULL DEFAULT true CHECK (single_use),
  execution_enabled boolean NOT NULL DEFAULT false
    CONSTRAINT publish_execution_runs_execution_enabled_off
    CHECK (NOT execution_enabled),
  authorizes_publishing boolean NOT NULL DEFAULT false
    CONSTRAINT publish_execution_runs_authorizes_publishing_off
    CHECK (NOT authorizes_publishing),
  authorized_by uuid REFERENCES users(id) ON DELETE SET NULL,
  authorized_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  completed_at timestamptz,
  last_error jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, store_id, authorization_id),
  UNIQUE (tenant_id, store_id, authorization_fingerprint)
);

CREATE INDEX IF NOT EXISTS publish_execution_runs_scope_state_idx
  ON publish_execution_runs (tenant_id, store_id, state, updated_at DESC);

CREATE TABLE IF NOT EXISTS publish_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  execution_run_id uuid NOT NULL REFERENCES publish_execution_runs(id) ON DELETE RESTRICT,
  publish_batch_id uuid REFERENCES publish_batches(id) ON DELETE SET NULL,
  publish_batch_item_id uuid REFERENCES publish_batch_items(id) ON DELETE SET NULL,
  product_draft_id uuid REFERENCES product_drafts(id) ON DELETE SET NULL,
  request_key text NOT NULL,
  source_candidate_fingerprint text NOT NULL,
  remote_candidate_fingerprint text NOT NULL,
  state text NOT NULL DEFAULT 'authorized'
    CHECK (state IN (
      'authorized',
      'claimed',
      'submitted',
      'result_unknown',
      'failed_retryable',
      'failed_terminal',
      'completed'
    )),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  claim_id text,
  worker_id text,
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  submitted_at timestamptz,
  completed_at timestamptz,
  request_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  receipt jsonb NOT NULL DEFAULT '{}'::jsonb,
  readback jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error jsonb,
  shein_document_sn text,
  shein_version text,
  trace_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, store_id, request_key),
  CHECK (
    state <> 'claimed' OR (
      claim_id IS NOT NULL AND
      worker_id IS NOT NULL AND
      claimed_at IS NOT NULL AND
      claim_expires_at IS NOT NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS publish_jobs_claimable_idx
  ON publish_jobs (execution_run_id, created_at, id)
  WHERE state IN ('authorized', 'failed_retryable');

CREATE INDEX IF NOT EXISTS publish_jobs_claim_expiry_idx
  ON publish_jobs (execution_run_id, claim_expires_at, id)
  WHERE state = 'claimed' AND claim_expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS publish_jobs_scope_state_idx
  ON publish_jobs (tenant_id, store_id, state, updated_at DESC);

CREATE INDEX IF NOT EXISTS publish_jobs_platform_identity_idx
  ON publish_jobs (
    tenant_id,
    store_id,
    shein_version,
    shein_document_sn
  )
  WHERE shein_version IS NOT NULL OR shein_document_sn IS NOT NULL;

CREATE TABLE IF NOT EXISTS publish_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  publish_job_id uuid NOT NULL REFERENCES publish_jobs(id) ON DELETE RESTRICT,
  webhook_event_id uuid REFERENCES webhook_events(id) ON DELETE SET NULL,
  receipt_type text NOT NULL
    CHECK (receipt_type IN (
      'submitted',
      'received',
      'audited',
      'document_state',
      'readback',
      'compliance'
    )),
  status text NOT NULL
    CHECK (status IN (
      'accepted',
      'pending',
      'passed',
      'failed',
      'withdrawn',
      'unknown'
    )),
  dedupe_key text NOT NULL,
  platform_code text,
  trace_id text,
  document_sn text,
  version text,
  spu_name text,
  skc_name text,
  sku_code text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (publish_job_id, receipt_type, dedupe_key)
);

CREATE INDEX IF NOT EXISTS publish_receipts_job_occurred_idx
  ON publish_receipts (publish_job_id, occurred_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS publish_receipts_webhook_event_idx
  ON publish_receipts (webhook_event_id)
  WHERE webhook_event_id IS NOT NULL;

COMMENT ON TABLE publish_execution_runs IS
  'Batch-level execution authorization state. It never authorizes a SHEIN write while execution_enabled is false.';

COMMENT ON TABLE publish_jobs IS
  'One frozen SHEIN request summary per execution attempt. Raw publish request bodies are forbidden.';

COMMENT ON TABLE publish_receipts IS
  'Append-only application receipts from publish responses, SHEIN Webhook notices, document-state queries and readbacks.';
