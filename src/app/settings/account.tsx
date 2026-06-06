/**
 * Account settings screen — 로그아웃 + 회원탈퇴.
 *
 * Build-81 LEAD: "사용자도 화면 설정이나 앱잠금처럼 들어가서 로그아웃이나
 * 회원탈퇴 하게 하자". 기존 my.tsx 의 inline 버튼을 별도 settings 화면으로
 * 분리. settings/app-lock 패턴 동일.
 *
 * Route: /settings/account
 */

import { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useColors } from '@/hooks/useColors';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import * as authService from '@/services/authService';
import { useAuthStore } from '@/stores/authStore';
import { showAlert } from '@/lib/webAlert';
import { logError } from '@/lib/errorLogger';

export default function AccountScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const styles = makeStyles(colors);
  const { user, setUser } = useAuthStore();

  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // ─── Logout ──────────────────────────────────────────────────────────────

  const handleLogout = useCallback(() => {
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
              setUser(null);
              // setUser(null) → useAuthGuard 가 /auth/login 으로 단일 redirect.
              // 여기서 router.replace 를 또 호출하면 가드 redirect 와 겹쳐 로그인
              // 화면이 두 번 떴다 → 명시적 replace 제거(2026-06-06 수정).
            } catch (err) {
              showAlert(
                t('common.error'),
                err instanceof Error ? err.message : t('auth.logout.failed'),
              );
              setIsLoggingOut(false);
            }
          },
        },
      ],
    );
  }, [setUser, t]);

  // ─── Account deletion ───────────────────────────────────────────────────

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
            // Second confirmation — 의도하지 않은 탭 방지.
            showAlert(
              t('common.confirm'),
              t('common.irreversible'),
              [
                { text: t('common.cancel'), style: 'cancel' },
                {
                  text: t('common.delete'),
                  style: 'destructive',
                  onPress: async () => {
                    setIsDeleting(true);
                    try {
                      await authService.deleteAccount();
                      setUser(null);
                      // 로그아웃과 동일 — 가드가 단일 redirect. 중복 replace 제거.
                    } catch (err) {
                      void logError({ context: 'settings.account.delete', error: err });
                      showAlert(
                        t('common.error'),
                        err instanceof Error ? err.message : t('auth.delete_account.failed'),
                      );
                      setIsDeleting(false);
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

  if (!user) return null;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          style={styles.backButton}
          onPress={() => router.back()}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>{t('settings.account', '계정')}</Text>
        <View style={styles.headerRight} />
      </View>

      {/* Content */}
      <View style={styles.content}>
        {/* User info */}
        <View style={styles.userCard}>
          <View style={[styles.avatarPlaceholder, { backgroundColor: colors.primary }]}>
            <Text style={styles.avatarLetter}>
              {(user.nickname || user.email || '?').charAt(0).toUpperCase()}
            </Text>
          </View>
          <Text style={styles.userName}>{user.nickname || t('profile.no_nickname')}</Text>
          <Text style={styles.userEmail}>{user.email ?? ''}</Text>
        </View>

        {/* Logout */}
        <Pressable
          testID="settings-account-logout"
          style={({ pressed }) => [
            styles.actionButton,
            styles.logoutButton,
            pressed && styles.actionPressed,
          ]}
          onPress={handleLogout}
          disabled={isLoggingOut || isDeleting}
        >
          {isLoggingOut ? (
            <ActivityIndicator color={colors.textPrimary} />
          ) : (
            <>
              <Ionicons name="log-out-outline" size={20} color={colors.textPrimary} />
              <Text style={styles.logoutText}>{t('auth.logout.button')}</Text>
            </>
          )}
        </Pressable>

        {/* Delete account */}
        <Pressable
          testID="settings-account-delete"
          style={({ pressed }) => [
            styles.actionButton,
            styles.deleteButton,
            pressed && styles.actionPressed,
          ]}
          onPress={handleDeleteAccount}
          disabled={isLoggingOut || isDeleting}
        >
          {isDeleting ? (
            <ActivityIndicator color={colors.error} />
          ) : (
            <>
              <Ionicons name="trash-outline" size={20} color={colors.error} />
              <Text style={styles.deleteText}>{t('auth.delete_account.button')}</Text>
            </>
          )}
        </Pressable>

        <Text style={styles.deleteWarning}>
          {t('auth.delete_account.warning', '계정 삭제 시 모든 일정·할일·Space 데이터가 영구 삭제됩니다.')}
        </Text>
      </View>
    </SafeAreaView>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing[3],
      paddingVertical: spacing[3],
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    backButton: {
      padding: spacing[1],
    },
    headerTitle: {
      ...textStyles.h4,
      color: colors.textPrimary,
    },
    headerRight: {
      width: 32,
    },
    content: {
      flex: 1,
      padding: spacing[5],
      gap: spacing[3],
    },
    userCard: {
      alignItems: 'center',
      paddingVertical: spacing[6],
      gap: spacing[2],
    },
    avatarPlaceholder: {
      width: 72,
      height: 72,
      borderRadius: 36,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing[2],
    },
    avatarLetter: {
      ...textStyles.h2,
      color: colors.textInverse,
      fontWeight: '700',
    },
    userName: {
      ...textStyles.h4,
      color: colors.textPrimary,
    },
    userEmail: {
      ...textStyles.body,
      color: colors.textSecondary,
    },
    actionButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing[2],
      paddingVertical: spacing[4],
      borderRadius: radius.md,
      borderWidth: 1,
    },
    actionPressed: {
      opacity: 0.6,
    },
    logoutButton: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
    },
    logoutText: {
      ...textStyles.labelLg,
      color: colors.textPrimary,
    },
    deleteButton: {
      backgroundColor: 'transparent',
      borderColor: colors.error,
      marginTop: spacing[6],
    },
    deleteText: {
      ...textStyles.labelLg,
      color: colors.error,
      fontWeight: '600',
    },
    deleteWarning: {
      ...textStyles.caption,
      color: colors.textTertiary,
      textAlign: 'center',
      paddingHorizontal: spacing[4],
    },
  });
}
