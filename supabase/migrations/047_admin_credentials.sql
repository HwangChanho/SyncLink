-- Migration 047 — 별도 관리자 인증 (supabase auth 와 완전 분리).
--
-- 배경:
--   기존 app_admins 화이트리스트는 supabase auth.users 의 user_id 매칭.
--   하지만 web 의 supabase 세션이 모바일 앱과 별개라 UX 가 어색.
--   "/admin" 진입 시 자체 username/password 폼으로 바로 로그인 + 검증.
--
-- 보안 모델:
--   - admin_credentials 테이블: username PK + bcrypt password_hash
--   - RLS = anon/authenticated 모두 차단 (service_role 만 변경 가능)
--   - admin_verify / admin_get_stats RPC = SECURITY DEFINER, 함수 진입 첫
--     줄에서 pgcrypto crypt() 로 password 검증
--   - 검증 fail = 'permission denied' raise
--   - 클라는 localStorage 에 username/password 저장 + 매 RPC 호출에 전달

create extension if not exists pgcrypto with schema extensions;

-- ─── 1. admin_credentials 테이블 ─────────────────────────────────────────
create table if not exists admin_credentials (
  username      text primary key,
  password_hash text not null,
  note          text,
  created_at    timestamptz not null default now()
);

comment on table admin_credentials is
  '별도 관리자 인증. supabase auth 와 무관. bcrypt 해시 저장.';

alter table admin_credentials enable row level security;

revoke all on admin_credentials from anon, authenticated;

-- ─── 2. 초기 admin 등록 ──────────────────────────────────────────────────
-- 비밀번호는 여기에 평문으로 두지 않는다. 신규 환경에서는 임의 placeholder 로
-- 생성되며, 실제 비번은 057 의 admin_set_password(service_role) 로 회전해 주입한다.
-- (기존 운영 DB 는 이미 057 로 강한 비번 적용 완료 — 이 insert 는 재실행되지 않음)
insert into admin_credentials (username, password_hash, note)
values ('cksgh0316', extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')), 'LEAD (set via 057)')
on conflict (username) do nothing;

-- ─── 3. admin_verify RPC ────────────────────────────────────────────────
create or replace function admin_verify(p_username text, p_password text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from admin_credentials
    where username      = p_username
      and password_hash = extensions.crypt(p_password, password_hash)
  );
$$;

revoke all on function admin_verify(text, text) from public;
grant execute on function admin_verify(text, text) to anon, authenticated;

comment on function admin_verify(text, text) is
  '관리자 자격 증명 검증. crypt 비교 — timing-safe.';

-- ─── 4. admin_get_stats RPC ─────────────────────────────────────────────
-- 기존 get_admin_stats (auth.uid 기반) 와 별개. 같은 통계 결과를 반환.
create or replace function admin_get_stats(
  p_username text,
  p_password text,
  days int default 7
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
  since timestamptz;
begin
  -- 가드: username/password 검증.
  if not admin_verify(p_username, p_password) then
    raise exception 'permission denied: invalid credentials';
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

revoke all on function admin_get_stats(text, text, int) from public;
grant execute on function admin_get_stats(text, text, int) to anon, authenticated;

comment on function admin_get_stats(text, text, int) is
  '관리자 통계 — username/password 검증 후 jsonb 반환.';
