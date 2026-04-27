/**
 * activitySuggestions.ts — 클라이언트 측 룰 baseline 활동 추천 사전
 *
 * PRD 4.2 Tier 3 (옵션 C 하이브리드) 룰 레이어.
 *
 * 역할:
 *  - Edge Function 호출 없이 0ms 즉시 응답하는 정적 활동 추천 사전.
 *  - 시간대(TimeOfDay) × 슬롯 길이(SlotLength) × locale 매트릭스로 활동 3개 반환.
 *  - AI fallback 결과로 교체되기 전의 baseline UI로 사용.
 *
 * 비용: 0원 (네트워크 없음, AI 없음)
 * 응답 시간: 0ms (동기)
 *
 * 확장 방법:
 *  1. 새 locale 추가: RULE_DICTIONARY 에 locale 키 추가.
 *  2. 새 시간대 추가: TimeOfDay 타입과 classifyTimeOfDay()  로직 수정.
 *  3. 활동 추가/변경: 해당 locale × tod × length 배열 수정.
 *
 * docs/plans/2026-04-28-free-time-tier-3-ai-recommend.md (Day 2 Step 4)
 */

import type { FreeSlot } from '@/types/freeTime';

// ─── 분류 타입 ────────────────────────────────────────────────────────────────

/**
 * 슬롯 시작 시각(시)으로 구분한 시간대.
 *  - morning:   05-08시 (이른 아침)
 *  - forenoon:  09-11시 (오전)
 *  - afternoon: 12-17시 (오후)
 *  - evening:   18-21시 (저녁)
 *  - night:     22-04시 (심야)
 */
export type TimeOfDay = 'morning' | 'forenoon' | 'afternoon' | 'evening' | 'night';

/**
 * 슬롯 길이 버킷.
 *  - short:  30-59분
 *  - medium: 60-119분
 *  - long:   120분 이상
 */
export type SlotLength = 'short' | 'medium' | 'long';

/** 지원 locale 목록. */
export type SupportedLocale = 'ko' | 'en' | 'zh' | 'ja';

// ─── 분류 함수 ────────────────────────────────────────────────────────────────

/**
 * 슬롯 시작 시각(24h 정수)으로 시간대 결정.
 *
 * @param hour - 0~23 사이 정수
 * @returns TimeOfDay
 */
export function classifyTimeOfDay(hour: number): TimeOfDay {
  if (hour >= 5 && hour < 9)  return 'morning';
  if (hour >= 9 && hour < 12) return 'forenoon';
  if (hour >= 12 && hour < 18) return 'afternoon';
  if (hour >= 18 && hour < 22) return 'evening';
  return 'night';
}

/**
 * 슬롯 길이(분)로 버킷 분류.
 *
 * @param minutes - 슬롯 길이 (분 단위, 양수)
 * @returns SlotLength
 */
export function classifySlotLength(minutes: number): SlotLength {
  if (minutes < 60)  return 'short';
  if (minutes < 120) return 'medium';
  return 'long';
}

// ─── 룰 사전 ─────────────────────────────────────────────────────────────────

/**
 * locale × TimeOfDay × SlotLength → 활동 이름 목록 (3개).
 *
 * 각 조합에 정확히 3개의 활동을 제공한다.
 * 월 1회 리뷰로 관련성 유지 (docs/plans 참조).
 */
export const RULE_DICTIONARY: Record<
  SupportedLocale,
  Record<TimeOfDay, Record<SlotLength, [string, string, string]>>
> = {
  ko: {
    morning: {
      short:  ['조깅', '스트레칭', '카페'],
      medium: ['러닝', '요가', '공원 산책'],
      long:   ['등산', '자전거', '수영'],
    },
    forenoon: {
      short:  ['카페', '독서', '산책'],
      medium: ['스터디', '브런치', '전시 관람'],
      long:   ['코딩 카페', '독서', '박물관'],
    },
    afternoon: {
      short:  ['카페', '산책', '쇼핑'],
      medium: ['영화', '보드게임', '미팅'],
      long:   ['당일치기 여행', '하이킹', '쇼핑몰'],
    },
    evening: {
      short:  ['저녁 산책', '편의점', '카페'],
      medium: ['영화', '저녁 식사', '공연'],
      long:   ['파인다이닝', '공연', '야경 투어'],
    },
    night: {
      short:  ['디저트 카페', '편의점 야식', '산책'],
      medium: ['야식', '게임', '영화'],
      long:   ['야간 드라이브', '노래방', '클럽'],
    },
  },
  en: {
    morning: {
      short:  ['Jogging', 'Stretching', 'Coffee'],
      medium: ['Running', 'Yoga', 'Park walk'],
      long:   ['Hiking', 'Cycling', 'Swimming'],
    },
    forenoon: {
      short:  ['Coffee', 'Reading', 'Walk'],
      medium: ['Study session', 'Brunch', 'Gallery visit'],
      long:   ['Coding café', 'Reading', 'Museum'],
    },
    afternoon: {
      short:  ['Coffee', 'Walk', 'Shopping'],
      medium: ['Movie', 'Board game', 'Meetup'],
      long:   ['Day trip', 'Hiking', 'Shopping mall'],
    },
    evening: {
      short:  ['Evening walk', 'Convenience store', 'Café'],
      medium: ['Movie', 'Dinner', 'Concert'],
      long:   ['Fine dining', 'Concert', 'Night tour'],
    },
    night: {
      short:  ['Dessert café', 'Late-night snack', 'Walk'],
      medium: ['Late-night food', 'Gaming', 'Movie'],
      long:   ['Night drive', 'Karaoke', 'Club'],
    },
  },
  zh: {
    morning: {
      short:  ['慢跑', '伸展运动', '喝咖啡'],
      medium: ['跑步', '瑜伽', '公园散步'],
      long:   ['登山', '骑行', '游泳'],
    },
    forenoon: {
      short:  ['咖啡', '阅读', '散步'],
      medium: ['学习', '早午餐', '参观展览'],
      long:   ['咖啡馆学习', '阅读', '博物馆'],
    },
    afternoon: {
      short:  ['咖啡', '散步', '购物'],
      medium: ['电影', '桌游', '聚会'],
      long:   ['一日游', '远足', '购物中心'],
    },
    evening: {
      short:  ['傍晚散步', '便利店', '咖啡'],
      medium: ['电影', '晚餐', '演出'],
      long:   ['精致餐厅', '演出', '夜景游览'],
    },
    night: {
      short:  ['甜品店', '宵夜', '散步'],
      medium: ['宵夜', '游戏', '电影'],
      long:   ['夜间兜风', '卡拉OK', '俱乐部'],
    },
  },
  ja: {
    morning: {
      short:  ['ジョギング', 'ストレッチ', 'カフェ'],
      medium: ['ランニング', 'ヨガ', '公園散歩'],
      long:   ['登山', 'サイクリング', '水泳'],
    },
    forenoon: {
      short:  ['カフェ', '読書', '散歩'],
      medium: ['勉強', 'ブランチ', '展覧会'],
      long:   ['カフェ勉強', '読書', '博物館'],
    },
    afternoon: {
      short:  ['カフェ', '散歩', 'ショッピング'],
      medium: ['映画', 'ボードゲーム', 'ミーティング'],
      long:   ['日帰り旅行', 'ハイキング', 'ショッピングモール'],
    },
    evening: {
      short:  ['夕方散歩', 'コンビニ', 'カフェ'],
      medium: ['映画', '夕食', 'コンサート'],
      long:   ['ファインダイニング', 'コンサート', '夜景ツアー'],
    },
    night: {
      short:  ['デザートカフェ', '夜食', '散歩'],
      medium: ['夜食', 'ゲーム', '映画'],
      long:   ['ドライブ', 'カラオケ', 'クラブ'],
    },
  },
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * 룰 기반 활동 추천 결과.
 * 항상 3개의 활동이 포함됨 (룰 사전에서 보장).
 */
export interface RuleActivities {
  /** 분류된 시간대 */
  timeOfDay:   TimeOfDay;
  /** 분류된 슬롯 길이 */
  slotLength:  SlotLength;
  /** 추천 활동 이름 목록 (정확히 3개) */
  activities:  [string, string, string];
}

/**
 * 단일 빈 슬롯에 대한 룰 baseline 활동 추천 반환.
 *
 * 네트워크 없이 동기(0ms) 응답.
 * AI fallback 결과가 도착하기 전 UI에 즉시 표시하기 위한 용도.
 *
 * @param slot   - 추천 대상 FreeSlot (start가 Date 타입)
 * @param locale - 응답 언어 (지원 안 되면 'ko' 로 fallback)
 * @returns RuleActivities (항상 activities 3개 보장)
 *
 * @example
 *   const rule = getRuleBaseline(slot, 'ko');
 *   // { timeOfDay: 'afternoon', slotLength: 'medium', activities: ['영화', '보드게임', '미팅'] }
 */
export function getRuleBaseline(
  slot: FreeSlot,
  locale: SupportedLocale | string,
): RuleActivities {
  // 지원 안 되는 locale은 'ko'로 fallback
  const safeLocale: SupportedLocale =
    (['ko', 'en', 'zh', 'ja'] as const).includes(locale as SupportedLocale)
      ? (locale as SupportedLocale)
      : 'ko';

  const hour      = slot.start.getHours();
  const timeOfDay = classifyTimeOfDay(hour);
  const slotLength = classifySlotLength(slot.durationMinutes);

  const activities = RULE_DICTIONARY[safeLocale][timeOfDay][slotLength];

  return { timeOfDay, slotLength, activities };
}

/**
 * 여러 빈 슬롯에 대한 룰 baseline 배치 처리.
 *
 * @param slots  - FreeSlot 배열
 * @param locale - 응답 언어
 * @returns 각 슬롯에 매핑된 RuleActivities 배열 (순서 보장)
 */
export function getRuleBaselineAll(
  slots: FreeSlot[],
  locale: SupportedLocale | string,
): Array<{ slot: FreeSlot; rule: RuleActivities }> {
  return slots.map((slot) => ({
    slot,
    rule: getRuleBaseline(slot, locale),
  }));
}
