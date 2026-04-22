/**
 * SyncLink business constants and runtime configuration.
 *
 * These values drive business rules and must be consistent across
 * the app and Edge Functions. Changes here may require corresponding
 * changes in supabase/functions/.
 *
 * IMPORTANT: Do not put secrets here. Use environment variables for secrets.
 */

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
  PARSE_EVENT:     'parse-event',
  SMART_REMINDER:  'smart-reminder',
  WEEKLY_REVIEW:   'weekly-review',
  DATE_RECOMMEND:  'date-recommend',
  SUGGEST_DATE:    'suggest-date',
} as const;
