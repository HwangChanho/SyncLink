/**
 * ConfirmModal
 *
 * Overlay modal that shows the EventPreviewCard and presents two actions:
 *  - "확인" → triggers onConfirm() → caller creates the event
 *  - "직접 입력" → triggers onEdit() → caller navigates to create.tsx with pre-fill
 *
 * Pressing the dimmed backdrop dismisses the modal without action.
 */

import { useEffect, useState } from 'react';
import { Modal, View, Text, Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { EventPreviewCard } from './EventPreviewCard';
import type { NLParseResult } from '@/types';
import { useColors } from '@/hooks/useColors';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  /** Whether the modal is currently visible. */
  visible: boolean;
  /** The parse result to display in the preview card. */
  result: NLParseResult;
  /**
   * v1.2.9 — "확인" 콜백. 사용자가 ColorPicker 에서 고른 색을 함께 전달.
   * null = auto/default (기존 동작). hex string = 명시 색상.
   */
  onConfirm: (color: string | null) => void;
  /** Called when the user taps "직접 입력" (navigate to create form). */
  onEdit: () => void;
  /** Called when the user dismisses the modal without acting. */
  onDismiss: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ConfirmModal({ visible, result, onConfirm, onEdit, onDismiss }: Props) {
  // Resolve active theme colors for dark mode support (TASK-700)
  const { t } = useTranslation();
  const colors = useColors();
  const styles = makeStyles(colors);

  // v1.2.9 — 선택된 색상 (null = auto). 모달이 다시 열릴 때마다 reset.
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  useEffect(() => {
    if (visible) setSelectedColor(null);
  }, [visible, result]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDismiss}
      statusBarTranslucent
    >
      {/* Dimmed backdrop — tap to dismiss */}
      <Pressable style={styles.backdrop} onPress={onDismiss}>
        {/* Stop propagation so tapping the card doesn't dismiss */}
        <Pressable style={styles.sheet} onPress={() => { /* noop */ }}>

          <Text style={styles.heading}>{t('common.preview')}</Text>

          <EventPreviewCard
            result={result}
            selectedColor={selectedColor}
            onColorChange={setSelectedColor}
          />

          {/* Action buttons. Build-75 — 사용자: "AI 일정 등록할때 취소도
              있어야해". 백드롭 탭 dismiss 외 명시적 취소 버튼 추가. */}
          <View style={styles.actions}>
            <Pressable
              style={[styles.button, styles.cancelButton]}
              onPress={onDismiss}
              accessibilityRole="button"
              accessibilityLabel={t('common.cancel')}
            >
              <Text style={styles.cancelButtonText}>{t('common.cancel')}</Text>
            </Pressable>
            <Pressable
              style={[styles.button, styles.editButton]}
              onPress={onEdit}
              accessibilityRole="button"
              accessibilityLabel={t('common.a11y_manual_input')}
            >
              <Text style={styles.editButtonText}>{t('common.edit')}</Text>
            </Pressable>
            <Pressable
              style={[styles.button, styles.confirmButton]}
              onPress={() => onConfirm(selectedColor)}
              accessibilityRole="button"
              accessibilityLabel={t('common.a11y_confirm')}
            >
              <Text style={styles.confirmButtonText}>{t('common.ok')}</Text>
            </Pressable>
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
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing[5],
    gap: spacing[4],
    // Ensure the sheet doesn't get hit-slop from the backdrop
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 8,
  },
  heading: {
    ...(textStyles.h4 as object),
    color: colors.textPrimary,
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: spacing[3],
  },
  button: {
    flex: 1,
    paddingVertical: spacing[3],
    borderRadius: radius.md,
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border,
  },
  cancelButtonText: {
    ...(textStyles.body as object),
    color: colors.textSecondary,
    fontWeight: '500',
  },
  editButton: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  editButtonText: {
    ...(textStyles.body as object),
    color: colors.textSecondary,
    fontWeight: '500',
  },
  confirmButton: {
    backgroundColor: colors.primary,
  },
  confirmButtonText: {
    ...(textStyles.body as object),
    color: colors.textInverse,
    fontWeight: '600',
  },
  });
}
