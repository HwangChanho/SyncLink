-- Migration 051 — admin_login 의 raise exception → jsonb 응답 으로 변경.
--
-- 배경:
--   050 의 admin_login 은 fail 시 `raise exception` 으로 응답했다. 그런데
--   PostgreSQL 의 raise exception 은 transaction rollback 을 트리거 →
--   같은 함수 안의 `insert into admin_login_attempts (..., false)` 도 함께
--   rollback. 결과적으로 fail attempts 가 누적되지 않아 rate limit (5 fail/
--   5min) 가 작동하지 않았다.
--
-- 수정:
--   raise 없이 jsonb 로 { ok: false, reason: '...' } 반환. transaction 은
--   정상 commit 되어 attempts insert 가 보존됨. 클라이언트는 reason 으로
--   에러 분기.
--
--   성공 시: { ok: true, token, expires_at, username }
--   실패 시: { ok: false, reason: 'too_many_attempts' | 'invalid_credentials' }

create or replace function admin_login(
  p_username   text,
  p_password   text,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fail_count int;
  v_verified   boolean;
  v_token      text;
  v_expires    timestamptz;
begin
  -- Rate limit.
  select count(*) into v_fail_count
  from admin_login_attempts
  where username = p_username
    and success  = false
    and attempted_at >= now() - interval '5 minutes';

  if v_fail_count >= 5 then
    insert into admin_login_attempts (username, success, user_agent)
    values (p_username, false, p_user_agent);
    return jsonb_build_object('ok', false, 'reason', 'too_many_attempts');
  end if;

  -- Credentials 검증.
  select exists (
    select 1 from admin_credentials
    where username      = p_username
      and password_hash = extensions.crypt(p_password, password_hash)
  ) into v_verified;

  if not v_verified then
    insert into admin_login_attempts (username, success, user_agent)
    values (p_username, false, p_user_agent);
    return jsonb_build_object('ok', false, 'reason', 'invalid_credentials');
  end if;

  -- 성공 — 토큰 발급.
  insert into admin_login_attempts (username, success, user_agent)
  values (p_username, true, p_user_agent);

  v_token   := encode(extensions.gen_random_bytes(32), 'hex');
  v_expires := now() + interval '10 hours';

  insert into admin_sessions (token, username, expires_at, user_agent)
  values (v_token, p_username, v_expires, p_user_agent);

  return jsonb_build_object(
    'ok',         true,
    'token',      v_token,
    'expires_at', v_expires,
    'username',   p_username
  );
end;
$$;

comment on function admin_login(text, text, text) is
  '관리자 로그인. 성공/실패 모두 jsonb { ok: bool, ... } 반환 (transaction commit 보존).';
