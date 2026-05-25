-- Migration 048 — admin_get_stats RPC 의 컬럼 이름 fix.
--
-- usage_metrics 실제 스키마: id, user_id, function_name, model,
-- input_tokens, output_tokens, cost_usd, called_at, feature_area
--
-- 잘못된 컬럼: latency_ms (존재 X) → 제거.
-- 비용 추정 대신 실제 cost_usd 합산 (더 정확).

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
