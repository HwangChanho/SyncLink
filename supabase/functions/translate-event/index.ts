/**
 * translate-event Edge Function  (Sprint 15 TASK-1501)
 *
 * Pro-only endpoint that translates a shared event's title (and description)
 * from its detected source locale to the caller's target locale using Claude
 * Haiku, and caches the result in `event_translations`.
 *
 * Security model:
 *  - ANTHROPIC_API_KEY lives ONLY here (Supabase Secrets), never on clients.
 *  - The caller must present a valid user JWT in Authorization: Bearer ...
 *  - Subscription gating is enforced here (users.subscription_plan === 'pro').
 *  - Only the service-role client writes to event_translations.
 *
 * Request body:
 *    { event_id: string, target_locale: 'ko'|'en'|'zh'|'ja' }
 *
 * Response body:
 *    { title: string, description: string | null, cached: boolean,
 *      source_locale: string, target_locale: string }
 *
 * Error responses:
 *    401 { error: 'unauthorized' }          — missing / invalid JWT
 *    403 { error: 'pro_required' }          — caller is not on the Pro plan
 *    400 { error: 'bad_request', message }  — missing / malformed input
 *    404 { error: 'event_not_found' }       — event invisible or missing
 *    500 { error: 'internal', message }     — any other failure (logged)
 *
 * @see docs/handoffs/sprint-15/LEAD.md
 */

// deno-lint-ignore-file no-explicit-any
// @ts-expect-error — Deno remote import, not resolvable by tsc.
import Anthropic from 'npm:@anthropic-ai/sdk';
// @ts-expect-error — Deno remote import, not resolvable by tsc.
import { createClient } from 'npm:@supabase/supabase-js';
// @ts-expect-error — local relative import, Deno-only.
import { logToDb } from '../_shared/logger.ts';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TranslateRequest {
  event_id:      string;
  target_locale: string;
}

// Supported locales — anything outside this set gets rejected before calling Claude.
const SUPPORTED_LOCALES = ['ko', 'en', 'zh', 'ja'] as const;
type SupportedLocale = typeof SUPPORTED_LOCALES[number];

interface EventRow {
  id:          string;
  title:       string;
  description: string | null;
}

interface TranslationRow {
  translated_title: string;
  translated_desc:  string | null;
  source_locale:    string;
  target_locale:    string;
  source_hash:      string;
}

// ─── CORS ─────────────────────────────────────────────────────────────────────

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Detect the probable source locale of a title+description using simple
 * character-range heuristics. We avoid third-party language-detection libs
 * because they add significant cold-start weight to the Edge Function.
 *
 * Priority: Korean → Japanese (hiragana/katakana) → Chinese (CJK) → English.
 *
 * @param text Combined title + description
 * @returns One of the supported locale codes.
 */
function detectSourceLocale(text: string): SupportedLocale {
  if (/[가-힯]/.test(text)) return 'ko';               // Hangul
  if (/[぀-ゟ]|[゠-ヿ]/.test(text)) return 'ja'; // hiragana/katakana
  if (/[一-鿿]/.test(text)) return 'zh';               // CJK unified
  return 'en';
}

/**
 * SHA-256 hex digest of the combined source text. Used as the cache key so
 * that any edit to the event title/description invalidates previously cached
 * translations without needing explicit cache busting logic.
 */
async function sha256Hex(input: string): Promise<string> {
  const data   = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Build the Claude Haiku prompt — returns a concise JSON-only instruction so
 * we can parse the response deterministically without token-heavy system
 * instructions that would increase cost per call.
 */
function buildPrompt(
  title: string,
  description: string | null,
  targetLocale: SupportedLocale,
): { system: string; user: string } {
  const localeName: Record<SupportedLocale, string> = {
    ko: 'Korean',
    en: 'English',
    zh: 'Simplified Chinese',
    ja: 'Japanese',
  };

  const system =
    `Translate the event title and description to ${localeName[targetLocale]}. ` +
    `Preserve meaning, keep concise, keep line breaks. ` +
    `Respond with valid JSON only: {"title": string, "description": string|null}. ` +
    `No prose, no code fences.`;

  const user = JSON.stringify({ title, description });
  return { system, user };
}

/**
 * Safely extract the JSON payload from Claude's reply.
 * Claude Haiku normally returns a single text block; we still guard against
 * wrapped responses (e.g. ```json ... ```) by locating the first `{…}` match.
 */
function extractJson(raw: string): { title: string; description: string | null } {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Claude returned no JSON payload');
  const parsed = JSON.parse(match[0]) as { title?: unknown; description?: unknown };
  if (typeof parsed.title !== 'string') throw new Error('Invalid translation payload');
  const description = typeof parsed.description === 'string' ? parsed.description : null;
  return { title: parsed.title, description };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  // Request body parsing happens before auth to catch obvious 400s early.
  let body: TranslateRequest;
  try {
    body = await req.json() as TranslateRequest;
  } catch {
    return json(400, { error: 'bad_request', message: 'Invalid JSON body' });
  }

  const { event_id, target_locale } = body;
  if (!event_id || typeof event_id !== 'string') {
    return json(400, { error: 'bad_request', message: 'event_id is required' });
  }
  if (!SUPPORTED_LOCALES.includes(target_locale as SupportedLocale)) {
    return json(400, { error: 'bad_request', message: 'unsupported target_locale' });
  }
  const targetLocale = target_locale as SupportedLocale;

  // ── Auth ─────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json(401, { error: 'unauthorized' });

  const supabaseUrl     = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  // 주: service_role 키는 아래 quota gate 블록에서 adminClient 를 만들 때
  //     Deno.env.get 으로 직접 읽는다. (예전엔 여기서 serviceRoleKey 로 받아
  //     두 번째 adminClient 를 또 선언했는데 = 동일 스코프 중복선언 버그였음.)

  // User-scoped client: respects RLS so we can only see events the caller can see.
  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json(401, { error: 'unauthorized' });
  const userId = userData.user.id as string;

  try {
    // ── Pro gating ─────────────────────────────────────────────────────────
    // subscription_plan lives on the public.users row — service role bypasses
    // RLS, but the JWT-scoped client is also allowed to read its own row.
    const { data: profile, error: profileErr } = await userClient
      .from('users')
      .select('subscription_plan')
      .eq('id', userId)
      .maybeSingle();

    if (profileErr) throw profileErr;
    if (profile?.subscription_plan !== 'pro') {
      return json(403, { error: 'pro_required' });
    }

    // ── Quota gate ─────────────────────────────────────────────────────────
    // Pro hourly cap of 60 calls per user. The shared helper also rejects
    // non-Pro accounts; the explicit check above stays as defense in depth
    // and produces the friendlier error code.
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — Deno path resolves at deploy time.
    const { enforceQuota } = await import('../_shared/quota.ts');
    const quota = await enforceQuota({
      adminClient, userId, functionName: 'translate-event',
    });
    if (!quota.allowed) {
      return json(quota.reason === 'pro_required' ? 403 : 429, {
        error: quota.reason ?? 'quota',
        plan: quota.plan,
      });
    }

    // ── Load the event (enforces visibility via RLS) ──────────────────────
    const { data: event, error: eventErr } = await userClient
      .from('events')
      .select('id, title, description')
      .eq('id', event_id)
      .maybeSingle<EventRow>();

    if (eventErr) throw eventErr;
    if (!event) return json(404, { error: 'event_not_found' });

    const sourceText   = `${event.title}\n${event.description ?? ''}`;
    const sourceLocale = detectSourceLocale(sourceText);
    const sourceHash   = await sha256Hex(sourceText);

    // Same-locale shortcut: no translation needed. We still return a payload
    // so clients can treat the response uniformly.
    if (sourceLocale === targetLocale) {
      return json(200, {
        title:          event.title,
        description:    event.description,
        cached:         true,
        source_locale:  sourceLocale,
        target_locale:  targetLocale,
      });
    }

    // Service-role client: required to write to event_translations (no INSERT
    // policy) and to insert usage_metrics. Reuses the `adminClient` already
    // created above for the quota gate — a second `const adminClient` here was
    // a duplicate-declaration bug (same try-block scope) that Deno rejects.

    // ── Cache hit? ─────────────────────────────────────────────────────────
    const { data: cached } = await adminClient
      .from('event_translations')
      .select('translated_title, translated_desc, source_locale, target_locale, source_hash')
      .eq('event_id', event_id)
      .eq('target_locale', targetLocale)
      .maybeSingle<TranslationRow>();

    if (cached && cached.source_hash === sourceHash) {
      return json(200, {
        title:         cached.translated_title,
        description:   cached.translated_desc,
        cached:        true,
        source_locale: cached.source_locale,
        target_locale: cached.target_locale,
      });
    }

    // ── Call Claude Haiku ──────────────────────────────────────────────────
    const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });
    const { system, user: userMsg } = buildPrompt(event.title, event.description, targetLocale);

    const message = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system,
      messages: [{ role: 'user', content: userMsg }],
    });

    const firstBlock = message.content[0];
    if (!firstBlock || firstBlock.type !== 'text') {
      throw new Error('Claude returned unexpected response type');
    }
    const { title: tTitle, description: tDesc } = extractJson(firstBlock.text);

    // ── Upsert cache ───────────────────────────────────────────────────────
    // ON CONFLICT(event_id, target_locale) overwrites with fresh translation
    // when the source_hash has changed (edited event).
    await adminClient
      .from('event_translations')
      .upsert(
        {
          event_id,
          source_locale:    sourceLocale,
          target_locale:    targetLocale,
          translated_title: tTitle,
          translated_desc:  tDesc,
          source_hash:      sourceHash,
        },
        { onConflict: 'event_id,target_locale' },
      );

    // ── Record usage cost (non-blocking on failure) ────────────────────────
    try {
      const inputTokens  = message.usage?.input_tokens  ?? 0;
      const outputTokens = message.usage?.output_tokens ?? 0;
      // Haiku 4.5 pricing, consistent with parse-event.
      const INPUT_COST  = 0.80 / 1_000_000;
      const OUTPUT_COST = 4.00 / 1_000_000;
      await adminClient.from('usage_metrics').insert({
        user_id:       userId,
        function_name: 'translate-event',
        model:         'claude-haiku-4-5',
        input_tokens:  inputTokens,
        output_tokens: outputTokens,
        cost_usd:      inputTokens * INPUT_COST + outputTokens * OUTPUT_COST,
      });
    } catch (metricsErr) {
      console.error('[translate-event] usage_metrics insert failed:', metricsErr);
    }

    return json(200, {
      title:          tTitle,
      description:    tDesc,
      cached:         false,
      source_locale:  sourceLocale,
      target_locale:  targetLocale,
    });
  } catch (err) {
    // Log to DB so LEAD can triage; never leak raw stack to the client.
    await logToDb('translate-event', err, { event_id, target_locale });
    // 크레딧 소진(결제) → LEAD 이메일 알림 + 사용자에게 명확 안내(503).
    // @ts-ignore — Deno import map 은 deploy 시 해석.
    const { isCreditError, alertCreditExhausted } = await import('../_shared/aiHealth.ts');
    if (isCreditError(err)) {
      const alertClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
        { auth: { autoRefreshToken: false, persistSession: false } },
      );
      await alertCreditExhausted(alertClient, { fn: 'translate-event' });
      return json(503, { error: 'ai_unavailable' });
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return json(500, { error: 'internal', message });
  }
});
