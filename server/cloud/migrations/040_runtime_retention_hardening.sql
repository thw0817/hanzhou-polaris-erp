-- Keep long-lived rule snapshots bounded without granting the runtime role
-- direct DELETE on the snapshot table. Compliance preflight is append-only,
-- so snapshots referenced by an audit run are retained by the FK boundary.
CREATE OR REPLACE FUNCTION prune_shein_rule_snapshots(requested_limit integer DEFAULT 500)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  deleted_count integer;
  bounded_limit integer := LEAST(GREATEST(COALESCE(requested_limit, 500), 1), 5000);
BEGIN
  WITH candidates AS (
    SELECT snapshot.id
    FROM public.shein_rule_snapshots AS snapshot
    WHERE snapshot.expires_at <= now()
      AND NOT EXISTS (
        SELECT 1
        FROM public.compliance_preflight_runs AS preflight
        WHERE preflight.requirement_rule_snapshot_id = snapshot.id
           OR preflight.certificate_rule_snapshot_id = snapshot.id
      )
    ORDER BY snapshot.expires_at ASC, snapshot.updated_at ASC
    LIMIT bounded_limit
  )
  DELETE FROM public.shein_rule_snapshots AS snapshot
  USING candidates
  WHERE snapshot.id = candidates.id;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION prune_shein_rule_snapshots(integer) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shein_runtime') THEN
    GRANT EXECUTE ON FUNCTION prune_shein_rule_snapshots(integer) TO shein_runtime;
  END IF;
END
$$;

-- Stale uploads previously marked failed did not receive an expiry. Give them
-- a bounded recovery window so the media worker can eventually remove both
-- their database metadata and object-store object when unreferenced.
UPDATE media_assets
SET expires_at = COALESCE(updated_at, created_at) + interval '7 days',
    updated_at = now()
WHERE status = 'failed'
  AND purpose = 'compliance_evidence'
  AND expires_at IS NULL
  AND metadata->>'cleanupError' = 'stale_upload';

COMMENT ON FUNCTION prune_shein_rule_snapshots(integer) IS
  'Bounded cleanup of expired, unreferenced SHEIN rule snapshots for the runtime scheduler.';
