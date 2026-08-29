ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS authorized_by uuid REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE membership_store_access
  ADD COLUMN IF NOT EXISTS granted_by uuid REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE shein_authorization_attempts
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE shein_authorization_attempts
  ADD COLUMN IF NOT EXISTS flow_type text NOT NULL DEFAULT 'device';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'shein_authorization_attempts_flow_type_check'
  ) THEN
    ALTER TABLE shein_authorization_attempts
      ADD CONSTRAINT shein_authorization_attempts_flow_type_check
      CHECK (flow_type IN ('device', 'web'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS stores_tenant_authorized_by_idx
  ON stores (tenant_id, authorized_by, authorized_at DESC);

CREATE INDEX IF NOT EXISTS shein_authorization_attempts_web_user_idx
  ON shein_authorization_attempts (tenant_id, user_id, flow_type, status, created_at DESC);

COMMENT ON COLUMN stores.authorized_by IS
  'The most recent web user who completed authorization. Access remains governed by membership_store_access.';

COMMENT ON COLUMN membership_store_access.granted_by IS
  'User who created or most recently refreshed this store access grant.';
