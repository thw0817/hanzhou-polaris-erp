UPDATE publish_templates AS template
SET scope = 'tenant',
    owner_user_id = template.created_by,
    updated_at = now()
WHERE template.template_type <> 'compliance'
  AND template.scope = 'store'
  AND template.created_by IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM memberships AS membership
    WHERE membership.tenant_id = template.tenant_id
      AND membership.user_id = template.created_by
      AND membership.role IN ('owner', 'admin')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM publish_templates AS shared
    WHERE shared.id <> template.id
      AND shared.tenant_id = template.tenant_id
      AND shared.template_type = template.template_type
      AND shared.scope = 'tenant'
      AND lower(shared.name) = lower(template.name)
  );
