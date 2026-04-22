-- ============================================================================
-- SyncDay — Push Tokens Enhancement
-- Migration: 005_push_tokens.sql
-- Run AFTER: 004_todos_enhancement.sql
-- ============================================================================

-- ─── USERS: push_enabled 컬럼 추가 ──────────────────────────────────────────
-- push_token 컬럼은 001_initial_schema.sql에 이미 존재
-- push_enabled: 사용자가 푸시 알림을 비활성화할 수 있는 마스터 스위치
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS push_enabled BOOLEAN NOT NULL DEFAULT true;

-- ─── NOTIFICATION_LOGS: 알림 이력 테이블 ────────────────────────────────────
-- smart-reminder Edge Function이 중복 발송을 방지하기 위해 참조
-- 하루 단위로 동일 (user, event, type) 조합 중복 방지 (UNIQUE on sent_at::date)

CREATE TABLE IF NOT EXISTS public.notification_logs (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  event_id          UUID        REFERENCES public.events(id) ON DELETE SET NULL,
  notification_type TEXT        NOT NULL,   -- 'reminder' | 'invite' | 'share'
  sent_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- sent_date: 중복 방지용 날짜 컬럼 (TIMESTAMPTZ::date 표현식 인덱스는 IMMUTABLE 불가)
  -- 삽입 시 애플리케이션/Edge Function이 UTC 기준 날짜를 채워야 함
  sent_date         DATE        NOT NULL DEFAULT CURRENT_DATE
);

-- 하루에 같은 (user, event, type) 조합으로 중복 발송 방지
CREATE UNIQUE INDEX IF NOT EXISTS notification_logs_daily_unique
  ON public.notification_logs (user_id, event_id, notification_type, sent_date);

COMMENT ON TABLE public.notification_logs IS
  'Push notification delivery history. Used by smart-reminder to prevent duplicate sends.';

-- ─── RLS ────────────────────────────────────────────────────────────────────

ALTER TABLE public.notification_logs ENABLE ROW LEVEL SECURITY;

-- 사용자는 자신의 알림 이력만 조회 가능 (Edge Function은 service role로 INSERT)
CREATE POLICY "notification_logs_select_own"
  ON public.notification_logs FOR SELECT
  USING (auth.uid() = user_id);
