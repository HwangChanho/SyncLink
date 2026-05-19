-- v1.1.2 — 운동 부위 enum 세분화.
--
-- 037 의 workout_part enum 에 trapezius/thighs/calves 추가.
-- 기존 'legs' 는 backward-compat 으로 유지 (옛 데이터 표시용),
-- 신규 UI 는 thighs/calves 로 분리 저장.

ALTER TYPE public.workout_part ADD VALUE IF NOT EXISTS 'trapezius';
ALTER TYPE public.workout_part ADD VALUE IF NOT EXISTS 'thighs';
ALTER TYPE public.workout_part ADD VALUE IF NOT EXISTS 'calves';
