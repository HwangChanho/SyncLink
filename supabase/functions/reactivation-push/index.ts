/**
 * reactivation-push Edge Function — v1.3.0
 *
 * 비활성 사용자에게 재참여 푸시 발송.
 *
 * 대상 조건 (모두 충족):
 *   1. 가입 (auth.users.created_at) 후 7일 이상 경과
 *   2. 최근 7일 이내 events 생성 0건 (활동 없음)
 *   3. users.push_token 보유
 *   4. reactivation_pushes 에 최근 14일 발송 이력 없음 (cooldown)
 *
 * 메시지:
 *   title: "AI 비서가 기다리고 있어요"
 *   body: "한 줄 자연어로 일정을 등록해 보세요. 1초면 충분해요."
 *
 * 호출 방식:
 *   - pg_cron 이 매일 KST 18:00 (09:00 UTC) 에 호출
 *   - 또는 LEAD 가 수동 트리거 (admin endpoint 미지원, service_role JWT 필요)
 *
 * Security:
 *   - service_role 토큰만 허용. anon/authenticated 거부.
 *   - DRY_RUN=true 환경변수 시 실제 발송 대신 list 만 반환.
 */

import { createClient } from 'npm:@supabase/supabase-js';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const INACTIVE_DAYS = 7;
const COOLDOWN_DAYS = 14;

interface ExpoPushTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
}

interface ExpoPushResponse {
  data?: ExpoPushTicket | ExpoPushTicket[];
  errors?: Array<{ message: string }>;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  // service_role 인증 확인 — pg_cron 도 service_role 토큰으로 호출.
  const authHeader = req.headers.get('Authorization') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!authHeader.includes(serviceKey)) {
    return new Response(JSON.stringify({ error: 'service_role_required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const dryRun = Deno.env.get('DRY_RUN') === 'true';

  const sb = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    serviceKey,
  );

  const now = Date.now();
  const cutoffSignup = new Date(now - INACTIVE_DAYS * 24 * 3600 * 1000).toISOString();
  const cutoffActivity = cutoffSignup;
  const cutoffCooldown = new Date(now - COOLDOWN_DAYS * 24 * 3600 * 1000).toISOString();

  // 1. 가입 7일+ 사용자 + push_token 보유 사용자 후보 fetch.
  //    auth.users + users (push_token) JOIN 은 RPC 가 깔끔하지만 단일 쿼리로
  //    처리: users 테이블의 created_at 이 auth.users 와 동기화돼 있다고 가정
  //    (서비스 초기 트리거가 둘을 함께 채움). 안 그러면 listUsers 로 우회.
  const { data: candidates, error: candErr } = await sb
    .from('users')
    .select('id, push_token, created_at')
    .not('push_token', 'is', null)
    .lt('created_at', cutoffSignup);

  if (candErr) {
    return new Response(JSON.stringify({ error: candErr.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!candidates || candidates.length === 0) {
    return new Response(JSON.stringify({ ok: true, candidates: 0, sent: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const targetUserIds: string[] = [];

  // 2. 각 후보의 최근 활동 + cooldown 체크.
  for (const c of candidates) {
    // 최근 7일 내 event 등록 여부
    const { count: recentEvents } = await sb
      .from('events')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', c.id)
      .gte('created_at', cutoffActivity);

    if ((recentEvents ?? 0) > 0) continue;

    // 최근 14일 내 reactivation push 발송 여부 (cooldown)
    const { count: recentPush } = await sb
      .from('reactivation_pushes')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', c.id)
      .gte('sent_at', cutoffCooldown);

    if ((recentPush ?? 0) > 0) continue;

    targetUserIds.push(c.id);
  }

  if (dryRun) {
    return new Response(JSON.stringify({ ok: true, dryRun: true, targets: targetUserIds }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 3. 실제 push 발송.
  let sentOk = 0;
  let sentFail = 0;
  for (const userId of targetUserIds) {
    const c = candidates.find((x) => x.id === userId);
    if (!c?.push_token) {
      await sb.from('reactivation_pushes').insert({
        user_id: userId,
        status: 'no_token',
      });
      sentFail += 1;
      continue;
    }

    try {
      const resp = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          to: c.push_token,
          title: 'AI 비서가 기다리고 있어요',
          body: '한 줄 자연어로 일정을 등록해 보세요. 1초면 충분해요.',
          sound: 'default',
          data: { type: 'reactivation' },
        }),
      });
      const json = (await resp.json()) as ExpoPushResponse;
      const ticket = Array.isArray(json.data) ? json.data[0] : json.data;
      const ok = ticket?.status === 'ok';
      await sb.from('reactivation_pushes').insert({
        user_id: userId,
        status: ok ? 'ok' : 'error',
        error_message: ok ? null : (ticket?.message ?? json.errors?.[0]?.message ?? 'unknown'),
      });
      if (ok) sentOk += 1;
      else sentFail += 1;
    } catch (err) {
      await sb.from('reactivation_pushes').insert({
        user_id: userId,
        status: 'error',
        error_message: err instanceof Error ? err.message : String(err),
      });
      sentFail += 1;
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      candidates: candidates.length,
      targets: targetUserIds.length,
      sent: sentOk,
      failed: sentFail,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
});
