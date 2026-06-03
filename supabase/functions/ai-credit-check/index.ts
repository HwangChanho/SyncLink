/**
 * ai-credit-check Edge Function — Claude API 크레딧 선제 점검 (proactive).
 *
 * pg_cron 이 매일 호출. Anthropic 에 최소 요청을 보내 크레딧이 남았는지 확인하고,
 * 소진(결제 문제) 감지 시 LEAD 에게 이메일 알림(24h dedup). 사용자가 AI 기능을
 * 쓰기 "전에" 미리 알 수 있게 한다.
 *
 * 보안: cron 이 service_role JWT 로 호출(reactivation-push 와 동일 패턴). 외부에서
 *       임의 호출돼도 부작용은 "ping 1회 + (소진 시) 이메일 1통(dedup)" 뿐이라 무해.
 *
 * Env: ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *      RESEND_API_KEY, ADMIN_NOTIFY_EMAIL
 */

import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'npm:@supabase/supabase-js';
// @ts-expect-error: Deno import map — deploy 시 해석.
import { isCreditError, alertCreditExhausted } from '../_shared/aiHealth.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return json({ ok: false, error: 'no_api_key' }, 500);

  const anthropic = new Anthropic({ apiKey });

  try {
    // 최소 요청(가장 싼 모델, 1 토큰) — 정상이면 크레딧 OK.
    await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ping' }],
    });
    return json({ ok: true, credit: 'ok' });
  } catch (err) {
    if (isCreditError(err)) {
      const sent = await alertCreditExhausted(adminClient, { fn: 'ai-credit-check (proactive cron)' });
      // sent=false 면 dedup(24h 내 이미 발송)으로 메일 생략됨 — 정상.
      return json({ ok: false, credit: 'exhausted', emailSent: sent }, 200);
    }
    // 그 외 에러(일시적 등)는 알림 없이 로깅만.
    console.error('[ai-credit-check] non-credit error:', err instanceof Error ? err.message : String(err));
    return json({ ok: false, error: 'other' }, 200);
  }
});
