/**
 * WheelDatePicker — bottom-sheet 3-column wheel (year / month / day) for
 * calendar date navigation.
 *
 * Build-76 LEAD: "3번처럼 캘린더 날짜 이동하게 저걸로 바꿔주고" — 기존
 * YearMonthPicker (grid year + month grid) 대신 wheel-style date picker
 * 사용. 사용자가 한 번에 정확한 일자까지 선택해 캘린더 이동.
 *
 * - iOS: DateTimePicker mode='date' display='spinner' 가 native wheel.
 * - Android: display='spinner' fallback (compact picker / dialog).
 * - 취소: 변경 없이 닫음. 확인: 선택된 Date 를 onSelect 로 전달 + 닫음.
 */

import { useEffect, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { useTranslation } from 'react-i18next';
import { useColors } from '@/hooks/useColors';
import { radius, spacing } from '@/constants/spacing';
import { textStyles, fontWeight } from '@/constants/typography';

interface WheelDatePickerProps {
  /** 모달 가시성. */
  visible: boolean;
  /** 초기/현재 선택 일자 — wheel 시작 위치. */
  currentDate: Date;
  /** 사용자가 [확인] 누르면 선택된 일자 전달. */
  onSelect: (date: Date) => void;
  /** 사용자가 [취소] 또는 백드롭 탭. */
  onClose: () => void;
}

export function WheelDatePicker({
  visible,
  currentDate,
  onSelect,
  onClose,
}: WheelDatePickerProps) {
  const { t } = useTranslation();
  const colors = useColors();
  const styles = makeStyles(colors);

  // Modal 이 열릴 때마다 currentDate 로 draft 초기화.
  const [draft, setDraft] = useState<Date>(currentDate);
  useEffect(() => {
    if (visible) setDraft(currentDate);
  }, [visible, currentDate]);

  const handleDateChange = (_e: DateTimePickerEvent, selected?: Date) => {
    if (!selected) return;
    const next = new Date(selected);
    next.setHours(0, 0, 0, 0);
    setDraft(next);
  };

  const handleConfirm = () => {
    onSelect(draft);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.handle} />

          {/* Wheel picker. iOS: spinner = 3-column native wheel.
              Web: @react-native-community/datetimepicker 가 미지원 → 모달 안에
              아무것도 안 그려져 흰 화면처럼 보임. native HTML <input type="date">
              로 fallback (RN 의 RNW 가 인식 안 하지만 div 자식으로 렌더해도 됨). */}
          <View style={styles.pickerRow}>
            {Platform.OS === 'web'
              ? (
                <input
                  type="date"
                  value={
                    // toISOString() 은 UTC 기준이라 KST 의 자정 직후 (예:
                    // 2026-04-28 00:00 KST = UTC 2026-04-27 15:00) 가 하루
                    // 빠른 날짜로 바뀌어 picker 가 한 칸 어긋나는 버그.
                    // 로컬 Y/M/D 로 직접 포맷.
                    `${draft.getFullYear()}-${String(draft.getMonth() + 1).padStart(2, '0')}-${String(draft.getDate()).padStart(2, '0')}`
                  }
                  onChange={(e) => {
                    // input value 는 'YYYY-MM-DD' (로컬 day picker). 로컬 자정으로 해석.
                    const v = (e.target as HTMLInputElement).value;
                    const parts = v.split('-').map(Number);
                    if (parts.length === 3 && parts.every(n => Number.isFinite(n))) {
                      const [y, m, d] = parts as [number, number, number];
                      setDraft(new Date(y, m - 1, d));
                    }
                  }}
                  style={{
                    fontSize:        18,
                    padding:         12,
                    borderRadius:    8,
                    border:          '1px solid #444',
                    background:      'transparent',
                    color:           '#FFF',
                    width:           '100%',
                    colorScheme:     'dark',
                  }}
                />
              )
              : (
                <DateTimePicker
                  value={draft}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={handleDateChange}
                  style={styles.picker}
                  themeVariant="dark"
                />
              )}
          </View>

          {/* Action buttons — 취소 / 확인. */}
          <View style={styles.actions}>
            <Pressable
              style={[styles.button, styles.cancelButton]}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={t('common.cancel')}
            >
              <Text style={styles.cancelText}>{t('common.cancel')}</Text>
            </Pressable>
            <Pressable
              style={[styles.button, styles.confirmButton]}
              onPress={handleConfirm}
              accessibilityRole="button"
              accessibilityLabel={t('common.ok')}
            >
              <Text style={styles.confirmText}>{t('common.ok')}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: radius['2xl'],
      borderTopRightRadius: radius['2xl'],
      paddingTop: spacing[2],
      paddingBottom: spacing[4],
    },
    handle: {
      alignSelf: 'center',
      width: 40,
      height: 4,
      borderRadius: radius.full,
      backgroundColor: colors.border,
      marginBottom: spacing[2],
    },
    pickerRow: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: spacing[2],
    },
    picker: {
      width: '100%',
      height: 216, // iOS spinner default height
    },
    actions: {
      flexDirection: 'row',
      gap: spacing[3],
      paddingHorizontal: spacing[5],
      paddingTop: spacing[2],
    },
    button: {
      flex: 1,
      paddingVertical: spacing[3],
      borderRadius: radius.md,
      alignItems: 'center',
    },
    cancelButton: {
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.border,
    },
    cancelText: {
      ...textStyles.body,
      color: colors.textPrimary,
      fontWeight: fontWeight.semibold,
    },
    confirmButton: {
      backgroundColor: colors.textPrimary,
    },
    confirmText: {
      ...textStyles.body,
      color: colors.background,
      fontWeight: fontWeight.semibold,
    },
  });
}
