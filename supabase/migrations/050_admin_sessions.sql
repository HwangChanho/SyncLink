-- Migration 050 — 관리자 세션 토큰 시스템 + brute force 차단.
--
-- 변경 사항 (보안 강화):
--   1. admin_sessions 테이블 — token PK + 10시간 expire
--   2. admin_login_attempts 테이블 — brute force 감시
--   3. admin_login RPC — rate limit + 토큰 발급
--   4. admin_validate_session helper
--   5. admin_logout RPC
--   6. admin_get_stats/users — 인자 변경 (token, …) + 토큰 검증
--   7. admin_verify 함수 — anon/authenticated revoke (외부 노출 차단)
--   8. pg_cron 매일 02:00 만료/오래된 데이터 정리
--
-- 호환성 메모:
--   - 마이그레이션 전 로그인 세션 (localStorage 의 username/password) 은
--     자동 무효화 — 클라가 새 token 형식 받기 전 까지 401 흐름으로 재로그인.
--   - LEAD 한 명만 사용 중이라 사용자 영향 1회 재로그인 정도.

-- ─── 1. admin_sessions 테이블 ────────────────────────────────────────────
create table if not exists admin_sessions (
  token        text primary key,
  username     text not null references admin_credentials(username) on delete cascade,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default (now() + interval '10 hours'),
  last_used_at timestamptz not null default now(),
  revoked_at   timestamptz,
  user_agent   text
);

comment on table admin_sessions is
  '관리자 세션 토큰. expires_at 절대 시각 (10h) + 명시 logout 시 revoked_at.';

create index if not exists admin_sessions_expires_idx
  on admin_sessions (expires_at);

create index if not exists admin_sessions_username_idx
  on admin_sessions (username) where revoked_at is null;

alter table admin_sessions enable row level security;
revoke all on admin_sessions from anon, authenticated;

-- ─── 2. admin_login_attempts 테이블 ──────────────────────────────────────
create table if not exists admin_login_attempts (
  id            uuid primary key default gen_random_uuid(),
  username      text not null,
  attempted_at  timestamptz not null default now(),
  success       boolean not null,
  user_agent    text
);

comment on table admin_login_attempts is
  'admin_login 시도 로그. 같은 username 의 직전 5분 fail 5회 이상 = 차단.';

create index if not exists admin_login_attempts_username_at_idx
  on admin_login_attempts (username, attempted_at desc);

alter table admin_login_attempts enable row level security;
revoke all on admin_login_attempts from anon, authenticated;

-- ─── 3. admin_login RPC — 토큰 발급 ──────────────────────────────────────
create or replace function admin_login(
  p_username   text,
  p_password   text,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fail_count int;
  v_verified   boolean;
  v_token      text;
  v_expires    timestamptz;
begin
  -- Rate limit: 같은 username 의 직전 5분 fail 5회 이상 → 차단.
  select count(*) into v_fail_count
  from admin_login_attempts
  where username = p_username
    and success  = false
    and attempted_at >= now() - interval '5 minutes';

  if v_fail_count >= 5 then
    insert into admin_login_attempts (username, success, user_agent)
    values (p_username, false, p_user_agent);
    raise exception 'too many attempts — try again in 5 minutes';
  end if;

  -- 검증 (admin_credentials 직접 비교 — admin_verify 호출과 동일).
  select exists (
    select 1 from admin_credentials
    where username      = p_username
      and password_hash = extensions.crypt(p_password, password_hash)
  ) into v_verified;

  if not v_verified then
    insert into admin_login_attempts (username, success, user_agent)
    values (p_username, false, p_user_agent);
    raise exception 'invalid credentials';
  end if;

  -- 성공 — 시도 기록 + 토큰 발급.
  insert into admin_login_attempts (username, success, user_agent)
  values (p_username, true, p_user_agent);

  v_token   := encode(extensions.gen_random_bytes(32), 'hex');
  v_expires := now() + interval '10 hours';

  insert into admin_sessions (token, username, expires_at, user_agent)
  values (v_token, p_username, v_expires, p_user_agent);

  return jsonb_build_object(
    'token',      v_token,
    'expires_at', v_expires,
    'username',   p_username
  );
end;
$$;

revoke all on function admin_login(text, text, text) from public;
grant execute on function admin_login(text, text, text) to anon, authenticated;

comment on function admin_login(text, text, text) is
  '관리자 로그인 — rate limit (5/5min) + 10h 토큰 발급.';

-- ─── 4. admin_validate_session helper ─────────────────────────────────────
create or replace function admin_validate_session(p_token text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username text;
begin
  update admin_sessions
  set    last_used_at = now()
  where  token       = p_token
    and  revoked_at  is null
    and  expires_at  > now()
  returning username into v_username;

  return v_username;  -- NULL 이면 무효 토큰
end;
$$;

revoke all on function admin_validate_session(text) from public;
-- internal 만 사용. 외부 grant 없음.

-- ─── 5. admin_logout RPC ─────────────────────────────────────────────────
create or replace function admin_logout(p_token text)
returns void
language sql
security definer
set search_path = public
as $$
  update admin_sessions
  set    revoked_at = now()
  where  token = p_token and revoked_at is null;
$$;

revoke all on function admin_logout(text) from public;
grant execute on function admin_logout(text) to anon, authenticated;

-- ─── 6. admin_get_stats — 토큰 기반으로 재작성 ───────────────────────────
drop function if exists admin_get_stats(text, text, int);

create or replace function admin_get_stats(p_token text, days int default 7)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
  since  timestamptz;
  v_user text;
begin
  v_user := admin_validate_session(p_token);
  if v_user is null then
    raise exception 'invalid or expired session';
  end if;

  since := now() - make_interval(days => days);

  with by_fn as (
    select
      function_name,
      count(*)                                as calls,
      count(distinct user_id)                 as users,
      coalesce(sum(input_tokens), 0)::bigint  as in_tok,
      coalesce(sum(output_tokens), 0)::bigint as out_tok,
      coalesce(sum(cost_usd), 0)::numeric(10,4) as usd
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
      coalesce(sum(output_tokens), 0)::bigint as out_tok,
      coalesce(sum(cost_usd), 0)::numeric(10,4) as usd
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
      coalesce(sum(cost_usd), 0)::numeric(10,4) as usd
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

revoke all on function admin_get_stats(text, int) from public;
grant execute on function admin_get_stats(text, int) to anon, authenticated;

-- ─── 7. admin_get_users — 토큰 기반으로 재작성 ───────────────────────────
drop function if exists admin_get_users(text, text, int, text);

create or replace function admin_get_users(
  p_token text,
  p_limit int default 50,
  p_sort  text default 'recent'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
  l_limit int := least(coalesce(p_limit, 50), 200);
  v_user text;
begin
  v_user := admin_validate_session(p_token);
  if v_user is null then
    raise exception 'invalid or expired session';
  end if;

  with user_stats as (
    select
      u.id,
      u.nickname,
      au.email,
      u.subscription_plan,
      u.country_code,
      u.created_at,
      (select count(*) from events e where e.user_id = u.id)             as event_count,
      (select count(*) from usage_metrics m where m.user_id = u.id)      as ai_calls,
      (select max(start_at) from events e where e.user_id = u.id)        as last_event_at,
      (select coalesce(sum(cost_usd), 0)::numeric(10,4)
         from usage_metrics m where m.user_id = u.id)                    as total_cost_usd
    from users u
    left join auth.users au on au.id = u.id
  ),
  sorted as (
    select * from user_stats
    order by
      case when p_sort = 'recent' then created_at end desc nulls last,
      case when p_sort = 'active' then last_event_at end desc nulls last,
      case when p_sort = 'usage'  then ai_calls end desc nulls last,
      created_at desc
    limit l_limit
  )
  select jsonb_build_object(
    'sort',  p_sort,
    'limit', l_limit,
    'total', (select count(*) from users),
    'rows',  coalesce((select jsonb_agg(to_jsonb(sorted.*)) from sorted), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

revoke all on function admin_get_users(text, int, text) from public;
grant execute on function admin_get_users(text, int, text) to anon, authenticated;

-- ─── 8. 기존 admin_verify 외부 노출 차단 ─────────────────────────────────
-- 내부 helper 로만 사용 — admin_login 안에서 직접 admin_credentials 비교.
revoke execute on function admin_verify(text, text) from anon, authenticated;

-- ─── 9. pg_cron cleanup ──────────────────────────────────────────────────
-- 매일 02:00 (KST) — 만료/폐기 세션 + 30일 이전 시도 로그 정리.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- 기존 job 있으면 삭제 (idempotent)
    perform cron.unschedule(jobname)
    from cron.job where jobname = 'admin-sessions-cleanup';

    perform cron.schedule(
      'admin-sessions-cleanup',
      '0 2 * * *',
      $cron$
        delete from admin_sessions
         where expires_at < now() or (revoked_at is not null and revoked_at < now() - interval '7 days');
        delete from admin_login_attempts
         where attempted_at < now() - interval '30 days';
      $cron$
    );
  end if;
end $$;
