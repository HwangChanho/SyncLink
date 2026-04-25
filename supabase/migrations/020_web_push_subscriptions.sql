-- 020_web_push_subscriptions.sql
--
-- Storage for browser PushSubscription objects so the upcoming
-- send-web-push Edge Function can fan out reminder notifications to
-- the user's web sessions. One row per (user_id, endpoint).

create table if not exists public.web_push_subscriptions (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references public.users(id) on delete cascade,
  endpoint    text        not null,
  -- WebPush keys come straight from PushSubscription.toJSON()
  p256dh      text        not null,
  auth        text        not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  unique (user_id, endpoint)
);

create index if not exists web_push_subscriptions_user
  on public.web_push_subscriptions (user_id);

alter table public.web_push_subscriptions enable row level security;

-- A user can manage only their own subscriptions; service role inserts
-- happen via the authenticated client too (RLS lets it through because
-- the row's user_id matches auth.uid()).
create policy "web_push_select_own"
  on public.web_push_subscriptions for select
  using (auth.uid() = user_id);

create policy "web_push_insert_own"
  on public.web_push_subscriptions for insert
  with check (auth.uid() = user_id);

create policy "web_push_delete_own"
  on public.web_push_subscriptions for delete
  using (auth.uid() = user_id);
