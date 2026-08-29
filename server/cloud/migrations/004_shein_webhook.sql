ALTER TABLE webhook_events
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'internal';

ALTER TABLE webhook_events
  ADD COLUMN IF NOT EXISTS raw_payload jsonb;

CREATE INDEX IF NOT EXISTS webhook_events_source_received_idx
  ON webhook_events (source, received_at DESC);

COMMENT ON COLUMN webhook_events.raw_payload IS
  'Decrypted but unnormalized SHEIN event JSON. Multipart ciphertext and signature headers are not persisted.';
