-- 016_protect_privileged_user_columns.sql
--
-- Closes a bypass: the existing `users_update_own` RLS policy lets the
-- authenticated user update *any* column on their own row, so a
-- malicious client could simply call
--   supabase.from('users').update({ subscription_plan: 'pro', is_admin: true,
--     ai_ad_credits: 99999 }).eq('id', auth.uid())
-- and quietly upgrade themselves. RLS doesn't have column-level UPDATE
-- restrictions, so we plug the gap with a BEFORE UPDATE trigger that
-- rejects diffs on the privileged columns whenever the request comes
-- from a regular authenticated client. The service role (used by Edge
-- Functions like reward-credit and the future RevenueCat webhook) is
-- detected via the JWT's `role` claim and waved through.

create or replace function public.protect_user_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  jwt_role text;
begin
  -- request.jwt.claims is null when the call originates from the service
  -- role using a raw connection (e.g. supabase functions). Compare to the
  -- top-level Postgres role too.
  jwt_role := coalesce(
    current_setting('request.jwt.claims', true)::json->>'role',
    ''
  );
  if jwt_role = 'service_role' or current_user = 'service_role' then
    return NEW;
  end if;

  if NEW.subscription_plan is distinct from OLD.subscription_plan then
    raise exception 'subscription_plan can only be changed server-side';
  end if;
  if NEW.is_admin is distinct from OLD.is_admin then
    raise exception 'is_admin can only be changed server-side';
  end if;
  if NEW.ai_ad_credits is distinct from OLD.ai_ad_credits then
    raise exception 'ai_ad_credits can only be changed server-side';
  end if;
  return NEW;
end;
$$;

drop trigger if exists users_protect_privileged_columns on public.users;
create trigger users_protect_privileged_columns
  before update on public.users
  for each row
  execute function public.protect_user_privileged_columns();
