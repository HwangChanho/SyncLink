-- ============================================================================
-- Migration 014 — event_translations cache table (Sprint 15 TASK-1500)
-- ============================================================================
-- Stores per-(event × target_locale) AI translations so that repeated reads
-- by different viewers of the same shared event do not re-call Claude Haiku.
-- The `source_hash` column lets us detect when the underlying event title /
-- description has been edited and the cached translation is now stale.
--
-- RLS design:
--   • SELECT is allowed whenever the caller can see the parent event through
--     the existing `events` policies — we simply subquery `events.id` which
--     already enforces the owner/member visibility rules.
--   • INSERT / UPDATE are intentionally NOT covered by a policy, so only the
--     service role (used inside the translate-event Edge Function) can write.
-- ============================================================================

create table public.event_translations (
  id               uuid        primary key default gen_random_uuid(),
  event_id         uuid        not null references public.events(id) on delete cascade,
  -- Detected source language of the original title/description ('ko','en','zh','ja').
  source_locale    text        not null,
  -- Target locale requested by the viewer ('ko','en','zh','ja').
  target_locale    text        not null,
  translated_title text        not null,
  translated_desc  text,
  -- sha256(title + "\n" + (description ?? "")) — changes when the event is edited.
  source_hash      text        not null,
  created_at       timestamptz not null default now(),
  unique (event_id, target_locale)
);

-- Covering index for the primary access pattern
-- (SELECT ... WHERE event_id = $1 AND target_locale = $2).
create index event_translations_event on public.event_translations (event_id);

-- ── RLS ─────────────────────────────────────────────────────────────────────

alter table public.event_translations enable row level security;

-- Viewers who can see the parent event can read its translations. The subquery
-- reuses the `events` RLS policies transparently: PostgREST / postgres evaluate
-- the `select id from public.events` inside the user's session, so only events
-- visible to the user come back — meaning only their translations are joinable.
create policy "translations_select" on public.event_translations for select
  using (
    event_id in (
      select id from public.events
    )
  );

-- No INSERT / UPDATE / DELETE policy → service role only (Edge Function).
