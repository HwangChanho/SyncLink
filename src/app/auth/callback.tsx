/**
 * Web OAuth callback route — handles redirect after Supabase OAuth flow.
 *
 * On web, after Google/Kakao/Apple OAuth, Supabase redirects the browser to:
 *   {origin}/auth/callback#access_token=...&refresh_token=...
 *
 * OR (PKCE flow):
 *   {origin}/auth/callback?code=...
 *
 * This screen detects the URL params and exchanges the code/fragment for
 * a live Supabase session, then navigates to the appropriate next screen.
 *
 * On native (iOS/Android), this route is never used — deep links are handled
 * by Kakao's expo-web-browser + exchangeCodeForSession in authService.ts.
 *
 * Implementation: TASK-204 (Sprint 2)
 *
 * NOTE for DEV (TASK-204):
 * - Use `supabase.auth.exchangeCodeForSession(url)` for PKCE code flow
 * - Use `supabase.auth.setSession({ access_token, refresh_token })` for implicit flow
 * - After setting the session, check `isNewUser` and redirect accordingly:
 *   - New user  → '/auth/onboarding'
 *   - Returning → '/(tabs)'
 * - Show a loading spinner while processing; show error if exchange fails
 */

import { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { textStyles } from '@/constants/typography';
import { supabase } from '@/lib/supabase';

export default function AuthCallbackScreen() {
  // Resolve active theme colors for dark mode support (TASK-700)
  const colors = useColors();
  const styles = makeStyles(colors);

  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // STUB: DEV implements full logic in TASK-204
    // Placeholder: just redirect to tabs after Supabase auto-parses the URL fragment
    // Supabase JS client automatically calls onAuthStateChange when it detects
    // a token in the URL hash on web — authStore listener will handle navigation.
    // DEV should handle the ?code= (PKCE) case explicitly here.
    handleCallback().catch((err) => {
      setError(err instanceof Error ? err.message : '인증 처리 중 오류가 발생했습니다.');
    });
  }, []);

  async function handleCallback() {
    // Retrieve the current URL for code/token extraction
    type WebLocation = typeof globalThis & { location?: { href?: string } };
    const href = (globalThis as WebLocation).location?.href ?? '';

    if (!href) {
      // Not on web or no URL — redirect to login
      router.replace('/auth/login');
      return;
    }

    // Parse URL to distinguish PKCE (code param) vs implicit (hash fragment) flow
    let code: string | null = null;
    let accessToken: string | null = null;
    let refreshToken: string | null = null;

    try {
      // URLSearchParams is available in ESNext + React Native polyfill
      const questionIdx = href.indexOf('?');
      const hashIdx = href.indexOf('#');

      if (questionIdx !== -1) {
        const query = href.slice(questionIdx + 1, hashIdx > questionIdx ? hashIdx : undefined);
        const params = new URLSearchParams(query);
        code = params.get('code');
      }

      if (hashIdx !== -1) {
        const fragment = href.slice(hashIdx + 1);
        const params = new URLSearchParams(fragment);
        accessToken = params.get('access_token');
        refreshToken = params.get('refresh_token');
      }
    } catch {
      // URL parsing failed
      throw new Error('콜백 URL을 파싱하지 못했습니다.');
    }

    if (code) {
      // PKCE flow: exchange authorization code for session
      const { error } = await supabase.auth.exchangeCodeForSession(href);
      if (error) throw error;
    } else if (accessToken && refreshToken) {
      // Implicit flow: set session directly from tokens in hash fragment
      const { error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (error) throw error;
    } else {
      // No code or tokens found — session may already exist or flow failed
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('인증 정보를 찾지 못했습니다. 다시 로그인해 주세요.');
      }
    }

    // Retrieve the established session to determine routing
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      router.replace('/auth/login');
      return;
    }

    // Detect first-time sign-in (same 30-second window used in authService.ts)
    const isNewUser = Date.now() - new Date(session.user.created_at).getTime() < 30_000;
    router.replace(isNewUser ? '/auth/onboarding' : '/(tabs)');
  }

  if (error) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>{error}</Text>
        <Text
          style={styles.retryLink}
          onPress={() => router.replace('/auth/login')}
        >
          다시 로그인하기
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={styles.label}>로그인 처리 중...</Text>
    </View>
  );
}

/**
 * Dynamic styles factory — receives current theme color tokens.
 * Must be called inside the component to react to theme changes.
 *
 * @param colors - Active theme color tokens from useColors()
 */
function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.background,
      gap: 12,
    },
    label: {
      ...textStyles.bodySm,
      color: colors.textSecondary,
    },
    errorText: {
      ...textStyles.bodySm,
      color: colors.error,
      textAlign: 'center',
      paddingHorizontal: 24,
    },
    retryLink: {
      ...textStyles.label,
      color: colors.primary,
    },
  });
}
