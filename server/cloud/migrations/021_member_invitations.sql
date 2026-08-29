CREATE TABLE IF NOT EXISTS member_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email text NOT NULL,
  display_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('operator', 'viewer')),
  store_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  token_hash bytea NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  invited_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS member_invitations_one_active_email_idx
  ON member_invitations (tenant_id, lower(email))
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS member_invitations_expiry_idx
  ON member_invitations (expires_at)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

COMMENT ON TABLE member_invitations IS
  'One-time member invitations. Only SHA-256 token hashes are stored; plaintext tokens are returned once to the inviter.';
