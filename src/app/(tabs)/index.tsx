/**
 * Home tab — Today summary, upcoming events, todos, and Space activity feed.
 *
 * Layout:
 *  ┌──────────────────────┐
 *  │ HomeHeader            │  ← 인사 + 날짜
 *  │ NLInputBar            │  ← AI 자연어 입력 (TASK-302)
 *  │ TodayEventList        │  ← 오늘 일정
 *  │ TodayTodoList         │  ← 오늘 할일
 *  │ SpaceActivityFeed     │  ← Space 실시간 활동
 *  └──────────────────────┘
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
import { NLInputBar } from '@/components/nl/NLInputBar';
import { HomeHeader }         from '@/components/home/HomeHeader';
import { TodayEventList }     from '@/components/home/TodayEventList';
import { TodayTodoList }      from '@/components/home/TodayTodoList';
import { SpaceActivityFeed }  from '@/components/home/SpaceActivityFeed';
import { WeeklyReviewCard }    from '@/components/home/WeeklyReviewCard';
import { WeatherWidget }       from '@/components/home/WeatherWidget';
import { DateSuggestionCard }  from '@/components/home/DateSuggestionCard';
import { UpcomingEventsCard }  from '@/components/home/UpcomingEventsCard';
import { useColors } from '@/hooks/useColors';
import { useTranslation } from 'react-i18next';
import { spacing } from '@/constants/spacing';
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
  const { t } = useTranslation();
  const fetchEvents = useEventStore(s => s.fetchEvents);
  const isFetchingEvents = useEventStore(s => s.isFetching);
  const { fetchTodos, isLoading: isFetchingTodos } = useTodoStore();

  const isRefreshing = isFetchingEvents || isFetchingTodos;

  // ── Load today's data on mount ─────────────────────────────────────────
  const loadTodayData = () => {
    const range = homeRange();
    void fetchEvents(range);
    void fetchTodos({
      contentType: 'todo',
      dueAfter:  range.start,
      dueBefore: range.end,
    });
  };

  useEffect(() => {
    loadTodayData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        contentContainerStyle={styles.scrollContent}
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

        {/* Current weather widget — TASK-903 */}
        <WeatherWidget />

        {/*
         * Visual breathing room between the weather widget and the cards
         * that follow. Previously these sections touched each other with
         * no margin, making the home screen feel cramped. A single shared
         * spacer keeps the gap consistent regardless of which widgets are
         * rendered (WeatherWidget may collapse to null when location
         * permission is denied).
         */}
        <View style={styles.sectionSpacer} />

        {/* AI date suggestion card — TASK-904 */}
        <DateSuggestionCard />

        <View style={styles.sectionSpacer} />

        {/* Weekly AI review card — TASK-504 */}
        <WeeklyReviewCard />

        {/* Section spacer */}
        <NLInputBarSpacer />

        {/* Today's events */}
        <TodayEventList />

        {/* Upcoming events (tomorrow → +6 days) */}
        <UpcomingEventsCard />

        {/* Today's todos */}
        <TodayTodoList />

        {/* Space activity feed */}
        <SpaceActivityFeed />
      </ScrollView>

      {/* AI natural language input bar — fixed at bottom */}
      <NLInputBar />
    </SafeAreaView>
  );
}

/**
 * Spacer that creates the visual gap where the NLInputBar "belongs"
 * within the scroll content hierarchy (even though it's absolutely positioned).
 */
function NLInputBarSpacer() {
  return null; // NLInputBar handles its own layout
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
