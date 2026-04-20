/**
 * Root layout — Expo Router entry point.
 * Handles auth-based routing and session hydration.
 * Also handles deep links for Space invite codes: syncday://join/{code}
 *
 * TASK-403: Initializes push notifications after authentication.
 * Wires notification tap handler for in-app routing.
 */

import { useEffect } from 'react';
import { Platform } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Linking from 'expo-linking';
import { useAuthStore } from '@/stores/authStore';
import { onAuthStateChange, getUserProfile } from '@/services/authService';
import {
  initializeNotifications,
  setupNotificationHandlers,
} from '@/services/notificationService';

// ─── Auth guard ───────────────────────────────────────────────────────────────

function useAuthGuard() {
  const { isAuthenticated, isLoading } = useAuthStore();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === 'auth';

    if (!isAuthenticated && !inAuthGroup) {
      router.replace('/auth/login');
    } else if (isAuthenticated && inAuthGroup) {
      router.replace('/(tabs)');
    }
  }, [isAuthenticated, isLoading, segments, router]);
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
    // Pattern: syncday://join/{code} → navigate to /space/join?code={code}
    const handleDeepLink = (event: { url: string }) => {
      const { url } = event;
      try {
        const parsed = Linking.parse(url);
        // Match syncday://join/{code} where host='join' and path='/{code}'
        if (parsed.hostname === 'join' && parsed.path) {
          const code = parsed.path.replace(/^\//, '');
          if (code) {
            router.push(`/space/join?code=${encodeURIComponent(code)}`);
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
          <Stack.Screen name="note/[id]" options={{ presentation: 'modal' }} />
          <Stack.Screen name="note/new" options={{ presentation: 'modal' }} />
          <Stack.Screen name="settings/categories" options={{ presentation: 'modal' }} />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
