-- Migration 059 — 운영 알림(ops) dedup 저장 + claim 함수.
--
-- 배경: AI 크레딧 소진 등 운영 이슈를 LEAD 에게 이메일로 알릴 때, 같은 이슈로
--       수십 통이 쏟아지면 안 된다(AI 호출마다 실패하므로). alert_key 별로
--       cooldown 안에서는 1통만 보내도록 atomic claim 으로 dedup 한다.
--
-- 사용 (Edge, service_role):
--   const { data: shouldSend } = await admin.rpc('claim_ops_alert',
--     { p_key: 'ai_credit_exhausted', p_cooldown_hours: 24 });
--   if (shouldSend) { await sendAdminEmail(...); }

create table if not exists public.ops_alerts (
  alert_key    text primary key,
  last_sent_at timestamptz not null default now(),
  send_count   int not null default 1
);

comment on table public.ops_alerts is
  '운영 알림 dedup. alert_key 별 마지막 발송 시각 — claim_ops_alert 가 관리.';

-- RLS: 클라 접근 전면 차단 (service_role 만 RPC 경유).
alter table public.ops_alerts enable row level security;
revoke all on public.ops_alerts from anon, authenticated;

-- ── atomic claim ──────────────────────────────────────────────────────────
-- cooldown 안에 이미 보냈으면 false(보내지 마라), 아니면 기록하고 true.
-- upsert + 조건부 update 로 race-safe.
create or replace function claim_ops_alert(p_key text, p_cooldown_hours numeric default 24)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed boolean := false;
begin
  -- 신규 키면 insert 성공 → claim. 기존 키면 do nothing.
  insert into public.ops_alerts (alert_key)
  values (p_key)
  on conflict (alert_key) do nothing;

  if found then
    return true;  -- 처음 보내는 알림.
  end if;

  -- 기존 키 — cooldown 지났으면 update 하며 claim.
  update public.ops_alerts
     set last_sent_at = now(),
         send_count   = send_count + 1
   where alert_key = p_key
     and last_sent_at < now() - make_interval(hours => p_cooldown_hours)
  returning true into v_claimed;

  return coalesce(v_claimed, false);
end;
$$;

revoke all on function claim_ops_alert(text, numeric) from public, anon, authenticated;
-- service_role 만 (Edge Function 에서 호출). service_role 은 revoke 무관하게 실행 가능.

comment on function claim_ops_alert(text, numeric) is
  '운영 알림 dedup claim. cooldown 안에 발송 이력 있으면 false. service_role 전용.';
