/**
 * Natural language patterns for Korean event input parsing.
 *
 * This file centralises all locale-specific regex patterns used by nlParser.ts.
 * Edit here to add, fix, or extend Korean natural language recognition —
 * no need to touch the parsing logic in nlParser.ts.
 *
 * Structure:
 *  - DATE_PATTERNS     — relative/absolute date expressions
 *  - TIME_PATTERNS     — time-of-day expressions
 *  - LOCATION_PATTERNS — place extraction
 *  - RECURRENCE_PATTERNS — repeating event expressions
 *  - WEEKDAY_MAP       — Korean weekday → JS day number
 *  - AMPM_PERIOD_MAP   — period keyword → AM/PM behaviour
 */

// ─── Date patterns ────────────────────────────────────────────────────────────

/**
 * Korean date expressions.
 * Ordered from most-specific to least-specific; apply in this order inside
 * parseLocally() to avoid partial overlaps.
 *
 * To add a new pattern, insert it at the correct specificity position and
 * handle it in the switch/if chain in nlParser.ts:parseDatePart().
 */
export const DATE_PATTERNS = {
  /** 오늘 — today */
  today:       /오늘/,
  /** 내일 — tomorrow */
  tomorrow:    /내일/,
  /** 모레 — day after tomorrow */
  dayAfter:    /모레/,
  /** 이번 주 X요일 — this week's weekday */
  thisWeekday: /이번\s*주\s*(월|화|수|목|금|토|일)요일/,
  /** 다음 주 X요일 — next week's weekday */
  nextWeekday: /다음\s*주\s*(월|화|수|목|금|토|일)요일/,
  /** N월 N일 — explicit month/day */
  monthDay:    /(\d{1,2})월\s*(\d{1,2})일/,
  /** N일 후 — N days later */
  daysLater:   /(\d+)\s*일\s*후/,
  /** N주 후 — N weeks later */
  weeksLater:  /(\d+)\s*주\s*후/,
  /** N달 후 — N months later */
  monthsLater: /(\d+)\s*달\s*후/,
  /** N번째 X요일 — Nth weekday of the month */
  nthWeekday:  /(\d+)번째\s*(월|화|수|목|금|토|일)요일/,
} as const;

// ─── Time patterns ────────────────────────────────────────────────────────────

/**
 * Korean time-of-day expressions.
 *
 * "반" = 30 minutes (e.g. "오후 3시 반" = 15:30).
 * ampm covers 새벽(dawn)/오전(AM)/오후(PM)/저녁(evening)/밤(night).
 *
 * To support a new period keyword, add it to the ampm alternation group AND
 * update AMPM_PERIOD_MAP below.
 */
export const TIME_PATTERNS = {
  /** (새벽|오전|오후|저녁|밤) Nh [Mm | 반] */
  ampm:        /(새벽|오전|오후|저녁|밤)\s*(\d{1,2})시(?:\s*(\d{1,2})분|\s*(반))?/,
  /** Nh [Mm] — bare hour, no period keyword */
  hourOnly:    /(\d{1,2})시(?:\s*(\d{1,2})분)?/,
  /** N:MM — 24-hour colon format */
  colonFormat: /(\d{1,2}):(\d{2})/,
  /** 정오 or 낮 12시 — noon */
  noon:        /정오|낮\s*12시/,
  /** 자정 or 밤 12시 — midnight */
  midnight:    /자정|밤\s*12시/,
  /** Nh [Mm] ~ Nh [Mm] — time range */
  range:       /(\d{1,2})시(?:\s*(\d{1,2})분)?\s*(?:~|부터|에서)\s*(\d{1,2})시(?:\s*(\d{1,2})분)?/,
} as const;

// ─── Location patterns ────────────────────────────────────────────────────────

/**
 * Patterns for extracting location text from an event description.
 * meetAt is more specific than atPlace — check it first.
 */
export const LOCATION_PATTERNS = {
  /** X에서 만 — "meet at X" */
  meetAt:        /(\S+(?:\s+\S+)?)\s*에서\s*만/,
  /** X에서 — "at X" */
  atPlace:       /(\S+(?:\s+\S+)?)\s*에서/,
  /** X으로/로/에 가/이동 — "go to X" */
  goTo:          /(\S+(?:\s+\S+)?)\s*(?:에|으로|로)\s*(?:가|이동)/,
  /** (X) — parenthetical location hint */
  parenthetical: /\(([^)]+)\)/,
} as const;

// ─── Recurrence patterns ──────────────────────────────────────────────────────

/**
 * Korean recurring event keywords.
 * Checked most-specific first: yearly → monthly → weekly → daily.
 */
export const RECURRENCE_PATTERNS = {
  /** 매일 — daily */
  daily:   /매일/,
  /** 매주 — weekly */
  weekly:  /매주/,
  /** 매월 or 매달 — monthly */
  monthly: /매월|매달/,
  /** 매년 or 매해 — yearly */
  yearly:  /매년|매해/,
} as const;

// ─── Weekday map ──────────────────────────────────────────────────────────────

/**
 * Maps a Korean weekday character to JS Date.getDay() value (0 = Sunday).
 * Used by both thisWeekday and nextWeekday matchers.
 */
export const WEEKDAY_MAP: Record<string, number> = {
  월: 1,
  화: 2,
  수: 3,
  목: 4,
  금: 5,
  토: 6,
  일: 0,
};

// ─── AM/PM period map ─────────────────────────────────────────────────────────

/**
 * Defines how each period keyword affects the parsed hour.
 *
 *  isPm    — if true, add 12 to the hour (unless already >= 12)
 *  isAm    — if true, treat the hour as-is (0–11); 12 → 0
 *  isDawn  — 새벽: hours stay as entered (1–5 are already AM); 새벽 12시 = 0
 *
 * Special case: 오전 12시 = midnight (0), 오후 12시 = noon (12).
 */
export const AMPM_PERIOD_MAP = {
  새벽: { isPm: false, isAm: true,  isDawn: true  },
  오전: { isPm: false, isAm: true,  isDawn: false },
  오후: { isPm: true,  isAm: false, isDawn: false },
  저녁: { isPm: true,  isAm: false, isDawn: false },
  밤:   { isPm: true,  isAm: false, isDawn: false },
} as const;
