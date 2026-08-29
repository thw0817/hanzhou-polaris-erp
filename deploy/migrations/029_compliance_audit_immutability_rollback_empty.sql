BEGIN;

LOCK TABLE compliance_preflight_runs, compliance_preflight_reviews IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM compliance_preflight_runs) THEN
    RAISE EXCEPTION 'compliance_preflight_runs is not empty';
  END IF;

  IF EXISTS (SELECT 1 FROM compliance_preflight_reviews) THEN
    RAISE EXCEPTION 'compliance_preflight_reviews is not empty';
  END IF;
END
$$;

DROP TRIGGER compliance_preflight_runs_immutable_row
  ON compliance_preflight_runs;
DROP TRIGGER compliance_preflight_runs_immutable_truncate
  ON compliance_preflight_runs;
DROP TRIGGER compliance_preflight_reviews_immutable_row
  ON compliance_preflight_reviews;
DROP TRIGGER compliance_preflight_reviews_immutable_truncate
  ON compliance_preflight_reviews;
DROP FUNCTION prevent_compliance_audit_mutation();

DELETE FROM schema_migrations
WHERE filename = '029_compliance_audit_immutability.sql';

COMMIT;

