-- 079 — pg_cron 실행 기록(cron.job_run_details) 보존 기간 7일 + 매일 정리 작업
--
-- 왜:
--   pg_cron 은 작업이 돌 때마다 cron.job_run_details 에 한 행씩 남기고 스스로 지우지 않는다.
--   우리는 매분 도는 작업(space-activity-dispatch)이 있어 하루 약 1,540 행이 쌓였고,
--   2026-04-23 부터 한 번도 지우지 않아 2026-11-25 기준 약 32만 행·260MB
--   (DB 전체 286MB 의 93%, 무료 플랜 한도 500MB)가 됐다.
--   같은 날 운영 장애(로그인·DB 응답 불가) 뒤 재시작 때 pg_cron 이 시작하면서
--   이 표 전체를 훑는 update 에 3.7초가 걸린 것도 확인했다.
--
-- 무엇을:
--   1) 7일보다 오래된 실행 기록을 지운다(최근 7일은 실패 감시용으로 남긴다).
--   2) 매일 03:07 KST(18:07 UTC)에 같은 정리를 돌리는 작업을 등록한다.
--      - 매 15분(:00/:15/:30/:45) 구글 동기화·정각 작업들과 겹치지 않는 분을 골랐다.
--      - end_time 이 아니라 start_time 기준 — 시작하지 못하고 끝난 실행(job startup timeout)도
--        빠짐없이 지우기 위해서.
--
-- 되돌리기:
--   select cron.unschedule('cron-run-details-cleanup');
--   (지운 실행 기록은 되살릴 수 없다 — 진단용 기록일 뿐 앱 데이터는 아니다.)
--
-- 다시 돌려도 안전하다: 같은 이름의 작업은 지우고 다시 등록하고, 삭제는 조건에 맞는 행만 지운다.

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- 1) 오래된 실행 기록 정리 (최초 1회 — 이후로는 아래 작업이 매일 한다)
    delete from cron.job_run_details
     where start_time < now() - interval '7 days';

    -- 2) 기존 같은 이름 작업이 있으면 지운다 (idempotent)
    perform cron.unschedule(jobname)
      from cron.job where jobname = 'cron-run-details-cleanup';

    -- 3) 매일 정리 작업 등록
    perform cron.schedule(
      'cron-run-details-cleanup',
      '7 18 * * *',
      $cron$
        delete from cron.job_run_details
         where start_time < now() - interval '7 days';
      $cron$
    );
  end if;
end $$;
