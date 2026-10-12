-- 076_access_boundary_hardening.sql
--
-- 권한 경계 보강 (2026-10-13 점검 1단계). **앱 코드 변경 없음** — 옛 앱 번들도 그대로 동작해야 한다.
--
-- ## 무엇을 바꾸나
-- 1) users.email 은 서버(service_role)만 바꾼다.
--    가입 때 handle_new_user 가 auth.users 값으로 채우고, 앱은 이 칸을 쓰지 않는다
--    (authService.updateProfile 은 nickname·avatar_url·notification_settings·country_code 만).
-- 2) 알림 큐 적재·정리 함수(enqueue_space_activity_notifications·cleanup_notifications_queue)는
--    트리거·서버 전용이다 → 클라이언트 역할(anon·authenticated)의 실행 권한을 회수한다.
--    트리거 함수(trg_*)는 SECURITY DEFINER(소유자 postgres)라 회수와 무관하게 계속 부를 수 있다.
-- 3) space_members 에 클라이언트가 쓰는 값을 서버에서 검사한다.
--    - INSERT: role 은 'member' 만. 예외 = Space 생성 직후(멤버 0명) 생성자 본인의 owner 행.
--    - UPDATE: space_id·user_id 는 바꿀 수 없다 · role 변경은 그 Space 의 현재 owner 만
--      (owner 위임: space/members.ts 의 leaveSpace·transferOwnership 은 owner 가 호출하므로 그대로 된다).
--    - 서버·SECURITY DEFINER 함수(merge_account 등) 안에서의 변경은 검사하지 않는다(아래 current_user 판정).
-- 4) RLS 도우미 4개(get_member_space_ids·get_space_member_ids·is_space_owner·user_owns_event)는
--    호출자 본인(auth.uid())에 대해서만 답한다. 정책 11개가 전부 auth.uid() 를 넘기므로 동작은 같다.
--    (get_space_member_ids 는 search_path 고정이 빠져 있어 함께 고정한다.)
-- 5) event_shares INSERT 는 대상 Space 의 멤버일 때만 허용한다.
--
-- ## 되돌리기
-- 파일 맨 아래 «되돌리기» 주석 블록을 그대로 실행하면 이 마이그레이션 이전 정의로 돌아간다.

set lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) users.email 서버 전용
-- ─────────────────────────────────────────────────────────────────────────────
-- 016 의 보호 트리거 함수에 email 비교 한 줄을 더한다. 나머지는 016 과 동일.
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
  -- 076: email 은 가입 시 auth 가 채운 값을 유지한다(앱은 이 칸을 쓰지 않는다).
  if NEW.email is distinct from OLD.email then
    raise exception 'email can only be changed server-side';
  end if;
  return NEW;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) 알림 큐 함수 — 클라이언트 실행 권한 회수
-- ─────────────────────────────────────────────────────────────────────────────
-- Supabase 는 함수를 만들 때 anon·authenticated 에 명시 GRANT 를 주므로 public 과 함께 셋 다 회수한다.
revoke execute on function public.enqueue_space_activity_notifications(uuid, uuid, uuid, text, jsonb)
  from public, anon, authenticated;
revoke execute on function public.cleanup_notifications_queue()
  from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) space_members 쓰기 검사
-- ─────────────────────────────────────────────────────────────────────────────

-- 생성자 본인이 «방금 만든, 아직 멤버가 0명인» Space 에 자신을 owner 로 넣을 수 있는지 판정한다.
--
-- 파라미터: p_space — 대상 Space id
-- 반환: true = spaces.created_by 가 호출자이고 그 Space 에 멤버 행이 하나도 없음
-- 주의: SECURITY DEFINER 인 이유 — 호출자는 RLS 때문에 자기가 속하지 않은 Space 의 멤버 행을 못 본다.
--       판정 대상이 «호출자가 만든 Space» 로 한정되므로 남의 Space 정보는 새지 않는다.
create or replace function public.can_claim_space_owner(p_space uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
           select 1 from public.spaces s
           where s.id = p_space and s.created_by = auth.uid()
         )
     and not exists (
           select 1 from public.space_members m
           where m.space_id = p_space
         );
$$;

-- 트리거(호출자 권한으로 실행)에서 부르므로 authenticated 만 남긴다.
revoke execute on function public.can_claim_space_owner(uuid) from public, anon;
grant execute on function public.can_claim_space_owner(uuid) to authenticated;

-- space_members BEFORE INSERT/UPDATE 검사 트리거 함수.
--
-- 🔴 일부러 SECURITY INVOKER(기본값)다.
--    current_user 로 «클라이언트가 직접 쓴 것인가»를 가려야 하기 때문이다.
--    - PostgREST 로 들어온 사용자 요청        → current_user = authenticated / anon → 검사
--    - Edge Function(service_role)·마이그레이션 → current_user = service_role / postgres → 통과
--    - merge_account 같은 SECURITY DEFINER 함수 안 → current_user = 함수 소유자(postgres) → 통과
--      (그 함수들은 자체 검사를 갖고 있고, 멤버십의 user_id 를 옮겨야 한다)
--    SECURITY DEFINER 로 만들면 current_user 가 항상 소유자가 되어 이 구분이 사라진다.
--
-- 반환: NEW(통과) — 위반 시 42501(insufficient_privilege) 예외
create or replace function public.guard_space_member_changes()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- 클라이언트 역할이 아니면 검사하지 않는다(위 주석 참고).
  if current_user not in ('authenticated', 'anon') then
    return NEW;
  end if;

  if TG_OP = 'INSERT' then
    -- 가입 행은 member 만. owner 는 «생성 직후 생성자 본인» 한 경우만 허용(space/crud.ts createSpace).
    if NEW.role is distinct from 'member'
       and not (
         NEW.role = 'owner'
         and NEW.user_id = auth.uid()
         and public.can_claim_space_owner(NEW.space_id)
       ) then
      raise exception 'space_members.role must be member on join'
        using errcode = '42501';
    end if;
    return NEW;
  end if;

  -- UPDATE: 멤버십을 다른 Space·다른 사용자로 옮길 수 없다.
  if NEW.space_id is distinct from OLD.space_id
     or NEW.user_id is distinct from OLD.user_id then
    raise exception 'space_members.space_id/user_id cannot be changed'
      using errcode = '42501';
  end if;

  -- role 변경은 그 Space 의 현재 owner 만(위임·강등 흐름은 owner 가 호출한다).
  if NEW.role is distinct from OLD.role
     and not public.is_space_owner(auth.uid(), OLD.space_id) then
    raise exception 'only the space owner can change member roles'
      using errcode = '42501';
  end if;

  return NEW;
end;
$$;

drop trigger if exists space_members_guard_changes on public.space_members;
create trigger space_members_guard_changes
  before insert or update on public.space_members
  for each row execute function public.guard_space_member_changes();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) RLS 도우미 — 호출자 본인에 대해서만 답한다
-- ─────────────────────────────────────────────────────────────────────────────
-- create or replace 는 기존 GRANT 를 유지한다. 시그니처·반환형은 그대로라 정책은 다시 만들 필요가 없다.
-- auth.uid() 가 null(비로그인)이면 비교가 null → 빈 결과/false 다.

-- 사용자 p_user_id 가 속한 Space id 목록(본인 것만).
create or replace function public.get_member_space_ids(p_user_id uuid)
returns table(space_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select sm.space_id
  from public.space_members sm
  where sm.user_id = p_user_id
    and p_user_id = auth.uid();
$$;

-- 사용자 p_user_id 와 같은 Space 에 있는 멤버 id 목록(본인 것만). 076 에서 search_path 고정 추가.
create or replace function public.get_space_member_ids(p_user_id uuid)
returns table(user_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select sm2.user_id
  from public.space_members sm1
  join public.space_members sm2 on sm1.space_id = sm2.space_id
  where sm1.user_id = p_user_id
    and p_user_id = auth.uid();
$$;

-- p_user 가 p_space 의 owner 인지(본인 것만).
create or replace function public.is_space_owner(p_user uuid, p_space uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.space_members
    where space_id = p_space
      and user_id  = p_user
      and role     = 'owner'
      and p_user   = auth.uid()
  );
$$;

-- p_user_id 가 일정 p_event_id 의 작성자인지(본인 것만).
create or replace function public.user_owns_event(p_event_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.events
    where id = p_event_id
      and user_id = p_user_id
      and p_user_id = auth.uid()
  );
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) event_shares INSERT — 내 일정을 «내가 속한» Space 에만 공유
-- ─────────────────────────────────────────────────────────────────────────────
alter policy event_shares_insert_owner on public.event_shares
  with check (
    public.user_owns_event(event_id, auth.uid())
    and space_id in (select g.space_id from public.get_member_space_ids(auth.uid()) g)
  );

reset lock_timeout;

-- ─────────────────────────────────────────────────────────────────────────────
-- 되돌리기 (필요할 때만 수동 실행 — 076 이전 정의)
-- ─────────────────────────────────────────────────────────────────────────────
-- alter policy event_shares_insert_owner on public.event_shares
--   with check (public.user_owns_event(event_id, auth.uid()));
--
-- create or replace function public.user_owns_event(p_event_id uuid, p_user_id uuid)
-- returns boolean language sql stable security definer set search_path = public as $$
--   select exists (select 1 from public.events where id = p_event_id and user_id = p_user_id);
-- $$;
--
-- create or replace function public.is_space_owner(p_user uuid, p_space uuid)
-- returns boolean language sql stable security definer set search_path = public as $$
--   select exists (select 1 from public.space_members
--                  where space_id = p_space and user_id = p_user and role = 'owner');
-- $$;
--
-- create or replace function public.get_space_member_ids(p_user_id uuid)
-- returns table(user_id uuid) language sql stable security definer as $$
--   select sm2.user_id from public.space_members sm1
--   join public.space_members sm2 on sm1.space_id = sm2.space_id
--   where sm1.user_id = p_user_id;
-- $$;
-- alter function public.get_space_member_ids(uuid) reset search_path;
--
-- create or replace function public.get_member_space_ids(p_user_id uuid)
-- returns table(space_id uuid) language sql stable security definer set search_path = public as $$
--   select sm.space_id from public.space_members sm where sm.user_id = p_user_id;
-- $$;
--
-- drop trigger if exists space_members_guard_changes on public.space_members;
-- drop function if exists public.guard_space_member_changes();
-- drop function if exists public.can_claim_space_owner(uuid);
--
-- grant execute on function public.enqueue_space_activity_notifications(uuid, uuid, uuid, text, jsonb)
--   to public, anon, authenticated;
-- grant execute on function public.cleanup_notifications_queue() to public, anon, authenticated;
--
-- (protect_user_privileged_columns 는 016 정의로 다시 create or replace — email 비교 블록만 빠진다)
