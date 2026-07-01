-- 065_space_creation_pro_only.sql
--
-- 스페이스 "생성"을 Pro 전용으로 게이트한다. (참여/사용은 free 허용 — 정책: 생성만 Pro)
--   - 기존 스페이스는 이미 생성돼 있어 INSERT 가 아니므로 영향 없음 (grandfather).
--   - free 유저가 새 spaces 행을 INSERT 하려 하면 트리거가 예외를 던져 차단한다.
--   - 프론트에서도 버튼을 페이월로 우회시키지만, 이 트리거가 우회 불가한 최종 방어선.
--
-- service_role / 서버측 INSERT (엔드유저 JWT 없음 = auth.uid() IS NULL) 는 예외:
--   마이그레이션·엣지함수·관리도구가 스페이스를 만들 수 있어야 하므로 게이트하지 않는다.
--
-- 판정 기준: users.subscription_plan = 'pro' (서버 authoritative — RevenueCat 웹훅/LEAD 갱신).

create or replace function public.enforce_space_creation_pro()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_plan text;
begin
  -- 서버측(service_role) INSERT 는 게이트 예외.
  if auth.uid() is null then
    return new;
  end if;

  -- 생성자의 구독 플랜 조회 (NULL = free 취급).
  select subscription_plan into v_plan
  from users
  where id = new.created_by;

  if coalesce(v_plan, 'free') <> 'pro' then
    -- 프론트(create.tsx)가 이 메시지의 'PRO_REQUIRED' 를 감지해 페이월로 유도한다.
    raise exception 'PRO_REQUIRED: space creation requires a Pro subscription'
      using errcode = 'check_violation', hint = 'upgrade_to_pro';
  end if;

  return new;
end;
$$;

-- 재적용 안전하도록 기존 트리거 제거 후 재생성.
drop trigger if exists trg_enforce_space_creation_pro on public.spaces;
create trigger trg_enforce_space_creation_pro
  before insert on public.spaces
  for each row
  execute function public.enforce_space_creation_pro();
