-- 024_event_repeat_weekdays.sql
--
-- LEAD 2026-05-03 — "반복 일정에 매일 매주 매월 매년 말고 특정 요일만
-- 반복되게 설정도 되면 좋겠어".
--
-- repeat_type enum 에 'custom_weekly' 값 추가 + repeat_weekdays smallint[]
-- 컬럼 추가. weekday 값 0=일, 1=월, … 6=토 (JS Date.getDay() 호환).
--
-- - 'custom_weekly' 일 때만 repeat_weekdays 가 의미 있음. 다른 repeat_type
--   에서는 NULL 또는 빈 배열을 허용 (CHECK 제약).
-- - 길이 0 의 custom_weekly 는 repeat_type='none' 과 동일 의미라 클라이언트
--   레벨에서 폼 검증으로 막는다 (DB 는 허용).
--
-- 롤백:
--   ALTER TYPE repeat_type 에서 값 제거는 PG 가 직접 지원하지 않으므로
--   v1.x 에서 'custom_weekly' 가 더 이상 쓰이지 않게 되면 enum 을
--   recreate (drop+create+migrate 데이터) 해야 한다. 이번 단계에선 추가만.

BEGIN;

-- ── 1. enum 확장 ────────────────────────────────────────────────────────────
ALTER TYPE repeat_type ADD VALUE IF NOT EXISTS 'custom_weekly';

-- ── 2. 컬럼 추가 ────────────────────────────────────────────────────────────
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS repeat_weekdays smallint[];

-- ── 3. CHECK 제약 ──────────────────────────────────────────────────────────
-- weekday 값 범위 (0..6) + 길이 0 또는 NULL 허용 (custom_weekly 가 아닌 경우)
ALTER TABLE events
  DROP CONSTRAINT IF EXISTS events_repeat_weekdays_range;
ALTER TABLE events
  ADD CONSTRAINT events_repeat_weekdays_range
  CHECK (
    repeat_weekdays IS NULL OR (
      array_length(repeat_weekdays, 1) IS NULL OR (
        array_length(repeat_weekdays, 1) <= 7
        AND repeat_weekdays <@ ARRAY[0,1,2,3,4,5,6]::smallint[]
      )
    )
  );

COMMIT;
