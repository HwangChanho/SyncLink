-- Migration 010: error_logs table
--
-- 중앙 에러 로깅 인프라.
-- 서버(Edge Functions)와 클라이언트 양쪽에서 발생하는 에러를
-- 이 테이블에 기록해 LEAD가 SQL로 직접 조회해 원인을 파악한다.
--
-- 설계 포인트:
--  - INSERT 는 누구나 가능 (anon/authenticated) — 로그인 전 에러도 수집해야 하기 때문.
--  - SELECT 는 RLS 정책 없음 → authenticated/anon 모두 차단.
--    오직 service_role 키로만 조회 가능 (scripts/tail-errors.sh 참고).
--  - user_id 는 nullable + ON DELETE SET NULL — 로그인 전 에러 또는
--    계정 삭제 후에도 로그는 남겨 원인 추적이 가능하도록.

-- ─── Table ───────────────────────────────────────────────────────────────────

CREATE TABLE public.error_logs (
  -- 행 고유 ID
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 로그 기록 시각 (UTC)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- 어느 위치에서 발생한 에러인지 식별하는 문자열
  -- 예: 'kakao-auth.token-exchange', 'event.create', 'auth.kakao'
  context     TEXT        NOT NULL,
  -- 'error' | 'warn' | 'info' — 운영 대시보드 필터링 용도
  severity    TEXT        NOT NULL DEFAULT 'error',
  -- 사람이 읽을 수 있는 짧은 메시지 (Error.message 또는 String(error))
  message     TEXT        NOT NULL,
  -- 추가 디버깅 정보: stack trace, request body, 외부 API 응답 등
  details     JSONB,
  -- 에러를 유발한 유저 (없을 수 있음: 비로그인 시, 계정 삭제 후)
  user_id     UUID        REFERENCES public.users(id) ON DELETE SET NULL,
  -- 'ios' | 'android' | 'web' | 'edge-function'
  platform    TEXT,
  -- 클라이언트 버전 (Constants.expoConfig.version) — 서버는 NULL
  app_version TEXT
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────

-- 최근 N개 에러 조회 (tail-errors.sh 기본 쿼리)
CREATE INDEX idx_error_logs_created_at ON public.error_logs(created_at DESC);
-- 특정 context별 필터링 (예: 'kakao-auth.%')
CREATE INDEX idx_error_logs_context    ON public.error_logs(context);

-- ─── Row Level Security ──────────────────────────────────────────────────────

ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;

-- INSERT: anon/authenticated 모두 허용 (비로그인 에러도 수집)
CREATE POLICY "error_logs_insert_all"
  ON public.error_logs
  FOR INSERT
  WITH CHECK (true);

-- SELECT 정책을 의도적으로 생성하지 않음 → service_role 외에는 조회 불가.
-- 이로써 error_logs 테이블이 클라이언트에 노출되는 정보 누수 위험을 차단한다.
