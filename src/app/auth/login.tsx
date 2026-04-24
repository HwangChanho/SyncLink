/**
 * Login screen — Google, Kakao, Apple sign-in.
 * Order: Google → Kakao → Apple (iOS only)
 */

import { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, Platform, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useColors } from '@/hooks/useColors';
import { spacing, radius, componentHeight } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import {
  signInWithGoogle,
  signInWithKakao,
  signInWithApple,
  signInWithEmail,
} from '@/services/authService';

type Provider = 'google' | 'kakao' | 'apple' | 'dev';

// __DEV__ is true in debug builds (npx expo run:ios) and false in release (TestFlight/App Store)
// This is the correct way to gate simulator-only features — EXPO_PUBLIC_APP_ENV is unreliable
// because .env sets it to 'production' even for local dev builds.
const IS_DEV_BUILD = __DEV__;

export default function LoginScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const styles = makeStyles(colors);
  const [loading, setLoading] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Dev-only login state
  const [devEmail, setDevEmail]       = useState('');
  const [devPassword, setDevPassword] = useState('');

  const isLoading = loading !== null;

  async function handleSignIn(provider: Provider) {
    if (isLoading) return;
    setLoading(provider);
    setError(null);

    try {
      let result;
      if (provider === 'dev') {
        result = await signInWithEmail(devEmail.trim(), devPassword);
      } else {
        const fn = provider === 'google'
          ? signInWithGoogle
          : provider === 'kakao'
            ? signInWithKakao
            : signInWithApple;
        result = await fn();
      }
      router.replace(result.isNewUser ? '/auth/onboarding' : '/(tabs)');
    } catch (err: unknown) {
      if (isCancelError(err)) return;
      setError(err instanceof Error ? err.message : t('auth.login.error'));
    } finally {
      setLoading(null);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>

        <View style={styles.hero}>
          <Text style={styles.logo}>SyncLink</Text>
          <Text style={styles.tagline}>{t('auth.login.tagline')}</Text>
        </View>

        <View style={styles.buttons}>

          {/* Google — iOS & Android */}
          <TouchableOpacity
            style={[styles.button, styles.googleButton, isLoading && styles.disabled]}
            onPress={() => handleSignIn('google')}
            disabled={isLoading}
            accessibilityLabel="Google로 로그인"
          >
            {loading === 'google'
              ? <ActivityIndicator color="#000000" />
              : <Text style={[styles.buttonText, styles.googleText]}>{t('auth.login.google')}</Text>
            }
          </TouchableOpacity>

          {/* Kakao — iOS & Android only (not available on web: TASK-1305).
              On web, Supabase does not natively support Kakao as an OAuth provider.
              We hide the button and show an informational notice instead. */}
          {Platform.OS !== 'web' ? (
            <TouchableOpacity
              style={[styles.button, styles.kakaoButton, isLoading && styles.disabled]}
              onPress={() => handleSignIn('kakao')}
              disabled={isLoading}
              accessibilityLabel="카카오로 로그인"
            >
              {loading === 'kakao'
                ? <ActivityIndicator color="#3A1D1D" />
                : <Text style={[styles.buttonText, styles.kakaoText]}>{t('auth.login.kakao')}</Text>
              }
            </TouchableOpacity>
          ) : (
            /* Web: show a subtle notice that Kakao login is app-only */
            <View style={styles.kakaoWebNotice}>
              <Text style={styles.kakaoWebNoticeText}>
                {t('reminder.kakao_web_notice')}
              </Text>
            </View>
          )}

          {/* Apple — iOS only */}
          {Platform.OS === 'ios' && (
            <TouchableOpacity
              style={[styles.button, styles.appleButton, isLoading && styles.disabled]}
              onPress={() => handleSignIn('apple')}
              disabled={isLoading}
              accessibilityLabel="Apple로 로그인"
            >
              {loading === 'apple'
                ? <ActivityIndicator color="#FFFFFF" />
                : <Text style={[styles.buttonText, styles.appleText]}>{t('auth.login.apple')}</Text>
              }
            </TouchableOpacity>
          )}

        </View>

        {/* Dev-only email/password login — hidden in preview/production builds */}
        {IS_DEV_BUILD && (
          <View style={styles.devSection}>
            <Text style={styles.devLabel}>{t('auth.login.dev_section')}</Text>
            <TextInput
              style={styles.devInput}
              placeholder={t('auth.login.email_placeholder')}
              placeholderTextColor={colors.textTertiary}
              value={devEmail}
              onChangeText={setDevEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              editable={!isLoading}
            />
            <TextInput
              style={styles.devInput}
              placeholder={t('auth.login.password_placeholder')}
              placeholderTextColor={colors.textTertiary}
              value={devPassword}
              onChangeText={setDevPassword}
              secureTextEntry
              editable={!isLoading}
            />
            <TouchableOpacity
              style={[styles.button, styles.devButton, isLoading && styles.disabled]}
              onPress={() => handleSignIn('dev')}
              disabled={isLoading || !devEmail || !devPassword}
            >
              {loading === 'dev'
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.devButtonText}>{t('auth.login.dev_button')}</Text>
              }
            </TouchableOpacity>
          </View>
        )}

        {error !== null && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <Text style={styles.legal}>
          {t('auth.login.legal')}
        </Text>

      </View>
    </SafeAreaView>
  );
}

function isCancelError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return msg === 'cancelled' || msg.includes('canceled') || msg.includes('user_cancelled');
}

/**
 * Dynamic styles factory — receives current theme color tokens.
 *
 * @param colors - Active theme color tokens from useColors()
 */
function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    padding: spacing[6],
  },
  hero: { alignItems: 'center', marginBottom: spacing[12] },
  logo: { ...textStyles.h1, color: colors.primary, marginBottom: spacing[2] },
  tagline: { ...textStyles.bodyLg, color: colors.textSecondary, textAlign: 'center' },
  buttons: { width: '100%', gap: spacing[3] },
  button: {
    width: '100%', height: componentHeight.button,
    borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center',
  },
  disabled: { opacity: 0.6 },
  buttonText: { ...textStyles.labelLg },
  googleButton: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#DADCE0' },
  googleText: { color: '#3C4043' },
  kakaoButton: { backgroundColor: '#FEE500' },
  kakaoText: { color: '#3A1D1D' },
  appleButton: { backgroundColor: '#000000' },
  appleText: { color: '#FFFFFF' },
  /** Shown on web in place of the Kakao login button (TASK-1305). */
  kakaoWebNotice: {
    width: '100%',
    paddingVertical: spacing[3],
    alignItems: 'center',
  },
  kakaoWebNoticeText: {
    ...textStyles.bodySm,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  errorBox: {
    marginTop: spacing[4], width: '100%',
    padding: spacing[3], borderRadius: radius.md,
    backgroundColor: colors.primaryLight,
  },
  errorText: { ...textStyles.bodySm, color: colors.error, textAlign: 'center' },
  devSection: {
    width: '100%', marginTop: spacing[6],
    padding: spacing[4], borderRadius: radius.lg,
    borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border,
    gap: spacing[3],
  },
  devLabel: { ...textStyles.label, color: colors.textSecondary, textAlign: 'center' },
  devInput: {
    width: '100%', height: 44,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing[3],
    ...textStyles.body, color: colors.textPrimary,
    backgroundColor: colors.surface,
  },
  devButton: { backgroundColor: '#555' },
  devButtonText: { ...textStyles.labelLg, color: '#fff' },
  legal: {
    ...textStyles.caption, color: colors.textTertiary,
    textAlign: 'center', marginTop: spacing[8], paddingHorizontal: spacing[4],
  },
  });
}
