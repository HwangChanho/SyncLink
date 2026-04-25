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
 * Subtle "more content this way" swipe hint rendered on either side of the
 * period title.
 *
 * Design note — previous iteration used bouncing chevrons which felt
 * cartoonish. This replacement renders three small dots whose opacity
 * cascades outward in a soft wave (inner dot → outer dot). The cadence is
 * slow (~1.6 s) so it reads as ambient rather than demanding. The only
 * visual motion is opacity; no translation, no bounce.
 */
function SwipeHint({ direction }: { direction: 'left' | 'right' }) {
  const colors = useColors();
  const dotCount = 3;
  // Keep one Animated.Value per dot so each can phase independently.
  const values = useRef(
    Array.from({ length: dotCount }, () => new Animated.Value(0.08)),
  ).current;

  useEffect(() => {
    // Dimmed further per LEAD feedback — earlier values made the dots
    // read like punctuation next to the month-mode tabs ("일.").
    const MIN = 0.04;
    const MAX = 0.14;
    const STEP_MS = 520;
    // Kick off each dot with a staggered delay so the wave walks outward.
    // For the left-hand hint the wave runs right → left (closer dot first
    // for "come this way" feel); right hand mirrors.
    const stagger = direction === 'left' ? [0, 1, 2] : [2, 1, 0];
    const loops = values.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(stagger[i]! * (STEP_MS / 2)),
          Animated.timing(v, {
            toValue: MAX,
            duration: STEP_MS,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(v, {
            toValue: MIN,
            duration: STEP_MS,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [direction, values]);

  // Outer-to-inner order so the rendered row visually walks toward the title.
  const ordered = direction === 'left' ? [...values].reverse() : values;

  return (
    <View style={{ flexDirection: 'row', gap: 3 }} pointerEvents="none">
      {ordered.map((v, i) => (
        <Animated.View
          key={i}
          style={{
            width: 4,
            height: 4,
            borderRadius: 2,
            backgroundColor: colors.textSecondary,
            opacity: v,
          }}
        />
      ))}
    </View>
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

const DOW_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/**
 * Build the period title via i18n so each locale gets its native format.
 * All three modes show year/month/day (the bug was: "월. " — only the
 * month escaped from a half-localised format).
 *
 * Translation contract (calendar.title.*):
 *   - month: "{{year}} / {{month}}"
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

  if (mode === 'month') {
    return String(t('calendar.title.month', { year: y, month: m }));
  }

  if (mode === 'week') {
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

  const d = date.getDate();
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
            <Text style={styles.title}>{buildTitle(viewMode, currentDate, t as unknown as (k: string, o?: Record<string, string | number>) => string)}</Text>
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
