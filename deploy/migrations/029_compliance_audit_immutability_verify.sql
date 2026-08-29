WITH expected_triggers (table_name, trigger_name, trigger_type) AS (
  VALUES
    (
      'compliance_preflight_runs',
      'compliance_preflight_runs_immutable_row',
      27
    ),
    (
      'compliance_preflight_runs',
      'compliance_preflight_runs_immutable_truncate',
      34
    ),
    (
      'compliance_preflight_reviews',
      'compliance_preflight_reviews_immutable_row',
      27
    ),
    (
      'compliance_preflight_reviews',
      'compliance_preflight_reviews_immutable_truncate',
      34
    )
),
checks (check_name, passed) AS (
  VALUES
    (
      'migration:029_recorded',
      EXISTS (
        SELECT 1
        FROM schema_migrations
        WHERE filename = '029_compliance_audit_immutability.sql'
      )
    ),
    (
      'function:prevent_compliance_audit_mutation',
      EXISTS (
        SELECT 1
        FROM pg_proc AS guard_function
        JOIN pg_namespace AS namespace
          ON namespace.oid = guard_function.pronamespace
         AND namespace.nspname = 'public'
        WHERE guard_function.oid =
              to_regprocedure('public.prevent_compliance_audit_mutation()')
          AND guard_function.pronargs = 0
          AND guard_function.prorettype = 'trigger'::regtype
          AND position(
            'append-only compliance audit'
            IN pg_get_functiondef(guard_function.oid)
          ) > 0
      )
    ),
    (
      'triggers:definitions',
      (
        SELECT count(*) = 4
        FROM expected_triggers AS expected
        JOIN pg_class AS relation
          ON relation.relname = expected.table_name
        JOIN pg_namespace AS namespace
          ON namespace.oid = relation.relnamespace
         AND namespace.nspname = 'public'
        JOIN pg_trigger AS installed_trigger
          ON installed_trigger.tgrelid = relation.oid
         AND installed_trigger.tgname = expected.trigger_name
         AND installed_trigger.tgenabled = 'A'
         AND installed_trigger.tgfoid =
             to_regprocedure('public.prevent_compliance_audit_mutation()')
         AND installed_trigger.tgtype = expected.trigger_type
         AND NOT installed_trigger.tgisinternal
      )
    )
)
SELECT check_name, passed
FROM checks
ORDER BY check_name;

SELECT
  (SELECT count(*) FROM compliance_preflight_runs) AS run_count,
  (SELECT count(*) FROM compliance_preflight_reviews) AS review_count;
