BEGIN;

LOCK TABLE publish_receipts, publish_jobs, publish_execution_runs
  IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM publish_receipts)
     OR EXISTS (SELECT 1 FROM publish_jobs)
     OR EXISTS (SELECT 1 FROM publish_execution_runs) THEN
    RAISE EXCEPTION
      'publish execution state contains records; rollback is not permitted';
  END IF;
END;
$$;

DROP TABLE publish_receipts;
DROP TABLE publish_jobs;
DROP TABLE publish_execution_runs;

DELETE FROM schema_migrations
WHERE filename = '030_publish_execution_state.sql';

COMMIT;
