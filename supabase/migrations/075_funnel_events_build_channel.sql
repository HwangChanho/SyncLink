-- 075_funnel_events_build_channel.sql
--
-- funnel_events 에 "어떤 빌드에서 찍힌 기록인가" 표식을 붙인다.
--
-- ## 왜 (2026-09-13 실측)
-- funnelService.trackFunnel 은 설계상 환경 분기가 없다("production 에서도 항상 기록한다").
-- 그래서 개발 빌드·에뮬레이터·로컬 웹·preview APK 기록이 실사용자와 **표식 없이** 섞였다.
-- 9월 iOS 에서 DB 에 처음 나타난 기기는 10대였는데 App Store 최초 다운로드는 2건뿐이었다.
-- 기록을 끄는 대신(원칙 유지) **나중에 거를 수 있게** 채널을 남긴다.
--
-- ## 값 (앱이 채운다 — src/lib/buildChannel.ts)
--   web | web_local | dev | emulator | preview | release
--   null = 1.4.15 이하 옛 번들이거나 판별 중 예외 → "모름"
-- 1.4.16 에서 release 를 app_store | testflight | play | sideload 로 세분할 예정이다.
--
-- ## 🔴 값 목록 check 를 걸지 않는다 (의도)
-- trackFunnel 은 insert 오류를 **조용히 삼킨다**. 여기서 `in (...)` 로 값을 묶어 두면,
-- 1.4.16 이 새 값(testflight 등)을 보내는 순간 그 기기의 **모든 퍼널 기록이 소리 없이 버려진다.**
-- 그래서 step 컬럼(073)과 같이 길이만 제한하고, 값 통제는 앱의 BuildChannel 타입이 맡는다.
--
-- ## 순서 주의
-- 이 컬럼을 보내는 앱 번들(OTA 포함)보다 **반드시 먼저** 적용할 것.
-- 컬럼이 없으면 PostgREST 가 insert 를 거부하고, 위와 같은 이유로 기록이 조용히 사라진다.
-- 롤백은 반대 순서다 — 번들을 되돌린 **뒤에만** 컬럼을 지운다.

-- 표가 작아 잠금은 순간이지만, 운영 insert 뒤에서 오래 기다리지 않도록 상한을 둔다.
set lock_timeout = '5s';

-- nullable + 기본값 없음 → 기존 행을 다시 쓰지 않는 메타데이터 변경이다.
-- `if not exists` 라 재실행해도 안전하다(컬럼이 있으면 인라인 check 도 함께 건너뛴다).
alter table public.funnel_events
  add column if not exists build_channel text
    check (build_channel is null or char_length(build_channel) between 1 and 32);

comment on column public.funnel_events.build_channel is
  '기록이 찍힌 빌드 채널(web|web_local|dev|emulator|preview|release). null=옛 번들·판별 실패. 값 목록 check 는 의도적으로 없다(075 주석).';
