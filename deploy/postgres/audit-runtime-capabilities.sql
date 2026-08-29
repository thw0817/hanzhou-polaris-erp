-- Generated from runtime-database-capabilities.js. Review only.
WITH expected_capabilities (object_name, object_kind, expected_operations) AS (
  VALUES
    ('api_audit_logs_id_seq', 'sequence', ARRAY['USAGE']::text[]),
    ('ai_feature_grants', 'table', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']::text[]),
    ('api_audit_logs', 'table', ARRAY['SELECT', 'INSERT']::text[]),
    ('compliance_drafts', 'table', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('compliance_preflight_reviews', 'table', ARRAY['SELECT', 'INSERT']::text[]),
    ('compliance_preflight_runs', 'table', ARRAY['SELECT', 'INSERT']::text[]),
    ('compliance_templates', 'table', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('desktop_devices', 'table', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('device_enrollment_codes', 'table', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('device_sessions', 'table', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('media_asset_references', 'table', ARRAY['SELECT', 'INSERT', 'DELETE']::text[]),
    ('media_assets', 'table', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('member_invitations', 'table', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('membership_store_access', 'table', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']::text[]),
    ('memberships', 'table', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('password_reset_tokens', 'table', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('product_drafts', 'table', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('product_review_states', 'table', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('publish_batch_items', 'table', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('publish_batches', 'table', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('publish_execution_runs', 'table', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('publish_jobs', 'table', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('publish_outbox_events', 'table', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('publish_receipts', 'table', ARRAY['SELECT', 'INSERT']::text[]),
    ('publish_templates', 'table', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']::text[]),
    ('shein_authorization_attempts', 'table', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('shein_rule_snapshots', 'table', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('skc_compliance_records', 'table', ARRAY['SELECT', 'INSERT', 'DELETE']::text[]),
    ('skcs', 'table', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('spus', 'table', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('store_business_snapshots', 'table', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('store_credentials', 'table', ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']::text[]),
    ('store_sales_daily', 'table', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('stores', 'table', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('sync_job_items', 'table', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('sync_jobs', 'table', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('tenant_ai_title_settings', 'table', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('tenants', 'table', ARRAY['SELECT', 'INSERT', 'DELETE']::text[]),
    ('users', 'table', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('web_sessions', 'table', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
    ('webhook_events', 'table', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[])
),
capability_objects AS (
  SELECT
    expected.*,
    relation.oid AS object_oid,
    relation.relkind
  FROM expected_capabilities AS expected
  LEFT JOIN pg_namespace AS schema
    ON schema.nspname = 'public'
  LEFT JOIN pg_class AS relation
    ON relation.relnamespace = schema.oid
   AND relation.relname = expected.object_name
),
checks (check_name, passed) AS (
  SELECT
    'capability:' || object_kind || ':' || object_name,
    CASE
      WHEN object_kind = 'table' AND relkind IN ('r', 'p') THEN (
        SELECT bool_and(
          has_table_privilege(
            current_user,
            object_oid,
            privilege_name
          ) IS NOT DISTINCT FROM (
            privilege_name = ANY(expected_operations)
          )
        )
        FROM unnest(ARRAY[
          'SELECT',
          'INSERT',
          'UPDATE',
          'DELETE',
          'TRUNCATE',
          'REFERENCES',
          'TRIGGER'
        ]::text[]) AS privilege(privilege_name)
      )
      WHEN object_kind = 'sequence' AND relkind = 'S' THEN (
        SELECT bool_and(
          has_sequence_privilege(
            current_user,
            object_oid,
            privilege_name
          ) IS NOT DISTINCT FROM (
            privilege_name = ANY(expected_operations)
          )
        )
        FROM unnest(ARRAY[
          'USAGE',
          'SELECT',
          'UPDATE'
        ]::text[]) AS privilege(privilege_name)
      )
      ELSE false
    END
  FROM capability_objects
)
SELECT check_name, passed
FROM checks
ORDER BY check_name;
