/**
 * jest.setup.js — Global test setup for SyncDay
 *
 * Runs before each test file (referenced via package.json > jest.setupFiles).
 * Sets up global mocks for native modules and external services.
 */

// ─── Supabase mock ────────────────────────────────────────────────────────────
// Prevents real network calls during tests. Services under test should
// receive a mocked client via dependency injection or module mock.
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    auth: {
      getSession: jest.fn().mockResolvedValue({ data: { session: null }, error: null }),
      signInWithOAuth: jest.fn().mockResolvedValue({ data: { url: 'https://mock-oauth-url.com' }, error: null }),
      signInWithIdToken: jest.fn().mockResolvedValue({ data: { session: null }, error: null }),
      exchangeCodeForSession: jest.fn().mockResolvedValue({ data: {}, error: null }),
      refreshSession: jest.fn().mockResolvedValue({ data: { session: null }, error: null }),
      signOut: jest.fn().mockResolvedValue({ error: null }),
      onAuthStateChange: jest.fn().mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } }),
      getUser: jest.fn().mockResolvedValue({ data: { user: null }, error: null }),
    },
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
      upsert: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      neq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      gte: jest.fn().mockReturnThis(),
      lte: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    })),
    channel: jest.fn(() => ({
      on: jest.fn().mockReturnThis(),
      subscribe: jest.fn(),
    })),
    removeChannel: jest.fn(),
  })),
}));

// ─── react-native LogBox mock ─────────────────────────────────────────────────
// LogBox is not fully provided by jest-expo. Components that call
// LogBox.ignoreLogs() at module level (e.g. _layout.tsx) crash without this.
jest.mock('react-native/Libraries/LogBox/LogBox', () => ({
  ignoreLogs: jest.fn(),
  ignoreAllLogs: jest.fn(),
  install: jest.fn(),
  uninstall: jest.fn(),
}), { virtual: true });

// Extend the global react-native mock to expose LogBox
const rnMock = jest.requireMock('react-native');
if (rnMock && !rnMock.LogBox) {
  rnMock.LogBox = { ignoreLogs: jest.fn(), ignoreAllLogs: jest.fn() };
}

// ─── Expo modules mock ────────────────────────────────────────────────────────
// Expo modules require native bridges unavailable in Jest environment.
// ─── @expo/vector-icons mock ─────────────────────────────────────────────────
// expo-font's native module (loadedNativeFonts) is unavailable in Jest.
// Replace all icon sets with a simple Text component that renders the icon name.
jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  const MockIcon = ({ name, ...rest }) =>
    React.createElement(Text, { ...rest, testID: `icon-${name}` }, name);
  return {
    Ionicons: MockIcon,
    MaterialIcons: MockIcon,
    FontAwesome: MockIcon,
    AntDesign: MockIcon,
    Feather: MockIcon,
  };
});

jest.mock('expo-notifications', () => ({
  // Permission & token
  getPermissionsAsync:              jest.fn().mockResolvedValue({ status: 'granted' }),
  requestPermissionsAsync:          jest.fn().mockResolvedValue({ status: 'granted' }),
  getExpoPushTokenAsync:            jest.fn().mockResolvedValue({ data: 'ExpoToken[mock]' }),
  // Notification handler (called at module level in notificationService.ts)
  setNotificationHandler:           jest.fn(),
  // Scheduling
  scheduleNotificationAsync:        jest.fn().mockResolvedValue('mock-notification-id'),
  cancelScheduledNotificationAsync: jest.fn().mockResolvedValue(undefined),
  getAllScheduledNotificationsAsync: jest.fn().mockResolvedValue([]),
  // Listeners
  addNotificationReceivedListener:         jest.fn().mockReturnValue({ remove: jest.fn() }),
  addNotificationResponseReceivedListener: jest.fn().mockReturnValue({ remove: jest.fn() }),
  // Enums used in scheduleEventReminder
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));

jest.mock('expo-router', () => {
  // Stack.Screen 같은 compound component를 지원하기 위해 팩토리 패턴 사용
  const ScreenMock = () => null;
  const StackMock = Object.assign(() => null, { Screen: ScreenMock });
  const TabsMock  = Object.assign(() => null, { Screen: ScreenMock });

  return {
    useRouter: jest.fn(() => ({
      push: jest.fn(),
      replace: jest.fn(),
      back: jest.fn(),
      canGoBack: jest.fn().mockReturnValue(true),
    })),
    useLocalSearchParams: jest.fn(() => ({})),
    useSegments: jest.fn(() => []),
    useFocusEffect: jest.fn(),
    Link: ({ children }) => children,
    Redirect: () => null,
    Stack: StackMock,
    Tabs: TabsMock,
  };
});

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// ─── Google Sign-In mock ──────────────────────────────────────────────────────
// Native TurboModule — unavailable in Jest environment.
jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: jest.fn(),
    hasPlayServices: jest.fn().mockResolvedValue(true),
    signIn: jest.fn().mockResolvedValue({ type: 'success', data: { idToken: 'mock-google-id-token' } }),
    signOut: jest.fn().mockResolvedValue(undefined),
    getCurrentUser: jest.fn().mockReturnValue(null),
  },
  statusCodes: {
    SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED',
    IN_PROGRESS: 'IN_PROGRESS',
    PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE',
  },
}));

// ─── Apple Authentication mock ────────────────────────────────────────────────
// iOS-only native module — unavailable in Jest/Android environment.
jest.mock('expo-apple-authentication', () => ({
  signInAsync: jest.fn().mockResolvedValue({
    identityToken: 'mock-apple-identity-token',
    authorizationCode: 'mock-auth-code',
    user: 'mock-apple-user-id',
    email: 'mock@privaterelay.appleid.com',
    fullName: { givenName: 'Mock', familyName: 'User' },
  }),
  AppleAuthenticationScope: {
    FULL_NAME: 0,
    EMAIL: 1,
  },
  isAvailableAsync: jest.fn().mockResolvedValue(true),
}));

// ─── expo-web-browser mock ────────────────────────────────────────────────────
// Used for Kakao OAuth redirect flow.
jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: jest.fn().mockResolvedValue({
    type: 'success',
    url: 'syncday://auth/callback?code=mock-kakao-code',
  }),
  dismissBrowser: jest.fn(),
}));

// ─── expo-linking mock ────────────────────────────────────────────────────────
// Requires app.json manifest at runtime — unavailable in Jest environment.
jest.mock('expo-linking', () => ({
  createURL: jest.fn((path) => `syncday://${path}`),
  parse: jest.fn((url) => {
    try {
      const u = new URL(url);
      return { scheme: u.protocol.replace(':', ''), hostname: u.hostname, path: u.pathname };
    } catch {
      return { scheme: 'syncday', hostname: '', path: '' };
    }
  }),
  addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  getInitialURL: jest.fn().mockResolvedValue(null),
}));

// ─── react-native-purchases mock ─────────────────────────────────────────────
// RevenueCat SDK requires a native bridge — unavailable in Jest environment.
// This mock mirrors the real SDK shape so purchaseService tests can run without
// a real App Store / Google Play connection.
jest.mock('react-native-purchases', () => ({
  __esModule: true,
  default: {
    setLogLevel:       jest.fn(),
    configure:         jest.fn().mockResolvedValue(undefined),
    getOfferings:      jest.fn().mockResolvedValue({
      current: {
        availablePackages: [],
      },
    }),
    purchasePackage:   jest.fn().mockResolvedValue({
      customerInfo: { entitlements: { active: {} } },
    }),
    restorePurchases:  jest.fn().mockResolvedValue({
      entitlements: { active: {} },
    }),
    getCustomerInfo:   jest.fn().mockResolvedValue({
      entitlements: { active: {} },
    }),
  },
  // LOG_LEVEL enum values used in purchaseService.ts
  LOG_LEVEL: {
    DEBUG:   'DEBUG',
    INFO:    'INFO',
    WARNING: 'WARNING',
    ERROR:   'ERROR',
  },
  // PACKAGE_TYPE enum (used in type checks)
  PACKAGE_TYPE: {
    ANNUAL:  'ANNUAL',
    MONTHLY: 'MONTHLY',
  },
}));

// ─── react-i18next mock ───────────────────────────────────────────────────────
// i18next requires async initialization and locale resources — unavailable in
// Jest environment. This mock returns translation keys as-is so component
// tests can find rendered text by translation key or by the Korean default value.
jest.mock('react-i18next', () => {
  /**
   * Minimal t() implementation: looks up the key in the Korean locale bundle
   * (loaded synchronously) so tests that query by Korean text still pass.
   * Falls back to returning the key itself if not found.
   */
  const ko = require('./src/locales/ko').default;

  function resolvePath(obj, path) {
    return path.split('.').reduce((acc, part) => {
      if (acc === null || acc === undefined) return undefined;
      // Array index notation: e.g. pages[0].title → pages, 0, title
      const match = part.match(/^(\w+)\[(\d+)\]$/);
      if (match) return acc[match[1]]?.[Number(match[2])];
      return acc[part];
    }, obj);
  }

  function t(key, opts) {
    if (opts && opts.returnObjects) {
      const val = resolvePath(ko, key);
      return val !== undefined ? val : key;
    }
    const val = resolvePath(ko, key);
    if (val !== undefined && typeof val === 'string') return val;
    return key;
  }

  return {
    useTranslation: () => ({ t, i18n: { language: 'ko', changeLanguage: jest.fn() } }),
    Trans: ({ children }) => children,
    I18nextProvider: ({ children }) => children,
    initReactI18next: { type: '3rdParty', init: jest.fn() },
  };
});

// ─── @react-native-voice/voice mock ──────────────────────────────────────────
// The native voice package calls `new NativeEventEmitter(NativeModules.Voice)`
// at module load time. In Jest, NativeModules.Voice is null → throws.
// This mock prevents the NativeEventEmitter crash and makes Voice methods
// available as jest.fn() stubs for components that use voice input.
jest.mock('@react-native-voice/voice', () => ({
  __esModule: true,
  default: {
    isAvailable:            jest.fn().mockResolvedValue(true),
    start:                  jest.fn().mockResolvedValue(undefined),
    stop:                   jest.fn().mockResolvedValue(undefined),
    cancel:                 jest.fn().mockResolvedValue(undefined),
    destroy:                jest.fn().mockResolvedValue(undefined),
    removeAllListeners:     jest.fn(),
    onSpeechStart:          null,
    onSpeechRecognized:     null,
    onSpeechEnd:            null,
    onSpeechError:          null,
    onSpeechResults:        null,
    onSpeechPartialResults: null,
    onSpeechVolumeChanged:  null,
  },
}));

// ─── EXPO_PUBLIC_* env vars ───────────────────────────────────────────────────
// babel-preset-expo inlines EXPO_PUBLIC_* at Babel transform time (not at runtime).
// These stubs must be set before any module is transformed so the inlined value
// is a non-empty string rather than undefined.
process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY =
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? 'test-google-maps-key';
process.env.EXPO_PUBLIC_WEATHER_API_KEY =
  process.env.EXPO_PUBLIC_WEATHER_API_KEY ?? 'test-weather-key';
// Kakao custom OAuth (kakao-auth Edge Function) — authService.signInWithKakao
// embeds this into the Kakao authorize URL. Note: the REAL inlining happens
// in babel.config.js (transform time); this runtime default is a belt-and-
// suspenders safeguard for any stray runtime reads.
process.env.EXPO_PUBLIC_KAKAO_REST_API_KEY =
  process.env.EXPO_PUBLIC_KAKAO_REST_API_KEY ?? 'test-kakao-rest-api-key';

// ─── expo-secure-store mock ───────────────────────────────────────────────────
// In-memory SecureStore backed by a Map. _store is exposed so test files can
// call SecureStore._store.clear() in their own beforeEach.
jest.mock('expo-secure-store', () => {
  const store = new Map();
  return {
    _store: store,
    getItemAsync: jest.fn((key) => Promise.resolve(store.get(key) ?? null)),
    setItemAsync: jest.fn((key, value) => { store.set(key, value); return Promise.resolve(); }),
    deleteItemAsync: jest.fn((key) => { store.delete(key); return Promise.resolve(); }),
  };
});

// ─── expo-crypto mock ─────────────────────────────────────────────────────────
// Deterministic hash: hex-encode the UTF-8 bytes of the input string.
jest.mock('expo-crypto', () => ({
  getRandomBytesAsync: jest.fn((n) => Promise.resolve(new Uint8Array(n).fill(0xab))),
  digestStringAsync: jest.fn((_alg, input) => {
    let hex = '';
    for (let i = 0; i < input.length; i++) {
      hex += input.charCodeAt(i).toString(16).padStart(2, '0');
    }
    return Promise.resolve(hex);
  }),
  CryptoDigestAlgorithm: { SHA256: 'SHA256' },
}));

// ─── Console noise reduction ──────────────────────────────────────────────────
// Suppress expected React Native warnings that pollute test output.
const SUPPRESSED_WARNINGS = [
  'Warning: ReactDOM.render is no longer supported',
  'Warning: An update to',
];

const originalWarn = console.warn;
console.warn = (...args) => {
  if (typeof args[0] === 'string' && SUPPRESSED_WARNINGS.some(w => args[0].includes(w))) {
    return;
  }
  originalWarn(...args);
};

// ─── useColors global mock ────────────────────────────────────────────────────
// Prevents Zustand appearanceStore → Appearance.addChangeListener from keeping
// the Jest process alive after tests finish → SIGTERM / OOM on MacBook Air M2.
// Individual test files can override with jest.mock('@/hooks/useColors', ...).
jest.mock('@/hooks/useColors', () => ({
  useColors: () => ({
    primary:         '#6B8CFF',
    primaryLight:    '#E8EEFF',
    primaryDark:     '#4A6CF7',
    accent:          '#6B8CFF',
    background:      '#FFFFFF',
    backgroundAlt:   '#F5F5F5',
    surface:         '#FFFFFF',
    surfaceAlt:      '#F0F0F0',
    textPrimary:     '#1A1A1A',
    textSecondary:   '#666666',
    textTertiary:    '#999999',
    textInverse:     '#FAFAFA',
    textPlaceholder: '#BBBBBB',
    border:          '#E0E0E0',
    borderStrong:    '#CCCCCC',
    success:         '#059669',
    warning:         '#D97706',
    error:           '#DC2626',
    tabActive:       '#6B8CFF',
    tabInactive:     '#999999',
    inputBackground: '#F5F5F5',
    inputBorder:     '#E0E0E0',
    inputFocus:      '#6B8CFF',
  }),
}));
