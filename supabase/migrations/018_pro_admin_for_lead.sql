-- One-shot promotion of the LEAD account to Pro + admin.
--
-- Migration runs as the `postgres` super-user, but the
-- protect_user_privileged_columns trigger we added in 016 only waives
-- service_role connections. Use session_replication_role=replica to
-- bypass triggers for the duration of this transaction so the update
-- succeeds; the trigger remains active for application traffic.
begin;
  set local session_replication_role = replica;
  update public.users
  set subscription_plan = 'pro',
      is_admin          = true
  where id = (select id from auth.users where email = 'cksgh0316@gmail.com');
commit;
