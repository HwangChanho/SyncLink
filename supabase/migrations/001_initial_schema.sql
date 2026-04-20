-- ============================================================================
-- SyncDay — Initial Schema Migration
-- Migration: 001_initial_schema.sql
-- Run: supabase db push
-- ============================================================================

-- Enable required extensions
-- uuid-ossp removed: Supabase uses gen_random_uuid() (pgcrypto, built-in)
create extension if not exists "pg_cron";   -- for smart reminder batch job

-- ─── USERS ──────────────────────────────────────────────────────────────────

-- Public profile table that mirrors auth.users
-- auth.users is managed by Supabase Auth; this table holds app-specific data
create table public.users (
  id                    uuid primary key references auth.users(id) on delete cascade,
  email                 text,
  nickname              text not null,
  avatar_url            text,
  push_token            text,                     -- Expo push token for notifications
  notification_settings jsonb not null default '{
    "event_reminders": true,
    "partner_changes": true,
    "space_invites": true,
    "smart_reminders": true
  }'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on table public.users is
  'Public user profiles. Linked 1:1 to auth.users via id.';

-- ─── SPACES ─────────────────────────────────────────────────────────────────

create type space_type as enum ('couple', 'group');

create table public.spaces (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  type            space_type not null default 'group',
  invite_code     text not null unique,
  cover_image_url text,
  created_by      uuid not null references public.users(id) on delete restrict,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- Invite code format: 6 uppercase alphanumeric characters
  constraint invite_code_format check (invite_code ~ '^[A-Z0-9]{6}$')
);

comment on table public.spaces is
  'Shared calendar groups. One space = one shared calendar.';

-- ─── SPACE_MEMBERS ──────────────────────────────────────────────────────────

create type space_member_role as enum ('owner', 'member');

create table public.space_members (
  id          uuid primary key default gen_random_uuid(),
  space_id    uuid not null references public.spaces(id) on delete cascade,
  user_id     uuid not null references public.users(id) on delete cascade,
  role        space_member_role not null default 'member',
  color       text not null default '#6C63FF',  -- hex color for event display
  joined_at   timestamptz not null default now(),

  unique(space_id, user_id),

  -- hex color validation
  constraint color_hex_format check (color ~ '^#[0-9A-Fa-f]{6}$')
);

comment on table public.space_members is
  'N:M junction between users and spaces. Stores member role and display color.';

-- Enforce couple-type space max 2 members
create or replace function check_couple_member_limit()
returns trigger as $$
begin
  if (
    select type from public.spaces where id = new.space_id
  ) = 'couple' then
    if (
      select count(*) from public.space_members where space_id = new.space_id
    ) >= 2 then
      raise exception 'Couple spaces are limited to 2 members.';
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger enforce_couple_member_limit
  before insert on public.space_members
  for each row execute function check_couple_member_limit();

-- ─── CATEGORIES ─────────────────────────────────────────────────────────────

create table public.categories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  name       text not null,
  color      text not null default '#6C63FF',
  icon       text,
  created_at timestamptz not null default now(),

  unique(user_id, name),
  constraint category_color_format check (color ~ '^#[0-9A-Fa-f]{6}$')
);

comment on table public.categories is
  'User-defined event/todo categories with color and icon.';

-- ─── EVENTS ─────────────────────────────────────────────────────────────────

create type repeat_type as enum ('none', 'daily', 'weekly', 'monthly', 'yearly');

create table public.events (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  title        text not null,
  description  text,
  location     text,
  start_at     timestamptz not null,
  end_at       timestamptz not null,
  all_day      boolean not null default false,
  repeat_type  repeat_type not null default 'none',
  repeat_until timestamptz,
  category_id  uuid references public.categories(id) on delete set null,
  color        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- end must be after or equal to start
  constraint end_after_start check (end_at >= start_at),
  constraint title_length check (char_length(title) <= 255),
  constraint color_hex_format check (color is null or color ~ '^#[0-9A-Fa-f]{6}$')
);

comment on table public.events is
  'Personal events. Owned by a single user. Shared via event_shares.';

create index idx_events_user_id on public.events(user_id);
create index idx_events_start_at on public.events(start_at);
create index idx_events_user_start on public.events(user_id, start_at);

-- ─── EVENT_SHARES ────────────────────────────────────────────────────────────

create table public.event_shares (
  id        uuid primary key default gen_random_uuid(),
  event_id  uuid not null references public.events(id) on delete cascade,
  space_id  uuid not null references public.spaces(id) on delete cascade,
  shared_at timestamptz not null default now(),

  unique(event_id, space_id)
);

comment on table public.event_shares is
  'Maps events to spaces. One event can be shared to multiple spaces.';

create index idx_event_shares_space_id on public.event_shares(space_id);

-- ─── TODOS ──────────────────────────────────────────────────────────────────

create type todo_priority as enum ('low', 'medium', 'high');

create table public.todos (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  space_id     uuid references public.spaces(id) on delete set null,  -- null = private
  title        text not null,
  description  text,
  due_date     date,
  priority     todo_priority not null default 'medium',
  is_completed boolean not null default false,
  completed_at timestamptz,
  category_id  uuid references public.categories(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint title_length check (char_length(title) <= 255)
);

comment on table public.todos is
  'Personal and shared todos. space_id = null means private.';

create index idx_todos_user_id on public.todos(user_id);
create index idx_todos_due_date on public.todos(due_date) where due_date is not null;

-- ─── ANNIVERSARIES ──────────────────────────────────────────────────────────

create table public.anniversaries (
  id            uuid primary key default gen_random_uuid(),
  space_id      uuid not null references public.spaces(id) on delete cascade,
  title         text not null,
  date          date not null,
  repeat_yearly boolean not null default true,
  created_by    uuid not null references public.users(id) on delete restrict,
  created_at    timestamptz not null default now()
);

comment on table public.anniversaries is
  'Anniversary and D-day entries associated with a space.';

-- ─── AI_CHAT_LOGS ────────────────────────────────────────────────────────────

create type ai_model_used as enum ('local', 'haiku', 'sonnet');

create table public.ai_chat_logs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  input_text    text not null,
  parsed_result jsonb not null default '{}',
  model_used    ai_model_used not null default 'local',
  tokens_used   integer,
  created_at    timestamptz not null default now()
);

comment on table public.ai_chat_logs is
  'NL parse requests and responses for debugging and context.';

create index idx_ai_chat_logs_user_date
  on public.ai_chat_logs(user_id, created_at desc);

-- ─── UPDATED_AT TRIGGERS ────────────────────────────────────────────────────

-- Generic trigger function to auto-update updated_at
create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger users_updated_at
  before update on public.users
  for each row execute function update_updated_at_column();

create trigger spaces_updated_at
  before update on public.spaces
  for each row execute function update_updated_at_column();

create trigger events_updated_at
  before update on public.events
  for each row execute function update_updated_at_column();

create trigger todos_updated_at
  before update on public.todos
  for each row execute function update_updated_at_column();

-- ─── NEW USER HOOK ───────────────────────────────────────────────────────────

-- Automatically create a public.users row when auth.users is created
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.users (id, email, nickname, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'nickname', split_part(new.email, '@', 1), 'User'),
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
