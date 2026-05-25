-- Migration 046 — 관리자 화이트리스트 + get_admin_stats RPC.
--
-- 보안 모델:
--   1. app_admins 테이블 (user_id PK, ref auth.users) 에 등록된 사용자만
--      관리자. 일반 supabase auth (email + password) 로 로그인한 후 이
--      테이블 매칭이 추가 게이트.
--   2. SECURITY DEFINER RPC 진입 첫 줄에서 `exists (select 1 from
--      app_admins where user_id = auth.uid())` 가드. 비-관리자는 함수 자체가
--      permission denied raise.
--   3. app_admins 테이블의 RLS = service_role 외 모두 차단 (클라가 직접
--      조회 / 변경 불가). admin 추가 = SQL Editor 또는 별도 service_role
--      스크립트.
--
-- 초기 등록 = LEAD (cksgh0316@gmail.com) 1명. auth.users 에서 email 로
-- lookup. 이미 등록되어 있으면 ON CONFLICT 로 skip.
--
-- 가격 (2026 기준 Claude 모델):
--   Haiku 4.5 : input $1 / output $5 per MTok
--   Sonnet 4.6: input $3 / output $15 per MTok
--   대다수 호출 = Haiku 라 평균 input $1.5 / output $7.5 사용 (보수적).

-- ─── 1. app_admins 테이블 ────────────────────────────────────────────────
create table if not exists app_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  -- 운영용 메모 (예: "LEAD", "QA 운영", "임시 access until 2026-06-30")
  note       text,
  created_at timestamptz not null default now()
);

comment on table app_admins is
  '관리자 화이트리스트. get_admin_stats RPC + 추후 admin 전용 기능 게이트.';

alter table app_admins enable row level security;

-- 클라이언트 (anon / authenticated) 는 어떤 작업도 불가. service_role
-- 만 SQL Editor / migration / Edge Function (service key) 으로 변경.
revoke all on app_admins from anon, authenticated;

-- ─── 2. 초기 admin 등록 (LEAD) ───────────────────────────────────────────
-- auth.users 에 해당 email 이 있을 때만 insert. 없으면 (테스트 환경 등)
-- 조용히 skip.
insert into app_admins (user_id, note)
select id, 'LEAD (initial)'
from auth.users
where email = 'cksgh0316@gmail.com'
on conflict (user_id) do nothing;

-- ─── 3. get_admin_stats RPC ──────────────────────────────────────────────
create or replace function get_admin_stats(days int default 7)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
  since timestamptz;
begin
  -- 가드: 호출자가 app_admins 에 있는지.
  if not exists (
    select 1 from app_admins where user_id = auth.uid()
  ) then
    raise exception 'permission denied: admin only';
  end if;

  since := now() - make_interval(days => days);

  with by_fn as (
    select
      function_name,
      count(*)                                as calls,
      count(distinct user_id)                 as users,
      coalesce(sum(input_tokens), 0)::bigint  as in_tok,
      coalesce(sum(output_tokens), 0)::bigint as out_tok,
      coalesce(round(avg(latency_ms))::int, 0) as avg_ms,
      round(
        (coalesce(sum(input_tokens), 0) * 1.5
         + coalesce(sum(output_tokens), 0) * 7.5) / 1000000.0
      , 4) as est_usd
    from usage_metrics
    where called_at >= since
    group by function_name
    order by calls desc
  ),
  by_day as (
    select
      date_trunc('day', called_at)::date  as day,
      count(*)                            as calls,
      count(distinct user_id)             as users,
      coalesce(sum(output_tokens), 0)::bigint as out_tok
    from usage_metrics
    where called_at >= since
    group by day
    order by day desc
  ),
  by_day_fn as (
    select
      function_name,
      date_trunc('day', called_at)::date as day,
      count(*) as calls
    from usage_metrics
    where called_at >= since
    group by function_name, day
    order by day desc, calls desc
  ),
  today as (
    select
      count(*)                                as calls,
      count(distinct user_id)                 as users,
      coalesce(sum(input_tokens), 0)::bigint  as in_tok,
      coalesce(sum(output_tokens), 0)::bigint as out_tok,
      round(
        (coalesce(sum(input_tokens), 0) * 1.5
         + coalesce(sum(output_tokens), 0) * 7.5) / 1000000.0
      , 4) as est_usd
    from usage_metrics
    where called_at >= current_date
  ),
  user_counts as (
    select
      (select count(*) from users) as total_users,
      (select count(distinct user_id) from events where start_at >= since) as active_users
  )
  select jsonb_build_object(
    'days',            days,
    'since',           since,
    'today',           (select to_jsonb(today.*) from today),
    'users',           (select to_jsonb(user_counts.*) from user_counts),
    'by_function',     coalesce((select jsonb_agg(to_jsonb(by_fn.*)) from by_fn), '[]'::jsonb),
    'by_day',          coalesce((select jsonb_agg(to_jsonb(by_day.*)) from by_day), '[]'::jsonb),
    'by_day_function', coalesce((select jsonb_agg(to_jsonb(by_day_fn.*)) from by_day_fn), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

revoke all on function get_admin_stats(int) from public;
grant execute on function get_admin_stats(int) to authenticated;

comment on function get_admin_stats(int) is
  '관리자 대시보드 통계. app_admins 화이트리스트 외 호출 시 permission denied.';

-- ─── 4. (편의) 관리자 여부 조회 helper ───────────────────────────────────
-- 클라가 admin 화면 진입 전 자기 자신이 admin 인지 빠르게 확인 (가드 UX).
create or replace function is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from app_admins where user_id = auth.uid());
$$;

revoke all on function is_admin() from public;
grant execute on function is_admin() to authenticated;
