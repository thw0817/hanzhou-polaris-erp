ALTER TABLE publish_templates
  DROP CONSTRAINT IF EXISTS publish_templates_template_type_check;

ALTER TABLE publish_templates
  ADD CONSTRAINT publish_templates_template_type_check
  CHECK (template_type IN (
    'attribute',
    'title_rule',
    'size',
    'packaging',
    'tail_image',
    'compliance'
  ));

COMMENT ON COLUMN publish_templates.template_type IS
  'Reusable publish template kind. title_rule is local composition metadata and never bypasses SHEIN title validation.';
