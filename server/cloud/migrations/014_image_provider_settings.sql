CREATE TABLE IF NOT EXISTS tenant_image_provider_settings (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'o1key'
    CHECK (provider IN ('o1key')),
  base_url text NOT NULL,
  key_hint text NOT NULL DEFAULT '',
  ciphertext bytea NOT NULL,
  iv bytea NOT NULL,
  auth_tag bytea NOT NULL,
  key_version integer NOT NULL DEFAULT 1,
  algorithm text NOT NULL DEFAULT 'AES-256-GCM',
  test_status text NOT NULL DEFAULT 'passed'
    CHECK (test_status IN ('passed', 'failed')),
  last_tested_at timestamptz,
  configured_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE tenant_image_provider_settings IS
  'Tenant-scoped encrypted image provider credentials. Plaintext API keys must never be returned to web clients or logs.';
