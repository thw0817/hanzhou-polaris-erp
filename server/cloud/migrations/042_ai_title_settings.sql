CREATE TABLE IF NOT EXISTS tenant_ai_title_settings (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  api_url text NOT NULL,
  model text NOT NULL DEFAULT '',
  model_url text NOT NULL DEFAULT '',
  key_hint text NOT NULL DEFAULT '',
  ciphertext bytea,
  iv bytea,
  auth_tag bytea,
  key_version integer NOT NULL DEFAULT 1,
  algorithm text NOT NULL DEFAULT 'AES-256-GCM',
  configured_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_ai_title_settings_ciphertext_check CHECK (
    (ciphertext IS NULL AND iv IS NULL AND auth_tag IS NULL)
    OR (ciphertext IS NOT NULL AND iv IS NOT NULL AND auth_tag IS NOT NULL)
  )
);

COMMENT ON TABLE tenant_ai_title_settings IS
  'Tenant-scoped encrypted Qwen-compatible vision settings. Plaintext API keys must never be returned to web clients or logs.';
