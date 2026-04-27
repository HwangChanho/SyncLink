/**
 * Shared StyleSheet factory for the Space detail screen + its
 * sub-components. Extracted from src/app/space/[id].tsx during the
 * Sprint 20 large-file split — the screen file was 1569 lines, of
 * which ~500 were styles; pulling them out here lets the screen and
 * each presentation component import the same single source.
 */

import { StyleSheet } from 'react-native';
import type { useColors } from '@/hooks/useColors';
import { spacing, radius, componentHeight } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';

export function makeSpaceDetailStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing[4],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    ...textStyles.h4,
    color: colors.textPrimary,
    flex: 1,
    textAlign: 'center',
  },
  closeButton: {
    minWidth: 44,
  },
  closeText: {
    ...textStyles.body,
    color: colors.primary,
  },
  actionLoadingBar: {
    height: 4,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[2],
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing[4],
    paddingBottom: spacing[10],
    gap: spacing[4],
  },
  // Space header
  spaceHeader: {
    alignItems: 'center',
    paddingVertical: spacing[6],
  },
  spaceAvatar: {
    width: 80,
    height: 80,
    borderRadius: radius['2xl'],
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[3],
  },
  spaceAvatarImage: {
    width: 80,
    height: 80,
    borderRadius: radius['2xl'],
  },
  spaceAvatarEmoji: {
    fontSize: 36,
  },
  spaceNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginBottom: spacing[2],
  },
  spaceName: {
    ...textStyles.h3,
    color: colors.textPrimary,
  },
  spaceTypeBadge: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    borderRadius: radius.full,
    backgroundColor: colors.primaryLight,
  },
  spaceTypeText: {
    ...textStyles.labelSm,
    color: colors.primary,
  },
  // Section cards
  sectionCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing[4],
    gap: spacing[3],
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    ...textStyles.labelLg,
    color: colors.textSecondary,
  },
  sectionActionText: {
    ...textStyles.label,
    color: colors.primary,
  },
  // Invite code
  inviteCodeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
  },
  inviteCode: {
    flex: 1,
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: 6,
    color: colors.textPrimary,
  },
  shareButton: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderRadius: radius.full,
    backgroundColor: colors.primary,
  },
  shareButtonText: {
    ...textStyles.label,
    color: colors.textInverse,
  },
  inviteActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  contactButton: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  regenerateButton: {
    paddingVertical: spacing[1],
  },
  regenerateText: {
    ...textStyles.label,
    color: colors.textSecondary,
    textDecorationLine: 'underline',
  },
  capacityHint: {
    ...textStyles.caption,
    color: colors.textTertiary,
  },
  // Members
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
  },
  memberAvatar: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    borderWidth: 2,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  memberAvatarImage: {
    width: 44,
    height: 44,
  },
  memberAvatarInitial: {
    ...textStyles.bodyLg,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  memberInfo: {
    flex: 1,
    gap: spacing[1],
  },
  memberName: {
    ...textStyles.body,
    color: colors.textPrimary,
  },
  meTag: {
    ...textStyles.bodySm,
    color: colors.textTertiary,
  },
  ownerBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: colors.primaryLight,
  },
  ownerBadgeText: {
    ...textStyles.labelSm,
    color: colors.primary,
  },
  removeMemberText: {
    ...textStyles.label,
    color: colors.error,
  },
  inviteMemberButton: {
    paddingVertical: spacing[2],
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    alignItems: 'center',
    borderStyle: 'dashed',
    marginTop: spacing[1],
  },
  inviteMemberText: {
    ...textStyles.label,
    color: colors.textSecondary,
  },
  // Anniversaries
  anniversaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
  },
  anniversaryInfo: {
    flex: 1,
    gap: spacing[0.5],
  },
  anniversaryTitle: {
    ...textStyles.body,
    color: colors.textPrimary,
  },
  anniversaryDate: {
    ...textStyles.caption,
    color: colors.textSecondary,
  },
  anniversaryRight: {
    alignItems: 'flex-end',
    gap: spacing[1],
  },
  ddayLabel: {
    ...textStyles.label,
    color: colors.primary,
    fontWeight: '700',
  },
  deleteButton: {
    paddingHorizontal: spacing[1],
  },
  deleteText: {
    ...textStyles.caption,
    color: colors.error,
  },
  emptyText: {
    ...textStyles.body,
    color: colors.textTertiary,
    textAlign: 'center',
    paddingVertical: spacing[2],
  },
  // Danger zone
  dangerZone: {
    marginTop: spacing[4],
  },
  leaveButton: {
    paddingVertical: spacing[4],
    alignItems: 'center',
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.error,
  },
  leaveButtonText: {
    ...textStyles.labelLg,
    color: colors.error,
  },
  // Error state
  errorText: {
    ...textStyles.body,
    color: colors.error,
    textAlign: 'center',
    marginBottom: spacing[4],
  },
  retryButton: {
    paddingHorizontal: spacing[6],
    paddingVertical: spacing[3],
    borderRadius: radius.full,
    backgroundColor: colors.primaryLight,
  },
  retryText: {
    ...textStyles.label,
    color: colors.primary,
  },

  // ── Free time finder ──────────────────────────────────────────────────────
  ftDateRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing[2],
  },
  ftDateField: {
    flex: 1,
    gap: spacing[1],
  },
  ftDateLabel: {
    ...textStyles.labelSm,
    color: colors.textSecondary,
  },
  ftDateInput: {
    height: 40,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing[3],
    ...textStyles.bodySm,
    color: colors.textPrimary,
    backgroundColor: colors.surfaceAlt,
  },
  ftDateSep: {
    ...textStyles.body,
    color: colors.textSecondary,
    marginBottom: spacing[2],
  },
  ftChipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    flexWrap: 'wrap',
  },
  ftChipLabel: {
    ...textStyles.labelSm,
    color: colors.textSecondary,
    marginRight: spacing[1],
  },
  ftChip: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  ftChipSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  ftChipText: {
    ...textStyles.labelSm,
    color: colors.textSecondary,
  },
  ftChipTextSelected: {
    color: colors.primary,
  },
  ftSearchButton: {
    height: 44,
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ftSearchButtonDisabled: {
    opacity: 0.6,
  },
  ftSearchButtonText: {
    ...textStyles.labelLg,
    color: colors.textInverse,
  },
  ftError: {
    ...textStyles.bodySm,
    color: colors.error,
  },
  ftSlotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[2],
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  ftSlotDot: {
    width: 8,
    height: 8,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    flexShrink: 0,
  },
  ftSlotInfo: {
    flex: 1,
    gap: spacing[0.5],
  },
  ftSlotDate: {
    ...textStyles.label,
    color: colors.textPrimary,
  },
  ftSlotTime: {
    ...textStyles.bodySm,
    color: colors.textSecondary,
  },
  ftSlotDur: {
    ...textStyles.label,
    color: colors.primary,
  },

  // ── Web-only invite actions (IDEA-014) ────────────────────────────────────
  /**
   * Wrapper column that stacks the three web-exclusive invite buttons
   * (email, link copy, QR) below the main share button row.
   * Only rendered when Platform.OS === 'web'.
   */
  webInviteContainer: {
    gap: spacing[2],
    marginTop: spacing[2],
  },
  /**
   * Base style for each web invite action button (outlined, full-width).
   */
  webInviteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  webInviteButtonText: {
    ...textStyles.label,
    color: colors.primary,
  },
  /**
   * Primary CTA variant — filled background for "Copy Invite Link" (the most
   * common web action). Replaces the border-only style for emphasis.
   */
  webInviteButtonPrimary: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  webInviteButtonTextPrimary: {
    ...textStyles.label,
    color: colors.textInverse,
  },
  /** QR image displayed below the buttons when toggled visible. */
  webQrWrapper: {
    alignItems: 'center',
    paddingVertical: spacing[3],
    gap: spacing[2],
  },
  webQrHint: {
    ...textStyles.caption,
    color: colors.textSecondary,
    textAlign: 'center',
  },

  // ── Anniversary add modal ──────────────────────────────────────────────────
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  modalSheetWrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius['2xl'],
    borderTopRightRadius: radius['2xl'],
    paddingHorizontal: spacing[5],
    paddingTop: spacing[5],
    paddingBottom: spacing[10],
    gap: spacing[4],
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing[1],
  },
  modalTitle: {
    ...textStyles.h4,
    color: colors.textPrimary,
  },
  modalCloseText: {
    ...textStyles.label,
    color: colors.textSecondary,
  },
  modalField: {
    gap: spacing[1.5],
  },
  modalFieldLabel: {
    ...textStyles.label,
    color: colors.textSecondary,
  },
  modalInput: {
    height: componentHeight.inputField,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radius.md,
    paddingHorizontal: spacing[3],
    backgroundColor: colors.inputBackground,
    ...textStyles.body,
    color: colors.textPrimary,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  dateInputYear: {
    flex: 2,
  },
  dateInputMonthDay: {
    flex: 1,
    textAlign: 'center',
  },
  dateSeparator: {
    ...textStyles.bodyLg,
    color: colors.textTertiary,
  },
  modalToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[1],
  },
  modalSaveButton: {
    height: componentHeight.button,
    backgroundColor: colors.primary,
    borderRadius: radius.xl,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing[2],
  },
  modalSaveButtonDisabled: {
    opacity: 0.6,
  },
  modalSaveButtonText: {
    ...textStyles.labelLg,
    color: colors.textInverse,
  },
  });
}

export type SpaceDetailStyles = ReturnType<typeof makeSpaceDetailStyles>;

