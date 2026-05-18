-- v1.2 Phase 4 — 자동 주간 회고
--
-- 매주 일요일 21:00 KST (UTC 12:00) 에 `weekly-review-batch` Edge Fn 을 호출.
-- Edge Fn 이 모든 활성 사용자에 대해 weekly-review 로직을 1회씩 수행하고
-- 결과를 weekly_reviews 테이블에 저장 + Expo push notification 전송.
--
-- 의존성:
--   - pg_cron extension (Supabase 기본 활성)
--   - http extension (Edge Fn 호출용)
--   - app.settings.weekly_review_secret (Edge Fn 인증용)
--   - app.settings.supabase_url (Edge Fn 호스트)

-- ─── 0) 확장 ───────────────────────────────────────────────────────────────────
create extension if not exists pg_cron;
create extension if not exists http;

-- ─── 1) 결과 저장 테이블 ────────────────────────────────────────────────────────
create table if not exists public.weekly_reviews (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  week_start  date not null,
  week_end    date not null,
  summary     text not null,
  highlights  jsonb default '[]'::jsonb,
  created_at  timestamptz not null default now(),

  unique (user_id, week_start)
);

create index if not exists weekly_reviews_user_idx on public.weekly_reviews (user_id, created_at desc);

alter table public.weekly_reviews enable row level security;

create policy weekly_reviews_owner_read on public.weekly_reviews
  for select using (auth.uid() = user_id);

-- INSERT 는 service_role 만 (Edge Fn 배치) — 정책 없으면 막힌다.
create policy weekly_reviews_service_write on public.weekly_reviews
  for insert with check (false);  -- anon/authenticated 차단. service_role 은 RLS 통과.

-- ─── 2) Cron schedule ──────────────────────────────────────────────────────────
-- 매주 일요일 12:00 UTC = 21:00 KST. pg_cron 은 UTC 기준.
-- 기존 동명 job 있으면 schedule 만 갱신.
select cron.schedule(
  'auto-weekly-review',
  '0 12 * * 0',  -- 일요일 12:00 UTC
  $$
  select net.http_post(
    url := current_setting('app.settings.supabase_url', true) || '/functions/v1/weekly-review-batch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.weekly_review_secret', true)
    ),
    body := '{}'::jsonb
  );
  $$
);
