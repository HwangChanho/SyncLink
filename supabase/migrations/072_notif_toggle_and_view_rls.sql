-- 072_notif_toggle_and_view_rls.sql
--
-- 071 정합화 과정에서 드러난 두 가지를 고친다. 둘 다 **동작이 바뀌는 변경**이라
-- 정합화(no-op) 마이그레이션과 분리했다.

-- ─── 1. 스페이스별 알림 토글을 실제로 동작하게 한다 ──────────────────────────
--
-- 문제: `space_members.notifications_enabled` 는 앱 UI(app/space/[id].tsx)가
-- 읽고 쓰기만 할 뿐, 실제 발송 경로인 이 트리거가 값을 보지 않았다.
-- 사용자가 토글을 꺼도 UI 만 꺼진 것처럼 보이고 푸시는 계속 나갔다.
--
-- 고침: 수신자 선별 WHERE 에 조건 한 줄을 더한다. 나머지 본문은 원격의
-- pg_get_functiondef 출력을 그대로 옮긴 것이다(다른 변경 없음).
--
-- coalesce 로 감싸는 이유: 컬럼이 NOT NULL default true 라 실제로는 null 이 될 수
-- 없지만, users.push_enabled 를 다루는 바로 아랫줄과 방식을 맞춰 둔다.

create or replace function public.trg_space_messages_inserted()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_sender_nick text;
  v_space_name  text;
  v_preview     text;
BEGIN
  SELECT nickname INTO v_sender_nick FROM public.users  WHERE id = NEW.sender_id;
  SELECT name     INTO v_space_name  FROM public.spaces WHERE id = NEW.space_id;
  v_preview := COALESCE(
    NULLIF(LEFT(NEW.body, 80), ''),
    CASE WHEN NEW.image_url IS NOT NULL THEN '사진' ELSE '' END
  );

  INSERT INTO public.notifications_queue (
    space_id, recipient_user_id, actor_user_id, event_id, type, payload
  )
  SELECT
    NEW.space_id,
    sm.user_id,
    NEW.sender_id,
    NULL,
    'message_received',
    jsonb_build_object(
      'space_name',     COALESCE(v_space_name, '스페이스'),
      'actor_nickname', COALESCE(v_sender_nick, '멤버'),
      'preview',        v_preview
    )
  FROM public.space_members sm
  JOIN public.users u ON u.id = sm.user_id
  WHERE sm.space_id = NEW.space_id
    AND sm.user_id <> NEW.sender_id
    AND u.push_token IS NOT NULL
    AND COALESCE(u.push_enabled, true) = true
    -- 072 추가: 이 스페이스의 알림을 끈 멤버에게는 보내지 않는다.
    AND COALESCE(sm.notifications_enabled, true) = true;

  RETURN NEW;
END;
$function$;

comment on column public.space_members.notifications_enabled is
  '이 Space 의 채팅 알림 수신 여부(앱 토글). 072 부터 trg_space_messages_inserted() 가 '
  '이 값을 실제로 반영한다 — false 면 notifications_queue 에 넣지 않는다.';

-- ─── 2. space_unread_counts 뷰가 RLS 를 따르게 한다 ─────────────────────────
--
-- 문제: 뷰에 security_invoker 가 없어 소유자(postgres) 권한으로 실행됐다.
-- 소유자가 하위 테이블의 소유자이고 두 테이블 모두 FORCE RLS 가 아니라서
-- RLS 가 우회됐다 → authenticated 면 누구나 `select * from space_unread_counts` 로
-- **모든 사용자·모든 스페이스**의 (space_id, user_id, 안 읽은 수) 를 읽을 수 있었다.
-- 앱의 `.eq('user_id', me)` 는 클라이언트 필터일 뿐 보안 경계가 아니다.
--
-- 고침: security_invoker 를 켜서 조회자 권한으로 실행하게 한다.
-- 배지 계산은 그대로 맞는다 — space_members 의 SELECT 정책이 본인 행을 허용하고,
-- space_messages 의 SELECT 정책이 소속 스페이스의 메시지를 허용하기 때문이다.
-- (적용 전후를 실제 authenticated 롤로 대조 검증했다.)

alter view public.space_unread_counts set (security_invoker = true);

comment on view public.space_unread_counts is
  '스페이스별 안 읽은 메시지 수(내가 보낸 것 제외, last_read_at 이후). '
  'security_invoker=true 라 조회자의 RLS 가 적용된다.';
