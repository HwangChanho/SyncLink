/**
 * Calendar tab — Month / Week / Day views with swipe navigation.
 *
 * State managed here:
 *  - viewMode: 'month' | 'week' | 'day'
 *  - selectedDate: currently focused date (controls which period is shown)
 *
 * Event data:
 *  - Fetched via eventStore.fetchEvents() on selectedDate / viewMode change
 *  - Realtime updates applied via subscribeToSharedEvents (TASK-202)
 *
 * Navigation:
 *  - CalendarHeader prev/next buttons
 *  - Horizontal swipe gesture (PanResponder)
 *  - Tapping a day cell in MonthView → DayView drill-down
 *  - Tapping a day header in WeekView → DayView drill-down
 *
 * Future:
 *  - TASK-302: NL input bar
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Pressable, StyleSheet,
  Modal, TouchableOpacity, Text,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { NLInputBar } from '@/components/nl/NLInputBar';
import { CalendarHeader, type ViewMode } from '@/components/calendar/CalendarHeader';
import { WheelDatePicker } from '@/components/calendar/WheelDatePicker';
import { MonthView } from '@/components/calendar/MonthView';
import { useAnniversaryStore } from '@/stores/anniversaryStore';
import { WeekView } from '@/components/calendar/WeekView';
import { DayView } from '@/components/calendar/DayView';
import { useEventStore } from '@/stores/eventStore';
import { subscribeToSharedEvents } from '@/services/eventRealtimeService';
import { useTodoStore } from '@/stores/todoStore';
import type { MonthViewItem } from '@/components/calendar/MonthView';
import type { EventSummary } from '@/types';
import { useColors } from '@/hooks/useColors';
import { useTranslation } from 'react-i18next';
// Phase 2.1 — date/range utils + 화면 hook 들로 분할.
import { toDateKey, getViewRange, shiftDate } from '@/lib/calendarRange';
// Build-81 — useFreeTimeOverlay 미사용 (free time 캘린더에서 제거). Space 화면 전용.
import { useCalendarSwipe } from '@/hooks/useCalendarSwipe';
import { useCategoryFilter } from '@/hooks/useCategoryFilter';

// ─── Component ────────────────────────────────────────────────────────────────

export default function CalendarScreen() {
  const colors = useColors();
  const styles = makeStyles(colors);
  const router = useRouter();
  // PRD 4.2 Tier 2 — i18n for free-time UI strings.
  const { t } = useTranslation();
  const { eventsByDate, fetchEvents, upsertEvent, removeEvent } = useEventStore();
  // Todos with a due date should surface on the calendar (MonthView only).
  // Build-74 — week/day view 에선 todo 미노출. drag-to-reschedule 도 X.
  const { todos, fetchTodos } = useTodoStore();
  useEffect(() => { void fetchTodos(); }, [fetchTodos]);

  // Build-91 — anniversaries (Space 단위 기념일) 도 캘린더에 표시. RLS 가
  // 본인 멤버 space 만 통과 → 한 번 fetch 후 month picker 마다 클라
  // 매핑 (repeat_yearly 처리). 데이터 양 적어 최초 1회 + 새 Space 합류
  // 시 (focus 마다) 충분. anniversariesByDate 의 useMemo 는 selectedDate
  // 선언 후 위치 (block-scoped 참조).
  const fetchAnniversaries = useAnniversaryStore(s => s.fetchAll);
  const occurrencesByDate  = useAnniversaryStore(s => s.occurrencesByDate);
  useEffect(() => { void fetchAnniversaries(); }, [fetchAnniversaries]);

  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [selectedDate, setSelectedDate] = useState<Date>(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });

  /**
   * Controls the visibility of the YearMonthPicker modal.
   * Opened when the user taps the period title in CalendarHeader.
   */
  const [pickerVisible, setPickerVisible] = useState(false);

  // ── Category filter (TASK-1416) — 분리된 hook ──────────────────────────────
  const {
    categories,
    dimmedCats,
    toggleCategoryDim,
    displayEventsByDate,
  } = useCategoryFilter(eventsByDate);
  /** Whether the category filter sheet is open. */
  const [catFilterVisible, setCatFilterVisible] = useState(false);

  /** Density mode: detailed bars with titles, or compact colour dots.
   * Build-69 — toggle UI 제거 (⋯ 메뉴 단순화). 'detailed' 고정. setter
   * 미사용. */
  const [monthDensity] = useState<'detailed' | 'compact'>('detailed');

  // Build-81 — Free time finder 캘린더에서 제거 (LEAD 2026-05-05).
  // hook 사용 X, freeSlots prop 도 WeekView/DayView 에 미전달.
  // useFreeTimeOverlay / FreeTimeRecommendSheet / FreeTimeSlotRow 등은
  // Space 화면 (src/app/space/[id].tsx) 에서 계속 사용 가능.

  /**
   * Build-69 LEAD: ⋯ 메뉴 리스트 없애고 바로 카테고리 필터로 진입.
   * 이전 (Build 50~) 의 ActionSheet (필터/밀도/free-time) 제거. ⋯ 탭 =
   * 카테고리 필터 sheet 다이렉트 오픈. 밀도 토글은 state 유지하지만 UI
   * 노출 X (필요 시 별도 위치로 재배치).
   */
  const openCalendarOverflowMenu = useCallback(() => {
    setCatFilterVisible(true);
  }, []);

  /**
   * Group todos by due-date key. Only todos with a due date and not yet
   * completed are surfaced on the calendar — completed items would add
   * noise. The colour is the category colour if we know it, otherwise
   * a neutral grey so the bar is still visible.
   */
  const todosByDate = useMemo(() => {
    // Build-66 — `dueAt` (시간 포함) 도 함께 노출. WeekView/DayView 가 시간
    // 있는 todo 를 grid chip 으로 그릴 때 사용. MonthView 는 dueAt 무시
    // (월 셀에는 점/요약만 띄움).
    const map: Record<string, (MonthViewItem & { dueAt?: Date | null })[]> = {};
    for (const t of todos) {
      if (t.isCompleted) continue;
      // dueAt 우선 — 시간 있으면 그 일자, 없으면 dueDate.
      const d = t.dueAt ?? t.dueDate;
      if (!d) continue;
      const key = toDateKey(d);
      const bucket = map[key] ?? (map[key] = []);
      const cat = t.categoryId ? categories.find((c) => c.id === t.categoryId) : null;
      bucket.push({
        id: t.id,
        title: t.title,
        color: cat?.color ?? '#64748B',
        kind: 'todo',
        dueAt: t.dueAt,
      });
    }
    return map;
  }, [todos, categories]);

  // Build-91 — anniversariesByDate 매핑 (selectedDate 의존 → 여기 위치).
  const anniversariesByDate = useMemo(
    () => occurrencesByDate(selectedDate.getFullYear(), selectedDate.getMonth()),
    [occurrencesByDate, selectedDate],
  );

  // displayEventsByDate / toggleCategoryDim / toggleSpaceSelection 모두
  // useCategoryFilter / useFreeTimeOverlay 가 제공.
  // Drag-to-reschedule 은 WeekView/DayView 가 useOptimisticReschedule 로
  // 직접 처리 — 캘린더 화면은 swipe + 뷰 모드만 신경 쓴다.

  // ─── Navigation ─────────────────────────────────────────────────────────────

  const goNext = useCallback(() => {
    setSelectedDate((prev) => shiftDate(prev, viewMode, 1));
  }, [viewMode]);

  const goPrev = useCallback(() => {
    setSelectedDate((prev) => shiftDate(prev, viewMode, -1));
  }, [viewMode]);

  const goToday = useCallback(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    setSelectedDate(today);
  }, []);

  /** Opens the YearMonthPicker modal (triggered by tapping the title). */
  const handleYearMonthPress = useCallback(() => {
    setPickerVisible(true);
  }, []);

  /**
   * Receives the date selected in YearMonthPicker and updates the calendar.
   * The picker provides the 1st of the selected month; we normalise to midnight.
   *
   * @param date - 1st day of the selected year/month at 00:00:00
   */
  const handleYearMonthSelect = useCallback((date: Date) => {
    date.setHours(0, 0, 0, 0);
    setSelectedDate(date);
    // Always switch to month view after a year/month jump for context
    setViewMode('month');
    setPickerVisible(false);
  }, []);

  /**
   * Tapping a date in MonthView updates the selected date.
   * LEAD 2026-05-03 — "월에서 일자 눌렀을 때 일로 넘어가지 않게": just
   * highlight the selection. View-mode change still happens through the
   * mode-toggle pill, not as a side effect of cell taps.
   */
  const handleDateSelect = useCallback((date: Date) => {
    setSelectedDate(date);
  }, []);

  /**
   * Build-56 — tapping an EMPTY day cell (no events, no todos) jumps
   * straight to the create-event screen with that date pre-filled.
   * Replaces the old "tap → enter day view → press +" flow for empty
   * days. Cells with content still go through handleDateSelect (just
   * select, no navigation).
   */
  const handleEmptyDatePress = useCallback((date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    router.push(`/event/create?date=${y}-${m}-${d}`);
  }, [router]);

  /**
   * Long-pressing a date in MonthView jumps straight to event/create
   * with that date pre-filled (startAt = date 09:00, endAt = date 10:00).
   * Faster than: tap date → enter day view → press + button → fill form.
   */
  const handleDateLongPress = useCallback((date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    router.push(`/event/create?date=${y}-${m}-${d}`);
  }, [router]);

  // Build-55 의 handleEmptySlotPress / WeekView+DayView 의 onEmptySlotPress
  // 연결은 LEAD 보고로 일시 비활성화 — capture 단계에서 항상 claim 하던
  // 변경이 chip longpress drag 와 race 를 일으켜 "주 이동이 안 된다" 회귀
  // 발생. hook 자체의 onEmptyTap 코드는 남아 있고 prop 만 미전달.
  // 향후 Pressable wrapper 로 재구현 예정 (AUTONOMOUS_IMPROVEMENTS.md 참조).

  /** Tapping an event opens the event detail screen. */
  const handleEventPress = useCallback((event: EventSummary) => {
    router.push(`/event/${event.id}`);
  }, [router]);

  // ─── Event fetching ──────────────────────────────────────────────────────────

  /**
   * Fetch events whenever the visible period changes.
   * `getViewRange` computes the exact date range for the current view mode
   * so we always load exactly what's visible on screen.
   *
   * Build-70 LEAD perf — 같은 range 가 연속으로 fetch 되면 skip.
   * 주 모드 fetch 가 ±2주 (35일) 라 사용자가 한 주 shift 해도 새 range
   * 시작/끝이 다른 일자라 skip 안 되고 fetch 새로 일어남. 단 똑같은
   * selectedDate 로 다른 trigger (focus, language 등) 가 fire 할 때는
   * 중복 fetch 차단.
   */
  const lastFetchedRangeRef = useRef<string | null>(null);
  useEffect(() => {
    const range = getViewRange(selectedDate, viewMode);
    const key = `${viewMode}:${toDateKey(range.start)}-${toDateKey(range.end)}`;
    if (lastFetchedRangeRef.current === key) return;
    lastFetchedRangeRef.current = key;
    void fetchEvents(range);
  }, [selectedDate, viewMode, fetchEvents]);

  /**
   * E1 fix — Re-fetch the current view range when the calendar screen regains
   * focus (e.g. returning from event/create via router.back()).
   *
   * Without this, `selectedDate` and `viewMode` don't change on back-navigation
   * so the useEffect above never re-fires — the newly created event is in the
   * store via optimistic `upsertEvent` but if the user clears or re-navigates
   * the range is stale. This ensures a server-side re-fetch on every focus so
   * the store and the rendered grid are always in sync.
   *
   * `useFocusEffect` is a no-op on web (Expo Router passes through) so the
   * web path relies on the store-level optimistic upsert in create.tsx.
   */
  useFocusEffect(
    useCallback(() => {
      const range = getViewRange(selectedDate, viewMode);
      const key = `${viewMode}:${toDateKey(range.start)}-${toDateKey(range.end)}`;
      // Build-70 — focus 시 동일 range 면 중복 fetch skip.
      if (lastFetchedRangeRef.current === key) return;
      lastFetchedRangeRef.current = key;
      void fetchEvents(range);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedDate, viewMode]),
  );

  // ─── Realtime subscription (TASK-202) ────────────────────────────────────────

  /**
   * Subscribe to shared-event changes for all spaces the user belongs to.
   * `upsertEvent` handles both INSERT and UPDATE payloads.
   * `removeEvent` handles DELETE payloads.
   * The returned cleanup function is called on unmount.
   */
  useEffect(() => {
    const unsubscribe = subscribeToSharedEvents(
      upsertEvent,   // onInsert
      upsertEvent,   // onUpdate (same upsert logic)
      removeEvent,   // onDelete
    );
    return unsubscribe;
  }, [upsertEvent, removeEvent]);

  // ─── Swipe gesture (분리된 hook) ─────────────────────────────────────────
  // WeekView/DayView 의 chip drag 시 navigation 차단을 위해 isDragging ref 유지.
  const [isChildDragging, setIsChildDragging] = useState(false);
  const handleChildDragModeChange = useCallback((dragging: boolean) => {
    setIsChildDragging(dragging);
  }, []);

  // Build-64 — drag drop zone = FAB rect. ref 로 측정해 자식 hook 에 전달.
  const fabRef = useRef<View>(null);
  const fabRectRef = useRef<{ left: number; top: number; right: number; bottom: number } | null>(null);
  const measureFabRect = useCallback(() => {
    fabRef.current?.measureInWindow((x, y, w, h) => {
      // FAB 영역 + 외곽 hit-tolerance 16px (drag 끝 근처에서 살짝 벗어나도 인정)
      const tol = 16;
      fabRectRef.current = {
        left:   x - tol,
        top:    y - tol,
        right:  x + w + tol,
        bottom: y + h + tol,
      };
    });
  }, []);

  // Build-64 — month targeting 모드를 부모가 알기 위한 state + 삭제 핸들러 ref.
  // MonthView 가 onMonthTargetingChange 콜백으로 set, 자기 handleDelete 함수를
  // ref 로 publish (FAB onPress 가 호출).
  const [monthTargetEvent, setMonthTargetEvent] = useState<EventSummary | null>(null);
  const monthDeleteRef = useRef<(() => void) | null>(null);

  const { panHandlers: swipePanHandlers, swipeX } = useCalendarSwipe({
    viewMode,
    isDragging: isChildDragging,
    onShift: (direction) => {
      // LEAD 2026-05-03 — "주에서 좌우 이동할 때 한 주씩 넘어가지 않고
      // 하루씩". 주 모드에서만 1일 단위 시프트로 변경 (기존: 7일).
      // 월/일 모드는 기존 한 단위 (한 달 / 하루) 유지.
      if (viewMode === 'week') {
        setSelectedDate((prev) => {
          const next = new Date(prev);
          next.setDate(next.getDate() + direction);
          return next;
        });
        return;
      }
      setSelectedDate((prev) => shiftDate(prev, viewMode, direction));
    },
  });

  // ─── Events for current day (DayView) ────────────────────────────────────

  const todayEvents: EventSummary[] = displayEventsByDate[toDateKey(selectedDate)] ?? [];

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safeArea} edges={[]}>
      <View style={styles.container}>
        {/*
          Build-50 follow-up — single overflow menu (⋯) replaces the
          three separate left-toolbar buttons. ActionSheet on iOS lists
          filter / free-time / density options; the icon shows a small
          accent dot when any toggle is currently active so the user can
          see "something is on" at a glance without opening the sheet.
        */}
        <CalendarHeader
          viewMode={viewMode}
          currentDate={selectedDate}
          onPrev={goPrev}
          onNext={goNext}
          onToday={goToday}
          onYearMonthPress={handleYearMonthPress}
          onViewModeChange={setViewMode}
          rightToolbar={(
            <TouchableOpacity
              style={styles.toolbarBtn}
              onPress={openCalendarOverflowMenu}
              accessibilityLabel={t('common.a11y_more')}
            >
              <Ionicons
                name="ellipsis-horizontal"
                size={20}
                color={colors.textSecondary}
              />
              {dimmedCats.size > 0 && (
                <View style={[styles.catFilterBadge, { backgroundColor: colors.primary }]} />
              )}
            </TouchableOpacity>
          )}
          onSearchPress={() => router.push('/search')}
        />

        {/* Build-76 — wheel date picker (year/month/day spinner) for header
            title tap. 기존 YearMonthPicker (grid) 대체. */}
        <WheelDatePicker
          visible={pickerVisible}
          currentDate={selectedDate}
          onSelect={handleYearMonthSelect}
          onClose={() => setPickerVisible(false)}
        />

        {/* Swipe-enabled content area */}
        <Animated.View
          style={[styles.content, { transform: [{ translateX: swipeX }] }]}
          {...swipePanHandlers}
        >
          {viewMode === 'month' && (
            <MonthView
              onEmptyDatePress={handleEmptyDatePress}
              currentMonth={selectedDate}
              selectedDate={selectedDate}
              eventsByDate={displayEventsByDate}
              todosByDate={todosByDate}
              anniversariesByDate={anniversariesByDate}
              onDragModeChange={handleChildDragModeChange}
              density={monthDensity}
              onDateSelect={handleDateSelect}
              onDateLongPress={handleDateLongPress}
              onEventPress={handleEventPress}
              onTargetingChange={setMonthTargetEvent}
              registerDeleteHandler={(fn) => { monthDeleteRef.current = fn; }}
            />
          )}

          {viewMode === 'week' && (
            <WeekView
              selectedDate={selectedDate}
              eventsByDate={displayEventsByDate}
              onEventPress={handleEventPress}
              // 일자 헤더 탭 = day mode 진입 (drill-down).
              onDateSelect={(date) => {
                setSelectedDate(date);
                setViewMode('day');
              }}
              // 일자 row pan-to-scrub / horizontal scroll edge-week-shift
              // 시 selectedDate 만 갱신, viewMode='week' 유지.
              onSelectedDateChange={setSelectedDate}
              // Build-74 LEAD: todo 는 월 달력에서만 노출. week/day 에선
              // todosByDate / onTodoDrop 전달 X (strip 정리, grid 깔끔).
              onDragModeChange={handleChildDragModeChange}
              deleteZonePageRectRef={fabRectRef}
            />
          )}

          {viewMode === 'day' && (
            <DayView
              selectedDate={selectedDate}
              events={todayEvents}
              onEventPress={handleEventPress}
              // Build-74 LEAD: todo 는 월에서만. day view 도 todos prop X.
              onDragModeChange={handleChildDragModeChange}
              deleteZonePageRectRef={fabRectRef}
            />
          )}
        </Animated.View>

        {/* NLInputBar: TASK-302 — natural language event creation */}
        <NLInputBar
          onEventCreated={() => {
            // Re-fetch the current range so the new event appears immediately
            const range = getViewRange(selectedDate, viewMode);
            void fetchEvents(range);
          }}
        />

        {/* FAB — Build-64 LEAD: drag/move 모드면 trash 아이콘으로 변경.
            week/day: drag 중일 때 trash + 그 위에 drop 시 onDelete (자식 hook).
            month: targeting 모드일 때 trash + 클릭으로 삭제. */}
        <Pressable
          ref={fabRef}
          testID="calendar-fab-create"
          onLayout={measureFabRect}
          style={({ pressed }) => [
            styles.fab,
            (isChildDragging || monthTargetEvent) && styles.fabDelete,
            pressed && styles.fabPressed,
          ]}
          onPress={() => {
            if (monthTargetEvent && monthDeleteRef.current) {
              monthDeleteRef.current();
              return;
            }
            router.push({
              pathname: '/event/create',
              params: { date: toDateKey(selectedDate) },
            });
          }}
          accessibilityLabel={
            (isChildDragging || monthTargetEvent)
              ? t('event.delete')
              : t('common.a11y_create_event')
          }
          accessibilityRole="button"
        >
          <Ionicons
            name={(isChildDragging || monthTargetEvent) ? 'trash' : 'add'}
            size={(isChildDragging || monthTargetEvent) ? 24 : 28}
            color="#ffffff"
          />
        </Pressable>

        {/* Category dim filter modal */}
        <Modal
          visible={catFilterVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setCatFilterVisible(false)}
        >
          <Pressable
            style={styles.catModalBackdrop}
            onPress={() => setCatFilterVisible(false)}
          >
            <Pressable
              style={styles.catModalSheet}
              onPress={(e) => e.stopPropagation()}
            >
              <Text style={styles.catModalTitle}>{t('calendar.cat_filter_title')}</Text>
              <Text style={styles.catModalHint}>
                {t('calendar.cat_filter_hint')}
              </Text>

              {/* Row: "카테고리 없음" first so uncategorised events can be toggled. */}
              {[{ id: '__none__', name: t('calendar.cat_filter_uncategorised'), color: colors.textSecondary } as const,
                ...categories.map((c) => ({ id: c.id, name: c.name, color: c.color }))]
                .map((row) => {
                  const active = !dimmedCats.has(row.id);
                  return (
                    <TouchableOpacity
                      key={row.id}
                      style={styles.catModalRow}
                      onPress={() => toggleCategoryDim(row.id)}
                      activeOpacity={0.7}
                    >
                      <View style={[styles.catModalDot, { backgroundColor: row.color }]} />
                      <Text
                        style={[
                          styles.catModalName,
                          !active && { opacity: 0.45 },
                        ]}
                        numberOfLines={1}
                      >
                        {row.name}
                      </Text>
                      <Ionicons
                        name={active ? 'checkmark-circle' : 'ellipse-outline'}
                        size={22}
                        color={active ? colors.primary : colors.border}
                      />
                    </TouchableOpacity>
                  );
                })}
            </Pressable>
          </Pressable>
        </Modal>

        {/* Build-81 — Free time space picker modal 제거 (캘린더에서 free time 빼기). */}
      </View>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

/**
 * Dynamic styles factory — receives current theme color tokens.
 * Called inside the component to react to theme changes.
 *
 * @param colors - Active theme color tokens from useColors()
 */
function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.background,
    },
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      flex: 1,
    },
    // Top-left category filter affordance.
    // Build-50 — single style for all left-toolbar overlay-toggle buttons
    // (filter / free-time / density). Now flex children inside
    // CalendarHeader's leftToolbar slot, so no more absolute positioning.
    toolbarBtn: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    catFilterBadge: {
      // Build-54 — 8px dot was too easy to miss; LEAD report flagged users
      // not noticing a category filter was active. 11px + white ring lifts
      // it off the icon background without crowding the toolbar.
      position: 'absolute',
      top: 2,
      right: 2,
      width: 11,
      height: 11,
      borderRadius: 6,
      borderWidth: 1.5,
      borderColor: colors.surface,
    },
    // Build-50 — densityBtn / freeTimeBtn replaced by shared toolbarBtn
    // above. All three overlay-toggle buttons are now flex siblings
    // inside CalendarHeader's leftToolbar slot.
    /**
     * PRD 4.2 Tier 2 — small banner above the calendar body shown only
     * while the toggle is on. Renders contextual hints
     * (no-space / month-only / empty-result).
     */
    freeTimeHint: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: 0,
      paddingVertical: 4,
      paddingHorizontal: 12,
      backgroundColor: colors.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      zIndex: 4,
      alignItems: 'center',
    },
    freeTimeHintText: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    catModalBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.35)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    catModalSheet: {
      width: '85%',
      maxWidth: 340,
      backgroundColor: colors.surface,
      borderRadius: 14,
      padding: 20,
    },
    catModalTitle: {
      fontSize: 17,
      fontWeight: '700',
      color: colors.textPrimary,
      marginBottom: 6,
    },
    catModalHint: {
      fontSize: 12,
      color: colors.textSecondary,
      marginBottom: 16,
    },
    catModalRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 10,
    },
    catModalDot: {
      width: 12,
      height: 12,
      borderRadius: 6,
      marginRight: 12,
    },
    catModalName: {
      flex: 1,
      fontSize: 15,
      color: colors.textPrimary,
    },
    /** Build-64 — drag/targeting 모드일 때 FAB 가 빨간 trash 로 변경. */
    fabDelete: {
      backgroundColor: colors.error,
    },
    /** Floating action button — bottom-right, positioned above NLInputBar to avoid blocking its send button. */
    fab: {
      position: 'absolute',
      right: 20,
      bottom: 96, // NLInputBar 위로 올림 (기존 24 → 96, NL 입력바 높이 + 여백)
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      // Shadow (iOS)
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.25,
      shadowRadius: 6,
      // Elevation (Android)
      elevation: 6,
    },
    fabPressed: {
      opacity: 0.85,
    },
  });
}
