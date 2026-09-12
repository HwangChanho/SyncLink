-- Migration 045 — sync-google-calendar 자동 cron 등록.
--
-- 🔴 **이 마이그레이션은 074 가 대체했다 (2026-09-12). 아래 내용은 이력이다.**
--    여기 적힌 "사전 등록 (1회)" 가 **실행되지 않았고**, 그래서 Vault 에 없는
--    `service_role_jwt` 를 읽어 서브쿼리가 NULL 을 반환했다.
--    `'Bearer ' || NULL` = NULL 이라 Authorization 헤더가 **통째로 빠진 채**
--    나갔고, 15분마다 401 UNAUTHORIZED_NO_AUTH_HEADER 가 났다.
--    그런데 `cron.job_run_details` 는 계속 succeeded 였다 — net.http_post 를
--    큐에 넣는 데는 성공했기 때문이다. 이 파일이 커밋된 2026-05-21 부터
--    **약 3개월 반 동안 아무 신호가 없었다.**
--
--    🔑 교훈: "사람이 1회 해야 하는 사전 등록"을 주석으로 남기면 안 된다.
--       074 는 시크릿이 없으면 **마이그레이션 자체가 실패**하게 만들었다.
--       → supabase/migrations/074_sync_google_calendar_cron_auth.sql
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
