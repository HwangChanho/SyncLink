/**
 * parse-event Edge Function
 *
 * Receives a Korean natural-language event description, calls Claude Haiku,
 * and returns a structured NLParseResult.
 *
 * Security model:
 *  - ANTHROPIC_API_KEY lives ONLY here (Supabase Secrets), never on the client.
 *  - Every request must carry a valid Supabase JWT (anon or user session token).
 *
 * Called by: src/services/aiService.ts (via supabase.functions.invoke)
 * Daily limit enforcement: done on the client side in aiService.ts.
 *
 * Environment variables required (Supabase Dashboard → Functions → Secrets):
 *  - ANTHROPIC_API_KEY — Claude API key
 *  - SUPABASE_ANON_KEY  — auto-injected by Supabase runtime
 *  - SUPABASE_URL       — auto-injected by Supabase runtime
 */

// Supabase Edge Functions run on Deno. The Anthropic SDK is imported via npm:.
// eslint-disable-next-line @typescript-eslint/no-explicit-any — Deno module resolution
import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'npm:@supabase/supabase-js';

// ─── Types (inlined to avoid shared package dependency in Deno) ───────────────

interface AiParseRequest {
  /** Korean natural-language text to parse. */
  text: string;
  /** ISO-8601 datetime for resolving relative dates (e.g. "내일"). */
  contextDatetime: string;
  /** User locale hint (e.g. "ko-KR"). */
  locale: string;
}

interface ParsedEventFromAI {
  title: string;
  startAt: string;   // ISO-8601
  endAt: string;     // ISO-8601
  location: string | null;
  allDay: boolean;
  repeatType: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
}

interface AiParseResponse {
  result: {
    parsed: {
      title?:      { value: string;   confidence: 'high' | 'medium' | 'low' };
      startAt?:    { value: string;   confidence: 'high' | 'medium' | 'low' };
      endAt?:      { value: string;   confidence: 'high' | 'medium' | 'low' };
      location?:   { value: string;   confidence: 'high' | 'medium' | 'low' };
      allDay?:     { value: boolean;  confidence: 'high' | 'medium' | 'low' };
      repeatType?: { value: string;   confidence: 'high' | 'medium' | 'low' };
    };
    confidence: 'high' | 'medium' | 'low';
    source: 'ai';
    rawInput: string;
    processingMs: null;
    tokensUsed: number;
  };
}

// ─── Claude Haiku system prompt ───────────────────────────────────────────────

const buildSystemPrompt = (contextDatetime: string): string => `
당신은 한국어 일정 텍스트를 JSON으로 변환하는 파서입니다.
현재 시각: ${contextDatetime}

반환 형식 (반드시 valid JSON 한 줄만):
{"title":"string","startAt":"ISO8601","endAt":"ISO8601","location":null,"allDay":false,"repeatType":"none"}

repeatType 가능 값: "none" | "daily" | "weekly" | "monthly" | "yearly"
allDay: 날짜는 있으나 시간이 명시되지 않으면 true
startAt/endAt이 불분명하면 현재 시각 기준 가장 가까운 미래 시점으로 추정.
반드시 valid JSON만 반환하세요. 설명 없음.
`.trim();

// ─── JWT verification helper ──────────────────────────────────────────────────

/**
 * Validates the Authorization header and returns the user's JWT payload.
 * Throws if the token is missing or invalid.
 */
async function verifyJwt(req: Request): Promise<void> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('Missing or malformed Authorization header');
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

  // Use Supabase client to verify the JWT by calling getUser()
  const jwt = authHeader.slice(7);
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });

  const { error } = await supabase.auth.getUser();
  if (error) throw new Error(`Invalid JWT: ${error.message}`);
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  // Only accept POST
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // 1. Verify caller is an authenticated Supabase user
    await verifyJwt(req);

    // 2. Parse request body
    const body: AiParseRequest = await req.json();
    const { text, contextDatetime, locale: _locale } = body;

    if (!text?.trim()) {
      return new Response(JSON.stringify({ error: 'text is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 3. Call Claude Haiku
    const client = new Anthropic();
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 150,
      system: buildSystemPrompt(contextDatetime ?? new Date().toISOString()),
      messages: [{ role: 'user', content: text }],
    });

    // 4. Extract JSON from response
    const rawContent = message.content[0];
    if (rawContent.type !== 'text') {
      throw new Error('Unexpected response type from Claude');
    }

    // Parse AI JSON — extract only the first {...} block in case of extra text
    const jsonMatch = rawContent.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Claude returned no valid JSON');

    const aiParsed: ParsedEventFromAI = JSON.parse(jsonMatch[0]);

    // 5. Map AI result to NLParseResult shape (dates stay as ISO strings here;
    //    the client converts them to Date objects when needed)
    const tokensUsed =
      (message.usage?.input_tokens ?? 0) + (message.usage?.output_tokens ?? 0);

    const response: AiParseResponse = {
      result: {
        parsed: {
          ...(aiParsed.title && {
            title: { value: aiParsed.title, confidence: 'high' },
          }),
          ...(aiParsed.startAt && {
            startAt: { value: aiParsed.startAt, confidence: 'high' },
          }),
          ...(aiParsed.endAt && {
            endAt: { value: aiParsed.endAt, confidence: 'high' },
          }),
          ...(aiParsed.location && {
            location: { value: aiParsed.location, confidence: 'high' },
          }),
          allDay: { value: aiParsed.allDay ?? false, confidence: 'high' },
          ...(aiParsed.repeatType && aiParsed.repeatType !== 'none' && {
            repeatType: { value: aiParsed.repeatType, confidence: 'high' },
          }),
        },
        confidence: 'high',   // AI result is always treated as high (or medium by caller)
        source: 'ai',
        rawInput: text,
        processingMs: null,
      },
      tokensUsed,
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[parse-event] Error:', message);

    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
