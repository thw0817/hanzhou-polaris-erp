-- ISOLATED DRAFT ONLY: structural verification for 048.
SELECT 'send_started_at' AS check_name,
       EXISTS (
         SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='publish_commands'
            AND column_name='send_started_at' AND data_type='timestamp with time zone'
       ) AS passed
UNION ALL
SELECT 'result_recorded_at',
       EXISTS (
         SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='publish_commands'
            AND column_name='result_recorded_at' AND data_type='timestamp with time zone'
       )
UNION ALL
SELECT 'send_started_timing_constraint',
       EXISTS (
         SELECT 1 FROM pg_constraint
          WHERE conname='publish_commands_send_started_timing_chk'
       )
UNION ALL
SELECT 'result_recorded_timing_constraint',
       EXISTS (
         SELECT 1 FROM pg_constraint
          WHERE conname='publish_commands_result_recorded_timing_chk'
       );
