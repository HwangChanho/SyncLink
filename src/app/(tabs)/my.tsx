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

import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
} from 'react-native';
// expo-image provides better caching and performance than React Native's Image (TASK-701)
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';
import { useColors } from '@/hooks/useColors';
import { useSubscriptionStore } from '@/stores/subscriptionStore';
import { spacing, radius, componentHeight } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import * as authService from '@/services/authService';
import { useAuthStore } from '@/stores/authStore';
import { useSpaceStore } from '@/stores/spaceStore';
import { showAlert } from '@/lib/webAlert';
import type { SpaceSummary } from '@/types';
import { SettingsSection } from '@/components/my/SettingsSection';
import { ServiceInfoSection } from '@/components/my/ServiceInfoSection';
import { AccountSection } from '@/components/my/AccountSection';

// ─── Theme options are now built inside the component using i18n ───────────────

// ─── Component ────────────────────────────────────────────────────────────────

export default function MyScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  // Build dynamic styles using the current theme's color tokens
  const styles = makeStyles(colors);

  const { plan, aiUsageToday } = useSubscriptionStore();

  const { user, setUser } = useAuthStore();
  const { spaces, fetchMySpaces, isLoading: spacesLoading } = useSpaceStore();

  // ─── Local UI state ──────────────────────────────────────────────────────
  /** True when the nickname TextInput is visible */
  const [isEditingNickname, setIsEditingNickname] = useState(false);
  /** Draft value while editing; initialized from user.nickname */
  const [nicknameInput, setNicknameInput] = useState(user?.nickname ?? '');
  /** True during nickname save network call */
  const [isSavingNickname, setIsSavingNickname] = useState(false);
  /** True during avatar upload */
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  /** True during sign-out */
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  // Load spaces when tab mounts
  useEffect(() => {
    fetchMySpaces();
  }, [fetchMySpaces]);

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

  /** Cancel edit: revert to saved nickname */
  const handleCancelEditNickname = useCallback(() => {
    setNicknameInput(user?.nickname ?? '');
    setIsEditingNickname(false);
  }, [user?.nickname]);

  /** Save nickname: call authService, update store */
  const handleSaveNickname = useCallback(async () => {
    const trimmed = nicknameInput.trim();

    // Validation: at least 1 char, max 20 chars
    if (trimmed.length === 0) {
      showAlert(t('common.error'), t('profile.nickname_required'));
      return;
    }
    if (trimmed.length > 20) {
      showAlert(t('common.error'), t('profile.nickname_too_long'));
      return;
    }
    // Skip network call if unchanged
    if (trimmed === user?.nickname) {
      setIsEditingNickname(false);
      return;
    }

    setIsSavingNickname(true);
    try {
      const updated = await authService.updateProfile({ nickname: trimmed });
      setUser(updated);
      setIsEditingNickname(false);
    } catch (err) {
      showAlert(t('common.error'), err instanceof Error ? err.message : t('profile.nickname_failed'));
    } finally {
      setIsSavingNickname(false);
    }
  }, [nicknameInput, user?.nickname, setUser]);

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

    // Open the image picker (gallery)
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,    // crop to square
      aspect: [1, 1],
      quality: 0.7,           // 70% quality keeps file size reasonable
    });

    // User cancelled
    if (result.canceled) return;

    const asset = result.assets[0];
    if (!asset?.uri) return;

    setIsUploadingAvatar(true);
    try {
      // Upload to Supabase Storage
      const publicUrl = await authService.uploadAvatar(asset.uri);
      // Update user profile with new URL
      const updated = await authService.updateProfile({ avatar_url: publicUrl });
      setUser(updated);
    } catch (err) {
      // Log raw error so engineers can triage via Metro logs.
      // showAlert works on both web (window.alert) and native (Alert.alert).
      console.error('[MyTab] handleChangeAvatar failed:', err);
      showAlert(
        t('common.error'),
        err instanceof Error ? err.message : t('profile.avatar_failed'),
      );
    } finally {
      setIsUploadingAvatar(false);
    }
  }, [setUser, t]);

  // ─── Logout ──────────────────────────────────────────────────────────────

  const handleLogout = useCallback(() => {
    // Use showAlert (not Alert.alert) so the confirm dialog actually shows
    // on web — React Native Web's Alert.alert is a no-op for some action
    // sheets, which previously made the logout button look unresponsive.
    showAlert(
      t('auth.logout.button'),
      t('auth.logout.confirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('auth.logout.button'),
          style: 'destructive',
          onPress: async () => {
            setIsLoggingOut(true);
            try {
              await authService.signOut();
              // Clear user from store — _layout.tsx's auth guard will redirect to /auth/login
              setUser(null);
            } catch (err) {
              showAlert(t('common.error'), err instanceof Error ? err.message : t('auth.logout.failed'));
              setIsLoggingOut(false);
            }
          },
        },
      ],
    );
  }, [setUser, t]);

  // ─── Account deletion ─────────────────────────────────────────────────────

  /**
   * Prompt the user with a double-confirmation alert before deleting their account.
   *
   * Flow:
   *   1) First Alert — primary warning.
   *   2) Second Alert — irreversible-action confirm.
   *   3) authService.deleteAccount() → server-side auth.admin.deleteUser + signOut.
   *   4) Reset local auth state AND explicitly navigate to /auth/login.
   *      The auth-guard in _layout.tsx also watches for user=null, but an
   *      explicit router.replace() is more robust against race conditions
   *      (the guard runs on segment change; a stale (tabs)/my render without
   *      a guard re-run can otherwise linger for a frame).
   *
   * Logs:
   *   console.error is used on failure so iOS silent-fail bugs surface in
   *   Metro. Previously the user only saw the localised error title.
   */
  const handleDeleteAccount = useCallback(() => {
    showAlert(
      t('auth.delete_account.button'),
      t('auth.delete_account.confirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('space.leave_button'),
          style: 'destructive',
          onPress: () => {
            // Second confirmation to prevent accidental tap
            showAlert(
              t('common.confirm'),
              t('common.irreversible'),
              [
                { text: t('common.cancel'), style: 'cancel' },
                {
                  text: t('common.delete'),
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      await authService.deleteAccount();
                      // Clear auth store — auth-guard will pick this up too.
                      setUser(null);
                      // Belt-and-braces: force navigation to the login screen
                      // immediately so the user cannot see tab content after
                      // their account has been deleted server-side.
                      router.replace('/auth/login');
                    } catch (err) {
                      // Always log the raw error — helps triage Edge Function
                      // failures that previously surfaced only as a generic
                      // localised message on iOS.
                      console.error('[My] deleteAccount failed:', err);
                      showAlert(
                        t('common.error'),
                        err instanceof Error ? err.message : t('auth.delete_account.failed'),
                      );
                    }
                  },
                },
              ],
            );
          },
        },
      ],
    );
  }, [setUser, t]);

  // ─── Render ──────────────────────────────────────────────────────────────

  if (!user) {
    // Should not render without a user (auth guard in _layout.tsx prevents this)
    return null;
  }

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
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
                onChangeText={setNicknameInput}
                autoFocus
                maxLength={20}
                returnKeyType="done"
                onSubmitEditing={handleSaveNickname}
                placeholder={t('profile.nickname_placeholder')}
                placeholderTextColor={colors.textPlaceholder}
              />
              <TouchableOpacity
                style={[styles.nicknameSaveButton, isSavingNickname && styles.buttonDisabled]}
                onPress={handleSaveNickname}
                disabled={isSavingNickname}
              >
                {isSavingNickname ? (
                  <ActivityIndicator size="small" color={colors.textInverse} />
                ) : (
                  <Text style={styles.nicknameSaveText}>{t('common.save')}</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.nicknameCancelButton}
                onPress={handleCancelEditNickname}
                disabled={isSavingNickname}
              >
                <Text style={styles.nicknameCancelText}>{t('common.cancel')}</Text>
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
              {plan === 'pro' ? 'SyncLink Pro' : 'SyncLink Free'}
            </Text>
          </View>
        </View>

        {/* ── My Spaces section ───────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('tabs.my')} Space</Text>

          {spacesLoading && spaces.length === 0 ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : spaces.length === 0 ? (
            <View style={styles.emptySpacesCard}>
              <Text style={styles.emptySpacesText}>{t('common.none')}</Text>
              <TouchableOpacity
                style={styles.createSpaceButton}
                onPress={() => router.push('/space/create')}
                activeOpacity={0.7}
              >
                <Text style={styles.createSpaceButtonText}>Space {t('category.new')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              {spaces.map(space => (
                <SpaceCard
                  key={space.id}
                  space={space}
                  onPress={() => router.push(`/space/${space.id}`)}
                />
              ))}
              {/* Add space button at the bottom of the list */}
              <TouchableOpacity
                style={styles.addSpaceRow}
                onPress={() => router.push('/space/create')}
                activeOpacity={0.7}
              >
                <Text style={styles.addSpaceText}>+ Space {t('category.new')}</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        {/* ── Subscription banner (Free plan only) ────────────────────── */}
        {plan === 'free' && (
          <View style={styles.section}>
            <TouchableOpacity
              style={styles.subscriptionBanner}
              onPress={() => router.push('/subscription/paywall')}
              activeOpacity={0.85}
            >
              <View style={styles.subscriptionInfo}>
                <Text style={styles.subscriptionTitle}>SyncLink Free</Text>
                <Text style={styles.subscriptionUsage}>
                  AI {aiUsageToday}/5
                </Text>
              </View>
              <View style={styles.subscriptionCta}>
                <Text style={styles.subscriptionCtaText}>Pro →</Text>
              </View>
            </TouchableOpacity>
          </View>
        )}

        <SettingsSection />

        <ServiceInfoSection />

        <AccountSection
          isLoggingOut={isLoggingOut}
          onLogout={handleLogout}
          onDeleteAccount={handleDeleteAccount}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/**
 * Card row for a single space in the My Spaces list.
 * Uses useColors() directly to respond to theme changes.
 */
function SpaceCard({
  space,
  onPress,
}: {
  space: SpaceSummary;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const colors = useColors();
  const styles = makeStyles(colors);
  const typeLabel = space.type === 'couple' ? t('space.types.couple') : t('space.types.group');

  return (
    <TouchableOpacity style={styles.spaceCard} onPress={onPress} activeOpacity={0.7}>
      {/* Space icon */}
      <View style={styles.spaceCardIcon}>
        {space.coverImageUrl ? (
          <Image source={{ uri: space.coverImageUrl }} style={styles.spaceCardImage} />
        ) : (
          <Text style={styles.spaceCardEmoji}>
            {space.type === 'couple' ? '💑' : '👥'}
          </Text>
        )}
      </View>

      {/* Space info */}
      <View style={styles.spaceCardInfo}>
        <Text style={styles.spaceCardName} numberOfLines={1}>{space.name}</Text>
        <Text style={styles.spaceCardMeta}>
          {typeLabel} · {space.memberCount}명
        </Text>
      </View>

      {/* Chevron */}
      <Text style={styles.spaceCardChevron}>›</Text>
    </TouchableOpacity>
  );
}

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
    paddingBottom: spacing[10],
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
  nicknameSaveButton: {
    height: componentHeight.buttonSm,
    paddingHorizontal: spacing[4],
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  nicknameSaveText: {
    ...textStyles.label,
    color: colors.textInverse,
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
