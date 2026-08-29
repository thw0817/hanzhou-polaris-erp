CREATE TABLE IF NOT EXISTS device_enrollment_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code_hash bytea NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'used', 'revoked', 'expired')),
  max_uses integer NOT NULL DEFAULT 1 CHECK (max_uses > 0),
  used_count integer NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  expires_at timestamptz NOT NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS device_enrollment_codes_tenant_status_idx
  ON device_enrollment_codes (tenant_id, status, expires_at);

CREATE TABLE IF NOT EXISTS desktop_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  installation_hash bytea,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'revoked')),
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS desktop_devices_tenant_installation_idx
  ON desktop_devices (tenant_id, installation_hash)
  WHERE installation_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS desktop_devices_tenant_status_idx
  ON desktop_devices (tenant_id, status);

CREATE TABLE IF NOT EXISTS device_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES desktop_devices(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS device_sessions_device_active_idx
  ON device_sessions (device_id, expires_at)
  WHERE revoked_at IS NULL;

COMMENT ON TABLE device_enrollment_codes IS
  'One-time desktop enrollment codes. Only SHA-256 hashes are persisted.';
COMMENT ON TABLE device_sessions IS
  'Opaque desktop access tokens. Plaintext tokens are returned once and never persisted.';
