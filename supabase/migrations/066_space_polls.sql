-- 066_space_polls.sql
--
-- Space 투표 — 모임 날짜 조율 + 일반 투표.
-- 계획: docs/plans/2026-08-08-space-poll.md
--
-- 후보(option)에 시각을 **선택적으로** 붙이는 단일 구조라 "8/15 오후 2시" 같은 날짜 투표와
-- "삼겹살 vs 치킨" 같은 일반 투표를 한 테이블로 처리한다.
--
-- 의존성:
--   001_initial_schema.sql — spaces / space_members / users / events
--   043_space_messages.sql — 멤버 기반 RLS + Realtime publication 패턴(그대로 따름)
--
-- 순수 추가형 마이그레이션이다. 기존 테이블을 변경하지 않으므로 구버전 앱은 영향받지 않는다
-- (새 테이블을 읽지 않을 뿐). 롤백은 067 에서 3개 테이블 DROP 으로 충분하다.

-- ─── 1. space_polls ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.space_polls (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id        uuid NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  created_by      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title           text NOT NULL,
  description     text,
  -- 멤버가 후보를 여러 개 고를 수 있는지. 날짜 조율은 "되는 날 전부 체크"가 기본이라 true.
  allow_multiple  boolean NOT NULL DEFAULT true,
  -- 누가 무엇을 골랐는지 UI 에서 숨길지. ⚠️ 표시 정책일 뿐 비밀투표가 아니다
  -- (서버 데이터에는 투표자가 남는다). RLS 로 가리면 "내 표"도 못 읽어 UI 가 깨진다.
  anonymous       boolean NOT NULL DEFAULT false,
  closes_at       timestamptz,                    -- NULL = 무기한
  status          text NOT NULL DEFAULT 'open',
  -- 확정된 후보. options 가 아직 없으므로 FK 는 아래에서 ALTER 로 추가한다(순환 참조).
  decided_option_id uuid,
  -- 확정 시 자동 생성된 Space 공유 일정. 재확정 시 중복 생성을 막는 멱등성 키.
  created_event_id  uuid REFERENCES public.events(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT space_polls_status_check CHECK (status IN ('open', 'closed')),
  CONSTRAINT space_polls_title_length CHECK (char_length(title) BETWEEN 1 AND 200)
);

CREATE INDEX IF NOT EXISTS space_polls_space_idx
  ON public.space_polls (space_id, created_at DESC);

COMMENT ON TABLE public.space_polls IS
  'Space 멤버 투표. 날짜 조율(후보에 시각 있음)과 일반 투표(텍스트 후보)를 함께 담는다.';

-- ─── 2. space_poll_options ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.space_poll_options (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id    uuid NOT NULL REFERENCES public.space_polls(id) ON DELETE CASCADE,
  label      text,                       -- 자유항목 텍스트
  starts_at  timestamptz,                -- 날짜 후보일 때만
  ends_at    timestamptz,
  position   int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),

  -- 빈 후보 방지 — 텍스트도 시각도 없으면 표시할 게 없다.
  CONSTRAINT space_poll_options_not_empty CHECK (label IS NOT NULL OR starts_at IS NOT NULL),
  CONSTRAINT space_poll_options_time_order CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at >= starts_at)
);

CREATE INDEX IF NOT EXISTS space_poll_options_poll_idx
  ON public.space_poll_options (poll_id, position);

-- 순환 FK: polls.decided_option_id → options.id (options 생성 후에야 걸 수 있다)
ALTER TABLE public.space_polls
  DROP CONSTRAINT IF EXISTS space_polls_decided_option_fk;
ALTER TABLE public.space_polls
  ADD CONSTRAINT space_polls_decided_option_fk
  FOREIGN KEY (decided_option_id) REFERENCES public.space_poll_options(id) ON DELETE SET NULL;

-- ─── 3. space_poll_votes ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.space_poll_votes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- poll_id 는 options 로부터 유도 가능하지만, 집계·RLS 를 단순하게 하려고 비정규화한다.
  poll_id    uuid NOT NULL REFERENCES public.space_polls(id) ON DELETE CASCADE,
  option_id  uuid NOT NULL REFERENCES public.space_poll_options(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (option_id, user_id)   -- 같은 후보 중복 투표 방지
);

CREATE INDEX IF NOT EXISTS space_poll_votes_poll_idx
  ON public.space_poll_votes (poll_id);

-- ─── 4. RLS ────────────────────────────────────────────────────────────────
ALTER TABLE public.space_polls        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.space_poll_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.space_poll_votes   ENABLE ROW LEVEL SECURITY;

-- ── polls ──
DROP POLICY IF EXISTS space_polls_select ON public.space_polls;
CREATE POLICY space_polls_select ON public.space_polls FOR SELECT
  USING (space_id IN (SELECT space_id FROM public.space_members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS space_polls_insert ON public.space_polls;
CREATE POLICY space_polls_insert ON public.space_polls FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND space_id IN (SELECT space_id FROM public.space_members WHERE user_id = auth.uid())
  );

-- 수정/삭제는 작성자 또는 Space owner.
DROP POLICY IF EXISTS space_polls_update ON public.space_polls;
CREATE POLICY space_polls_update ON public.space_polls FOR UPDATE
  USING (
    created_by = auth.uid()
    OR space_id IN (
      SELECT space_id FROM public.space_members WHERE user_id = auth.uid() AND role = 'owner'
    )
  );

DROP POLICY IF EXISTS space_polls_delete ON public.space_polls;
CREATE POLICY space_polls_delete ON public.space_polls FOR DELETE
  USING (
    created_by = auth.uid()
    OR space_id IN (
      SELECT space_id FROM public.space_members WHERE user_id = auth.uid() AND role = 'owner'
    )
  );

-- ── options ── (권한은 상위 poll 을 따라간다)
DROP POLICY IF EXISTS space_poll_options_select ON public.space_poll_options;
CREATE POLICY space_poll_options_select ON public.space_poll_options FOR SELECT
  USING (
    poll_id IN (
      SELECT p.id FROM public.space_polls p
      WHERE p.space_id IN (SELECT space_id FROM public.space_members WHERE user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS space_poll_options_write ON public.space_poll_options;
CREATE POLICY space_poll_options_write ON public.space_poll_options FOR ALL
  USING (
    poll_id IN (
      SELECT p.id FROM public.space_polls p
      WHERE p.created_by = auth.uid()
         OR p.space_id IN (
              SELECT space_id FROM public.space_members WHERE user_id = auth.uid() AND role = 'owner'
            )
    )
  )
  WITH CHECK (
    poll_id IN (
      SELECT p.id FROM public.space_polls p
      WHERE p.created_by = auth.uid()
         OR p.space_id IN (
              SELECT space_id FROM public.space_members WHERE user_id = auth.uid() AND role = 'owner'
            )
    )
  );

-- ── votes ──
DROP POLICY IF EXISTS space_poll_votes_select ON public.space_poll_votes;
CREATE POLICY space_poll_votes_select ON public.space_poll_votes FOR SELECT
  USING (
    poll_id IN (
      SELECT p.id FROM public.space_polls p
      WHERE p.space_id IN (SELECT space_id FROM public.space_members WHERE user_id = auth.uid())
    )
  );

-- 투표는 본인 것만, 멤버여야 하고, 투표가 열려 있어야 하며,
-- 후보가 그 투표에 실제로 속해 있어야 한다(교차 투표 방지).
DROP POLICY IF EXISTS space_poll_votes_insert ON public.space_poll_votes;
CREATE POLICY space_poll_votes_insert ON public.space_poll_votes FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
        FROM public.space_polls p
        JOIN public.space_members m ON m.space_id = p.space_id AND m.user_id = auth.uid()
       WHERE p.id = space_poll_votes.poll_id
         AND p.status = 'open'
         AND (p.closes_at IS NULL OR p.closes_at > now())
    )
    AND EXISTS (
      SELECT 1 FROM public.space_poll_options o
       WHERE o.id = space_poll_votes.option_id
         AND o.poll_id = space_poll_votes.poll_id
    )
  );

-- 철회도 열려 있는 동안만.
DROP POLICY IF EXISTS space_poll_votes_delete ON public.space_poll_votes;
CREATE POLICY space_poll_votes_delete ON public.space_poll_votes FOR DELETE
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.space_polls p
       WHERE p.id = space_poll_votes.poll_id
         AND p.status = 'open'
         AND (p.closes_at IS NULL OR p.closes_at > now())
    )
  );

-- ─── 5. Realtime publication ───────────────────────────────────────────────
-- 같은 테이블을 두 번 추가하면 에러라 존재 여부를 먼저 검사한다(043 선례).
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['space_polls', 'space_poll_options', 'space_poll_votes'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
