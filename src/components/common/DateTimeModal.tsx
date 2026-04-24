/**
 * DateTimeModal — cross-platform modal that lets users freely edit
 * year / month / day / hour / minute on a single screen.
 *
 * Problem it solves (iOS):
 *   `@react-native-community/datetimepicker` in spinner mode closes the
 *   wrapper after each scroll event, making it hard to change multiple
 *   fields in one interaction. On iOS 14+ the native inline pickers
 *   mount/unmount on state transitions which breaks continuous editing.
 *
 * Solution:
 *   Render both the date and time pickers inside a single controlled
 *   Modal. Local state buffers edits until the user taps 저장; 취소
 *   discards. Modal never auto-closes on field change.
 *
 * Platform note:
 *   On web this component is not used — create.tsx uses the native
 *   `<input type="datetime-local">` control instead. The module is
 *   still safe to import on web: it simply won't render (<Modal> no-op).
 *
 * @example
 *   const [open, setOpen] = useState(false);
 *   <DateTimeModal
 *     visible={open}
 *     initialValue={startAt}
 *     allDay={allDay}
 *     minimumDate={undefined}
 *     onCancel={() => setOpen(false)}
 *     onConfirm={(d) => { setStartAt(d); setOpen(false); }}
 *   />
 */

import { useEffect, useState } from 'react';
import {
  View, Text, Pressable, Modal, StyleSheet, Platform,
} from 'react-native';
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { useTranslation } from 'react-i18next';
import { useColors } from '@/hooks/useColors';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';

// ─── Props ────────────────────────────────────────────────────────────────────

interface DateTimeModalProps {
  /** When true, the modal is visible. */
  visible: boolean;
  /** Date the modal opens with. Updated to this value every time `visible` toggles true. */
  initialValue: Date;
  /**
   * When true, only the date (year/month/day) picker is shown — the time picker is hidden.
   * Used for all-day events where time has no meaning.
   */
  allDay?: boolean;
  /**
   * Optional lower bound. If the current value is before this date, the picker clamps.
   * Used for end-time pickers to prevent selecting a time before the start.
   */
  minimumDate?: Date;
  /** Called when the user taps 취소 (cancel) or the backdrop. */
  onCancel: () => void;
  /** Called when the user taps 저장 (save) with the final selected Date. */
  onConfirm: (selected: Date) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * A cross-platform date/time editor rendered inside a Modal.
 * Local state decouples user edits from the parent until 저장 is pressed.
 */
export function DateTimeModal({
  visible,
  initialValue,
  allDay = false,
  minimumDate,
  onCancel,
  onConfirm,
}: DateTimeModalProps) {
  const { t } = useTranslation();
  const colors = useColors();
  const styles = makeStyles(colors);

  /**
   * Buffered edit state — starts equal to `initialValue` every time the
   * modal opens. Does NOT bubble up to the parent until 저장.
   */
  const [draft, setDraft] = useState<Date>(initialValue);

  /** Re-seed the draft whenever the modal is re-opened. */
  useEffect(() => {
    if (visible) {
      setDraft(initialValue);
    }
  }, [visible, initialValue]);

  /**
   * Merge the date portion of the selection with the current draft's time.
   * Called by the date-only picker.
   */
  const handleDateChange = (_e: DateTimePickerEvent, selected?: Date) => {
    if (!selected) return;
    setDraft((prev) => {
      const next = new Date(selected);
      // Preserve the existing hour/minute — we only replaced year/month/day.
      next.setHours(prev.getHours(), prev.getMinutes(), 0, 0);
      return next;
    });
  };

  /**
   * Merge the time portion of the selection with the current draft's date.
   * Called by the time-only picker.
   */
  const handleTimeChange = (_e: DateTimePickerEvent, selected?: Date) => {
    if (!selected) return;
    setDraft((prev) => {
      const next = new Date(prev);
      next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
      return next;
    });
  };

  /** Commit the buffered draft to the parent and close. */
  const handleConfirm = () => {
    // Clamp to minimumDate if the user selected an earlier value.
    if (minimumDate && draft < minimumDate) {
      onConfirm(minimumDate);
      return;
    }
    onConfirm(draft);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      {/* Backdrop — tapping outside cancels */}
      <Pressable style={styles.backdrop} onPress={onCancel}>
        {/* Absorb touches on the sheet itself so taps inside don't dismiss */}
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          {/* Header */}
          <View style={styles.header}>
            <Pressable onPress={onCancel} hitSlop={12}>
              <Text style={styles.cancelText}>{t('common.cancel')}</Text>
            </Pressable>
            <Text style={styles.title}>
              {allDay ? t('time.date') : t('time.datetime') /* falls back to key */}
            </Text>
            <Pressable onPress={handleConfirm} hitSlop={12}>
              <Text style={styles.saveText}>{t('common.save')}</Text>
            </Pressable>
          </View>

          {/* Current value preview */}
          <View style={styles.preview}>
            <Text style={styles.previewText}>{formatPreview(draft, allDay)}</Text>
          </View>

          {/*
           * Date picker — full month calendar grid on iOS (display="inline"),
           * native inline calendar on Android. User taps a date cell instead
           * of scrolling a wheel.
           */}
          <View style={styles.pickerRow}>
            <DateTimePicker
              value={draft}
              mode="date"
              display={Platform.OS === 'ios' ? 'inline' : 'default'}
              onChange={handleDateChange}
              // Only pass minimumDate when provided (exactOptionalPropertyTypes)
              {...(minimumDate ? { minimumDate } : {})}
              style={styles.datePicker}
            />
          </View>

          {/*
           * Time picker — compact right-aligned button on iOS. Tapping it
           * reveals the native wheel popover, keeping the modal layout tight
           * (user feedback: "시간 수정 부분도 좀더 작게"). On Android the
           * default clock dial stays inline — it's already compact there.
           */}
          {!allDay && (
            <View style={styles.timeRow}>
              <Text style={styles.timeLabel}>
                {t('time.time', '시간')}
              </Text>
              <DateTimePicker
                value={draft}
                mode="time"
                display={Platform.OS === 'ios' ? 'compact' : 'default'}
                onChange={handleTimeChange}
                style={styles.timePicker}
              />
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a preview string for the header: "2026년 4월 23일 14:30".
 * allDay=true → drops the time portion.
 */
function formatPreview(date: Date, allDay: boolean): string {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  if (allDay) return `${y}년 ${m}월 ${d}일`;
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${y}년 ${m}월 ${d}일  ${hh}:${mm}`;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

/**
 * Factory so styles respond to dark/light theme switches.
 */
function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      paddingBottom: spacing[6],
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      height: 52,
      paddingHorizontal: spacing[4],
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    title: {
      ...textStyles.labelLg,
      color: colors.textPrimary,
    },
    cancelText: {
      ...textStyles.body,
      color: colors.textSecondary,
    },
    saveText: {
      ...textStyles.labelLg,
      color: colors.primary,
    },
    preview: {
      alignItems: 'center',
      paddingVertical: spacing[3],
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    previewText: {
      ...textStyles.h3,
      color: colors.primary,
    },
    pickerRow: {
      alignItems: 'center',
      paddingVertical: spacing[1],
    },
    datePicker: {
      width: '100%',
    },
    timeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[2],
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    timeLabel: {
      ...textStyles.body,
      color: colors.textPrimary,
    },
    timePicker: {
      flexGrow: 0,
    },
    picker: {
      width: '100%',
    },
  });
}
