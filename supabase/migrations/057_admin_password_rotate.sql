-- Migration 057 — admin 비밀번호 회전(rotate) 도구 + 047 평문 제거 후속.
--
-- 배경: 초기 admin 비번이 047 에 평문으로 노출됐었음. 레포 public 전환 전
--       실제 비번을 강한 임의 값으로 교체(rotate)해 과거 노출분을 무효화한다.
--
-- 이 마이그레이션은 **평문을 담지 않는다**. 대신 service_role 전용 setter RPC
-- 를 만들고, 실제 새 비번은 배포 후 셸에서 1회 호출로 주입한다(파일/히스토리에
-- 평문 안 남김). 호출 후 RPC 는 남겨둬도 service_role 만 실행 가능.

create or replace function admin_set_password(p_username text, p_new_password text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  update admin_credentials
     set password_hash = extensions.crypt(p_new_password, extensions.gen_salt('bf'))
   where username = p_username;
  if not found then
    raise exception 'admin user not found: %', p_username;
  end if;
end;
$$;

-- anon/authenticated 차단 — service_role 만 (서버 측 비번 회전 도구).
revoke all on function admin_set_password(text, text) from public, anon, authenticated;

comment on function admin_set_password(text, text) is
  'admin 비번 회전(service_role 전용). 평문은 호출 인자로만 받고 bcrypt 해시로 저장.';
