-- ============================================================================
-- SyncDay — Invite Code Lifecycle + Couple Member Cap
-- Migration: 022_invite_code_lifecycle.sql
-- IDEA-016 — invite_code expires_at / max_uses / uses_count + couple cap trigger
--
-- Changes:
--   1. Add lifecycle columns to `spaces` table:
--      - invite_code_expires_at TIMESTAMPTZ  — NULL = never expires
--      - invite_code_max_uses   INTEGER       — NULL = unlimited
--      - invite_code_uses_count INTEGER       — atomic counter; incremented on join
--   2. couple_member_cap_check() trigger — BEFORE INSERT on space_members:
--      raises exception if space.type='couple' and current member count >= 2.
--      Provides a DB-level enforcement that cannot be bypassed via direct
--      PostgREST calls (supplements application-layer validation in spaceService).
--
-- Application-layer responsibilities (NOT enforced in this migration):
--   - Expiry check   : spaceService.joinSpaceByInviteCode reads invite_code_expires_at
--   - Max-uses check : spaceService.joinSpaceByInviteCode reads invite_code_uses_count
--   - Counter bump   : spaceService increments invite_code_uses_count atomically
--
-- Idempotent: all DDL guarded with IF EXISTS / IF NOT EXISTS so re-running is
-- safe (e.g., during local dev or CI rollback).
-- ============================================================================


-- ─── 1. Add lifecycle columns to `spaces` ────────────────────────────────────

alter table public.spaces
  add column if not exists invite_code_expires_at  timestamptz default null,
  add column if not exists invite_code_max_uses    integer     default null,
  add column if not exists invite_code_uses_count  integer     not null default 0;

comment on column public.spaces.invite_code_expires_at is
  'Invite code expiry timestamp. NULL = never expires. Checked by spaceService at join time.';

comment on column public.spaces.invite_code_max_uses is
  'Maximum number of times this invite code can be used. NULL = unlimited. Checked by spaceService at join time.';

comment on column public.spaces.invite_code_uses_count is
  'Number of successful redemptions of the current invite code. Incremented atomically by spaceService after a successful join. Reset to 0 when invite_code is regenerated.';


-- ─── 2. Couple member cap trigger ────────────────────────────────────────────
--
-- Fires BEFORE INSERT on space_members so that the violation is raised before
-- any row is written to disk. Using BEFORE rather than AFTER avoids partial
-- state (row inserted, then rolled back) and gives a clean SQLSTATE 23000
-- that supabase-js v2 propagates as a PostgrestError.
--
-- Error code: P0001 (raise_exception) — caught in spaceService and mapped to
-- 'space.couple_full' i18n key. The message string is intentionally English
-- to remain recognisable across locales.

create or replace function public.couple_member_cap_check()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type         text;
  v_member_count integer;
begin
  -- Only run the cap check for couple-type spaces
  select type into v_type
    from public.spaces
   where id = new.space_id;

  if v_type = 'couple' then
    select count(*) into v_member_count
      from public.space_members
     where space_id = new.space_id;

    if v_member_count >= 2 then
      raise exception 'couple_space_full'
        using errcode = 'P0001',
              detail   = 'Couple Space already has 2 members.',
              hint     = 'Couple spaces are limited to 2 members. Ask the owner to create a group space instead.';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.couple_member_cap_check is
  'BEFORE INSERT trigger on space_members. Raises P0001 couple_space_full when a couple-type space already has 2 members. Provides DB-level enforcement that bypasses application-layer validation.';

-- Re-create trigger idempotently
drop trigger if exists trg_couple_member_cap_check on public.space_members;

create trigger trg_couple_member_cap_check
  before insert on public.space_members
  for each row
  execute function public.couple_member_cap_check();


-- ─── 3. Reset uses_count when invite_code is regenerated ─────────────────────
--
-- When the owner regenerates the invite code, uses_count should reset to 0
-- because the new code has never been used. This trigger ensures atomicity —
-- spaceService UPDATE sets invite_code, and this trigger automatically resets
-- invite_code_uses_count in the same statement, preventing a two-step race.

create or replace function public.reset_invite_code_uses_on_regen()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only reset when invite_code itself changes (not other column updates)
  if new.invite_code is distinct from old.invite_code then
    new.invite_code_uses_count := 0;
    -- Clear expiry and max_uses so the regenerated code starts fresh.
    -- The owner can set new limits via a separate update if desired.
    -- (Sprint 28 scope: keep existing limits; IDEA-016 comment notes
    --  that expiry management UI is follow-up work.)
    -- Decision: do NOT auto-clear expires_at / max_uses here —
    -- preserve whatever the owner last configured so regeneration
    -- only resets the counter, not the policy.
  end if;
  return new;
end;
$$;

comment on function public.reset_invite_code_uses_on_regen is
  'BEFORE UPDATE trigger on spaces. Automatically resets invite_code_uses_count to 0 whenever invite_code changes (regeneration). Keeps expiry / max-uses policy intact.';

drop trigger if exists trg_reset_invite_code_uses on public.spaces;

create trigger trg_reset_invite_code_uses
  before update on public.spaces
  for each row
  execute function public.reset_invite_code_uses_on_regen();
