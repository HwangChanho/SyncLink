/**
 * Dynamic styles factory for the Planner screen and its sub-components.
 * Extracted from planner.tsx to reduce file size.
 *
 * TASK-600: makeStyles(colors) pattern for dark-mode support.
 */

import { StyleSheet } from 'react-native';
import type { ColorTokens } from '@/hooks/useColors';
import { spacing, radius, componentHeight } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';

export function makeStyles(colors: ColorTokens) {
  return StyleSheet.create({
    flex: { flex: 1 },

    container: {
      flex: 1,
      backgroundColor: colors.background,
    },

    // Header — title removed; this row only holds the right-side action icon.
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[2],
    },
    headerAction: {
      padding: spacing[1],
    },

    // Tab bar
    tabBar: {
      flexDirection: 'row',
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      backgroundColor: colors.background,
    },
    tabItem: {
      flex: 1,
      paddingVertical: spacing[3],
      alignItems: 'center',
      borderBottomWidth: 2,
      borderBottomColor: 'transparent',
    },
    tabItemActive: {
      borderBottomColor: colors.primary,
    },
    tabLabel: {
      ...textStyles.labelLg,
      color: colors.textSecondary,
    },
    tabLabelActive: {
      color: colors.primary,
    },

    // List
    listContainer: { flex: 1 },
    listContent: {
      paddingBottom: spacing[20],
    },

    // Category section
    categorySection: {
      marginBottom: spacing[2],
    },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[2],
      gap: spacing[2],
      backgroundColor: colors.backgroundAlt,
    },
    categoryDot: {
      width: 8,
      height: 8,
      borderRadius: radius.full,
    },
    sectionTitle: {
      ...textStyles.labelLg,
      color: colors.textPrimary,
      flex: 1,
    },
    sectionCount: {
      ...textStyles.caption,
      color: colors.textTertiary,
    },
    completedToggle: {
      paddingHorizontal: spacing[2],
    },
    completedToggleText: {
      ...textStyles.caption,
      color: colors.primary,
    },

    // Swipe action backdrops (TASK-1414)
    swipeAction: {
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      width: 96,
      gap: spacing[1],
    },
    swipeDeleteAction: {
      backgroundColor: colors.error,
    },
    swipeCategoryAction: {
      backgroundColor: colors.primary,
    },
    swipeActionText: {
      ...textStyles.labelSm,
      color: colors.textInverse,
    },

    // Todo row
    todoRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[3],
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      gap: spacing[3],
      backgroundColor: colors.background,
    },
    todoRowPressed: {
      backgroundColor: colors.backgroundAlt,
    },
    checkboxContainer: {
      justifyContent: 'center',
    },
    checkbox: {
      width: 22,
      height: 22,
      borderRadius: radius.sm,
      borderWidth: 2,
      borderColor: colors.borderStrong,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkboxChecked: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    todoTitle: {
      ...textStyles.body,
      color: colors.textPrimary,
      flex: 1,
    },
    todoTitleCompleted: {
      textDecorationLine: 'line-through',
      color: colors.textTertiary,
    },
    // Build-64 — 할일 리스트 우측 요일 라벨. Build-67 — 요일 + 날짜 + (시간) 동시.
    todoDow: {
      ...textStyles.caption,
      color: colors.textTertiary,
      // 요일+날짜+시간 = "화 5/4 14:30" 약 60px. 충분한 폭 확보.
      minWidth: 60,
      textAlign: 'right',
      marginRight: 4,
    },
    priorityBadge: {
      paddingHorizontal: spacing[2],
      paddingVertical: spacing[0.5],
      borderRadius: radius.sm,
    },
    priorityText: {
      ...textStyles.labelSm,
    },

    // Notes grid
    notesGrid: {
      padding: spacing[3],
      paddingBottom: spacing[20],
    },
    notesRow: {
      gap: spacing[3],
      marginBottom: spacing[3],
    },
    noteCard: {
      flex: 1,
      backgroundColor: colors.surface,
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing[4],
      minHeight: 120,
      gap: spacing[1],
    },
    noteCardPressed: {
      backgroundColor: colors.backgroundAlt,
    },
    noteCardTitle: {
      ...textStyles.labelLg,
      color: colors.textPrimary,
    },
    noteCardPreview: {
      ...textStyles.bodySm,
      color: colors.textSecondary,
      flex: 1,
    },
    noteCardDate: {
      ...textStyles.caption,
      color: colors.textTertiary,
      marginTop: spacing[1],
    },
    // YouTube thumbnail shown at the top of a note card when the body has a
    // YouTube link (and the user setting is on). 16:9 to match the source.
    noteCardThumbnail: {
      width: '100%',
      aspectRatio: 16 / 9,
      borderRadius: radius.md,
      marginBottom: spacing[1],
      // Placeholder tint while the remote image loads.
      backgroundColor: colors.backgroundAlt,
    },

    // Quick add bar
    quickAddBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[2],
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[3],
      borderTopWidth: 1,
      borderTopColor: colors.border,
      backgroundColor: colors.background,
    },
    quickAddInput: {
      flex: 1,
      height: componentHeight.buttonSm,
      backgroundColor: colors.inputBackground,
      borderWidth: 1,
      borderColor: colors.inputBorder,
      borderRadius: radius.full,
      paddingHorizontal: spacing[4],
      ...textStyles.body,
      color: colors.textPrimary,
    },
    quickAddBtn: {
      width: componentHeight.buttonSm,
      height: componentHeight.buttonSm,
      borderRadius: radius.full,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    quickAddCategoryChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      maxWidth: 110,
      paddingHorizontal: spacing[2],
      height: componentHeight.buttonSm,
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: colors.inputBorder,
      backgroundColor: colors.inputBackground,
    },
    quickAddCategoryLabel: {
      ...textStyles.caption,
      color: colors.textSecondary,
    },
    quickAddIconBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      paddingHorizontal: spacing[2],
      height: componentHeight.buttonSm,
      minWidth: componentHeight.buttonSm,
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: colors.inputBorder,
      backgroundColor: colors.inputBackground,
    },
    quickAddIconLabel: {
      ...textStyles.caption,
    },
    // Segmented control for Todo tab grouping.
    viewModeBar: {
      flexDirection: 'row',
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[2],
      gap: spacing[2],
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    viewModeItem: {
      paddingHorizontal: spacing[3],
      paddingVertical: spacing[1],
      borderRadius: radius.full,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    viewModeItemActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    viewModeLabel: {
      ...textStyles.caption,
      color: colors.textSecondary,
    },
    viewModeLabelActive: {
      color: colors.textInverse,
      fontWeight: '600',
    },

    // FAB
    fab: {
      position: 'absolute',
      right: spacing[5],
      bottom: spacing[8],
      width: 56,
      height: 56,
      borderRadius: radius.full,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      elevation: 4,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.25,
      shadowRadius: 4,
    },

    // Empty states
    centered: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing[3],
      padding: spacing[6],
    },
    emptyText: {
      ...textStyles.h4,
      color: colors.textSecondary,
    },
    emptySubText: {
      ...textStyles.bodySm,
      color: colors.textTertiary,
      textAlign: 'center',
    },

    // Edit modal
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.4)',
      justifyContent: 'flex-end',
    },
    modalSheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: radius['2xl'],
      borderTopRightRadius: radius['2xl'],
      padding: spacing[6],
      gap: spacing[4],
    },
    modalTitle: {
      ...textStyles.h4,
      color: colors.textPrimary,
    },
    modalInput: {
      height: componentHeight.inputField,
      backgroundColor: colors.inputBackground,
      borderWidth: 1,
      borderColor: colors.inputBorder,
      borderRadius: radius.md,
      paddingHorizontal: spacing[4],
      ...textStyles.body,
      color: colors.textPrimary,
    },
    modalActions: {
      flexDirection: 'row',
      gap: spacing[3],
    },
    modalCancelBtn: {
      flex: 1,
      height: componentHeight.buttonSm,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    modalCancelText: {
      ...textStyles.labelLg,
      color: colors.textSecondary,
    },
    modalSaveBtn: {
      flex: 1,
      height: componentHeight.buttonSm,
      borderRadius: radius.md,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    modalSaveText: {
      ...textStyles.labelLg,
      color: colors.textInverse,
    },
    buttonDisabled: {
      opacity: 0.5,
    },
  });
}

/** Convenience type alias used by TodoTab, NotesTab sub-components. */
export type PlannerStyles = ReturnType<typeof makeStyles>;
