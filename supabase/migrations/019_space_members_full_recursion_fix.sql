-- 019_space_members_full_recursion_fix.sql
--
-- Migration 011 broke the recursion in space_members_select_own_spaces
-- but missed two siblings:
--   space_members_update:  exists(select 1 from space_members ...)
--   space_members_delete:  exists(select 1 from space_members ...)
-- Both keep self-referencing the same table, which can resurface as
-- 42P17 inside complex transactions (events INSERT...RETURNING through
-- nested policy evaluation, role changes during a multi-statement
-- request, etc.). Replace them with a SECURITY DEFINER helper that
-- bypasses RLS on the inner read.

-- Helper: returns true if `p_user` is the owner of the given space.
-- SECURITY DEFINER bypasses RLS on space_members so the helper itself
-- doesn't trigger policy recursion.
create or replace function public.is_space_owner(p_user uuid, p_space uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.space_members
    where space_id = p_space
      and user_id  = p_user
      and role     = 'owner'
  );
$$;

grant execute on function public.is_space_owner(uuid, uuid) to authenticated, anon;

-- Re-create the two policies routed through the helper.
drop policy if exists "space_members_update" on public.space_members;
create policy "space_members_update"
  on public.space_members for update
  using (
    auth.uid() = user_id
    or public.is_space_owner(auth.uid(), space_id)
  );

drop policy if exists "space_members_delete" on public.space_members;
create policy "space_members_delete"
  on public.space_members for delete
  using (
    auth.uid() = user_id
    or public.is_space_owner(auth.uid(), space_id)
  );

-- spaces_update_owner / spaces_delete_owner had the same shape: they
-- reference space_members directly with role='owner'. Route those
-- through the same helper so future audits don't have to chase
-- another join.
drop policy if exists "spaces_update_owner" on public.spaces;
create policy "spaces_update_owner"
  on public.spaces for update
  using (public.is_space_owner(auth.uid(), id));

drop policy if exists "spaces_delete_owner" on public.spaces;
create policy "spaces_delete_owner"
  on public.spaces for delete
  using (public.is_space_owner(auth.uid(), id));
