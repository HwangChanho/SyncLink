/**
 * LoginPromptSheet — soft sign-in bottom sheet for browsing guests.
 *
 * Mounted once at the root layout; visibility is driven by loginPromptStore.
 * A guest who attempts a value action (create event, AI input, share) sees
 * this instead of being bounced to the login screen, then can sign in or
 * dismiss and keep browsing. Part A / Phase 2 of the 2026-06-04 guest plan.
 *
 * Modeled on QuotaExceededSheet for visual consistency.
 */

import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useColors } from '@/hooks/useColors';
import type { ColorTokens } from '@/hooks/useColors';
import { radius, spacing } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import { useLoginPromptStore } from '@/stores/loginPromptStore';

export function LoginPromptSheet() {
  const { t } = useTranslation();
  const colors = useColors();
  const styles = makeStyles(colors);

  const visible = useLoginPromptStore((s) => s.visible);
  const message = useLoginPromptStore((s) => s.message);
  const close = useLoginPromptStore((s) => s.close);

  // Close first so the sheet's exit animation doesn't fight the navigation
  // transition to the login screen.
  const handleLogin = () => {
    close();
    router.push('/auth/login');
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.overlay} onPress={close}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.handle} />

          <View style={styles.iconCircle}>
            <Ionicons name="sparkles" size={26} color={colors.textInverse} />
          </View>

          <Text style={styles.title}>{t('auth.guest.sheet_title')}</Text>
          <Text style={styles.subtitle}>{message ?? t('auth.guest.sheet_desc')}</Text>

          <Pressable style={styles.primaryBtn} onPress={handleLogin} accessibilityRole="button">
            <Text style={styles.primaryBtnText}>{t('auth.guest.sheet_cta')}</Text>
          </Pressable>
          <Pressable style={styles.closeBtn} onPress={close} accessibilityRole="button">
            <Text style={styles.closeBtnText}>{t('auth.guest.sheet_later')}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function makeStyles(colors: ColorTokens) {
  return StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.4)',
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: radius['2xl'],
      borderTopRightRadius: radius['2xl'],
      paddingHorizontal: spacing[6],
      paddingTop: spacing[3],
      paddingBottom: spacing[8],
      gap: spacing[3],
      alignItems: 'center',
    },
    handle: {
      alignSelf: 'center',
      width: 40,
      height: 4,
      borderRadius: radius.full,
      backgroundColor: colors.border,
      marginBottom: spacing[2],
    },
    iconCircle: {
      width: 56,
      height: 56,
      borderRadius: radius.full,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing[1],
    },
    title: {
      ...textStyles.h3,
      color: colors.textPrimary,
      textAlign: 'center',
    },
    subtitle: {
      ...textStyles.body,
      color: colors.textSecondary,
      textAlign: 'center',
    },
    primaryBtn: {
      alignSelf: 'stretch',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primary,
      borderRadius: radius.md,
      paddingVertical: spacing[4],
      marginTop: spacing[2],
    },
    primaryBtnText: {
      ...textStyles.labelLg,
      color: colors.textInverse,
    },
    closeBtn: {
      alignItems: 'center',
      paddingVertical: spacing[2],
    },
    closeBtnText: {
      ...textStyles.body,
      color: colors.textSecondary,
    },
  });
}
