-- 067_support_requests.sql
--
-- 앱 내 버그 제보 / 문의 양식.
--
-- 종전에는 `mailto:` 로 사용자의 메일 앱을 열었다. 그 방식의 문제:
--   - 웹에서는 브라우저가 mailto 를 막으면 아무 일도 안 일어난다(조용한 실패)
--   - 메일 앱이 없는 기기에서는 경로가 아예 없다
--   - 사용자가 실제로 보냈는지 알 수 없다
-- → 앱 안에서 받아 서버에 저장하고, 관리자 메일로 알린다.
--
-- 🔴 메일 발송은 **부가 기능**이다. Resend 무료 티어는 일일 한도가 있고 장애도 난다.
--    행이 먼저 저장되므로 메일이 실패해도 제보는 남는다(`emailed_at` 이 null 로 남을 뿐).

create table if not exists public.support_requests (
  id           uuid primary key default gen_random_uuid(),

  -- 비로그인 사용자도 제보할 수 있어야 한다(종전 mailto 도 그랬다).
  -- 그래서 nullable 이고, 계정이 지워져도 제보는 남기려 on delete set null.
  user_id      uuid references auth.users(id) on delete set null,

  kind         text not null check (kind in ('bug', 'inquiry')),
  message      text not null check (char_length(trim(message)) between 5 and 4000),

  -- 비로그인 제보자가 답장을 원할 때 남기는 주소. 로그인 사용자는 계정 메일을 쓴다.
  reply_email  text check (reply_email is null or reply_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),

  -- 앱 버전·플랫폼·플랜 등. 스키마를 고정하면 진단 항목이 늘 때마다 마이그레이션이
  -- 필요하므로 jsonb 로 둔다.
  diagnostics  jsonb not null default '{}'::jsonb,

  -- 관리자 메일을 실제로 보낸 시각. null = 미발송(재시도 대상).
  emailed_at   timestamptz,
  created_at   timestamptz not null default now()
);

-- 관리자가 "안 보낸 것부터 최신순" 으로 훑는 것이 유일한 조회 패턴이다.
create index if not exists support_requests_created_idx
  on public.support_requests (created_at desc);
create index if not exists support_requests_pending_idx
  on public.support_requests (created_at desc) where emailed_at is null;

alter table public.support_requests enable row level security;

-- 🔴 읽기 정책을 두지 않는다. 제보는 관리자만 보며, 관리자 조회는 service_role
--    (Edge Function / 관리자 도구)로만 한다. RLS 아래에서 일반 사용자는
--    자기 것조차 못 읽는다 — 읽을 이유가 없고, 정책이 하나 줄면 실수도 준다.

-- 삽입은 Edge Function(service_role)이 대신 한다. 클라이언트 직접 insert 를 막는 이유:
--   ① 진단 정보를 클라이언트가 자유롭게 위조하는 걸 막고
--   ② 레이트리밋을 서버 한 곳에서 강제하기 위해서다.
-- service_role 은 RLS 를 우회하므로 별도 정책이 필요 없다.

comment on table public.support_requests is
  '앱 내 버그 제보/문의. Edge Function submit-support 가 삽입하고 관리자 메일로 알린다.';
