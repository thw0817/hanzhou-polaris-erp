CREATE OR REPLACE FUNCTION prevent_compliance_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'append-only compliance audit records cannot be changed';
END;
$$;

DROP TRIGGER IF EXISTS compliance_preflight_runs_immutable_row
  ON compliance_preflight_runs;

CREATE TRIGGER compliance_preflight_runs_immutable_row
BEFORE UPDATE OR DELETE ON compliance_preflight_runs
FOR EACH ROW
EXECUTE FUNCTION prevent_compliance_audit_mutation();

ALTER TABLE compliance_preflight_runs
ENABLE ALWAYS TRIGGER compliance_preflight_runs_immutable_row;

DROP TRIGGER IF EXISTS compliance_preflight_runs_immutable_truncate
  ON compliance_preflight_runs;

CREATE TRIGGER compliance_preflight_runs_immutable_truncate
BEFORE TRUNCATE ON compliance_preflight_runs
FOR EACH STATEMENT
EXECUTE FUNCTION prevent_compliance_audit_mutation();

ALTER TABLE compliance_preflight_runs
ENABLE ALWAYS TRIGGER compliance_preflight_runs_immutable_truncate;

DROP TRIGGER IF EXISTS compliance_preflight_reviews_immutable_row
  ON compliance_preflight_reviews;

CREATE TRIGGER compliance_preflight_reviews_immutable_row
BEFORE UPDATE OR DELETE ON compliance_preflight_reviews
FOR EACH ROW
EXECUTE FUNCTION prevent_compliance_audit_mutation();

ALTER TABLE compliance_preflight_reviews
ENABLE ALWAYS TRIGGER compliance_preflight_reviews_immutable_row;

DROP TRIGGER IF EXISTS compliance_preflight_reviews_immutable_truncate
  ON compliance_preflight_reviews;

CREATE TRIGGER compliance_preflight_reviews_immutable_truncate
BEFORE TRUNCATE ON compliance_preflight_reviews
FOR EACH STATEMENT
EXECUTE FUNCTION prevent_compliance_audit_mutation();

ALTER TABLE compliance_preflight_reviews
ENABLE ALWAYS TRIGGER compliance_preflight_reviews_immutable_truncate;
