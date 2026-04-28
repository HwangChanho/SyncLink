/**
 * FreeTimeRecommendSheet — PRD 4.2 Tier 3 Day 4
 *
 * 빈 시간 슬롯 탭 시 표시되는 AI 활동 추천 BottomSheet.
 *
 * 동작 흐름 (옵션 C 하이브리드):
 *  1. 슬롯이 전달되면 즉시 getRuleBaseline()으로 룰 baseline 3개 표시 (0ms).
 *  2. 백그라운드에서 getFreeTimeRecommendations() 호출 (캐시 확인 + AI fallback).
 *  3. AI 응답 도착 시 skeleton → 실제 카드로 교체.
 *  4. "이 활동으로 일정 만들기" 버튼 탭 시 onCreateEvent(title) 콜백 호출.
 *  5. "다시 추천" 탭 시 캐시 무효화 후 재요청.
 *
 * 접근성:
 *  - 모든 인터랙티브 요소에 testID 부착 (QA smoke test 지원).
 *  - 4개 locale 대응: ko / en / zh / ja.
 *
 * @module FreeTimeRecommendSheet
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import type { FreeSlot } from '@/types/freeTime';
import {
  getFreeTimeRecommendations,
  invalidateRecommendationCache,
} from '@/services/aiService';
import type { ActivityItem } from '@/services/aiService';
import { getRuleBaseline } from '@/lib/activitySuggestions';
import type { SupportedLocale } from '@/lib/activitySuggestions';
import { useColors } from '@/hooks/useColors';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';

// ─── i18n 텍스트 ──────────────────────────────────────────────────────────────

/**
 * BottomSheet UI에서 사용하는 다국어 텍스트.
 * 새 locale 추가 시 이 객체에만 추가하면 됨.
 */
const SHEET_TEXTS: Record<SupportedLocale, {
  title:       string;
  subtitle:    string;
  createBtn:   string;
  refreshBtn:  string;
  aiLabel:     string;
  ruleLabel:   string;
  cacheLabel:  string;
  loadingText: string;
}> = {
  ko: {
    title:       '빈 시간 활동 추천',
    subtitle:    '이 시간엔 어때요?',
    createBtn:   '이 활동으로 일정 만들기',
    refreshBtn:  '다시 추천',
    aiLabel:     'AI 추천',
    ruleLabel:   '추천',
    cacheLabel:  '캐시',
    loadingText: 'AI 추천 불러오는 중...',
  },
  en: {
    title:       'Activity Suggestions',
    subtitle:    'How about this?',
    createBtn:   'Create event with this activity',
    refreshBtn:  'Refresh',
    aiLabel:     'AI',
    ruleLabel:   'Suggested',
    cacheLabel:  'Cached',
    loadingText: 'Loading AI suggestions...',
  },
  zh: {
    title:       '活动推荐',
    subtitle:    '这个时间段可以做什么？',
    createBtn:   '用此活动创建日程',
    refreshBtn:  '重新推荐',
    aiLabel:     'AI 推荐',
    ruleLabel:   '推荐',
    cacheLabel:  '缓存',
    loadingText: '正在加载 AI 推荐...',
  },
  ja: {
    title:       'アクティビティ提案',
    subtitle:    'この時間はいかがですか？',
    createBtn:   'このアクティビティで予定を作成',
    refreshBtn:  '再提案',
    aiLabel:     'AI',
    ruleLabel:   '提案',
    cacheLabel:  'キャッシュ',
    loadingText: 'AI提案を読み込み中...',
  },
};

// ─── Props ────────────────────────────────────────────────────────────────────

export interface FreeTimeRecommendSheetProps {
  /**
   * 추천 대상 빈 슬롯. null이면 시트가 닫힘.
   * WeekView/DayView에서 free slot overlay 탭 시 전달.
   */
  slot: FreeSlot | null;

  /**
   * 응답 언어. 기본값 'ko'.
   */
  locale?: SupportedLocale | string;

  /**
   * 시트 닫기 요청 콜백.
   * 배경 탭, 스와이프 다운, X 버튼 탭 시 호출됨.
   */
  onClose: () => void;

  /**
   * "이 활동으로 일정 만들기" 탭 시 호출됨.
   * @param title - 선택된 활동 이름 (이벤트 제목 prefill용)
   * @param slot  - 대상 빈 슬롯 (시작/종료 시각 prefill용)
   */
  onCreateEvent: (title: string, slot: FreeSlot) => void;

  /**
   * 사용자 관심 카테고리 (선택적, AI 추천 품질 향상).
   */
  preferences?: string[];
}

// ─── 컴포넌트 ─────────────────────────────────────────────────────────────────

/**
 * FreeTimeRecommendSheet — 활동 추천 BottomSheet 컴포넌트.
 *
 * @param props - FreeTimeRecommendSheetProps
 */
export function FreeTimeRecommendSheet({
  slot,
  locale = 'ko',
  onClose,
  onCreateEvent,
  preferences,
}: FreeTimeRecommendSheetProps): React.ReactElement | null {
  const colors = useColors();

  // locale 정규화 (지원 범위 밖이면 'ko')
  const safeLocale: SupportedLocale =
    (['ko', 'en', 'zh', 'ja'] as const).includes(locale as SupportedLocale)
      ? (locale as SupportedLocale)
      : 'ko';

  const texts = SHEET_TEXTS[safeLocale];

  // ── 상태 ──────────────────────────────────────────────────────────────────

  /**
   * 현재 표시 중인 활동 목록.
   * 초기값: 룰 baseline (즉시 표시).
   * AI 응답 도착 시: AI 결과로 교체.
   */
  const [activities, setActivities] = useState<ActivityItem[]>([]);

  /**
   * AI 응답 소스 표시용.
   *  - 'loading': AI 호출 중 (skeleton 표시)
   *  - 'rule': 룰 baseline 표시 중
   *  - 'ai': AI 추천 도착
   *  - 'cache': 캐시에서 반환 (fromCache=true)
   */
  const [source, setSource] = useState<'loading' | 'rule' | 'ai' | 'cache'>('loading');

  // BottomSheet 진입/퇴장 애니메이션
  const translateY = useRef(new Animated.Value(400)).current;

  // ── 슬롯 변경 시 초기화 및 추천 로드 ─────────────────────────────────────

  useEffect(() => {
    if (!slot) return;

    // 1. 룰 baseline 즉시 표시
    const rule = getRuleBaseline(slot, locale);
    setActivities(rule.activities.map((name) => ({ name })));
    setSource('rule');

    // 2. 시트 열기 애니메이션
    Animated.spring(translateY, {
      toValue: 0,
      useNativeDriver: true,
      tension: 65,
      friction: 11,
    }).start();

    // 3. 백그라운드에서 AI 추천 로드
    let cancelled = false;
    void (async () => {
      try {
        const result = await getFreeTimeRecommendations(
          [slot],
          locale,
          true,      // forceAI
          preferences,
        );

        if (cancelled) return;

        const rec = result.recommendations[0];
        if (rec && rec.activities.length > 0) {
          setActivities(rec.activities);
          // fromCache 여부 및 source 기반으로 레이블 결정
          if (rec.fromCache) {
            setSource('cache');
          } else {
            setSource(result.source === 'ai' ? 'ai' : 'rule');
          }
        }
      } catch {
        // AI 실패 시 룰 baseline 유지 — 이미 표시 중이므로 별도 처리 불필요
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slot]);

  // ── 핸들러 ────────────────────────────────────────────────────────────────

  /** 시트 닫기: 퇴장 애니메이션 후 onClose 호출. */
  const handleClose = useCallback(() => {
    Animated.timing(translateY, {
      toValue: 400,
      duration: 220,
      useNativeDriver: true,
    }).start(() => onClose());
  }, [onClose, translateY]);

  /**
   * "다시 추천" 버튼 핸들러.
   * 클라이언트 캐시를 무효화하고 새 AI 추천을 요청한다.
   */
  const handleRefresh = useCallback(async () => {
    if (!slot) return;

    setSource('loading');

    // 캐시 무효화
    await invalidateRecommendationCache(slot.start, slot.durationMinutes, locale);

    // 재요청
    try {
      const result = await getFreeTimeRecommendations(
        [slot],
        locale,
        true,
        preferences,
      );

      const rec = result.recommendations[0];
      if (rec && rec.activities.length > 0) {
        setActivities(rec.activities);
        setSource(rec.fromCache ? 'cache' : result.source === 'ai' ? 'ai' : 'rule');
      } else {
        // 결과 없음 → 룰 baseline 복원
        const rule = getRuleBaseline(slot, locale);
        setActivities(rule.activities.map((name) => ({ name })));
        setSource('rule');
      }
    } catch {
      // 오류 시 룰 baseline 복원
      const rule = getRuleBaseline(slot, locale);
      setActivities(rule.activities.map((name) => ({ name })));
      setSource('rule');
    }
  }, [slot, locale, preferences]);

  // ── 소스 레이블 텍스트 ────────────────────────────────────────────────────

  const sourceLabel = source === 'ai'
    ? texts.aiLabel
    : source === 'cache'
      ? texts.cacheLabel
      : source === 'rule'
        ? texts.ruleLabel
        : null;

  // ── 렌더링 ────────────────────────────────────────────────────────────────

  // slot이 null이면 아무것도 렌더링하지 않음
  if (!slot) return null;

  return (
    <Modal
      transparent
      animationType="none"
      visible={slot !== null}
      onRequestClose={handleClose}
      testID="free-time-recommend-modal"
    >
      {/* 배경 딤 처리 — 탭 시 시트 닫기 */}
      <Pressable
        style={styles.backdrop}
        onPress={handleClose}
        testID="free-time-recommend-backdrop"
      />

      {/* BottomSheet 패널 */}
      <Animated.View
        style={[
          styles.sheet,
          {
            backgroundColor: colors.surface,
            transform: [{ translateY }],
          },
        ]}
        testID="free-time-recommend-sheet"
      >
        {/* 핸들 바 */}
        <View
          style={[styles.handle, { backgroundColor: colors.border }]}
          testID="free-time-recommend-handle"
        />

        {/* 헤더 */}
        <View style={styles.header}>
          <View>
            <Text
              style={[textStyles.h4, { color: colors.textPrimary }]}
              testID="free-time-recommend-title"
            >
              {texts.title}
            </Text>
            <Text
              style={[textStyles.caption, { color: colors.textSecondary }]}
              testID="free-time-recommend-subtitle"
            >
              {texts.subtitle}
            </Text>
          </View>

          {/* 소스 배지 */}
          {sourceLabel && (
            <View
              style={[styles.sourceBadge, { backgroundColor: colors.primaryLight }]}
              testID="free-time-recommend-source-badge"
            >
              <Text style={[textStyles.caption, { color: colors.primary }]}>
                {sourceLabel}
              </Text>
            </View>
          )}
        </View>

        {/* 로딩 중 skeleton */}
        {source === 'loading' && (
          <View testID="free-time-recommend-loading">
            {[0, 1, 2].map((i) => (
              <View
                key={i}
                style={[
                  styles.skeletonCard,
                  { backgroundColor: colors.surfaceAlt },
                ]}
                testID={`free-time-recommend-skeleton-${i}`}
              />
            ))}
            <Text
              style={[textStyles.caption, styles.loadingText, { color: colors.textSecondary }]}
            >
              {texts.loadingText}
            </Text>
          </View>
        )}

        {/* 활동 카드 목록 */}
        {source !== 'loading' && (
          <View testID="free-time-recommend-activities">
            {activities.map((activity, index) => (
              <View
                key={`${activity.name}-${index}`}
                style={[styles.activityCard, { borderColor: colors.border }]}
                testID={`free-time-recommend-activity-${index}`}
              >
                {/* 활동 이름 + 이유 */}
                <View style={styles.activityInfo}>
                  <Text
                    style={[textStyles.body, { color: colors.textPrimary }]}
                    testID={`free-time-recommend-activity-name-${index}`}
                  >
                    {activity.name}
                  </Text>
                  {activity.reason ? (
                    <Text
                      style={[textStyles.caption, { color: colors.textSecondary }]}
                      testID={`free-time-recommend-activity-reason-${index}`}
                    >
                      {activity.reason}
                    </Text>
                  ) : null}
                </View>

                {/* "일정 만들기" CTA 버튼 */}
                <TouchableOpacity
                  style={[styles.createBtn, { backgroundColor: colors.primary }]}
                  onPress={() => {
                    onCreateEvent(activity.name, slot);
                    handleClose();
                  }}
                  testID={`free-time-recommend-create-btn-${index}`}
                  accessibilityLabel={`${activity.name}: ${texts.createBtn}`}
                  accessibilityRole="button"
                >
                  {/* textInverse: white in light mode, gray-900 in dark — contrasts against primary background */}
                  <Text style={[textStyles.caption, { color: colors.textInverse }]}>
                    {texts.createBtn}
                  </Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        {/* 다시 추천 버튼 */}
        <TouchableOpacity
          style={[styles.refreshBtn, { borderColor: colors.border }]}
          onPress={handleRefresh}
          testID="free-time-recommend-refresh-btn"
          accessibilityLabel={texts.refreshBtn}
          accessibilityRole="button"
        >
          <Text style={[textStyles.bodySm, { color: colors.primary }]}>
            {texts.refreshBtn}
          </Text>
        </TouchableOpacity>
      </Animated.View>
    </Modal>
  );
}

// ─── 스타일 ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  /**
   * 배경 딤 레이어.
   * absolute full-screen + 반투명 검정. 탭 시 시트 닫기.
   */
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },

  /**
   * BottomSheet 패널.
   * 화면 하단 고정, 50% snap point 근사값으로 최대 높이 설정.
   * 시트 배경색은 테마 card 색상 적용.
   */
  sheet: {
    position:     'absolute',
    bottom:       0,
    left:         0,
    right:        0,
    maxHeight:    '70%',
    borderTopLeftRadius:  radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing[6],   // 24px
    paddingBottom:     spacing[8] + 16, // 32+16 safe area 여유
    paddingTop:        spacing[2],   // 8px
    shadowColor:  '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.12,
    shadowRadius:  8,
    elevation:     12,
  },

  /**
   * 스와이프 핸들 바.
   * 중앙 상단에 위치하는 시각적 드래그 핸들.
   */
  handle: {
    width:        40,
    height:       4,
    borderRadius: radius.sm,        // 4px
    alignSelf:    'center',
    marginBottom: spacing[4],       // 16px
  },

  /**
   * 헤더 행: 제목 + 소스 배지.
   */
  header: {
    flexDirection:  'row',
    alignItems:     'flex-start',
    justifyContent: 'space-between',
    marginBottom:   spacing[4],     // 16px
  },

  /**
   * AI / 룰 / 캐시 소스 표시 배지.
   */
  sourceBadge: {
    paddingHorizontal: spacing[2],  // 8px
    paddingVertical:   spacing[1],  // 4px
    borderRadius:      radius.sm,
    marginTop:         2,
  },

  /**
   * skeleton placeholder 카드.
   * 로딩 중에 활동 카드 자리를 차지하여 레이아웃 이동(CLS) 최소화.
   */
  skeletonCard: {
    height:       60,
    borderRadius: radius.md,
    marginBottom: spacing[2],       // 8px
  },

  /**
   * 로딩 텍스트 (skeleton 아래).
   */
  loadingText: {
    textAlign: 'center',
    marginTop: spacing[2],          // 8px
  },

  /**
   * 단일 활동 카드.
   * 테두리 구분선으로 가볍게 분리.
   */
  activityCard: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[2],    // 8px
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap:            spacing[2],     // 8px
  },

  /**
   * 활동 이름 + 이유 텍스트 영역.
   */
  activityInfo: {
    flex: 1,
    gap:  2,
  },

  /**
   * "이 활동으로 일정 만들기" 버튼.
   */
  createBtn: {
    paddingHorizontal: spacing[2],  // 8px
    paddingVertical:   spacing[1],  // 4px
    borderRadius:      radius.sm,
    flexShrink:        0,
  },

  /**
   * "다시 추천" 버튼.
   * 카드 목록 아래에 위치하는 secondary 액션.
   */
  refreshBtn: {
    marginTop:         spacing[4],  // 16px
    paddingVertical:   spacing[2],  // 8px
    borderRadius:      radius.md,
    borderWidth:       1,
    alignItems:        'center',
  },
});
