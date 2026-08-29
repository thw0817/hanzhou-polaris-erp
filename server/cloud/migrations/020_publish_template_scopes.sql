ALTER TABLE publish_templates
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'store';

ALTER TABLE publish_templates
  DROP CONSTRAINT IF EXISTS publish_templates_scope_check;

ALTER TABLE publish_templates
  ADD CONSTRAINT publish_templates_scope_check
  CHECK (scope IN ('tenant', 'user', 'store'));

ALTER TABLE publish_templates
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES users(id) ON DELETE CASCADE;

UPDATE publish_templates AS template
SET scope = CASE
      WHEN template.template_type = 'compliance' THEN 'store'
      WHEN EXISTS (
        SELECT 1
        FROM memberships AS membership
        WHERE membership.tenant_id = template.tenant_id
          AND membership.user_id = template.created_by
          AND membership.role IN ('owner', 'admin')
      ) THEN 'tenant'
      ELSE 'user'
    END,
    owner_user_id = template.created_by
WHERE template.owner_user_id IS NULL
   OR template.scope = 'store';

DROP INDEX IF EXISTS publish_templates_store_type_name_idx;

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY tenant_id, scope,
             CASE WHEN scope = 'user' THEN owner_user_id END,
             CASE WHEN scope = 'store' THEN store_id END,
             template_type, lower(name)
           ORDER BY updated_at DESC, id
         ) AS duplicate_rank
  FROM publish_templates
)
UPDATE publish_templates AS template
SET name = left(template.name, 70) || ' (' || ranked.duplicate_rank || ')'
FROM ranked
WHERE ranked.id = template.id
  AND ranked.duplicate_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS publish_templates_tenant_type_name_idx
  ON publish_templates (tenant_id, template_type, lower(name))
  WHERE scope = 'tenant';

CREATE UNIQUE INDEX IF NOT EXISTS publish_templates_user_type_name_idx
  ON publish_templates (tenant_id, owner_user_id, template_type, lower(name))
  WHERE scope = 'user';

CREATE UNIQUE INDEX IF NOT EXISTS publish_templates_store_type_name_idx
  ON publish_templates (tenant_id, store_id, template_type, lower(name))
  WHERE scope = 'store';

CREATE INDEX IF NOT EXISTS publish_templates_visibility_idx
  ON publish_templates (tenant_id, scope, owner_user_id, store_id, updated_at DESC);

COMMENT ON COLUMN publish_templates.scope IS
  'tenant: owner/admin template shared to the tenant; user: creator template shared across that user stores; store: store-only compliance template.';
