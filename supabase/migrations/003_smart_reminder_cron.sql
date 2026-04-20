-- Migration: 003_smart_reminder_cron
-- Registers a daily pg_cron job that calls the smart-reminder Edge Function.
--
-- Schedule: 08:00 KST = 23:00 UTC (previous day)
-- Cron expression: '0 23 * * *' (23:00 UTC every day)
--
-- Prerequisites:
--   - pg_cron extension must be enabled (Supabase → Database → Extensions)
--   - pg_net extension must be enabled (required for net.http_post)
--   - Replace <project-ref> and <service-role-key> with actual values
--     before running this migration.
--
-- To verify the job was created:
--   SELECT * FROM cron.job;
-- To remove the job:
--   SELECT cron.unschedule('smart-reminder-daily');

-- Enable required extensions if not already enabled
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Remove existing job if it exists (idempotent re-run)
select cron.unschedule('smart-reminder-daily')
where exists (
  select 1 from cron.job where jobname = 'smart-reminder-daily'
);

-- Register the daily smart reminder cron job
-- Calls the smart-reminder Edge Function every day at 08:00 KST (23:00 UTC)
select cron.schedule(
  'smart-reminder-daily',        -- job name (unique)
  '0 23 * * *',                  -- cron expression: 23:00 UTC = 08:00 KST
  $$
  select net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/smart-reminder',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body    := '{}'::jsonb
  )
  $$
);

comment on extension pg_cron is 'Job scheduler for recurring tasks (e.g. smart-reminder-daily)';
