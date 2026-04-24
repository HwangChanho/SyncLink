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

import { Animated, View, Text, TouchableOpacity, StyleSheet, Easing } from 'react-native';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useColors } from '@/hooks/useColors';
import { spacing, radius } from '@/constants/spacing';
import { textStyles, fontWeight } from '@/constants/typography';

/**
 * Subtle bouncing chevron used on both sides of the period title to hint
 * that the calendar responds to horizontal swipes. No interaction — the
 * PanResponder on the screen container handles the actual gesture.
 */
function SwipeHint({ direction }: { direction: 'left' | 'right' }) {
  const colors = useColors();
  const translate = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const to = direction === 'left' ? -4 : 4;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(translate, {
          toValue: to,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(translate, {
          toValue: 0,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [direction, translate]);

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        transform: [{ translateX: translate }],
        opacity: 0.35,
      }}
    >
      <Text style={{ fontSize: 20, color: colors.textSecondary }}>
        {direction === 'left' ? '‹' : '›'}
      </Text>
    </Animated.View>
  );
}

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
}

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'] as const;

/** Produces a human-readable title for the current viewing period. */
function buildTitle(mode: ViewMode, date: Date): string {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;

  if (mode !== 'day') {
    // Both month and week modes show the year + month
    return `${y}년 ${m}월`;
  }

  // Day mode: "4월 18일 (금)"
  const d = date.getDate();
  const dow = DAY_NAMES[date.getDay()] ?? '일';
  return `${m}월 ${d}일 (${dow})`;
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
    <View style={styles.container}>
      {/* ─── Period navigation row ─── */}
      {/*
        Arrows were removed in favour of horizontal swipe gestures (already
        wired via PanResponder on the calendar screen).  The title now
        centres itself and still opens the YearMonthPicker when tapped.
        A subtle bouncing-chevron animation on either side hints that the
        whole surface is swipeable.
      */}
      <View style={styles.navRow}>
        <SwipeHint direction="left" />

        <TouchableOpacity
          onPress={onYearMonthPress ?? onToday}
          hitSlop={HIT_SLOP}
          style={styles.titleWrap}
          accessibilityLabel="년도/월 선택"
          accessibilityHint="탭하면 년도와 월을 선택하는 피커가 열립니다"
        >
          <View style={styles.titleInner}>
            <Text style={styles.title}>{buildTitle(viewMode, currentDate)}</Text>
            <Text style={styles.titleChevron}>▾</Text>
          </View>
        </TouchableOpacity>

        <SwipeHint direction="right" />
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
  /** Small downward chevron shown next to the title to indicate interactivity. */
  titleChevron: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
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
