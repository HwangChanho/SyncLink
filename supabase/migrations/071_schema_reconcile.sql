-- 071_schema_reconcile.sql
--
-- 원격 DB 에만 존재하고 마이그레이션에는 없던 객체를 기록으로 되돌린다.
--
-- 배경: 2026-08-26 타입 정리 중 발견. 원격 public 스키마를 information_schema /
-- pg_catalog 로 덤프해 마이그레이션 전체 텍스트와 대조했더니, 아래 컬럼 4개와
-- 뷰 1개는 이름이 SQL 어디에도 등장하지 않았다. 대시보드 SQL 에디터로 직접
-- 만든 것으로 보인다. 그 상태로는 **`supabase db reset` 이 원격 스키마를 재현하지
-- 못한다** — 새 환경(로컬/스테이징)에서 앱이 없는 컬럼·뷰를 읽고 조용히 깨진다.
--
-- 이 파일은 **원격에 대해 사실상 no-op** 이다. 컬럼은 이미 존재하므로
-- `add column if not exists` 가 아무것도 하지 않고, 뷰는 원격의 `pg_get_viewdef`
-- 출력과 의미가 같은 정의를 그대로 옮겼다(BEGIN/ROLLBACK 으로 대조 검증함).
-- 정의는 전부 원격 실측값이다(타입·NULL 여부·기본값).
--
-- ⚠️ 이 대조는 **이름 기준 휴리스틱**이다. 기존 컬럼의 타입 변경, 인덱스, RLS 정책의
--    드리프트는 잡지 못한다. 확인한 범위: 아래 4개 컬럼을 참조하는 인덱스·제약은
--    원격에 없고, 함수 드리프트도 없다(http 확장 소속 13개는 035 가 확장을 만들고,
--    rls_auto_enable 은 Supabase 플랫폼이 만드는 이벤트 트리거다).

-- ─── space_members — v1.2.1 채팅(읽음 표시 · 알림 토글) ──────────────────────

alter table public.space_members
  add column if not exists last_read_at          timestamptz not null default now(),
  add column if not exists notifications_enabled boolean     not null default true;

comment on column public.space_members.last_read_at is
  '채팅 화면 진입 시 now() 로 갱신(spaceMessageService.markSpaceAsRead). '
  '아래 space_unread_counts 뷰가 이 값을 기준으로 안 읽은 개수를 센다.';

-- ⚠️ 이 토글은 지금 아무 효과가 없다. 앱 UI(app/space/[id].tsx)가 읽고 쓸 뿐,
--    실제 발송 경로인 trg_space_messages_inserted() 는 이 값을 보지 않는다
--    (원격 함수 본문으로 확인. 필터는 push_token / users.push_enabled 뿐).
--    끄기가 실제로 동작하게 하려면 그 트리거의 WHERE 에
--    `and coalesce(sm.notifications_enabled, true) = true` 를 더해야 한다.
--    → 알림 동작이 바뀌는 변경이라 여기서는 손대지 않는다(LEAD 판단).
comment on column public.space_members.notifications_enabled is
  '이 Space 의 채팅 알림 수신 여부(앱 토글). '
  '⚠️ 2026-08-26 현재 발송 트리거가 이 값을 참조하지 않아 실효가 없다.';

-- ─── space_messages — v1.2.1 이미지 메시지 AI 자동 태그 ──────────────────────
-- analyze-image Edge Fn 이 백그라운드로 채운다(spaceMessageService.analyzeImageMessage).
-- null = 미분석, 빈 배열 = 분석했으나 태그 없음 — 둘을 구분해야 해서 NOT NULL 이 아니다.

alter table public.space_messages
  add column if not exists tags text[];

comment on column public.space_messages.tags is
  'AI 자동 태그 1–3개(한국어). null = 미분석, 빈 배열 = 분석했으나 태그 없음.';

-- ─── users — v1.2.3 새 일정의 기본 리마인더 ──────────────────────────────────
-- app/event/create.tsx 가 새 일정 폼의 초기값으로 읽는다.

alter table public.users
  add column if not exists default_reminder_minutes integer[] not null default '{10}'::integer[];

comment on column public.users.default_reminder_minutes is
  '새 일정 생성 시 자동 적용할 리마인더(분 단위) 배열. 기본 [10] = 10분 전 1회.';

-- ─── space_unread_counts 뷰 — 스페이스별 안 읽은 메시지 수 ───────────────────
-- spaceMessageService 가 .from('space_unread_counts').eq('user_id', me) 로 조회한다.
-- 내가 보낸 메시지는 제외하고, 내 last_read_at 이후 것만 센다.
--
-- 🔴 보안 주의 — 원격 상태를 그대로 옮긴 것이라 `security_invoker` 가 **꺼져 있다**.
--    뷰 소유자(postgres)가 하위 테이블 소유자이고 두 테이블 모두 FORCE RLS 가
--    아니라서, 이 뷰는 **RLS 를 우회한다**. 즉 authenticated 면 누구나
--    `select * from space_unread_counts` 로 **모든 사용자·모든 스페이스**의
--    (space_id, user_id, 개수) 를 볼 수 있다. 앱의 .eq('user_id', me) 는
--    클라이언트 필터일 뿐 보안 경계가 아니다.
--    고치려면 아래 정의에 `with (security_invoker = true)` 를 붙이면 된다.
--    두 테이블의 SELECT 정책이 본인 행과 소속 스페이스 메시지를 허용하므로
--    배지 계산은 그대로 맞는다(정책 확인함). 다만 **접근 범위가 바뀌는 변경**이라
--    이 정합화 마이그레이션에서는 현 상태를 보존하고 별도 판단에 맡긴다.

create or replace view public.space_unread_counts as
  select
    sm.space_id,
    sm.user_id,
    count(m.id) as unread_count
  from public.space_members sm
  left join public.space_messages m
    on  m.space_id   = sm.space_id
    and m.sender_id <> sm.user_id
    and m.created_at > sm.last_read_at
  group by sm.space_id, sm.user_id;
