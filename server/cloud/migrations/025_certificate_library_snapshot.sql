ALTER TABLE shein_rule_snapshots
  DROP CONSTRAINT IF EXISTS shein_rule_snapshots_rule_type_check;

ALTER TABLE shein_rule_snapshots
  ADD CONSTRAINT shein_rule_snapshots_rule_type_check
  CHECK (rule_type IN (
    'category_tree',
    'publish_standard',
    'attribute_template',
    'associated_rules',
    'compliance_requirement',
    'certificate_schema',
    'certificate_library'
  ));
