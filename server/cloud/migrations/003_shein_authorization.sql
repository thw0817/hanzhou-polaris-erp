CREATE UNIQUE INDEX IF NOT EXISTS stores_open_key_id_global_idx
  ON stores (open_key_id);

CREATE TABLE IF NOT EXISTS shein_authorization_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_hash bytea NOT NULL UNIQUE,
  installation_hash bytea NOT NULL,
  device_name text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'exchanging', 'completed', 'expired', 'failed')),
  tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
  store_id uuid REFERENCES stores(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  last_error jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shein_authorization_attempts_status_expiry_idx
  ON shein_authorization_attempts (status, expires_at);

COMMENT ON TABLE shein_authorization_attempts IS
  'Single-use SHEIN authorization states. Only SHA-256 hashes of state and installation IDs are persisted.';
