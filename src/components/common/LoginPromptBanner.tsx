/**
 * LoginPromptBanner — non-intrusive inline banner that nudges a browsing
 * guest to sign in. Shown on the Home tab while the user has no account
 * (Part A of the 2026-06-04 guest-entry plan). Tapping anywhere on the
 * banner opens the login screen. Renders nothing once authenticated, so
 * callers can mount it unconditionally.
 */

import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useColors } from '@/hooks/useColors';
import { useAuthStore } from '@/stores/authStore';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';

export function LoginPromptBanner() {
  const { t } = useTranslation();
  const colors = useColors();
  const router = useRouter();
  // Subscribe to the boolean only so the banner re-renders the moment the
  // user logs in (then unmounts itself via the guard below).
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  if (isAuthenticated) return null;

  const styles = makeStyles(colors);

  return (
    <Pressable
      style={({ pressed }) => [styles.container, pressed && styles.pressed]}
      onPress={() => router.push('/auth/login')}
      accessibilityRole="button"
      accessibilityLabel={`${t('auth.guest.banner_title')}. ${t('auth.guest.banner_desc')}`}
      testID="login-prompt-banner"
    >
      <View style={styles.iconCircle}>
        <Ionicons name="person-add-outline" size={20} color={colors.textInverse} />
      </View>
      <View style={styles.textBlock}>
        <Text style={styles.title}>{t('auth.guest.banner_title')}</Text>
        <Text style={styles.desc} numberOfLines={2}>
          {t('auth.guest.banner_desc')}
        </Text>
      </View>
      <View style={styles.cta}>
        <Text style={styles.ctaText}>{t('auth.guest.banner_cta')}</Text>
        <Ionicons name="chevron-forward" size={16} color={colors.primary} />
      </View>
    </Pressable>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[3],
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.xl,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      paddingVertical: spacing[3],
      paddingHorizontal: spacing[3],
      // Self-managed outer margins so callers can drop it inline without a
      // wrapper (the Home scroll content has no horizontal padding of its own).
      marginHorizontal: spacing[4],
      marginTop: spacing[2],
      marginBottom: spacing[1],
    },
    pressed: { opacity: 0.9 },
    iconCircle: {
      width: 40,
      height: 40,
      borderRadius: radius.full,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    textBlock: { flex: 1, gap: 2 },
    title: { ...textStyles.label, color: colors.textPrimary },
    desc: { ...textStyles.caption, color: colors.textSecondary },
    cta: { flexDirection: 'row', alignItems: 'center', gap: 2 },
    ctaText: { ...textStyles.label, color: colors.primary },
  });
}
