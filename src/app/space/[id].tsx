/**
 * Space detail screen.
 *
 * Displays full Space info including:
 *  - Space name, type, cover image
 *  - Member list with roles and event colors
 *  - Invite code (with copy and regenerate actions for owner)
 *  - Anniversary / D-day list with add/delete
 *  - Leave Space action
 *
 * Accessed via: router.push('/space/SPACE_UUID')
 */

import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Share,
  Modal,
  TextInput,
  Switch,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
// expo-image provides better caching and performance than React Native's Image (TASK-701)
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useColors } from '@/hooks/useColors';
import { spacing, radius, componentHeight } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import * as spaceService from '@/services/spaceService';
import { showAlert } from '@/lib/webAlert';
import { findFreeTimeSlots } from '@/services/freeTimeService';
import { useSpaceStore } from '@/stores/spaceStore';
import { useAuthStore } from '@/stores/authStore';
import type { Space, SpaceMember, Anniversary, FreeTimeSlot } from '@/types';

// ─── Component ────────────────────────────────────────────────────────────────

export default function SpaceDetailScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const styles = makeStyles(colors);
  const { id: spaceId } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuthStore();
  const { spaceDetails, fetchSpaceById, removeSpace, setSpaceDetail } = useSpaceStore();

  const [space, setSpace] = useState<Space | null>(spaceDetails[spaceId] ?? null);
  const [anniversaries, setAnniversaries] = useState<Anniversary[]>([]);
  const [isLoading, setIsLoading] = useState(!space);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ─── Free time finder state (TASK-203) ───────────────────────────────────

  /**
   * Simple numeric date inputs for search range.
   * Format: YYYY-MM-DD strings — parsed on search.
   */
  const [ftStartDate, setFtStartDate] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [ftEndDate, setFtEndDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  /** Minimum slot duration: 30 | 60 | 120 minutes */
  const [ftMinDuration, setFtMinDuration] = useState<30 | 60 | 120>(30);
  const [ftResults, setFtResults] = useState<FreeTimeSlot[] | null>(null);
  const [ftIsSearching, setFtIsSearching] = useState(false);
  const [ftError, setFtError] = useState<string | null>(null);

  // ─── Anniversary add modal state ─────────────────────────────────────────
  /** Whether the add-anniversary modal is visible */
  const [isAnniversaryModalVisible, setIsAnniversaryModalVisible] = useState(false);
  /** Draft title for the new anniversary */
  const [anniversaryTitle, setAnniversaryTitle] = useState('');
  /**
   * Draft date parts (year, month, day) as separate string fields for controlled inputs.
   * Pre-filled with today's date on modal open.
   */
  const [anniversaryYear, setAnniversaryYear] = useState('');
  const [anniversaryMonth, setAnniversaryMonth] = useState('');
  const [anniversaryDay, setAnniversaryDay] = useState('');
  /** Whether the anniversary repeats every year */
  const [anniversaryRepeatYearly, setAnniversaryRepeatYearly] = useState(false);
  /** True during createAnniversary network call */
  const [isSavingAnniversary, setIsSavingAnniversary] = useState(false);

  // Determine if current user is owner
  const isOwner = space?.members.some(
    m => m.userId === user?.id && m.role === 'owner',
  ) ?? false;

  // ─── Data loading ────────────────────────────────────────────────────────

  const loadSpace = useCallback(async () => {
    if (!spaceId) return;
    setIsLoading(true);
    setError(null);
    try {
      const loaded = await fetchSpaceById(spaceId);
      setSpace(loaded);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('space.load_failed'));
    } finally {
      setIsLoading(false);
    }
  }, [spaceId, fetchSpaceById]);

  const loadAnniversaries = useCallback(async () => {
    if (!spaceId) return;
    try {
      const list = await spaceService.getAnniversaries(spaceId);
      setAnniversaries(list);
    } catch {
      // Non-critical: fail silently
    }
  }, [spaceId]);

  useEffect(() => {
    loadSpace();
    loadAnniversaries();
  }, [loadSpace, loadAnniversaries]);

  // ─── Actions ─────────────────────────────────────────────────────────────

  /** Copy invite code to clipboard and share via native share sheet. */
  const handleShareInviteCode = async () => {
    if (!space) return;
    try {
      await Share.share({
        message: `SyncLink Space "${space.name}"에 초대합니다!\n초대 코드: ${space.inviteCode}\n참여 링크: synclink://space/join/${space.inviteCode}`,
        title: `${space.name} 초대`,
      });
    } catch {
      // User cancelled share — ignore
    }
  };

  /** Regenerate invite code (owner only). */
  const handleRegenerateCode = () => {
    showAlert(
      t('space.invite_regen'),
      t('space.regen_confirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('space.regen'),
          style: 'destructive',
          onPress: async () => {
            if (!space) return;
            setIsActionLoading(true);
            try {
              const newCode = await spaceService.regenerateInviteCode(space.id);
              const updated = { ...space, inviteCode: newCode };
              setSpace(updated);
              setSpaceDetail(updated);
            } catch (err) {
              showAlert(t('common.error'), err instanceof Error ? err.message : t('space.regen_failed'));
            } finally {
              setIsActionLoading(false);
            }
          },
        },
      ],
    );
  };

  /** Remove a member (owner only). */
  const handleRemoveMember = (member: SpaceMember) => {
    showAlert(
      t('space.kick'),
      `${member.nickname}님을 Space에서 내보낼까요?`,
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('space.leave_button'),
          style: 'destructive',
          onPress: async () => {
            if (!space) return;
            setIsActionLoading(true);
            try {
              await spaceService.removeMember(space.id, member.userId);
              await loadSpace();
            } catch (err) {
              showAlert(t('common.error'), err instanceof Error ? err.message : t('space.kick_failed'));
            } finally {
              setIsActionLoading(false);
            }
          },
        },
      ],
    );
  };

  /** Leave the space. */
  const handleLeaveSpace = () => {
    showAlert(
      t('space.leave'),
      isOwner
        ? t('space.leave_owner')
        : t('space.leave_confirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('space.leave_button'),
          style: 'destructive',
          onPress: async () => {
            if (!space) return;
            setIsActionLoading(true);
            try {
              await spaceService.leaveSpace(space.id);
              removeSpace(space.id);
              router.back();
            } catch (err) {
              showAlert(t('common.error'), err instanceof Error ? err.message : t('space.leave_failed'));
              setIsActionLoading(false);
            }
          },
        },
      ],
    );
  };

  // ─── Free time finder handler ─────────────────────────────────────────────

  /**
   * Parse the date strings, call findFreeTimeSlots, and store results.
   * Both dates must be valid YYYY-MM-DD; end must be after start.
   */
  const handleFindFreeTime = useCallback(async () => {
    if (!spaceId) return;

    // Parse start
    const startParts = ftStartDate.split('-').map(Number);
    const endParts   = ftEndDate.split('-').map(Number);
    if (
      startParts.length !== 3 || startParts.some((n) => isNaN(n ?? NaN)) ||
      endParts.length !== 3   || endParts.some((n) => isNaN(n ?? NaN))
    ) {
      setFtError(t('anniversary.date_invalid'));
      return;
    }

    const [sy, sm, sd] = startParts as [number, number, number];
    const [ey, em, ed] = endParts as [number, number, number];
    const start = new Date(sy, sm - 1, sd, 0, 0, 0);
    const end   = new Date(ey, em - 1, ed, 23, 59, 59);

    if (end <= start) {
      setFtError(t('event.end_date_after_start'));
      return;
    }

    setFtIsSearching(true);
    setFtError(null);
    setFtResults(null);
    try {
      const slots = await findFreeTimeSlots(spaceId, { start, end }, ftMinDuration);
      setFtResults(slots);
    } catch (err) {
      setFtError(err instanceof Error ? err.message : t('nl.error'));
    } finally {
      setFtIsSearching(false);
    }
  }, [spaceId, ftStartDate, ftEndDate, ftMinDuration]);

  // ─── Anniversary modal actions ────────────────────────────────────────────

  /** Open the modal, pre-fill date fields with today's date. */
  const handleOpenAnniversaryModal = useCallback(() => {
    const now = new Date();
    setAnniversaryTitle('');
    setAnniversaryYear(String(now.getFullYear()));
    setAnniversaryMonth(String(now.getMonth() + 1).padStart(2, '0'));
    setAnniversaryDay(String(now.getDate()).padStart(2, '0'));
    setAnniversaryRepeatYearly(false);
    setIsAnniversaryModalVisible(true);
  }, []);

  /** Close the modal without saving. */
  const handleCloseAnniversaryModal = useCallback(() => {
    if (isSavingAnniversary) return; // prevent close while saving
    setIsAnniversaryModalVisible(false);
  }, [isSavingAnniversary]);

  /**
   * Validate inputs and create a new anniversary.
   * On success: close modal and reload anniversaries list.
   */
  const handleSaveAnniversary = useCallback(async () => {
    if (!spaceId) return;

    const title = anniversaryTitle.trim();
    if (title.length === 0) {
      showAlert(t('common.error'), t('anniversary.title_placeholder'));
      return;
    }

    // Parse and validate date fields
    const year = parseInt(anniversaryYear, 10);
    const month = parseInt(anniversaryMonth, 10);
    const day = parseInt(anniversaryDay, 10);

    if (
      isNaN(year) || isNaN(month) || isNaN(day) ||
      year < 1900 || year > 2100 ||
      month < 1 || month > 12 ||
      day < 1 || day > 31
    ) {
      showAlert(t('anniversary.input_error'), t('anniversary.date_example'));
      return;
    }

    // Construct Date object (time set to noon to avoid UTC offset issues)
    const date = new Date(year, month - 1, day, 12, 0, 0);

    // Verify the date is valid (e.g. Feb 30 would shift month)
    if (
      date.getFullYear() !== year ||
      date.getMonth() + 1 !== month ||
      date.getDate() !== day
    ) {
      showAlert(t('anniversary.input_error'), t('anniversary.date_not_exist'));
      return;
    }

    setIsSavingAnniversary(true);
    try {
      await spaceService.createAnniversary(spaceId, {
        title,
        date,
        repeatYearly: anniversaryRepeatYearly,
      });
      // Close modal first for snappy UX, then refresh list
      setIsAnniversaryModalVisible(false);
      await loadAnniversaries();
    } catch (err) {
      showAlert(t('common.error'), err instanceof Error ? err.message : t('anniversary.add_failed'));
    } finally {
      setIsSavingAnniversary(false);
    }
  }, [
    spaceId,
    anniversaryTitle,
    anniversaryYear,
    anniversaryMonth,
    anniversaryDay,
    anniversaryRepeatYearly,
    loadAnniversaries,
  ]);

  /** Delete an anniversary. */
  const handleDeleteAnniversary = (anniversary: Anniversary) => {
    showAlert(
      t('anniversary.delete'),
      `"${anniversary.title}"을(를) 삭제할까요?`,
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await spaceService.deleteAnniversary(anniversary.id);
              setAnniversaries(prev => prev.filter(a => a.id !== anniversary.id));
            } catch (err) {
              showAlert(t('common.error'), err instanceof Error ? err.message : t('common.delete_failed'));
            }
          },
        },
      ],
    );
  };

  // ─── Render states ───────────────────────────────────────────────────────

  if (isLoading && !space) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (error || !space) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error ?? t('space.not_found')}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={loadSpace}>
            <Text style={styles.retryText}>{t('common.retry')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ─── Full render ─────────────────────────────────────────────────────────

  const typeLabel = space.type === 'couple' ? t('space.types.couple') : t('space.types.group');

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.closeButton}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.closeText}>{t('common.close')}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{space.name}</Text>
        <View style={styles.closeButton} />
      </View>

      {isActionLoading && (
        <View style={styles.actionLoadingBar}>
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      )}

      {/* ── Anniversary Add Modal ─────────────────────────────────────── */}
      <AnniversaryAddModal
        visible={isAnniversaryModalVisible}
        title={anniversaryTitle}
        year={anniversaryYear}
        month={anniversaryMonth}
        day={anniversaryDay}
        repeatYearly={anniversaryRepeatYearly}
        isSaving={isSavingAnniversary}
        onChangeTitle={setAnniversaryTitle}
        onChangeYear={setAnniversaryYear}
        onChangeMonth={setAnniversaryMonth}
        onChangeDay={setAnniversaryDay}
        onToggleRepeatYearly={setAnniversaryRepeatYearly}
        onSave={handleSaveAnniversary}
        onClose={handleCloseAnniversaryModal}
        colors={colors}
        styles={styles}
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Space identity */}
        <View style={styles.spaceHeader}>
          <View style={styles.spaceAvatar}>
            {space.coverImageUrl ? (
              <Image source={{ uri: space.coverImageUrl }} style={styles.spaceAvatarImage} />
            ) : (
              <Text style={styles.spaceAvatarEmoji}>
                {space.type === 'couple' ? '💑' : '👥'}
              </Text>
            )}
          </View>
          <Text style={styles.spaceName}>{space.name}</Text>
          <View style={styles.spaceTypeBadge}>
            <Text style={styles.spaceTypeText}>{typeLabel}</Text>
          </View>
        </View>

        {/* Invite code section */}
        <SectionCard title="초대 코드" colors={colors} styles={styles}>
          <View style={styles.inviteCodeRow}>
            <Text style={styles.inviteCode}>{space.inviteCode}</Text>
            <TouchableOpacity
              style={styles.shareButton}
              onPress={handleShareInviteCode}
              activeOpacity={0.7}
            >
              <Text style={styles.shareButtonText}>공유</Text>
            </TouchableOpacity>
          </View>
          {isOwner && (
            <TouchableOpacity
              style={styles.regenerateButton}
              onPress={handleRegenerateCode}
              activeOpacity={0.7}
            >
              <Text style={styles.regenerateText}>코드 재생성</Text>
            </TouchableOpacity>
          )}
          {/* Couple Space capacity indicator */}
          {space.type === 'couple' && (
            <Text style={styles.capacityHint}>
              {space.members.length}/2명 참여 중
              {space.members.length >= 2 ? ' · 정원 마감' : ''}
            </Text>
          )}
        </SectionCard>

        {/* Member list */}
        <SectionCard title={`멤버 (${space.members.length}명)`} colors={colors} styles={styles}>
          {space.members.map(member => (
            <MemberRow
              key={member.userId}
              member={member}
              isCurrentUser={member.userId === user?.id}
              canRemove={isOwner && member.userId !== user?.id}
              onRemove={() => handleRemoveMember(member)}
              colors={colors}
              styles={styles}
            />
          ))}
          {/* Join button for non-full couple or group spaces */}
          {(space.type === 'group' || space.members.length < 2) && (
            <TouchableOpacity
              style={styles.inviteMemberButton}
              onPress={handleShareInviteCode}
              activeOpacity={0.7}
            >
              <Text style={styles.inviteMemberText}>+ 멤버 초대</Text>
            </TouchableOpacity>
          )}
        </SectionCard>

        {/* Anniversary / D-day section */}
        <SectionCard
          title="기념일"
          colors={colors}
          styles={styles}
          action={
            <TouchableOpacity onPress={handleOpenAnniversaryModal}>
              <Text style={styles.sectionActionText}>+ 추가</Text>
            </TouchableOpacity>
          }
        >
          {anniversaries.length === 0 ? (
            <Text style={styles.emptyText}>{t('common.none')}</Text>
          ) : (
            anniversaries.map(anniversary => (
              <AnniversaryRow
                key={anniversary.id}
                anniversary={anniversary}
                onDelete={() => handleDeleteAnniversary(anniversary)}
                colors={colors}
                styles={styles}
              />
            ))
          )}
        </SectionCard>

        {/* Free time finder (TASK-203) */}
        <SectionCard title="빈 시간 찾기" colors={colors} styles={styles}>
          {/* Date range inputs */}
          <View style={styles.ftDateRow}>
            <View style={styles.ftDateField}>
              <Text style={styles.ftDateLabel}>시작일</Text>
              <TextInput
                style={styles.ftDateInput}
                value={ftStartDate}
                onChangeText={setFtStartDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.textSecondary}
                keyboardType="numbers-and-punctuation"
                maxLength={10}
              />
            </View>
            <Text style={styles.ftDateSep}>~</Text>
            <View style={styles.ftDateField}>
              <Text style={styles.ftDateLabel}>종료일</Text>
              <TextInput
                style={styles.ftDateInput}
                value={ftEndDate}
                onChangeText={setFtEndDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.textSecondary}
                keyboardType="numbers-and-punctuation"
                maxLength={10}
              />
            </View>
          </View>

          {/* Min duration chips */}
          <View style={styles.ftChipRow}>
            <Text style={styles.ftChipLabel}>최소 시간</Text>
            {([30, 60, 120] as const).map((min) => (
              <TouchableOpacity
                key={min}
                style={[styles.ftChip, ftMinDuration === min && styles.ftChipSelected]}
                onPress={() => setFtMinDuration(min)}
              >
                <Text style={[styles.ftChipText, ftMinDuration === min && styles.ftChipTextSelected]}>
                  {min < 60 ? `${min}분` : `${min / 60}시간`}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Search button */}
          <TouchableOpacity
            style={[styles.ftSearchButton, ftIsSearching && styles.ftSearchButtonDisabled]}
            onPress={() => void handleFindFreeTime()}
            disabled={ftIsSearching}
            activeOpacity={0.8}
          >
            {ftIsSearching ? (
              <ActivityIndicator size="small" color={colors.textInverse} />
            ) : (
              <Text style={styles.ftSearchButtonText}>빈 시간 찾기</Text>
            )}
          </TouchableOpacity>

          {/* Error */}
          {ftError ? (
            <Text style={styles.ftError}>{ftError}</Text>
          ) : null}

          {/* Results */}
          {ftResults !== null && (
            ftResults.length === 0 ? (
              <Text style={styles.emptyText}>
                해당 기간에 모두가 비어 있는 시간이 없습니다.
              </Text>
            ) : (
              ftResults.map((slot, idx) => (
                <FreeTimeSlotRow key={idx} slot={slot} colors={colors} styles={styles} />
              ))
            )
          )}
        </SectionCard>

        {/* Danger zone */}
        <View style={styles.dangerZone}>
          <TouchableOpacity
            style={styles.leaveButton}
            onPress={handleLeaveSpace}
            activeOpacity={0.7}
          >
            <Text style={styles.leaveButtonText}>{t('space.leave')}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Reusable card section with optional header action. */
function SectionCard({
  title,
  action,
  children,
  colors: _colors,
  styles,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  colors: ReturnType<typeof useColors>;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.sectionCard}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {action}
      </View>
      {children}
    </View>
  );
}

/** Single member row with avatar, name, role badge, and optional remove button. */
function MemberRow({
  member,
  isCurrentUser,
  canRemove,
  onRemove,
  colors: _colors,
  styles,
}: {
  member: SpaceMember;
  isCurrentUser: boolean;
  canRemove: boolean;
  onRemove: () => void;
  colors: ReturnType<typeof useColors>;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.memberRow}>
      {/* Color dot + avatar */}
      <View style={[styles.memberAvatar, { borderColor: member.color }]}>
        {member.avatarUrl ? (
          <Image source={{ uri: member.avatarUrl }} style={styles.memberAvatarImage} />
        ) : (
          <Text style={styles.memberAvatarInitial}>
            {member.nickname.charAt(0).toUpperCase()}
          </Text>
        )}
      </View>

      {/* Name + role */}
      <View style={styles.memberInfo}>
        <Text style={styles.memberName}>
          {member.nickname}
          {isCurrentUser && <Text style={styles.meTag}> (나)</Text>}
        </Text>
        {member.role === 'owner' && (
          <View style={styles.ownerBadge}>
            <Text style={styles.ownerBadgeText}>관리자</Text>
          </View>
        )}
      </View>

      {/* Remove button (owner only, not self) */}
      {canRemove && (
        <TouchableOpacity
          onPress={onRemove}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.removeMemberText}>내보내기</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

/**
 * Modal for adding a new anniversary.
 *
 * Date is entered as three separate numeric fields (year / month / day)
 * to avoid any extra date-picker package dependency.
 */
function AnniversaryAddModal({
  visible,
  title,
  year,
  month,
  day,
  repeatYearly,
  isSaving,
  onChangeTitle,
  onChangeYear,
  onChangeMonth,
  onChangeDay,
  onToggleRepeatYearly,
  onSave,
  onClose,
  colors,
  styles,
}: {
  visible: boolean;
  title: string;
  year: string;
  month: string;
  day: string;
  repeatYearly: boolean;
  isSaving: boolean;
  onChangeTitle: (v: string) => void;
  onChangeYear: (v: string) => void;
  onChangeMonth: (v: string) => void;
  onChangeDay: (v: string) => void;
  onToggleRepeatYearly: (v: boolean) => void;
  onSave: () => void;
  onClose: () => void;
  colors: ReturnType<typeof useColors>;
  styles: ReturnType<typeof makeStyles>;
}) {
  const { t } = useTranslation();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      {/* Dimmed backdrop — tap to close */}
      <TouchableOpacity
        style={styles.modalBackdrop}
        activeOpacity={1}
        onPress={onClose}
      />

      {/* Sheet content — KeyboardAvoidingView lifts it above keyboard */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.modalSheetWrapper}
        pointerEvents="box-none"
      >
        <View style={styles.modalSheet}>
          {/* Header */}
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{t('anniversary.title_placeholder')}</Text>
            <TouchableOpacity onPress={onClose} disabled={isSaving}>
              <Text style={styles.modalCloseText}>{t('common.close')}</Text>
            </TouchableOpacity>
          </View>

          {/* Title input */}
          <View style={styles.modalField}>
            <Text style={styles.modalFieldLabel}>{t('anniversary.title_placeholder')}</Text>
            <TextInput
              style={styles.modalInput}
              value={title}
              onChangeText={onChangeTitle}
              placeholder={t('anniversary.title_placeholder')}
              placeholderTextColor={colors.textPlaceholder}
              maxLength={30}
              autoFocus
            />
          </View>

          {/* Date input — 3 fields in a row */}
          <View style={styles.modalField}>
            <Text style={styles.modalFieldLabel}>날짜</Text>
            <View style={styles.dateRow}>
              <TextInput
                style={[styles.modalInput, styles.dateInputYear]}
                value={year}
                onChangeText={onChangeYear}
                placeholder="2024"
                placeholderTextColor={colors.textPlaceholder}
                keyboardType="number-pad"
                maxLength={4}
              />
              <Text style={styles.dateSeparator}>/</Text>
              <TextInput
                style={[styles.modalInput, styles.dateInputMonthDay]}
                value={month}
                onChangeText={onChangeMonth}
                placeholder="MM"
                placeholderTextColor={colors.textPlaceholder}
                keyboardType="number-pad"
                maxLength={2}
              />
              <Text style={styles.dateSeparator}>/</Text>
              <TextInput
                style={[styles.modalInput, styles.dateInputMonthDay]}
                value={day}
                onChangeText={onChangeDay}
                placeholder="DD"
                placeholderTextColor={colors.textPlaceholder}
                keyboardType="number-pad"
                maxLength={2}
              />
            </View>
          </View>

          {/* Repeat yearly toggle */}
          <View style={styles.modalToggleRow}>
            <Text style={styles.modalFieldLabel}>{t('time.annual')}</Text>
            <Switch
              value={repeatYearly}
              onValueChange={onToggleRepeatYearly}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor={colors.surface}
            />
          </View>

          {/* Save button */}
          <TouchableOpacity
            style={[styles.modalSaveButton, isSaving && styles.modalSaveButtonDisabled]}
            onPress={onSave}
            disabled={isSaving}
            activeOpacity={0.8}
          >
            {isSaving ? (
              <ActivityIndicator color={colors.textInverse} />
            ) : (
              <Text style={styles.modalSaveButtonText}>{t('common.save')}</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/**
 * Renders one free time slot with formatted date, time range, and duration.
 * e.g. "4월 21일 (화)  14:00 – 17:00  (3시간)"
 */
function FreeTimeSlotRow({
  slot,
  colors: _colors,
  styles,
}: {
  slot: FreeTimeSlot;
  colors: ReturnType<typeof useColors>;
  styles: ReturnType<typeof makeStyles>;
}) {
  const KO_WD = ['일', '월', '화', '수', '목', '금', '토'] as const;

  function fmt(d: Date): string {
    const h  = String(d.getHours()).padStart(2, '0');
    const m  = String(d.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }

  const start   = slot.startAt;
  const end     = slot.endAt;
  const wd      = KO_WD[start.getDay()] ?? '';
  const dateStr = `${start.getMonth() + 1}월 ${start.getDate()}일 (${wd})`;
  const timeStr = `${fmt(start)} – ${fmt(end)}`;
  const dur     = slot.durationMinutes >= 60
    ? `${Math.floor(slot.durationMinutes / 60)}시간${slot.durationMinutes % 60 > 0 ? ` ${slot.durationMinutes % 60}분` : ''}`
    : `${slot.durationMinutes}분`;

  return (
    <View style={styles.ftSlotRow}>
      <View style={styles.ftSlotDot} />
      <View style={styles.ftSlotInfo}>
        <Text style={styles.ftSlotDate}>{dateStr}</Text>
        <Text style={styles.ftSlotTime}>{timeStr}</Text>
      </View>
      <Text style={styles.ftSlotDur}>{dur}</Text>
    </View>
  );
}

/** Single anniversary row with D-day display and delete button. */
function AnniversaryRow({
  anniversary,
  onDelete,
  colors: _colors,
  styles,
}: {
  anniversary: Anniversary;
  onDelete: () => void;
  colors: ReturnType<typeof useColors>;
  styles: ReturnType<typeof makeStyles>;
}) {
  const dLabel = formatDday(anniversary.daysFromToday);

  return (
    <View style={styles.anniversaryRow}>
      <View style={styles.anniversaryInfo}>
        <Text style={styles.anniversaryTitle}>{anniversary.title}</Text>
        <Text style={styles.anniversaryDate}>
          {anniversary.date.toLocaleDateString('ko-KR', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
          {anniversary.repeatYearly && ' · 매년 반복'}
        </Text>
      </View>
      <View style={styles.anniversaryRight}>
        <Text style={styles.ddayLabel}>{dLabel}</Text>
        <TouchableOpacity
          onPress={onDelete}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={styles.deleteButton}
        >
          <Text style={styles.deleteText}>삭제</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Format daysFromToday as Korean D-day string.
 *  0  → 'D-day'
 *  1  → 'D-1'  (내일)
 * -1  → 'D+1'  (어제)
 */
function formatDday(days: number): string {
  if (days === 0) return 'D-day';
  if (days > 0) return `D-${days}`;
  return `D+${Math.abs(days)}`;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

/**
 * Dynamic styles factory — receives current theme color tokens.
 *
 * @param colors - Active theme color tokens from useColors()
 */
function makeStyles(colors: ReturnType<typeof useColors>) {
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
  spaceName: {
    ...textStyles.h3,
    color: colors.textPrimary,
    marginBottom: spacing[2],
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
