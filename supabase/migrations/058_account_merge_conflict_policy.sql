-- Migration 058 — 계정 병합 시 일정 충돌 처리 정책 (Phase C+).
--
-- 배경: 056 의 merge_account 는 secondary 일정을 무조건 primary 로 이전(둘 다 유지).
--       사용자가 "통합 시 겹치는 일정을 어떻게 할지 선택"하길 원함.
--
-- 추가:
--   1) get_merge_conflicts(primary, secondary) — 겹치는 일정 쌍 개수 미리보기.
--      "같은 일정" 판정 = (start_at 동일) AND (lower(btrim(title)) 동일).
--      시간만 같고 제목이 다르면 별개 일정으로 본다(보수적 — 오삭제 방지).
--   2) merge_account(primary, secondary, p_conflict_policy) — 정책 파라미터 추가.
--      - 'keep_both' (기본): 056 과 동일, 둘 다 유지.
--      - 'dedupe'         : secondary 의 충돌 일정을 삭제(primary 것만 남김).
--
-- 056 의 2-인자 merge_account 는 그대로 두고(하위호환), 3-인자 오버로드를 추가한다.

-- ── 1. 충돌 미리보기 ──────────────────────────────────────────────────────
create or replace function get_merge_conflicts(p_primary uuid, p_secondary uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_conflicts int;
  v_secondary_total int;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'authentication required';
  end if;
  -- 호출자는 두 계정 중 하나 소유 + 이메일 동일(동일인) 이어야 함.
  if v_uid <> p_primary and v_uid <> p_secondary then
    raise exception 'caller must own one of the accounts';
  end if;
  if (select lower(email) from public.users where id = p_primary)
     is distinct from
     (select lower(email) from public.users where id = p_secondary) then
    raise exception 'email mismatch';
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

  select count(*) into v_secondary_total
  from public.events where user_id = p_secondary;

  return jsonb_build_object(
    'conflicts',       v_conflicts,        -- 겹치는 일정 수
    'secondary_total', v_secondary_total   -- secondary 전체 일정 수
  );
end;
$$;

revoke all on function get_merge_conflicts(uuid, uuid) from public, anon;
grant execute on function get_merge_conflicts(uuid, uuid) to authenticated;

comment on function get_merge_conflicts(uuid, uuid) is
  '병합 전 겹치는 일정(start_at+title 동일) 수 미리보기. 본인+동일이메일만.';

-- ── 2. 정책 인자를 받는 merge_account 오버로드 ────────────────────────────
create or replace function merge_account(
  p_primary         uuid,
  p_secondary       uuid,
  p_conflict_policy text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid             uuid;
  v_primary_email   text;
  v_secondary_email text;
  v_primary_plan    text;
  v_secondary_plan  text;
  v_both_pro        boolean := false;
  v_moved_events    int := 0;
  v_deduped         int := 0;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'authentication required';
  end if;
  if p_primary is null or p_secondary is null then
    raise exception 'primary and secondary required';
  end if;
  if p_primary = p_secondary then
    raise exception 'primary and secondary must differ';
  end if;
  if v_uid <> p_primary and v_uid <> p_secondary then
    raise exception 'caller must own one of the accounts';
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
  if lower(v_primary_email) <> lower(v_secondary_email) then
    raise exception 'email mismatch — refusing merge';
  end if;
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

  -- ── 데이터 이전 ──
  update public.events        set user_id = p_primary where user_id = p_secondary;
  get diagnostics v_moved_events = row_count;
  update public.todos         set user_id = p_primary where user_id = p_secondary;
  update public.categories    set user_id = p_primary where user_id = p_secondary;
  update public.ai_chat_logs  set user_id = p_primary where user_id = p_secondary;
  update public.usage_metrics set user_id = p_primary where user_id = p_secondary;
  update public.spaces        set created_by = p_primary where created_by = p_secondary;
  update public.anniversaries set created_by = p_primary where created_by = p_secondary;

  begin update public.ad_reward_logs        set user_id = p_primary where user_id = p_secondary; exception when undefined_table then null; end;
  begin update public.web_push_subscriptions set user_id = p_primary where user_id = p_secondary; exception when undefined_table then null; end;
  begin update public.todo_attachments      set user_id = p_primary where user_id = p_secondary; exception when undefined_table then null; end;
  begin update public.weekly_reviews        set user_id = p_primary where user_id = p_secondary; exception when undefined_table then null; end;
  begin update public.reactivation_pushes   set user_id = p_primary where user_id = p_secondary; exception when undefined_table then null; end;
  begin
    update public.notifications_queue set recipient_user_id = p_primary where recipient_user_id = p_secondary;
    update public.notifications_queue set actor_user_id     = p_primary where actor_user_id     = p_secondary;
  exception when undefined_table then null; end;

  delete from public.users where id = p_secondary;

  return jsonb_build_object(
    'ok',            true,
    'primary',       p_primary,
    'secondary',     p_secondary,
    'moved_events',  v_moved_events,
    'deduped',       v_deduped,
    'policy',        p_conflict_policy,
    'both_pro',      v_both_pro
  );
end;
$$;

revoke all on function merge_account(uuid, uuid, text) from public, anon;
grant execute on function merge_account(uuid, uuid, text) to authenticated;

comment on function merge_account(uuid, uuid, text) is
  '계정 병합 (충돌정책: keep_both|dedupe). dedupe 면 secondary 의 겹치는 일정(start_at+title 동일) 삭제 후 이전.';
