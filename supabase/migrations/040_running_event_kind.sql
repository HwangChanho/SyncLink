-- v1.1.2 — 러닝 event_kind 추가 + 거리/페이스 컬럼.
--
-- 사용자가 일정을 일반/헬스/러닝 3단으로 등록.
-- running 일정은 distance_km(km) + avg_pace_seconds(초/km) 입력.
-- 헬스/러닝 일정의 color 는 service layer 에서 #A1887F 로 강제 (eventService).

ALTER TYPE public.event_kind ADD VALUE IF NOT EXISTS 'running';

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS distance_km      numeric(6,2),
  ADD COLUMN IF NOT EXISTS avg_pace_seconds integer;

-- 옛 헬스 일정의 색을 신 reserved color (Material Brown 400) 로 backfill.
-- 037 까지 헬스 일정은 빨강(#E53935) 이었음. v1.1.2 부터 갈색 통일.
UPDATE public.events
   SET color = '#A1887F'
 WHERE event_kind IN ('workout', 'running');
