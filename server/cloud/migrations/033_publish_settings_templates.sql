ALTER TABLE publish_templates
  DROP CONSTRAINT IF EXISTS publish_templates_template_type_check;

ALTER TABLE publish_templates
  ADD CONSTRAINT publish_templates_template_type_check
  CHECK (template_type IN (
    'attribute',
    'title_rule',
    'commercial',
    'publish_settings',
    'size',
    'packaging',
    'tail_image',
    'compliance'
  ));

COMMENT ON COLUMN publish_templates.template_type IS
  'Reusable publish template kind. publish_settings stores only reusable full-managed automatic-listing choices and excludes expiring scheduled-listing dates.';
