-- 011_fix_rls_recursion_and_storage.sql
--
-- Purpose
--   1. Break the infinite-recursion in space_members RLS (Postgres 42P17).
--      The prior "space_members_select_own_spaces" policy referenced the same
--      table it protected, so any query that also RLS-filtered space_members
--      (e.g. events_select_shared) would recurse forever.
--   2. Add storage policies for the `avatars` bucket so that authenticated
--      users can upload/replace their own profile picture and anyone can read
--      the public URL.
--
-- Context
--   - events.events_select_shared joins space_members.  With the old recursive
--     policy, selecting from events also evaluates the space_members policy,
--     which itself selects from space_members → recursion.
--   - The SECURITY DEFINER helper `get_space_member_ids(uuid)` from
--     migration 002 already bypasses RLS and returns the user_ids of all
--     members of spaces the caller belongs to.  We reuse it here to break the
--     cycle without widening access.

-- ─── space_members: non-recursive SELECT policy ──────────────────────────────

drop policy if exists "space_members_select_own_spaces" on public.space_members;

-- Members can see all rows for spaces they belong to, including their own.
-- `user_id = auth.uid()` covers the caller's own membership row (needed even
-- when get_space_member_ids would not yet include the user, e.g. right after
-- inserting the first membership in a fresh space).
create policy "space_members_select_own_spaces"
  on public.space_members for select
  using (
    user_id = auth.uid()
    or user_id in (select user_id from get_space_member_ids(auth.uid()))
  );

-- ─── storage.objects: avatars bucket ─────────────────────────────────────────
-- The `avatars` bucket is created through the Supabase dashboard (Public).
-- These policies grant:
--   - INSERT: authenticated users may write to paths prefixed with their uid
--   - UPDATE: same, to allow upsert and re-upload
--   - DELETE: same, to allow removing an old avatar
--   - SELECT: public read (profile photos are shown to other members)
-- Path convention: `<auth.uid()>/...`  (first folder segment == user id)

-- Drop any earlier attempts so this migration is idempotent.
drop policy if exists "avatars_insert_own"  on storage.objects;
drop policy if exists "avatars_update_own"  on storage.objects;
drop policy if exists "avatars_delete_own"  on storage.objects;
drop policy if exists "avatars_select_public" on storage.objects;

create policy "avatars_insert_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars_update_own"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars_select_public"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'avatars');
