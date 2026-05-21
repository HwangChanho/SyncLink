-- Migration 045 — sync-google-calendar 자동 cron 등록.
--
-- 15분마다 sync-google-calendar Edge Function 을 cron mode 로 호출.
-- vault.decrypted_secrets 의 supabase_url 사용 (이미 038 에서 등록).
-- service_role JWT 는 별도 vault secret 'service_role_jwt' 필요 (사전 등록).
--
-- 사전 등록 (1회):
--   SELECT vault.create_secret('<service-role JWT>', 'service_role_jwt');
--
-- 등록 안 됐으면 cron 호출 시 401 → google_oauth_tokens.last_sync_error 기록.

-- 이미 같은 이름 cron 있으면 삭제 후 재등록 (idempotent).
SELECT cron.unschedule('sync-google-calendar-15min')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-google-calendar-15min');

SELECT cron.schedule(
  'sync-google-calendar-15min',
  '*/15 * * * *',                -- 매 15분
  $$
  SELECT net.http_post(
    url := (
      SELECT decrypted_secret
      FROM vault.decrypted_secrets
      WHERE name = 'supabase_url'
    ) || '/functions/v1/sync-google-calendar',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name = 'service_role_jwt'
      )
    ),
    body := jsonb_build_object('mode', 'cron')
  );
  $$
);

COMMENT ON EXTENSION pg_cron IS
  '044/045 외부 캘린더 sync 15분 cron + 30일 log 정리.';
