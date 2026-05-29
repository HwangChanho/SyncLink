-- Migration 054 — admin_get_stats v2 (비용/성장 지표 확장).
--
-- 050 의 token 기반 admin_get_stats(p_token, days) 본문을 그대로 유지하면서
-- 운영 대시보드용 집계를 추가한다. 추가 키는 모두 ADDITIVE 이므로
-- 기존 프론트엔드(키 7개 사용)는 영향 없음 → 완전 하위호환.
--
-- 신규 집계:
--   by_model        : 모델(Haiku/Sonnet 등)별 호출/토큰/USD — usage_metrics.model
--   by_feature      : 기능영역별 호출/USD          — usage_metrics.feature_area
--   signups_by_day  : 일별 신규 가입 수             — users.created_at
--   retention       : last_event_at 기반 활성/휴면 버킷 — events
--   country_dist    : 국가 분포 top (NULL 포함)     — users.country_code
--   user_counts     : pro_users / free_users 추가   — users.subscription_plan
--
-- 데이터 소스 컬럼 (확인됨):
--   usage_metrics(user_id, function_name, model, input_tokens, output_tokens,
--                 cost_usd, called_at, feature_area)
--   users(id, nickname, subscription_plan, country_code, created_at)
--   events(user_id, start_at)

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
  -- 세션 토큰 검증 (050 과 동일). 무효 시 호출 측에서 자동 logout.
  v_user := admin_validate_session(p_token);
  if v_user is null then
    raise exception 'invalid or expired session';
  end if;

  since := now() - make_interval(days => days);

  with by_fn as (
    -- 함수별 사용량 (기존 유지).
    select
      function_name,
      count(*)                                  as calls,
      count(distinct user_id)                   as users,
      coalesce(sum(input_tokens), 0)::bigint    as in_tok,
      coalesce(sum(output_tokens), 0)::bigint   as out_tok,
      coalesce(sum(cost_usd), 0)::numeric(10,4) as usd
    from usage_metrics
    where called_at >= since
    group by function_name
    order by calls desc
  ),
  by_day as (
    -- 일별 추이 (기존 유지). usd 컬럼은 프론트 비용 차트에서 활용.
    select
      date_trunc('day', called_at)::date        as day,
      count(*)                                  as calls,
      count(distinct user_id)                   as users,
      coalesce(sum(output_tokens), 0)::bigint   as out_tok,
      coalesce(sum(cost_usd), 0)::numeric(10,4) as usd
    from usage_metrics
    where called_at >= since
    group by day
    order by day desc
  ),
  by_day_fn as (
    -- 함수×일 (기존 유지).
    select
      function_name,
      date_trunc('day', called_at)::date as day,
      count(*)                           as calls
    from usage_metrics
    where called_at >= since
    group by function_name, day
    order by day desc, calls desc
  ),
  by_model as (
    -- ▼ 신규: 모델별 비용 분해 (Haiku vs Sonnet 등). model NULL 은 'unknown'.
    select
      coalesce(model, 'unknown')                as model,
      count(*)                                  as calls,
      coalesce(sum(input_tokens), 0)::bigint    as in_tok,
      coalesce(sum(output_tokens), 0)::bigint   as out_tok,
      coalesce(sum(cost_usd), 0)::numeric(10,4) as usd
    from usage_metrics
    where called_at >= since
    group by coalesce(model, 'unknown')
    order by usd desc
  ),
  by_feature as (
    -- ▼ 신규: 기능영역별 비용 (feature_area). NULL 은 'unknown'.
    select
      coalesce(feature_area, 'unknown')         as feature_area,
      count(*)                                  as calls,
      coalesce(sum(cost_usd), 0)::numeric(10,4) as usd
    from usage_metrics
    where called_at >= since
    group by coalesce(feature_area, 'unknown')
    order by usd desc
  ),
  signups_by_day as (
    -- ▼ 신규: 일별 신규 가입 (기간 내).
    select
      date_trunc('day', created_at)::date as day,
      count(*)                            as signups
    from users
    where created_at >= since
    group by day
    order by day desc
  ),
  last_events as (
    -- 사용자별 마지막 일정 시각 (리텐션 버킷의 기준).
    select user_id, max(start_at) as last_event_at
    from events
    group by user_id
  ),
  retention as (
    -- ▼ 신규: last_event_at 기반 활성/휴면 버킷.
    --   active_7d  : 최근 7일 내 일정 활동
    --   active_30d : 7~30일 내 (7일엔 없지만 30일엔 있음)
    --   dormant    : 30일 초과 또는 활동 기록 없음 (전체 - 위 둘)
    select
      (select count(*) from last_events
         where last_event_at >= now() - interval '7 days')  as active_7d,
      (select count(*) from last_events
         where last_event_at >= now() - interval '30 days'
           and last_event_at <  now() - interval '7 days')  as active_30d,
      (select count(*) from users)
        - (select count(*) from last_events
             where last_event_at >= now() - interval '30 days') as dormant
  ),
  country_dist as (
    -- ▼ 신규: 국가 분포 top 8 (NULL = '미상').
    select
      coalesce(country_code, '미상') as country_code,
      count(*)                       as users
    from users
    group by coalesce(country_code, '미상')
    order by users desc
    limit 8
  ),
  today as (
    -- 오늘 (기존 유지).
    select
      count(*)                                  as calls,
      count(distinct user_id)                   as users,
      coalesce(sum(input_tokens), 0)::bigint    as in_tok,
      coalesce(sum(output_tokens), 0)::bigint   as out_tok,
      coalesce(sum(cost_usd), 0)::numeric(10,4) as usd
    from usage_metrics
    where called_at >= current_date
  ),
  user_counts as (
    -- 사용자 카운트 (기존 + pro/free 분해 신규).
    select
      (select count(*) from users)                                   as total_users,
      (select count(distinct user_id) from events where start_at >= since) as active_users,
      (select count(*) from users where subscription_plan = 'pro')   as pro_users,
      (select count(*) from users
         where subscription_plan = 'free' or subscription_plan is null) as free_users
  )
  select jsonb_build_object(
    -- ── 기존 키 (순서/이름 유지) ──
    'days',            days,
    'since',           since,
    'today',           (select to_jsonb(today.*) from today),
    'users',           (select to_jsonb(user_counts.*) from user_counts),
    'by_function',     coalesce((select jsonb_agg(to_jsonb(by_fn.*)) from by_fn), '[]'::jsonb),
    'by_day',          coalesce((select jsonb_agg(to_jsonb(by_day.*)) from by_day), '[]'::jsonb),
    'by_day_function', coalesce((select jsonb_agg(to_jsonb(by_day_fn.*)) from by_day_fn), '[]'::jsonb),
    -- ── 신규 키 (additive) ──
    'by_model',        coalesce((select jsonb_agg(to_jsonb(by_model.*)) from by_model), '[]'::jsonb),
    'by_feature',      coalesce((select jsonb_agg(to_jsonb(by_feature.*)) from by_feature), '[]'::jsonb),
    'signups_by_day',  coalesce((select jsonb_agg(to_jsonb(signups_by_day.*)) from signups_by_day), '[]'::jsonb),
    'retention',       (select to_jsonb(retention.*) from retention),
    'country_dist',    coalesce((select jsonb_agg(to_jsonb(country_dist.*)) from country_dist), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

-- 권한 재적용 (050 과 동일 — anon/authenticated 만 token 으로 호출).
revoke all on function admin_get_stats(text, int) from public;
grant execute on function admin_get_stats(text, int) to anon, authenticated;

comment on function admin_get_stats(text, int) is
  '관리자 통계 v2 — 기존 + by_model/by_feature/signups_by_day/retention/country_dist + pro/free 카운트. token 기반.';
