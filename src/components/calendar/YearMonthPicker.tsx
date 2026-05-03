/**
 * YearMonthPicker — Modal-based year and month picker for the calendar.
 *
 * Rendered when the user taps the "YYYY년 M월" title in CalendarHeader.
 * Allows quick navigation to any month within ±5 years of today.
 *
 * Layout:
 *  - Header: close button + title
 *  - Year selector: horizontal FlatList (current year ±5)
 *  - Month grid: 4×3 grid of month buttons
 *  - Today badge indicator
 *
 * Props:
 *  @param visible    - Whether the modal is visible
 *  @param currentDate - The currently displayed date in the calendar
 *  @param onSelect   - Called with the selected date (1st of the selected month)
 *  @param onClose    - Called when the modal should be dismissed
 */

import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Pressable,
} from 'react-native';
import { useRef, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useColors } from '@/hooks/useColors';
import { spacing, radius } from '@/constants/spacing';
import { textStyles, fontWeight } from '@/constants/typography';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Range of years shown: today ±5. */
const YEAR_RANGE = 5;

/** Month labels (1-indexed display, 0-indexed array). */
const MONTH_LABELS = [
  '1월', '2월', '3월', '4월', '5월', '6월',
  '7월', '8월', '9월', '10월', '11월', '12월',
] as const;

/** Width of each year item in the horizontal list (px). */
const YEAR_ITEM_WIDTH = 72;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Generates an array of years from (baseYear - range) to (baseYear + range).
 *
 * @param baseYear - The reference year (typically today's year)
 * @param range    - How many years before/after to include
 * @returns Array of year numbers
 */
function buildYearList(baseYear: number, range: number): number[] {
  const years: number[] = [];
  for (let y = baseYear - range; y <= baseYear + range; y++) {
    years.push(y);
  }
  return years;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface YearMonthPickerProps {
  /** Controls modal visibility. */
  visible: boolean;
  /** The currently displayed date in the parent calendar. */
  currentDate: Date;
  /**
   * Called when the user confirms a year+month selection.
   * Receives the 1st day of the selected month at 00:00:00.
   */
  onSelect: (date: Date) => void;
  /** Called when the modal should be closed without changing the date. */
  onClose: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Year/month picker modal for the calendar header.
 * Supports dark mode via useColors() and works on web/iOS/Android.
 */
export function YearMonthPicker({
  visible,
  currentDate,
  onSelect,
  onClose,
}: YearMonthPickerProps) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { t } = useTranslation();

  // Today's reference for highlighting
  const today = new Date();
  const todayYear  = today.getFullYear();
  const todayMonth = today.getMonth(); // 0-indexed

  // Internal selection state (synced with currentDate when modal opens)
  const [selectedYear,  setSelectedYear]  = useState(currentDate.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(currentDate.getMonth());

  // Sync internal state when the modal re-opens with a new currentDate
  useEffect(() => {
    if (visible) {
      setSelectedYear(currentDate.getFullYear());
      setSelectedMonth(currentDate.getMonth());
    }
  }, [visible, currentDate]);

  // FlatList ref for auto-scrolling to the selected year
  const yearListRef = useRef<FlatList<number>>(null);

  // Build year list centred on today
  const years = buildYearList(todayYear, YEAR_RANGE);

  /**
   * Scroll the year list so the selected year is centred.
   * Called after the list has rendered (via onLayout / useEffect).
   */
  const scrollToYear = (year: number) => {
    const index = years.indexOf(year);
    if (index === -1 || !yearListRef.current) return;
    yearListRef.current.scrollToIndex({ index, animated: false, viewPosition: 0.5 });
  };

  // Scroll to selected year when the modal becomes visible
  useEffect(() => {
    if (visible) {
      // Small timeout lets the FlatList finish its initial layout before scrolling
      const timer = setTimeout(() => scrollToYear(selectedYear), 100);
      return () => clearTimeout(timer);
    }
    return undefined;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, selectedYear]);

  /**
   * Confirm the selection and notify the parent.
   * Constructs a Date for the 1st of the selected month.
   */
  const handleConfirm = () => {
    const date = new Date(selectedYear, selectedMonth, 1, 0, 0, 0, 0);
    onSelect(date);
    onClose();
  };

  /**
   * Renders a single year item in the horizontal FlatList.
   *
   * @param item - The year number to render
   */
  const renderYear = ({ item: year }: { item: number }) => {
    const isSelected = year === selectedYear;
    const isToday    = year === todayYear;

    return (
      <TouchableOpacity
        style={[styles.yearItem, isSelected && styles.yearItemSelected]}
        onPress={() => setSelectedYear(year)}
        accessibilityRole="button"
        accessibilityState={{ selected: isSelected }}
        accessibilityLabel={`${year}년`}
      >
        <Text style={[
          styles.yearText,
          isSelected && styles.yearTextSelected,
          !isSelected && isToday && styles.yearTextToday,
        ]}>
          {year}
        </Text>
        {/* Dot indicator for the current real year */}
        {isToday && !isSelected && <View style={[styles.todayDot, { backgroundColor: colors.primary }]} />}
      </TouchableOpacity>
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/* Backdrop — tapping outside dismisses the picker */}
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* Stop event propagation so taps inside the card don't close it */}
        <Pressable style={styles.card} onPress={() => { /* intentional no-op */ }}>

          {/* ─── Header ──────────────────────────────────────────────────── */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>{t('common.a11y_select_month')}</Text>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityLabel={t('common.a11y_close')}
              accessibilityRole="button"
            >
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* ─── Year selector ───────────────────────────────────────────── */}
          <FlatList
            ref={yearListRef}
            data={years}
            keyExtractor={(y) => String(y)}
            renderItem={renderYear}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.yearList}
            getItemLayout={(_, index) => ({
              length: YEAR_ITEM_WIDTH,
              offset: YEAR_ITEM_WIDTH * index,
              index,
            })}
            // Prevent scroll errors when the list hasn't fully laid out
            onScrollToIndexFailed={() => { /* silently ignore */ }}
            style={styles.yearListContainer}
          />

          {/* ─── Month grid (4 columns × 3 rows) ────────────────────────── */}
          <View style={styles.monthGrid}>
            {MONTH_LABELS.map((label, idx) => {
              const isActiveSelected = idx === selectedMonth;
              const isTodayMonth = idx === todayMonth && selectedYear === todayYear;

              return (
                <TouchableOpacity
                  key={label}
                  style={[
                    styles.monthItem,
                    isActiveSelected && styles.monthItemSelected,
                    isTodayMonth && !isActiveSelected && styles.monthItemToday,
                  ]}
                  onPress={() => setSelectedMonth(idx)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isActiveSelected }}
                  accessibilityLabel={`${selectedYear}년 ${label}`}
                >
                  <Text style={[
                    styles.monthText,
                    isActiveSelected && styles.monthTextSelected,
                    isTodayMonth && !isActiveSelected && styles.monthTextToday,
                  ]}>
                    {label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* ─── Today shortcut + Confirm button ────────────────────────── */}
          <View style={styles.footer}>
            <TouchableOpacity
              style={styles.todayBtn}
              onPress={() => {
                setSelectedYear(todayYear);
                setSelectedMonth(todayMonth);
                scrollToYear(todayYear);
              }}
              accessibilityLabel={t('common.a11y_today')}
            >
              <Text style={styles.todayBtnText}>{t('time.today')}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.confirmBtn}
              onPress={handleConfirm}
              accessibilityLabel={t('common.a11y_confirm_selection')}
            >
              <Text style={styles.confirmBtnText}>{t('common.ok')}</Text>
            </TouchableOpacity>
          </View>

        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

/**
 * Dynamic styles factory — receives current theme color tokens.
 * Must be called inside the component to react to theme changes.
 *
 * @param colors - Active theme color tokens from useColors()
 */
function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    /** Semi-transparent full-screen backdrop. */
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.45)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing[5],
    },

    /** White/dark card centred on screen. */
    card: {
      width: '100%',
      maxWidth: 360,
      backgroundColor: colors.surface,
      borderRadius: radius.xl,
      overflow: 'hidden',
      // iOS shadow
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.2,
      shadowRadius: 12,
      // Android elevation
      elevation: 8,
    },

    // ── Header ──────────────────────────────────────────────────────────────
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing[5],
      paddingTop: spacing[5],
      paddingBottom: spacing[3],
    },
    headerTitle: {
      ...textStyles.h4,
      color: colors.textPrimary,
    },
    closeText: {
      fontSize: 18,
      color: colors.textSecondary,
    },

    // ── Year list ────────────────────────────────────────────────────────────
    yearListContainer: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    yearList: {
      paddingVertical: spacing[3],
      paddingHorizontal: spacing[3],
    },
    yearItem: {
      width: YEAR_ITEM_WIDTH,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: spacing[2],
      borderRadius: radius.full,
      marginHorizontal: 2,
    },
    yearItemSelected: {
      backgroundColor: colors.primary,
    },
    yearText: {
      ...textStyles.bodySm,
      color: colors.textSecondary,
    },
    yearTextSelected: {
      // textInverse: white in light, gray-900 in dark — contrasts with primary selected background
      color: colors.textInverse,
      fontWeight: fontWeight.semibold,
    },
    yearTextToday: {
      color: colors.primary,
      fontWeight: fontWeight.semibold,
    },
    /** Small dot shown below the current real year when not selected. */
    todayDot: {
      width: 4,
      height: 4,
      borderRadius: 2,
      marginTop: 2,
    },

    // ── Month grid ───────────────────────────────────────────────────────────
    monthGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      padding: spacing[4],
      gap: spacing[2],
    },
    monthItem: {
      // 4 columns: (100% - 3 gaps) / 4
      width: '23%',
      aspectRatio: 1.8,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.md,
      backgroundColor: colors.backgroundAlt,
      marginHorizontal: '1%',
    },
    monthItemSelected: {
      backgroundColor: colors.primary,
    },
    /** Outline style for the current real month (when not selected). */
    monthItemToday: {
      borderWidth: 1.5,
      borderColor: colors.primary,
      backgroundColor: colors.backgroundAlt,
    },
    monthText: {
      ...textStyles.label,
      color: colors.textSecondary,
    },
    monthTextSelected: {
      // textInverse: white in light, gray-900 in dark — contrasts with primary selected background
      color: colors.textInverse,
      fontWeight: fontWeight.semibold,
    },
    monthTextToday: {
      color: colors.primary,
      fontWeight: fontWeight.semibold,
    },

    // ── Footer ───────────────────────────────────────────────────────────────
    footer: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      alignItems: 'center',
      gap: spacing[3],
      paddingHorizontal: spacing[5],
      paddingBottom: spacing[5],
      paddingTop: spacing[2],
    },
    todayBtn: {
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[2],
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.primary,
    },
    todayBtnText: {
      ...textStyles.label,
      color: colors.primary,
      fontWeight: fontWeight.semibold,
    },
    confirmBtn: {
      paddingHorizontal: spacing[5],
      paddingVertical: spacing[2],
      borderRadius: radius.md,
      backgroundColor: colors.primary,
    },
    confirmBtnText: {
      ...textStyles.label,
      // textInverse: white in light, gray-900 in dark — contrasts with primary button background
      color: colors.textInverse,
      fontWeight: fontWeight.semibold,
    },
  });
}
