import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

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
  // native build embeds, so this works on every platform.
  const expo = Constants.expoConfig;
  const version = expo?.version ?? '0.0.0';
  // 🔴 빌드 식별자는 플랫폼마다 다르다. 종전처럼 ios.buildNumber 를 먼저 읽으면
  //    Android 이벤트까지 iOS 빌드번호로 태깅된다 — 실제로 Android vc22 크래시가
  //    "1.4.2+168"(iOS 빌드번호)로 올라와 어느 빌드의 에러인지 분간할 수 없었다
  //    (2026-08-19, Sentry SYNKLINK-19). 반드시 실행 중인 플랫폼 기준으로 고른다.
  const buildNumber =
    Platform.OS === 'android' ? (expo?.android?.versionCode?.toString() ?? '0')
    : Platform.OS === 'ios'   ? (expo?.ios?.buildNumber ?? '0')
    // 웹은 네이티브 빌드번호가 없다. 숫자를 억지로 붙이면 없는 빌드를 가리키므로
    // 배포 채널 자체를 식별자로 쓴다.
    :                           'web';
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
 * 화면 이동을 breadcrumb 으로 남긴다 — 크래시 **직전에 어느 화면이었는지** 알기 위해서다.
 *
 * 왜 넣었나: 2026-08-30 의 fatal 크래시(SYNKLINK-1A,
 * `|presentingViewController| must be set`)에서 스택은 "RN Fabric 이 뷰를 만들다가
 * Expo 모듈 초기화 중 터졌다"까지만 말해줬다. **어느 화면인지는 끝내 알 수 없었다** —
 * breadcrumb 에 ui.lifecycle 만 있고 라우트가 없었고, 퍼널은 7단계만 기록하기 때문이다.
 * 화면 하나만 알았어도 후보가 즉시 좁혀졌다.
 *
 * 🔴 경로에서 식별자는 지운다. `/event/9a3f-…` 같은 값은 화면을 아는 데 필요 없고,
 *    제3자 서비스로 나가는 데이터는 최소여야 한다(captureHandledError 가 `details` 를
 *    일부러 안 보내는 것과 같은 판단).
 *
 * @param from 직전 경로. 첫 진입이면 null
 * @param to   새 경로
 */
export function addNavigationBreadcrumb(from: string | null, to: string): void {
  Sentry.addBreadcrumb({
    category: 'navigation',
    type: 'navigation',
    level: 'info',
    message: to,
    data: { from: from ?? '(첫 진입)', to },
  });
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
