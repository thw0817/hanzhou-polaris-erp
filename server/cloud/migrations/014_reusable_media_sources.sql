ALTER TABLE media_assets
  DROP CONSTRAINT IF EXISTS media_assets_purpose_check;

ALTER TABLE media_assets
  ADD CONSTRAINT media_assets_purpose_check CHECK (
    purpose IN (
      'temporary_upload',
      'reusable_source',
      'generated_unselected',
      'selected_unpublished',
      'published_archive',
      'compliance_evidence',
      'thumbnail'
    )
  );

COMMENT ON COLUMN media_assets.purpose IS
  'reusable_source is a manually managed scene/design asset and is never removed by time-based cleanup.';
