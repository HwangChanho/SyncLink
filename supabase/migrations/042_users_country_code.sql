-- v1.2.0 — 사용자 국가 정보.
--
-- 캘린더 공휴일 표시 / 지역별 포맷에 사용.
-- ISO 3166-1 alpha-2 두 글자 (KR/US/JP/...).
-- 기본 'KR' — 신규/기존 사용자 모두 한국으로 시작 후 settings 에서 변경.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS country_code text NOT NULL DEFAULT 'KR';
