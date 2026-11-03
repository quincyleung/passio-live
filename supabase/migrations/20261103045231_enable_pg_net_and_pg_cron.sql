-- pg_net lets the database make HTTP calls. pg_cron runs them on a schedule.
-- Together they call the worker every 20 seconds (scheduled in a later migration).
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;
