/**
 * suggest-slot Edge Function — v1.2 Phase 3.
 *
 * 캘린더에서 새 일정을 만들 때 기존 일정과 충돌하면, 가까운 빈 슬롯 3개를
 * Haiku 가 짧게 추천. 결과는 ISO 시작시간 배열 + 1줄 사유.
 *
 * 비용: Haiku, max_tokens 200. quota.ts `suggest-slot` 키: Free 5/일,
 * Pro 시간당 30.
 */

import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'npm:@supabase/supabase-js';

interface SuggestRequest {
  /** 충돌한 일정 정보 (제목 + 원래 시간). */
  proposed: { title: string; startAt: string; endAt: string };
  /** 같은 날의 다른 일정들 (충돌 컨텍스트). */
  busySlots: Array<{ startAt: string; endAt: string }>;
  locale?: string;
}

interface SuggestResponse {
  alternatives: Array<{ startAt: string; endAt: string; reason: string }>;
  tokensUsed: number;
}

const buildPrompt = (req: SuggestRequest): string => {
  const lang = (req.locale ?? 'ko').slice(0, 2).toLowerCase();
  if (lang === 'ko') {
    return [
      `사용자가 "${req.proposed.title}" 일정을 ${req.proposed.startAt} ~ ${req.proposed.endAt} 에 만들려 합니다.`,
      '하지만 이 시간대에 다른 일정이 있습니다:',
      ...req.busySlots.map((s) => `- ${s.startAt} ~ ${s.endAt}`),
      '',
      '같은 날 안에서 충돌 없는 대안 시간 3개를 추천하세요.',
      '반환 형식: JSON 만 출력.',
      '{"alternatives":[{"startAt":"ISO","endAt":"ISO","reason":"30분 후"}]}',
      'reason 은 한국어 1줄.',
    ].join('\n');
  }
  return `Propose 3 alternative time slots for "${req.proposed.title}" avoiding busy slots. Return JSON only.`;
};

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  let body: SuggestRequest;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: 'invalid_body' }), { status: 400 });
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!jwt) return new Response(JSON.stringify({ error: 'auth' }), { status: 401 });

  const userClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: `Bearer ${jwt}` } } },
  );
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return new Response(JSON.stringify({ error: 'auth' }), { status: 401 });

  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );
  // @ts-ignore — Deno import resolved at deploy time
  const { enforceQuota } = await import('../_shared/quota.ts');
  const quota = await enforceQuota({ adminClient, userId: user.id, functionName: 'suggest-slot' });
  if (!quota.allowed) {
    return new Response(JSON.stringify({ error: quota.reason ?? 'quota' }), { status: 429 });
  }

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return new Response(JSON.stringify({ error: 'no_api_key' }), { status: 500 });
  const anthropic = new Anthropic({ apiKey });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response: any = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 200,
    messages: [{ role: 'user', content: buildPrompt(body) }],
  });
  const tokensUsed = (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0);

  const text = (response.content as Array<{ type: string; text?: string }>)
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('');

  let parsed: { alternatives: SuggestResponse['alternatives'] } = { alternatives: [] };
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) parsed = JSON.parse(match[0]);
  } catch {
    // parsing 실패 → 빈 배열로 fallback
  }

  // usage_metrics 기록
  try {
    await adminClient.from('usage_metrics').insert({
      user_id: user.id, function_name: 'suggest-slot', tokens: tokensUsed,
    });
  } catch { /* best-effort */ }

  return new Response(
    JSON.stringify({ alternatives: parsed.alternatives ?? [], tokensUsed } satisfies SuggestResponse),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
});
