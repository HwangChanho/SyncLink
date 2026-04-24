-- 013_fix_event_shares_recursion.sql
--
-- Migration 011 broke the space_members ↔ space_members self-reference but
-- left a second recursion alive: events_select_shared references event_shares,
-- and event_shares_select references events. That cross-table cycle also
-- triggers PostgreSQL 42P17 "infinite recursion detected in policy for
-- relation" during event INSERT ... RETURNING (the RETURNING clause runs the
-- SELECT policies, which pull each other in).
--
-- Fix: rewrite event_shares_select so it references ONLY space_members
-- (via the SECURITY DEFINER helpers that bypass RLS), never events. That
-- breaks the cycle while preserving the intended behaviour:
--   - I can see shares for spaces I belong to (regardless of whether I own
--     the event — ownership is implied: the share row exists only if the
--     event was shared to a space I'm in or one where I'm the owner)
-- Ownership-only shares (event owner but no space membership) are still
-- visible through events_select_own → the owner can always read their own
-- event and join in `event_shares` directly via the events select path.

-- Helper: space_ids that the caller is a member of.
-- SECURITY DEFINER bypasses space_members RLS to avoid the cycle.
create or replace function public.get_member_space_ids(p_user_id uuid)
returns table(space_id uuid)
language sql
security definer
set search_path = public
stable
as $$
  select sm.space_id
  from public.space_members sm
  where sm.user_id = p_user_id;
$$;

grant execute on function public.get_member_space_ids(uuid) to authenticated, anon;

-- ─── event_shares SELECT: non-recursive ─────────────────────────────────────

drop policy if exists "event_shares_select" on public.event_shares;

create policy "event_shares_select"
  on public.event_shares for select
  using (
    space_id in (select space_id from public.get_member_space_ids(auth.uid()))
  );

-- ─── events_select_shared: also route through the helper ────────────────────
-- Previously this joined space_members directly which works after mig 011,
-- but going through the helper removes one more layer of policy evaluation
-- during INSERT ... RETURNING and is simpler to reason about.

drop policy if exists "events_select_shared" on public.events;

create policy "events_select_shared"
  on public.events for select
  using (
    exists (
      select 1 from public.event_shares es
      where es.event_id = public.events.id
        and es.space_id in (select space_id from public.get_member_space_ids(auth.uid()))
    )
  );
