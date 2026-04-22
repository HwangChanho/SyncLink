import * as Sentry from '@sentry/react-native';

/**
 * Initialize Sentry error tracking.
 * No-op when EXPO_PUBLIC_SENTRY_DSN is not set (local dev without Sentry).
 */
export function initSentry(): void {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.EXPO_PUBLIC_APP_ENV ?? 'development',
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

/** Capture a message and send to Sentry. */
export function captureMessage(msg: string, level: Sentry.SeverityLevel = 'info'): void {
  Sentry.captureMessage(msg, level);
}
