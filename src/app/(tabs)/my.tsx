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
  Alert,
} from 'react-native';
// expo-image provides better caching and performance than React Native's Image (TASK-701)
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useColors } from '@/hooks/useColors';
import { useAppearanceStore, type ColorSchemePreference } from '@/stores/appearanceStore';
import { useSubscriptionStore } from '@/stores/subscriptionStore';
import { spacing, radius, componentHeight } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import * as authService from '@/services/authService';
import { useAuthStore } from '@/stores/authStore';
import { useSpaceStore } from '@/stores/spaceStore';
import type { SpaceSummary } from '@/types';

// ─── Theme option labels ───────────────────────────────────────────────────────

const THEME_OPTIONS: Array<{ value: ColorSchemePreference; label: string }> = [
  { value: 'light',  label: '라이트' },
  { value: 'dark',   label: '다크'   },
  { value: 'system', label: '시스템'  },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function MyScreen() {
  const colors = useColors();
  // Build dynamic styles using the current theme's color tokens
  const styles = makeStyles(colors);

  const { colorScheme, setColorScheme } = useAppearanceStore();
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
      Alert.alert('오류', '닉네임을 입력해 주세요.');
      return;
    }
    if (trimmed.length > 20) {
      Alert.alert('오류', '닉네임은 20자 이하로 입력해 주세요.');
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
      Alert.alert('오류', err instanceof Error ? err.message : '닉네임 저장에 실패했습니다.');
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
      Alert.alert(
        '권한 필요',
        '아바타를 변경하려면 사진 접근 권한이 필요합니다. 설정에서 허용해 주세요.',
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
      Alert.alert('오류', err instanceof Error ? err.message : '아바타 업로드에 실패했습니다.');
    } finally {
      setIsUploadingAvatar(false);
    }
  }, [setUser]);

  // ─── Logout ──────────────────────────────────────────────────────────────

  const handleLogout = useCallback(() => {
    Alert.alert(
      '로그아웃',
      '로그아웃 하시겠습니까?',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '로그아웃',
          style: 'destructive',
          onPress: async () => {
            setIsLoggingOut(true);
            try {
              await authService.signOut();
              // Clear user from store — _layout.tsx's auth guard will redirect to /auth/login
              setUser(null);
            } catch (err) {
              Alert.alert('오류', err instanceof Error ? err.message : '로그아웃에 실패했습니다.');
              setIsLoggingOut(false);
            }
          },
        },
      ],
    );
  }, [setUser]);

  // ─── Account deletion ─────────────────────────────────────────────────────

  /** Prompt the user with a double-confirmation alert before deleting their account. */
  const handleDeleteAccount = useCallback(() => {
    Alert.alert(
      '회원 탈퇴',
      '탈퇴 시 모든 데이터(일정, 할일, Space)가 영구적으로 삭제됩니다.\n정말 탈퇴하시겠습니까?',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '탈퇴하기',
          style: 'destructive',
          onPress: () => {
            // Second confirmation to prevent accidental tap
            Alert.alert(
              '최종 확인',
              '이 작업은 되돌릴 수 없습니다. 계속하시겠습니까?',
              [
                { text: '취소', style: 'cancel' },
                {
                  text: '탈퇴',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      await authService.deleteAccount();
                      setUser(null);
                    } catch (err) {
                      Alert.alert(
                        '오류',
                        err instanceof Error ? err.message : '계정 삭제에 실패했습니다.',
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
  }, [setUser]);

  // ─── Render ──────────────────────────────────────────────────────────────

  if (!user) {
    // Should not render without a user (auth guard in _layout.tsx prevents this)
    return null;
  }

  return (
    <SafeAreaView style={styles.container}>
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
                placeholder="닉네임 입력"
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
                  <Text style={styles.nicknameSaveText}>저장</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.nicknameCancelButton}
                onPress={handleCancelEditNickname}
                disabled={isSavingNickname}
              >
                <Text style={styles.nicknameCancelText}>취소</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.nicknameRow}>
              <Text style={styles.nickname}>{user.nickname}</Text>
              <TouchableOpacity
                onPress={handleStartEditNickname}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.editNicknameText}>수정</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Email display (read-only) */}
          {user.email && (
            <Text style={styles.email}>{user.email}</Text>
          )}
        </View>

        {/* ── My Spaces section ───────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>내 Space</Text>

          {spacesLoading && spaces.length === 0 ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : spaces.length === 0 ? (
            <View style={styles.emptySpacesCard}>
              <Text style={styles.emptySpacesText}>아직 참여한 Space가 없습니다.</Text>
              <TouchableOpacity
                style={styles.createSpaceButton}
                onPress={() => router.push('/space/create')}
                activeOpacity={0.7}
              >
                <Text style={styles.createSpaceButtonText}>Space 만들기</Text>
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
                <Text style={styles.addSpaceText}>+ Space 만들기</Text>
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
                <Text style={styles.subscriptionTitle}>SyncDay Free</Text>
                <Text style={styles.subscriptionUsage}>
                  오늘 AI {aiUsageToday}/5회 사용
                </Text>
              </View>
              <View style={styles.subscriptionCta}>
                <Text style={styles.subscriptionCtaText}>Pro로 업그레이드 →</Text>
              </View>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Settings section ─────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>설정</Text>
          <View style={styles.menuCard}>
            {/* Notification settings */}
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => router.push('/settings/notifications')}
              activeOpacity={0.7}
            >
              <Text style={styles.menuItemText}>알림 설정</Text>
              <Text style={styles.menuItemChevron}>›</Text>
            </TouchableOpacity>

            <View style={styles.menuDivider} />

            {/* Category management */}
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => router.push('/settings/categories')}
              activeOpacity={0.7}
            >
              <Text style={styles.menuItemText}>카테고리 관리</Text>
              <Text style={styles.menuItemChevron}>›</Text>
            </TouchableOpacity>

            <View style={styles.menuDivider} />

            {/* Theme selector (inline Segmented Control) */}
            <View style={styles.menuItemTheme}>
              <Text style={styles.menuItemText}>테마</Text>
              <View style={styles.themeSegmented}>
                {THEME_OPTIONS.map(opt => (
                  <TouchableOpacity
                    key={opt.value}
                    style={[
                      styles.themeSegmentItem,
                      colorScheme === opt.value && styles.themeSegmentItemActive,
                    ]}
                    onPress={() => setColorScheme(opt.value)}
                    activeOpacity={0.7}
                  >
                    <Text style={[
                      styles.themeSegmentLabel,
                      colorScheme === opt.value && styles.themeSegmentLabelActive,
                    ]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>
        </View>

        {/* ── Account section ─────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>계정</Text>
          <View style={styles.menuCard}>
            <TouchableOpacity
              style={[styles.menuItem, styles.logoutItem]}
              onPress={handleLogout}
              disabled={isLoggingOut}
              activeOpacity={0.7}
            >
              {isLoggingOut ? (
                <ActivityIndicator size="small" color={colors.error} />
              ) : (
                <Text style={styles.logoutText}>로그아웃</Text>
              )}
            </TouchableOpacity>

            <View style={styles.menuDivider} />

            {/* Account deletion */}
            <TouchableOpacity
              style={[styles.menuItem, styles.logoutItem]}
              onPress={handleDeleteAccount}
              activeOpacity={0.7}
            >
              <Text style={styles.deleteAccountText}>회원 탈퇴</Text>
            </TouchableOpacity>
          </View>
        </View>
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
  const colors = useColors();
  const styles = makeStyles(colors);
  const typeLabel = space.type === 'couple' ? '커플' : '그룹';

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

  // ── Account / menu card ──────────────────────────────────────────────────
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
  menuDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginHorizontal: spacing[4],
  },

  // Theme segmented control row
  menuItemTheme: {
    paddingHorizontal: spacing[4],
    paddingVertical:   spacing[3],
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
  },
  themeSegmented: {
    flexDirection:   'row',
    borderWidth:     1,
    borderColor:     colors.border,
    borderRadius:    radius.lg,
    overflow:        'hidden',
  },
  themeSegmentItem: {
    paddingHorizontal: spacing[3],
    paddingVertical:   spacing[1.5],
    backgroundColor:   colors.surface,
  },
  themeSegmentItemActive: {
    backgroundColor: colors.primary,
  },
  themeSegmentLabel: {
    ...textStyles.caption,
    color: colors.textSecondary,
  },
  themeSegmentLabelActive: {
    color: colors.textInverse,
    fontWeight: '600',
  },

  logoutItem: {
    justifyContent: 'center',
  },
  logoutText: {
    ...textStyles.labelLg,
    color: colors.error,
  },
  deleteAccountText: {
    ...textStyles.labelLg,
    color: colors.textTertiary,
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
