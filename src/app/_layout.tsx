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

import '@/lib/i18n'; // initialize i18n before any component renders (synchronous default locale)
import { initSentry } from '@/lib/sentry';
import { LogBox } from 'react-native';
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
import { initI18n } from '@/lib/i18n';
import {
  initializeNotifications,
  setupNotificationHandlers,
} from '@/services/notificationService';
import { initializePurchases, checkProStatus } from '@/services/purchaseService';
import { supabase } from '@/lib/supabase';
import { useSubscriptionStore } from '@/stores/subscriptionStore';
import { useAppLockStore } from '@/stores/appLockStore';
import { authenticate, isBiometricAvailable } from '@/services/appLockService';
import { verifyPin } from '@/services/pinLockService';
import { useIdleLogout } from '@/hooks/useIdleLogout';
import { useWebPush } from '@/hooks/useWebPush';
import { useWidgetSync } from '@/hooks/useWidgetSync';
import { PinPad } from '@/components/common/PinPad';
import { OfflineBanner } from '@/components/common/OfflineBanner';
import { AppSplash } from '@/components/common/AppSplash';
// Sprint 14 TASK-1402/1406 — AdMob SDK initialization after ATT consent.
import { initAdMob } from '@/services/adService';
import { requestTrackingPermissionsAsync } from 'expo-tracking-transparency';
import { useColors } from '@/hooks/useColors';
import { logError } from '@/lib/errorLogger';
import { ONBOARDING_STORAGE_KEY } from '@/app/onboarding/index';
import { useFonts } from 'expo-font';
import { Ionicons, FontAwesome } from '@expo/vector-icons';

// E2E / DEV builds: suppress RevenueCat SDK configuration warnings that appear as
// Console Error overlays and block Maestro test interactions.
// These warnings are expected in dev environments without a real RC project setup.
if (__DEV__) {
  LogBox.ignoreLogs([
    'RevenueCat',
    '[RevenueCat]',
    'RevenueCat SDK',
    'RNPurchases',
    'NSURLSession',
    'VirtualizedList',
    'ReactImageView',
  ]);
}
initSentry();

// ─── Auth guard ───────────────────────────────────────────────────────────────

/**
 * Handles all routing based on auth state and onboarding completion.
 *
 * Routing priority:
 *  1. While auth is loading — do nothing (prevents redirect flash)
 *  2. Unauthenticated → /auth/login  (onboarding is gated behind auth)
 *  3. Authenticated + onboarding not done → /onboarding
 *  4. Authenticated + in auth/onboarding group (onboarding done) → /(tabs)
 *
 * Onboarding runs AFTER login so that account deletion (which signs the user
 * out but keeps the onboarding flag) cannot push the first-run onboarding
 * flow in front of the login screen.
 */
/**
 * Auth-routing guard.
 *
 * Returns `routingReady` so the root layout can hide the Stack behind a
 * splash until the auth + onboarding state has been resolved AND the
 * router has arrived at the correct route. Without this gate the user
 * briefly sees the default route (e.g. Home) before the redirect to
 * /auth/login lands. Sprint 19 fix.
 */
function useAuthGuard(): { routingReady: boolean } {
  const { isAuthenticated, isLoading } = useAuthStore();
  const segments = useSegments();
  const router = useRouter();

  /** null = still checking AsyncStorage; true/false = result */
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null);

  /** Prevent duplicate replaces to the same target during re-renders. */
  const lastReplacedRef = useRef<string | null>(null);

  /**
   * Tracks whether the user was on the onboarding screen in the previous render.
   * Used to detect onboarding→other navigation transitions so we can re-read
   * AsyncStorage fresh (fixes stale onboardingDone after E2E clearState + skip).
   */
  const prevInOnboardingRef = useRef(false);

  // Read onboarding flag ONCE at mount. Re-running on segment change caused
  // redundant AsyncStorage reads which fed back into the routing effect below.
  useEffect(() => {
    AsyncStorage.getItem(ONBOARDING_STORAGE_KEY)
      .then((value) => setOnboardingDone(value !== null))
      .catch(() => setOnboardingDone(true));
  }, []);

  /**
   * Re-read the onboarding flag from AsyncStorage whenever the user leaves
   * the onboarding screen while authenticated.
   *
   * Background: useAuthGuard reads AsyncStorage only once at mount (empty deps).
   * After E2E clearState the key is absent → onboardingDone=false.  The guard
   * correctly routes to /onboarding.  Once the user taps "skip", onboarding
   * writes the key and calls router.replace('/auth/login').  But the guard's
   * in-memory onboardingDone is still false (stale), so the routing logic
   * re-targets /onboarding and lastReplacedRef blocks the redirect, leaving
   * the user stuck on /auth/login with routingReady=false → AppSplash forever.
   *
   * Fix: detect the onboarding→other transition and do a fresh AsyncStorage
   * read so the guard picks up the newly-written key.
   */
  useEffect(() => {
    const inOnboardingNow = segments[0] === 'onboarding';
    const justLeftOnboarding = prevInOnboardingRef.current && !inOnboardingNow;
    prevInOnboardingRef.current = inOnboardingNow;

    if (justLeftOnboarding && isAuthenticated) {
      // Clear the de-duplicate guard so the routing effect can redirect again
      // once the fresh AsyncStorage value comes back.
      lastReplacedRef.current = null;
      AsyncStorage.getItem(ONBOARDING_STORAGE_KEY)
        .then((value) => setOnboardingDone(value !== null))
        .catch(() => setOnboardingDone(true));
    }
  }, [segments, isAuthenticated]);

  useEffect(() => {
    // Wait for both auth hydration and AsyncStorage read to complete
    if (isLoading || onboardingDone === null) return;

    const inAuthGroup    = segments[0] === 'auth';
    const inOnboarding   = segments[0] === 'onboarding';

    // Compute the target path without immediately calling replace()
    let target: string | null = null;
    if (isAuthenticated) {
      // Post-login: new users must see onboarding before /(tabs)
      if (!onboardingDone && !inOnboarding) target = '/onboarding';
      else if (onboardingDone && (inAuthGroup || inOnboarding)) target = '/(tabs)';
    } else {
      // Unauthenticated: always send to login. Onboarding never appears
      // before auth (avoids re-running onboarding after account deletion).
      if (!inAuthGroup) target = '/auth/login';
    }

    // Guard: skip if we already replaced to the same target in the previous render.
    // This prevents a replace() -> segments change -> re-run -> replace() loop
    // that caused login/home screens to be pushed twice.
    if (target && lastReplacedRef.current !== target) {
      lastReplacedRef.current = target;
      router.replace(target as '/(tabs)' | '/auth/login' | '/onboarding');
    }
  }, [isAuthenticated, isLoading, onboardingDone, segments, router]);

  // routingReady = (a) auth + onboarding hydrated AND (b) the current route
  // already matches what the guard wants. The second check handles the
  // first-render flash where Stack would otherwise paint the default
  // /(tabs) screen for an unauthenticated user before replace() lands.
  // Cast to a generic readonly string array so we can safely test for
  // length === 0 (the empty-segments first-paint state). expo-router's
  // tuple type doesn't include the empty case but it does occur at runtime.
  const segs = segments as readonly string[];
  const hydrated = !isLoading && onboardingDone !== null;
  const inAuthGroup  = segs[0] === 'auth';
  const inOnboarding = segs[0] === 'onboarding';
  const inTabs       = segs[0] === '(tabs)' || segs.length === 0;
  let routedCorrectly = false;
  if (hydrated) {
    if (isAuthenticated) {
      routedCorrectly = onboardingDone ? !inAuthGroup && !inOnboarding : inOnboarding;
    } else {
      routedCorrectly = inAuthGroup;
    }
    // Empty segments (= "/") on web first-paint counts as wrong unless
    // the user is authenticated AND has finished onboarding.
    if (segs.length === 0 && !(isAuthenticated && onboardingDone)) {
      routedCorrectly = false;
    }
    // Modal routes (segs[0] === 'event' / 'space' / etc.) are always OK
    // when authenticated — they sit on top of (tabs) and aren't part of the
    // routing decision tree above.
    if (isAuthenticated && onboardingDone && !inAuthGroup && !inOnboarding && !inTabs) {
      routedCorrectly = true;
    }
  }
  return { routingReady: hydrated && routedCorrectly };
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Lock screen overlay — shown on top of all content when app lock is active.
 * Uses the current theme's colors and i18n translations.
 *
 * Sprint 15 TASK-1510: supports both biometric auth and 4-digit PIN. The
 * overlay picks a default mode based on what the user has enabled:
 *   - biometrics only  → prompts Face ID / Touch ID immediately
 *   - PIN only         → shows the PIN keypad
 *   - both enabled     → prompts biometrics first, offers "Use passcode"
 *                        to fall back to the PIN keypad on failure
 *
 * @param onUnlock - Called after successful authentication
 */
function LockOverlay({ onUnlock }: { onUnlock: () => void }) {
  const { t } = useTranslation();
  const colors = useColors();
  const { isEnabled: bioEnabled, pinEnabled } = useAppLockStore();

  const [isAuthenticating, setIsAuthenticating] = useState(false);
  /** True while showing the PIN keypad (either by choice or by fallback). */
  const [showPinPad,       setShowPinPad]       = useState(false);
  /** Tracks whether biometrics is actually usable on this device. */
  const [bioAvailable,     setBioAvailable]     = useState<boolean | null>(null);
  /** PIN error line. */
  const [pinError,         setPinError]         = useState<string | null>(null);
  /** Counter used to reset the PinPad's in-progress digits after an error. */
  const [pinResetKey,      setPinResetKey]      = useState(0);

  // Discover biometric availability once on mount; decide the initial mode.
  useEffect(() => {
    let cancelled = false;
    isBiometricAvailable().then((avail) => {
      if (cancelled) return;
      setBioAvailable(avail);
      // If biometrics isn't possible (device or disabled), jump straight to PIN.
      if (pinEnabled && (!bioEnabled || !avail)) {
        setShowPinPad(true);
      }
    });
    return () => { cancelled = true; };
  }, [bioEnabled, pinEnabled]);

  /** Prompt biometric auth; on failure, surface the PIN fallback if available. */
  const handleAuthenticate = async () => {
    setIsAuthenticating(true);
    try {
      const result = await authenticate(t('settings.authenticate'));
      if (result.success) {
        onUnlock();
      } else if (pinEnabled) {
        // Seamless fallback — most users won't know biometrics failed, they
        // just see the keypad appear instead of the unlock button.
        setShowPinPad(true);
      }
    } finally {
      setIsAuthenticating(false);
    }
  };

  /** Verify the 4-digit PIN and unlock on match. */
  const handlePinComplete = async (pin: string) => {
    const ok = await verifyPin(pin);
    if (ok) {
      onUnlock();
    } else {
      setPinError(t('pin_lock.incorrect'));
      setPinResetKey((k) => k + 1);
    }
  };

  // ── PIN keypad mode ─────────────────────────────────────────────────────────
  if (showPinPad) {
    return (
      <View style={[lockStyles.overlay, { backgroundColor: colors.background }]}>
        <Text style={[lockStyles.title, { color: colors.textPrimary }]}>SyncLink</Text>
        <PinPad
          label={t('pin_lock.enter')}
          subLabel={pinError ?? undefined}
          subLabelIsError={!!pinError}
          onChange={(v) => { if (v.length === 0) setPinError(null); }}
          onComplete={(pin) => void handlePinComplete(pin)}
          resetKey={pinResetKey}
        />
        {/* Offer a way back to biometrics when both methods are enabled. */}
        {bioEnabled && bioAvailable && (
          <TouchableOpacity
            style={lockStyles.linkButton}
            onPress={() => { setShowPinPad(false); setPinError(null); }}
          >
            <Text style={[lockStyles.linkText, { color: colors.primary }]}>
              {t('pin_lock.use_biometric')}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  // ── Biometric mode (with optional "Use passcode" fallback link) ────────────
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
          // textInverse ensures contrast against the primary-colored button in both themes
          <ActivityIndicator color={colors.textInverse} />
        ) : (
          // textInverse: white in light, gray-900 in dark — contrasts with primary background
          <Text style={[lockStyles.buttonText, { color: colors.textInverse }]}>{t('settings.authenticate')}</Text>
        )}
      </TouchableOpacity>
      {pinEnabled && (
        <TouchableOpacity
          style={lockStyles.linkButton}
          onPress={() => setShowPinPad(true)}
        >
          <Text style={[lockStyles.linkText, { color: colors.primary }]}>
            {t('pin_lock.use_pin')}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const lockStyles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingTop: 60,
    zIndex: 9999,
  },
  linkButton: {
    paddingHorizontal: 16,
    paddingVertical:   8,
  },
  linkText: {
    fontSize:   14,
    fontWeight: '600',
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
    // Color overridden inline via colors.textInverse — this placeholder is unused
    fontSize: 16,
    fontWeight: '600',
  },
});

export default function RootLayout() {
  // Vector-icon fonts are normally bundled into the native app via the
  // Expo prebuild step, but the web build expects the JS bundle to register
  // them explicitly. Without this hook every <Ionicons /> renders as a
  // "square with X" placeholder on Cloudflare Pages. Native platforms hit
  // the font cache on first load and resolve instantly, so this adds no
  // perceivable cost. We block first render until they resolve so we never
  // flash the placeholder glyphs.
  const [fontsLoaded] = useFonts({
    ...Ionicons.font,
    ...FontAwesome.font,
  });

  const { setUser, setLoading, isAuthenticated } = useAuthStore();
  const setPlan = useSubscriptionStore((s) => s.setPlan);
  const router = useRouter();

  // App lock state. `isEnabled` and `lock` are not referenced here because
  // the LockOverlay now owns biometric/PIN prompting; we only need the
  // `isLocked` boolean for the overlay gate and `unlock`/`hydrate` actions.
  const { isLocked, unlock, hydrate } = useAppLockStore();
  /** Track previous AppState to detect background→foreground transitions. */
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  const { routingReady } = useAuthGuard();

  // Web-only: sign the user out after 30 minutes of inactivity. Native
  // sessions stay live because the OS lock screen + in-app PIN already
  // protect the device; the threat model on the web (shared computers)
  // is what makes idle-logout worth the friction.
  useIdleLogout();

  // Web-only: register the Service Worker + PushSubscription so the
  // smart-reminder pipeline can fan out notifications to open browser
  // tabs the same way it pushes to native devices via Expo. No-op on
  // native, and silently skipped if VAPID isn't configured yet.
  useWebPush();

  // Native-only: keep the home-screen widget snapshot in sync with the
  // event/todo stores. Subscribes to both stores and writes a debounced
  // snapshot to the App Group (iOS) / SharedPreferences-backed AsyncStorage
  // (Android) on every change. No-op on web.
  useWidgetSync();

  // Midnight rollover for daily / monthly quotas. canUseAI() already
  // resets when the date changes, but the UI counter (e.g. "AI 5/5") is
  // only refreshed on next render. Touching the store with the latest
  // ymd at midnight forces a re-render and zeroes out the visible
  // counter without the user having to interact first.
  useEffect(() => {
    const tick = () => {
      const s = useSubscriptionStore.getState();
      // 로컬 timezone 기준 — toISOString() 은 UTC 라 자정 부근에서 하루가
      // 빠른 키가 만들어져 다른 날 데이터가 합쳐질 수 있음.
      const __now = new Date();
      const ymd = `${__now.getFullYear()}-${String(__now.getMonth() + 1).padStart(2, '0')}-${String(__now.getDate()).padStart(2, '0')}`;
      const month = ymd.slice(0, 7);
      const patch: Partial<typeof s> = {};
      if (s.lastResetDate !== ymd)
        Object.assign(patch, { aiUsageToday: 0, lastResetDate: ymd });
      if (s.lastReviewResetMonth !== month)
        Object.assign(patch, { weeklyReviewUsedThisMonth: 0, lastReviewResetMonth: month });
      if (Object.keys(patch).length > 0) useSubscriptionStore.setState(patch);
    };
    // Check every minute — much cheaper than computing the precise
    // ms-until-midnight handle, and survives device clock changes.
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  // TASK-1301: Restore the user-persisted language from AsyncStorage on every startup.
  // initI18n() is async so we call it in a useEffect; i18next was already initialised
  // with the system locale at module load time, so there is no flash of untranslated text.
  useEffect(() => {
    void initI18n();
  }, []);

  /*
   * Sprint 14 TASK-1406 — Ask for ATT on iOS (first launch only) and then
   * initialize the AdMob SDK. The order is important: initializing AdMob
   * before the user has granted tracking means iOS 14+ requires non-
   * personalized ads for the rest of the session. We gate the prompt with
   * an AsyncStorage flag so users are asked at most once by us (the OS may
   * never re-prompt after an answer, but the flag prevents mounting logic
   * from trying again in the current session if the modal was dismissed).
   */
  useEffect(() => {
    const ATT_ASKED_KEY = 'synclink:att_asked_v1';
    (async () => {
      try {
        if (Platform.OS === 'ios') {
          const already = await AsyncStorage.getItem(ATT_ASKED_KEY);
          if (already === null) {
            await requestTrackingPermissionsAsync();
            await AsyncStorage.setItem(ATT_ASKED_KEY, '1');
          }
        }
      } catch (err) {
        // Non-fatal — AdMob will still work (NPA if tracking denied).
        console.warn('[root] ATT prompt failed:', err);
      }

      // Initialize AdMob now that tracking status is known.
      try {
        await initAdMob();
      } catch (err) {
        console.warn('[root] initAdMob failed:', err);
      }
    })();
  }, []);

  // TASK-900: Hydrate app lock setting from AsyncStorage on startup.
  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // TASK-900: Lock the app only on true background→foreground transitions.
  //
  // iOS triggers 'active → inactive → active' for transient events like opening
  // ActionSheet, DatePicker, Control Center swipe, or split-view. Treating
  // 'inactive' as "came from background" caused the lock to fire on every
  // modal/action, breaking the app. Only 'background' is a real foreground return.
  //
  // Deps are intentionally empty: the listener reads isEnabled/lock via getState()
  // so it doesn't re-register on store changes (which would drop events).
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      const prev = appStateRef.current;
      appStateRef.current = nextState;

      if (prev === 'background' && nextState === 'active') {
        const store = useAppLockStore.getState();
        // Sprint 15 TASK-1510: lock if either biometric or PIN lock is on.
        if (store.isEnabled || store.pinEnabled) store.lock();
      }
    });

    return () => subscription.remove();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- reads latest state via getState()
  }, []);

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

    // Two server-authoritative sources for plan, in order of precedence:
    //   1. users.subscription_plan — set by the RevenueCat webhook AND
    //      by manual LEAD edits via Supabase Studio (admin promotion).
    //   2. RevenueCat's local CustomerInfo cache — only sees the SDK's
    //      view, which is updated client-side after a purchase.
    //
    // Either source returning 'pro' wins; if both say 'free' the user
    // is downgraded (e.g. subscription expired). This closes the gap
    // where DB had 'pro' but RevenueCat hadn't been billed yet, so the
    // client showed Free indefinitely.
    // Build-98 — Android RC API key 빈 값이면 initializePurchases 가 silent
    // skip (Build 88 fix). 이후 checkProStatus 가 Purchases.getCustomerInfo
    // 호출 시 "no singleton" warning. debug build 의 LogBox overlay 에
    // 노이즈로 노출 → 빈 key 환경 (Android pre-launch) 에선 sync 자체 skip.
    const rcKey = Platform.OS === 'ios'
      ? process.env.EXPO_PUBLIC_RC_API_KEY_IOS
      : process.env.EXPO_PUBLIC_RC_API_KEY_ANDROID;
    if (!rcKey) {
      // RC 미설정 환경 — sync 건너뛰고 plan 은 DB 에서만 결정.
      (async () => {
        try {
          const { data } = await supabase.from('users').select('subscription_plan').eq('id', userId).maybeSingle();
          const dbPlan = (data as unknown as { subscription_plan?: string } | null)?.subscription_plan;
          setPlan(dbPlan === 'pro' ? 'pro' : 'free');
        } catch {
          // 무시 — plan 미정 = free 유지
        }
      })();
      return;
    }

    initializePurchases(userId)
      .then(() => checkProStatus())
      .then(async (isProFromRC) => {
        let isPro = isProFromRC;
        try {
          const { data } = await supabase
            .from('users')
            .select('subscription_plan')
            .eq('id', userId)
            .maybeSingle();
          // The generated row type is `never` because Database types miss
          // a Relationships entry — cast through unknown to read the
          // string column.
          const dbPlan = (data as unknown as { subscription_plan?: string } | null)
            ?.subscription_plan;
          if (dbPlan === 'pro') isPro = true;
          else if (dbPlan === 'free' && !isProFromRC) isPro = false;
        } catch {
          // Network or table missing — keep RevenueCat's verdict.
        }
        setPlan(isPro ? 'pro' : 'free');
      })
      .catch((err) => {
        // Non-fatal — app works without purchase sync, but route to
        // errorLogger so production traces this in Sentry instead of
        // disappearing into a console nobody reads.
        void logError({ context: 'rootLayout.purchaseSync', error: err });
      });
  }, [isAuthenticated, setPlan]);

  // TASK-403: Initialize push notifications after user authenticates.
  // Non-critical: errors are logged but do not crash the app.
  useEffect(() => {
    if (!isAuthenticated) return;

    // Request permission + register Expo push token
    initializeNotifications().catch((err) => {
      void logError({ context: 'rootLayout.initNotifications', error: err });
    });

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
          // Build-100 LEAD — 리마인더 푸시 클릭 시 해당 일정 detail 로
          // 직접 이동. eventId 가 payload 에 없을 때만 캘린더 fallback.
          if (data['eventId']) {
            router.push(`/event/${String(data['eventId'])}`);
          } else {
            router.push('/(tabs)/calendar');
          }
        }
      },
    );

    return cleanup;
  }, [isAuthenticated, router]);

  useEffect(() => {
    // Handle deep links for Space invite codes.
    //
    // Supported patterns:
    //  - https://synclink.pages.dev/space/<code>  (primary — Universal Link / App Link)
    //  - synclink://space/join/<code>             (custom scheme fallback)
    //  - synclink://join/<code>                   (legacy custom scheme)
    //  - https://synclink.app/space/join/<code>  (old universal link — kept for compatibility)
    //
    // All patterns navigate to /space/join/<code> for the preview screen.
    const handleDeepLink = (event: { url: string }) => {
      const { url } = event;
      try {
        const parsed = Linking.parse(url);

        // Pattern 1 (primary): https://synclink.pages.dev/space/<code>
        // DEVOPS 2026-04-28: synclink.pages.dev is the new Universal Link domain.
        // parsed.hostname = 'synclink.pages.dev', parsed.path = '/space/<code>'
        if (
          parsed.hostname === 'synclink.pages.dev' &&
          parsed.path?.startsWith('/space/')
        ) {
          // Strip leading /space/ to get the raw invite code
          const code = parsed.path.replace(/^\/space\//, '').split('/')[0];
          if (code) {
            router.push(`/space/join/${encodeURIComponent(code)}`);
            return;
          }
        }

        // Pattern 2 (fallback): synclink://space/join/<code>
        // parsed.hostname = 'space', parsed.path = '/join/<code>'
        if (parsed.hostname === 'space' && parsed.path?.startsWith('/join/')) {
          const code = parsed.path.replace(/^\/join\//, '');
          if (code) {
            router.push(`/space/join/${encodeURIComponent(code)}`);
            return;
          }
        }

        // Pattern 3 (legacy): synclink://join/<code>
        // parsed.hostname = 'join', parsed.path = '/<code>'
        if (parsed.hostname === 'join' && parsed.path) {
          const code = parsed.path.replace(/^\//, '');
          if (code) {
            router.push(`/space/join/${encodeURIComponent(code)}`);
            return;
          }
        }

        // Pattern 4 (compat): https://synclink.app/space/join/<code>
        // parsed.path = '/space/join/<code>'
        if (
          parsed.scheme === 'https' &&
          parsed.hostname !== 'synclink.pages.dev' &&
          parsed.path?.includes('/space/join/')
        ) {
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
      {/* Web 에서 좌우 여백 + 가운데 정렬. 모바일 앱 (iOS/Android) 은 영향
          없음. 데스크톱 브라우저에서 컨테이너가 viewport 전체를 채우면 너무
          허전해 보이고 콘텐츠가 가장자리에 딱 붙음 — 모바일 친화 max-width
          (520px) 로 좁히고 가운데 정렬 + 좌우 패딩. (LEAD 2026-05-06) */}
      <View
        style={[
          { flex: 1 },
          Platform.OS === 'web' && {
            maxWidth:        520,
            width:           '100%',
            alignSelf:       'center',
            paddingHorizontal: 16,
          },
        ]}
      >
      <SafeAreaProvider>
        <StatusBar style="auto" />
        {/* TASK-900: App lock overlay — rendered above all content when locked */}
        {isLocked && <LockOverlay onUnlock={unlock} />}
        {/*
          Sprint 15 TASK-1520 — offline banner.
          Rendered at the root so every tab / modal sees it, and below the
          lock overlay so users still know they are offline while locked.
        */}
        <OfflineBanner />
        {/*
          Sprint 19 — auth + routing not yet settled. Render the splash on
          top of the Stack so the user never sees the default-route Home
          screen flash before useAuthGuard's redirect lands.
        */}
        {(!routingReady || !fontsLoaded) && <AppSplash />}
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
          {/* Sprint 15 TASK-1510 — 4-digit PIN settings screen. */}
          <Stack.Screen name="settings/pin" options={{ presentation: 'modal' }} />
          {/* v1.2 Phase 2 — AI 비서 모달. ChatFab → router.push('/chat'). */}
          <Stack.Screen name="chat" options={{ presentation: 'modal', headerShown: true, title: 'AI 비서' }} />
        </Stack>
      </SafeAreaProvider>
      </View>
    </GestureHandlerRootView>
  );
}
