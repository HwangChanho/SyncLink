-- 063_event_relative_date.sql
--
-- LEAD 2026-06-13 — "발급일로부터 며칠 뒤", "택배 시키면 며칠 뒤 도착예상"
-- 처럼 기준일 + N일 오프셋으로 일정을 만들고 D-day 로 보고 싶다 (상대일 일정).
--
-- events 테이블에 상대일 메타데이터 3컬럼 추가 (모두 nullable — 기존 일정은
-- base_date IS NULL = 일반 일정이라 동작 변화 없음).
--   - base_date    : 기준일 (발급일/주문일). NULL 이면 일반 일정.
--   - offset_days  : 기준일로부터 +N일. start_at 은 (base_date + offset_days) 로
--                    미리 계산해 저장하므로 캘린더/반복/알림 로직은 그대로 동작.
--                    base_date/offset_days 는 D-day 표시·재편집을 위해 함께 보관.
--   - offset_label : "도착예상"/"수령"/"만료" 등 표시용 라벨.
--
-- D-day 값(오늘 대비 남은 일수)은 매일 바뀌므로 저장하지 않고 앱에서 지연 계산
-- 한다 (Anniversary.daysFromToday 와 동일한 패턴).
--
-- 롤백:
--   ALTER TABLE events DROP COLUMN IF EXISTS offset_label;
--   ALTER TABLE events DROP COLUMN IF EXISTS offset_days;
--   ALTER TABLE events DROP COLUMN IF EXISTS base_date;
--
-- RLS: events 의 기존 행-소유자 정책이 그대로 적용된다 (컬럼 추가는 정책 무관).

BEGIN;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS base_date    date,
  ADD COLUMN IF NOT EXISTS offset_days  integer,
  ADD COLUMN IF NOT EXISTS offset_label text;

-- offset_days 범위 가드: 0..3650 (오늘/기준일 당일 ~ 약 10년). 음수(기준일 이전)는
-- 현재 use case(발급일+N·도착예상)에 불필요하므로 제외. 필요 시 후속 마이그레이션에서 완화.
ALTER TABLE events
  DROP CONSTRAINT IF EXISTS events_offset_days_range;
ALTER TABLE events
  ADD CONSTRAINT events_offset_days_range
  CHECK (offset_days IS NULL OR (offset_days >= 0 AND offset_days <= 3650));

COMMIT;
