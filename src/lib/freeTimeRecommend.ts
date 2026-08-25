/**
 * freeTimeRecommend — 다음 빈 슬롯을 클라이언트에서 빠르게 탐지 (v1.2 Phase 3).
 *
 * AI 호출 없이 rule baseline 만 사용. Home AISuggestionCard 가 매 진입 시
 * 호출 — 비용 0, 지연 < 5ms.
 *
 * 규칙:
 *   - 다음 7일 안에서 최소 60분 이상 빈 슬롯 탐색
 *   - 새벽(00-07), 늦은 밤(23+) 제외 — 활동 제안에 부적합
 *   - 시간대별 제안 매트릭스 (아침 산책, 점심 식사, 오후 운동 등)
 */

export interface FreeSlotSuggestion {
  startAt: Date;
  endAt: Date;
  suggestion: string;
}

interface SimpleEvent {
  startAt: Date;
  endAt: Date;
}

const MIN_SLOT_MINUTES = 60;
const WAKE_HOUR = 7;
const SLEEP_HOUR = 23;

/** 시간대(0-23) 기반 fallback (사용자 데이터 부족 시). */
function suggestionForHour(hour: number): string {
  if (hour < 9)  return '여유로운 아침을 보내보세요';
  if (hour < 12) return '오전 빈 시간이 보여요';
  if (hour < 14) return '점심 약속 잡기 좋아요';
  if (hour < 18) return '오후가 비어 있어요';
  if (hour < 21) return '저녁 시간을 활용해보세요';
  return '하루를 마무리하는 시간';
}

/**
 * v1.2.9 — 인사이트 기반 개인화 suggestion.
 * 최근 14일 events 패턴 (운동 빈도, 미팅 빈도, 카테고리 분포, 자주 비는 요일)
 * 으로 의미 있는 한 줄 만들기. AI 호출 0 — 클라이언트 통계만.
 *
 * 예시:
 *  - 운동 0회 + 평일 오후 빈 슬롯 → "이번 주 운동이 없네요. 화요일 오후 비어있어요."
 *  - 미팅 5건/주 → "이번 주 미팅 5건. 잠깐 산책으로 환기해보세요."
 *  - 평소 헬스 화수목 → "헬스 평소 패턴이라면 이 시간이 맞아요."
 */
export interface RecentStats {
  totalCount: number;
  workoutCount: number;
  meetingCount: number;
  /** 가장 자주 등장하는 요일 (0=일~6=토). null 이면 데이터 부족. */
  busiestDow: number | null;
  /** 평일(월~금) 평균 일정 수. */
  weekdayAvg: number;
}

const DOW_LABELS = ['일', '월', '화', '수', '목', '금', '토'] as const;

function buildPersonalizedSuggestion(slot: SimpleEvent, stats: RecentStats | null): string {
  const hour = slot.startAt.getHours();
  const dow = slot.startAt.getDay();

  // 데이터 부족 fallback.
  if (!stats || stats.totalCount < 3) {
    return suggestionForHour(hour);
  }

  // 우선순위 1: 운동 부족 + 활동 시간대 → 운동 추천.
  if (stats.workoutCount === 0 && hour >= 7 && hour <= 20) {
    return `최근 2주 운동 기록이 없어요. ${DOW_LABELS[dow]}요일 ${hour}시 어떠세요?`;
  }
  if (stats.workoutCount === 1 && hour >= 7 && hour <= 20) {
    return `이번 주 운동 1회 — 한 번 더 잡기 좋은 시간이에요.`;
  }

  // 우선순위 2: 미팅/일정 과다 → 휴식 권장.
  if (stats.meetingCount >= 7) {
    return `최근 미팅 ${stats.meetingCount}건으로 많아요. 잠깐 산책으로 환기해보세요.`;
  }
  if (stats.weekdayAvg >= 4) {
    return `평일 평균 ${stats.weekdayAvg.toFixed(1)}건 — 빈 ${DOW_LABELS[dow]}요일을 회복일로 써보세요.`;
  }

  // 우선순위 3: 자주 비는 요일이면 그쪽으로 유도.
  if (stats.busiestDow !== null && dow === stats.busiestDow) {
    return `${DOW_LABELS[dow]}요일이 가장 바쁜 날인데도 비었네요. 짧은 휴식 어떠세요?`;
  }

  // 우선순위 4: 시간대별 의미 있는 prompt.
  if (hour >= 7 && hour < 9) return `${DOW_LABELS[dow]}요일 아침, 평소보다 여유 있어요.`;
  if (hour >= 11 && hour < 14) return `점심 약속 잡기 좋은 ${DOW_LABELS[dow]}요일 시간.`;
  if (hour >= 18 && hour < 21) return `${DOW_LABELS[dow]}요일 저녁, 약속 빈 시간이에요.`;

  return suggestionForHour(hour);
}

/**
 * Recent events 에서 통계 추출. AISuggestionCard caller (홈) 가 호출.
 */
export function deriveRecentStats(events: { startAt: Date; endAt: Date; title?: string; eventKind?: string }[]): RecentStats {
  const now = Date.now();
  const TWO_WEEKS_MS = 14 * 24 * 3600 * 1000;
  const recent = events.filter((e) => now - e.startAt.getTime() < TWO_WEEKS_MS && e.startAt.getTime() < now);

  const dowCount = [0, 0, 0, 0, 0, 0, 0];
  let workout = 0;
  let meeting = 0;
  let weekdayCount = 0;
  for (const e of recent) {
    const d = e.startAt.getDay();
    dowCount[d] = (dowCount[d] ?? 0) + 1;  // noUncheckedIndexedAccess 가드
    if (d >= 1 && d <= 5) weekdayCount += 1;
    if (e.eventKind === 'workout' || e.eventKind === 'running') workout += 1;
    else if (/미팅|회의|meeting|약속/i.test(e.title ?? '')) meeting += 1;
  }
  const maxCount = Math.max(...dowCount);
  const busiestDow = maxCount > 0 ? dowCount.indexOf(maxCount) : null;
  // 평일 평균 (5일 기준)
  const weekdayAvg = weekdayCount / 5;
  return {
    totalCount: recent.length,
    workoutCount: workout,
    meetingCount: meeting,
    busiestDow,
    weekdayAvg,
  };
}

/**
 * 다음 빈 슬롯 1개 반환 (가까운 순).
 * @param events 현재 시각 이후 24-72시간 윈도우 안의 일정들
 * @param now    기준 시각 (테스트용 override)
 * @param stats  v1.2.9 — 최근 패턴 통계 (인사이트 기반 suggestion).
 *               미제공 시 시간대 fallback.
 */
export function findNextFreeSlot(
  events: SimpleEvent[],
  now: Date = new Date(),
  stats: RecentStats | null = null,
): FreeSlotSuggestion | null {
  // 정렬 + 현재 이후만.
  const upcoming = events
    .filter((e) => e.endAt.getTime() > now.getTime())
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

  // 탐색 윈도우: 지금 ~ 72시간 후.
  let cursor = new Date(now);
  const windowEnd = new Date(now);
  windowEnd.setHours(windowEnd.getHours() + 72);

  for (const evt of upcoming) {
    if (evt.startAt.getTime() > cursor.getTime()) {
      const slot = clampToActiveHours({ startAt: cursor, endAt: evt.startAt });
      const minutes = (slot.endAt.getTime() - slot.startAt.getTime()) / 60000;
      if (minutes >= MIN_SLOT_MINUTES) {
        return buildSuggestion(slot, stats);
      }
    }
    if (evt.endAt.getTime() > cursor.getTime()) {
      cursor = new Date(evt.endAt);
    }
    if (cursor.getTime() >= windowEnd.getTime()) break;
  }

  // 마지막 일정 이후 ~ 윈도우 끝 사이 검사.
  if (cursor.getTime() < windowEnd.getTime()) {
    const slot = clampToActiveHours({ startAt: cursor, endAt: windowEnd });
    const minutes = (slot.endAt.getTime() - slot.startAt.getTime()) / 60000;
    if (minutes >= MIN_SLOT_MINUTES) {
      return buildSuggestion(slot, stats);
    }
  }
  return null;
}

function clampToActiveHours(slot: { startAt: Date; endAt: Date }): SimpleEvent {
  const startAt = new Date(slot.startAt);
  const endAt = new Date(slot.endAt);
  if (startAt.getHours() < WAKE_HOUR) {
    startAt.setHours(WAKE_HOUR, 0, 0, 0);
  } else if (startAt.getHours() >= SLEEP_HOUR) {
    startAt.setDate(startAt.getDate() + 1);
    startAt.setHours(WAKE_HOUR, 0, 0, 0);
  }
  if (endAt.getHours() >= SLEEP_HOUR) {
    endAt.setHours(SLEEP_HOUR, 0, 0, 0);
  }
  return { startAt, endAt };
}

function buildSuggestion(slot: SimpleEvent, stats: RecentStats | null): FreeSlotSuggestion {
  return {
    startAt: slot.startAt,
    endAt: slot.endAt,
    suggestion: buildPersonalizedSuggestion(slot, stats),
  };
}
