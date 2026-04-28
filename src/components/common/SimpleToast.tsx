/**
 * SimpleToast — lightweight auto-dismissing info toast.
 *
 * Usage pattern:
 *   const { toast, showToast } = useSimpleToast();
 *   // ... after a successful action:
 *   showToast('일정이 추가되었어요');
 *   // ... in JSX (absolute overlay, bottom of screen):
 *   {toast && <SimpleToast toast={toast} />}
 *
 * Design decisions:
 *  - Mirrors the existing UndoToast visual style (EventBlockGestureHandler)
 *    for consistent look-and-feel across the app.
 *  - No undo action — pure info variant with a single dismiss handle.
 *  - Auto-dismisses after `TOAST_DURATION_MS` (2 s). Calling showToast again
 *    while one is visible resets the timer cleanly.
 *  - Does NOT use react-native-toast-message or any native package —
 *    keeps the dependency surface minimal (CLAUDE.md cost principle).
 *
 * @module SimpleToast
 */

import { useCallback, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';

// ─── Duration constant ────────────────────────────────────────────────────────

/** How long the toast stays visible before auto-dismissing (milliseconds). */
const TOAST_DURATION_MS = 2000;

// ─── State type ───────────────────────────────────────────────────────────────

/**
 * State object passed from the hook to the UI component.
 * The component renders this as a toast banner.
 */
export interface SimpleToastState {
  /** Message to display inside the toast. */
  message: string;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * useSimpleToast — manages show/hide lifecycle for a SimpleToast.
 *
 * @returns `{ toast, showToast }` — current toast state (null = hidden) +
 *          a function to trigger a new toast.
 *
 * @example
 * ```tsx
 * const { toast, showToast } = useSimpleToast();
 * // trigger
 * showToast('일정이 추가되었어요');
 * // render
 * {toast && <SimpleToast toast={toast} />}
 * ```
 */
export function useSimpleToast(): {
  toast: SimpleToastState | null;
  showToast: (message: string) => void;
} {
  const [toast, setToast] = useState<SimpleToastState | null>(null);
  // Ref to current auto-dismiss timer so we can reset it if showToast is called again.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string) => {
    // Cancel any existing timer so calling showToast rapidly doesn't leave stale state.
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }

    setToast({ message });

    // Auto-dismiss after the configured duration.
    timerRef.current = setTimeout(() => {
      setToast(null);
      timerRef.current = null;
    }, TOAST_DURATION_MS);
  }, []);

  return { toast, showToast };
}

// ─── UI component ─────────────────────────────────────────────────────────────

/**
 * SimpleToast — renders an info banner at the bottom of the screen.
 *
 * The caller is responsible for absolute positioning; typically rendered
 * inside a `SafeAreaView` so it sits above the home indicator on iOS.
 *
 * @param toast - SimpleToastState from useSimpleToast
 *
 * @example
 * ```tsx
 * {toast && <SimpleToast toast={toast} />}
 * ```
 */
export function SimpleToast({ toast }: { toast: SimpleToastState }) {
  return (
    <View style={styles.container} testID="simple-toast">
      <Text
        style={styles.message}
        numberOfLines={2}
        testID="simple-toast-message"
      >
        {toast.message}
      </Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  /**
   * Toast container — absolutely positioned at the bottom of the host view.
   * Matches the visual language of UndoToast (dark background, rounded corners).
   * The caller does NOT need to position this; the style is self-contained.
   */
  container: {
    position: 'absolute',
    bottom: 24,
    left: 24,
    right: 24,
    backgroundColor: '#1F2937',
    borderRadius: radius.md,
    paddingHorizontal: 16,
    paddingVertical: 12,
    // iOS shadow
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    // Android elevation
    elevation: 8,
  },

  /**
   * Toast message text.
   * Uses labelSm weight from the design system for consistency with UndoToast.
   */
  message: {
    ...textStyles.labelSm,
    color: '#F9FAFB',
    textAlign: 'center',
  },
});
