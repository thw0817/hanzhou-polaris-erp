ALTER TABLE webhook_events
  ADD COLUMN IF NOT EXISTS projection_version text,
  ADD COLUMN IF NOT EXISTS projection jsonb;

COMMENT ON COLUMN webhook_events.projection IS
  'Normalized internal webhook projection. Never contains multipart ciphertext, signatures, or credentials.';
