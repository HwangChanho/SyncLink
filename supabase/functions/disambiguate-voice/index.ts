/**
 * disambiguate-voice Edge Function — v1.1 Phase 1
 *
 * Receives a raw STT transcript that the local NL parser flagged as low
 * confidence (typically homophone / particle confusion in Korean — e.g.
 * "3시" vs "30분", "오전" vs "오후"). Returns either:
 *   a) a single corrected sentence the client can re-parse locally, or
 *   b) up to 3 candidate sentences for the user to pick.
 *
 * We deliberately keep the contract narrow: no event JSON, just text
 * candidates. The client re-runs nlParser on the chosen text — same
 * downstream pipeline as a typed input.
 *
 * Cost model:
 *   - Claude Haiku, max_tokens 80 (well below parse-event's 150).
 *   - Quota gate ('disambiguate-voice' in _shared/quota.ts) caps Free
 *     at 30/day, Pro at 60/hour. STT confidence drops on noisy input
 *     so most users hit ≤5 calls/day in practice.
 *
 * Security mirrors parse-event:
 *   - ANTHROPIC_API_KEY is only on the server.
 *   - JWT required for the caller; quota counted per user_id.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any — Deno module resolution
import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'npm:@supabase/supabase-js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DisambiguateRequest {
  /** Raw transcript from the STT engine. May contain mis-recognised words. */
  transcript: string;
  /** Two-letter locale hint (ko, en, ...). Used to choose the prompt. */
  locale?: string;
  /** Optional confidence value the STT engine returned alongside the
   *  transcript. Some engines (Web Speech API) provide this; we pass it
   *  to the model so it can be more aggressive when confidence is low. */
  sttConfidence?: number;
}

interface DisambiguateResponse {
  /** Always present — Claude's best single guess. Empty string when the
   *  model could not produce anything sensible. */
  best: string;
  /** Optional alternative interpretations. Capped at 2 — the UI shows
   *  these as quick-pick chips beside the best candidate. */
  alternatives: string[];
  /** Tokens billed so the client can surface a usage breakdown when
   *  needed. Mirrors parse-event for consistency. */
  tokensUsed: number;
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

const buildSystemPrompt = (locale: string): string => {
  const lang = (locale ?? '').slice(0, 2).toLowerCase();
  if (lang === 'ko') {
    return [
      '당신은 한국어 음성 인식 결과를 보정하는 도우미입니다.',
      '사용자가 일정을 등록하려고 음성으로 말했지만 STT 가 발음을 잘못 받아쓴 경우가 많습니다.',
      '특히 "3시" vs "30분", "오전" vs "오후", "회의" vs "회식" 같은 동음/유사음 혼동을 의심하세요.',
      '',
      '반환 형식: JSON 만 출력. 다른 설명 X.',
      '{',
      '  "best": "가장 자연스러운 한국어 문장 (일정 등록에 사용)",',
      '  "alternatives": ["다른 해석 1", "다른 해석 2"]  // 0~2개. 같은 해석이면 빈 배열',
      '}',
      '',
      '규칙:',
      '- 원문이 이미 명확하면 best 에 원문 그대로 + alternatives 빈 배열.',
      '- 의미가 두 갈래로 갈리면 best 에 더 흔한 쪽, alternatives 에 다른 후보.',
      '- 전혀 알아들을 수 없으면 best="" + alternatives=[].',
      '- 일정과 무관한 내용이면 best="" + alternatives=[].',
      '- 한국어 외 다른 언어는 그대로 두기 (번역 X).',
    ].join('\n');
  }
  // English fallback (covers en, zh, ja — minimal but functional).
  return [
    'You correct speech-to-text transcripts for calendar event entry.',
    'Suspect common STT errors (3pm vs 30min, "meeting" vs "meal").',
    'Output JSON only: {"best":"...","alternatives":["..."]}.',
    'alternatives may be empty when the transcript is clear.',
  ].join('\n');
};

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  let body: DisambiguateRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const transcript = (body.transcript ?? '').trim();
  if (!transcript) {
    return new Response(JSON.stringify({ error: 'empty_transcript' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  // Hard cap input length so a malicious client can't burn the prompt budget.
  if (transcript.length > 300) {
    return new Response(JSON.stringify({ error: 'transcript_too_long' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── Auth + per-user quota ────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!jwt) {
    return new Response(JSON.stringify({ error: 'auth' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabaseUser = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: `Bearer ${jwt}` } } },
  );
  const { data: { user }, error: authErr } = await supabaseUser.auth.getUser();
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: 'auth' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — Deno import map resolves '../_shared/quota.ts' at deploy time.
  const { enforceQuota } = await import('../_shared/quota.ts');
  const quota = await enforceQuota({
    adminClient,
    userId: user.id,
    functionName: 'disambiguate-voice',
  });
  if (!quota.allowed) {
    return new Response(JSON.stringify({ error: quota.reason, plan: quota.plan }), {
      status: quota.reason === 'pro_required' ? 403 : 429,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── Claude Haiku call ────────────────────────────────────────────────────
  const client = new Anthropic();
  const userPayload = body.sttConfidence !== undefined
    ? `(STT confidence ${body.sttConfidence.toFixed(2)})\n${transcript}`
    : transcript;

  let best = '';
  let alternatives: string[] = [];
  let tokensUsed = 0;

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 80,
      system: buildSystemPrompt(body.locale ?? 'ko'),
      messages: [{ role: 'user', content: userPayload }],
    });

    tokensUsed = (message.usage?.input_tokens ?? 0) + (message.usage?.output_tokens ?? 0);

    const rawContent = message.content[0];
    if (rawContent.type === 'text') {
      const jsonMatch = rawContent.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        best = typeof parsed.best === 'string' ? parsed.best.trim() : '';
        if (Array.isArray(parsed.alternatives)) {
          alternatives = parsed.alternatives
            .filter((s: unknown): s is string => typeof s === 'string')
            .map((s: string) => s.trim())
            .filter((s: string) => s && s !== best)
            .slice(0, 2);
        }
      }
    }
  } catch (err) {
    // Soft-fail: return the original transcript as best so the client can
    // still proceed with the user's spoken input. We log so we can spot
    // recurring failures in Supabase function logs.
    console.error('[disambiguate-voice] Claude call failed:', err);
    // 크레딧 소진(결제)이면 LEAD 알림(soft-fail 유지 — 원문 transcript 반환).
    // @ts-ignore — Deno import map 은 deploy 시 해석.
    const { isCreditError, alertCreditExhausted } = await import('../_shared/aiHealth.ts');
    if (isCreditError(err)) {
      await alertCreditExhausted(adminClient, { fn: 'disambiguate-voice' });
    }
    best = transcript;
    alternatives = [];
  }

  // ── usage_metrics (fire-and-forget) ──────────────────────────────────────
  // Cost: Haiku at $0.80 / $4.00 per 1M tokens. Both input and output are
  // tiny here (≤80 tokens output, ≤100 input) so each call is well under 1¢.
  if (tokensUsed > 0) {
    try {
      // We can't readily distinguish input vs output here; use a flat
      // approximation. Real billing is the Anthropic dashboard — this row
      // is only for the dev cost dashboard / budget alerts.
      const approxInput = Math.round(tokensUsed * 0.7);
      const approxOutput = tokensUsed - approxInput;
      const costUsd = (approxInput * 0.80 + approxOutput * 4.00) / 1_000_000;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (adminClient as any).from('usage_metrics').insert({
        user_id:       user.id,
        function_name: 'disambiguate-voice',
        model:         'claude-haiku-4-5-20251001',
        input_tokens:  approxInput,
        output_tokens: approxOutput,
        cost_usd:      costUsd,
      });
    } catch {
      // Metric write failure must not block the response.
    }
  }

  const response: DisambiguateResponse = { best, alternatives, tokensUsed };
  return new Response(JSON.stringify(response), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
