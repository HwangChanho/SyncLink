-- 053_reactivation_cron.sql
-- pg_cron: 매일 KST 18:00 (09:00 UTC) reactivation-push Edge Function 호출.
-- 비활성 사용자 (7일+) 에게 재참여 푸시 발송.

-- 기존 같은 이름 job 제거 (재배포 idempotent)
select cron.unschedule('reactivation-push-daily')
where exists (select 1 from cron.job where jobname = 'reactivation-push-daily');

select cron.schedule(
  'reactivation-push-daily',
  '0 9 * * *',  -- 매일 09:00 UTC = KST 18:00
  $$
  select net.http_post(
    url:='https://uhubhqcymxajdonmkthm.supabase.co/functions/v1/reactivation-push',
    headers:=jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body:='{}'::jsonb
  );
  $$
);

comment on extension pg_cron is
  '재참여 푸시 daily cron 추가 — reactivation-push Edge Function 매일 KST 18:00 호출.';
