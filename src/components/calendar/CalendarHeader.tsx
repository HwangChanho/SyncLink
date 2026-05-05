/**
 * CalendarHeader — navigation bar for the calendar screen.
 *
 * Renders:
 *  - ‹ PERIOD TITLE ›  (tap title = open YearMonthPicker; long-press = jump to today)
 *  - Month / Week / Day tab strip
 *
 * The parent is responsible for computing and updating `currentDate`
 * when the user navigates forward/back.
 *
 * TASK-YMP: Tapping the title now opens a YearMonthPicker modal so the user
 * can jump to any year/month quickly.  The old "tap = today" behaviour has been
 * moved to `onToday` which the parent still controls (e.g. via a dedicated button).
 * For backward compatibility `onToday` is kept — callers that relied on the tap
 * should pass `onYearMonthPress` instead.
 */

import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useColors } from '@/hooks/useColors';
import { spacing, radius } from '@/constants/spacing';
import { textStyles, fontWeight } from '@/constants/typography';

/**
 * NOTE — ISSUE-017 (2026-04-28):
 * The previous `SwipeHint` component rendered three pulsing dots on either
 * side of the title. Even after dimming the opacity twice, LEAD reported
 * that the dots still read like punctuation ("일.") next to the day-mode
 * tab and the Sunday DOW label. Since the swipe gesture is already
 * discoverable (every horizontal drag on the calendar surface navigates
 * the period), the visual hint adds noise without information. Removed
 * entirely. Re-introduce only if usability testing shows users miss the
 * gesture.
 */

/** The three calendar display modes. */
export type ViewMode = 'month' | 'week' | 'day';

const VIEW_MODES: ViewMode[] = ['month', 'week', 'day'];

// VIEW_MODE_LABELS is now built inside the component using i18n.

interface CalendarHeaderProps {
  viewMode: ViewMode;
  /**
   * The reference date used to build the title text.
   * - Month mode: shows "YYYY년 M월"
   * - Week mode:  shows "YYYY년 M월"
   * - Day mode:   shows "M월 D일 (요일)"
   */
  currentDate: Date;
  /** Navigate to the previous month / week / day. */
  onPrev: () => void;
  /** Navigate to the next month / week / day. */
  onNext: () => void;
  /**
   * Jump back to today.
   * This is no longer triggered by tapping the title — tapping the title now
   * opens the YearMonthPicker.  `onToday` can be called by any other UI element
   * the parent exposes (e.g. a dedicated button in the nav bar).
   */
  onToday: () => void;
  /**
   * Called when the user taps the period title.
   * The parent should open the YearMonthPicker modal in response.
   * If omitted, tapping the title falls back to `onToday` (backward compat).
   */
  onYearMonthPress?: () => void;
  /** Switch between month / week / day views. */
  onViewModeChange: (mode: ViewMode) => void;
  /** Open the event search screen. */
  onSearchPress?: () => void;
  /**
   * Optional right-side toolbar slot rendered at the end of the nav row,
   * just before the search button. Used by the parent to host an overflow
   * menu (filter / free-time / density) so the period title stays
   * visually centered on screen instead of being pushed off by left
   * icons (Build-50 follow-up: per LEAD feedback, consolidated 3 icons
   * into a single ⋯ menu button).
   */
  rightToolbar?: React.ReactNode;
  /**
   * Build-81 — free-time 토글 prop 제거 (캘린더에서 PRD 4.2 free time 빼기).
   * Space 화면에서 별도 운영. 컴포넌트 호출처 미전달 시 미렌더.
   */
  onFreeTimePress?: () => void;
  freeTimeOn?: boolean;
}

const DOW_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/**
 * Build the period title via i18n so each locale gets its native format.
 * All three modes show year/month/day (the bug was: "월. " — only the
 * month escaped from a half-localised format).
 *
 * ISSUE-016 (2026-04-28): Month mode now also receives the selected day
 * so the header reads "2026년 4월 28일" instead of "2026년 4월". This
 * makes it obvious which date the user has tapped — previously only
 * day mode surfaced the day number.
 *
 * Translation contract (calendar.title.*):
 *   - month: "{{year}} / {{month}} / {{day}}"
 *   - week:  "{{year}} / {{startMonth}}-{{startDay}} ~ {{endMonth}}-{{endDay}}"
 *   - day:   "{{year}} / {{month}} / {{day}} ({{dow}})"
 */
// `t` is the i18next translator. We type it loosely as `unknown` because
// useTranslation()'s strict generic signature collides with our local
// helper's structural typing under exactOptionalPropertyTypes.
function buildTitle(
  mode: ViewMode,
  date: Date,
  t: (key: string, opts?: Record<string, string | number>) => string | unknown,
): string {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();

  if (mode === 'month') {
    // Pass `day` so the i18n key can render "{{year}}년 {{month}}월 {{day}}일".
    return String(t('calendar.title.month', { year: y, month: m, day: d }));
  }

  if (mode === 'week') {
    // Build-69 — Sunday-aligned dayWindow 로 롤백. 헤더도 그 주의 일~토.
    const sunday = new Date(date);
    sunday.setDate(sunday.getDate() - sunday.getDay());
    const saturday = new Date(sunday);
    saturday.setDate(saturday.getDate() + 6);
    return String(t('calendar.title.week', {
      year:       y,
      startMonth: sunday.getMonth() + 1,
      startDay:   sunday.getDate(),
      endMonth:   saturday.getMonth() + 1,
      endDay:     saturday.getDate(),
    }));
  }

  // Day mode reuses the same `d` declared above.
  const dowKey = DOW_KEYS[date.getDay()] ?? 'sun';
  const dow = String(t(`calendar.weekday.${dowKey}`));
  return String(t('calendar.title.day', { year: y, month: m, day: d, dow }));
}

const HIT_SLOP = { top: 10, bottom: 10, left: 14, right: 14 } as const;

/**
 * Top navigation header for the calendar screen.
 * Handles period navigation and view-mode switching.
 */
export function CalendarHeader({
  viewMode,
  currentDate,
  // onPrev/onNext are still part of the public props for API compatibility
  // with callers, but navigation is now driven by swipe on the calendar
  // surface rather than arrow buttons.
  onPrev: _onPrev,
  onNext: _onNext,
  onToday,
  onYearMonthPress,
  onViewModeChange,
  onSearchPress,
  rightToolbar,
  onFreeTimePress,
  freeTimeOn = false,
}: CalendarHeaderProps) {
  // Resolve active theme colors for dark mode support (TASK-700)
  const { t } = useTranslation();
  const colors = useColors();
  const styles = makeStyles(colors);

  /**
   * View mode labels for month/week/day tabs.
   * Uses dedicated short-form keys (time.view_month / week / day) so that
   * all locales display correctly — e.g. "Month" in English, "월" in Korean.
   */
  const VIEW_MODE_LABELS: Record<ViewMode, string> = {
    month: t('time.view_month'),
    week:  t('time.view_week'),
    day:   t('time.view_day'),
  };

  return (
    <View style={styles.container} testID="calendar-screen-header">
      {/* ─── Period navigation row ─── */}
      {/*
        Arrows were removed in favour of horizontal swipe gestures (already
        wired via PanResponder on the calendar screen). The title centres
        itself and opens the YearMonthPicker when tapped.

        ISSUE-017 (2026-04-28): The flanking SwipeHint dots were removed
        because LEAD reported they read like punctuation next to the
        "일"/"Sun" labels even after dimming. The swipe gesture is
        self-discoverable, so the hint added noise without value.
      */}
      {/*
        Build-50 follow-up — title is positioned absolutely so it lands
        visually in the screen centre regardless of which buttons are
        on the right. The right-side actions (overflow menu + search)
        sit in their own flex row floated to the right edge.
      */}
      <View style={styles.navRow}>
        {/* Build-73 LEAD: 검색 라인 좌측 끝 = 오늘로 가기 버튼. 현재
            viewMode 유지하며 selectedDate = 오늘로 점프. */}
        <View style={styles.leftActions}>
          <TouchableOpacity
            testID="calendar-header-today"
            onPress={onToday}
            hitSlop={HIT_SLOP}
            style={styles.todayButton}
            accessibilityLabel={t('common.a11y_today')}
            accessibilityRole="button"
          >
            <Ionicons name="today-outline" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
          {/* Build-80 — Free time finder 토글 (PRD 4.2 Tier 2). Build 69
              의 ⋯ 메뉴 단순화 시 누락됐던 진입점 복원. */}
          {onFreeTimePress && (
            <TouchableOpacity
              testID="calendar-header-free-time"
              onPress={onFreeTimePress}
              hitSlop={HIT_SLOP}
              style={styles.todayButton}
              accessibilityLabel={t('common.a11y_free_time') ?? '빈 시간 찾기'}
              accessibilityRole="button"
              accessibilityState={{ selected: freeTimeOn }}
            >
              <Ionicons
                name={freeTimeOn ? 'time' : 'time-outline'}
                size={20}
                color={freeTimeOn ? colors.primary : colors.textSecondary}
              />
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.titleAbsolute} pointerEvents="box-none">
          <TouchableOpacity
            onPress={onYearMonthPress ?? onToday}
            hitSlop={HIT_SLOP}
            style={styles.titleWrap}
            accessibilityLabel={t('common.a11y_select_month')}
            accessibilityHint="탭하면 년도와 월을 선택하는 피커가 열립니다"
          >
            <View style={styles.titleInner}>
              <Text style={styles.title}>{buildTitle(viewMode, currentDate, t as unknown as (k: string, o?: Record<string, string | number>) => string)}</Text>
              <Text style={styles.titleChevron}>▾</Text>
            </View>
          </TouchableOpacity>
        </View>
        <View style={styles.navRowSpacer} />
        <View style={styles.rightActions}>
          {rightToolbar}
          {onSearchPress && (
            <TouchableOpacity
              onPress={onSearchPress}
              hitSlop={HIT_SLOP}
              style={styles.searchButton}
              accessibilityLabel={t('common.a11y_search_event')}
            >
              <Ionicons name="search-outline" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ─── View mode tabs ─── */}
      <View style={styles.tabRow}>
        {VIEW_MODES.map((mode) => {
          const active = viewMode === mode;
          return (
            <TouchableOpacity
              key={mode}
              onPress={() => onViewModeChange(mode)}
              style={[styles.tab, active && styles.tabActive]}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
                {VIEW_MODE_LABELS[mode]}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

/**
 * Dynamic styles factory — receives current theme color tokens.
 * Must be called inside the component to react to theme changes.
 *
 * @param colors - Active theme color tokens from useColors()
 */
function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
  container: {
    backgroundColor: colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
    paddingBottom: spacing[2],
  },
  // Build-50 — absolute centring so the title is visually in the
  // middle of the screen regardless of right-side actions. pointerEvents
  // is 'box-none' on the parent so taps on empty centre space don't
  // intercept; only the title TouchableOpacity itself receives presses.
  titleAbsolute: {
    position: 'absolute',
    left: 0, right: 0, top: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Spacer pushes the right-side actions to the screen edge; navRow's
  // 'space-between' alone wouldn't keep them aligned right because the
  // absolute title isn't part of flex layout.
  navRowSpacer: {
    flex: 1,
  },
  // Right-side actions row — overflow menu + search.
  rightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  // Build-73 — Left-side actions row. 현재 = 오늘로 가기 버튼 1개.
  leftActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  todayButton: {
    width:  36,
    height: 36,
    alignItems:     'center',
    justifyContent: 'center',
  },
  arrowBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
  },
  arrow: {
    fontSize: 26,
    color: colors.textPrimary,
    fontWeight: fontWeight.regular,
    lineHeight: 30,
  },
  titleWrap: {
    flex: 1,
    alignItems: 'center',
  },
  /** Row wrapper that places the title text and chevron side-by-side. */
  titleInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  title: {
    ...textStyles.h4,
    color: colors.textPrimary,
  },
  /** Downward chevron shown next to the title — Build-63 LEAD: 더 크게 */
  titleChevron: {
    fontSize: 18,
    color: colors.textSecondary,
    marginTop: 2,
    fontWeight: '700',
  },
  searchButton: {
    width:  36,
    height: 36,
    alignItems:     'center',
    justifyContent: 'center',
  },
  tabRow: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing[2],
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: colors.primary,
  },
  tabLabel: {
    ...textStyles.label,
    color: colors.textSecondary,
  },
  tabLabelActive: {
    ...textStyles.label,
    color: colors.primary,
    fontWeight: fontWeight.semibold,
  },
  });
}
