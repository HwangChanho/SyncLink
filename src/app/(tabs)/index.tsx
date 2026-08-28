/**
 * Home tab — 오늘 / 다음 / 오늘의 제안 세 덩어리.
 *
 * Layout (2026-08-28 UX 단순화 이후):
 *  ┌────────────────────────────┐
 *  │ HomeHeader                  │  ← 인사 + 날짜
 *  │ LoginPromptBanner           │  ← 게스트에게만
 *  │ StartGuideCard              │  ← 신규 사용자에게만
 *  │ ─ 1. 오늘 ─                 │
 *  │   TodayEventList            │  ← 앱을 여는 이유. 이전엔 9번째였다
 *  │   TodayTodoList             │
 *  │ ─ 2. 다음 ─                 │
 *  │   UpcomingEventsCard        │
 *  │ ─ 3. 오늘의 제안 (접힘) ─    │  ← AI·날씨·가져오기 5장을 한 덩어리로
 *  │ SpaceActivityFeed           │  ← Space 가 있을 때만
 *  │ NLInputBar (하단 고정)       │  ← AI 자연어 입력 (TASK-302)
 *  └────────────────────────────┘
 *
 * 🔴 카드는 하나도 제거되지 않았다. 제안 묶음을 펼치면 전부 그대로 있다.
 *
 * Data loading:
 *  - Today's events: eventStore.fetchEvents(today)
 *  - Today's todos: todoStore.fetchTodos({ dueDate: today })
 *  - Space activity: SpaceActivityFeed manages its own Realtime subscription
 *
 * TASK-404 (Sprint 4)
 */

import { useEffect } from 'react';
import { ScrollView, StyleSheet, RefreshControl, Platform, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useEventStore } from '@/stores/eventStore';
import { useTodoStore } from '@/stores/todoStore';
import { useAuthStore } from '@/stores/authStore';
import { trackFunnel } from '@/services/funnelService';
import { getViewRange } from '@/lib/calendarRange';
import { NLInputBar } from '@/components/nl/NLInputBar';
import { HomeHeader }         from '@/components/home/HomeHeader';
import { TodayEventList }     from '@/components/home/TodayEventList';
import { TodayTodoList }      from '@/components/home/TodayTodoList';
import { SpaceActivityFeed }  from '@/components/home/SpaceActivityFeed';
import { WeeklyReviewCard }    from '@/components/home/WeeklyReviewCard';
import { WeatherWidget }       from '@/components/home/WeatherWidget';
import { DateSuggestionCard }  from '@/components/home/DateSuggestionCard';
import { UpcomingEventsCard }  from '@/components/home/UpcomingEventsCard';
import { SuggestionsSection }    from '@/components/home/SuggestionsSection';
import { AISuggestionCard }     from '@/components/home/AISuggestionCard';
import { ImportCalendarCard }   from '@/components/home/ImportCalendarCard';
import { StartGuideCard }       from '@/components/home/StartGuideCard';
import { findNextFreeSlot, deriveRecentStats } from '@/lib/freeTimeRecommend';
import { useMemo }              from 'react';
import { useColors } from '@/hooks/useColors';
import { useResponsive } from '@/hooks/useResponsive';
import { useTranslation } from 'react-i18next';
import { LoginPromptBanner } from '@/components/common/LoginPromptBanner';
import { spacing } from '@/constants/spacing';
import { desktopContentCentered } from '@/constants/webLayout';
import { textStyles } from '@/constants/typography';
import type { DateRange } from '@/types';

// ─── Helper ───────────────────────────────────────────────────────────────────

/**
 * Returns a DateRange from today 00:00 through 7 days later at 23:59.
 * The wider window populates eventsByDate for UpcomingEventsCard without
 * a separate fetch.
 */
function homeRange(): DateRange {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const colors = useColors();
  // 데스크탑(웹)에서는 콘텐츠가 풀폭으로 늘어지지 않게 적정폭 중앙 정렬. (S2 2026-06-09)
  const { isDesktop } = useResponsive();
  const { t } = useTranslation();
  const fetchEvents = useEventStore(s => s.fetchEvents);
  const isFetchingEvents = useEventStore(s => s.isFetching);
  const eventsByDate = useEventStore(s => s.eventsByDate);
  const { fetchTodos, isLoading: isFetchingTodos } = useTodoStore();

  // v1.2 Phase 3 — 다음 빈 슬롯 1개 탐지 (rule baseline, AI 호출 없음).
  // eventsByDate 가 갱신되면 자동 재계산.
  const freeSlot = useMemo(() => {
    const flat = Object.values(eventsByDate).flat();
    const simplified = flat.map((e) => ({ startAt: e.startAt, endAt: e.endAt }));
    // v1.2.9 — 최근 패턴 stats 함께 전달해 인사이트 기반 suggestion 생성.
    const stats = deriveRecentStats(flat.map((e) => ({
      startAt: e.startAt,
      endAt: e.endAt,
      ...(e.title ? { title: e.title } : {}),
      ...(e.eventKind ? { eventKind: e.eventKind } : {}),
    })));
    return findNextFreeSlot(simplified, new Date(), stats);
  }, [eventsByDate]);

  const isRefreshing = isFetchingEvents || isFetchingTodos;

  // ── Load today's data on mount ─────────────────────────────────────────
  // Build-75 LEAD: "캘린더 처음 진입할때 일정이 너무 늦게떠 미리 홈에서
  // 해당월껀 로드 해놔야 할꺼같은데". 홈 진입 시 캘린더가 사용할 범위
  // (week 35일 + month 42일) 까지 prefetch 해서 eventStore.fetchedDateKeys
  // 캐시에 미리 채움. 캘린더 진입 시점엔 fetchedDateKeys hit → fetchEvents
  // skip → events 즉시 표시.
  const loadTodayData = () => {
    const today = new Date();
    const homeRangeVal = homeRange(); // 오늘 ±7일 (TodayEventList / Upcoming)
    void fetchEvents(homeRangeVal);
    // 캘린더 첫 진입 캐싱: week 모드 (35일) + month 모드 (~42일).
    void fetchEvents(getViewRange(today, 'week'));
    void fetchEvents(getViewRange(today, 'month'));
    void fetchTodos({
      contentType: 'todo',
      dueAfter:  homeRangeVal.start,
      dueBefore: homeRangeVal.end,
    });
  };

  // 인증 복원이 끝난 뒤 로드한다. 부팅 중(isLoading)에 홈이 mount 되면 eventStore 가
  // 데모/실데이터를 잘못 채울 수 있어(데모 누수), 인증 확정 시점에 (재)로드한다.
  const authReady = useAuthStore((s) => !s.isLoading);
  useEffect(() => {
    if (authReady) {
      loadTodayData();
      // 퍼널: 여기까지 와야 앱을 "써본" 것이다. 세션당 1회만 남는다
      // (탭을 옮길 때마다 홈이 다시 그려지므로 그대로 두면 수십 줄이 쌓인다).
      void trackFunnel('home_view');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: colors.background }]}
      edges={['left', 'right']}
    >
      {/*
       * Web: RefreshControl is no-op on web browsers so we render a manual
       * refresh button at the top of the scroll area instead.
       * Native: use the standard pull-to-refresh RefreshControl.
       */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          isDesktop && desktopContentCentered,
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          Platform.OS !== 'web' ? (
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={loadTodayData}
              tintColor={colors.primary}
            />
          ) : undefined
        }
      >
        {/* Web-only refresh button — replaces pull-to-refresh */}
        {Platform.OS === 'web' && (
          <Pressable
            style={[styles.webRefreshButton, { borderColor: colors.border }]}
            onPress={loadTodayData}
            disabled={isRefreshing}
          >
            <Ionicons
              name="refresh"
              size={16}
              color={isRefreshing ? colors.textTertiary : colors.primary}
            />
            <Text style={[styles.webRefreshText, { color: isRefreshing ? colors.textTertiary : colors.primary }]}>
              {t('common.refresh')}
            </Text>
          </Pressable>
        )}

        {/* Greeting + date */}
        <HomeHeader />

        {/* Guest-only sign-in nudge (self-hides once authenticated). */}
        <LoginPromptBanner />

        {/* 2026-08-05 — 시작 가이드 체크리스트 (신규 로그인 사용자용, 완료/닫기 시 영구 숨김). */}
        <StartGuideCard />

        {/*
         * ── 2026-08-28 UX 단순화 (docs/plans/2026-08-28-ux-simplification.md) ──
         * 이전에는 이 자리에 AI·날씨·가져오기 카드가 먼저 오고 "오늘 일정"이
         * **9번째**였다. 앱을 여는 이유를 맨 위로 올린다:
         *   1) 오늘  2) 다음  3) 오늘의 제안(접힘)
         * 카드는 하나도 지우지 않았다 — 3번 안에 전부 살아 있다.
         */}

        {/* ── 1. 오늘 ── */}
        <TodayEventList />
        <TodayTodoList />

        {/* ── 2. 다음 (내일 → +6일) ── */}
        <UpcomingEventsCard />

        {/* ── 3. 오늘의 제안 — 기본 접힘 ──
            접힘일 때는 마운트되지 않으므로 AI 카드의 자동 호출도 함께 멈춘다. */}
        <SuggestionsSection title={t('common.today_suggestions')}>
          <AISuggestionCard slot={freeSlot} />
          <WeatherWidget />
          <View style={styles.sectionSpacer} />
          <DateSuggestionCard />
          <View style={styles.sectionSpacer} />
          <WeeklyReviewCard />
          <ImportCalendarCard />
        </SuggestionsSection>

        {/* Space 활동 — Space 에 속한 사용자에게만 의미가 있어 스스로 숨는다. */}
        <SpaceActivityFeed />
      </ScrollView>

      {/* AI natural language input bar — fixed at bottom.
          v1.2.9 — NLInputBar 안에 AI 비서 sparkles 버튼이 통합되어 별도 FAB
          (ChatFab) 제거. 단일 진입점으로 UI 단순화. */}
      <NLInputBar />
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    // backgroundColor is overridden at render-time via colors.background from useColors()
    // (see SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}).
    // Using transparent here as the static placeholder so it is clear this value is unused.
    backgroundColor: 'transparent',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    // paddingTop removed — the tab header already provides spacing and
    // the extra 8 px made the hero feel disconnected from the title.
    paddingBottom: spacing[20],  // space for NLInputBar
  },

  // ── Web-only refresh button ───────────────────────────────────────────────
  webRefreshButton: {
    flexDirection:   'row',
    alignItems:      'center',
    alignSelf:       'flex-end',
    gap:             spacing[1],
    marginRight:     spacing[4],
    marginBottom:    spacing[1],
    paddingVertical: spacing[1],
    paddingHorizontal: spacing[3],
    borderWidth:     1,
    borderRadius:    999,
  },
  webRefreshText: {
    ...textStyles.caption,
  },

  /**
   * Vertical spacer between adjacent home-screen widgets (weather /
   * DateSuggestion / WeeklyReview). 16 px matches the existing content
   * padding rhythm on the home screen.
   */
  sectionSpacer: {
    height: spacing[4],
  },
});
