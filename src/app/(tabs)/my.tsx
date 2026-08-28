/**
 * My tab — Profile management, Space list, Settings, Subscription banner.
 *
 * TASK-102 (Sprint 1): Profile display, nickname edit, avatar upload, logout
 * TASK-501 (Sprint 5): Settings section (notifications, categories), account deletion
 * TASK-502 (Sprint 5): Dark mode theme toggle (Segmented Control)
 * TASK-505 (Sprint 5): Subscription banner (Free plan usage + upgrade CTA)
 *
 * Note: My tab is 100% ad-free per PRD section 7.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
} from 'react-native';
// v1.2.3 — expo-image 가 일부 빌드에서 mount 실패 → 표준 RN Image 로 fallback.
import { Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';
import { useColors } from '@/hooks/useColors';
import { useResponsive } from '@/hooks/useResponsive';
import { desktopContentCentered } from '@/constants/webLayout';
import { APP_BRAND } from '@/constants/config';
import { useSubscriptionStore } from '@/stores/subscriptionStore';
import { spacing, radius, componentHeight } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import * as authService from '@/services/authService';
import { manageSubscriptions } from '@/services/purchaseService';
import { useAuthStore } from '@/stores/authStore';
import { GuestGate } from '@/components/common/GuestGate';
import { showAlert } from '@/lib/webAlert';
import { logError } from '@/lib/errorLogger';
import { ShortcutsSection } from '@/components/my/ShortcutsSection';
import { SettingsSection } from '@/components/my/SettingsSection';
// AccountMergeSection(통합 로그인) — 2026-06-07 LEAD 결정으로 UI 비활성(숨김).
// 계정 통합이 구조적으로 데이터 손실/크래시 리스크가 커 보류. 컴포넌트·서버는 유지(추후 복구).
// import { AccountMergeSection } from '@/components/my/AccountMergeSection';
import { ServiceInfoSection } from '@/components/my/ServiceInfoSection';
// Build-81 — AccountSection 은 settings/account 화면으로 이전. import 제거.
import { DevDashboard } from '@/components/DevDashboard';

// ─── Theme options are now built inside the component using i18n ───────────────

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Guest gate: the My tab is account-centric (profile, settings, account
 * deletion) and dereferences the signed-in user, so browsing guests get a
 * sign-in prompt instead. The wrapper keeps hook order stable — the content
 * component's hooks only ever run once authenticated.
 */
/**
 * Idle time (ms) after the last keystroke before the nickname is written.
 * Long enough that normal typing produces one request instead of one per
 * character, short enough that pausing feels like an immediate save.
 */
const NICKNAME_AUTOSAVE_DELAY_MS = 700;

export default function MyScreen() {
  const { t } = useTranslation();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  if (!isAuthenticated) {
    return (
      <GuestGate
        description={t('auth.guest.gate_my')}
        icon="person-outline"
        testID="guest-gate-my"
      />
    );
  }
  return <MyScreenContent />;
}

function MyScreenContent() {
  const { t } = useTranslation();
  const colors = useColors();
  // Build dynamic styles using the current theme's color tokens
  const styles = makeStyles(colors);
  // 데스크탑 웹: 콘텐츠 적정폭(880) 중앙 정렬 — 풀폭 늘어짐 방지. (웹 반응형 S2)
  const { isDesktop } = useResponsive();

  const { plan, aiUsageToday } = useSubscriptionStore();

  const { user, setUser } = useAuthStore();

  // ─── Local UI state ──────────────────────────────────────────────────────
  /** True when the nickname TextInput is visible */
  const [isEditingNickname, setIsEditingNickname] = useState(false);
  /** Draft value while editing; initialized from user.nickname */
  const [nicknameInput, setNicknameInput] = useState(user?.nickname ?? '');
  /**
   * Autosave feedback state. There is no Save button anymore, so the user needs
   * some signal that the typed name actually persisted.
   *  'idle'   — nothing pending / nothing to report
   *  'saving' — network call in flight
   *  'saved'  — last write succeeded
   */
  const [nicknameSaveState, setNicknameSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  /** Pending autosave timer; null when nothing is scheduled. */
  const nicknameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Latest text awaiting the timer, so a flush can write it without state reads. */
  const pendingNicknameRef = useRef<string | null>(null);
  /** True during avatar upload */
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  /** True during sign-out */
  // Build-81 — isLoggingOut 은 settings/account 로 이전.

  // Keep draft in sync when user changes externally (e.g. after save)
  useEffect(() => {
    if (!isEditingNickname) {
      setNicknameInput(user?.nickname ?? '');
    }
  }, [user?.nickname, isEditingNickname]);

  // ─── Nickname edit ───────────────────────────────────────────────────────

  /** Start editing: show input with current nickname pre-filled */
  const handleStartEditNickname = useCallback(() => {
    setNicknameInput(user?.nickname ?? '');
    setIsEditingNickname(true);
  }, [user?.nickname]);

  /**
   * Write the nickname straight to the server. Called by the autosave timer and
   * by any action that ends editing — never bound to a Save button.
   *
   * Validation failures return silently instead of alerting: while autosaving,
   * an empty field usually means "mid-edit", and popping a dialog on every
   * cleared character would be hostile. Length is already capped by maxLength
   * on the input, so the check here is only a guard.
   *
   * @param raw Draft text as typed (untrimmed)
   */
  const persistNickname = useCallback(async (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed.length === 0 || trimmed.length > 20) return;
    if (trimmed === user?.nickname) return; // nothing changed — skip the round trip

    setNicknameSaveState('saving');
    try {
      const updated = await authService.updateProfile({ nickname: trimmed });
      setUser(updated);
      setNicknameSaveState('saved');
    } catch (err) {
      setNicknameSaveState('idle');
      showAlert(t('common.error'), err instanceof Error ? err.message : t('profile.nickname_failed'));
    }
  }, [user?.nickname, setUser, t]);

  // Keep a ref to the latest persist fn so the unmount cleanup below can flush
  // a pending edit without re-running (and thus re-arming) on every render.
  const persistNicknameRef = useRef(persistNickname);
  useEffect(() => {
    persistNicknameRef.current = persistNickname;
  }, [persistNickname]);

  /**
   * Handle typing: update the draft and (re)arm the autosave timer.
   * Each keystroke pushes the save further out, so a burst of typing results in
   * a single write once the user pauses.
   */
  const handleChangeNickname = useCallback((text: string) => {
    setNicknameInput(text);
    pendingNicknameRef.current = text;
    setNicknameSaveState('idle'); // a new edit invalidates the previous "저장됨"

    if (nicknameTimerRef.current) clearTimeout(nicknameTimerRef.current);
    nicknameTimerRef.current = setTimeout(() => {
      nicknameTimerRef.current = null;
      const pending = pendingNicknameRef.current;
      pendingNicknameRef.current = null;
      if (pending !== null) void persistNicknameRef.current(pending);
    }, NICKNAME_AUTOSAVE_DELAY_MS);
  }, []);

  /** Cancel the pending timer and write immediately (blur, done, unmount). */
  const flushNickname = useCallback(() => {
    if (nicknameTimerRef.current) {
      clearTimeout(nicknameTimerRef.current);
      nicknameTimerRef.current = null;
    }
    const pending = pendingNicknameRef.current;
    pendingNicknameRef.current = null;
    if (pending !== null) void persistNicknameRef.current(pending);
  }, []);

  /** Leave edit mode. The value is already saved (or flushed here). */
  const handleDoneEditNickname = useCallback(() => {
    flushNickname();
    setIsEditingNickname(false);
  }, [flushNickname]);

  // Flush on unmount so a name typed right before navigating away isn't lost
  // in the debounce window.
  useEffect(() => () => {
    if (nicknameTimerRef.current) {
      clearTimeout(nicknameTimerRef.current);
      nicknameTimerRef.current = null;
      const pending = pendingNicknameRef.current;
      pendingNicknameRef.current = null;
      if (pending !== null) void persistNicknameRef.current(pending);
    }
  }, []);

  // ─── Avatar change ───────────────────────────────────────────────────────

  /**
   * Open the device image gallery, let the user pick a photo,
   * upload it to Supabase Storage, and update their profile.
   */
  const handleChangeAvatar = useCallback(async () => {
    // Request permission to access the media library (required on iOS)
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      showAlert(
        t('notification.permission_required'),
        t('profile.avatar_permission'),
      );
      return;
    }

    // Open the image picker (gallery).
    //
    // `base64: true` makes ImagePicker decode the asset for us, so we
    // never have to round-trip through expo-file-system. That round-trip
    // returned an empty string for some iOS photo URIs (ph:// scheme)
    // and silently uploaded a 0-byte avatar. Diagnosis is documented in
    // docs/inbox/DEBUG_2026-04-26_avatar-upload.md.
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,    // crop to square
      aspect: [1, 1],
      quality: 0.7,           // 70% quality keeps file size reasonable
      base64: true,
    });

    // User cancelled
    if (result.canceled) return;

    const asset = result.assets[0];
    if (!asset?.uri) return;

    setIsUploadingAvatar(true);
    try {
      // Pass both the URI (for web fetch fallback) and the picker's
      // already-decoded base64 (the reliable path on native).
      const publicUrl = await authService.uploadAvatar(asset.uri, asset.base64 ?? null);
      // eslint-disable-next-line no-console
      console.info('[handleChangeAvatar] publicUrl', publicUrl);
      // Update user profile with new URL
      const updated = await authService.updateProfile({ avatar_url: publicUrl });
      // eslint-disable-next-line no-console
      console.info('[handleChangeAvatar] updateProfile result', { id: updated.id, avatar_url: updated.avatar_url });
      setUser(updated);
    } catch (err) {
      // Log raw error so engineers can triage via Metro logs.
      // showAlert works on both web (window.alert) and native (Alert.alert).
      void logError({ context: 'my.changeAvatar', error: err });
      console.error('[MyTab] handleChangeAvatar failed:', err);
      showAlert(
        t('common.error'),
        err instanceof Error ? err.message : t('profile.avatar_failed'),
      );
    } finally {
      setIsUploadingAvatar(false);
    }
  }, [setUser, t]);

  // Build-81 — 로그아웃 / 회원탈퇴 핸들러는 settings/account.tsx 로 이전.

  // ─── Render ──────────────────────────────────────────────────────────────

  if (!user) {
    // Should not render without a user (auth guard in _layout.tsx prevents this)
    return null;
  }

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          isDesktop && desktopContentCentered,
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Profile section ─────────────────────────────────────────── */}
        <View style={styles.profileSection}>
          {/* Avatar with change button overlay */}
          <TouchableOpacity
            style={styles.avatarContainer}
            onPress={handleChangeAvatar}
            disabled={isUploadingAvatar}
            activeOpacity={0.8}
          >
            {user.avatar_url ? (
              <Image source={{ uri: user.avatar_url }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarInitial}>
                  {user.nickname.charAt(0).toUpperCase()}
                </Text>
              </View>
            )}

            {/* Overlay indicator */}
            <View style={styles.avatarEditBadge}>
              {isUploadingAvatar ? (
                <ActivityIndicator size="small" color={colors.textInverse} />
              ) : (
                <Text style={styles.avatarEditIcon}>✎</Text>
              )}
            </View>
          </TouchableOpacity>

          {/* Nickname display / edit */}
          {isEditingNickname ? (
            <View style={styles.nicknameEditRow}>
              <TextInput
                style={styles.nicknameInput}
                value={nicknameInput}
                onChangeText={handleChangeNickname}
                autoFocus
                maxLength={20}
                returnKeyType="done"
                onSubmitEditing={handleDoneEditNickname}
                onBlur={flushNickname}
                placeholder={t('profile.nickname_placeholder')}
                placeholderTextColor={colors.textPlaceholder}
              />
              {/*
                No Save button — typing autosaves after a short pause. What
                replaces it is a status slot, so the user still gets confirmation
                that the change stuck. Fixed width keeps the row from shifting
                as the label swaps between spinner / "저장됨" / empty.
              */}
              <View style={styles.nicknameStatus}>
                {nicknameSaveState === 'saving' ? (
                  <ActivityIndicator size="small" color={colors.textSecondary} />
                ) : nicknameSaveState === 'saved' ? (
                  <Text style={styles.nicknameSavedText}>{t('profile.nickname_saved')}</Text>
                ) : null}
              </View>
              <TouchableOpacity
                style={styles.nicknameCancelButton}
                onPress={handleDoneEditNickname}
              >
                <Text style={styles.nicknameCancelText}>{t('common.done')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.nicknameRow}>
              <Text style={styles.nickname}>{user.nickname}</Text>
              <TouchableOpacity
                onPress={handleStartEditNickname}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.editNicknameText}>{t('common.edit')}</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Email display (read-only) */}
          {user.email && (
            <Text style={styles.email}>{user.email}</Text>
          )}

          {/* Plan badge — sits below the email so the user always knows
              which tier they're on without scrolling to the subscription
              banner. Pro shows a filled chip; Free is a subtle outline. */}
          <View
            style={[
              styles.planBadge,
              plan === 'pro'
                ? { backgroundColor: colors.primary, borderColor: colors.primary }
                : { backgroundColor: 'transparent', borderColor: colors.border },
            ]}
          >
            <Ionicons
              name={plan === 'pro' ? 'star' : 'star-outline'}
              size={12}
              color={plan === 'pro' ? colors.textInverse : colors.textSecondary}
            />
            <Text
              style={[
                styles.planBadgeText,
                { color: plan === 'pro' ? colors.textInverse : colors.textSecondary },
              ]}
            >
              {plan === 'pro' ? `${APP_BRAND} Pro` : `${APP_BRAND} Free`}
            </Text>
          </View>
        </View>

        {/* ── Subscription banner ────────────────────── */}
        {/* Free → paywall 으로 이동. Pro → Apple/Play 구독 관리 deep link
            (App Store Guideline 3.1.2 — 자동 갱신 구독은 앱 내에서 관리 진입
            경로 제공 필수). */}
        {plan === 'free' ? (
          <View style={styles.section}>
            <TouchableOpacity
              style={styles.subscriptionBanner}
              onPress={() => router.push('/subscription/paywall')}
              activeOpacity={0.85}
            >
              <View style={styles.subscriptionInfo}>
                <Text style={styles.subscriptionTitle}>{`${APP_BRAND} Free`}</Text>
                <Text style={styles.subscriptionUsage}>
                  AI {aiUsageToday}/5
                </Text>
              </View>
              <View style={styles.subscriptionCta}>
                <Text style={styles.subscriptionCtaText}>Pro →</Text>
              </View>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.section}>
            <TouchableOpacity
              style={styles.subscriptionBanner}
              onPress={() => {
                manageSubscriptions().catch((err) => {
                  logError({ context: 'manageSubscriptions', error: err });
                });
              }}
              activeOpacity={0.85}
            >
              <View style={styles.subscriptionInfo}>
                <Text style={styles.subscriptionTitle}>{`${APP_BRAND} Pro`}</Text>
                <Text style={styles.subscriptionUsage}>구독 갱신 / 취소 관리</Text>
              </View>
              <View style={styles.subscriptionCta}>
                <Text style={styles.subscriptionCtaText}>관리 →</Text>
              </View>
            </TouchableOpacity>
          </View>
        )}

        {/* ── 통합 로그인 — 2026-06-07 LEAD 결정으로 비활성(숨김). 구조적 불안정으로 보류. ── */}
        {/* <AccountMergeSection /> */}

        {/* 2026-08-28 — 탭바에서 내린 화면들(할 일·노트 / Space)의 진입점.
            설정보다 위에 둔다: 이건 "설정"이 아니라 콘텐츠로 가는 길이다. */}
        <ShortcutsSection />

        <SettingsSection />

        {/* Build-81 — 로그아웃/회원탈퇴는 settings/account 화면으로 분리.
            SettingsSection 의 "계정" 메뉴에서 진입. */}

        {/* ── Dev-only AI cost dashboard ───────────────────────────── */}
        {/* Rendered only in local development; never visible in production */}
        {process.env.EXPO_PUBLIC_APP_ENV === 'development' && <DevDashboard />}

        <ServiceInfoSection />
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/**
 * Card row for a single space in the My Spaces list.
 * Uses useColors() directly to respond to theme changes.
 */
// ─── Styles ───────────────────────────────────────────────────────────────────

/**
 * makeStyles: returns a StyleSheet object using the provided color tokens.
 * Called inside the component after useColors() resolves the active theme.
 *
 * @param colors - Active theme color tokens from useColors()
 */
function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundAlt,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    // 80px so the bottom-most menu row clears the tab bar + home indicator
    // even on devices where the safe-area inset is small (matches event
    // create/edit forms — sprint-31 user feedback "홈바에 딱 붙어있음").
    paddingBottom: spacing[20],
    gap: spacing[4],
  },

  // ── Profile ─────────────────────────────────────────────────────────────
  profileSection: {
    backgroundColor: colors.surface,
    alignItems: 'center',
    paddingVertical: spacing[8],
    paddingHorizontal: spacing[4],
    gap: spacing[3],
  },
  avatarContainer: {
    position: 'relative',
    marginBottom: spacing[1],
  },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: radius.full,
  },
  avatarPlaceholder: {
    width: 88,
    height: 88,
    borderRadius: radius.full,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize: 36,
    fontWeight: '700',
    color: colors.primary,
  },
  avatarEditBadge: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 28,
    height: 28,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.surface,
  },
  avatarEditIcon: {
    color: colors.textInverse,
    fontSize: 14,
    fontWeight: '600',
  },
  nicknameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  nickname: {
    ...textStyles.h3,
    color: colors.textPrimary,
  },
  editNicknameText: {
    ...textStyles.label,
    color: colors.primary,
  },
  nicknameEditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    width: '100%',
    paddingHorizontal: spacing[2],
  },
  nicknameInput: {
    flex: 1,
    height: componentHeight.buttonSm,
    borderWidth: 1,
    borderColor: colors.inputFocus,
    borderRadius: radius.md,
    paddingHorizontal: spacing[3],
    backgroundColor: colors.inputBackground,
    ...textStyles.body,
    color: colors.textPrimary,
  },
  // Autosave status slot that replaced the Save button. The fixed width stops
  // the row from jumping as the content swaps between spinner, label and empty.
  nicknameStatus: {
    minWidth: 44,
    height: componentHeight.buttonSm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nicknameSavedText: {
    ...textStyles.caption,
    color: colors.textSecondary,
  },
  nicknameCancelButton: {
    height: componentHeight.buttonSm,
    paddingHorizontal: spacing[3],
    alignItems: 'center',
    justifyContent: 'center',
  },
  nicknameCancelText: {
    ...textStyles.label,
    color: colors.textSecondary,
  },
  email: {
    ...textStyles.bodySm,
    color: colors.textTertiary,
  },
  planBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: spacing[1],
    paddingHorizontal: spacing[3],
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  planBadgeText: {
    ...textStyles.caption,
    fontWeight: '600',
  },

  // ── Sections ─────────────────────────────────────────────────────────────
  section: {
    paddingHorizontal: spacing[4],
    gap: spacing[2],
  },
  sectionTitle: {
    ...textStyles.labelLg,
    color: colors.textSecondary,
    paddingHorizontal: spacing[1],
  },
  loadingRow: {
    paddingVertical: spacing[4],
    alignItems: 'center',
  },

  // ── Space cards ──────────────────────────────────────────────────────────
  emptySpacesCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing[6],
    alignItems: 'center',
    gap: spacing[4],
  },
  emptySpacesText: {
    ...textStyles.body,
    color: colors.textTertiary,
  },
  createSpaceButton: {
    paddingHorizontal: spacing[6],
    paddingVertical: spacing[3],
    borderRadius: radius.full,
    backgroundColor: colors.primary,
  },
  createSpaceButtonText: {
    ...textStyles.labelLg,
    color: colors.textInverse,
  },
  spaceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing[4],
    gap: spacing[3],
  },
  spaceCardIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.lg,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  spaceCardImage: {
    width: 48,
    height: 48,
  },
  spaceCardEmoji: {
    fontSize: 24,
  },
  spaceCardInfo: {
    flex: 1,
    gap: spacing[0.5],
  },
  spaceCardName: {
    ...textStyles.labelLg,
    color: colors.textPrimary,
  },
  spaceCardMeta: {
    ...textStyles.caption,
    color: colors.textTertiary,
  },
  spaceCardChevron: {
    fontSize: 22,
    color: colors.textTertiary,
    fontWeight: '300',
  },
  addSpaceRow: {
    flex: 1,
    paddingVertical: spacing[3],
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    borderStyle: 'dashed',
    backgroundColor: colors.surface,
  },
  addSpaceText: {
    ...textStyles.label,
    color: colors.textSecondary,
  },
  spaceActionsRow: {
    flexDirection: 'row',
    gap: spacing[2],
  },
  joinSpaceButton: {
    paddingHorizontal: spacing[6],
    paddingVertical: spacing[3],
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  joinSpaceButtonText: {
    ...textStyles.labelLg,
    color: colors.primary,
  },

  // ── Subscription banner ───────────────────────────────────────────────────
  subscriptionBanner: {
    backgroundColor: colors.primaryLight,
    borderRadius:    radius.xl,
    borderWidth:     1,
    borderColor:     colors.primary,
    padding:         spacing[4],
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'space-between',
  },
  subscriptionInfo: {
    gap: spacing[0.5],
  },
  subscriptionTitle: {
    ...textStyles.labelLg,
    color: colors.primary,
  },
  subscriptionUsage: {
    ...textStyles.caption,
    color: colors.textSecondary,
  },
  subscriptionCta: {
    paddingHorizontal: spacing[3],
    paddingVertical:   spacing[1.5],
    backgroundColor:   colors.primary,
    borderRadius:      radius.full,
  },
  subscriptionCtaText: {
    ...textStyles.label,
    color: colors.textInverse,
  },
  });
}
