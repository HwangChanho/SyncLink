import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';

/**
 * Initialize Sentry error tracking.
 * No-op when EXPO_PUBLIC_SENTRY_DSN is not set (local dev without Sentry).
 *
 * Release tagging: each Sentry event is grouped under a release id of the
 * form "synclink@<version>+<buildNumber>". This lets us bisect issues to
 * a specific TestFlight / App Store build without needing the native
 * Sentry SDK to read Info.plist (which requires sentry.properties).
 */
export function initSentry(): void {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (!dsn) return;

  // expo-constants exposes the same values reading from app.json that the
  // native build embeds, so this works on both iOS native and web.
  const expo = Constants.expoConfig;
  const version = expo?.version ?? '0.0.0';
  const buildNumber =
    expo?.ios?.buildNumber ?? expo?.android?.versionCode?.toString() ?? '0';
  const release = `synclink@${version}+${buildNumber}`;

  Sentry.init({
    dsn,
    environment: process.env.EXPO_PUBLIC_APP_ENV ?? 'development',
    release,
    dist: String(buildNumber),
    // v1.2.0 — Android 크래시 트래킹 enable (EAS env 에 DSN 등록 완료).
    // sentry.properties 의 org/project 는 build-time source map upload 용이고,
    // runtime native crash 송신은 DSN 만으로 동작. SENTRY_DISABLE_AUTO_UPLOAD
    // (eas.json) 가 build 시 sentry-cli 호출을 무력화하므로 빌드 실패 없음.
    enableNative: true,
    tracesSampleRate: 0.2,
    // Ignore non-actionable errors
    ignoreErrors: ['Network request failed', 'AbortError'],
  });
}

/** Capture an exception and send to Sentry. Safe to call even if Sentry not initialized. */
export function captureException(err: unknown): void {
  Sentry.captureException(err);
}

/**
 * Capture a *handled* error (one a service already caught) with its logical
 * origin attached as a searchable tag.
 *
 * Why this exists: production builds do not write to `error_logs` (see
 * SHOULD_PERSIST_LOGS in errorLogger.ts — LEAD's "배포 버전은 로깅 제외"
 * rule). Without this, a caught failure such as a Kakao sign-in that never
 * returns 'success' left no trace anywhere in production, so the diagnostic
 * logging added for exactly that investigation could never fire. Routing
 * handled errors to Sentry restores visibility at zero DB cost.
 *
 * Privacy: only the context tag and the error's own message/stack are sent.
 * `details` is deliberately NOT forwarded — callers put request bodies and
 * responses in there, and shipping those to a third party would violate the
 * "사용자 활동 비공개" intent behind disabling production DB logging.
 *
 * @param context Dot-separated origin id, e.g. 'auth.kakao.websession-not-success'
 * @param err     The caught value (Error or otherwise; non-Errors are wrapped)
 */
export function captureHandledError(context: string, err: unknown): void {
  Sentry.withScope((scope) => {
    scope.setTag('context', context);
    // Group by origin rather than by message, so one flaky endpoint doesn't
    // shatter into dozens of separate Sentry issues.
    scope.setFingerprint(['handled', context]);
    Sentry.captureException(err instanceof Error ? err : new Error(String(err)));
  });
}

/** Capture a message and send to Sentry. */
export function captureMessage(msg: string, level: Sentry.SeverityLevel = 'info'): void {
  Sentry.captureMessage(msg, level);
}
