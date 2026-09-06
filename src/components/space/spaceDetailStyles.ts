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
    color:     colors.textTertiary,
    // Build-92 — capacityHint ("2/2명 참여중") 가 그 위 "초대 코드 보기"
    // 버튼과 너무 붙어있던 LEAD 보고. marginTop 으로 분리.
    marginTop: spacing[2],
  },

  // ── InviteCodeSection — 초대 코드 hide/show + 타이머 ─────────────────────

  /**
   * "초대 코드 보기" 버튼 — 코드가 숨겨진 상태에서 노출.
   * 플렉스 행으로 아이콘과 텍스트를 가로 정렬.
   */
  showInviteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[3],
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.lg,
    backgroundColor: colors.primaryLight,
  },
  showInviteButtonText: {
    ...textStyles.label,
    color: colors.primary,
  },

  /**
   * 카운트다운 힌트 행 — 코드 표시 상태에서 코드 하단에 나타남.
   * "4:59 후 사라짐  [숨기기]" 형태.
   */
  inviteCodeTimerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing[1],
  },
  inviteCodeTimerText: {
    ...textStyles.caption,
    color: colors.textTertiary,
  },
  inviteCodeHideText: {
    ...textStyles.caption,
    color: colors.textSecondary,
    textDecorationLine: 'underline',
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
  /**
   * dangerZone 안의 액션 버튼들을 감싸는 컨테이너.
   * gap 으로 버튼 간격을 주므로 각 버튼은 marginTop 을 갖지 않는다.
   */
  dangerZoneActions: {
    // 파괴적 버튼(탈퇴)을 중립 버튼과 붙여 두면 오조작이 난다.
    // account.tsx 는 24 를 쓰지만 여기는 카드가 촘촘한 화면이라 16 으로 절제.
    gap: spacing[4],
  },
  /**
   * dangerZone 공통 버튼 골격 (v1.4.10 — LEAD 지시로 앱 표준에 맞춤).
   *
   * 기준 = `src/app/settings/account.tsx` 의 로그아웃/회원탈퇴 버튼:
   * 전폭 · 아이콘+라벨 가로 배치 · radius.md · borderWidth 1.
   * 이전에는 둘 다 "빨간 테두리 알약"이라 파괴적이지 않은 소유권 양도까지
   * 위험 동작처럼 보였고, 폭이 내용에 따라 달라져 좌우 정렬도 흔들렸다.
   *
   * ⚠️ 세로 패딩은 account.tsx(spacing[4]=16)보다 한 단계 낮은 spacing[3]=12 다.
   *    v1.1.4 에 "dangerZone 버튼이 너무 큼" 피드백을 받은 적이 있어,
   *    형태만 표준에 맞추고 크기는 절제했다.
   */
  zoneButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
    borderRadius: radius.md,
    borderWidth: 1,
  },
  /** 누름 피드백 — account.tsx 의 actionPressed 와 동일. */
  zoneButtonPressed: {
    opacity: 0.6,
  },
  /**
   * 소유권 양도 = 중립 액션. 되돌릴 수 있고 데이터가 사라지지 않으므로
   * 빨강이 아니라 기본 표면색 + 일반 테두리를 쓴다(로그아웃 버튼과 같은 급).
   */
  transferButton: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  transferButtonText: {
    ...textStyles.label,
    color: colors.textPrimary,
  },
  /** 탈퇴 = 파괴적 액션. 투명 배경 + error 테두리/글씨 (회원탈퇴 버튼과 동일). */
  leaveButton: {
    backgroundColor: 'transparent',
    borderColor: colors.error,
  },
  leaveButtonText: {
    ...textStyles.label,
    color: colors.error,
    fontWeight: '600',
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
  // IDEA-019 — "이 시간에 만들기" CTA button inside each free-time slot row.
  ftSlotCTA: {
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    borderRadius: radius.sm,
    backgroundColor: colors.primary,
    flexShrink: 0,
  },
  ftSlotCTAText: {
    ...textStyles.caption,
    color: colors.textInverse,
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

  // ── Transfer ownership modal (IDEA-011 Phase B) ──────────────────────────

  /** Full-screen semi-transparent overlay behind the transfer member picker */
  transferModalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  /** White card containing the member list */
  transferModalCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing[5],
    width: '85%',
    maxWidth: 340,
  },
  /** Title of the transfer modal ("새 관리자 선택") */
  transferModalTitle: {
    ...textStyles.h4,
    color: colors.textPrimary,
    marginBottom: spacing[4],
    textAlign: 'center',
  },
  /** Each selectable member row inside the transfer modal */
  transferMemberRow: {
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  /** Member nickname text inside a transfer row */
  transferMemberName: {
    ...textStyles.body,
    color: colors.textPrimary,
  },
  /** "취소" button at the bottom of the transfer modal */
  transferCancelButton: {
    marginTop: spacing[3],
    paddingVertical: spacing[3],
    alignItems: 'center',
  },
  /** Text for the cancel button */
  transferCancelText: {
    ...textStyles.label,
    color: colors.textSecondary,
  },
  });
}

export type SpaceDetailStyles = ReturnType<typeof makeSpaceDetailStyles>;

