/**
 * KeyboardAwareScreen — Common wrapper that guarantees TextInputs are never
 * covered by the software keyboard.
 *
 * Behavior per-platform:
 *  - iOS:     KeyboardAvoidingView with `behavior="padding"` plus the header
 *             height (when relevant) so the scroll view lifts exactly the
 *             right amount.
 *  - Android: The native window resizes (`softwareKeyboardLayoutMode=resize`
 *             / `adjustResize`), so KeyboardAvoidingView is a no-op wrapper
 *             (behavior={undefined}) — letting Android handle layout itself
 *             avoids double-adjustment bugs.
 *  - Web:     No keyboard avoidance necessary; the native browser handles
 *             virtual keyboards for us.
 *
 * The internal ScrollView has `keyboardShouldPersistTaps="handled"` so that
 * tapping buttons while the keyboard is open does not require an extra tap to
 * dismiss the keyboard first.
 *
 * Sprint 14 TASK-1410
 */

import { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface KeyboardAwareScreenProps {
  /** Screen content. Usually form rows / TextInputs. */
  children: ReactNode;

  /**
   * Vertical offset for iOS KeyboardAvoidingView (headers, tab bars, etc.).
   * Defaults to 0. Screens rendered under a header should pass the header
   * height from `useHeaderHeight()`.
   */
  keyboardVerticalOffset?: number;

  /** Additional container style (applied to the outermost SafeAreaView). */
  style?: StyleProp<ViewStyle>;

  /** Content container style for the inner ScrollView. */
  contentContainerStyle?: StyleProp<ViewStyle>;

  /** Whether the content is scrollable. Default: true. */
  scrollEnabled?: boolean;

  /**
   * Which safe-area edges to apply. Default `['top','left','right']` because
   * forms usually place a submit button at the bottom that already accounts
   * for the bottom inset itself.
   */
  edges?: ('top' | 'bottom' | 'left' | 'right')[];
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Wrapper that handles keyboard avoidance + safe area for input-heavy screens.
 */
export function KeyboardAwareScreen({
  children,
  keyboardVerticalOffset = 0,
  style,
  contentContainerStyle,
  scrollEnabled = true,
  edges = ['top', 'left', 'right'],
}: KeyboardAwareScreenProps) {
  const colors = useColors();

  // Web: no virtual keyboard handling needed — just render children inside a
  // SafeAreaView-styled wrapper so spacing matches the native platforms.
  if (Platform.OS === 'web') {
    return (
      <SafeAreaView
        edges={edges}
        style={[styles.root, { backgroundColor: colors.background }, style]}
      >
        {scrollEnabled ? (
          <ScrollView
            style={styles.flex}
            contentContainerStyle={contentContainerStyle}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
        ) : (
          <View style={[styles.flex, contentContainerStyle]}>{children}</View>
        )}
      </SafeAreaView>
    );
  }

  // iOS uses `padding`; Android lets the OS resize the activity.
  const behavior = Platform.OS === 'ios' ? 'padding' : undefined;

  return (
    <SafeAreaView
      edges={edges}
      style={[styles.root, { backgroundColor: colors.background }, style]}
    >
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={behavior}
        keyboardVerticalOffset={keyboardVerticalOffset}
      >
        {scrollEnabled ? (
          <ScrollView
            style={styles.flex}
            contentContainerStyle={contentContainerStyle}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
        ) : (
          <View style={[styles.flex, contentContainerStyle]}>{children}</View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
});
