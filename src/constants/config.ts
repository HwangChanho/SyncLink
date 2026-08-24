/**
 * SyncLink business constants and runtime configuration.
 *
 * These values drive business rules and must be consistent across
 * the app and Edge Functions. Changes here may require corresponding
 * changes in supabase/functions/.
 *
 * IMPORTANT: Do not put secrets here. Use environment variables for secrets.
 */

// ─── Brand ────────────────────────────────────────────────────────────────────

/**
 * 사용자에게 보이는 앱 이름.
 *
 * 화면마다 하드코딩하면 리브랜딩 때 반드시 몇 곳이 남는다 — 실제로 1.4.0 리브랜딩이
 * App Store 설명 본문, 위젯 라벨, 웹 <title>, 그리고 앱 UI 6곳을 놓쳤고 그 상태로
 * 2주를 나갔다. 브랜드명을 쓸 일이 생기면 이 상수를 쓸 것.
 *
 * i18n 문자열 안의 브랜드명은 ko/en/ja/zh 모두 같은 값이라 로케일 분기가 필요 없다.
 * ⚠️ app.json 의 `expo.name` 은 별개다 — 한글로 바꾸면 prebuild 가 Xcode 프로젝트를
 *    개명해 fastlane 경로와 AppGroupBridge 가 깨진다. 그건 "SyncLink" 로 둔다.
 */
export const APP_BRAND = '투투리스트';

// ─── AI Usage Limits ──────────────────────────────────────────────────────────

/** Free tier: max AI (Claude API) calls per day per user. */
export const FREE_AI_DAILY_LIMIT = 5;

/**
 * Confidence threshold below which local parser triggers AI fallback.
 * If NLParseResult.confidence === 'low', call the Edge Function.
 */
export const AI_FALLBACK_CONFIDENCE_THRESHOLD = 'low' as const;

/** Maximum tokens sent to Claude Haiku per NL parse request. */
export const NL_PARSE_MAX_INPUT_TOKENS = 250;
export const NL_PARSE_MAX_OUTPUT_TOKENS = 150;

// ─── Space Limits ─────────────────────────────────────────────────────────────

/** Free tier: max number of spaces a user can belong to. */
export const SPACE_FREE_MAX = 3;

/** Couple-type spaces are hard-limited to 2 members. */
export const COUPLE_SPACE_MAX_MEMBERS = 2;

// ─── Calendar ─────────────────────────────────────────────────────────────────

/** Default number of days shown in the free-time finder range picker. */
export const FREE_TIME_DEFAULT_RANGE_DAYS = 7;

/** Minimum free-time slot duration (minutes) shown in the finder. */
export const FREE_TIME_MIN_SLOT_MINUTES = 60;

// ─── Supabase Realtime ────────────────────────────────────────────────────────

/** Milliseconds to wait before attempting realtime reconnect. */
export const REALTIME_RECONNECT_DELAY_MS = 3000;

/** Max reconnect attempts before showing offline banner. */
export const REALTIME_MAX_RECONNECT_ATTEMPTS = 5;

// ─── Event CRUD ───────────────────────────────────────────────────────────────

/** Maximum event title length (DB constraint: 255 chars). */
export const EVENT_TITLE_MAX_LENGTH = 100;

/** Maximum event description length. */
export const EVENT_DESCRIPTION_MAX_LENGTH = 1000;

/** How many days in the future to fetch events for the home screen. */
export const HOME_UPCOMING_DAYS = 7;

// ─── Invite Codes ─────────────────────────────────────────────────────────────

/** Length of the space invite code. Must match DB check constraint. */
export const INVITE_CODE_LENGTH = 6;

/** Allowed characters in invite codes (unambiguous set). */
export const INVITE_CODE_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// ─── API Endpoints ────────────────────────────────────────────────────────────

/** Edge Function names (called via supabase.functions.invoke()). */
export const EDGE_FUNCTIONS = {
  PARSE_EVENT:          'parse-event',
  SMART_REMINDER:       'smart-reminder',
  WEEKLY_REVIEW:        'weekly-review',
  DATE_RECOMMEND:       'date-recommend',
  SUGGEST_DATE:         'suggest-date',
  RECOMMEND_FREE_TIME:  'recommend-free-time',
  /** v1.1 Phase 1 — STT 전사 결과를 AI 가 한 번 보정하는 mini call. */
  DISAMBIGUATE_VOICE:   'disambiguate-voice',
} as const;

// ─── Free Time Recommendations (PRD 4.2 Tier 3) ──────────────────────────────

/**
 * Free 플랜: 월간 AI 추천 허용 횟수.
 * 클라이언트 subscriptionStore에서 월별 누적 추적.
 * 서버 quota(quota.ts)는 일별로 별도 강제.
 */
export const FREE_REC_MONTHLY_LIMIT = 5;

/**
 * Pro 플랜: 주간 AI 추천 허용 횟수.
 * 매주 월요일 초기화. 실질적으로 무제한에 가까운 넉넉한 값.
 */
export const PRO_REC_WEEKLY_LIMIT = 50;

/** AsyncStorage 키: 추천 횟수 추적 */
export const REC_QUOTA_STORAGE_KEY = 'synclink:rec_quota';
