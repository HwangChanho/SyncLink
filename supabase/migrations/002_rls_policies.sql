-- ============================================================================
-- SyncDay — Row Level Security Policies
-- Migration: 002_rls_policies.sql
-- Run AFTER: 001_initial_schema.sql
-- ============================================================================
-- SECURITY: Every table must have RLS enabled.
-- Principle: users can only access data they own or are authorized to see.
-- ============================================================================

-- ─── Enable RLS on all tables ────────────────────────────────────────────────

alter table public.users            enable row level security;
alter table public.spaces           enable row level security;
alter table public.space_members    enable row level security;
alter table public.categories       enable row level security;
alter table public.events           enable row level security;
alter table public.event_shares     enable row level security;
alter table public.todos            enable row level security;
alter table public.anniversaries    enable row level security;
alter table public.ai_chat_logs     enable row level security;

-- ─── USERS ──────────────────────────────────────────────────────────────────

-- Users can view their own profile
create policy "users_select_own"
  on public.users for select
  using (auth.uid() = id);

-- Users can view profiles of space members in their spaces
create policy "users_select_space_members"
  on public.users for select
  using (
    exists (
      select 1 from public.space_members sm1
      join public.space_members sm2 on sm1.space_id = sm2.space_id
      where sm1.user_id = auth.uid()
        and sm2.user_id = public.users.id
    )
  );

-- Users can update their own profile
create policy "users_update_own"
  on public.users for update
  using (auth.uid() = id);

-- ─── SPACES ─────────────────────────────────────────────────────────────────

-- Users can view spaces they belong to
create policy "spaces_select_member"
  on public.spaces for select
  using (
    exists (
      select 1 from public.space_members
      where space_id = public.spaces.id
        and user_id = auth.uid()
    )
  );

-- Any authenticated user can create a space
create policy "spaces_insert_authenticated"
  on public.spaces for insert
  with check (auth.uid() = created_by);

-- Only the owner can update space details
create policy "spaces_update_owner"
  on public.spaces for update
  using (
    exists (
      select 1 from public.space_members
      where space_id = public.spaces.id
        and user_id = auth.uid()
        and role = 'owner'
    )
  );

-- Only the owner can delete a space
create policy "spaces_delete_owner"
  on public.spaces for delete
  using (
    exists (
      select 1 from public.space_members
      where space_id = public.spaces.id
        and user_id = auth.uid()
        and role = 'owner'
    )
  );

-- ─── SPACE_MEMBERS ──────────────────────────────────────────────────────────

-- Users can view members of spaces they belong to
create policy "space_members_select_own_spaces"
  on public.space_members for select
  using (
    exists (
      select 1 from public.space_members sm
      where sm.space_id = public.space_members.space_id
        and sm.user_id = auth.uid()
    )
  );

-- Users can insert themselves (join a space via invite code — validated by function)
create policy "space_members_insert_self"
  on public.space_members for insert
  with check (auth.uid() = user_id);

-- Users can update their own membership (e.g. change display color)
-- Owners can update any member's role/color
create policy "space_members_update"
  on public.space_members for update
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.space_members
      where space_id = public.space_members.space_id
        and user_id = auth.uid()
        and role = 'owner'
    )
  );

-- Users can remove themselves; owners can remove others
create policy "space_members_delete"
  on public.space_members for delete
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.space_members
      where space_id = public.space_members.space_id
        and user_id = auth.uid()
        and role = 'owner'
    )
  );

-- ─── CATEGORIES ─────────────────────────────────────────────────────────────

create policy "categories_all_own"
  on public.categories for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ─── EVENTS ─────────────────────────────────────────────────────────────────

-- Users can view their own events
create policy "events_select_own"
  on public.events for select
  using (auth.uid() = user_id);

-- Users can view events shared to their spaces
create policy "events_select_shared"
  on public.events for select
  using (
    exists (
      select 1 from public.event_shares es
      join public.space_members sm on sm.space_id = es.space_id
      where es.event_id = public.events.id
        and sm.user_id = auth.uid()
    )
  );

-- Only authenticated users can insert events they own
create policy "events_insert_own"
  on public.events for insert
  with check (auth.uid() = user_id);

-- Only the event owner can update
create policy "events_update_own"
  on public.events for update
  using (auth.uid() = user_id);

-- Only the event owner can delete
create policy "events_delete_own"
  on public.events for delete
  using (auth.uid() = user_id);

-- ─── EVENT_SHARES ────────────────────────────────────────────────────────────

-- Users can see shares for events they own or for spaces they belong to
create policy "event_shares_select"
  on public.event_shares for select
  using (
    -- I own the event
    exists (select 1 from public.events where id = event_id and user_id = auth.uid())
    or
    -- I'm a member of the space
    exists (
      select 1 from public.space_members
      where space_id = public.event_shares.space_id
        and user_id = auth.uid()
    )
  );

-- Only the event owner can share it
create policy "event_shares_insert_owner"
  on public.event_shares for insert
  with check (
    exists (
      select 1 from public.events
      where id = event_id and user_id = auth.uid()
    )
  );

-- Only the event owner can unshare
create policy "event_shares_delete_owner"
  on public.event_shares for delete
  using (
    exists (
      select 1 from public.events
      where id = event_id and user_id = auth.uid()
    )
  );

-- ─── TODOS ──────────────────────────────────────────────────────────────────

-- Users can view their own todos
create policy "todos_select_own"
  on public.todos for select
  using (auth.uid() = user_id);

-- Users can view shared todos in their spaces
create policy "todos_select_shared"
  on public.todos for select
  using (
    space_id is not null
    and exists (
      select 1 from public.space_members
      where space_id = public.todos.space_id
        and user_id = auth.uid()
    )
  );

create policy "todos_insert_own"
  on public.todos for insert
  with check (auth.uid() = user_id);

create policy "todos_update_own"
  on public.todos for update
  using (auth.uid() = user_id);

create policy "todos_delete_own"
  on public.todos for delete
  using (auth.uid() = user_id);

-- ─── ANNIVERSARIES ──────────────────────────────────────────────────────────

-- Members of a space can view its anniversaries
create policy "anniversaries_select_member"
  on public.anniversaries for select
  using (
    exists (
      select 1 from public.space_members
      where space_id = public.anniversaries.space_id
        and user_id = auth.uid()
    )
  );

-- Members of a space can create anniversaries
create policy "anniversaries_insert_member"
  on public.anniversaries for insert
  with check (
    auth.uid() = created_by
    and exists (
      select 1 from public.space_members
      where space_id = public.anniversaries.space_id
        and user_id = auth.uid()
    )
  );

-- Only the creator can delete
create policy "anniversaries_delete_creator"
  on public.anniversaries for delete
  using (auth.uid() = created_by);

-- ─── AI_CHAT_LOGS ────────────────────────────────────────────────────────────

create policy "ai_chat_logs_all_own"
  on public.ai_chat_logs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
