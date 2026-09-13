/**
 * buildChannel — "이 기록이 어떤 빌드에서 찍혔나" 를 판별한다.
 *
 * ## 왜 필요한가 (2026-09-13 실측)
 *
 * `funnelService.trackFunnel` 은 설계상 환경 분기가 없다(production 에서도 항상 기록).
 * 그 결과 개발 빌드·에뮬레이터·로컬 웹 기록이 실사용자와 **표식 없이** 섞였고,
 * 9월 iOS 에서 DB 의 "새 기기" 10대 중 App Store 최초 다운로드는 2건뿐이었다.
 * 기록을 끄지 않고(원칙 유지) **나중에 거를 수 있도록** 채널을 함께 남긴다.
 * → supabase/migrations/075_funnel_events_build_channel.sql
 *
 * ## 판별 순서 (위가 우선)
 *
 * | 값          | 조건 |
 * |-------------|------|
 * | `web`       | 웹이고 hostname 이 운영 도메인 |
 * | `web_local` | 그 밖의 웹 — localhost·프리뷰 배포·hostname 을 못 읽음 |
 * | `dev`       | 네이티브 `__DEV__` (Metro 개발 번들 — `expo run:ios` 시뮬 검증 포함) |
 * | `emulator`  | Android 에뮬레이터 |
 * | `preview`   | EXPO_PUBLIC_APP_ENV 가 값이 있고 production 이 아님 (EAS preview 프로파일 APK) |
 * | `release`   | 나머지 — App Store·TestFlight·Play·iOS 시뮬 Release 가 **아직 섞여 있다** |
 *
 * 웹을 `__DEV__` 보다 먼저 보는 이유: 웹은 hostname 이 더 정확한 신호다.
 * 로컬에서 production 모드로 export 해 띄운 웹도 운영이 아니므로 `web_local` 이어야 한다.
 *
 * ## 🔑 원칙 — 애매하면 `release`
 *
 * 내부 기록을 조금 놓치는 것보다, **실사용자를 내부로 오분류해 분석에서 빼 버리는 것**이
 * 훨씬 해롭다(표본이 원래 하루 0.2설치 수준이다). 그래서 모든 "내부" 판정은
 * 확실한 신호가 있을 때만 내리고, 판단이 안 서면 `release` 로 둔다.
 *
 * ## ⚠️ 1단계의 한계 — 1.4.16 에서 네이티브로 세분 예정
 *
 * iOS 는 TestFlight 와 App Store 가 **같은 바이너리**라 빌드 시점 값으로 못 가르고,
 * 영수증 경로(`sandboxReceipt`)를 읽으려면 네이티브 코드가 필요하다. iOS 시뮬레이터의
 * Release 빌드도 JS 에서는 식별 신호가 없다. 둘 다 지금은 `release` 에 들어간다.
 */

import { Platform } from 'react-native';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * 빌드 채널. DB 는 자유 text(길이만 제한)라 **값 통제는 이 타입이 전부**다.
 * 🔴 값을 추가할 때 DB 에 `in (...)` check 를 걸지 말 것 — trackFunnel 이 insert 오류를
 *    삼키므로, 옛 제약에 걸린 새 값은 기록째 조용히 사라진다(075 주석).
 */
export type BuildChannel = 'web' | 'web_local' | 'dev' | 'emulator' | 'preview' | 'release';

/**
 * Android `Platform.constants` 중 에뮬레이터 판별에 쓰는 필드만.
 * (RN AndroidInfoModule 이 Build.FINGERPRINT/MODEL/MANUFACTURER/BRAND 를 그대로 싣는다)
 */
export type AndroidBuildConstants = {
  Fingerprint?: string;
  Model?: string;
  Manufacturer?: string;
  Brand?: string;
};

/** 판별에 필요한 환경 값 — 순수 함수로 두어 테스트에서 어떤 환경이든 흉내 낼 수 있게 한다. */
export type BuildChannelInput = {
  /** `Platform.OS` */
  platformOS: string;
  /** `__DEV__` */
  isDev: boolean;
  /** `process.env.EXPO_PUBLIC_APP_ENV` (빌드 시점에 인라인된다) */
  appEnv: string | undefined;
  /** 웹일 때 `location.hostname`. 네이티브이거나 못 읽으면 null */
  webHostname: string | null;
  /**
   * Android 일 때 `Platform.constants`. 그 밖엔 undefined.
   * (`| undefined` 명시 — tsconfig 의 exactOptionalPropertyTypes 가 켜져 있어,
   *  없으면 "키는 있는데 값이 undefined" 를 넘길 수 없다)
   */
  android?: AndroidBuildConstants | undefined;
};

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * 운영 웹 도메인. 여기에 **정확히 일치**해야 `web` 이다.
 * ⚠️ Cloudflare 프리뷰 배포(`<hash>.synclink.pages.dev`)는 일부러 제외한다 — 내부 확인용이다.
 * 커스텀 도메인을 붙이면 여기에 추가할 것(안 하면 그 도메인의 실사용자가 `web_local` 로 빠진다).
 */
export const PRODUCTION_WEB_HOSTS: readonly string[] = ['synclink.pages.dev'];

// ─── 판별 ─────────────────────────────────────────────────────────────────────

/**
 * Android 에뮬레이터인지 — **실기기를 절대 걸지 않는** 좁은 신호만 쓴다.
 *
 * 실측 예:
 *   에뮬레이터  google/sdk_gphone64_arm64/emu64a:14/.../userdebug/dev-keys
 *   Pixel 8 Pro google/husky/husky:14/AP1A.240305.019.A1/11445699:user/release-keys
 *
 * @param c Android `Platform.constants` 의 일부
 * @returns 에뮬레이터 신호가 하나라도 명확하면 true
 */
export function isAndroidEmulator(c: AndroidBuildConstants | undefined): boolean {
  if (!c) return false;
  const fingerprint = (c.Fingerprint ?? '').toLowerCase();
  const model = (c.Model ?? '').toLowerCase();
  const manufacturer = (c.Manufacturer ?? '').toLowerCase();

  // ① 지문: AOSP/구형 에뮬레이터는 generic·unknown 으로 시작하고,
  //    최신 공식 에뮬레이터 이미지는 sdk_gphone 계열 제품명을 쓴다.
  if (fingerprint.startsWith('generic') || fingerprint.startsWith('unknown')) return true;
  if (/sdk_gphone|google_sdk|sdk_x86|vbox86p/.test(fingerprint)) return true;
  // ② 모델명: 공식 에뮬레이터 표기
  if (/sdk_gphone|google_sdk|emulator|android sdk built for/.test(model)) return true;
  // ③ 제조사: Genymotion 가상기기
  if (manufacturer.includes('genymotion')) return true;
  return false;
}

/**
 * 환경 값으로 채널을 정한다. **부작용 없는 순수 함수.**
 *
 * @param input 판별에 쓸 환경 값 (BuildChannelInput 참고)
 * @returns 빌드 채널 — 애매하면 `release`
 */
export function resolveBuildChannel(input: BuildChannelInput): BuildChannel {
  // 1) 웹은 hostname 이 가장 정확하다. 못 읽으면 운영이라고 단정할 근거가 없으므로 web_local.
  if (input.platformOS === 'web') {
    return input.webHostname !== null && PRODUCTION_WEB_HOSTS.includes(input.webHostname)
      ? 'web'
      : 'web_local';
  }
  // 2) Metro 개발 번들. 스토어·TestFlight 의 release 번들에서는 항상 false 다.
  if (input.isDev) return 'dev';
  // 3) Android 에뮬레이터 (iOS 시뮬레이터는 JS 신호가 없어 1단계에선 못 가른다)
  if (input.platformOS === 'android' && isAndroidEmulator(input.android)) return 'emulator';
  // 4) EAS preview 프로파일. 🔑 값이 **있을 때만** 본다 — 비어 있다고 preview 로 치면
  //    env 주입이 빠진 스토어 빌드의 실사용자 전체가 내부로 빠진다.
  if (input.appEnv && input.appEnv !== 'production') return 'preview';
  // 5) 나머지는 실사용자 쪽으로 둔다.
  return 'release';
}

// ─── 런타임 조회 ──────────────────────────────────────────────────────────────

/** 채널은 실행 중에 바뀌지 않으므로 한 번만 계산한다. `undefined` = 아직 계산 전. */
let cachedChannel: BuildChannel | null | undefined;

/**
 * 현재 실행 환경의 채널. **절대 throw 하지 않는다.**
 *
 * @returns 빌드 채널. 판별 중 예외가 나면 null("모름") — `release` 로 뭉개지 않는다.
 *          추측값을 넣으면 옛 번들의 null 과 섞여 "모름"을 구분할 수 없게 되기 때문이다.
 */
export function getBuildChannel(): BuildChannel | null {
  if (cachedChannel !== undefined) return cachedChannel;
  try {
    const platformOS = Platform.OS;
    // 웹에서만 location 이 의미 있다. RN 네이티브에는 location 이 없다.
    const loc = (globalThis as { location?: { hostname?: string } }).location;
    const webHostname = platformOS === 'web' ? (loc?.hostname ?? null) : null;

    cachedChannel = resolveBuildChannel({
      platformOS,
      isDev: typeof __DEV__ !== 'undefined' && __DEV__ === true,
      appEnv: process.env.EXPO_PUBLIC_APP_ENV,
      webHostname,
      android: platformOS === 'android'
        ? (Platform.constants as AndroidBuildConstants)
        : undefined,
    });
  } catch {
    cachedChannel = null;
  }
  return cachedChannel;
}

/**
 * 테스트용 — 캐시를 비운다. 프로덕션 코드에서 부를 일은 없다.
 */
export function __resetBuildChannelForTest(): void {
  cachedChannel = undefined;
}
