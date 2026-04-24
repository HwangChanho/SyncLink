/**
 * CategoryChip — Inline category selector button for TodoEditSheet.
 *
 * Shows the current category (dot + name) or a placeholder ("카테고리 없음"),
 * with a chevron icon on the right. Pressing invokes the provided handler
 * which typically opens a CategoryPickerSheet.
 *
 * Sprint 14 TASK-1413
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useColors } from '@/hooks/useColors';
import type { ColorTokens } from '@/hooks/useColors';
import { radius, spacing } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import type { Category } from '@/types';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface CategoryChipProps {
  /** Resolved Category object (null = uncategorized). */
  category: Category | null;

  /** Called when the chip is tapped. Usually opens CategoryPickerSheet. */
  onPress: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * A pressable chip that displays the current todo category. When no category
 * is selected, shows an i18n placeholder so the user knows they can pick one.
 */
export function CategoryChip({ category, onPress }: CategoryChipProps) {
  const { t } = useTranslation();
  const colors = useColors();
  const styles = makeStyles(colors);

  const dotColor = category?.color ?? colors.textTertiary;
  const label = category?.name ?? t('planner.category_none');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('planner.change_category')}
      style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}
      onPress={onPress}
      hitSlop={8}
    >
      <View style={[styles.dot, { backgroundColor: dotColor }]} />
      <Text style={styles.label} numberOfLines={1}>{label}</Text>
      <Ionicons name="chevron-down" size={16} color={colors.textSecondary} />
    </Pressable>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function makeStyles(colors: ColorTokens) {
  return StyleSheet.create({
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: spacing[2],
      paddingHorizontal: spacing[3],
      paddingVertical: spacing[2],
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    chipPressed: {
      backgroundColor: colors.backgroundAlt,
    },
    dot: {
      width: 10,
      height: 10,
      borderRadius: radius.full,
    },
    label: {
      ...textStyles.labelLg,
      color: colors.textPrimary,
      maxWidth: 180,
    },
  });
}
