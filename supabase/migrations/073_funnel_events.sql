-- 073_funnel_events.sql
--
-- 이탈 지점 기록(퍼널 로깅).
--
-- 왜 필요한가: 2026-08-28 실측에서 **실사용자 25명 중 20명(80%)이 가입한 날 이후로
-- 다시 오지 않는다**는 걸 알았다. 그런데 우리가 아는 건 거기까지다 — 소개 화면에서
-- 떠났는지, 로그인에서 막혔는지, 홈까지 왔다가 아무것도 안 하고 나갔는지 **모른다.**
-- UX 단순화(docs/plans/2026-08-28-ux-simplification.md)를 했지만 이 표가 없으면
-- 4주 뒤 숫자가 움직여도 무엇 때문인지 여전히 못 가른다.
--
-- 🔴 이 테이블은 **production 에서 반드시 켜져 있어야 한다.**
--    `error_logs` 는 LEAD 방침으로 production 빌드에서 INSERT 하지 않는데, 그 사실을
--    잊고 "행이 없으니 정상"이라고 두 번 오판한 적이 있다. 퍼널은 정반대다 —
--    production 사용자의 행동이 유일한 관심사이므로 dev 를 포함해 **항상** 기록한다.
--
-- 개인정보: 식별자는 user_id(로그인 후)와 기기 로컬 난수 anon_id 뿐이다.
-- 화면 이름·플랫폼·앱 버전 외에 어떤 내용도 담지 않는다.

create table if not exists public.funnel_events (
  -- append-only 로그다. 시간순으로 쌓이므로 random uuid 대신 identity 를 쓴다
  -- (uuid v4 는 인덱스가 파편화된다).
  id          bigint generated always as identity primary key,

  -- 로그인 전 단계도 기록해야 하므로 nullable. 계정을 지우면 그 사람의 흔적도 함께 지운다.
  user_id     uuid references auth.users(id) on delete cascade,

  -- 기기에 저장하는 난수 ID. **로그인 전(user_id=null) 단계와 로그인 후를 잇는 유일한 실**이다.
  -- 이게 없으면 "소개 화면에서 떠난 사람"을 셀 수 없다(그 시점엔 user_id 가 없으므로).
  anon_id     text not null check (char_length(anon_id) between 8 and 64),

  -- 퍼널 단계 이름. check 로 값을 고정하지 않는 이유: 단계는 앞으로도 계속 늘어나는데
  -- 그때마다 마이그레이션을 요구하면 기록을 안 남기게 된다. 대신 클라이언트에서
  -- TypeScript union(FunnelStep)으로 강제하고, 여기서는 길이만 막는다.
  step        text not null check (char_length(step) between 1 and 64),

  platform    text check (platform is null or char_length(platform) <= 16),
  app_version text check (app_version is null or char_length(app_version) <= 32),

  created_at  timestamptz not null default now()
);

-- 조회 패턴은 둘뿐이다.
--  ① "최근 N일의 단계별 인원" → (step, created_at)
--  ② "이 사람이 어디까지 갔나" → (anon_id, created_at)
create index if not exists funnel_events_step_created_idx
  on public.funnel_events (step, created_at desc);
create index if not exists funnel_events_anon_created_idx
  on public.funnel_events (anon_id, created_at desc);
-- FK 컬럼은 Postgres 가 자동으로 인덱스를 만들지 않는다. 계정 삭제(CASCADE)가
-- 전체 스캔을 타지 않도록 명시적으로 만든다.
create index if not exists funnel_events_user_idx
  on public.funnel_events (user_id) where user_id is not null;

alter table public.funnel_events enable row level security;

-- 삽입: 로그인 전 단계를 남겨야 하므로 anon 에게도 열어야 한다.
-- 이 테이블에는 비밀이 없고(화면 이름과 난수 ID뿐) 최악의 피해는 "집계가 오염된다" 이므로
-- Edge Function 을 한 겹 두는 비용(지연·함수 호출)보다 직접 insert 가 낫다고 판단했다.
-- 🔴 다만 **로그인한 사용자는 남의 user_id 를 사칭할 수 없어야 한다** —
--    user_id 는 null 이거나 자기 자신이어야 한다. (select auth.uid()) 로 감싸 행마다
--    재평가되지 않게 한다.
create policy funnel_events_insert on public.funnel_events
  for insert to anon, authenticated
  with check (user_id is null or user_id = (select auth.uid()));

-- 읽기 정책은 두지 않는다. 분석은 service_role / Management API 로만 한다.
-- 사용자가 자기 퍼널을 읽을 이유가 없고, 정책이 하나 줄면 실수도 준다
-- (067_support_requests 와 같은 판단).

comment on table public.funnel_events is
  '이탈 지점 기록. 어느 화면까지 왔는지만 남긴다. production 에서도 항상 기록한다.';
comment on column public.funnel_events.anon_id is
  '기기 로컬 난수. 로그인 전 단계와 로그인 후를 잇는 유일한 연결고리.';
