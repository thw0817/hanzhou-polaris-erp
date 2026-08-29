DELETE FROM media_asset_references AS reference
USING media_assets AS asset
WHERE reference.asset_id = asset.id
  AND reference.reference_type = 'generation_job'
  AND asset.purpose IN (
    'temporary_upload',
    'reusable_source',
    'generated_unselected',
    'selected_unpublished'
  );

UPDATE media_assets
SET reference_count = (
      SELECT count(*)::integer
      FROM media_asset_references AS reference
      WHERE reference.asset_id = media_assets.id
    ),
    status = CASE
      WHEN EXISTS (
        SELECT 1
        FROM media_asset_references AS reference
        WHERE reference.asset_id = media_assets.id
      ) THEN 'referenced'
      WHEN status = 'referenced' THEN 'ready'
      ELSE status
    END,
    expires_at = LEAST(
      COALESCE(expires_at, created_at + interval '3 days'),
      created_at + interval '3 days'
    ),
    updated_at = now()
WHERE purpose IN (
    'temporary_upload',
    'reusable_source',
    'generated_unselected',
    'selected_unpublished'
  )
  AND status <> 'deleted';

COMMENT ON COLUMN media_assets.expires_at IS
  'Creative-tool inputs and outputs expire after three days; compliance evidence remains protected.';

COMMENT ON COLUMN media_assets.purpose IS
  'Creative-tool purposes are temporary for three days; compliance evidence follows separate protected retention.';
