-- 037_workout_event_kind — v1.1 운동 일정 등록
--
-- Adds an event "kind" discriminator (general vs workout) and a join
-- table that records which body parts the user worked on during a
-- workout-kind event. Read-only metadata: editing is owner-only.
--
-- Plan: docs/plans/2026-05-17-workout-event-type.md

create type public.event_kind as enum ('general', 'workout');
create type public.workout_part as enum (
  'chest', 'back', 'shoulders', 'arms', 'legs', 'core', 'cardio'
);

alter table public.events
  add column event_kind public.event_kind not null default 'general';

-- Joining 1 event ↔ N body parts (no row payload beyond the pair).
create table public.event_workout_parts (
  event_id   uuid        not null references public.events(id) on delete cascade,
  part       public.workout_part not null,
  primary key (event_id, part)
);

alter table public.event_workout_parts enable row level security;

-- READ: owner or anyone the event is shared with (mirrors event read policy
-- via the event_shares table; the events RLS already gates the events row).
create policy ewp_select on public.event_workout_parts for select
  using (
    event_id in (select id from public.events where user_id = auth.uid())
    or event_id in (
      select es.event_id from public.event_shares es
      join public.space_members sm on sm.space_id = es.space_id
      where sm.user_id = auth.uid()
    )
  );

-- INSERT / DELETE: owner only.
create policy ewp_insert on public.event_workout_parts for insert
  with check (event_id in (select id from public.events where user_id = auth.uid()));

create policy ewp_delete on public.event_workout_parts for delete
  using (event_id in (select id from public.events where user_id = auth.uid()));
