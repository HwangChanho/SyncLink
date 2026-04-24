/**
 * PinPad — reusable 4-digit PIN entry UI.
 *
 * Renders a header label, four dot indicators, and a 3×4 numeric keypad
 * (digits 0-9 plus a backspace button). The consumer receives the full
 * 4-digit string via `onComplete` once the user has entered four digits.
 *
 * The component is fully controlled: it holds no state beyond the in-
 * progress input and emits an `onChange` callback for partial entries so
 * the container can, for example, clear any existing error message.
 *
 * Sprint 15 TASK-1510.
 */

import { memo, useCallback, useState, useEffect } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface PinPadProps {
  /** Label shown above the dots (e.g. "Enter your passcode"). */
  label: string;
  /** Optional secondary / error line under the label. */
  subLabel?: string | undefined;
  /** Colour the subLabel red when true to denote an error condition. */
  subLabelIsError?: boolean | undefined;
  /** Called with the full 4-digit PIN once the user finishes entry. */
  onComplete: (pin: string) => void;
  /** Called whenever the in-progress PIN changes (including backspace). */
  onChange?: ((pin: string) => void) | undefined;
  /**
   * Auto-reset the in-progress input when this key changes (e.g. after a
   * failed verification attempt the container bumps the key so the dots
   * clear themselves).
   */
  resetKey?: unknown;
}

// ─── Component ────────────────────────────────────────────────────────────────

/** Digit layout — 3 columns × 4 rows. Final row is "·  0  ⌫". */
const KEY_ROWS: readonly (readonly string[])[] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['',  '0', 'back'],
] as const;

function PinPadImpl({
  label,
  subLabel,
  subLabelIsError,
  onComplete,
  onChange,
  resetKey,
}: PinPadProps) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const [pin, setPin] = useState<string>('');

  // Clear in-progress input when the container requests a reset.
  useEffect(() => {
    setPin('');
  }, [resetKey]);

  const handlePress = useCallback((key: string) => {
    setPin((current) => {
      let next = current;
      if (key === 'back') {
        next = current.slice(0, -1);
      } else if (/^[0-9]$/.test(key) && current.length < 4) {
        next = current + key;
      }
      onChange?.(next);
      if (next.length === 4) {
        // Defer completion to next tick so the 4th dot renders before we
        // (potentially) clear state in onComplete's handler.
        setTimeout(() => onComplete(next), 0);
      }
      return next;
    });
  }, [onComplete, onChange]);

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      {subLabel ? (
        <Text style={[styles.subLabel, subLabelIsError && styles.subLabelError]}>
          {subLabel}
        </Text>
      ) : null}

      {/* Dot indicators showing how many digits have been entered so far. */}
      <View style={styles.dotsRow}>
        {[0, 1, 2, 3].map((i) => (
          <View
            key={i}
            style={[
              styles.dot,
              i < pin.length ? styles.dotFilled : styles.dotEmpty,
            ]}
          />
        ))}
      </View>

      {/* Numeric keypad. Empty slots render a spacer to keep the grid square. */}
      <View style={styles.keypad}>
        {KEY_ROWS.map((row, rowIdx) => (
          <View key={rowIdx} style={styles.keypadRow}>
            {row.map((key, colIdx) => {
              if (key === '') {
                return <View key={colIdx} style={styles.key} />;
              }
              return (
                <Pressable
                  key={colIdx}
                  style={({ pressed }) => [
                    styles.key,
                    styles.keyActive,
                    pressed && styles.keyPressed,
                  ]}
                  onPress={() => handlePress(key)}
                  accessibilityRole="button"
                  accessibilityLabel={key === 'back' ? 'backspace' : key}
                >
                  {key === 'back' ? (
                    <Ionicons name="backspace-outline" size={24} color={colors.textPrimary} />
                  ) : (
                    <Text style={styles.keyText}>{key}</Text>
                  )}
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

export const PinPad = memo(PinPadImpl);

// ─── Styles ───────────────────────────────────────────────────────────────────

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: {
      alignItems: 'center',
      gap:        spacing[5],
      paddingHorizontal: spacing[5],
    },
    label: {
      ...textStyles.h3,
      color: colors.textPrimary,
      textAlign: 'center',
    },
    subLabel: {
      ...textStyles.bodySm,
      color: colors.textSecondary,
      textAlign: 'center',
    },
    subLabelError: {
      color: colors.error,
    },
    dotsRow: {
      flexDirection: 'row',
      gap: spacing[3],
      marginVertical: spacing[2],
    },
    dot: {
      width:        16,
      height:       16,
      borderRadius: radius.full,
      borderWidth:  1,
      borderColor:  colors.border,
    },
    dotEmpty: {
      backgroundColor: 'transparent',
    },
    dotFilled: {
      backgroundColor: colors.primary,
      borderColor:     colors.primary,
    },
    keypad: {
      width: '100%',
      maxWidth: 320,
      gap: spacing[2],
    },
    keypadRow: {
      flexDirection: 'row',
      gap:           spacing[2],
    },
    key: {
      flex:         1,
      aspectRatio:  1,
      alignItems:     'center',
      justifyContent: 'center',
    },
    keyActive: {
      backgroundColor: colors.surface,
      borderRadius:    radius.full,
      borderWidth:     1,
      borderColor:     colors.border,
    },
    keyPressed: {
      backgroundColor: colors.primaryLight,
    },
    keyText: {
      ...textStyles.h2,
      color: colors.textPrimary,
    },
  });
}
