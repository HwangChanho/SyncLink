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
  /**
   * @deprecated v1.4.11 부터 `images` 를 쓴다. 스토어 배포 지연으로 구버전 앱이
   * 한동안 계속 이 필드로 보내므로 **제거하면 안 된다**. 아래에서 images 로 합친다.
   */
  imageBase64?: string;
  /** @deprecated `imageBase64` 와 짝. 기본 'image/jpeg'. */
  imageMediaType?: ParseEventImageMediaType;
  /**
   * 사진 첨부 자연어 등록 (예: 시간표·예약 카톡 캡쳐) 최대 {@link MAX_IMAGES} 장.
   * 있으면 Vision 지원 모델(Sonnet)로 multimodal 호출 + 비용 분리 quota.
   * data URL prefix 없이 raw base64 (jpeg/png/webp/gif).
   * 배열 순서 = 사용자가 고른 순서 = 모델이 보는 순서.
   */
  images?: { base64: string; mediaType: ParseEventImageMediaType }[];
}

/** Anthropic vision 이 받는 이미지 MIME. */
type ParseEventImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

/** 이 외 형식은 모델에 보내기 전에 400 으로 거른다. */
const ALLOWED_IMAGE_TYPES = new Set<string>([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
]);

/**
 * 한 요청에 붙일 수 있는 사진 수 (v1.4.11 — LEAD 요청으로 1 → 10).
 * 클라이언트(NLInputBar)도 같은 값으로 선택을 제한하지만 서버가 진짜 관문이다.
 */
const MAX_IMAGES = 10;

/**
 * 한 요청 전체 base64 합계 상한.
 * Vision 은 장당 원본 5MB 가 상한이고 base64 는 약 4/3 로 부푼다.
 * 10장을 실제로 보낼 수 있게 넉넉히 두되 폭주는 막는 값.
 */
const MAX_IMAGES_TOTAL_BASE64_CHARS = 22_000_000;

interface ParsedEventFromAI {
  title: string;
  startAt: string;   // ISO-8601
  endAt: string;     // ISO-8601
  location: string | null;
  allDay: boolean;
  repeatType: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom_weekly';
  /** v1.2.8 — custom_weekly 일 때만 사용. JS Date.getDay() 호환 (0=일 ~ 6=토). */
  weeklyDays?: number[];
  /** v1.3 — 상대일 일정: 기준일(=오늘)로부터 N일. '도착예상/수령/만료' 류일 때만. */
  offsetDays?: number;
  /** v1.3 — 상대일 일정 라벨 ("도착예상" 등). */
  offsetLabel?: string | null;
}

/** 클라이언트가 받는 필드별 파싱 결과. 일정 1건 분량. */
interface AiParsedFields {
  title?:       { value: string;    confidence: 'high' | 'medium' | 'low' };
  startAt?:     { value: string;    confidence: 'high' | 'medium' | 'low' };
  endAt?:       { value: string;    confidence: 'high' | 'medium' | 'low' };
  location?:    { value: string;    confidence: 'high' | 'medium' | 'low' };
  allDay?:      { value: boolean;   confidence: 'high' | 'medium' | 'low' };
  repeatType?:  { value: string;    confidence: 'high' | 'medium' | 'low' };
  weeklyDays?:  { value: number[];  confidence: 'high' | 'medium' | 'low' };
  offsetDays?:  { value: number;    confidence: 'high' | 'medium' | 'low' };
  offsetLabel?: { value: string;    confidence: 'high' | 'medium' | 'low' };
}

/** 일정 1건의 파싱 결과 봉투. */
interface AiParseResultItem {
  parsed: AiParsedFields;
  confidence: 'high' | 'medium' | 'low';
  source: 'ai';
  rawInput: string;
  processingMs: null;
}

interface AiParseResponse {
  /** 항상 채워진다. 구버전 클라이언트는 이것만 읽으므로 **첫 일정**이 들어간다. */
  result: AiParseResultItem;
  /**
   * v1.4.11 — 사진 여러 장에서 뽑은 일정이 2건 이상일 때만 채워진다.
   * 신버전 클라이언트는 이게 있으면 이걸 쓴다(없으면 `result` 하나).
   */
  results?: AiParseResultItem[];
  tokensUsed: number;
}

// ─── Claude Haiku system prompt ───────────────────────────────────────────────

/**
 * Per-locale system prompt. Claude is multilingual, but a locale-tuned
 * prompt produces noticeably more accurate output than a generic English
 * prompt with mixed-language input. We default to Korean (the main
 * audience) and fall through to English for any unknown locale code.
 */
/**
 * 시스템 프롬프트 조립.
 *
 * @param contextDatetime 상대 날짜("내일") 해석 기준 시각
 * @param locale          ko/en/ja/zh
 * @param imageCount      첨부된 사진 수. **2장 이상일 때만** 응답 형식을
 *                        배열(`{"events":[...]}`)로 바꾸는 지시를 덧붙인다.
 *                        1장 이하면 기존 단일 형식 그대로 — 텍스트 경로와
 *                        기존 단일 사진 경로에 회귀를 만들지 않기 위해서다.
 */
const buildSystemPrompt = (
  contextDatetime: string,
  locale: string,
  imageCount = 0,
): string => {
  const base = buildBaseSystemPrompt(contextDatetime, locale);
  if (imageCount < 2) return base;
  return `${base}\n\n${buildMultiImageSuffix(locale, imageCount)}`;
};

/**
 * 사진 여러 장일 때만 붙는 지시.
 * 단일 형식을 그대로 두고 "배열로 감싸라"만 덧붙이므로, 위 본문의 title/시각/
 * 반복 규칙은 그대로 적용된다.
 */
const buildMultiImageSuffix = (locale: string, imageCount: number): string => {
  const lang = (locale ?? '').slice(0, 2).toLowerCase();
  if (lang === 'en') {
    return `
⚠ ${imageCount} images are attached. Instead of the single-object format above, return:
{"events":[{ ...same object as above... }, ...]}
- Include EVERY event you find, across ALL images. One object per event.
- If one image holds several events (e.g. a timetable), emit one object per event.
- Skip images with no event; do not emit placeholders.
- If NO image contains any event, return {"noEventFound":true,"reason":"..."} instead.
- Cap at 30 objects.
Return ONLY valid JSON.`.trim();
  }
  if (lang === 'ja') {
    return `
⚠ 画像が ${imageCount} 枚添付されています。上の単一形式ではなく次の形式で返してください:
{"events":[{ ...上と同じオブジェクト... }, ...]}
- すべての画像から見つかった予定を **すべて** 含める。予定 1 件につき 1 オブジェクト。
- 1 枚に複数の予定（時間割など）があれば、それぞれ別オブジェクトにする。
- 予定が無い画像は飛ばす。
- どの画像にも予定が無ければ {"noEventFound":true,"reason":"..."} を返す。
- 最大 30 件。
必ず JSON のみ。`.trim();
  }
  if (lang === 'zh') {
    return `
⚠ 已附上 ${imageCount} 张图片。请不要用上面的单个对象格式，改用:
{"events":[{ ...与上面相同的对象... }, ...]}
- 包含 **所有** 图片中找到的每一个日程，每个日程一个对象。
- 若一张图含多个日程（如课程表），每个日程单独一个对象。
- 没有日程的图片跳过。
- 若所有图片都没有日程，返回 {"noEventFound":true,"reason":"..."}。
- 最多 30 个。
只返回有效 JSON。`.trim();
  }
  return `
⚠ 사진이 ${imageCount}장 첨부됐다. 위의 단일 객체 형식 대신 **다음 형식**으로 반환하라:
{"events":[{ ...위와 동일한 객체... }, ...]}
- **모든 사진**에서 찾은 일정을 **전부** 넣는다. 일정 1건당 객체 1개.
- 한 장에 일정이 여러 개면(예: 시간표) 각각 별도 객체로 만든다.
- 일정이 없는 사진은 그냥 건너뛴다. 빈 객체를 넣지 말 것.
- 어느 사진에도 일정이 없으면 {"noEventFound":true,"reason":"..."} 를 반환한다.
- 최대 30개까지.
반드시 valid JSON만 반환하세요.`.trim();
};

const buildBaseSystemPrompt = (contextDatetime: string, locale: string): string => {
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
{"title":"string","startAt":"ISO8601","endAt":"ISO8601","location":null,"allDay":false,"repeatType":"none","weeklyDays":null,"offsetDays":null,"offsetLabel":null}

[이미지에서 일정 정보를 찾을 수 없거나 너무 모호한 경우]:
{"noEventFound":true,"reason":"한 줄짜리 한국어 설명"}

repeatType 가능 값: "none" | "daily" | "weekly" | "monthly" | "yearly" | "custom_weekly"
- "weekly": **단순 "매주"** (요일 명시 없음). startAt 요일에 매주 반복.
  예 "매주 회의" / "회사 6~9시 매주" → repeatType="weekly", weeklyDays=null
- "custom_weekly": **여러 요일 명시** ("평일", "주 5일", "월~금", "매주 월수금")
  weeklyDays = 요일 숫자 배열 (0=일, 1=월, 2=화, 3=수, 4=목, 5=금, 6=토)
  ⚠ custom_weekly 를 쓸 거면 weeklyDays 가 **반드시 1개 이상** 있어야 한다.
    "매주" 만 있고 요일 명시 없으면 절대 custom_weekly 쓰지 말고 "weekly" 사용.
  예 "평일 9시부터 오후 6시까지" → repeatType="custom_weekly", weeklyDays=[1,2,3,4,5]
  예 "매주 월수금 운동" → repeatType="custom_weekly", weeklyDays=[1,3,5]
- 그 외 weeklyDays 는 null.

allDay: 날짜는 있으나 시간이 명시되지 않으면 true
startAt/endAt이 불분명하면 현재 시각 기준 가장 가까운 미래 시점으로 추정.
이미지에 일정 관련 텍스트가 전혀 없거나 단순 사진 (풍경, 셀카 등) 이면
noEventFound=true 로 반환.

⚠ title 규칙 (반드시 준수):
- 활동/주체 **핵심 명사** 만. 사용자 입력 전체 문장을 넣지 말 것.
- 예: "9시부터 6시까지 회사 다녀" → title="회사" (X "9시부터 6시까지 회사 다녀")
- 예: "주말 운동 갈래" → title="운동"
- 예: "내일 오후 3시 카페에서 미팅" → title="카페 미팅"
- 예: "난 직장인이라 9-6시 일해" → title="회사"
- 핵심 명사가 도저히 안 보이면 noEventFound=true 로 반환.

⚠ startAt/endAt 규칙:
- ISO 8601 **with offset** (예: "2026-05-28T09:00:00+09:00").
- 현재 시각의 offset 을 그대로 사용.
- "9-6시" / "9시부터 6시까지" 는 같은 날 오전 9시 ~ 오후 6시 (퇴근). endAt 이 startAt 보다 빠르면 안 됨.

⚠ 상대일 일정 (offsetDays/offsetLabel) — '도착예상·수령·만료·마감' 류 의미일 때만:
- "택배 3일 뒤 도착(예상)", "주문 며칠 뒤 도착", "발급일로부터 N일 뒤 수령/만료" 처럼
  '며칠 뒤 + (도착/수령/만료/마감/예정)' 이면:
    offsetDays = N (숫자), offsetLabel = 성격 단어("도착예상"/"수령"/"만료"/"마감"),
    allDay=true, startAt/endAt = 현재 시각 + N일 (그 날 00:00 ~ 23:59).
- 그 외 일반 약속·회의·할 일은 offsetDays=null, offsetLabel=null.
  예 "3일 후 회의" → offsetDays=null (일반 일정).
  예 "택배 시켰어 3일 뒤 도착예상" → title="택배 도착", offsetDays=3, offsetLabel="도착예상", allDay=true.
  예 "여권 발급일로부터 7일 뒤 수령" → title="여권 수령", offsetDays=7, offsetLabel="수령", allDay=true.

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

    /**
     * 신·구 클라이언트를 하나의 배열로 합친다.
     * 구버전 앱은 `imageBase64`(단수), v1.4.11+ 는 `images`(배열)를 보낸다.
     * 둘 다 오면 배열을 정답으로 삼아 사진이 중복되지 않게 한다.
     */
    const images: { base64: string; mediaType: ParseEventImageMediaType }[] =
      Array.isArray(body.images) ? body.images
      : (typeof imageBase64 === 'string' && imageBase64.length > 0)
        ? [{ base64: imageBase64, mediaType: imageMediaType ?? 'image/jpeg' }]
        : [];

    const hasImage = images.length > 0;
    if (!hasImage && !text?.trim()) {
      return new Response(JSON.stringify({ error: 'text or images is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (images.length > MAX_IMAGES) {
      return new Response(JSON.stringify({ error: 'too_many_images', max: MAX_IMAGES }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    for (const img of images) {
      if (typeof img?.base64 !== 'string' || img.base64.length === 0) {
        return new Response(JSON.stringify({ error: 'invalid_image' }), {
          status: 400, headers: { 'Content-Type': 'application/json' },
        });
      }
      if (!ALLOWED_IMAGE_TYPES.has(img.mediaType)) {
        return new Response(JSON.stringify({ error: 'unsupported_image_type' }), {
          status: 400, headers: { 'Content-Type': 'application/json' },
        });
      }
    }
    // 장당 상한만 두면 10장이 합쳐져 Edge 메모리와 요청 크기를 터뜨린다.
    const totalBase64 = images.reduce((sum, i) => sum + i.base64.length, 0);
    if (totalBase64 > MAX_IMAGES_TOTAL_BASE64_CHARS) {
      return new Response(JSON.stringify({ error: 'images_too_large' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
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
    // 블록 순서는 image… → text. 모델이 지시를 읽기 전에 그림을 보게 하는 쪽이 낫다.
    // 클라이언트가 data URI 째로 보내는 경우가 있어 접두사를 벗겨 낸다.
    const userContent = hasImage
      ? [
          ...images.map((img) => ({
            type:   'image',
            source: {
              type:       'base64',
              media_type: img.mediaType,
              data:       img.base64.replace(/^data:[^;]+;base64,/, ''),
            },
          })),
          // text 가 비어있어도 모델에게 "이미지에서 일정 추출" 가이드 줌.
          // 여러 장이면 사진별로 나눠 읽으라고 명시한다 — 안 그러면 첫 장만 보고 끝낸다.
          {
            type: 'text',
            text: text?.trim()
              || (images.length > 1
                ? `첨부한 사진 ${images.length}장 전부에서 일정 정보를 추출해줘.`
                : '이 이미지에서 일정 정보를 추출해줘.'),
          },
        ]
      : text;
    const message = await client.messages.create({
      model,
      // 사진이 여러 장이면 일정도 여러 개 나온다 — 한 건당 약 200토큰으로 잡고
      // 장수에 비례해 늘린다(상한 4000). 부족하면 JSON 이 잘려 파싱이 통째로 실패한다.
      max_tokens: hasImage
        ? Math.min(4000, Math.max(400, images.length * 400))
        : 150,
      system: buildSystemPrompt(
        contextDatetime ?? new Date().toISOString(),
        locale ?? 'ko',
        images.length,
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

    const rawParsed: (ParsedEventFromAI & { noEventFound?: boolean; reason?: string })
      & { events?: ParsedEventFromAI[] }
      = JSON.parse(jsonMatch[0]);

    /**
     * 사진이 2장 이상이면 모델이 `{"events":[...]}` 로 답한다(위 프롬프트 접미사).
     * 그 외에는 단일 객체 그대로다. 아래 로직이 둘 다 다루도록 **항상 배열로** 만든다.
     * ⚠️ noEventFound 응답에는 events 가 없으므로 그 분기가 먼저다.
     */
    const aiEvents: ParsedEventFromAI[] =
      Array.isArray(rawParsed.events) && rawParsed.events.length > 0
        ? rawParsed.events.slice(0, 30)
        : [rawParsed];

    // 기존 코드가 참조하는 이름 유지 — 단건 경로의 동작을 그대로 두기 위해서다.
    const aiParsed = rawParsed;

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

    // v1.2.9 — response-side 가드:
    //  (1) title 25자 초과 = raw 발화 fallback 으로 간주, 잘라냄.
    //  (2) endAt <= startAt 이면 +12h (오후 보정).
    //  (3) ISO offset 누락 시 contextDatetime 의 offset 으로 보강.
    const nowIsoForOffset = contextDatetime ?? new Date().toISOString();
    const offsetMatch = nowIsoForOffset.match(/(Z|[+-]\d{2}:?\d{2})$/);
    const tzOffset = offsetMatch ? offsetMatch[1] : '+09:00';
    const ensureOffset = (iso?: string | null): string | undefined => {
      if (!iso || typeof iso !== 'string') return undefined;
      if (/(Z|[+-]\d{2}:?\d{2})$/.test(iso)) return iso;
      return iso + (tzOffset === 'Z' ? 'Z' : tzOffset);
    };

    /**
     * 모델이 준 일정 객체 하나를 클라이언트 스키마(`parsed`)로 정규화한다.
     * v1.4.11 에 사진 다중 첨부를 넣으면서 함수로 뺐다 — 같은 가드를 일정마다
     * 똑같이 적용해야 하기 때문이다(예전엔 인라인이라 1건에만 적용됐다).
     */
    const buildParsed = (ev: ParsedEventFromAI): AiParseResponse['result']['parsed'] => {
      const titleNormalized = typeof ev.title === 'string'
        ? (ev.title.trim().length > 25 ? ev.title.trim().slice(0, 25) + '…' : ev.title.trim())
        : ev.title;

      // v1.2.9 — 모델이 단순 "매주" 를 custom_weekly + 빈 weeklyDays 로 반환하던 회귀
      // (캘린더 occurrence 0 → 미노출). 비어 있으면 'weekly' 로 강등한다.
      const weeklyDaysValid = Array.isArray(ev.weeklyDays)
        ? ev.weeklyDays.filter((n: unknown) => typeof n === 'number' && n >= 0 && n <= 6)
        : [];
      let repeatType = ev.repeatType;
      let weeklyDays = ev.weeklyDays;
      if (repeatType === 'custom_weekly' && weeklyDaysValid.length === 0) {
        repeatType = 'weekly';
        // 타입이 number[] | undefined 라 null 대신 undefined — 의미는 같다(필드 없음).
        weeklyDays = undefined;
      }

      const startNormalized = ensureOffset(ev.startAt);
      let endNormalized = ensureOffset(ev.endAt);
      if (startNormalized && endNormalized) {
        const s = new Date(startNormalized).getTime();
        const e = new Date(endNormalized).getTime();
        if (Number.isFinite(s) && Number.isFinite(e) && e <= s) {
          endNormalized = new Date(e + 12 * 60 * 60 * 1000).toISOString();
        }
      }

      return {
        ...(titleNormalized && {
          title: { value: titleNormalized, confidence: 'high' as const },
        }),
        ...(startNormalized && {
          startAt: { value: startNormalized, confidence: 'high' as const },
        }),
        ...(endNormalized && {
          endAt: { value: endNormalized, confidence: 'high' as const },
        }),
        ...(ev.location && {
          location: { value: ev.location, confidence: 'high' as const },
        }),
        allDay: { value: ev.allDay ?? false, confidence: 'high' as const },
        ...(repeatType && repeatType !== 'none' && {
          repeatType: { value: repeatType, confidence: 'high' as const },
        }),
        // v1.2.8 — custom_weekly 일 때만 weeklyDays 전달. 0~6 정수 배열.
        ...(repeatType === 'custom_weekly' && Array.isArray(weeklyDays) && weeklyDays.length > 0 && {
          weeklyDays: {
            value: weeklyDays
              .filter((n: unknown) => typeof n === 'number' && n >= 0 && n <= 6)
              .map((n: number) => Math.floor(n)),
            confidence: 'high' as const,
          },
        }),
        // v1.3 — 상대일 일정 메타 (도착예상/수령/만료 류). 0 이상 정수 + 라벨일 때만.
        ...(typeof ev.offsetDays === 'number' && ev.offsetDays >= 0 && {
          offsetDays: { value: Math.floor(ev.offsetDays), confidence: 'high' as const },
        }),
        ...(typeof ev.offsetLabel === 'string' && ev.offsetLabel.trim().length > 0 && {
          offsetLabel: { value: ev.offsetLabel.trim(), confidence: 'high' as const },
        }),
      };
    };

    const parsedList = aiEvents.map(buildParsed);

    const response: AiParseResponse = {
      result: {
        // 구버전 클라이언트는 `result` 만 읽는다 — 첫 일정을 그대로 넣어 호환을 지킨다.
        parsed: parsedList[0] ?? {},
        confidence: 'high',   // AI result is always treated as high (or medium by caller)
        source: 'ai',
        rawInput: text,
        processingMs: null,
      },
      // v1.4.11 — 사진 여러 장에서 뽑은 일정 전부. 신버전 클라이언트가 이걸 쓴다.
      ...(parsedList.length > 1 && {
        results: parsedList.map((parsed) => ({
          parsed,
          confidence: 'high' as const,
          source: 'ai' as const,
          rawInput: text,
          processingMs: null,
        })),
      }),
      tokensUsed,
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[parse-event] Error:', message);

    // 크레딧 소진(결제) → LEAD 이메일 알림 + 사용자에게 명확 안내(503).
    // adminClient 는 try 스코프라 여기서 새로 생성 (알림 1회용).
    // @ts-ignore — Deno import map 은 deploy 시 해석.
    const { isCreditError, alertCreditExhausted } = await import('../_shared/aiHealth.ts');
    if (isCreditError(err)) {
      const alertClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
        { auth: { autoRefreshToken: false, persistSession: false } },
      );
      await alertCreditExhausted(alertClient, { fn: 'parse-event' });
      return new Response(JSON.stringify({ error: 'ai_unavailable' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
