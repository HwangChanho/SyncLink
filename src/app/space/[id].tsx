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
import { InviteCodeSection } from '@/components/space/InviteCodeSection';
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
  // ─── Transfer ownership modal state (IDEA-011 Phase B) ───────────────────
  /**
   * Controls the "소유권 양도" member-picker modal.
   * true = modal is visible, false = modal hidden.
   */
  const [isTransferModalVisible, setIsTransferModalVisible] = useState(false);
  // ─── Web-only invite state (IDEA-014) ─────────────────────────────────────
  /**
   * Controls QR panel visibility on web.
   * Toggled by the "Show QR Code" button; hidden again on toggle-off or
   * when the invite code changes (e.g. after regeneration).
   */
  const [isQrVisible, setIsQrVisible] = useState(false);

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
    // Use buildInviteUrl() so the https:// Universal Link is always sent out.
    // The synclink:// custom scheme stays alive in _layout.tsx as a fallback
    // but should no longer appear in outgoing share messages (DEVOPS 2026-04-28).
    const message = t('space.share_message', {
      name: space.name,
      code: space.inviteCode,
      link: buildInviteUrl(),
    });
    const title   = `${space.name} ${t('space.invite_title')}`;

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
          showAlert(t('space.share_invite_copied_title'), t('space.share_invite_copied_body'));
        } catch {
          showAlert(t('space.share_invite_title'), message);
        }
        return;
      }
      showAlert(t('space.share_invite_title'), message);
      return;
    }

    try {
      await Share.share({ message, title });
    } catch {
      // User cancelled share — ignore
    }
  };

  // ─── Web-only invite handlers (IDEA-014) ──────────────────────────────────

  /**
   * Builds the canonical invite URL used by both the "Copy Link" and
   * "Email Invite" actions.
   *
   * Primary format: `https://synclink.pages.dev/space/{inviteCode}`
   * This is an Apple Universal Link / Android App Link — clicking it on a
   * device with the app installed will open the app directly. On a device
   * without the app it shows the hosted fallback page (store links + manual
   * code entry).
   *
   * The legacy `synclink://` custom scheme is kept alive in the deep link
   * handler (_layout.tsx) as a fallback, but we no longer *send* it out.
   *
   * DEVOPS 2026-04-28: switched from synclink:// custom scheme to
   * https://synclink.pages.dev (Universal Link) per LEAD decision (option A).
   * Rollback: set EXPO_PUBLIC_INVITE_LINK_BASE=synclink://space
   */
  const buildInviteUrl = useCallback((): string => {
    if (!space) return '';
    // Prefer EXPO_PUBLIC_INVITE_LINK_BASE if set (allows instant rollback via env).
    // Falls back to the production Universal Link domain when the env var is absent.
    const base =
      process.env.EXPO_PUBLIC_INVITE_LINK_BASE?.replace(/\/$/, '') ??
      'https://synclink.pages.dev';
    return `${base}/space/${space.inviteCode}`;
  }, [space]);

  /**
   * "Copy Invite Link" — writes a richly formatted invite URL (not just
   * the raw code) to the system clipboard and shows a toast on success.
   *
   * Uses the Clipboard API which is available in all modern browsers.
   * Falls back to a prompt-style alert with the link pre-selected so the
   * user can manually copy.
   */
  const handleCopyInviteLink = useCallback(async () => {
    if (!space) return;
    const url = buildInviteUrl();
    const nav = (globalThis as typeof globalThis & {
      navigator?: { clipboard?: { writeText: (s: string) => Promise<void> } };
    }).navigator;

    if (nav?.clipboard?.writeText) {
      try {
        await nav.clipboard.writeText(url);
        showAlert(t('space.invite_link_copy'), t('space.invite_link_copied'));
      } catch {
        showAlert(t('space.invite_link_copy'), t('space.invite_link_copy_failed') + '\n\n' + url);
      }
    } else {
      // Non-clipboard fallback — show the URL in an alert for manual copy
      showAlert(t('space.invite_link_copy'), url);
    }
  }, [space, buildInviteUrl, t]);

  /**
   * "Email Invite" — opens the system mail client pre-populated with
   * subject and body via a `mailto:` URI.  No backend call required
   * (Phase 1 — see IDEA-014 Phase 2 for server-side sending via Edge
   * Function).
   *
   * Subject and body are URI-encoded to comply with RFC 6068.
   */
  const handleEmailInvite = useCallback(() => {
    if (!space) return;
    const url     = buildInviteUrl();
    const subject = encodeURIComponent(`SyncDay Space "${space.name}" ${t('space.invite_title')}`);
    const body    = encodeURIComponent(
      t('space.email_body', {
        name: space.name,
        code: space.inviteCode,
        link: url,
      }),
    );
    const mailtoHref = `mailto:?subject=${subject}&body=${body}`;

    const win = (globalThis as typeof globalThis & { open?: (url: string, target: string) => void }).open;
    if (win) {
      win(mailtoHref, '_self');
    } else {
      // Fallback: show the mailto link in case window.open is blocked
      showAlert(t('space.invite_email'), mailtoHref);
    }
  }, [space, buildInviteUrl, t]);

  /**
   * Toggle QR code panel.
   * The QR image is rendered as an <img> using the free qrserver.com API
   * — no native package required, web-only.
   */
  const handleToggleQr = useCallback(() => {
    setIsQrVisible(prev => !prev);
  }, []);

  // handleRegenerateCode removed — regeneration is now handled inside
  // InviteCodeSection on every "보기" press (Sprint 28 fix).
  // The confirm-dialog pattern is intentionally dropped: "보기" = rotate immediately.

  /** Remove a member (owner only). */
  const handleRemoveMember = (member: SpaceMember) => {
    showAlert(
      t('space.kick'),
      t('space.kick_confirm', { nickname: member.nickname }),
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

  // ─── Transfer ownership handler (IDEA-011 Phase B) ───────────────────────

  /**
   * Called when the owner selects a target member from the transfer modal.
   * Shows a final confirm dialog (irreversible warning) before executing the
   * transferOwnership service call.
   *
   * @param member - The SpaceMember who will become the new owner
   */
  const handleTransferOwnership = (member: SpaceMember) => {
    // Close the member-picker first, then show confirm alert
    setIsTransferModalVisible(false);
    showAlert(
      t('space.transfer_ownership'),
      t('space.transfer_confirm', { nickname: member.nickname }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('space.transfer_ownership'),
          style: 'destructive',
          onPress: async () => {
            if (!space) return;
            setIsActionLoading(true);
            try {
              await spaceService.transferOwnership(space.id, member.userId);
              // Reload space so that the caller's role is updated to 'member'
              // and the new owner's role is updated to 'owner' in the UI.
              await loadSpace();
            } catch (err) {
              showAlert(
                t('common.error'),
                err instanceof Error ? err.message : t('space.transfer_failed'),
              );
            } finally {
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
      t('space.anniversary_delete_confirm', { title: anniversary.title }),
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
                accessibilityLabel={t('space.edit_accessibility')}
              >
                <Ionicons name="create-outline" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            )}
          </View>
          <View style={styles.spaceTypeBadge}>
            <Text style={styles.spaceTypeText}>{typeLabel}</Text>
          </View>
        </View>

        {/* Invite code section — InviteCodeSection manages hide/show/timer/regenerate */}
        <SectionCard title={t('space.invite_code_section')} colors={colors} styles={styles}>
          <InviteCodeSection
            spaceId={space.id}
            inviteCode={space.inviteCode}
            isOwner={isOwner}
            onCodeChange={(newCode) => {
              const updated = { ...space, inviteCode: newCode };
              setSpace(updated);
              setSpaceDetail(updated);
            }}
            onShare={handleShareInviteCode}
            // exactOptionalPropertyTypes: web-only props are omitted entirely on native.
            // Spreading a conditional object avoids passing `undefined` where the
            // prop type is `() => void` (not `() => void | undefined`).
            {...(Platform.OS === 'web' ? {
              onCopyLink: handleCopyInviteLink,
              onEmailInvite: handleEmailInvite,
              onToggleQr: handleToggleQr,
            } : {})}
            isQrVisible={isQrVisible}
            qrUrl={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(buildInviteUrl())}`}
            isContactPickerAvailable={Platform.OS !== 'web'}
            onOpenContactPicker={() => setIsContactPickerVisible(true)}
            colors={colors}
            styles={styles}
            isCoupleSpace={space.type === 'couple'}
            memberCount={space.members.length}
          />
        </SectionCard>

        {/* Member list */}
        <SectionCard title={t('space.member_section', { count: space.members.length })} colors={colors} styles={styles}>
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
              <Text style={styles.inviteMemberText}>{t('space.member_invite_button')}</Text>
            </TouchableOpacity>
          )}
        </SectionCard>

        {/* Anniversary / D-day section */}
        <SectionCard
          title={t('space.anniversary_section')}
          colors={colors}
          styles={styles}
          action={
            <TouchableOpacity onPress={handleOpenAnniversaryModal}>
              <Text style={styles.sectionActionText}>{t('space.add_button')}</Text>
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
        <SectionCard title={t('space.free_time_section')} colors={colors} styles={styles}>
          {/* Date range inputs */}
          <View style={styles.ftDateRow}>
            <View style={styles.ftDateField}>
              <Text style={styles.ftDateLabel}>{t('space.free_time_start_date')}</Text>
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
              <Text style={styles.ftDateLabel}>{t('space.free_time_end_date')}</Text>
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
            <Text style={styles.ftChipLabel}>{t('space.free_time_min_duration')}</Text>
            {([30, 60, 120] as const).map((min) => (
              <TouchableOpacity
                key={min}
                style={[styles.ftChip, ftMinDuration === min && styles.ftChipSelected]}
                onPress={() => setFtMinDuration(min)}
              >
                <Text style={[styles.ftChipText, ftMinDuration === min && styles.ftChipTextSelected]}>
                  {min < 60
                    ? t('reminder.minutes_before', { count: min })
                    : t('reminder.hours_before', { count: min / 60 })}
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
              <Text style={styles.ftSearchButtonText}>{t('space.free_time_search_button')}</Text>
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
                {t('space.free_time_no_results')}
              </Text>
            ) : (
              ftResults.map((slot, idx) => (
                <FreeTimeSlotRow
                  key={idx}
                  slot={slot}
                  colors={colors}
                  styles={styles}
                  /*
                   * IDEA-019 — inline "이 시간에 만들기" CTA.
                   * Navigate to event/create with the slot's start date
                   * so the form is pre-filled and the user can finish in
                   * one less step.
                   */
                  onCreateEvent={(s) => {
                    const dateStr = [
                      s.startAt.getFullYear(),
                      String(s.startAt.getMonth() + 1).padStart(2, '0'),
                      String(s.startAt.getDate()).padStart(2, '0'),
                    ].join('-');
                    router.push(`/event/create?date=${dateStr}`);
                  }}
                />
              ))
            )
          )}
        </SectionCard>

        {/* Danger zone */}
        <View style={styles.dangerZone}>
          {/*
           * ── 소유권 양도 버튼 (owner only, IDEA-011 Phase B) ──────────────
           * 양도 가능한 다른 멤버가 1명 이상 있을 때만 표시한다.
           * 커플/그룹 관계없이 멤버 수 ≥ 2 이면 노출.
           */}
          {isOwner && space.members.length >= 2 && (
            <TouchableOpacity
              testID="space-button-transfer"
              style={styles.leaveButton}
              onPress={() => setIsTransferModalVisible(true)}
              activeOpacity={0.7}
            >
              <Text style={styles.leaveButtonText}>{t('space.transfer_ownership')}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.leaveButton}
            onPress={handleLeaveSpace}
            activeOpacity={0.7}
          >
            <Text style={styles.leaveButtonText}>{t('space.leave')}</Text>
          </TouchableOpacity>
        </View>

        {/*
         * ── 소유권 양도 멤버 선택 모달 (IDEA-011 Phase B) ──────────────────
         * isOwner가 true이고 다른 멤버가 있을 때만 렌더.
         * 현재 로그인 유저 자신은 선택 목록에서 제외한다.
         */}
        {isOwner && isTransferModalVisible && (
          <View
            testID="space-modal-transfer"
            style={styles.transferModalOverlay}
          >
            <View style={styles.transferModalCard}>
              <Text style={styles.transferModalTitle}>{t('space.new_owner')}</Text>
              {space.members
                .filter(m => m.userId !== user?.id)
                .map(member => (
                  <TouchableOpacity
                    key={member.userId}
                    style={styles.transferMemberRow}
                    onPress={() => handleTransferOwnership(member)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.transferMemberName}>{member.nickname}</Text>
                  </TouchableOpacity>
                ))
              }
              <TouchableOpacity
                style={styles.transferCancelButton}
                onPress={() => setIsTransferModalVisible(false)}
                activeOpacity={0.7}
              >
                <Text style={styles.transferCancelText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
