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
