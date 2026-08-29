BEGIN;

LOCK TABLE compliance_preflight_reviews IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM compliance_preflight_reviews) THEN
    RAISE EXCEPTION 'compliance_preflight_reviews is not empty';
  END IF;
END
$$;

DROP TABLE compliance_preflight_reviews;

DELETE FROM schema_migrations
WHERE filename = '028_compliance_preflight_reviews.sql';

COMMIT;
