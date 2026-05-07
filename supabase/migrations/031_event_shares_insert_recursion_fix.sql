-- 031_event_shares_insert_recursion_fix.sql
--
-- Build-94 LEAD 보고: "event_shares INSERT 실패 [42P17]" — 일정 등록 시
-- 공유 INSERT 또는 event 상세에서 공유 토글 시 발생.
--
-- 원인: event_shares_insert_owner 정책 (mig 002) 의 with check 가 events
-- 테이블을 직접 참조 → events_select_shared (mig 013) 가 helper 로
-- 우회됐지만 INSERT ... RETURNING 시점의 정책 평가 흐름에서 여전히 events
-- RLS 가 호출 → 다른 정책이 event_shares 를 다시 참조 → recursion 42P17.
--
-- Fix: event 소유 검증을 SECURITY DEFINER 함수로 옮긴다. RLS 우회 path
-- 라 recursion 이 끊김. mig 013 의 get_member_space_ids 패턴 동일.

create or replace function public.user_owns_event(p_event_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.events
    where id = p_event_id and user_id = p_user_id
  );
$$;

grant execute on function public.user_owns_event(uuid, uuid) to authenticated, anon;

-- ─── event_shares INSERT: helper 통과로 recursion 차단 ──────────────────────

drop policy if exists "event_shares_insert_owner" on public.event_shares;

create policy "event_shares_insert_owner"
  on public.event_shares for insert
  with check ( public.user_owns_event(event_id, auth.uid()) );

-- DELETE 정책도 동일 패턴으로 정리해 일관성 유지 + 잠재 recursion 방지.
drop policy if exists "event_shares_delete_owner" on public.event_shares;

create policy "event_shares_delete_owner"
  on public.event_shares for delete
  using ( public.user_owns_event(event_id, auth.uid()) );
