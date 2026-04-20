/**
 * Login screen — Google, Kakao, Apple sign-in.
 * Order: Google → Kakao → Apple (iOS only)
 */

import { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { light as colors } from '@/constants/colors';
import { spacing, radius, componentHeight } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import {
  signInWithGoogle,
  signInWithKakao,
  signInWithApple,
} from '@/services/authService';

type Provider = 'google' | 'kakao' | 'apple';

export default function LoginScreen() {
  const [loading, setLoading] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isLoading = loading !== null;

  async function handleSignIn(provider: Provider) {
    if (isLoading) return;
    setLoading(provider);
    setError(null);

    try {
      const fn = provider === 'google'
        ? signInWithGoogle
        : provider === 'kakao'
          ? signInWithKakao
          : signInWithApple;

      const result = await fn();
      router.replace(result.isNewUser ? '/auth/onboarding' : '/(tabs)');
    } catch (err: unknown) {
      if (isCancelError(err)) return;
      setError(err instanceof Error ? err.message : '로그인 중 오류가 발생했습니다.');
    } finally {
      setLoading(null);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>

        <View style={styles.hero}>
          <Text style={styles.logo}>SyncDay</Text>
          <Text style={styles.tagline}>함께하는 일정, AI가 챙겨드려요</Text>
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
              : <Text style={[styles.buttonText, styles.googleText]}>Google로 시작하기</Text>
            }
          </TouchableOpacity>

          {/* Kakao — iOS & Android */}
          <TouchableOpacity
            style={[styles.button, styles.kakaoButton, isLoading && styles.disabled]}
            onPress={() => handleSignIn('kakao')}
            disabled={isLoading}
            accessibilityLabel="카카오로 로그인"
          >
            {loading === 'kakao'
              ? <ActivityIndicator color="#3A1D1D" />
              : <Text style={[styles.buttonText, styles.kakaoText]}>카카오로 시작하기</Text>
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
                : <Text style={[styles.buttonText, styles.appleText]}>Apple로 시작하기</Text>
              }
            </TouchableOpacity>
          )}

        </View>

        {error !== null && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <Text style={styles.legal}>
          로그인하면 서비스 이용약관 및 개인정보처리방침에 동의하게 됩니다.
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

const styles = StyleSheet.create({
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
  errorBox: {
    marginTop: spacing[4], width: '100%',
    padding: spacing[3], borderRadius: radius.md,
    backgroundColor: colors.primaryLight,
  },
  errorText: { ...textStyles.bodySm, color: colors.error, textAlign: 'center' },
  legal: {
    ...textStyles.caption, color: colors.textTertiary,
    textAlign: 'center', marginTop: spacing[8], paddingHorizontal: spacing[4],
  },
});
