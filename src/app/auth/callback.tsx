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
 * 2026-10-13 (보안 3-B5) — URL 에 실린 자격은 «이 탭이 시작한 로그인»의 것만 받는다:
 *  - 카카오: ?token_hash=…&n=… — n 이 로그인 시작 때 이 탭에 둔 확인값과 같을 때만(completeKakaoWebSignIn).
 *    예전의 ?email=…&password=… 은 더 받지 않는다(누가 만든 링크든 그 계정으로 로그인됐다).
 *  - PKCE ?code= 는 그대로 — 교환에 이 브라우저의 code_verifier 가 필요해 원래 시작한 쪽에서만 성공한다.
 *  - #access_token 수동 setSession 은 제거 — 우리 OAuth 는 전부 PKCE 이고, supabase-js 도 PKCE 모드에서는
 *    해시 토큰을 거절한다. 이 분기만이 남이 만든 토큰을 그대로 받아들이던 곳이었다.
 *
 * Implementation: TASK-204 (Sprint 2)
 *
 * NOTE for DEV (TASK-204):
 * - Use `supabase.auth.exchangeCodeForSession(url)` for PKCE code flow
 * - (2026-10-13 제거) implicit flow 의 setSession — 위 «보안 3-B5» 참고
 * - After setting the session, redirect into the app:
 *   - 2026-08-28 UX 단순화로 신규/기존 구분 없이 '/(tabs)' 로 보낸다.
 *     (이전에는 신규 사용자만 '/auth/onboarding' 닉네임 입력을 거쳤다)
 * - Show a loading spinner while processing; show error if exchange fails
 */

import { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useColors } from '@/hooks/useColors';
import { textStyles } from '@/constants/typography';
import { supabase } from '@/lib/supabase';
import { completeKakaoWebSignIn } from '@/services/authService';
import { Text } from '@/components/common/AppText';

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCallback() {
    // Retrieve the current URL for code/token extraction
    type WebLocation = typeof globalThis & {
      location?: { href?: string };
      history?: { replaceState: (state: unknown, title: string, url: string) => void };
    };
    const href = (globalThis as WebLocation).location?.href ?? '';

    if (!href) {
      // Native: 이 화면은 정상 흐름에서 쓰이지 않는다(OAuth 는 WebBrowser 가 처리).
      // 그런데 통합 로그인 중 Kakao WebBrowser 의 synclink://auth/callback 리다이렉트가
      // Expo Router 로 새어 들어와 여기 도달하면, 유효 세션이 있는데도 로그인 화면으로
      // 보내져 "로그아웃/검은화면"처럼 보였다(2026-06-06 실측). 세션이 있으면 탭으로,
      // 없을 때만 로그인으로 보낸다.
      const { data: { session } } = await supabase.auth.getSession();
      router.replace(session ? '/(tabs)' : '/auth/login');
      return;
    }

    // Parse the URL once and try each known flow in priority order:
    //   1. ?error=...                   → kakao-auth Edge Function reported failure
    //   2. ?token_hash=...&n=...        → kakao-auth 1회용 토큰 (web Kakao path, 2026-10-13)
    //   3. ?code=...                    → PKCE (Google / Apple via Supabase OAuth)
    let errorParam:     string | null = null;
    let tokenHashParam: string | null = null;
    let nonceParam:     string | null = null;
    let code:           string | null = null;

    try {
      const questionIdx = href.indexOf('?');
      const hashIdx     = href.indexOf('#');
      if (questionIdx !== -1) {
        const query = href.slice(questionIdx + 1, hashIdx > questionIdx ? hashIdx : undefined);
        const params = new URLSearchParams(query);
        errorParam     = params.get('error');
        tokenHashParam = params.get('token_hash');
        nonceParam     = params.get('n');
        code           = params.get('code');
      }
    } catch {
      throw new Error(t('auth.callback.parse_error'));
    }

    if (errorParam) {
      throw new Error(decodeURIComponent(errorParam));
    }

    if (tokenHashParam) {
      // Web Kakao: 이 탭이 시작한 로그인인지 확인값(n)을 대조한 뒤 1회용 토큰으로 세션 생성.
      // 성공·실패와 무관하게 URL 은 지운다(1회용이라 다시 쓸 수 없지만 기록에 남길 이유도 없다).
      try {
        await completeKakaoWebSignIn(tokenHashParam, nonceParam);
      } finally {
        const scrub = (globalThis as WebLocation).history?.replaceState;
        if (scrub) {
          try { scrub.call((globalThis as WebLocation).history, {}, '', '/auth/callback'); } catch { /* non-fatal */ }
        }
      }
    } else if (code) {
      // PKCE: Google / Apple via Supabase OAuth.
      // ⚠️ supabase 의 detectSessionInUrl(true) 이 페이지 로드 시 같은 ?code= 를
      // 자동으로 먼저 교환할 수 있다. PKCE code 는 1회용이라 자동 교환이 먼저
      // 소비하면 이 수동 교환은 "PKCE code verifier not found" 로 실패한다(race).
      // 그 경우 이미 세션이 생겼는지 확인해, 있으면 성공으로 간주한다
      // (자동/수동 중 하나만 성공하면 로그인 완료).
      const { error } = await supabase.auth.exchangeCodeForSession(href);
      if (error) {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw error;
      }
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

    // 2026-08-28 UX 단순화 — 신규 사용자도 곧장 앱으로 보낸다.
    //
    // 이전에는 첫 로그인 시 닉네임 입력 화면(/auth/onboarding)을 한 번 더 거쳤다.
    // 실사용자 25명 중 20명(80%)이 가입한 날 이후로 다시 오지 않았고, 가입 직후의
    // 추가 입력은 그 마찰의 후보 중 하나다. 닉네임은 "나" 탭에서 언제든 바꿀 수
    // 있으므로(my.tsx 의 닉네임 편집) **기능이 사라지는 것은 아니다**.
    //
    // 🔴 다만 이탈 지점을 기록하고 있지 않아 사람들이 실제로 이 화면에서
    //    떠났는지는 모른다 — 검증 계획의 1번이 "이탈 지점 로깅 먼저"인 이유다.
    //    되돌리려면 아래 한 줄을 이전의 삼항 분기로 돌리면 된다:
    //    router.replace(isNewUser ? '/auth/onboarding' : '/(tabs)');
    //    (화면 `auth/onboarding.tsx` 는 지우지 않고 그대로 둔다)
    router.replace('/(tabs)');
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
