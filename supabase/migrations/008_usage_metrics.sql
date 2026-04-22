-- ============================================================================
-- SyncLink — Usage Metrics (AI 호출 비용 추적)
-- Migration: 008_usage_metrics.sql
-- Run AFTER: 007_event_social.sql
-- ============================================================================

-- ─── USAGE_METRICS: AI API 호출 로그 ────────────────────────────────────────
-- Edge Function (parse-event, smart-reminder, weekly-review)이 Claude API 호출 후
-- service role로 INSERT. 사용자별 일/주/월 비용 집계에 사용.
CREATE TABLE IF NOT EXISTS public.usage_metrics (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID          NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  function_name TEXT          NOT NULL,      -- 'parse-event' | 'smart-reminder' | 'weekly-review'
  model         TEXT          NOT NULL,      -- 'claude-haiku-4-5' | 'claude-sonnet-4-6'
  input_tokens  INT           NOT NULL DEFAULT 0,
  output_tokens INT           NOT NULL DEFAULT 0,
  cost_usd      NUMERIC(10,6) NOT NULL DEFAULT 0,
  called_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- 사용자별 시간순 조회용 인덱스
CREATE INDEX IF NOT EXISTS usage_metrics_user_called
  ON public.usage_metrics (user_id, called_at DESC);

-- ─── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE public.usage_metrics ENABLE ROW LEVEL SECURITY;

-- 사용자는 자신의 메트릭만 조회 가능
CREATE POLICY "usage_metrics_select_own"
  ON public.usage_metrics FOR SELECT
  USING (auth.uid() = user_id);

COMMENT ON TABLE public.usage_metrics IS
  'AI API call tracking for cost monitoring. Inserted by Edge Functions via service role.';
