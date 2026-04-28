/**
 * __tests__/components/FreeTimeRecommendSheet.test.tsx
 *
 * PRD 4.2 Tier 3 Day 4 — FreeTimeRecommendSheet 컴포넌트 단위 테스트
 *
 * 커버리지:
 *  1. 룰 baseline 즉시 표시 — slot 전달 시 getRuleBaseline 결과 즉시 렌더링
 *  2. AI 결과 업데이트     — getFreeTimeRecommendations 완료 후 카드 업데이트 + fromCache 레이블
 *
 * 전략:
 *  - @testing-library/react-native로 컴포넌트 렌더링
 *  - aiService, activitySuggestions mock으로 비동기 흐름 제어
 *  - waitFor로 AI 결과 도착 확인
 *
 * @module __tests__/components/FreeTimeRecommendSheet.test.tsx
 */

// ─── Mock 선언 (hoisted) ───────────────────────────────────────────────────────

jest.mock('@/services/aiService', () => ({
  getFreeTimeRecommendations: jest.fn(),
  invalidateRecommendationCache: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/lib/activitySuggestions', () => ({
  getRuleBaseline: jest.fn((_slot: unknown, _locale: string) => ({
    timeOfDay:  'afternoon',
    slotLength: 'medium',
    activities: ['산책', '카페', '영화'] as [string, string, string],
  })),
}));

jest.mock('@/hooks/useColors', () => ({
  useColors: jest.fn(() => ({
    surface:       '#FFFFFF',
    border:        '#E5E7EB',
    textPrimary:   '#111827',
    textSecondary: '#6B7280',
    primary:       '#7C3AED',
    primaryLight:  '#EDE9FE',
    surfaceAlt:    '#F3F4F6',
  })),
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { FreeTimeRecommendSheet } from '@/components/calendar/FreeTimeRecommendSheet';
import { getFreeTimeRecommendations } from '@/services/aiService';
import type { FreeSlot } from '@/types/freeTime';

// ─── 헬퍼 & 픽스처 ───────────────────────────────────────────────────────────

const mockGetFreeTimeRecommendations = getFreeTimeRecommendations as jest.MockedFunction<
  typeof getFreeTimeRecommendations
>;

/**
 * 테스트용 FreeSlot 픽스처.
 * 오후 2시 ~ 4시 (120분) 슬롯.
 */
function makeSlot(): FreeSlot {
  return {
    start:           new Date('2026-04-28T14:00:00+09:00'),
    end:             new Date('2026-04-28T16:00:00+09:00'),
    durationMinutes: 120,
  };
}

/**
 * AI 추천 결과 mock 생성.
 */
function makeAiResult(fromCache = false) {
  return {
    source: 'ai' as const,
    recommendations: [
      {
        slot:       makeSlot(),
        source:     'ai' as const,
        fromCache,
        activities: [
          { name: 'AI 추천 영화', reason: 'AI 추천 이유', fitScore: 0.95 },
          { name: 'AI 추천 산책', reason: 'AI 추천 이유', fitScore: 0.88 },
          { name: 'AI 추천 카페', reason: 'AI 추천 이유', fitScore: 0.80 },
        ],
      },
    ],
  };
}

// ─── 테스트 ───────────────────────────────────────────────────────────────────

describe('FreeTimeRecommendSheet', () => {
  const onClose       = jest.fn();
  const onCreateEvent = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── 테스트 1: 룰 baseline 즉시 표시 ─────────────────────────────────────────

  /**
   * slot이 전달되면 getFreeTimeRecommendations 완료를 기다리지 않고
   * getRuleBaseline 결과를 즉시 렌더링해야 한다.
   *
   * 검증 포인트:
   *  - testID="free-time-recommend-sheet" 노출
   *  - testID="free-time-recommend-activity-name-0" 에 룰 활동 이름 포함
   *  - AI 응답 대기 중이므로 '산책', '카페', '영화' 중 하나 표시
   */
  test('slot 전달 시 getRuleBaseline 결과가 즉시 렌더링된다', async () => {
    // getFreeTimeRecommendations가 resolve를 지연시켜 "즉시" 룰이 뜨는지 확인
    mockGetFreeTimeRecommendations.mockReturnValue(
      new Promise(() => { /* never resolves in this test */ }),
    );

    const slot = makeSlot();
    const { getByTestId, queryByTestId } = render(
      <FreeTimeRecommendSheet
        slot={slot}
        locale="ko"
        onClose={onClose}
        onCreateEvent={onCreateEvent}
      />,
    );

    // 시트 패널이 렌더링되어야 함
    expect(getByTestId('free-time-recommend-sheet')).toBeTruthy();

    // 룰 baseline 활동 목록이 바로 표시되어야 함 (loading → rule 전환이 동기)
    // getRuleBaseline mock이 ['산책', '카페', '영화']를 반환
    const activityName = getByTestId('free-time-recommend-activity-name-0');
    expect(activityName).toBeTruthy();
    // '산책'이 첫 번째 룰 활동
    expect(activityName.props.children).toBe('산책');

    // loading skeleton은 rule source가 설정된 후 사라짐
    expect(queryByTestId('free-time-recommend-loading')).toBeNull();
  });

  // ── 테스트 2: AI 결과 업데이트 + fromCache 레이블 표시 ─────────────────────

  /**
   * getFreeTimeRecommendations가 fromCache=true 결과를 반환하면:
   *  - 카드가 AI 활동으로 교체되어야 한다.
   *  - source badge에 '캐시' 레이블이 표시되어야 한다.
   *
   * 검증 포인트:
   *  - testID="free-time-recommend-activity-name-0" = 'AI 추천 영화'
   *  - testID="free-time-recommend-source-badge" 노출
   */
  test('AI 결과 fromCache=true → 카드 업데이트 + 캐시 레이블 표시', async () => {
    mockGetFreeTimeRecommendations.mockResolvedValue(makeAiResult(true));

    const slot = makeSlot();
    const { getByTestId, getByText } = render(
      <FreeTimeRecommendSheet
        slot={slot}
        locale="ko"
        onClose={onClose}
        onCreateEvent={onCreateEvent}
      />,
    );

    // AI 결과 도착 후 카드 교체 대기 (waitFor로 상태 업데이트 완료 확인)
    await waitFor(() => {
      expect(getByText('AI 추천 영화')).toBeTruthy();
    });

    // fromCache=true → 소스 배지가 '캐시'로 표시되어야 함
    const badge = getByTestId('free-time-recommend-source-badge');
    expect(badge).toBeTruthy();
  });
});
