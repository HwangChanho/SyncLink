-- Migration 074 — sync-google-calendar cron 인증 복구 (2026-09-12).
--
-- ## 무엇이 잘못돼 있었나
--
-- 045 는 Vault 의 `service_role_jwt` 를 읽어 Bearer 로 보내게 돼 있었다. 그런데
-- 그 시크릿은 **한 번도 등록된 적이 없다**(045 주석의 "사전 등록 1회"가 실행되지
-- 않았다). 없는 이름을 조회하면 서브쿼리가 NULL 을 반환하고,
-- `'Bearer ' || NULL` 은 **NULL** 이라 Authorization 헤더가 통째로 빠진 요청이
-- 나갔다. 그래서 15분마다 `401 UNAUTHORIZED_NO_AUTH_HEADER`.
--
-- 🔴 그런데도 `cron.job_run_details` 는 계속 succeeded 였다 — net.http_post 를
--    **큐에 넣는 데** 성공했기 때문이다. SQL 성공은 HTTP 성공이 아니다.
--    (2026-09-12 실측: net._http_response 최근 6시간 25건이 전부 401)
--
-- ## 고치는 방식
--
-- dispatch-notifications · weekly-review-batch · smart-reminder ·
-- reactivation-push 와 **같은 방식으로 통일**한다 — Vault 의 랜덤 공유 시크릿을
-- Bearer 로 보내고, 함수가 `GCAL_SYNC_SECRET` 환경변수로 대조한다.
-- (service_role 키를 Vault 에 넣지 않는 것이 이 프로젝트의 방침이다.)
--
-- 고정 시크릿은 JWT 가 아니므로 `supabase/config.toml` 의
-- `[functions.sync-google-calendar] verify_jwt = false` 가 **함께 있어야** 한다.
-- 둘 중 하나만 있으면 401 이 계속된다.

-- ─────────────────────────────────────────────────────────────────────────
-- 🔴 045 의 진짜 결함은 인증 방식이 아니라 **"시크릿이 없어도 조용히 돌아간다"**
--    는 것이었다. 같은 실수가 반복되지 않도록, 시크릿이 없으면 여기서
--    마이그레이션을 **큰 소리로 실패**시킨다. 조용한 NULL 헤더보다 낫다.
-- ─────────────────────────────────────────────────────────────────────────
do $guard$
begin
  if not exists (
    select 1 from vault.decrypted_secrets where name = 'gcal_sync_secret'
  ) then
    raise exception 'vault secret "gcal_sync_secret" 가 없다 — cron 이 빈 헤더를 보내게 된다'
      using hint =
        'select vault.create_secret(encode(gen_random_bytes(32), ''hex''), ''gcal_sync_secret''); '
        '를 먼저 실행하고, 같은 값을 Edge Function 환경변수 GCAL_SYNC_SECRET 로 설정할 것';
  end if;
end
$guard$;

-- 같은 이름의 cron 이 있으면 지우고 다시 건다 (멱등).
select cron.unschedule('sync-google-calendar-15min')
where exists (select 1 from cron.job where jobname = 'sync-google-calendar-15min');

select cron.schedule(
  'sync-google-calendar-15min',
  '*/15 * * * *',                -- 매 15분
  $job$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'supabase_url')
               || '/functions/v1/sync-google-calendar',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'gcal_sync_secret')
    ),
    body    := jsonb_build_object('mode', 'cron')
  );
  $job$
);

comment on extension pg_cron is
  '044/045/074 외부 캘린더 sync 15분 cron + 30일 log 정리. 074 에서 cron 인증을 Vault 공유 시크릿으로 통일.';
