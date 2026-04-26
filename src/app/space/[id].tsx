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
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Share,
  TextInput,
  Platform,
} from 'react-native';
// expo-image provides better caching and performance than React Native's Image (TASK-701)
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useColors } from '@/hooks/useColors';
import { makeSpaceDetailStyles } from '@/components/space/spaceDetailStyles';
import * as spaceService from '@/services/spaceService';
import { showAlert } from '@/lib/webAlert';
import { EditSpaceModal } from '@/components/space/EditSpaceModal';
import { ContactPickerModal } from '@/components/space/ContactPickerModal';
import { SectionCard } from '@/components/space/SectionCard';
import { MemberRow } from '@/components/space/MemberRow';
import { AnniversaryAddModal } from '@/components/space/AnniversaryAddModal';
import { FreeTimeSlotRow } from '@/components/space/FreeTimeSlotRow';
import { AnniversaryRow } from '@/components/space/AnniversaryRow';
import { findFreeTimeSlots } from '@/services/freeTimeService';
import { useSpaceStore } from '@/stores/spaceStore';
import { useAuthStore } from '@/stores/authStore';
import type { Space, SpaceMember, Anniversary, FreeTimeSlot } from '@/types';

// ─── Component ────────────────────────────────────────────────────────────────

export default function SpaceDetailScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const styles = makeSpaceDetailStyles(colors);
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

  // ─── Edit Space modal (owner only) ───────────────────────────────────────
  const [isEditModalVisible, setIsEditModalVisible] = useState(false);
  // ─── Contact picker modal — invite from OS contacts ──────────────────────
  const [isContactPickerVisible, setIsContactPickerVisible] = useState(false);

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
  }, [spaceId, fetchSpaceById, t]);

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

  /**
   * Open the OS share sheet (native) or browser Web Share / clipboard
   * fallback (web). Lets the user route the invite to KakaoTalk, Slack,
   * email, SMS — whatever is installed.
   *
   * Sprint 19 — LEAD requested external-channel inviting.
   */
  const handleShareInviteCode = async () => {
    if (!space) return;
    const message = `SyncLink Space "${space.name}"에 초대합니다!\n초대 코드: ${space.inviteCode}\n참여 링크: synclink://space/join/${space.inviteCode}`;
    const title   = `${space.name} 초대`;

    if (Platform.OS === 'web') {
      // Modern browsers (Chrome Android, Safari iOS) expose navigator.share
      // which opens the OS share sheet just like RN's Share. Desktop browsers
      // typically don't support it — fall back to clipboard + alert.
      const nav = (globalThis as typeof globalThis & {
        navigator?: { share?: (data: { title: string; text: string }) => Promise<void>; clipboard?: { writeText: (s: string) => Promise<void> } };
      }).navigator;
      if (nav?.share) {
        try { await nav.share({ title, text: message }); } catch { /* cancelled */ }
        return;
      }
      if (nav?.clipboard?.writeText) {
        try {
          await nav.clipboard.writeText(message);
          showAlert('복사됨', '초대 메시지가 클립보드에 복사되었습니다. 카카오톡/Slack/이메일 등 원하는 곳에 붙여넣으세요.');
        } catch {
          showAlert('초대 메시지', message);
        }
        return;
      }
      showAlert('초대 메시지', message);
      return;
    }

    try {
      await Share.share({ message, title });
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
  }, [spaceId, ftStartDate, ftEndDate, ftMinDuration, t]);

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
    t,
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

      {/* ── Contact picker modal (native only — web uses share fallback) ── */}
      <ContactPickerModal
        visible={isContactPickerVisible}
        spaceName={space.name}
        inviteCode={space.inviteCode}
        onClose={() => setIsContactPickerVisible(false)}
      />

      {/* ── Edit Space Modal (owner only) ─────────────────────────────── */}
      {isOwner && (
        <EditSpaceModal
          visible={isEditModalVisible}
          space={space}
          onClose={() => setIsEditModalVisible(false)}
          onSaved={(next) => {
            setSpace(next);
            setSpaceDetail(next);
          }}
        />
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
          <View style={styles.spaceNameRow}>
            <Text style={styles.spaceName}>{space.name}</Text>
            {isOwner && (
              <TouchableOpacity
                onPress={() => setIsEditModalVisible(true)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel="Space 편집"
              >
                <Ionicons name="create-outline" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            )}
          </View>
          <View style={styles.spaceTypeBadge}>
            <Text style={styles.spaceTypeText}>{typeLabel}</Text>
          </View>
        </View>

        {/* Invite code section */}
        <SectionCard title="초대 코드" colors={colors} styles={styles}>
          <View style={styles.inviteCodeRow}>
            <Text style={styles.inviteCode}>{space.inviteCode}</Text>
            <View style={styles.inviteActions}>
              <TouchableOpacity
                style={styles.shareButton}
                onPress={handleShareInviteCode}
                activeOpacity={0.7}
              >
                <Text style={styles.shareButtonText}>공유</Text>
              </TouchableOpacity>
              {Platform.OS !== 'web' && (
                <TouchableOpacity
                  style={styles.contactButton}
                  onPress={() => setIsContactPickerVisible(true)}
                  activeOpacity={0.7}
                  accessibilityLabel="연락처에서 초대"
                >
                  <Ionicons name="people" size={16} color={colors.primary} />
                </TouchableOpacity>
              )}
            </View>
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
