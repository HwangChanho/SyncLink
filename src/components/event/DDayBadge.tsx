/**
 * DDayBadge — compact "D-day" pill for relative-date events (v1.3).
 *
 * Shows how many calendar days remain until an event's target date, optionally
 * prefixed with the event's offset label (e.g. "도착예상 D-3"). The D-day value
 * is computed lazily from `target` relative to today (see lib/relativeDate), so
 * it stays correct without being persisted.
 *
 * Used by the home today-list and the desktop selected-day panel.
 */
import { View, Text, StyleSheet } from 'react-native';
import { useColors } from '@/hooks/useColors';
import type { ColorTokens } from '@/hooks/useColors';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import { dDayBadge } from '@/lib/relativeDate';

interface Props {
  /** The event's target date (its start_at). D-day is computed vs. today. */
  target: Date;
  /** Optional offset label shown before the D-day token (e.g. "도착예상"). */
  label?: string | null;
}

/** Renders e.g. "도착예상 D-3" / "D-DAY" as a small accent pill. */
export function DDayBadge({ target, label }: Props) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const dday = dDayBadge(target);
  const text = label ? `${label} ${dday}` : dday;

  return (
    <View style={styles.badge}>
      <Text style={styles.text} numberOfLines={1}>{text}</Text>
    </View>
  );
}

function makeStyles(colors: ColorTokens) {
  return StyleSheet.create({
    badge: {
      alignSelf: 'flex-start',
      backgroundColor: colors.primaryLight,
      borderRadius: radius.sm,
      paddingVertical: spacing[0.5],
      paddingHorizontal: spacing[1.5],
      marginTop: spacing[0.5],
    },
    text: {
      ...textStyles.labelSm,
      color: colors.primary,
    },
  });
}
