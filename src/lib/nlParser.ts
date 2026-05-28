/**
 * Local NL (Natural Language) parser for Korean event input.
 *
 * Target: parse 90% of typical user inputs without any API call.
 * Performance target: < 10ms per parse.
 *
 * Supported patterns:
 *  - Date: 오늘, 내일, 모레, 이번 주 X요일, 다음 주 X요일, N월 N일, N일/주/달 후, N번째 X요일
 *  - Time: 오전/오후/밤/저녁/새벽 N시, N시 N분, N:MM, 정오, 자정, 시간 범위
 *  - Location: ~에서, ~에서 만나, (parenthetical), ~으로/로/에 가/이동
 *  - Recurrence: 매일, 매주, 매월/매달, 매년/매해
 */

import type { NLParseResult, Confidence, ParsedField } from '@/types';

// ─── Pattern constants ────────────────────────────────────────────────────────

/**
 * Regex patterns for Korean date expressions.
 * Ordered from most to least specific — use in parseLocally() in this order.
 */
export const datePatterns = {
  today:       /오늘/,
  // "낼" is a colloquial alias for "내일" — accept both so casual input works.
  // Word-boundary not needed because Korean uses syllable units; matching
  // first occurrence is fine and the consumed-range tracker will dedupe.
  tomorrow:    /내일|낼(?!\s*모레)/,    // "낼 모레" should still match dayAfter (모레), not tomorrowAlt
  dayAfter:    /모레/,
  thisWeekday: /이번\s*주\s*(월|화|수|목|금|토|일)요일/,
  // Two-week-out (다다음 주) must come BEFORE nextWeekday in execution order
  // because "다다음" contains "다음" — a non-anchored regex would match the
  // tail and silently drop one week (Build-50 NL audit, case H2).
  afterNextWeekday: /다다음\s*주\s*(월|화|수|목|금|토|일)요일/,
  nextWeekday: /다음\s*주\s*(월|화|수|목|금|토|일)요일/,
  monthDay:    /(\d{1,2})월\s*(\d{1,2})일/,
  daysLater:   /(\d+)\s*일\s*후/,
  weeksLater:  /(\d+)\s*주\s*후/,
  monthsLater: /(\d+)\s*달\s*후/,
  nthWeekday:  /(\d+)번째\s*(월|화|수|목|금|토|일)요일/,
  // Past-date markers — we explicitly DETECT these so the parser can
  // reject the input with confidence='low' instead of silently parsing
  // the time and using today's date (Build-50 NL audit, case G1/G2).
  past:        /어제|지난\s*주|작년|지난\s*달|지난\s*해/,
} as const;

/**
 * Regex patterns for Korean time expressions.
 * ampm also handles 새벽/저녁/밤 (dawn/evening/night) for full coverage.
 * "반" (half) = 30 minutes.
 */
export const timePatterns = {
  ampm:        /(새벽|오전|오후|저녁|밤)\s*(\d{1,2})시(?:\s*(\d{1,2})분|\s*(반))?/,
  hourOnly:    /(\d{1,2})시(?:\s*(\d{1,2})분)?/,
  colonFormat: /(\d{1,2}):(\d{2})/,
  noon:        /정오|낮\s*12시/,
  midnight:    /자정|밤\s*12시/,
  // Build-50 NL audit (case B2 fix): the start side of the range now
  // accepts an optional AM/PM prefix (오후/오전/저녁/…) and we propagate
  // it to the end side too when the end didn't carry its own prefix.
  // Without this, "오후 2시부터 4시까지" was parsed as 02:00–04:00.
  range:       /(?:(새벽|오전|오후|저녁|밤)\s*)?(\d{1,2})시(?:\s*(\d{1,2})분)?\s*(?:~|부터|에서)\s*(?:(새벽|오전|오후|저녁|밤)\s*)?(\d{1,2})시(?:\s*(\d{1,2})분)?(?:\s*까지)?/,
} as const;

/**
 * Regex patterns for extracting location from text.
 * meetAt is checked before atPlace (more specific).
 */
export const locationExtractor = {
  atPlace:       /(\S+(?:\s+\S+)?)\s*에서/,
  meetAt:        /(\S+(?:\s+\S+)?)\s*에서\s*만/,
  goTo:          /(\S+(?:\s+\S+)?)\s*(?:에|으로|로)\s*(?:가|이동)/,
  parenthetical: /\(([^)]+)\)/,
} as const;

/**
 * Patterns for recurring event expressions.
 */
export const recurrencePatterns = {
  daily:   /매일/,
  // v1.2.8 — multi-day weekly. "평일", "주중", "주 N일 (3~5)", "매주 월수금",
  // "월수금", "월~금/월-금/월부터 금" 등. weeklyOn 보다 먼저 매칭 (구체 → 일반).
  weekdays:  /평일|주중|주\s*[3-5]\s*일/,
  weekend:   /주말|토일/,
  weeklyMulti: /매주\s*([월화수목금토일]{2,7})|([월화수목금토일]{2,7})\s*요일|([월화수목금토일])\s*[~∼\-부터]\s*([월화수목금토일])(?:요일|부터|까지)?/,
  // weeklyOn captures the weekday in "매주 X요일" so the resulting event
  // anchors on that day instead of on the user's input-day (Build-50 NL
  // audit, case B2 fix). Plain "매주" still works without a weekday.
  weeklyOn: /매주\s*(월|화|수|목|금|토|일)요일/,
  weekly:   /매주/,
  // monthlyDay captures "매월 N일 / 매달 N일" so the anchor day-of-month
  // is preserved (audit case B3). Plain "매월/매달" still works alone.
  monthlyDay: /(?:매월|매달)\s*(\d{1,2})\s*일/,
  monthly:    /매월|매달/,
  yearly:     /매년|매해/,
} as const;

// ─── Private helpers ──────────────────────────────────────────────────────────

/** Maps a Korean weekday character to JS getDay() value (0 = Sunday). */
function koreanDayToJsDay(dayChar: string): number {
  const map: Record<string, number> = {
    '월': 1, '화': 2, '수': 3, '목': 4, '금': 5, '토': 6, '일': 0,
  };
  return map[dayChar] ?? 1;
}

/**
 * Returns the date of "이번 주 X요일" relative to contextDate.
 * If the weekday is today or already passed, advances to next week.
 * (Korean week runs Mon–Sun; Sunday is treated as end-of-week.)
 *
 * Build-63 LEAD: "다음주랑 이번주도 구분 잘 못하는 거 같다" — 이전엔
 * 이미 지난 요일이면 자동으로 다음 주로 점프해서 "이번 주 화요일" 과
 * "다음 주 화요일" 이 같은 결과가 나왔다. 이제는 캘린더 주(Mon-Sun) 안의
 * 정확한 그 요일을 항상 반환 — 과거이면 과거 그대로, past-date guard 가
 * confidence='low' 처리.
 */
/**
 * Strip Korean particles + intent verbs that surround the actual title token.
 *
 * Examples (input → output):
 *  - "에 운동 등록할래"   → "운동"
 *  - "에서 점심 약속"      → "점심 약속"   (의미 있는 명사 유지)
 *  - "회의 잡아줘"         → "회의"
 *  - "운동 예약 부탁"      → "운동"
 *
 * 보수적 — 너무 많이 자르면 의미 손실. 명확히 무의미한 leading 조사
 * + trailing 의도 동사만 제거.
 */
function cleanTitle(s: string): string {
  let t = s;
  // Leading particles 가 단독 잔재로 남는 경우 (시간 패턴 직후 "에" 등)
  t = t.replace(/^(?:에서|에|은|는|이|가|을|를)\s+/, '');
  // Trailing 의도 동사 — "할래/할게/하자/할까/잡아/잡아줘/잡아주세요/등록해/
  // 등록할래/등록해줘/등록부탁/예약해/예약부탁/부탁해/부탁드려" 등
  const trailingIntent =
    /\s*(?:등록\s*(?:할래|해줘|해|할게|하자|부탁(?:해|드려|드립니다)?))$/;
  const trailingShort =
    /\s*(?:잡아\s*(?:줘|주세요)?|예약(?:해(?:줘|주세요)?|부탁)?|할래|할게|하자|할까|부탁(?:해|드려|드립니다)?)$/;
  // 두 번 적용 — "운동 등록 부탁해" 처럼 두 단어가 연속될 수 있음.
  for (let i = 0; i < 3; i++) {
    const before = t;
    t = t.replace(trailingIntent, '').trim();
    t = t.replace(trailingShort, '').trim();
    if (t === before) break;
  }
  return t;
}

function getThisWeekdayDate(contextDate: Date, targetJsDay: number): Date {
  const toOrder = (d: number) => (d === 0 ? 7 : d);
  const diff = toOrder(targetJsDay) - toOrder(contextDate.getDay());

  const ctx0 = new Date(contextDate);
  ctx0.setHours(0, 0, 0, 0);

  const target = new Date(ctx0);
  target.setDate(ctx0.getDate() + diff);

  // 이미 지난 요일이라도 다음 주로 점프하지 않음 — "이번 주" 의 의미를
  // 그대로 유지. 사용자가 과거 일정을 등록하려 하면 past-date guard 가
  // 별도로 confidence='low' 로 처리.
  return target;
}

/**
 * Returns the date of "다음 주 X요일".
 * Always refers to the following calendar week (Mon–Sun).
 */
function getNextWeekdayDate(contextDate: Date, targetJsDay: number): Date {
  const currentDay = contextDate.getDay();
  // Days until next Monday: if today is Monday → 7, otherwise (8 - currentDay) % 7
  const daysToNextMonday = ((1 - currentDay + 7) % 7) || 7;

  const nextMonday = new Date(contextDate);
  nextMonday.setHours(0, 0, 0, 0);
  nextMonday.setDate(contextDate.getDate() + daysToNextMonday);

  // Offset from Monday within the week (Mon=0 … Sun=6)
  const offset = targetJsDay === 0 ? 6 : targetJsDay - 1;
  const target = new Date(nextMonday);
  target.setDate(nextMonday.getDate() + offset);
  return target;
}

/**
 * Returns the Nth occurrence of a weekday in the current month.
 * If that date has already passed, uses the same Nth weekday of next month.
 */
function getNthWeekdayOfMonth(contextDate: Date, nth: number, targetJsDay: number): Date {
  const findInMonth = (year: number, month: number): Date => {
    const firstOfMonth = new Date(year, month, 1);
    let daysToFirst = targetJsDay - firstOfMonth.getDay();
    if (daysToFirst < 0) daysToFirst += 7;
    return new Date(year, month, 1 + daysToFirst + (nth - 1) * 7);
  };

  const ctx0 = new Date(contextDate);
  ctx0.setHours(0, 0, 0, 0);

  const candidate = findInMonth(contextDate.getFullYear(), contextDate.getMonth());
  if (candidate >= ctx0) return candidate;

  // Already passed → next month
  const nextMonth = new Date(contextDate.getFullYear(), contextDate.getMonth() + 1, 1);
  return findInMonth(nextMonth.getFullYear(), nextMonth.getMonth());
}

/** Convenience factory for ParsedField. */
function pf<T>(value: T, confidence: Confidence): ParsedField<T> {
  return { value, confidence };
}

// ─── Main parser ──────────────────────────────────────────────────────────────

/**
 * Parse natural language text into structured event fields.
 *
 * Entry point used by aiService.ts.  Always returns a result; never throws.
 * Returns confidence='low' when neither date nor time could be extracted —
 * the caller should fall back to AI parsing in that case.
 *
 * @param text        Raw Korean user input
 * @param contextDate Reference date for relative expressions (default: now)
 * @returns           NLParseResult — source is always 'local'
 *
 * @example
 * parseLocally('내일 오후 3시 카페에서 미팅', ctx)
 * // → { parsed: { title, startAt, endAt, location }, confidence: 'high', ... }
 */
export function parseLocally(text: string, contextDate: Date = new Date()): NLParseResult {
  const startMs = Date.now();
  const normalized = text.trim();

  // Empty input → low confidence immediately
  if (!normalized) {
    return {
      parsed: {},
      confidence: 'low',
      source: 'local',
      rawInput: text,
      processingMs: Date.now() - startMs,
    };
  }

  // ── Consumed-range tracking for title extraction ───────────────────────────
  // We replace consumed character ranges with spaces (length-preserving) so
  // that subsequent patterns can use original indices without recalculating.

  const consumed: [number, number][] = [];

  const consume = (match: RegExpExecArray): void => {
    consumed.push([match.index, match.index + match[0].length]);
  };

  /** Returns normalized text with all consumed ranges replaced by spaces. */
  const workingText = (): string => {
    const arr = normalized.split('');
    for (const [s, e] of consumed) {
      for (let i = s; i < e; i++) arr[i] = ' ';
    }
    return arr.join('');
  };

  // ── State variables ───────────────────────────────────────────────────────

  let parsedDate: Date | null = null;
  let dateConf: Confidence = 'low';
  let startHour: number | null = null;
  let startMin = 0;
  let endHour: number | null = null;
  let endMin = 0;
  let timeConf: Confidence = 'low';
  let location: string | null = null;
  let repeatType: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom_weekly' = 'none';
  let weeklyDays: number[] | null = null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RegExpExecArray | null
  let m: RegExpExecArray | null;

  // ── Step 0: Past-date guard ──────────────────────────────────────────────
  // If the input explicitly references a past day/week/month/year, abort
  // before extracting time so we don't silently schedule the event on
  // today's date (Build-50 audit, case G1/G2). Returning low confidence
  // makes the AI fallback (or the user) deal with intent directly.

  if (datePatterns.past.exec(normalized)) {
    return {
      parsed: {},
      confidence: 'low',
      source: 'local',
      rawInput: text,
      processingMs: Date.now() - startMs,
    };
  }

  // ── Step 1: Recurrence ────────────────────────────────────────────────────
  // Check most-specific patterns first to avoid partial overlaps:
  //   매년 > (매월 N일 > 매월) > (매주 X요일 > 매주) > 매일
  // We capture the anchor day/weekday alongside the repeat type when
  // present so the rendered event lands on the correct day.

  let weeklyAnchorDay: number | null = null;       // JS getDay() value
  let monthlyAnchorDayOfMonth: number | null = null;

  // v1.2.8 — multi-day weekly (custom_weekly) 가 가장 구체. yearly 보다 먼저.
  if ((m = recurrencePatterns.weekdays.exec(normalized))) {
    // "평일" / "주중" / "주 3~5일"
    repeatType  = 'custom_weekly';
    weeklyDays  = [1, 2, 3, 4, 5];
    consume(m);
  } else if ((m = recurrencePatterns.weekend.exec(normalized))) {
    // "주말" / "토일"
    repeatType  = 'custom_weekly';
    weeklyDays  = [0, 6];
    consume(m);
  } else if ((m = recurrencePatterns.weeklyMulti.exec(normalized))) {
    // "매주 월수금" / "월수금요일" / "월~금"
    const raw = m[1] ?? m[2];  // 연속 요일 그룹
    if (raw) {
      const days = new Set<number>();
      for (const ch of raw) days.add(koreanDayToJsDay(ch));
      if (days.size >= 2) {
        repeatType = 'custom_weekly';
        weeklyDays = Array.from(days).sort();
      } else {
        repeatType = 'weekly';
        weeklyAnchorDay = koreanDayToJsDay(raw);
      }
    } else if (m[3] && m[4]) {
      // "월~금" 같이 범위
      const from = koreanDayToJsDay(m[3]);
      const to   = koreanDayToJsDay(m[4]);
      const arr: number[] = [];
      // 0=일 ~ 6=토. from→to 순방향 wrap 처리.
      let cur = from;
      // 안전 cap: 최대 7회.
      for (let i = 0; i < 7; i += 1) {
        arr.push(cur);
        if (cur === to) break;
        cur = (cur + 1) % 7;
      }
      if (arr.length >= 2) {
        repeatType = 'custom_weekly';
        weeklyDays = arr.sort();
      }
    }
    consume(m);
  } else if ((m = recurrencePatterns.yearly.exec(normalized))) {
    repeatType = 'yearly'; consume(m);
  } else if ((m = recurrencePatterns.monthlyDay.exec(normalized))) {
    repeatType = 'monthly';
    monthlyAnchorDayOfMonth = parseInt(m[1]!, 10);
    consume(m);
  } else if ((m = recurrencePatterns.monthly.exec(normalized))) {
    repeatType = 'monthly'; consume(m);
  } else if ((m = recurrencePatterns.weeklyOn.exec(normalized))) {
    repeatType = 'weekly';
    weeklyAnchorDay = koreanDayToJsDay(m[1]!);
    consume(m);
  } else if ((m = recurrencePatterns.weekly.exec(normalized))) {
    repeatType = 'weekly'; consume(m);
  } else if ((m = recurrencePatterns.daily.exec(normalized))) {
    repeatType = 'daily'; consume(m);
  }

  // ── Step 2: Time range ────────────────────────────────────────────────────
  // Must run before location extraction — "X시에서 Y시" contains "에서" which
  // would otherwise be misidentified as a location marker.

  if ((m = timePatterns.range.exec(normalized))) {
    // Build-50 audit (B1) — the range pattern now captures optional
    // AM/PM prefixes for both ends. m[1] is the start prefix, m[4] the
    // end prefix; either may be undefined. When start has a prefix and
    // end doesn't, the end inherits it ("오후 2시부터 4시까지" → both PM).
    const startPeriod = m[1] as string | undefined;
    const endPeriod   = (m[4] ?? m[1]) as string | undefined;
    let sh = parseInt(m[2]!, 10);
    const sm = m[3] ? parseInt(m[3], 10) : 0;
    let eh = parseInt(m[5]!, 10);
    const em = m[6] ? parseInt(m[6], 10) : 0;
    const applyPeriod = (h: number, period: string | undefined): number => {
      if (!period) return h;
      if (period === '새벽' || period === '오전') return h === 12 ? 0 : h;
      // 오후 / 저녁 / 밤 → PM (12시는 정오 그대로)
      return h !== 12 ? h + 12 : h;
    };
    startHour = applyPeriod(sh, startPeriod);
    startMin  = sm;
    endHour   = applyPeriod(eh, endPeriod);
    endMin    = em;
    timeConf  = 'high';
    consume(m);
  }

  // ── Step 3: Date ──────────────────────────────────────────────────────────
  // Run patterns against working text (recurrence + time range already consumed).
  // More-specific patterns first; stop as soon as parsedDate is set.

  const wt3 = workingText();

  // "이번 주 X요일"
  if (!parsedDate && (m = datePatterns.thisWeekday.exec(wt3))) {
    parsedDate = getThisWeekdayDate(contextDate, koreanDayToJsDay(m[1]!));
    dateConf = 'high'; consume(m);
  }

  // "다다음 주 X요일" — must run before nextWeekday because "다다음" contains
  // "다음" and the simpler regex would otherwise match the tail.
  if (!parsedDate && (m = datePatterns.afterNextWeekday.exec(wt3))) {
    const nextWeek = getNextWeekdayDate(contextDate, koreanDayToJsDay(m[1]!));
    nextWeek.setDate(nextWeek.getDate() + 7); // bump one more week
    parsedDate = nextWeek;
    dateConf = 'high'; consume(m);
  }

  // "다음 주 X요일"
  if (!parsedDate && (m = datePatterns.nextWeekday.exec(wt3))) {
    parsedDate = getNextWeekdayDate(contextDate, koreanDayToJsDay(m[1]!));
    dateConf = 'high'; consume(m);
  }

  // "N번째 X요일" (Nth weekday of month)
  if (!parsedDate && (m = datePatterns.nthWeekday.exec(wt3))) {
    parsedDate = getNthWeekdayOfMonth(contextDate, parseInt(m[1]!, 10), koreanDayToJsDay(m[2]!));
    dateConf = 'medium'; consume(m);
  }

  // "N달 후"
  if (!parsedDate && (m = datePatterns.monthsLater.exec(wt3))) {
    const d = new Date(contextDate);
    d.setHours(0, 0, 0, 0);
    d.setMonth(d.getMonth() + parseInt(m[1]!, 10));
    parsedDate = d; dateConf = 'high'; consume(m);
  }

  // "N주 후"
  if (!parsedDate && (m = datePatterns.weeksLater.exec(wt3))) {
    const d = new Date(contextDate);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + parseInt(m[1]!, 10) * 7);
    parsedDate = d; dateConf = 'high'; consume(m);
  }

  // "N일 후"
  if (!parsedDate && (m = datePatterns.daysLater.exec(wt3))) {
    const d = new Date(contextDate);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + parseInt(m[1]!, 10));
    parsedDate = d; dateConf = 'high'; consume(m);
  }

  // "N월 N일"
  if (!parsedDate && (m = datePatterns.monthDay.exec(wt3))) {
    parsedDate = new Date(contextDate.getFullYear(), parseInt(m[1]!, 10) - 1, parseInt(m[2]!, 10), 0, 0, 0, 0);
    dateConf = 'high'; consume(m);
  }

  // "오늘"
  if (!parsedDate && (m = datePatterns.today.exec(wt3))) {
    const d = new Date(contextDate); d.setHours(0, 0, 0, 0);
    parsedDate = d; dateConf = 'high'; consume(m);
  }

  // "내일"
  if (!parsedDate && (m = datePatterns.tomorrow.exec(wt3))) {
    const d = new Date(contextDate); d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 1);
    parsedDate = d; dateConf = 'high'; consume(m);
  }

  // "모레"
  if (!parsedDate && (m = datePatterns.dayAfter.exec(wt3))) {
    const d = new Date(contextDate); d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 2);
    parsedDate = d; dateConf = 'high'; consume(m);
  }

  // ── Step 4: Time (single) ─────────────────────────────────────────────────
  // Only runs when no range was matched (startHour is still null).

  if (startHour === null) {
    const wt4 = workingText();

    // Midnight and noon first — most specific, unambiguous
    if ((m = timePatterns.midnight.exec(wt4))) {
      startHour = 0; startMin = 0; timeConf = 'high'; consume(m);
    } else if ((m = timePatterns.noon.exec(wt4))) {
      startHour = 12; startMin = 0; timeConf = 'high'; consume(m);
    }

    // AM/PM prefix with optional "반" (half = 30 min)
    if (startHour === null && (m = timePatterns.ampm.exec(wt4))) {
      const period = m[1]!;
      let h = parseInt(m[2]!, 10);
      // Group 4 captures "반" (half past), group 3 captures numeric minutes
      const min = m[4] === '반' ? 30 : (m[3] ? parseInt(m[3], 10) : 0);

      if (period === '새벽') {
        // Early morning: hours stay as-is; 새벽 12시 = midnight
        if (h === 12) h = 0;
      } else if (period === '오전') {
        // 오전 12시 edge case → treat as midnight (0)
        if (h === 12) h = 0;
      } else {
        // 오후 / 저녁 / 밤 → add 12 for PM; 오후 12시 = noon stays at 12
        if (h !== 12) h += 12;
      }

      startHour = h; startMin = min; timeConf = 'high'; consume(m);
    }

    // 24-hour colon format (e.g., "14:30")
    if (startHour === null && (m = timePatterns.colonFormat.exec(wt4))) {
      startHour = parseInt(m[1]!, 10);
      startMin  = parseInt(m[2]!, 10);
      timeConf  = 'high'; consume(m);
    }

    // Bare hour — ambiguous AM/PM → medium confidence
    if (startHour === null && (m = timePatterns.hourOnly.exec(wt4))) {
      startHour = parseInt(m[1]!, 10);
      startMin  = m[2] ? parseInt(m[2], 10) : 0;
      timeConf  = 'medium'; consume(m);
    }
  }

  // ── Step 5: Location ──────────────────────────────────────────────────────
  // Run against working text so already-consumed time/date tokens don't match.

  const wt5 = workingText();

  // meetAt is more specific than atPlace — check first
  if (!location && (m = locationExtractor.meetAt.exec(wt5))) {
    const place = (m[1] ?? '').trim();
    if (place) { location = place; consume(m); }
  }

  // Parenthetical, e.g. "(강남역)"
  if (!location && (m = locationExtractor.parenthetical.exec(wt5))) {
    const place = (m[1] ?? '').trim();
    if (place) { location = place; consume(m); }
  }

  // "X에서"
  if (!location && (m = locationExtractor.atPlace.exec(wt5))) {
    const place = (m[1] ?? '').trim();
    if (place) { location = place; consume(m); }
  }

  // "X으로/로/에 가/이동"
  if (!location && (m = locationExtractor.goTo.exec(wt5))) {
    const place = (m[1] ?? '').trim();
    if (place) { location = place; consume(m); }
  }

  // ── Step 5.5: Recurrence anchor → date  ───────────────────────────────────
  // When the user wrote "매주 X요일" or "매월 N일" but didn't specify an
  // explicit calendar date, anchor the first occurrence on the nearest
  // upcoming match so the rendered event lands on the right day.
  if (!parsedDate && weeklyAnchorDay !== null) {
    parsedDate = getThisWeekdayDate(contextDate, weeklyAnchorDay);
    dateConf = 'high';
  }
  if (!parsedDate && monthlyAnchorDayOfMonth !== null) {
    const ctx0 = new Date(contextDate);
    ctx0.setHours(0, 0, 0, 0);
    let d = new Date(ctx0.getFullYear(), ctx0.getMonth(), monthlyAnchorDayOfMonth);
    if (d < ctx0) {
      d = new Date(ctx0.getFullYear(), ctx0.getMonth() + 1, monthlyAnchorDayOfMonth);
    }
    parsedDate = d;
    dateConf = 'high';
  }

  // ── Step 6: Title — remaining text after all extractions ──────────────────

  let titleRaw = workingText().replace(/\s+/g, ' ').trim();

  // Build-63 LEAD: "이번주 화요일 오후 7시에 운동 등록할래" → 결과가
  // "에 운동 등록" 같은 잔재로 떴다. 시간 패턴 뒤 leading "에/에서",
  // 그리고 trailing 의도 동사 ("등록할래/할래/잡아줘/예약" 등) 를 정리.
  titleRaw = cleanTitle(titleRaw);

  // ── Step 7: Overall confidence ────────────────────────────────────────────

  const hasDate = parsedDate !== null;
  const hasTime = startHour !== null;

  let confidence: Confidence;
  if (hasDate && hasTime) {
    confidence = 'high';
  } else if (hasDate || hasTime) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }

  // ── Step 8: Build ParsedEventFields ───────────────────────────────────────
  // startAt confidence: 'high' only when both date and time are known.
  // Individual dateConf/timeConf track extraction quality for each component.

  const startAtConf: Confidence = hasDate && hasTime
    ? (dateConf === 'high' && timeConf === 'high' ? 'high' : 'medium')
    : 'medium';

  const parsed: NLParseResult['parsed'] = {};

  // startAt: combine date + time (fall back to contextDate if only one is present)
  let startAtDate: Date | undefined;
  if (parsedDate !== null && startHour !== null) {
    startAtDate = new Date(parsedDate);
    startAtDate.setHours(startHour, startMin, 0, 0);
  } else if (parsedDate !== null) {
    startAtDate = new Date(parsedDate); // midnight of the parsed date
  } else if (startHour !== null) {
    startAtDate = new Date(contextDate);
    startAtDate.setHours(startHour, startMin, 0, 0);
  }

  if (startAtDate !== undefined) {
    parsed.startAt = pf(startAtDate, startAtConf);

    // endAt: explicit range end, or +1 hour default when time was given
    if (endHour !== null) {
      const endAtDate = new Date(startAtDate);
      endAtDate.setHours(endHour, endMin, 0, 0);
      parsed.endAt = pf(endAtDate, startAtConf);
    } else if (startHour !== null) {
      const endAtDate = new Date(startAtDate);
      endAtDate.setHours(startAtDate.getHours() + 1, startAtDate.getMinutes(), 0, 0);
      parsed.endAt = pf(endAtDate, startAtConf);
    }
  }

  // allDay hint when only a date (no time) was parsed
  if (parsedDate !== null && startHour === null) {
    parsed.allDay = pf(true, 'medium');
  }

  if (location !== null) {
    parsed.location = pf(location, 'high');
  }

  if (repeatType !== 'none') {
    parsed.repeatType = pf(repeatType, 'high');
  }
  // v1.2.8 — custom_weekly 일 때만 days 배열 전달.
  if (repeatType === 'custom_weekly' && weeklyDays && weeklyDays.length > 0) {
    parsed.weeklyDays = pf(weeklyDays, 'high');
  }

  if (titleRaw) {
    parsed.title = pf(titleRaw, confidence);
  }

  return {
    parsed,
    confidence,
    source: 'local',
    rawInput: text,
    processingMs: Date.now() - startMs,
  };
}

// ─── Multi-event parser ────────────────────────────────────────────────────

/**
 * Splits a free-form input by Korean enumeration markers (",", "그리고",
 * "및", "+") and runs parseLocally on each segment, returning one result
 * per detected event.
 *
 * Smart date inheritance: when a later segment has no date of its own
 * (e.g. "내일 9시 회의, 12시 점심" → the second segment doesn't say "내일"
 * again), we feed the previous segment's date in as `contextDate` so the
 * inherited day is preserved.
 *
 * Always returns at least one element. Single-event inputs collapse to a
 * one-item array, so callers can treat the array result uniformly.
 */
export function parseMultiple(text: string, contextDate: Date = new Date()): NLParseResult[] {
  const splitter = /\s*(?:,|그리고|및|\+)\s*/;
  const segments = text.split(splitter).map((s) => s.trim()).filter((s) => s.length > 0);

  if (segments.length <= 1) {
    return [parseLocally(text, contextDate)];
  }

  const results: NLParseResult[] = [];
  let inheritedDate: Date = contextDate;

  for (const seg of segments) {
    let r = parseLocally(seg, inheritedDate);
    // If this segment supplied an explicit date, propagate it as the
    // context for following segments. We strip the time component so the
    // inheritance only carries the calendar day, not the hour-of-day.
    if (r.parsed.startAt?.value) {
      const d = r.parsed.startAt.value;
      inheritedDate = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0);
    }
    results.push(r);
  }

  return results;
}
