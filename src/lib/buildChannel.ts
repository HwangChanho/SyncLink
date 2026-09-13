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
 * | `web_local` | 운영 도메인이 아닌 웹 — localhost·프리뷰 배포·hostname 을 못 읽음 |
 * | `bot`       | 운영 도메인 웹인데 UA 가 알려진 크롤러(스토어 심사 봇 등) — 3단계 |
 * | `web`       | 그 밖의 운영 도메인 웹 |
 * | `dev`       | 네이티브 `__DEV__` (Metro 개발 번들 — `expo run:ios` 시뮬 검증 포함) |
 * | `emulator`  | Android 에뮬레이터 |
 * | `preview`   | EXPO_PUBLIC_APP_ENV 가 값이 있고 production 이 아님 (EAS preview 프로파일 APK) |
 * | `simulator` · `testflight` · `sideload` · `app_store` (iOS) | 네이티브 InstallSource 모듈 (1.4.16~) |
 * | `play` · `sideload` · `other_store` (Android)                 | 네이티브 InstallSource 모듈 (1.4.16~) |
 * | `release`   | 나머지 — 네이티브 모듈이 없는 옛 바이너리(1.4.15 이하·OTA)·판별 실패 |
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
 * ## 2단계 — 네이티브 설치 출처 (1.4.16, modules/install-source)
 *
 * iOS 는 TestFlight 와 App Store 가 **같은 바이너리**라 빌드 시점 값으로 못 가른다 → 설치된 뒤
 * 네이티브가 영수증 경로(`sandboxReceipt`)·프로비저닝 파일·시뮬레이터 여부로 판별한다.
 * Android 는 설치 주체 패키지(com.android.vending = Play)로 가른다.
 * 🔑 **모듈이 없으면 1단계와 똑같이 동작한다**(`requireOptionalNativeModule` → null → release).
 *    그래서 이 JS 가 OTA 로 옛 바이너리(1.4.15)에 가도 안전하다.
 * ⚠️ DB 컬럼 코멘트(075)는 1단계 값만 적혀 있다 — 값 목록은 이 파일이 기준이다.
 *
 * ## 3단계 — 웹 크롤러 표식 `bot` (2026-09-13 밤, 엣지 로그 실측)
 *
 * 로그 보존 7일 안의 퍼널 기기 33대를 Supabase 엣지 로그(국가·UA)와 1:1 매칭했더니
 * **웹 14대가 Google 봇**이었다(UA `…PlayStore-Google` 9 · UA 가 딱 `Google` 5, 전부 미국,
 * Play 제출 직후에 몰림). 엣지 로그는 7일이면 사라져 그 뒤엔 사람과 못 가른다 → 기록 시점에 표식을 남긴다.
 * 🔑 **운영 도메인일 때만 본다** — 로컬·프리뷰는 이미 `web_local` 이라 분석에서 빠지고,
 *    로컬 스모크(헤드리스 Playwright)가 `bot` 으로 바뀌면 `web_local` 의 뜻이 흐려진다.
 * ⚠️ **iOS 의 Apple 심사 기기는 여기서 못 거른다** — 앱 UA 는 사람과 같고 설치 출처도 `app_store` 다.
 *    그쪽은 "심사 제출 후 ~20분 안에 처음 나타난 게스트 기기" 규칙으로 분석 때 거른다.
 */

import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * 빌드 채널. DB 는 자유 text(길이만 제한)라 **값 통제는 이 타입이 전부**다.
 * 🔴 값을 추가할 때 DB 에 `in (...)` check 를 걸지 말 것 — trackFunnel 이 insert 오류를
 *    삼키므로, 옛 제약에 걸린 새 값은 기록째 조용히 사라진다(075 주석).
 */
export type BuildChannel =
  | 'web' | 'web_local' | 'dev' | 'emulator' | 'preview'
  // 2단계 — 네이티브 설치 출처
  | 'simulator' | 'testflight' | 'sideload' | 'app_store' | 'play' | 'other_store'
  // 3단계 — 운영 웹의 알려진 크롤러
  | 'bot'
  | 'release';

/**
 * 네이티브 모듈이 주는 설치 출처(modules/install-source).
 * iOS: simulator | testflight | sideload | app_store — Android: play | sideload | other_store | unknown
 */
export type NativeInstallSource =
  | 'simulator' | 'testflight' | 'sideload' | 'app_store' | 'play' | 'other_store' | 'unknown';

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
   * 웹일 때 `navigator.userAgent`. 네이티브이거나 못 읽으면 null/undefined.
   * 선택 필드인 이유: 1·2단계 호출부·테스트는 이 값 없이도 그대로 동작해야 한다(없으면 봇 판정 안 함).
   */
  webUserAgent?: string | null | undefined;
  /**
   * Android 일 때 `Platform.constants`. 그 밖엔 undefined.
   * (`| undefined` 명시 — tsconfig 의 exactOptionalPropertyTypes 가 켜져 있어,
   *  없으면 "키는 있는데 값이 undefined" 를 넘길 수 없다)
   */
  android?: AndroidBuildConstants | undefined;
  /**
   * 네이티브 InstallSource 모듈의 값. 모듈이 없으면(옛 바이너리·웹·테스트) null/undefined.
   * 타입을 string 으로 넓게 받는 이유: 네이티브가 모르는 값을 보내도 여기서 걸러 release 로 둔다.
   */
  installSource?: string | null | undefined;
};

/** 플랫폼별로 **받아들이는** 네이티브 값 → 채널. 목록에 없는 값(unknown·오타·플랫폼 불일치)은 release. */
const NATIVE_CHANNELS: Readonly<Record<string, Readonly<Record<string, BuildChannel>>>> = {
  ios: { simulator: 'simulator', testflight: 'testflight', sideload: 'sideload', app_store: 'app_store' },
  android: { play: 'play', sideload: 'sideload', other_store: 'other_store' },
};

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * 운영 웹 도메인. 여기에 **정확히 일치**해야 `web` 이다.
 * ⚠️ Cloudflare 프리뷰 배포(`<hash>.synclink.pages.dev`)는 일부러 제외한다 — 내부 확인용이다.
 * 커스텀 도메인을 붙이면 여기에 추가할 것(안 하면 그 도메인의 실사용자가 `web_local` 로 빠진다).
 */
export const PRODUCTION_WEB_HOSTS: readonly string[] = ['synclink.pages.dev'];

/**
 * UA **전체**가 이 값과 정확히 같으면 봇이다(앞뒤 공백만 무시).
 *
 * 실측(09-06~13 엣지 로그): UA 가 딱 `Google` 한 단어인 요청 10건 — 전부 미국, Play 제출 직후.
 * 🔑 부분일치로 넓히지 않는다 — 실측된 봇 신호는 "UA 전체가 Google" 뿐이고, "Google 이 들어 있음"은
 *    근거 없는 확장이다(참고: Google 앱 인앱 브라우저 UA 는 `GSA/…` 형식이라 이 단어로 사람을 가를 수도 없다).
 */
const BOT_UA_EXACT: readonly string[] = ['Google'];

/**
 * UA 에 이 토큰이 **들어 있으면** 봇이다. 사람 브라우저에는 나오지 않는, 크롤러가 스스로 밝히는 표식만 둔다.
 *
 * - `PlayStore-Google` : 실측 18건 — Google Play 크롤러(Linux Chrome UA 끝에 붙는다)
 * - `Googlebot` · `AdsBot-Google` · `Mediapartners-Google` · `Google-InspectionTool` : Google 공식 크롤러
 * - `bingbot` · `Applebot` : Bing·Apple 공식 크롤러
 * - `HeadlessChrome` : 사람이 쓰는 브라우저가 아니다(자동화 도구). 로컬 스모크는 hostname 에서 이미 web_local 로 끝난다.
 *
 * 🔴 `bot`·`crawler`·`spider` 같은 **넓은 단어는 넣지 말 것** — "애매하면 사람 쪽" 원칙에 어긋나고,
 *    오분류된 실사용자는 분석에서 소리 없이 사라진다(표본이 원래 하루 0.2설치다).
 */
const BOT_UA_TOKENS = /PlayStore-Google|Googlebot|AdsBot-Google|Mediapartners-Google|Google-InspectionTool|bingbot|Applebot|HeadlessChrome/i;

// ─── 판별 ─────────────────────────────────────────────────────────────────────

/**
 * 웹 UA 가 알려진 크롤러인지 — **사람 브라우저를 절대 걸지 않는** 좁은 신호만 쓴다.
 *
 * @param ua `navigator.userAgent`. null·undefined·빈 문자열이면 판단 근거가 없으므로 false
 * @returns 봇 신호(정확 일치 또는 크롤러 토큰)가 있으면 true
 */
export function isKnownBotUserAgent(ua: string | null | undefined): boolean {
  if (!ua) return false;
  const trimmed = ua.trim();
  if (trimmed === '') return false;
  // ① UA 전체가 봇 이름 그대로인 경우(실측 `Google`)
  if (BOT_UA_EXACT.includes(trimmed)) return true;
  // ② 크롤러가 스스로 붙이는 토큰
  return BOT_UA_TOKENS.test(trimmed);
}

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
    const isProductionHost = input.webHostname !== null && PRODUCTION_WEB_HOSTS.includes(input.webHostname);
    if (!isProductionHost) return 'web_local';
    // 운영 도메인에 온 알려진 크롤러(스토어 심사 봇 등). UA 를 못 읽으면 사람 쪽(web)으로 둔다.
    return isKnownBotUserAgent(input.webUserAgent) ? 'bot' : 'web';
  }
  // 2) Metro 개발 번들. 스토어·TestFlight 의 release 번들에서는 항상 false 다.
  if (input.isDev) return 'dev';
  // 3) Android 에뮬레이터 (iOS 시뮬레이터는 JS 신호가 없어 1단계에선 못 가른다)
  if (input.platformOS === 'android' && isAndroidEmulator(input.android)) return 'emulator';
  // 4) EAS preview 프로파일. 🔑 값이 **있을 때만** 본다 — 비어 있다고 preview 로 치면
  //    env 주입이 빠진 스토어 빌드의 실사용자 전체가 내부로 빠진다.
  if (input.appEnv && input.appEnv !== 'production') return 'preview';
  // 5) 네이티브 설치 출처(1.4.16~). 🔑 플랫폼 표에 있는 값만 받는다 —
  //    iOS 인데 'play' 같은 불일치나 'unknown' 은 확실한 신호가 아니므로 release.
  const native = input.installSource ? NATIVE_CHANNELS[input.platformOS]?.[input.installSource] : undefined;
  if (native) return native;
  // 6) 나머지는 실사용자 쪽으로 둔다(모듈 없는 옛 바이너리 포함).
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
    // UA 도 웹에서만 읽는다. RN 네이티브의 navigator 에는 userAgent 가 없거나 의미가 다르다.
    const nav = (globalThis as { navigator?: { userAgent?: string } }).navigator;
    const webUserAgent = platformOS === 'web' ? (nav?.userAgent ?? null) : null;

    cachedChannel = resolveBuildChannel({
      platformOS,
      isDev: typeof __DEV__ !== 'undefined' && __DEV__ === true,
      appEnv: process.env.EXPO_PUBLIC_APP_ENV,
      // 모듈이 없으면 null — 옛 바이너리·웹·jest 에서도 예외 없이 1단계로 떨어진다.
      installSource: platformOS === 'web'
        ? null
        : (requireOptionalNativeModule<{ installSource?: string }>('InstallSource')?.installSource ?? null),
      webHostname,
      webUserAgent,
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
