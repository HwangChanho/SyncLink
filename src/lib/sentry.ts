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
    enableNative: false, // Native SDK requires sentry.properties org/project — disabled until configured
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
