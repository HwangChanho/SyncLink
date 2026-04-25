-- 015_subscription_plan_admin.sql
--
-- Adds two columns on `users` so subscription state is server-authoritative
-- and so a manually-promoted account can act as an admin:
--   - subscription_plan ('free' | 'pro') — driven by RevenueCat sync from
--     the client. Edge Functions (e.g. translate-event) already read this
--     column to gate Pro features; until now it didn't exist so every
--     entitlement check returned false.
--   - is_admin (boolean) — flipped manually by the LEAD via Supabase
--     Studio. Used by the in-app admin screen to surface user-management
--     actions and by future moderation tooling.
--
-- Both columns default to safe values so existing rows keep working
-- without manual backfill.

alter table public.users
  add column if not exists subscription_plan text not null default 'free'
    check (subscription_plan in ('free', 'pro'));

alter table public.users
  add column if not exists is_admin boolean not null default false;

-- An index on is_admin would be wasteful (1-2 admin rows total) but a
-- partial index helps the admin screen list them quickly.
create index if not exists users_is_admin_true
  on public.users (id)
  where is_admin = true;
