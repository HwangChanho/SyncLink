-- Migration 055 — 계정 통합 후보 탐지 RPC (Phase B).
--
-- 목적: 현재 로그인한 사용자와 "동일 이메일"을 가진 다른 계정을 찾아
--       통합 후보로 제시한다. Pro 계정을 primary 추천 근거로 plan 도 함께 반환.
--
-- 보안 설계 (중요):
--   - SECURITY DEFINER 지만, 이메일을 파라미터로 받지 않는다.
--   - auth.uid() 로 호출자를 식별 → 호출자 본인의 이메일을 서버에서 조회 →
--     그 이메일과 "정확히 일치"하는 다른 user 만 반환.
--   - 따라서 임의 이메일로 타인 계정을 탐색하는 것이 원천 불가능.
--   - 이메일이 null/빈 값이면 후보 없음 (카카오 등 이메일 미제공 케이스).
--   - 본인(self) 은 결과에서 제외.
--
-- 반환: jsonb 배열
--   [{ user_id, email, nickname, plan, created_at }]
--   plan = 'pro' | 'free' (primary 추천: pro 를 우선)

create or replace function get_account_merge_candidates()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid;
  v_email text;
  result  jsonb;
begin
  -- 1) 호출자 식별 (인증된 세션 필수).
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'authentication required';
  end if;

  -- 2) 호출자 본인의 이메일 조회 (파라미터로 받지 않음 → 타인 탐색 차단).
  select email into v_email from public.users where id = v_uid;

  -- 이메일이 없으면(카카오 등) 자동 후보 탐지 불가 → 빈 배열.
  if v_email is null or btrim(v_email) = '' then
    return '[]'::jsonb;
  end if;

  -- 3) 동일 이메일(대소문자 무시) + 본인 제외 → 후보.
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'user_id',    u.id,
        'email',      u.email,
        'nickname',   u.nickname,
        'plan',       coalesce(u.subscription_plan, 'free'),
        'created_at', u.created_at
      )
      order by
        -- Pro 후보를 먼저 (primary 추천), 그다음 오래된 계정 우선.
        case when coalesce(u.subscription_plan, 'free') = 'pro' then 0 else 1 end,
        u.created_at asc
    ),
    '[]'::jsonb
  )
  into result
  from public.users u
  where lower(u.email) = lower(v_email)
    and u.id <> v_uid;

  return result;
end;
$$;

-- 인증 사용자만 호출 (anon 차단). 본인 이메일 범위로만 동작하므로 안전.
revoke all on function get_account_merge_candidates() from public;
grant execute on function get_account_merge_candidates() to authenticated;

comment on function get_account_merge_candidates() is
  '계정 통합 후보(동일 이메일) 탐지. 호출자 본인 이메일 기준만, 타인 탐색 불가. Pro 우선 정렬.';
