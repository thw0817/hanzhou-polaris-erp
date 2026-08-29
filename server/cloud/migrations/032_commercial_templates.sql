ALTER TABLE publish_templates
  DROP CONSTRAINT IF EXISTS publish_templates_template_type_check;

ALTER TABLE publish_templates
  ADD CONSTRAINT publish_templates_template_type_check
  CHECK (template_type IN (
    'attribute',
    'title_rule',
    'commercial',
    'size',
    'packaging',
    'tail_image',
    'compliance'
  ));

COMMENT ON COLUMN publish_templates.template_type IS
  'Reusable publish template kind. commercial stores local supply-price-per-square-meter and grams-per-square-meter defaults; it contains no retail-price field.';
