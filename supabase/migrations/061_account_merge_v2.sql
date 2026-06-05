-- Migration 061 — 토큰 기반 계정 통합 v2 (재로그인 병합 루프).
--
-- 배경: 기존 058 merge_account 는 보안 모델이 "same-email + auth.uid() 본인 소유"라
--       이메일이 서로 다른 '내 두 계정'을 통합할 수 없다. 새 UX 는 사용자가 A 로그인
--       상태에서 직접 B 에 재로그인해 두 토큰(A·B)을 서버에 넘기고, 서버(Edge
--       account-merge-bytoken)가 두 토큰을 각각 auth.getUser 로 검증해 '둘 다 본인
--       소유'임을 확인한다. 즉 보안 근간이 Edge 의 양토큰 검증으로 이동한다.
--
-- 따라서 이 v2 RPC 는:
--   1) auth.uid() 본인 체크를 제거한다 (호출자는 service_role 인 Edge, auth.uid() 없음).
--   2) same-email 체크를 제거한다 (서로 다른 이메일의 내 계정 통합이 목적).
--   3) ⇒ authenticated/anon/public 에는 grant 하지 않고 service_role 전용으로 잠근다.
--      (이 함수를 일반 사용자가 직접 부르면 임의 계정 흡수가 가능하므로 절대 금지.)
--   4) "B 로그인 → A 데이터" 가 성립하려면 B 의 로그인 수단(auth.identities)을
--      primary 로 귀속해야 한다. 데이터 이전과 동일 트랜잭션에서 처리해 원자성 보장.
--      (auth.users 행 자체의 삭제만은 트리거/FK 부작용 회피를 위해 Edge 의 admin API 가 담당.)
--
-- Pro 우선 primary 선정은 Edge 가 1차로 결정하지만, 구독 유실 방지를 위해 v2 도
-- "secondary 가 Pro 인데 primary 가 free" 면 거부하는 안전장치를 유지한다.

-- ── 1. 통합 미리보기 v2 (service_role 전용, same-email/auth.uid 체크 없음) ──────
--    확인 모달에 "B 계정: 일정 N · 할일 M · 겹침 K" 를 보여주기 위한 집계.
create or replace function merge_preview_v2(p_primary uuid, p_secondary uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conflicts          int := 0;
  v_secondary_events   int := 0;
  v_secondary_todos    int := 0;
  v_secondary_cats     int := 0;
  v_primary_email      text;
  v_secondary_email    text;
  v_primary_plan       text;
  v_secondary_plan     text;
begin
  if p_primary is null or p_secondary is null then
    raise exception 'primary and secondary required';
  end if;
  if p_primary = p_secondary then
    raise exception 'primary and secondary must differ';
  end if;

  select email, coalesce(subscription_plan, 'free')
    into v_primary_email, v_primary_plan
    from public.users where id = p_primary;
  select email, coalesce(subscription_plan, 'free')
    into v_secondary_email, v_secondary_plan
    from public.users where id = p_secondary;

  if v_primary_email is null or v_secondary_email is null then
    raise exception 'account not found';
  end if;

  -- 겹치는(=primary 에 동일 start_at+title 이 이미 있는) secondary 일정 수.
  select count(*) into v_conflicts
  from public.events se
  where se.user_id = p_secondary
    and exists (
      select 1 from public.events pe
      where pe.user_id = p_primary
        and pe.start_at = se.start_at
        and lower(btrim(pe.title)) = lower(btrim(se.title))
    );

  select count(*) into v_secondary_events from public.events     where user_id = p_secondary;
  select count(*) into v_secondary_todos  from public.todos      where user_id = p_secondary;
  select count(*) into v_secondary_cats   from public.categories where user_id = p_secondary;

  return jsonb_build_object(
    'conflicts',         v_conflicts,
    'secondary_events',  v_secondary_events,
    'secondary_todos',   v_secondary_todos,
    'secondary_cats',    v_secondary_cats,
    'primary_email',     v_primary_email,
    'secondary_email',   v_secondary_email,
    'primary_plan',      v_primary_plan,
    'secondary_plan',    v_secondary_plan
  );
end;
$$;

revoke all on function merge_preview_v2(uuid, uuid) from public, anon, authenticated;
grant execute on function merge_preview_v2(uuid, uuid) to service_role;

comment on function merge_preview_v2(uuid, uuid) is
  '[service_role 전용] 토큰 기반 통합 미리보기. Edge account-merge-bytoken 에서만 호출.';

-- ── 2. 토큰 기반 병합 v2 (service_role 전용) ──────────────────────────────────
create or replace function merge_account_v2(
  p_primary         uuid,
  p_secondary       uuid,
  p_conflict_policy text default 'keep_both'
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_primary_email   text;
  v_secondary_email text;
  v_primary_plan    text;
  v_secondary_plan  text;
  v_both_pro        boolean := false;
  v_moved_events    int := 0;
  v_deduped         int := 0;
  v_moved_idents    int := 0;
begin
  -- 입력 검증 (auth.uid()/same-email 체크는 의도적으로 없음 — 상단 주석 참조).
  if p_primary is null or p_secondary is null then
    raise exception 'primary and secondary required';
  end if;
  if p_primary = p_secondary then
    raise exception 'primary and secondary must differ';
  end if;
  if p_conflict_policy not in ('keep_both', 'dedupe') then
    raise exception 'invalid conflict policy: %', p_conflict_policy;
  end if;

  select email, coalesce(subscription_plan, 'free')
    into v_primary_email, v_primary_plan
    from public.users where id = p_primary;
  select email, coalesce(subscription_plan, 'free')
    into v_secondary_email, v_secondary_plan
    from public.users where id = p_secondary;

  if v_primary_email is null or v_secondary_email is null then
    raise exception 'account not found';
  end if;
  -- 구독 유실 방지: secondary 가 Pro 인데 primary 가 free 면 거부.
  -- (Edge 가 Pro 우선으로 primary 를 고르므로 정상 흐름에선 도달 안 함 — 이중 안전장치.)
  if v_secondary_plan = 'pro' and v_primary_plan <> 'pro' then
    raise exception 'secondary is Pro but primary is not — choose Pro account as primary';
  end if;
  if v_secondary_plan = 'pro' and v_primary_plan = 'pro' then
    v_both_pro := true;
  end if;

  -- ── 충돌 정책: dedupe 면 secondary 의 겹치는 일정을 먼저 삭제 ──
  if p_conflict_policy = 'dedupe' then
    delete from public.events se
    where se.user_id = p_secondary
      and exists (
        select 1 from public.events pe
        where pe.user_id = p_primary
          and pe.start_at = se.start_at
          and lower(btrim(pe.title)) = lower(btrim(se.title))
      );
    get diagnostics v_deduped = row_count;
  end if;

  -- ── space_members UNIQUE(space_id,user_id) 충돌 회피 ──
  delete from public.space_members sm_sec
   where sm_sec.user_id = p_secondary
     and exists (
       select 1 from public.space_members sm_pri
        where sm_pri.user_id = p_primary
          and sm_pri.space_id = sm_sec.space_id
     );
  update public.space_members set user_id = p_primary where user_id = p_secondary;

  -- ── 데이터 이전 (058 과 동일 집합) ──
  update public.events        set user_id = p_primary where user_id = p_secondary;
  get diagnostics v_moved_events = row_count;
  update public.todos         set user_id = p_primary where user_id = p_secondary;
  update public.categories    set user_id = p_primary where user_id = p_secondary;
  update public.ai_chat_logs  set user_id = p_primary where user_id = p_secondary;
  update public.usage_metrics set user_id = p_primary where user_id = p_secondary;
  update public.spaces        set created_by = p_primary where created_by = p_secondary;
  update public.anniversaries set created_by = p_primary where created_by = p_secondary;

  begin update public.ad_reward_logs         set user_id = p_primary where user_id = p_secondary; exception when undefined_table then null; end;
  begin update public.web_push_subscriptions set user_id = p_primary where user_id = p_secondary; exception when undefined_table then null; end;
  begin update public.todo_attachments       set user_id = p_primary where user_id = p_secondary; exception when undefined_table then null; end;
  begin update public.weekly_reviews         set user_id = p_primary where user_id = p_secondary; exception when undefined_table then null; end;
  begin update public.reactivation_pushes    set user_id = p_primary where user_id = p_secondary; exception when undefined_table then null; end;
  begin
    update public.notifications_queue set recipient_user_id = p_primary where recipient_user_id = p_secondary;
    update public.notifications_queue set actor_user_id     = p_primary where actor_user_id     = p_secondary;
  exception when undefined_table then null; end;

  -- ── 로그인 수단(identity) 귀속: B 의 모든 auth.identities 를 primary 로 이동 ──
  --   서로 다른 계정이므로 provider_id 가 달라 (provider_id, provider) unique 충돌 없음.
  --   이로써 이후 B 의 로그인 방법으로 들어와도 primary 유저로 resolve → 같은 데이터.
  update auth.identities set user_id = p_primary where user_id = p_secondary;
  get diagnostics v_moved_idents = row_count;

  -- secondary 의 프로필 행 삭제. auth.users 행 삭제는 Edge 의 admin API 가 담당.
  delete from public.users where id = p_secondary;

  return jsonb_build_object(
    'ok',            true,
    'primary',       p_primary,
    'secondary',     p_secondary,
    'moved_events',  v_moved_events,
    'moved_idents',  v_moved_idents,
    'deduped',       v_deduped,
    'policy',        p_conflict_policy,
    'both_pro',      v_both_pro
  );
end;
$$;

revoke all on function merge_account_v2(uuid, uuid, text) from public, anon, authenticated;
grant execute on function merge_account_v2(uuid, uuid, text) to service_role;

comment on function merge_account_v2(uuid, uuid, text) is
  '[service_role 전용] 토큰 기반 단일계정 통합. secondary 데이터+identity 를 primary 로 이전 후 secondary public.users 삭제. 보안은 Edge account-merge-bytoken 의 양토큰 검증이 담당.';
