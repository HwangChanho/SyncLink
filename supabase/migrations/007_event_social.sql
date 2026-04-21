-- Migration 007: event_reactions and event_comments tables
--
-- Adds social interaction layer to events:
--  - event_reactions: emoji reactions (one per user per emoji per event)
--  - event_comments: text comments (1–500 chars) with own-row RLS
--
-- RLS strategy:
--  Access is granted to:
--  (a) The event owner (events.user_id = auth.uid())
--  (b) Any space member whose space has the event shared to it via event_shares
--
-- TASK-503 (Sprint 5)

-- ─── event_reactions ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS event_reactions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  emoji      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Prevent duplicate emoji reactions from the same user on the same event
  UNIQUE (event_id, user_id, emoji)
);

-- Index for fast lookups by event (most common query pattern)
CREATE INDEX IF NOT EXISTS idx_event_reactions_event_id
  ON event_reactions(event_id);

ALTER TABLE event_reactions ENABLE ROW LEVEL SECURITY;

-- Allow read/write to: event owner OR any space member who can see the event
CREATE POLICY "event members can manage reactions" ON event_reactions
  FOR ALL
  USING (
    -- Case A: The current user owns the event
    EXISTS (
      SELECT 1 FROM events
      WHERE id = event_reactions.event_id
        AND user_id = auth.uid()
    )
    OR
    -- Case B: The current user is a member of a space the event is shared to
    EXISTS (
      SELECT 1 FROM event_shares es
      JOIN space_members sm ON sm.space_id = es.space_id
      WHERE es.event_id = event_reactions.event_id
        AND sm.user_id = auth.uid()
    )
  );

-- ─── event_comments ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS event_comments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  -- Content: 1–500 characters (enforced both here and in the service layer)
  content    TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast lookup of all comments on a given event
CREATE INDEX IF NOT EXISTS idx_event_comments_event_id
  ON event_comments(event_id);

ALTER TABLE event_comments ENABLE ROW LEVEL SECURITY;

-- SELECT and INSERT: event owner + space members (same rule as reactions)
CREATE POLICY "event members can read and create comments" ON event_comments
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM events
      WHERE id = event_comments.event_id
        AND user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM event_shares es
      JOIN space_members sm ON sm.space_id = es.space_id
      WHERE es.event_id = event_comments.event_id
        AND sm.user_id = auth.uid()
    )
  );

CREATE POLICY "event members can insert comments" ON event_comments
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND (
      EXISTS (
        SELECT 1 FROM events
        WHERE id = event_comments.event_id
          AND user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM event_shares es
        JOIN space_members sm ON sm.space_id = es.space_id
        WHERE es.event_id = event_comments.event_id
          AND sm.user_id = auth.uid()
      )
    )
  );

-- UPDATE and DELETE: own comments only
CREATE POLICY "authors can update own comments" ON event_comments
  FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "authors can delete own comments" ON event_comments
  FOR DELETE
  USING (user_id = auth.uid());

-- ─── Auto-update updated_at ───────────────────────────────────────────────────

-- Trigger to keep updated_at in sync on comment edits
CREATE OR REPLACE FUNCTION update_event_comment_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_event_comments_updated_at ON event_comments;
CREATE TRIGGER trg_event_comments_updated_at
  BEFORE UPDATE ON event_comments
  FOR EACH ROW
  EXECUTE FUNCTION update_event_comment_updated_at();
