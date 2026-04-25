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
import { useTranslation } from 'react-i18next';
import { useColors } from '@/hooks/useColors';
import { textStyles } from '@/constants/typography';
import { supabase } from '@/lib/supabase';

export default function AuthCallbackScreen() {
  // Resolve active theme colors for dark mode support (TASK-700)
  const { t } = useTranslation();
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
      setError(err instanceof Error ? err.message : t('auth.callback.processing'));
    });
  }, []);

  async function handleCallback() {
    // Retrieve the current URL for code/token extraction
    type WebLocation = typeof globalThis & {
      location?: { href?: string };
      history?: { replaceState: (state: unknown, title: string, url: string) => void };
    };
    const href = (globalThis as WebLocation).location?.href ?? '';

    if (!href) {
      router.replace('/auth/login');
      return;
    }

    // Parse the URL once and try each known flow in priority order:
    //   1. ?error=...                   → kakao-auth Edge Function reported failure
    //   2. ?email=...&password=...      → kakao-auth derived credentials (web Kakao path)
    //   3. ?code=...                    → PKCE (Google / Apple via Supabase OAuth)
    //   4. #access_token=...&refresh_token=...  → implicit (legacy)
    let errorParam:    string | null = null;
    let emailParam:    string | null = null;
    let passwordParam: string | null = null;
    let code:          string | null = null;
    let accessToken:   string | null = null;
    let refreshToken:  string | null = null;

    try {
      const questionIdx = href.indexOf('?');
      const hashIdx     = href.indexOf('#');
      if (questionIdx !== -1) {
        const query = href.slice(questionIdx + 1, hashIdx > questionIdx ? hashIdx : undefined);
        const params = new URLSearchParams(query);
        errorParam    = params.get('error');
        emailParam    = params.get('email');
        passwordParam = params.get('password');
        code          = params.get('code');
      }
      if (hashIdx !== -1) {
        const fragment = href.slice(hashIdx + 1);
        const params = new URLSearchParams(fragment);
        accessToken  = params.get('access_token');
        refreshToken = params.get('refresh_token');
      }
    } catch {
      throw new Error(t('auth.callback.parse_error'));
    }

    if (errorParam) {
      throw new Error(decodeURIComponent(errorParam));
    }

    if (emailParam && passwordParam) {
      // Web Kakao: kakao-auth Edge Function HTML-redirected here with
      // derived credentials. Sign in immediately, then scrub the URL so
      // the password isn't left in browser history.
      const { error } = await supabase.auth.signInWithPassword({
        email: emailParam,
        password: passwordParam,
      });
      if (error) throw error;
      const replace = (globalThis as WebLocation).history?.replaceState;
      if (replace) {
        try { replace.call((globalThis as WebLocation).history, {}, '', '/auth/callback'); } catch { /* non-fatal */ }
      }
    } else if (code) {
      // PKCE: Google / Apple via Supabase OAuth
      const { error } = await supabase.auth.exchangeCodeForSession(href);
      if (error) throw error;
    } else if (accessToken && refreshToken) {
      // Implicit
      const { error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (error) throw error;
    } else {
      // No code or tokens found — session may already exist or flow failed
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error(t('auth.callback.not_found'));
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
          {t('common.retry')}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={styles.label}>{t('common.loading')}</Text>
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
