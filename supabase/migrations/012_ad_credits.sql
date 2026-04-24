-- 012_ad_credits.sql
--
-- Add per-user ad-earned AI credit balance + audit log for AdMob SSV callbacks.
-- AI 일일 무료 쿼터(AsyncStorage)는 기존 유지. ai_ad_credits는 광고 시청으로
-- 지급된 누적 크레딧으로, 쿼터 소진 후 1개씩 차감해 AI 호출을 허용.
--
-- Sprint 14 TASK-1401

alter table public.users
  add column if not exists ai_ad_credits int not null default 0;

-- Audit log for SSV callbacks — one row per successful reward verification.
create table if not exists public.ad_reward_logs (
  id             uuid        primary key default gen_random_uuid(),
  user_id        uuid        not null references public.users(id) on delete cascade,
  ad_network     text        not null default 'admob',
  ad_unit        text        not null,
  reward_item    text        not null,  -- 'ai_credit'
  reward_amount  int         not null,  -- 2 per our policy
  transaction_id text        not null,  -- AdMob SSV transaction_id
  custom_data    text,                  -- optional debug payload
  created_at     timestamptz not null default now(),
  unique (transaction_id)               -- prevent duplicate grants
);

create index if not exists ad_reward_logs_user_created
  on public.ad_reward_logs (user_id, created_at desc);

alter table public.ad_reward_logs enable row level security;

-- Users can SELECT their own reward history (for UI stats).
-- Only the service role (SSV Edge Function) may INSERT — no policy for insert
-- means regular clients are denied.
drop policy if exists "ad_reward_logs_select_own" on public.ad_reward_logs;
create policy "ad_reward_logs_select_own"
  on public.ad_reward_logs for select
  using (auth.uid() = user_id);
