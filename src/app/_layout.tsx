/**
 * Root layout — Expo Router entry point.
 * Handles auth-based routing and session hydration.
 * Also handles deep links for Space invite codes: syncday://join/{code}
 *
 * TASK-403: Initializes push notifications after authentication.
 * Wires notification tap handler for in-app routing.
 *
 * TASK-602: Checks first-launch onboarding flag in AsyncStorage.
 * If @syncday/onboarding_done is absent, shows /onboarding before /auth/login.
 */

import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Linking from 'expo-linking';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuthStore } from '@/stores/authStore';
import { onAuthStateChange, getUserProfile } from '@/services/authService';
import {
  initializeNotifications,
  setupNotificationHandlers,
} from '@/services/notificationService';
import { ONBOARDING_STORAGE_KEY } from '@/app/onboarding/index';

// ─── Auth guard ───────────────────────────────────────────────────────────────

/**
 * Handles all routing based on auth state and onboarding completion.
 *
 * Routing priority:
 *  1. While auth is loading — do nothing (prevents redirect flash)
 *  2. Unauthenticated + onboarding not done → /onboarding
 *  3. Unauthenticated + onboarding done → /auth/login
 *  4. Authenticated + in auth group → /(tabs)
 */
function useAuthGuard() {
  const { isAuthenticated, isLoading } = useAuthStore();
  const segments = useSegments();
  const router = useRouter();

  /** null = still checking AsyncStorage; true/false = result */
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null);

  // Check onboarding completion once on mount
  useEffect(() => {
    AsyncStorage.getItem(ONBOARDING_STORAGE_KEY)
      .then((value) => setOnboardingDone(value !== null))
      .catch(() => setOnboardingDone(true)); // If read fails, skip onboarding
  }, []);

  useEffect(() => {
    // Wait for both auth hydration and AsyncStorage read to complete
    if (isLoading || onboardingDone === null) return;

    const inAuthGroup    = segments[0] === 'auth';
    const inOnboarding   = segments[0] === 'onboarding';

    if (isAuthenticated) {
      // Authenticated users should never be on auth or onboarding screens
      if (inAuthGroup || inOnboarding) {
        router.replace('/(tabs)');
      }
    } else {
      // Unauthenticated: show onboarding first if never seen, else login
      if (!onboardingDone && !inOnboarding) {
        router.replace('/onboarding');
      } else if (onboardingDone && !inAuthGroup) {
        router.replace('/auth/login');
      }
    }
  }, [isAuthenticated, isLoading, onboardingDone, segments, router]);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function RootLayout() {
  const { setUser, setLoading, isAuthenticated } = useAuthStore();
  const router = useRouter();

  useAuthGuard();

  useEffect(() => {
    // Subscribe to auth state — fires immediately with current session.
    // isLoading stays true until first callback resolves, preventing redirect flash.
    const unsubscribe = onAuthStateChange(async (session) => {
      if (session) {
        const userRow = await getUserProfile(session.userId);
        if (userRow) {
          setUser(userRow); // also sets isLoading = false
        } else {
          // Profile not found (shouldn't happen with handle_new_user trigger)
          setLoading(false);
        }
      } else {
        setUser(null); // also sets isLoading = false
      }
    });

    return unsubscribe;
  }, [setUser, setLoading]);

  // TASK-403: Initialize push notifications after user authenticates.
  // Non-critical: errors are logged but do not crash the app.
  useEffect(() => {
    if (!isAuthenticated) return;

    // Request permission + register Expo push token
    initializeNotifications().catch(console.error);

    // Wire notification tap → in-app routing
    // Returns a cleanup function to remove listeners on unmount
    const cleanup = setupNotificationHandlers(
      // onNotificationReceived: foreground display handled by the module-level handler
      (_notification) => { /* no-op: foreground display is automatic */ },
      // onNotificationTapped: route to the relevant screen
      (notification) => {
        const data = notification.data ?? {};
        // Route based on notification type carried in the data payload
        if (data['type'] === 'event' && data['eventId']) {
          router.push(`/event/${String(data['eventId'])}`);
        } else if (data['type'] === 'space_invite' && data['inviteCode']) {
          router.push(`/space/join?code=${encodeURIComponent(String(data['inviteCode']))}`);
        } else if (data['type'] === 'reminder' || data['type'] === 'event_reminder') {
          // Reminder taps open the calendar tab
          router.push('/(tabs)/calendar');
        }
      },
    );

    return cleanup;
  }, [isAuthenticated, router]);

  useEffect(() => {
    // Handle deep links for Space invite codes.
    //
    // Supported patterns:
    //  - syncday://space/join/<code>  (new canonical form)
    //  - syncday://join/<code>        (legacy fallback)
    //  - https://syncday.app/space/join/<code>  (universal link)
    //
    // All patterns navigate to /space/join/<code> for the preview screen.
    const handleDeepLink = (event: { url: string }) => {
      const { url } = event;
      try {
        const parsed = Linking.parse(url);

        // Pattern 1: syncday://space/join/<code>
        // parsed.hostname = 'space', parsed.path = '/join/<code>'
        if (parsed.hostname === 'space' && parsed.path?.startsWith('/join/')) {
          const code = parsed.path.replace(/^\/join\//, '');
          if (code) {
            router.push(`/space/join/${encodeURIComponent(code)}`);
            return;
          }
        }

        // Pattern 2 (legacy): syncday://join/<code>
        // parsed.hostname = 'join', parsed.path = '/<code>'
        if (parsed.hostname === 'join' && parsed.path) {
          const code = parsed.path.replace(/^\//, '');
          if (code) {
            router.push(`/space/join/${encodeURIComponent(code)}`);
            return;
          }
        }

        // Pattern 3: https://syncday.app/space/join/<code>
        // parsed.path = '/space/join/<code>'
        if (parsed.path?.includes('/space/join/')) {
          const parts = parsed.path.split('/space/join/');
          const code = parts[1]?.split('/')[0];
          if (code) {
            router.push(`/space/join/${encodeURIComponent(code)}`);
          }
        }
      } catch {
        // Malformed URL — ignore
      }
    };

    // Custom scheme deep links (syncday://) are only valid on native platforms.
    // On web, Expo Router handles path-based routing automatically.
    if (Platform.OS !== 'web') {
      // Handle deep links when app is already open
      const subscription = Linking.addEventListener('url', handleDeepLink);

      // Handle deep link that launched the app (cold start)
      Linking.getInitialURL().then((url) => {
        if (url) handleDeepLink({ url });
      }).catch(() => undefined);

      return () => subscription.remove();
    }
    return undefined;
  }, [router]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="onboarding/index" />
          <Stack.Screen name="auth/login" />
          <Stack.Screen name="auth/callback" />
          <Stack.Screen name="auth/onboarding" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="event/[id]" options={{ presentation: 'modal' }} />
          <Stack.Screen name="event/create" options={{ presentation: 'modal' }} />
          <Stack.Screen name="event/edit/[id]" options={{ presentation: 'modal' }} />
          <Stack.Screen name="space/[id]" options={{ presentation: 'modal' }} />
          <Stack.Screen name="space/create" options={{ presentation: 'modal' }} />
          <Stack.Screen name="space/join" options={{ presentation: 'modal' }} />
          <Stack.Screen name="space/join/[code]" options={{ presentation: 'modal' }} />
          <Stack.Screen name="note/[id]" options={{ presentation: 'modal' }} />
          <Stack.Screen name="note/new" options={{ presentation: 'modal' }} />
          <Stack.Screen name="settings/categories" options={{ presentation: 'modal' }} />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
