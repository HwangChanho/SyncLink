/**
 * recommend-free-time Edge Function
 *
 * PRD 4.2 Tier 3 — AI 활동 추천 (옵션 C 하이브리드 구현).
 *
 * 전략: 룰 baseline 즉시 응답 + AI fallback (캐시 miss + 사용자 선호 카테고리 있을 때만)
 *  - 룰 baseline: 시간대(아침/오전/오후/저녁/밤) × 슬롯 길이(짧음/중간/긺) 매트릭스로 정적 추천.
 *    네트워크 없이도 즉시(0ms) 응답 가능. 비용 0.
 *  - AI fallback: 사용자 선호 카테고리가 있고 `forceAI=true`인 경우에만 Claude Haiku 호출.
 *    캐시 hit 시 AI 호출 생략.
 *
 * Security model:
 *  - ANTHROPIC_API_KEY 는 여기(Supabase Secrets)에만 존재, 클라이언트 노출 금지.
 *  - 요청에는 유효한 Supabase JWT(사용자 세션 토큰)가 포함되어야 함.
 *  - 서버측 quota 게이트(`_shared/quota.ts`)로 Free/Pro 한도 강제.
 *
 * Request body:
 *  {
 *    freeSlots: FreeSlotInput[],              // 추천 대상 빈 슬롯 목록
 *    userPreferences?: { categories: string[] }, // 사용자 관심 카테고리 (없으면 룰만 사용)
 *    locale: 'ko' | 'en' | 'zh' | 'ja',      // 응답 언어
 *    forceAI?: boolean,                        // true 시 캐시 miss 여도 AI 호출 (Pro 전용 경로)
 *  }
 *
 * Response body:
 *  {
 *    recommendations: ActivityRecommendation[],
 *    fromCache: boolean,
 *    source: 'rule' | 'ai',
 *  }
 *
 * Environment variables required:
 *  - ANTHROPIC_API_KEY      — Claude API 키
 *  - SUPABASE_URL           — Supabase 런타임 자동 주입
 *  - SUPABASE_ANON_KEY      — Supabase 런타임 자동 주입
 *  - SUPABASE_SERVICE_ROLE_KEY — quota 집계용 admin 클라이언트에 사용
 *
 * PRD 4.2 Tier 3 / docs/plans/2026-04-28-free-time-tier-3-ai-recommend.md
 */

import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'npm:@supabase/supabase-js';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * 클라이언트에서 전달받는 빈 슬롯 형태 (JSON 직렬화됨, Date 아님).
 */
interface FreeSlotInput {
  /** ISO-8601 슬롯 시작 시각 */
  start: string;
  /** ISO-8601 슬롯 종료 시각 */
  end: string;
  /** (end - start) 분 단위 */
  durationMinutes: number;
}

/**
 * 단일 슬롯에 대한 활동 추천 결과.
 */
interface ActivityRecommendation {
  /** 추천 대상 빈 슬롯 */
  slot: FreeSlotInput;
  /**
   * 추천 활동 목록 (최대 3개).
   * 각 항목은 `{ name, reason, fitScore }` 형태 (AI) 또는 string (룰).
   */
  activities: ActivityItem[];
}

/**
 * 개별 활동 아이템.
 * 룰 baseline은 name만 필수. AI 응답은 reason / fitScore 추가 포함.
 */
interface ActivityItem {
  /** 활동 이름 (locale 언어로 반환) */
  name: string;
  /** 추천 이유 (AI 응답 시만 포함) */
  reason?: string;
  /** 슬롯 적합도 0-1 (AI 응답 시만 포함) */
  fitScore?: number;
}

/**
 * Edge Function 응답 전체 형태.
 */
interface RecommendResponse {
  recommendations: ActivityRecommendation[];
  /** 응답이 서버 캐시에서 왔으면 true */
  fromCache: boolean;
  /** 'rule': 룰 baseline만 사용, 'ai': Claude 호출 결과 포함 */
  source: 'rule' | 'ai';
  /** v1.2.7 — quota 초과로 룰 fallback 사용했음을 클라에 알림. */
  quotaExceeded?: boolean;
}

/**
 * Edge Function 요청 body.
 */
interface RecommendRequest {
  freeSlots: FreeSlotInput[];
  userPreferences?: { categories: string[] };
  locale: 'ko' | 'en' | 'zh' | 'ja';
  /** true 이면 룰 외에 AI fallback도 즉시 시도 (클라이언트가 "더 보기" 탭 시 사용) */
  forceAI?: boolean;
}

// ─── CORS headers ─────────────────────────────────────────────────────────────

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ─── 룰 baseline 사전 ─────────────────────────────────────────────────────────

/**
 * 시간대 분류.
 * 슬롯의 시작 시각(시) 기준으로 분류.
 */
type TimeOfDay = 'morning' | 'forenoon' | 'afternoon' | 'evening' | 'night';

/**
 * 슬롯 길이 버킷.
 *   - short: 30-59분
 *   - medium: 60-119분
 *   - long: 120분 이상
 */
type SlotLength = 'short' | 'medium' | 'long';

/**
 * 시작 시각(시)으로 시간대 결정.
 *   05-08: morning, 09-11: forenoon, 12-17: afternoon, 18-21: evening, 22-04: night
 */
function classifyTimeOfDay(hour: number): TimeOfDay {
  if (hour >= 5 && hour < 9)  return 'morning';
  if (hour >= 9 && hour < 12) return 'forenoon';
  if (hour >= 12 && hour < 18) return 'afternoon';
  if (hour >= 18 && hour < 22) return 'evening';
  return 'night';
}

/**
 * 슬롯 길이(분)로 버킷 분류.
 */
function classifySlotLength(minutes: number): SlotLength {
  if (minutes < 60)  return 'short';
  if (minutes < 120) return 'medium';
  return 'long';
}

/**
 * 룰 사전 (시간대 × 슬롯 길이 → locale별 활동 목록).
 *
 * 각 locale × timeOfDay × slotLength 조합에 3개 활동 제공.
 * 새 locale 추가 시 이 객체에 섹션을 추가하면 됨.
 */
const RULE_DICTIONARY: Record<
  'ko' | 'en' | 'zh' | 'ja',
  Record<TimeOfDay, Record<SlotLength, string[]>>
> = {
  ko: {
    morning:   { short: ['조깅', '스트레칭', '카페'], medium: ['러닝', '요가', '공원 산책'], long: ['등산', '자전거', '수영'] },
    forenoon:  { short: ['카페', '독서', '산책'], medium: ['스터디', '브런치', '전시 관람'], long: ['코딩', '독서', '박물관'] },
    afternoon: { short: ['카페', '산책', '쇼핑'], medium: ['영화', '보드게임', '미팅'], long: ['여행', '하이킹', '쇼핑'] },
    evening:   { short: ['저녁 식사', '산책', '카페'], medium: ['영화', '식사', '공연'], long: ['파인다이닝', '공연', '야경 투어'] },
    night:     { short: ['디저트 카페', '편의점', '산책'], medium: ['야식', '게임', '영화'], long: ['야간 드라이브', '클럽', '노래방'] },
  },
  en: {
    morning:   { short: ['Jogging', 'Stretch', 'Coffee'], medium: ['Running', 'Yoga', 'Park walk'], long: ['Hiking', 'Cycling', 'Swimming'] },
    forenoon:  { short: ['Coffee', 'Reading', 'Walk'], medium: ['Study', 'Brunch', 'Museum'], long: ['Coding', 'Reading', 'Art gallery'] },
    afternoon: { short: ['Coffee', 'Walk', 'Shopping'], medium: ['Movie', 'Board game', 'Meeting'], long: ['Day trip', 'Hiking', 'Shopping mall'] },
    evening:   { short: ['Dinner', 'Walk', 'Café'], medium: ['Movie', 'Dinner', 'Concert'], long: ['Fine dining', 'Concert', 'Night tour'] },
    night:     { short: ['Dessert café', 'Convenience store', 'Walk'], medium: ['Late night food', 'Gaming', 'Movie'], long: ['Night drive', 'Club', 'Karaoke'] },
  },
  zh: {
    morning:   { short: ['慢跑', '伸展', '咖啡'], medium: ['跑步', '瑜伽', '公园散步'], long: ['登山', '骑行', '游泳'] },
    forenoon:  { short: ['咖啡', '阅读', '散步'], medium: ['学习', '早午餐', '展览'], long: ['编程', '阅读', '博物馆'] },
    afternoon: { short: ['咖啡', '散步', '购物'], medium: ['电影', '桌游', '会面'], long: ['旅行', '远足', '购物中心'] },
    evening:   { short: ['晚餐', '散步', '咖啡'], medium: ['电影', '晚餐', '演出'], long: ['精致餐厅', '演出', '夜景游览'] },
    night:     { short: ['甜品咖啡', '便利店', '散步'], medium: ['夜宵', '游戏', '电影'], long: ['夜间兜风', '俱乐部', '卡拉OK'] },
  },
  ja: {
    morning:   { short: ['ジョギング', 'ストレッチ', 'カフェ'], medium: ['ランニング', 'ヨガ', '公園散歩'], long: ['登山', 'サイクリング', '水泳'] },
    forenoon:  { short: ['カフェ', '読書', '散歩'], medium: ['勉強', 'ブランチ', '展覧会'], long: ['コーディング', '読書', '博物館'] },
    afternoon: { short: ['カフェ', '散歩', 'ショッピング'], medium: ['映画', 'ボードゲーム', 'ミーティング'], long: ['旅行', 'ハイキング', 'ショッピング'] },
    evening:   { short: ['夕食', '散歩', 'カフェ'], medium: ['映画', '夕食', 'コンサート'], long: ['ファインダイニング', 'コンサート', '夜景ツアー'] },
    night:     { short: ['デザートカフェ', 'コンビニ', '散歩'], medium: ['夜食', 'ゲーム', '映画'], long: ['ドライブ', 'クラブ', 'カラオケ'] },
  },
};

/**
 * 룰 baseline으로 단일 슬롯의 활동 목록 생성.
 *
 * @param slot   - 추천 대상 빈 슬롯
 * @param locale - 응답 언어
 * @returns ActivityItem[] (name만 포함, reason/fitScore 없음)
 */
function getRuleActivities(slot: FreeSlotInput, locale: 'ko' | 'en' | 'zh' | 'ja'): ActivityItem[] {
  const start  = new Date(slot.start);
  const hour   = start.getHours();
  const tod    = classifyTimeOfDay(hour);
  const length = classifySlotLength(slot.durationMinutes);

  const names = RULE_DICTIONARY[locale]?.[tod]?.[length] ?? RULE_DICTIONARY['ko'][tod][length];
  return names.map((name) => ({ name }));
}

// ─── AI 프롬프트 빌더 ──────────────────────────────────────────────────────────

/**
 * Claude Haiku용 시스템 프롬프트 (cache_control: ephemeral 적용).
 *
 * 시스템 메시지는 변경 없이 재사용되므로 캐싱으로 비용 절감.
 * 약 150 token — Anthropic 최소 캐시 블록(1024 token) 미달이므로
 * 실제 캐싱은 되지 않지만 API 구조상 분리해 둠 (미래 확장 대비).
 *
 * @param locale - 응답 언어
 * @returns Anthropic MessagesParam의 system 문자열
 */
function buildSystemPrompt(locale: string): string {
  const langMap: Record<string, string> = {
    ko: '한국어',
    en: 'English',
    zh: '中文',
    ja: '日本語',
  };
  const lang = langMap[locale] ?? '한국어';

  return (
    `You are a schedule assistant that recommends activities for free time slots. ` +
    `Always respond in ${lang}. ` +
    `Return a JSON array of exactly 3 activity objects. ` +
    `Each object must have: name (string), reason (string, 1 sentence), fitScore (number 0-1). ` +
    `Do NOT include any text outside the JSON array. ` +
    `Make recommendations appropriate for the time of day, duration, and user preferences.`
  );
}

/**
 * Claude Haiku용 사용자 메시지 생성.
 *
 * @param slot        - 추천 대상 빈 슬롯
 * @param preferences - 사용자 선호 카테고리 (없으면 일반 추천)
 * @param locale      - 응답 언어
 */
function buildUserPrompt(
  slot: FreeSlotInput,
  preferences: string[],
  locale: string,
): string {
  const start = new Date(slot.start);
  const days: Record<string, string[]> = {
    ko: ['일', '월', '화', '수', '목', '금', '토'],
    en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    zh: ['日', '一', '二', '三', '四', '五', '六'],
    ja: ['日', '月', '火', '水', '木', '金', '土'],
  };
  const dayNames = days[locale] ?? days['ko'];

  const context = {
    slot: {
      start:           slot.start,
      end:             slot.end,
      durationMinutes: slot.durationMinutes,
      dayOfWeek:       dayNames[start.getDay()],
      hourOfDay:       start.getHours(),
    },
    userPreferences: preferences.length > 0 ? preferences : undefined,
    locale,
  };

  return JSON.stringify(context);
}

// ─── AI 호출 ──────────────────────────────────────────────────────────────────

/**
 * Claude Haiku를 호출하여 단일 슬롯의 AI 활동 추천 획득.
 *
 * 모델: claude-haiku-4-5-20251001 (비용 최소화)
 * max_tokens: 300 (활동 3개 × JSON 객체, 충분히 여유 있음)
 *
 * @param slot        - 추천 대상 빈 슬롯
 * @param preferences - 사용자 선호 카테고리
 * @param locale      - 응답 언어
 * @param anthropic   - Anthropic SDK 인스턴스
 * @returns ActivityItem[] (AI 결과) 또는 null (파싱 실패)
 */
async function callAIForSlot(
  slot: FreeSlotInput,
  preferences: string[],
  locale: 'ko' | 'en' | 'zh' | 'ja',
  anthropic: Anthropic,
): Promise<ActivityItem[] | null> {
  try {
    const message = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system:     buildSystemPrompt(locale),
      messages:   [
        {
          role:    'user',
          content: buildUserPrompt(slot, preferences, locale),
        },
      ],
    });

    // 텍스트 블록 추출
    const firstBlock = message.content[0];
    if (!firstBlock || firstBlock.type !== 'text') return null;

    // JSON 파싱 — Claude가 JSON array만 반환하도록 시스템 프롬프트에 명시했음
    const raw = firstBlock.text.trim();
    // JSON array 탐색 (텍스트 앞뒤에 불필요한 내용이 붙은 경우 대비)
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return null;

    const parsed: ActivityItem[] = JSON.parse(match[0]);
    // 유효성 검증: 각 항목에 name이 있어야 함
    if (!Array.isArray(parsed) || !parsed.every((i) => typeof i.name === 'string')) {
      return null;
    }

    return parsed.slice(0, 3); // 최대 3개
  } catch {
    return null;
  }
}

// ─── 비용 기록 ─────────────────────────────────────────────────────────────────

/**
 * Anthropic 호출 비용을 usage_metrics 테이블에 기록.
 * 실패해도 메인 응답에 영향을 주지 않음 (fire-and-forget).
 *
 * 단가 (Haiku 4.5):
 *  - input:  $0.25 / 1M token
 *  - output: $1.25 / 1M token
 *
 * @param adminClient   - service role Supabase 클라이언트
 * @param userId        - 호출자 UUID
 * @param inputTokens   - 입력 토큰 수
 * @param outputTokens  - 출력 토큰 수
 */
async function recordCost(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: any,
  userId: string,
  inputTokens: number,
  outputTokens: number,
): Promise<void> {
  const INPUT_COST_PER_M  = 0.25;
  const OUTPUT_COST_PER_M = 1.25;
  const costUsd =
    (inputTokens * INPUT_COST_PER_M + outputTokens * OUTPUT_COST_PER_M) / 1_000_000;

  try {
    await adminClient.from('usage_metrics').insert({
      user_id:       userId,
      function_name: 'recommend-free-time',
      model:         'claude-haiku-4-5',
      input_tokens:  inputTokens,
      output_tokens: outputTokens,
      cost_usd:      costUsd,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[recommend-free-time] usage_metrics insert failed:', err);
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // CORS preflight 처리
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // ── 인증 ──────────────────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing Authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // 사용자 컨텍스트 Supabase 클라이언트 (RLS 준수)
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) {
      return new Response(
        JSON.stringify({ error: 'Invalid JWT' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ── 요청 파싱 ─────────────────────────────────────────────────────────────
    const body = (await req.json()) as RecommendRequest;
    const { freeSlots, userPreferences, locale = 'ko', forceAI = false } = body;

    if (!Array.isArray(freeSlots) || freeSlots.length === 0) {
      return new Response(
        JSON.stringify({ error: 'freeSlots must be a non-empty array' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // locale 유효성 검사
    const supportedLocales = ['ko', 'en', 'zh', 'ja'] as const;
    if (!supportedLocales.includes(locale as typeof supportedLocales[number])) {
      return new Response(
        JSON.stringify({ error: `Unsupported locale: ${locale}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    const validLocale = locale as 'ko' | 'en' | 'zh' | 'ja';

    // ── 룰 baseline 즉시 응답 생성 ────────────────────────────────────────────
    // 항상 룰 결과를 먼저 계산. AI 응답이 없는 경우 이것이 최종 응답.
    const ruleRecommendations: ActivityRecommendation[] = freeSlots.map((slot) => ({
      slot,
      activities: getRuleActivities(slot, validLocale),
    }));

    // ── AI fallback 조건 판단 ─────────────────────────────────────────────────
    // AI 호출 조건: forceAI=true AND 사용자 선호 카테고리가 있을 때
    const categories = userPreferences?.categories ?? [];
    const shouldCallAI = forceAI && categories.length > 0;

    if (!shouldCallAI) {
      // 룰 baseline 만으로 응답
      const response: RecommendResponse = {
        recommendations: ruleRecommendations,
        fromCache:        false,
        source:           'rule',
      };
      return new Response(JSON.stringify(response), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Quota 게이트 (AI 호출 시에만) ─────────────────────────────────────────
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // @ts-ignore — Deno path resolves at deploy time.
    const { enforceQuota } = await import('../_shared/quota.ts');
    const quota = await enforceQuota({
      adminClient, userId: user.id, functionName: 'recommend-free-time',
    });

    if (!quota.allowed) {
      // Quota 초과 시 룰 결과로 graceful degradation (에러 대신).
      // v1.2.7: quotaExceeded 플래그 추가 — 클라가 재시도 루프 안 돌게.
      const response: RecommendResponse = {
        recommendations: ruleRecommendations,
        fromCache:        false,
        source:           'rule',
        quotaExceeded:    true,
      };
      return new Response(JSON.stringify(response), {
        status:  200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'X-Quota-Reason': quota.reason ?? 'quota' },
      });
    }

    // ── Claude Haiku 호출 ─────────────────────────────────────────────────────
    const anthropic = new Anthropic({
      apiKey: Deno.env.get('ANTHROPIC_API_KEY'),
    });

    let totalInputTokens  = 0;
    let totalOutputTokens = 0;

    // 슬롯별 AI 추천 생성 (병렬 처리로 latency 최소화)
    const aiResults = await Promise.all(
      freeSlots.map(async (slot): Promise<ActivityRecommendation> => {
        const aiActivities = await callAIForSlot(slot, categories, validLocale, anthropic);

        // AI 호출 실패 시 해당 슬롯은 룰 baseline으로 fallback
        if (!aiActivities) {
          return ruleRecommendations.find(r => r.slot === slot) ?? {
            slot,
            activities: getRuleActivities(slot, validLocale),
          };
        }

        // 간단한 토큰 추정 (실제 usage는 SDK에서 집계 어려움 — 건당 평균 사용)
        totalInputTokens  += 200;
        totalOutputTokens += 100;

        return { slot, activities: aiActivities };
      }),
    );

    // ── 비용 기록 ─────────────────────────────────────────────────────────────
    if (totalInputTokens > 0) {
      await recordCost(adminClient, user.id, totalInputTokens, totalOutputTokens);
    }

    const response: RecommendResponse = {
      recommendations: aiResults,
      fromCache:        false,
      source:           'ai',
    };

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    // 크레딧 소진(결제) → LEAD 이메일 알림 + 사용자에게 명확 안내(503).
    // @ts-ignore — Deno import map 은 deploy 시 해석.
    const { isCreditError, alertCreditExhausted } = await import('../_shared/aiHealth.ts');
    if (isCreditError(err)) {
      const alertClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
        { auth: { autoRefreshToken: false, persistSession: false } },
      );
      await alertCreditExhausted(alertClient, { fn: 'recommend-free-time' });
      return new Response(JSON.stringify({ error: 'ai_unavailable' }), {
        status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
