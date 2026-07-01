-- 064_admin_stats_spaces.sql
--
-- admin_get_stats 확장: 공유 캘린더("스페이스") 사용 현황 집계 추가.
--   기존 054 버전에 'spaces' 키만 additive 로 덧붙인다. 다른 키/순서/로직은 불변.
--   → 구버전 프론트는 새 키를 무시하므로 하위호환 안전.
--
-- 집계 대상:
--   total / couple / group   : 스페이스 개수 및 타입 분포
--   with_members             : 멤버 1명 이상인 스페이스 (빈 스페이스 제외)
--   multi_member             : 멤버 2명 이상 (실제 "공유"가 성립하는 스페이스)
--   users_in_space           : 하나 이상 스페이스에 속한 distinct 유저 (참여율 분자)
--   avg_members              : 스페이스당 평균 멤버 수
--   shared_events            : event_shares 총 건수 (개인일정 → 스페이스 공유)
--   active_7d / active_30d   : 최근 7·30일 내 일정 공유가 있었던 스페이스 수 (활성도)
--   messages / anniversaries : 스페이스 메시지·기념일 총 사용량 (부가기능 채택도)

CREATE OR REPLACE FUNCTION public.admin_get_stats(p_token text, days integer DEFAULT 7)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    -- 모델별 비용 분해 (Haiku vs Sonnet 등). model NULL 은 'unknown'.
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
    -- 기능영역별 비용 (feature_area). NULL 은 'unknown'.
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
    -- 일별 신규 가입 (기간 내).
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
    -- last_event_at 기반 활성/휴면 버킷.
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
    -- 국가 분포 top 8 (NULL = '미상').
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
    -- 사용자 카운트 (기존 + pro/free 분해).
    select
      (select count(*) from users)                                   as total_users,
      (select count(distinct user_id) from events where start_at >= since) as active_users,
      (select count(*) from users where subscription_plan = 'pro')   as pro_users,
      (select count(*) from users
         where subscription_plan = 'free' or subscription_plan is null) as free_users
  ),
  member_counts as (
    -- ▼ 신규(064): 스페이스별 멤버 수 — 여러 집계의 공통 기반.
    select space_id, count(*) as members
    from space_members
    group by space_id
  ),
  space_stats as (
    -- ▼ 신규(064): 공유 캘린더(스페이스) 사용 현황 스냅샷.
    --   'group' 은 예약어라 큰따옴표로 quote. to_jsonb 시 키 이름은 "group" 그대로 나감.
    select
      (select count(*) from spaces)                                            as total,
      (select count(*) from spaces where type = 'couple')                     as couple,
      (select count(*) from spaces where type = 'group')                      as "group",
      (select count(*) from member_counts)                                     as with_members,
      (select count(*) from member_counts where members >= 2)                 as multi_member,
      (select count(distinct user_id) from space_members)                      as users_in_space,
      (select coalesce(round(avg(members), 2), 0) from member_counts)         as avg_members,
      (select count(*) from event_shares)                                      as shared_events,
      (select count(distinct space_id) from event_shares
         where shared_at >= now() - interval '7 days')                        as active_7d,
      (select count(distinct space_id) from event_shares
         where shared_at >= now() - interval '30 days')                       as active_30d,
      (select count(*) from space_messages)                                    as messages,
      (select count(*) from anniversaries)                                     as anniversaries
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
    'by_model',        coalesce((select jsonb_agg(to_jsonb(by_model.*)) from by_model), '[]'::jsonb),
    'by_feature',      coalesce((select jsonb_agg(to_jsonb(by_feature.*)) from by_feature), '[]'::jsonb),
    'signups_by_day',  coalesce((select jsonb_agg(to_jsonb(signups_by_day.*)) from signups_by_day), '[]'::jsonb),
    'retention',       (select to_jsonb(retention.*) from retention),
    'country_dist',    coalesce((select jsonb_agg(to_jsonb(country_dist.*)) from country_dist), '[]'::jsonb),
    -- ── 신규 키(064, additive) ──
    'spaces',          (select to_jsonb(space_stats.*) from space_stats)
  ) into result;

  return result;
end;
$function$;
