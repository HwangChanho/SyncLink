-- Migration 056 — 계정 병합 실행 RPC (Phase C).
--
-- secondary 계정의 모든 사용자 데이터를 primary 로 이전한 뒤, secondary 의
-- public.users 행을 제거한다. auth.users 삭제는 RPC 가 직접 못 하므로 Edge
-- Function(account-merge-execute)이 이 RPC 성공 후 admin API 로 처리한다.
--
-- 보안 (반드시):
--   - 호출자(auth.uid())가 primary 또는 secondary 중 하나여야 함.
--   - primary 와 secondary 의 이메일이 "동일"해야 함 (동일인 보증). 다르면 거부.
--   - 따라서 타인 계정 흡수 불가.
--
-- Pro 보존:
--   - secondary 가 'pro' 인데 primary 가 'pro' 가 아니면 거부 (구독 유실 방지).
--     → 호출 측에서 primary 를 Pro 쪽으로 잡아야 함 (UX 가 Pro 를 primary 추천).
--   - 둘 다 pro 인 경우: 이중 결제 가능성 → 경고용 플래그 반환(병합은 진행).
--
-- 충돌:
--   - space_members(space_id,user_id) UNIQUE: 두 계정이 같은 space 멤버면
--     secondary 멤버십은 삭제(스킵), primary 멤버십 유지.
--   - 그 외 테이블은 단순 user_id UPDATE.
--
-- 멱등/안전:
--   - primary == secondary 면 거부.
--   - 단일 함수 = 단일 트랜잭션 → 중간 실패 시 전체 롤백.

create or replace function merge_account(
  p_primary   uuid,
  p_secondary uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid            uuid;
  v_primary_email  text;
  v_secondary_email text;
  v_primary_plan   text;
  v_secondary_plan text;
  v_both_pro       boolean := false;
  v_moved_events   int := 0;
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

  -- 호출자는 둘 중 하나여야 함 (본인 계정 병합만).
  if v_uid <> p_primary and v_uid <> p_secondary then
    raise exception 'caller must own one of the accounts';
  end if;

  -- 이메일 + plan 조회.
  select email, coalesce(subscription_plan, 'free')
    into v_primary_email, v_primary_plan
    from public.users where id = p_primary;
  select email, coalesce(subscription_plan, 'free')
    into v_secondary_email, v_secondary_plan
    from public.users where id = p_secondary;

  if v_primary_email is null or v_secondary_email is null then
    raise exception 'account not found';
  end if;

  -- 동일인 보증: 이메일 일치 필수.
  if lower(v_primary_email) <> lower(v_secondary_email) then
    raise exception 'email mismatch — refusing merge';
  end if;

  -- Pro 유실 방지: secondary 가 pro 인데 primary 가 아니면 거부.
  if v_secondary_plan = 'pro' and v_primary_plan <> 'pro' then
    raise exception 'secondary is Pro but primary is not — choose Pro account as primary';
  end if;
  if v_secondary_plan = 'pro' and v_primary_plan = 'pro' then
    v_both_pro := true;  -- 호출 측에 경고 (이중 결제 가능)
  end if;

  -- ── 데이터 이전 (자식 테이블들). 충돌 테이블은 개별 처리. ──

  -- space_members: UNIQUE(space_id,user_id) 충돌 회피.
  --   primary 가 이미 멤버인 space 의 secondary 멤버십은 삭제, 나머지는 이전.
  delete from public.space_members sm_sec
   where sm_sec.user_id = p_secondary
     and exists (
       select 1 from public.space_members sm_pri
        where sm_pri.user_id = p_primary
          and sm_pri.space_id = sm_sec.space_id
     );
  update public.space_members set user_id = p_primary where user_id = p_secondary;

  -- 단순 이전 테이블들 (user_id).
  update public.events            set user_id = p_primary where user_id = p_secondary;
  get diagnostics v_moved_events = row_count;
  update public.todos             set user_id = p_primary where user_id = p_secondary;
  update public.categories        set user_id = p_primary where user_id = p_secondary;
  update public.ai_chat_logs      set user_id = p_primary where user_id = p_secondary;
  update public.usage_metrics     set user_id = p_primary where user_id = p_secondary;

  -- created_by 테이블 (spaces, anniversaries) — on delete restrict 라 반드시 이전.
  update public.spaces            set created_by = p_primary where created_by = p_secondary;
  update public.anniversaries     set created_by = p_primary where created_by = p_secondary;

  -- 선택적 테이블 — 존재할 때만 (배포 환경별 차이 방어).
  begin
    update public.ad_reward_logs        set user_id = p_primary where user_id = p_secondary;
  exception when undefined_table then null; end;
  begin
    update public.web_push_subscriptions set user_id = p_primary where user_id = p_secondary;
  exception when undefined_table then null; end;
  begin
    update public.todo_attachments      set user_id = p_primary where user_id = p_secondary;
  exception when undefined_table then null; end;
  begin
    update public.weekly_reviews        set user_id = p_primary where user_id = p_secondary;
  exception when undefined_table then null; end;
  begin
    update public.reactivation_pushes   set user_id = p_primary where user_id = p_secondary;
  exception when undefined_table then null; end;
  -- notifications_queue: 두 컬럼 모두 이전.
  begin
    update public.notifications_queue set recipient_user_id = p_primary where recipient_user_id = p_secondary;
    update public.notifications_queue set actor_user_id     = p_primary where actor_user_id     = p_secondary;
  exception when undefined_table then null; end;

  -- ── secondary public.users 제거 ──
  -- 이 시점에 secondary 를 참조하는 자식 행은 모두 이전/삭제됨.
  delete from public.users where id = p_secondary;

  return jsonb_build_object(
    'ok',           true,
    'primary',      p_primary,
    'secondary',    p_secondary,
    'moved_events', v_moved_events,
    'both_pro',     v_both_pro
  );
end;
$$;

revoke all on function merge_account(uuid, uuid) from public;
grant execute on function merge_account(uuid, uuid) to authenticated;

comment on function merge_account(uuid, uuid) is
  '계정 병합: secondary→primary 데이터 이전 후 secondary public.users 삭제. 본인+동일이메일만, Pro 유실 거부. auth.users 삭제는 Edge 에서.';
