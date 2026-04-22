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
import { ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useEventStore } from '@/stores/eventStore';
import { useTodoStore } from '@/stores/todoStore';
import { NLInputBar } from '@/components/nl/NLInputBar';
import { HomeHeader }         from '@/components/home/HomeHeader';
import { TodayEventList }     from '@/components/home/TodayEventList';
import { TodayTodoList }      from '@/components/home/TodayTodoList';
import { SpaceActivityFeed }  from '@/components/home/SpaceActivityFeed';
import { WeeklyReviewCard }   from '@/components/home/WeeklyReviewCard';
import { WeatherWidget }      from '@/components/home/WeatherWidget';
import { DateSuggestionCard } from '@/components/home/DateSuggestionCard';
import { useColors } from '@/hooks/useColors';
import { spacing } from '@/constants/spacing';
import type { DateRange } from '@/types';

// ─── Helper ───────────────────────────────────────────────────────────────────

/** Returns a DateRange spanning only today (start = 00:00, end = 23:59). */
function todayRange(): DateRange {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const colors = useColors();
  const fetchEvents = useEventStore(s => s.fetchEvents);
  const isFetchingEvents = useEventStore(s => s.isFetching);
  const { fetchTodos, isLoading: isFetchingTodos } = useTodoStore();

  const isRefreshing = isFetchingEvents || isFetchingTodos;

  // ── Load today's data on mount ─────────────────────────────────────────
  const loadTodayData = () => {
    const range = todayRange();
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
      edges={['top', 'left', 'right']}
    >
      {/* NLInputBar is pinned at the bottom, content scrolls above it */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={loadTodayData}
            tintColor={colors.primary}
          />
        }
      >
        {/* Greeting + date */}
        <HomeHeader />

        {/* Current weather widget — TASK-903 */}
        <WeatherWidget />

        {/* AI date suggestion card — TASK-904 */}
        <DateSuggestionCard />

        {/* Weekly AI review card — TASK-504 */}
        <WeeklyReviewCard />

        {/* Section spacer */}
        <NLInputBarSpacer />

        {/* Today's events */}
        <TodayEventList />

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
    // Note: background color is now dynamic (light/dark); using white here
    // for the static stylesheet. The SafeAreaView background is updated
    // via the colors.background from useColors() in the rendered style.
    backgroundColor: '#FFFFFF',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingTop:    spacing[2],
    paddingBottom: spacing[20],  // space for NLInputBar
  },
});
