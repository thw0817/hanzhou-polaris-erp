WITH active_role AS (
  SELECT
    oid,
    rolsuper,
    rolcreaterole,
    rolcreatedb,
    rolreplication,
    rolbypassrls
  FROM pg_roles
  WHERE rolname = current_user
),
database_owner AS (
  SELECT datdba
  FROM pg_database
  WHERE datname = current_database()
),
public_schema AS (
  SELECT nspowner
  FROM pg_namespace
  WHERE nspname = 'public'
),
object_ids AS (
  SELECT
    to_regclass('public.compliance_preflight_runs') AS runs_oid,
    to_regclass('public.compliance_preflight_reviews') AS reviews_oid,
    to_regclass('public.schema_migrations') AS migrations_oid
),
protected_relations AS (
  SELECT relation.oid, relation.relname, relation.relowner
  FROM pg_class AS relation
  WHERE relation.oid IN (
    SELECT runs_oid FROM object_ids
    UNION ALL
    SELECT reviews_oid FROM object_ids
  )
),
guard_function AS (
  SELECT proowner
  FROM pg_proc
  WHERE oid = to_regprocedure(
    'public.prevent_compliance_audit_mutation()'
  )
),
checks (check_name, passed) AS (
  SELECT
    'role:not_elevated',
    NOT (
      rolsuper OR
      rolcreaterole OR
      rolcreatedb OR
      rolreplication OR
      rolbypassrls
    )
  FROM active_role

  UNION ALL

  SELECT
    'database:not_owner_member',
    NOT pg_has_role(current_user, datdba, 'MEMBER')
  FROM database_owner

  UNION ALL

  SELECT
    'schema:public_not_owner_member',
    NOT pg_has_role(current_user, nspowner, 'MEMBER')
  FROM public_schema

  UNION ALL

  SELECT
    'schema:public_no_create',
    NOT has_schema_privilege(current_user, 'public', 'CREATE')

  UNION ALL

  SELECT
    'schema:public_usage',
    has_schema_privilege(current_user, 'public', 'USAGE')

  UNION ALL

  SELECT
    'objects:protected_present',
    (SELECT count(*) = 2 FROM protected_relations) AND
    (SELECT count(*) = 1 FROM guard_function)

  UNION ALL

  SELECT
    'objects:not_owner_member',
    NOT EXISTS (
      SELECT 1
      FROM protected_relations
      WHERE pg_has_role(current_user, relowner, 'MEMBER')
    ) AND
    NOT EXISTS (
      SELECT 1
      FROM guard_function
      WHERE pg_has_role(current_user, proowner, 'MEMBER')
    )

  UNION ALL

  SELECT
    'table:compliance_preflight_runs_append_only',
    has_table_privilege(
      current_user,
      (SELECT runs_oid FROM object_ids),
      'SELECT'
    ) AND
    has_table_privilege(
      current_user,
      (SELECT runs_oid FROM object_ids),
      'INSERT'
    ) AND
    NOT has_table_privilege(
      current_user,
      (SELECT runs_oid FROM object_ids),
      'UPDATE'
    ) AND
    NOT has_table_privilege(
      current_user,
      (SELECT runs_oid FROM object_ids),
      'DELETE'
    ) AND
    NOT has_table_privilege(
      current_user,
      (SELECT runs_oid FROM object_ids),
      'TRUNCATE'
    ) AND
    NOT has_table_privilege(
      current_user,
      (SELECT runs_oid FROM object_ids),
      'TRIGGER'
    )

  UNION ALL

  SELECT
    'table:compliance_preflight_reviews_append_only',
    has_table_privilege(
      current_user,
      (SELECT reviews_oid FROM object_ids),
      'SELECT'
    ) AND
    has_table_privilege(
      current_user,
      (SELECT reviews_oid FROM object_ids),
      'INSERT'
    ) AND
    NOT has_table_privilege(
      current_user,
      (SELECT reviews_oid FROM object_ids),
      'UPDATE'
    ) AND
    NOT has_table_privilege(
      current_user,
      (SELECT reviews_oid FROM object_ids),
      'DELETE'
    ) AND
    NOT has_table_privilege(
      current_user,
      (SELECT reviews_oid FROM object_ids),
      'TRUNCATE'
    ) AND
    NOT has_table_privilege(
      current_user,
      (SELECT reviews_oid FROM object_ids),
      'TRIGGER'
    )

  UNION ALL

  SELECT
    'table:schema_migrations_no_write',
    NOT has_table_privilege(
      current_user,
      (SELECT migrations_oid FROM object_ids),
      'INSERT'
    ) AND
    NOT has_table_privilege(
      current_user,
      (SELECT migrations_oid FROM object_ids),
      'UPDATE'
    ) AND
    NOT has_table_privilege(
      current_user,
      (SELECT migrations_oid FROM object_ids),
      'DELETE'
    ) AND
    NOT has_table_privilege(
      current_user,
      (SELECT migrations_oid FROM object_ids),
      'TRUNCATE'
    )
)
SELECT check_name, passed
FROM checks
ORDER BY check_name;
