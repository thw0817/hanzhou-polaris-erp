CREATE TABLE IF NOT EXISTS web_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS web_sessions_user_active_idx
  ON web_sessions (user_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS web_sessions_tenant_active_idx
  ON web_sessions (tenant_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS membership_store_access (
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id, store_id),
  FOREIGN KEY (tenant_id, user_id)
    REFERENCES memberships(tenant_id, user_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS membership_store_access_user_idx
  ON membership_store_access (tenant_id, user_id);

COMMENT ON TABLE web_sessions IS
  'Opaque browser sessions. Only SHA-256 token hashes are persisted; the browser receives a host-only HttpOnly cookie.';

COMMENT ON TABLE membership_store_access IS
  'Optional store allowlist for operator and viewer roles. Owners and admins always inherit every store in the tenant.';
