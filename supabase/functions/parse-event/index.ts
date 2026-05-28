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
  /** Korean natural-language text to parse. text-only 사용 시 필수, image
   *  와 함께 보낼 때는 빈 문자열도 허용. */
  text: string;
  /** ISO-8601 datetime for resolving relative dates (e.g. "내일"). */
  contextDatetime: string;
  /** User locale hint (e.g. "ko-KR"). */
  locale: string;
  /** Optional: 사진 첨부 자연어 등록 (예: 미용실 예약 카톡 캡쳐). 있으면
   *  Vision 지원 모델 (Sonnet) 로 multimodal 호출 + 비용 분리 quota.
   *  data URL prefix 없이 raw base64 (jpeg/png). */
  imageBase64?: string;
  /** Optional: imageBase64 의 media type. 기본 'image/jpeg'. */
  imageMediaType?: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
}

interface ParsedEventFromAI {
  title: string;
  startAt: string;   // ISO-8601
  endAt: string;     // ISO-8601
  location: string | null;
  allDay: boolean;
  repeatType: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom_weekly';
  /** v1.2.8 — custom_weekly 일 때만 사용. JS Date.getDay() 호환 (0=일 ~ 6=토). */
  weeklyDays?: number[];
}

interface AiParseResponse {
  result: {
    parsed: {
      title?:       { value: string;    confidence: 'high' | 'medium' | 'low' };
      startAt?:     { value: string;    confidence: 'high' | 'medium' | 'low' };
      endAt?:       { value: string;    confidence: 'high' | 'medium' | 'low' };
      location?:    { value: string;    confidence: 'high' | 'medium' | 'low' };
      allDay?:      { value: boolean;   confidence: 'high' | 'medium' | 'low' };
      repeatType?:  { value: string;    confidence: 'high' | 'medium' | 'low' };
      weeklyDays?:  { value: number[];  confidence: 'high' | 'medium' | 'low' };
    };
    confidence: 'high' | 'medium' | 'low';
    source: 'ai';
    rawInput: string;
    processingMs: null;
    tokensUsed: number;
  };
}

// ─── Claude Haiku system prompt ───────────────────────────────────────────────

/**
 * Per-locale system prompt. Claude is multilingual, but a locale-tuned
 * prompt produces noticeably more accurate output than a generic English
 * prompt with mixed-language input. We default to Korean (the main
 * audience) and fall through to English for any unknown locale code.
 */
const buildSystemPrompt = (contextDatetime: string, locale: string): string => {
  const lang = (locale ?? '').slice(0, 2).toLowerCase();

  // v1.2.8 — repeatType 에 'custom_weekly' 추가 + weeklyDays 필드.
  // 다중 요일 반복 ("월~금", "평일", "주 5일", "매주 월수금" 등) 처리.
  // weeklyDays = JS Date.getDay() 호환 (0=일, 1=월, 2=화, 3=수, 4=목, 5=금, 6=토).
  if (lang === 'en') {
    return `
You parse natural-language event text into JSON.
Current time: ${contextDatetime}

Return format (one valid JSON line, no extra text):
{"title":"string","startAt":"ISO8601","endAt":"ISO8601","location":null,"allDay":false,"repeatType":"none","weeklyDays":null}

repeatType ∈ "none" | "daily" | "weekly" | "monthly" | "yearly" | "custom_weekly"
- "custom_weekly": multiple specific weekdays (e.g., "weekdays", "Mon-Fri", "Mon/Wed/Fri")
  When custom_weekly, set weeklyDays = array of day numbers (0=Sun, 1=Mon, ..., 6=Sat).
  Example "weekdays 9am-6pm" → repeatType="custom_weekly", weeklyDays=[1,2,3,4,5]
  Example "every Mon/Wed/Fri" → repeatType="custom_weekly", weeklyDays=[1,3,5]
- "weekly": every week on the SAME single weekday as startAt
- Otherwise weeklyDays must be null.

allDay: true when a date is given but no time
If start/end are ambiguous, pick the nearest future moment.
Return ONLY valid JSON. No explanation.
`.trim();
  }

  if (lang === 'ja') {
    return `
あなたは日本語の予定テキストを JSON に変換するパーサーです。
現在時刻: ${contextDatetime}

返答形式 (必ず有効な JSON 1 行のみ):
{"title":"string","startAt":"ISO8601","endAt":"ISO8601","location":null,"allDay":false,"repeatType":"none","weeklyDays":null}

repeatType: "none" | "daily" | "weekly" | "monthly" | "yearly" | "custom_weekly"
- "custom_weekly": 複数の曜日 (例: "平日"、"月〜金"、"月水金")
  weeklyDays = 曜日番号配列 (0=日, 1=月, ..., 6=土)
  例 "平日 9時〜18時" → repeatType="custom_weekly", weeklyDays=[1,2,3,4,5]
- それ以外は weeklyDays = null

allDay: 日付はあるが時刻が明示されていない場合 true
不明確な場合は現在時刻基準で最も近い未来の時点を推定。
必ず JSON のみを返してください。説明不要。
`.trim();
  }

  if (lang === 'zh') {
    return `
你是一个将中文日程文本转换为 JSON 的解析器。
当前时间: ${contextDatetime}

返回格式 (必须是一行有效的 JSON):
{"title":"string","startAt":"ISO8601","endAt":"ISO8601","location":null,"allDay":false,"repeatType":"none","weeklyDays":null}

repeatType 取值: "none" | "daily" | "weekly" | "monthly" | "yearly" | "custom_weekly"
- "custom_weekly": 多个特定星期 (例如 "工作日"、"周一到周五"、"每周一三五")
  weeklyDays = 星期数组 (0=周日, 1=周一, ..., 6=周六)
  例 "工作日 9点到18点" → repeatType="custom_weekly", weeklyDays=[1,2,3,4,5]
- 其他情况 weeklyDays = null

allDay: 有日期但未指定时间时为 true
若开始/结束不明确,推定为当前时间之后最接近的未来时刻。
仅返回 JSON,不要任何解释。
`.trim();
  }

  // Default: Korean (primary audience)
  return `
당신은 한국어 일정 텍스트 또는 이미지를 JSON으로 변환하는 파서입니다.
현재 시각: ${contextDatetime}

[일정 정보가 명확한 경우] 반환 형식 (valid JSON 한 줄):
{"title":"string","startAt":"ISO8601","endAt":"ISO8601","location":null,"allDay":false,"repeatType":"none","weeklyDays":null}

[이미지에서 일정 정보를 찾을 수 없거나 너무 모호한 경우]:
{"noEventFound":true,"reason":"한 줄짜리 한국어 설명"}

repeatType 가능 값: "none" | "daily" | "weekly" | "monthly" | "yearly" | "custom_weekly"
- "custom_weekly": 여러 요일 반복 ("평일", "주 5일", "월~금", "매주 월수금" 등)
  weeklyDays = 요일 숫자 배열 (0=일, 1=월, 2=화, 3=수, 4=목, 5=금, 6=토)
  예 "평일 9시부터 오후 6시까지" → repeatType="custom_weekly", weeklyDays=[1,2,3,4,5], startAt/endAt 은 다음 가장 가까운 평일의 09:00/18:00
  예 "주 5일 9-6시" → 같음
  예 "매주 월수금 운동" → repeatType="custom_weekly", weeklyDays=[1,3,5]
- "weekly": 매주 같은 단일 요일 반복 (startAt 요일과 동일).
- 그 외 weeklyDays 는 null.

allDay: 날짜는 있으나 시간이 명시되지 않으면 true
startAt/endAt이 불분명하면 현재 시각 기준 가장 가까운 미래 시점으로 추정.
이미지에 일정 관련 텍스트가 전혀 없거나 단순 사진 (풍경, 셀카 등) 이면
noEventFound=true 로 반환.
반드시 valid JSON만 반환하세요. 설명 없음.
`.trim();
};

// ─── JWT verification helper ──────────────────────────────────────────────────

/**
 * Validates the Authorization header and returns the user's JWT payload.
 * Throws if the token is missing or invalid.
 */
async function verifyJwt(req: Request): Promise<string> {
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

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error(`Invalid JWT: ${error?.message ?? 'no user'}`);
  return user.id;
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
    const userId = await verifyJwt(req);

    // 2. Parse request body
    const body: AiParseRequest = await req.json();
    const { text, contextDatetime, locale, imageBase64, imageMediaType } = body;

    const hasImage = typeof imageBase64 === 'string' && imageBase64.length > 0;
    if (!hasImage && !text?.trim()) {
      return new Response(JSON.stringify({ error: 'text or imageBase64 is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 2.5. Server-side quota gate. text → parse-event (Free 5/day,
    // Pro 60/hour). image → parse-event-vision (Free 2/day, Pro 20/hour) —
    // Sonnet vision 비용이 ~10× 높아 별도 한도.
    const functionName = hasImage ? 'parse-event-vision' : 'parse-event';
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — Deno import map resolves '../_shared/quota.ts' at deploy time.
    const { enforceQuota } = await import('../_shared/quota.ts');
    const quota = await enforceQuota({
      adminClient,
      userId,
      functionName,
    });
    if (!quota.allowed) {
      return new Response(JSON.stringify({ error: quota.reason, plan: quota.plan }), {
        status: quota.reason === 'pro_required' ? 403 : 429,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 3. Call Claude. Vision (이미지 첨부) 면 Sonnet, text-only 면 Haiku.
    //    Sonnet 만 multimodal 지원 + Haiku 보다 비싸므로 image 있을 때만.
    const client = new Anthropic();
    const model = hasImage ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001';
    const userContent = hasImage
      ? [
          {
            type:   'image',
            source: {
              type:       'base64',
              media_type: imageMediaType ?? 'image/jpeg',
              data:       imageBase64!,
            },
          },
          // text 가 비어있어도 모델에게 "이미지에서 일정 추출" 가이드 줌.
          { type: 'text', text: text?.trim() || '이 이미지에서 일정 정보를 추출해줘.' },
        ]
      : text;
    const message = await client.messages.create({
      model,
      max_tokens: hasImage ? 400 : 150,
      system: buildSystemPrompt(
        contextDatetime ?? new Date().toISOString(),
        locale ?? 'ko',
      ),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any — Anthropic SDK union
      messages: [{ role: 'user', content: userContent as any }],
    });

    // 4. Extract JSON from response
    const rawContent = message.content[0];
    if (rawContent.type !== 'text') {
      throw new Error('Unexpected response type from Claude');
    }

    // Parse AI JSON — extract only the first {...} block in case of extra text
    const jsonMatch = rawContent.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Claude returned no valid JSON');

    const aiParsed: ParsedEventFromAI & { noEventFound?: boolean; reason?: string }
      = JSON.parse(jsonMatch[0]);

    // Build-101 — AI 가 이미지에서 일정 정보 못 찾으면 noEventFound=true 반환.
    // 클라가 사용자에게 "다시 시도 또는 직접 입력" prompt 띄움.
    if (aiParsed.noEventFound) {
      return new Response(JSON.stringify({
        result: {
          parsed:    {},
          confidence: 'low',
          source:    'ai',
          rawInput:  text || '(image only)',
          processingMs: null,
          noEventFound: true,
          error:     aiParsed.reason || '이미지에서 일정 정보를 찾지 못했어요. 다시 시도하거나 직접 입력해주세요.',
        },
        tokensUsed: (message.usage?.input_tokens ?? 0) + (message.usage?.output_tokens ?? 0),
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // 5. Log usage metrics (non-blocking)
    const inputTokens = message.usage?.input_tokens ?? 0;
    const outputTokens = message.usage?.output_tokens ?? 0;
    const tokensUsed = inputTokens + outputTokens;

    try {
      const authHeader = req.headers.get('Authorization') ?? '';
      const jwt = authHeader.slice(7);
      const supabaseUser = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        { global: { headers: { Authorization: `Bearer ${jwt}` } } },
      );
      const { data: { user } } = await supabaseUser.auth.getUser();

      if (user) {
        const supabaseAdmin = createClient(
          Deno.env.get('SUPABASE_URL') ?? '',
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
        );
        // 모델별 가격 (USD / 1M tokens). Haiku 4.5: 0.80/4.00. Sonnet 4.6: 3.00/15.00.
        const INPUT_COST  = (hasImage ? 3.00 : 0.80) / 1_000_000;
        const OUTPUT_COST = (hasImage ? 15.00 : 4.00) / 1_000_000;
        await supabaseAdmin.from('usage_metrics').insert({
          user_id:       user.id,
          function_name: functionName,
          model:         hasImage ? 'claude-sonnet-4-6' : 'claude-haiku-4-5',
          input_tokens:  inputTokens,
          output_tokens: outputTokens,
          cost_usd:      inputTokens * INPUT_COST + outputTokens * OUTPUT_COST,
        });
      }
    } catch (metricsErr) {
      console.error('[parse-event] usage_metrics insert failed:', metricsErr);
    }

    // Map AI result to NLParseResult shape (dates stay as ISO strings here;
    //    the client converts them to Date objects when needed)

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
          // v1.2.8 — custom_weekly 일 때만 weeklyDays 전달. 0~6 정수 배열.
          ...(aiParsed.repeatType === 'custom_weekly' && Array.isArray(aiParsed.weeklyDays) && aiParsed.weeklyDays.length > 0 && {
            weeklyDays: {
              value: aiParsed.weeklyDays
                .filter((n: unknown) => typeof n === 'number' && n >= 0 && n <= 6)
                .map((n: number) => Math.floor(n)),
              confidence: 'high',
            },
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
