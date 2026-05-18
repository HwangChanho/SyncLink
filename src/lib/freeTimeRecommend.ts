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

/** 시간대(0-23) 기반 활동 제안. */
function suggestionForHour(hour: number): string {
  if (hour < 9)  return '아침 산책은 어때요?';
  if (hour < 12) return '오전에 잠깐 할 일 정리할 시간이에요.';
  if (hour < 14) return '점심 식사 시간이 비었어요.';
  if (hour < 18) return '오후에 운동하기 좋은 시간이에요.';
  if (hour < 21) return '저녁 약속 잡기 좋은 시간이에요.';
  return '하루 마무리 회고 시간으로 어떨까요?';
}

/**
 * 다음 빈 슬롯 1개 반환 (가까운 순).
 * @param events 현재 시각 이후 24-72시간 윈도우 안의 일정들
 * @param now    기준 시각 (테스트용 override)
 */
export function findNextFreeSlot(
  events: SimpleEvent[],
  now: Date = new Date(),
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
        return buildSuggestion(slot);
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
      return buildSuggestion(slot);
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

function buildSuggestion(slot: SimpleEvent): FreeSlotSuggestion {
  const hour = slot.startAt.getHours();
  return {
    startAt: slot.startAt,
    endAt: slot.endAt,
    suggestion: suggestionForHour(hour),
  };
}
