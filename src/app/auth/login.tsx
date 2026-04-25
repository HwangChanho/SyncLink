/**
 * Login screen — Google, Kakao, Apple sign-in.
 * Order: Google → Kakao → Apple (iOS only)
 */

import { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, Platform, TextInput, KeyboardAvoidingView,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons, FontAwesome } from '@expo/vector-icons';
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
      if (provider === 'dev') {
        await signInWithEmail(devEmail.trim(), devPassword);
      } else {
        const fn = provider === 'google'
          ? signInWithGoogle
          : provider === 'kakao'
            ? signInWithKakao
            : signInWithApple;
        await fn();
      }
      // Navigate to tabs unconditionally; useAuthGuard reroutes first-run
      // users to /onboarding when the ONBOARDING_STORAGE_KEY flag is unset.
      router.replace('/(tabs)');
    } catch (err: unknown) {
      if (isCancelError(err)) return;
      setError(err instanceof Error ? err.message : t('auth.login.error'));
    } finally {
      setLoading(null);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      {/*
       * Wrap the login form in a KeyboardAvoidingView + ScrollView so that
       * the dev email/password TextInputs (and any future email login form)
       * remain visible above the software keyboard on iOS. Android uses
       * `softwareKeyboardLayoutMode="resize"` so behavior is a no-op there.
       * Sprint 14 TASK-1411.
       */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
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
              : (
                /*
                 * Row-layout button body: left-aligned brand icon + centred label.
                 * The icon is absolutely positioned so the text remains centred
                 * regardless of icon width — keeps all three buttons visually
                 * aligned with each other.
                 */
                <View style={styles.buttonRow}>
                  {/* Google "G" logo — FontAwesome bundles the official glyph */}
                  <FontAwesome
                    name="google"
                    size={20}
                    color="#4285F4"
                    style={styles.buttonIcon}
                  />
                  <Text style={[styles.buttonText, styles.googleText]}>{t('auth.login.google')}</Text>
                </View>
              )
            }
          </TouchableOpacity>

          {/*
            Kakao — iOS, Android and web. The custom Edge Function
            (`kakao-auth`) supports both deep-link and HTTPS return paths;
            authService.signInWithKakao routes the appropriate appReturn
            based on Platform.OS. On web the browser pops the Kakao
            consent page and bounces back to `${origin}/auth/callback`.
            For local web testing (`npm run web`) the LEAD must register
            `http://localhost:8081/auth/callback` as a redirect URI in
            the Kakao Developer Console.
          */}
          <TouchableOpacity
            style={[styles.button, styles.kakaoButton, isLoading && styles.disabled]}
            onPress={() => handleSignIn('kakao')}
            disabled={isLoading}
            accessibilityLabel="카카오로 로그인"
          >
            {loading === 'kakao'
              ? <ActivityIndicator color="#3A1D1D" />
              : (
                <View style={styles.buttonRow}>
                  <Ionicons
                    name="chatbubble"
                    size={20}
                    color="#3A1D1D"
                    style={styles.buttonIcon}
                  />
                  <Text style={[styles.buttonText, styles.kakaoText]}>{t('auth.login.kakao')}</Text>
                </View>
              )
            }
          </TouchableOpacity>

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
                : (
                  <View style={styles.buttonRow}>
                    {/* Apple logo — Ionicons ships the official glyph */}
                    <Ionicons
                      name="logo-apple"
                      size={22}
                      color="#FFFFFF"
                      style={styles.buttonIcon}
                    />
                    <Text style={[styles.buttonText, styles.appleText]}>{t('auth.login.apple')}</Text>
                  </View>
                )
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
      </ScrollView>
      </KeyboardAvoidingView>
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
  flex: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
  },
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
  /**
   * Row container for icon + label. Fills the parent button and centres the
   * label text. The icon is absolutely positioned via `buttonIcon` so it does
   * not shift the label's centre-of-mass — this keeps the three provider
   * buttons visually aligned with one another.
   */
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '100%',
  },
  /** Left-anchored brand icon inside a provider button. */
  buttonIcon: {
    position: 'absolute',
    left: spacing[4],
  },
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
