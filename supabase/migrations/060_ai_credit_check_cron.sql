-- 060_ai_credit_check_cron.sql
-- pg_cron: 매일 KST 08:00 (23:00 UTC 전일) ai-credit-check Edge Function 호출.
-- Claude API 크레딧을 선제 점검 → 소진 시 LEAD 이메일(24h dedup).
-- 053(reactivation-push) 과 동일한 net.http_post + service_role 패턴.

select cron.unschedule('ai-credit-check-daily')
where exists (select 1 from cron.job where jobname = 'ai-credit-check-daily');

select cron.schedule(
  'ai-credit-check-daily',
  '0 23 * * *',  -- 매일 23:00 UTC = KST 08:00 (사용자 활동 전 아침에 미리 알림)
  $$
  select net.http_post(
    url:='https://uhubhqcymxajdonmkthm.supabase.co/functions/v1/ai-credit-check',
    headers:=jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body:='{}'::jsonb
  );
  $$
);
