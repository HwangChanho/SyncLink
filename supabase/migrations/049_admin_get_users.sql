-- Migration 049 — admin_get_users RPC.
--
-- 관리자 대시보드 사용자 목록. users + auth.users + events + usage_metrics
-- 조인해서 한 행 = 한 사용자의 핵심 정보.
--
-- 가드: admin_verify (047 의 helper) 동일 사용.
-- 정렬: 'recent' (가입순) | 'active' (최근 일정 활동순) | 'usage' (AI 호출 많은 순)

create or replace function admin_get_users(
  p_username text,
  p_password text,
  p_limit int default 50,
  p_sort text default 'recent'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
  l_limit int := least(coalesce(p_limit, 50), 200);  -- 최대 200 명 cap
begin
  if not admin_verify(p_username, p_password) then
    raise exception 'permission denied: invalid credentials';
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

revoke all on function admin_get_users(text, text, int, text) from public;
grant execute on function admin_get_users(text, text, int, text) to anon, authenticated;

comment on function admin_get_users(text, text, int, text) is
  '관리자 사용자 목록 + 핵심 통계. 정렬 = recent/active/usage. 최대 200.';
