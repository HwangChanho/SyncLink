/**
 * EmptyState — reusable empty / placeholder state.
 *
 * Renders a centered icon badge + title + optional description + optional
 * primary CTA. Used for empty lists, guest gates, and "nothing here yet"
 * placeholders so empty states look consistent across the app instead of
 * each screen rolling its own ad-hoc markup.
 *
 * Part B-① of the 2026-06-04 UI redesign plan
 * (docs/plans/2026-06-04-guest-entry-and-ui-redesign.md).
 */

import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { spacing, radius, componentHeight } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';

interface EmptyStateProps {
  /** Ionicons glyph shown in the badge above the title. */
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  /** Optional supporting line under the title. */
  description?: string;
  /** Optional primary CTA. Both label and handler are required to render it. */
  actionLabel?: string;
  onAction?: () => void;
  /** Tighter spacing for inline (in-card) use vs the default full-screen layout. */
  compact?: boolean;
  testID?: string;
}

/**
 * @param icon         Ionicons name (defaults to a friendly "sparkles").
 * @param title        Primary message (required).
 * @param description  Secondary explanatory line.
 * @param actionLabel  CTA button text — rendered only when onAction is also set.
 * @param onAction     CTA press handler.
 * @param compact      Reduces padding/gaps for embedding inside a card.
 */
export function EmptyState({
  icon = 'sparkles-outline',
  title,
  description,
  actionLabel,
  onAction,
  compact = false,
  testID,
}: EmptyStateProps) {
  const colors = useColors();
  const styles = makeStyles(colors);

  return (
    <View style={[styles.container, compact && styles.containerCompact]} testID={testID}>
      <View style={styles.iconBadge}>
        <Ionicons name={icon} size={compact ? 28 : 34} color={colors.primary} />
      </View>
      <Text style={styles.title}>{title}</Text>
      {description ? <Text style={styles.description}>{description}</Text> : null}
      {actionLabel && onAction ? (
        <Pressable
          style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
          onPress={onAction}
          accessibilityRole="button"
        >
          <Text style={styles.actionText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing[8],
      paddingVertical: spacing[10],
      gap: spacing[3],
    },
    // Inline variant: don't grab all vertical space, smaller rhythm.
    containerCompact: {
      flex: 0,
      paddingVertical: spacing[6],
      gap: spacing[2],
    },
    iconBadge: {
      width: 72,
      height: 72,
      borderRadius: radius.full,
      backgroundColor: colors.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing[1],
    },
    title: {
      ...textStyles.h4,
      color: colors.textPrimary,
      textAlign: 'center',
    },
    description: {
      ...textStyles.body,
      color: colors.textSecondary,
      textAlign: 'center',
    },
    action: {
      marginTop: spacing[3],
      minHeight: componentHeight.button,
      paddingHorizontal: spacing[6],
      borderRadius: radius.lg,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    actionPressed: { opacity: 0.85 },
    actionText: {
      ...textStyles.labelLg,
      color: colors.textInverse,
    },
  });
}
