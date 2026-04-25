-- 017_space_creator_select.sql
--
-- Fix: createSpace was failing with PG 42501 ("new row violates row-
-- level security policy for table 'spaces'") even though the INSERT
-- itself was allowed. Cause: the .insert().select().single() round-
-- trip evaluates the SELECT policy on the freshly-inserted row, but
-- the only SELECT policy ("spaces_select_member") checks for a row
-- in space_members — which has *not* been written yet at that point
-- (the membership row is the very next INSERT). Returning the row
-- therefore fails RLS and the client surfaces the error.
--
-- Fix is additive: allow the creator to SELECT their own freshly-
-- inserted space row regardless of membership. The existing member
-- policy still covers everyone else.

drop policy if exists "spaces_select_creator" on public.spaces;

create policy "spaces_select_creator"
  on public.spaces for select
  using (auth.uid() = created_by);
