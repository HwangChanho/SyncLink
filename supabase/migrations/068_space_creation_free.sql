-- 068_space_creation_free.sql
--
-- 스페이스 생성을 Pro 전용에서 **무료**로 되돌린다(065 롤백).
--
-- 배경: 065 는 스페이스 생성을 Pro 구독자로 제한했다. 그런데 스페이스는 이 앱의
-- 핵심 가치(함께 쓰는 캘린더)로 들어가는 **진입 장벽**이다. 여기서 막으면 무료
-- 사용자는 기능을 한 번도 못 써보고, 그러면 Pro 로 올라갈 이유도 생기지 않는다.
--
-- 새 방식(LEAD 결정 2026-08-13): **무료 + 보상형 광고**.
--   - 무료 사용자: 광고를 보고 생성
--   - Pro 사용자 : 광고 없이 생성
-- 광고 게이트는 **클라이언트**에 둔다. 서버에서 강제하려면 "광고를 봤다"는 증표를
-- 신뢰해야 하는데, AdMob SSV 는 비동기라 생성 시점에 확인할 수 없다. 우회 가능성은
-- 있지만 손해가 광고 노출 1회뿐이라 그 비용을 감수한다.

-- ⚠️ 트리거 이름은 065 의 것을 그대로 써야 한다: trg_enforce_space_creation_pro.
--    (이름을 추측했다가 drop 이 안 먹어 함수 drop 이 의존성 오류로 실패했다.)
drop trigger if exists trg_enforce_space_creation_pro on public.spaces;
drop function if exists public.enforce_space_creation_pro();

-- 🔴 검증 메모: 이 트리거는 `raise exception 'PRO_REQUIRED: ...'` 로 막고 있었다.
--    클라이언트(src/app/space/create.tsx)도 별도로 paywall 로 보내고 있으니
--    **양쪽을 같이 풀어야** 한다. 서버만 풀면 UI 가 여전히 막고,
--    UI 만 풀면 생성이 서버에서 실패한다.

comment on table public.spaces is
  '공유 캘린더 스페이스. 생성은 무료이며 클라이언트에서 보상형 광고로 게이팅한다(무료 사용자 한정).';
