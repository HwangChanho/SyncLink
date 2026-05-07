-- 032_event_editable_by_members.sql
--
-- LEAD (2026-05-07): "일정 등록단계에서 편집 허용 같은걸 추가해서 해당
-- 기능이 활성화되면 누구나 옮길수 있고 그게 서로에게 즉각 갱신되게 하자"
--
-- - events.editable_by_members boolean default false
-- - events_update_own RLS 확장: owner OR (editable_by_members AND share 받은
--   space 의 멤버)
-- - events_delete_own 은 그대로 (삭제는 owner 만 — 안전)

alter table public.events
  add column if not exists editable_by_members boolean not null default false;

comment on column public.events.editable_by_members is
  'When true, members of any space this event is shared to can also UPDATE the event (drag-to-reschedule, edit). Default false (owner-only).';

-- ─── events_update_own 확장 ────────────────────────────────────────────────

drop policy if exists "events_update_own" on public.events;

create policy "events_update_own"
  on public.events for update
  using (
    auth.uid() = user_id
    or (
      editable_by_members = true
      and exists (
        select 1 from public.event_shares es
        where es.event_id = public.events.id
          and es.space_id in (select space_id from public.get_member_space_ids(auth.uid()))
      )
    )
  )
  with check (
    -- WITH CHECK 도 동일 — 멤버가 update 시 user_id 변경 시도 차단은
    -- 별도 검증 (현재 클라가 그런 update 보내지 않음).
    auth.uid() = user_id
    or (
      editable_by_members = true
      and exists (
        select 1 from public.event_shares es
        where es.event_id = public.events.id
          and es.space_id in (select space_id from public.get_member_space_ids(auth.uid()))
      )
    )
  );
