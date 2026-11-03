-- Call the worker every 20 seconds. The secret key comes from Vault
-- (worker_secret_key, added by hand in the dashboard), so it's never in code
-- or in this file. Running this again updates the job, because the name stays the same.
select cron.schedule(
  'passio-worker',
  '20 seconds',
  $$
  select net.http_post(
    url := 'https://wyrfwbhjeowaclkxrwya.supabase.co/functions/v1/worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'worker_secret_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 15000
  );
  $$
);
