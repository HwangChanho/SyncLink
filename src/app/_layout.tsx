/**
 * Root layout — Expo Router entry point.
 * Handles auth-based routing and session hydration.
 * Also handles deep links for Space invite codes: synclink://join/{code}
 *
 * TASK-403: Initializes push notifications after authentication.
 * Wires notification tap handler for in-app routing.
 *
 * TASK-602: Checks first-launch onboarding flag in AsyncStorage.
 * If @synclink/onboarding_done is absent, shows /onboarding before /auth/login.
 */

import '@/lib/i18n'; // initialize i18n before any component renders
import { useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus, Platform, View, StyleSheet, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Linking from 'expo-linking';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/stores/authStore';
import { onAuthStateChange, getUserProfile } from '@/services/authService';
import {
  initializeNotifications,
  setupNotificationHandlers,
} from '@/services/notificationService';
import { initializePurchases, checkProStatus } from '@/services/purchaseService';
import { useSubscriptionStore } from '@/stores/subscriptionStore';
import { useAppLockStore } from '@/stores/appLockStore';
import { authenticate } from '@/services/appLockService';
import { useColors } from '@/hooks/useColors';
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

  // Re-check AsyncStorage whenever segments change (e.g. after onboarding completes
  // and navigates away). Skip if already true to avoid redundant reads.
  useEffect(() => {
    if (onboardingDone) return;
    AsyncStorage.getItem(ONBOARDING_STORAGE_KEY)
      .then((value) => setOnboardingDone(value !== null))
      .catch(() => setOnboardingDone(true)); // If read fails, skip onboarding
  }, [segments, onboardingDone]);

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

/**
 * Lock screen overlay — shown on top of all content when app lock is active.
 * Uses the current theme's colors and i18n translations.
 *
 * @param onUnlock - Called after successful biometric authentication
 */
function LockOverlay({ onUnlock }: { onUnlock: () => void }) {
  const { t } = useTranslation();
  const colors = useColors();
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  /** Prompt biometric auth and call onUnlock on success. */
  const handleAuthenticate = async () => {
    setIsAuthenticating(true);
    try {
      const result = await authenticate(t('settings.authenticate'));
      if (result.success) {
        onUnlock();
      }
    } finally {
      setIsAuthenticating(false);
    }
  };

  return (
    <View style={[lockStyles.overlay, { backgroundColor: colors.background }]}>
      <Text style={[lockStyles.title, { color: colors.textPrimary }]}>SyncLink</Text>
      <Text style={[lockStyles.subtitle, { color: colors.textSecondary }]}>
        {t('settings.app_lock')}
      </Text>
      <TouchableOpacity
        style={[lockStyles.button, { backgroundColor: colors.primary }]}
        onPress={() => void handleAuthenticate()}
        disabled={isAuthenticating}
        activeOpacity={0.8}
      >
        {isAuthenticating ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text style={lockStyles.buttonText}>{t('settings.authenticate')}</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const lockStyles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    zIndex: 9999,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    marginBottom: 16,
  },
  button: {
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
    minWidth: 180,
    alignItems: 'center',
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default function RootLayout() {
  const { setUser, setLoading, isAuthenticated } = useAuthStore();
  const setPlan = useSubscriptionStore((s) => s.setPlan);
  const router = useRouter();

  // App lock state
  const { isLocked, isEnabled, lock, unlock, hydrate } = useAppLockStore();
  /** Track previous AppState to detect background→foreground transitions. */
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  useAuthGuard();

  // TASK-900: Hydrate app lock setting from AsyncStorage on startup.
  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // TASK-900: Lock the app when it moves to the background and comes back to foreground.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      const prev = appStateRef.current;
      appStateRef.current = nextState;

      // background/inactive → active: lock if enabled
      if (
        (prev === 'background' || prev === 'inactive') &&
        nextState === 'active' &&
        isEnabled
      ) {
        lock();
      }
    });

    return () => subscription.remove();
  }, [isEnabled, lock]);

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

  // TASK-800: Initialize RevenueCat and sync Pro status after user authenticates.
  // Non-critical: errors are logged but do not crash the app.
  // Must run after auth so we have the user ID to pass as appUserID to RevenueCat.
  useEffect(() => {
    const authStore = useAuthStore.getState();
    const userId = authStore.user?.id;
    if (!isAuthenticated || !userId) return;

    initializePurchases(userId)
      .then(() => checkProStatus())
      .then((isPro) => {
        // Sync local plan state with RevenueCat's server-side entitlement
        if (isPro) setPlan('pro');
      })
      .catch(console.error); // Non-fatal — app works without purchase sync
  }, [isAuthenticated, setPlan]);

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
    //  - synclink://space/join/<code>  (new canonical form)
    //  - synclink://join/<code>        (legacy fallback)
    //  - https://synclink.app/space/join/<code>  (universal link)
    //
    // All patterns navigate to /space/join/<code> for the preview screen.
    const handleDeepLink = (event: { url: string }) => {
      const { url } = event;
      try {
        const parsed = Linking.parse(url);

        // Pattern 1: synclink://space/join/<code>
        // parsed.hostname = 'space', parsed.path = '/join/<code>'
        if (parsed.hostname === 'space' && parsed.path?.startsWith('/join/')) {
          const code = parsed.path.replace(/^\/join\//, '');
          if (code) {
            router.push(`/space/join/${encodeURIComponent(code)}`);
            return;
          }
        }

        // Pattern 2 (legacy): synclink://join/<code>
        // parsed.hostname = 'join', parsed.path = '/<code>'
        if (parsed.hostname === 'join' && parsed.path) {
          const code = parsed.path.replace(/^\//, '');
          if (code) {
            router.push(`/space/join/${encodeURIComponent(code)}`);
            return;
          }
        }

        // Pattern 3: https://synclink.app/space/join/<code>
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

    // Custom scheme deep links (synclink://) are only valid on native platforms.
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
        {/* TASK-900: App lock overlay — rendered above all content when locked */}
        {isLocked && <LockOverlay onUnlock={unlock} />}
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
          <Stack.Screen name="settings/app-lock" options={{ presentation: 'modal' }} />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
