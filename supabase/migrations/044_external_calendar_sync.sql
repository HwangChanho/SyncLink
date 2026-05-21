-- Migration 044 — 외부 캘린더 sync (Google 1차, Apple 다음 sprint)
--
-- 목적:
--  - events 테이블에 origin/external_* 컬럼 추가해 native 일정과 외부 mirror
--    구분.
--  - google_oauth_tokens 테이블 신설. user 별 refresh_token + access_token
--    만료 시각 관리.
--  - external_sync_log — 디버깅용 sync 시도 기록 (성공/실패/이벤트 수). pg_cron
--    으로 30일 후 자동 정리.
--
-- 보안:
--  - refresh_token 은 RLS 로만 보호 (service_role 만 SELECT/INSERT/UPDATE).
--    user 본인도 token 자체는 못 봄 (메타데이터 view 만 별도 필요 시 추가).
--  - pgsodium 컬럼 암호화는 향후 hardening 으로 미룸 (Supabase managed key
--    rotation 운영 부담).
--
-- 사전 조건: 041 (event_images) 이후. RLS 활성 패턴 동일.

-- ─── 1. events 컬럼 확장 ──────────────────────────────────────────────────

CREATE TYPE public.event_origin AS ENUM ('native', 'google', 'apple');

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS origin                  public.event_origin NOT NULL DEFAULT 'native',
  ADD COLUMN IF NOT EXISTS external_source         text,
  ADD COLUMN IF NOT EXISTS external_id             text,
  ADD COLUMN IF NOT EXISTS external_etag           text,
  ADD COLUMN IF NOT EXISTS external_last_synced_at timestamptz;

-- 같은 (user, external_source, external_id) 조합 중복 import 방지.
-- external 컬럼이 모두 채워졌을 때만 unique 검사 (partial index).
CREATE UNIQUE INDEX IF NOT EXISTS uq_events_external_id
  ON public.events (user_id, external_source, external_id)
  WHERE external_source IS NOT NULL AND external_id IS NOT NULL;

COMMENT ON COLUMN public.events.origin IS
  'Event 출처. native = SyncDay 내부 생성. google/apple = 외부 캘린더에서 import. external_* 컬럼이 채워진 경우 origin != native.';

-- ─── 2. google_oauth_tokens — refresh token 보관 ────────────────────────

CREATE TABLE IF NOT EXISTS public.google_oauth_tokens (
  user_id                  uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  refresh_token            text NOT NULL,
  access_token             text,
  access_token_expires_at  timestamptz,
  scope                    text NOT NULL DEFAULT 'https://www.googleapis.com/auth/calendar.readonly',
  email                    text,                       -- Google 계정 email (멀티 account 대비 표시용)
  connected_at             timestamptz NOT NULL DEFAULT now(),
  last_sync_at             timestamptz,
  last_sync_error          text,
  -- 동일 user 가 여러 Google 계정 연결할 수 있도록 향후 확장 시 PK 변경 예정.
  -- Sprint 1 은 user 당 1개 계정 limit.
  CHECK (char_length(refresh_token) > 0)
);

COMMENT ON TABLE public.google_oauth_tokens IS
  'Google Calendar OAuth refresh_token + access_token cache. user 당 1개 (Sprint 1). user 본인도 RLS 로 직접 SELECT 불가, service_role 만 접근.';

ALTER TABLE public.google_oauth_tokens ENABLE ROW LEVEL SECURITY;

-- service_role 전용. authenticated user 도 SELECT 못 함 (token 노출 방지).
-- 사용자 표시용 메타 정보 (connected_at, last_sync_at, last_sync_error) 만
-- 필요하면 별도 view 또는 Edge Function 으로 제공.
CREATE POLICY google_oauth_tokens_service_role
  ON public.google_oauth_tokens
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 사용자 UI 가 "연결 상태" 표시할 수 있도록 메타데이터 view (RLS 우회 함수).
-- token 자체는 절대 노출 X.
CREATE OR REPLACE FUNCTION public.get_google_connection_status()
RETURNS TABLE (
  connected         boolean,
  email             text,
  connected_at      timestamptz,
  last_sync_at      timestamptz,
  last_sync_error   text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    TRUE                   AS connected,
    t.email,
    t.connected_at,
    t.last_sync_at,
    t.last_sync_error
  FROM public.google_oauth_tokens t
  WHERE t.user_id = auth.uid()
  UNION ALL
  SELECT FALSE, NULL::text, NULL::timestamptz, NULL::timestamptz, NULL::text
  WHERE NOT EXISTS (
    SELECT 1 FROM public.google_oauth_tokens WHERE user_id = auth.uid()
  )
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_google_connection_status() TO authenticated;

-- ─── 3. external_sync_log — 디버깅 + Pro 게이트 카운팅 ──────────────────

CREATE TABLE IF NOT EXISTS public.external_sync_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  source          text NOT NULL,        -- e.g. 'google:primary'
  triggered_by    text NOT NULL,        -- 'cron' | 'manual'
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  events_imported integer NOT NULL DEFAULT 0,
  events_updated  integer NOT NULL DEFAULT 0,
  events_deleted  integer NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'error', 'rate_limited')),
  error_message   text
);

CREATE INDEX IF NOT EXISTS idx_external_sync_log_user_started
  ON public.external_sync_log (user_id, started_at DESC);

ALTER TABLE public.external_sync_log ENABLE ROW LEVEL SECURITY;

-- user 본인은 자신의 sync 기록 SELECT 가능 (UI "최근 동기화" 표시용).
CREATE POLICY external_sync_log_select_own
  ON public.external_sync_log
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY external_sync_log_service_role
  ON public.external_sync_log
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 30일 지난 로그 자동 정리. pg_cron 일일 02:00 KST (17:00 UTC).
SELECT cron.schedule(
  'external-sync-log-cleanup',
  '0 17 * * *',
  $$ DELETE FROM public.external_sync_log WHERE started_at < now() - interval '30 days'; $$
)
WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'external-sync-log-cleanup');
