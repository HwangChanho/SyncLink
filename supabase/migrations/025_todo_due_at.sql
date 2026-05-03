-- 025_todo_due_at.sql
--
-- LEAD 2026-05-03 — "할일에 시간도 입력받고 마찬가지로 달력에 노출,
-- 시간 입력 안 된 건 캘린더 주에서 위에 뜨는데 이걸 기본 1시간 기준
-- 으로 드래그해서 옮길 수 있게".
--
-- todos 테이블에 due_at timestamptz 컬럼 추가. 기존 due_date (date)
-- 와 공존:
--   - 시간 없는 todo: due_date 만 set, due_at NULL
--   - 시간 있는 todo: due_at 만 set, due_date 는 due_at::date 로 채워둠
--                     (날짜 기반 쿼리/필터 호환 위해)
--
-- 클라이언트는 due_at 우선 → 없으면 due_date 사용.
-- migration 미적용 환경 호환을 위해 client 가 conditional spread
-- (Build-57 repeat_weekdays 패턴 동일).
--
-- 롤백: ALTER TABLE todos DROP COLUMN due_at;

BEGIN;

ALTER TABLE todos
  ADD COLUMN IF NOT EXISTS due_at timestamptz;

COMMENT ON COLUMN todos.due_at IS
  'When NULL → no time component; when set, use this. due_date is kept in sync (= due_at::date) for backward-compat queries.';

CREATE INDEX IF NOT EXISTS idx_todos_due_at
  ON public.todos (due_at)
  WHERE due_at IS NOT NULL;

COMMIT;
