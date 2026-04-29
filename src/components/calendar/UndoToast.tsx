/**
 * UndoToast — 5-second "되돌리기" toast for drag-to-reschedule.
 *
 * Public surface:
 *   - useUndoToast(): { toast, showUndo } — state + trigger
 *   - <UndoToast toast={toast} /> — UI component
 *   - UndoToastState — the data shape passed between them
 *
 * Extracted from EventBlockGestureHandler.tsx during Phase 1.2 of the
 * v1.0 stabilization plan so the gesture file can focus on the gesture
 * + animation logic alone.
 */

import { useCallback, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useColors } from '@/hooks/useColors';
import { radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';

/** How long the toast stays visible before auto-dismissing. */
const UNDO_TOAST_DURATION_MS = 5_000;

// ─── State + hook ────────────────────────────────────────────────────────────

/**
 * Undo toast state returned by `useUndoToast`. The parent renders the toast UI
 * whenever this object is non-null.
 */
export interface UndoToastState {
  visible: boolean;
  /** Label describing the undo action — typically the moved event's title. */
  label: string;
  /** Invoked when the user taps "되돌리기". Reverts the move. */
  onUndo: () => void;
}

/**
 * Manages a 5-second "되돌리기" toast for drag-to-reschedule.
 *
 * After a successful reschedule, call `showUndo(label, undoCallback)`. The
 * toast auto-dismisses after UNDO_TOAST_DURATION_MS. If the user taps the
 * button before that, `undoCallback` runs immediately and the toast hides.
 */
export function useUndoToast(): {
  toast: UndoToastState | null;
  showUndo: (label: string, undoFn: () => void) => void;
} {
  const [toast, setToast] = useState<UndoToastState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showUndo = useCallback((label: string, undoFn: () => void) => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }

    const onUndo = () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setToast(null);
      undoFn();
    };

    setToast({ visible: true, label, onUndo });

    timerRef.current = setTimeout(() => {
      setToast(null);
      timerRef.current = null;
    }, UNDO_TOAST_DURATION_MS);
  }, []);

  return { toast, showUndo };
}

// ─── UI component ────────────────────────────────────────────────────────────

/**
 * Lightweight bottom-anchored toast banner. Caller is responsible for
 * placing this inside the calendar view; positioning is absolute.
 */
export function UndoToast({ toast }: { toast: UndoToastState }) {
  const colors = useColors();
  const styles = makeToastStyles(colors);

  return (
    <View style={styles.container} testID="undo-toast">
      <Text style={styles.label} numberOfLines={1}>
        "{toast.label}" 이동됨
      </Text>
      <TouchableOpacity
        onPress={toast.onUndo}
        activeOpacity={0.7}
        testID="undo-toast-button"
      >
        <Text style={styles.undoButton}>되돌리기</Text>
      </TouchableOpacity>
    </View>
  );
}

function makeToastStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: {
      position: 'absolute',
      bottom: 16,
      left: 16,
      right: 16,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.md,
      paddingHorizontal: 16,
      paddingVertical: 10,
      elevation: 8,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.25,
      shadowRadius: 4,
    },
    label: {
      ...textStyles.labelSm,
      color: colors.textPrimary,
      flex: 1,
      marginRight: 12,
    },
    undoButton: {
      ...textStyles.labelSm,
      color: colors.primary,
      fontWeight: '700',
    },
  });
}
