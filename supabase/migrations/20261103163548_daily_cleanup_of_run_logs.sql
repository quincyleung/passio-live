-- Step 6: a daily cleanup so the run logs don't grow forever (about 4,300 rows
-- a day each). Runs at 10:15 UTC, which is 4:15 AM in Chicago in winter
-- (5:15 AM in summer). pg_cron uses UTC.
-- - cron's own history: keep 1 day. Nothing reads it but people debugging.
-- - runs: keep 7 days. The worker and the page only read the newest rows (the
--   oldest they need is the last stop fetch, within the hour).
select cron.schedule(
  'cleanup-run-logs',
  '15 10 * * *',
  $$
    delete from cron.job_run_details where end_time < now() - interval '1 day';
    delete from public.runs where started_at < now() - interval '7 days';
  $$
);
