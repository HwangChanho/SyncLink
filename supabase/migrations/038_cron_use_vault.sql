-- v1.2 Phase 4 — auto-weekly-review cron 재정의 (Vault 기반)
--
-- 이전: current_setting('app.settings.supabase_url') 등 ALTER DATABASE 기반.
-- 문제: Supabase managed Postgres 는 ALTER DATABASE SET 권한 차단(42501).
-- 해결: Vault(vault.decrypted_secrets) 에서 시크릿을 읽는 방식으로 변경.
--
-- 사전 등록 필요(이미 수행됨, 1회):
--   SELECT vault.create_secret('https://<project>.supabase.co', 'supabase_url');
--   SELECT vault.create_secret('<random hex>', 'weekly_review_secret');
--
-- pg_cron job 본문에서 매 실행 시 Vault decrypt → http_post 헤더에 주입.

-- 기존 cron job 제거 (이름으로 재등록)
select cron.unschedule('auto-weekly-review')
where exists (select 1 from cron.job where jobname = 'auto-weekly-review');

-- 재등록: Vault decrypt 사용
select cron.schedule(
  'auto-weekly-review',
  '0 12 * * 0',  -- 매주 일요일 12:00 UTC = 21:00 KST
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'supabase_url')
           || '/functions/v1/weekly-review-batch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'weekly_review_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
