/**
 * Shared style fragments for the "My" tab section components
 * (SettingsSection / ServiceInfoSection / AccountSection).
 *
 * Keeping these in one place avoids drift when the section header or menu
 * card visuals change. Each component composes the returned styles with
 * its own local additions.
 *
 * Sprint 19 TASK-1903 — extracted from src/app/(tabs)/my.tsx as part of the
 * progressive split of large screens.
 */

import { StyleSheet } from 'react-native';
import type { ColorTokens } from '@/hooks/useColors';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';

/** Builds the shared section + menu-card styles for a given theme. */
export function makeMenuStyles(colors: ColorTokens) {
  return StyleSheet.create({
    section: {
      paddingHorizontal: spacing[4],
      gap: spacing[2],
    },
    sectionTitle: {
      ...textStyles.labelLg,
      color: colors.textSecondary,
      paddingHorizontal: spacing[1],
    },
    menuCard: {
      backgroundColor: colors.surface,
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    menuItem: {
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[4],
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    menuItemText: {
      ...textStyles.labelLg,
      color: colors.textPrimary,
    },
    menuItemChevron: {
      fontSize: 22,
      color: colors.textTertiary,
      fontWeight: '300',
    },
    menuItemValue: {
      ...textStyles.body,
      color: colors.textSecondary,
    },
    menuDivider: {
      height: 1,
      backgroundColor: colors.border,
      marginHorizontal: spacing[4],
    },
  });
}
