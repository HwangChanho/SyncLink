-- ============================================================================
-- SyncDay — Space Activity Push Notifications
-- Migration: 021_space_activity_notifications.sql
-- IDEA-010 — backend infra for space_activity push delivery.
--
-- Architecture (option B from docs/plans/2026-04-28-space-activity-push.md):
--   1. event_shares INSERT/DELETE + events UPDATE → trigger
--   2. trigger inserts rows into notifications_queue (one per recipient member,
--      excluding actor, only when their notification_preferences.space_activity
--      is true and a push_token is registered)
--   3. pg_cron calls dispatch-notifications Edge Function every minute
--   4. Edge Function fetches sent_at IS NULL rows, sends Expo Push, updates
--      sent_at on success or retry_count on failure
--
-- Idempotent: all DDL guarded with IF EXISTS / IF NOT EXISTS so re-running is
-- safe (e.g., during local dev or rollback).
-- ============================================================================

-- ─── 0. Required extensions (already enabled by 001/003 but defensive) ──────
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ─── 1. notifications_queue table ───────────────────────────────────────────

drop table if exists public.notifications_queue cascade;

create table public.notifications_queue (
  id                  uuid primary key default gen_random_uuid(),
  -- Space context
  space_id            uuid not null references public.spaces(id) on delete cascade,
  -- Recipient: the user who should receive this push
  recipient_user_id   uuid not null references public.users(id) on delete cascade,
  -- Actor: the user whose action triggered this notification (nullable so we
  -- can keep the queue row even if the actor is deleted later)
  actor_user_id       uuid references public.users(id) on delete set null,
  -- Original event id (NOT a FK — events may be deleted by the time we send,
  -- but we still want to deliver the "deleted" notification)
  event_id            uuid,
  -- Notification kind. Constrained to a small enumeration.
  type                text not null
    check (type in ('event_added', 'event_updated', 'event_deleted')),
  -- Snapshot payload at trigger time (event title, start_at, actor_nickname).
  -- Snapshot is necessary because the source event may be modified or deleted
  -- before dispatch runs.
  payload             jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  -- Dispatch state
  sent_at             timestamptz,           -- NULL = pending
  retry_count         smallint not null default 0,
  last_error          text
);

comment on table public.notifications_queue is
  'Queue of pending push notifications. Inserted by triggers on event_shares/events, drained by dispatch-notifications Edge Function via pg_cron (1-minute cadence).';

-- Pending queue lookup index (most common query pattern)
create index if not exists idx_notifications_queue_pending
  on public.notifications_queue (created_at)
  where sent_at is null;

-- For audit / per-user history queries
create index if not exists idx_notifications_queue_recipient
  on public.notifications_queue (recipient_user_id, created_at desc);

-- ─── 2. RLS — service role only writes; users may read their own ────────────

alter table public.notifications_queue enable row level security;

-- Drop any leftover policies from prior runs
drop policy if exists "notifications_queue_select_own"
  on public.notifications_queue;

create policy "notifications_queue_select_own"
  on public.notifications_queue for select
  using (auth.uid() = recipient_user_id);

-- INSERT/UPDATE/DELETE: only service role (no policy needed; RLS denies by default)

-- ─── 3. Helper function: enqueue notifications for one event in one space ──
--
-- SECURITY DEFINER so the trigger can read users.push_token /
-- notification_preferences regardless of caller's RLS view.
-- search_path pinned to public to prevent search_path hijacking attacks.

create or replace function public.enqueue_space_activity_notifications(
  p_space_id        uuid,
  p_event_id        uuid,
  p_actor_user_id   uuid,
  p_type            text,
  p_payload         jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications_queue (
    space_id, recipient_user_id, actor_user_id, event_id, type, payload
  )
  select
    p_space_id,
    sm.user_id,
    p_actor_user_id,
    p_event_id,
    p_type,
    p_payload
  from public.space_members sm
  join public.users u on u.id = sm.user_id
  where sm.space_id = p_space_id
    -- Exclude the actor from receiving their own notification
    and sm.user_id <> coalesce(p_actor_user_id, '00000000-0000-0000-0000-000000000000'::uuid)
    -- Recipient must have a push token registered
    and u.push_token is not null
    -- Master push toggle on
    and coalesce(u.push_enabled, true) = true
    -- Per-category toggle: notification_preferences.space_activity
    and coalesce(
      (u.notification_preferences->>'space_activity')::boolean,
      true
    ) = true;
end;
$$;

comment on function public.enqueue_space_activity_notifications is
  'Inserts one notifications_queue row per eligible space member. Filters by push_token presence, push_enabled master, and notification_preferences.space_activity per-category toggle.';

-- ─── 4. Trigger: event_shares INSERT → 'event_added' ────────────────────────

create or replace function public.trg_event_shares_inserted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event   record;
  v_actor_nick text;
begin
  -- Snapshot the event details + actor nickname at trigger time.
  -- If the event vanishes mid-trigger, exit silently (defensive).
  select e.id, e.user_id, e.title, e.start_at
    into v_event
    from public.events e
   where e.id = new.event_id;

  if not found then
    return new;
  end if;

  select u.nickname into v_actor_nick
    from public.users u
   where u.id = v_event.user_id;

  perform public.enqueue_space_activity_notifications(
    new.space_id,
    new.event_id,
    v_event.user_id,
    'event_added',
    jsonb_build_object(
      'title',           v_event.title,
      'start_at',        v_event.start_at,
      'actor_nickname',  coalesce(v_actor_nick, '멤버')
    )
  );

  return new;
end;
$$;

drop trigger if exists event_shares_after_insert_notify on public.event_shares;
create trigger event_shares_after_insert_notify
  after insert on public.event_shares
  for each row
  execute function public.trg_event_shares_inserted();

-- ─── 5. Trigger: event_shares DELETE → 'event_deleted' ──────────────────────
--
-- Note: this fires when an event is unshared from a space, OR when the parent
-- event is deleted (cascade fires DELETE on event_shares). Either way the
-- semantics for space members are the same: the event is no longer there.

create or replace function public.trg_event_shares_deleted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event   record;
  v_actor_nick text;
begin
  -- Try to read the event (may already be cascade-deleted; in that case use
  -- a minimal payload — title is unknown but type alone is informative).
  select e.id, e.user_id, e.title, e.start_at
    into v_event
    from public.events e
   where e.id = old.event_id;

  if found then
    select u.nickname into v_actor_nick
      from public.users u
     where u.id = v_event.user_id;
  end if;

  perform public.enqueue_space_activity_notifications(
    old.space_id,
    old.event_id,
    coalesce(v_event.user_id, null),
    'event_deleted',
    jsonb_build_object(
      'title',          coalesce(v_event.title, ''),
      'start_at',       coalesce(v_event.start_at, null),
      'actor_nickname', coalesce(v_actor_nick, '멤버')
    )
  );

  return old;
end;
$$;

drop trigger if exists event_shares_after_delete_notify on public.event_shares;
create trigger event_shares_after_delete_notify
  after delete on public.event_shares
  for each row
  execute function public.trg_event_shares_deleted();

-- ─── 6. Trigger: events UPDATE → 'event_updated' for each shared space ─────
--
-- Only fire when user-meaningful fields change (title/start_at/end_at/location)
-- to avoid noise from internal-only updates.

create or replace function public.trg_events_updated()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_share   record;
  v_actor_nick text;
begin
  -- Skip if nothing meaningful changed
  if new.title       is not distinct from old.title
     and new.start_at  is not distinct from old.start_at
     and new.end_at    is not distinct from old.end_at
     and new.location  is not distinct from old.location
  then
    return new;
  end if;

  select nickname into v_actor_nick
    from public.users
   where id = new.user_id;

  -- Enqueue one batch of notifications per space the event is shared to
  for v_share in
    select space_id from public.event_shares where event_id = new.id
  loop
    perform public.enqueue_space_activity_notifications(
      v_share.space_id,
      new.id,
      new.user_id,
      'event_updated',
      jsonb_build_object(
        'title',           new.title,
        'start_at',        new.start_at,
        'actor_nickname',  coalesce(v_actor_nick, '멤버')
      )
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists events_after_update_notify on public.events;
create trigger events_after_update_notify
  after update on public.events
  for each row
  execute function public.trg_events_updated();

-- ─── 7. pg_cron: dispatch every minute ──────────────────────────────────────
--
-- Mirrors the pattern from 003_smart_reminder_cron.sql.
-- Requires app.supabase_url and app.service_role_key custom GUCs to be set
-- (same as smart-reminder).

select cron.unschedule('space-activity-dispatch')
where exists (
  select 1 from cron.job where jobname = 'space-activity-dispatch'
);

select cron.schedule(
  'space-activity-dispatch',
  '* * * * *',                   -- every minute
  $$
  select net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/dispatch-notifications',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body    := '{}'::jsonb
  )
  $$
);

-- ─── 8. Cleanup helper (optional, can be scheduled separately) ──────────────
-- Sent rows older than 30 days are pruned to keep the table small.
-- Not registered as a cron job here — LEAD can enable separately if desired.

create or replace function public.cleanup_notifications_queue()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.notifications_queue
   where sent_at is not null
     and sent_at < now() - interval '30 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

comment on function public.cleanup_notifications_queue is
  'Manual/scheduled cleanup. Returns number of rows deleted. Call from psql or wire to a weekly pg_cron if queue volume grows.';
