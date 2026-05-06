-- 030_find_space_by_invite_code.sql
--
-- Fix: 외부 사용자가 초대 코드로 Space 참여 시도 시 spaces 조회가 RLS 에
-- 의해 0 row 반환 → "유효하지 않은 초대 코드" 메시지.
--
-- 기존 SELECT 정책 (002 spaces_select_member, 017 spaces_select_creator)
-- 모두 본인이 멤버/owner 일 때만 허용 → 새로 참여하려는 사용자가 락아웃.
--
-- 해결: SECURITY DEFINER RPC 함수 `find_space_by_invite_code(code)` 를
-- 통해 service_role 권한으로 spaces 1 row 만 안전하게 조회. 인증된
-- 사용자만 호출 가능 (auth.uid() 검증). RLS 정책 자체는 그대로 두어
-- 다른 경로에서의 무차별 select 를 막는다.
--
-- 클라이언트 변경: spaceService.joinSpaceByInviteCode 가
--   supa.from('spaces').select(...) 대신 supa.rpc('find_space_by_invite_code', { code })
--   로 호출.

create or replace function public.find_space_by_invite_code(code text)
returns setof public.spaces
language plpgsql
security definer
-- search_path 고정 — SECURITY DEFINER 는 항상 명시 (Supabase 보안 권장)
set search_path = public, pg_temp
as $$
begin
  -- 인증된 사용자만 호출. 익명 호출은 spaces 노출 위험.
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  -- invite_code 정규화 (대문자) 후 단일 row 반환.
  return query
    select *
    from public.spaces
    where invite_code = upper(code)
    limit 1;
end;
$$;

-- 인증된 사용자에게 실행 권한 부여 (anon 은 거부됨).
grant execute on function public.find_space_by_invite_code(text)
  to authenticated;

-- service_role 도 명시적으로 (Edge Function 등에서 호출 시).
grant execute on function public.find_space_by_invite_code(text)
  to service_role;
