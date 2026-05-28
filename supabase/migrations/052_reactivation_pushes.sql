-- 052_reactivation_pushes.sql
-- 비활성 사용자 (가입 후 7일 이상 + 최근 활동 없음) 재참여 푸시 발송 이력.
-- pg_cron 매일 호출하는 reactivation-push Edge Function 이 같은 사용자에게
-- 단기간에 반복 발송하지 않도록 14일 cooldown 체크용.

create table if not exists public.reactivation_pushes (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  sent_at      timestamptz not null default now(),
  status       text not null default 'ok',  -- 'ok' | 'error' | 'no_token'
  error_message text
);

create index if not exists idx_reactivation_pushes_user_recent
  on public.reactivation_pushes (user_id, sent_at desc);

-- RLS: 사용자는 자기 발송 이력만 read (관리자는 service_role 로 우회).
alter table public.reactivation_pushes enable row level security;

create policy "reactivation_pushes_select_self"
  on public.reactivation_pushes for select
  using (auth.uid() = user_id);

-- INSERT 는 Edge Function (service_role) 만. anon/authenticated 차단.
revoke insert on public.reactivation_pushes from anon, authenticated;

comment on table public.reactivation_pushes is
  '재참여 푸시 발송 이력. user_id 당 14일 cooldown 체크용.';
