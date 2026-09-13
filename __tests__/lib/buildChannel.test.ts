/**
 * __tests__/lib/buildChannel.test.ts
 *
 * 퍼널 기록의 빌드 채널 판별 계약을 고정한다 (2026-09-13).
 *
 * 이 판별이 틀리면 **에러 없이 분석이 거짓말을 한다** — 그래서 테스트가 유일한 안전망이다.
 * 지키려는 것은 네 가지:
 *  ① 판별 순서(웹 → dev → 에뮬레이터 → preview → release)
 *  ② 🔑 애매하면 release — 실사용자를 내부로 오분류해 분석에서 빼면 안 된다
 *  ③ 실기기 지문을 에뮬레이터로 잡지 않는다
 *  ④ 075 마이그레이션에 값 목록 check 가 없다 — 있으면 1.4.16 의 새 값이 조용히 버려진다
 *  ⑤ (3단계) 운영 웹의 크롤러만 bot — 사람 브라우저 UA 를 봇으로 잡지 않는다
 */

import { readFileSync } from 'fs';
import path from 'path';

import {
  resolveBuildChannel,
  isAndroidEmulator,
  isKnownBotUserAgent,
  PRODUCTION_WEB_HOSTS,
  type BuildChannelInput,
} from '@/lib/buildChannel';

/** 실사용자 스토어 빌드에 해당하는 기본 입력. 각 테스트는 필요한 값만 덮어쓴다. */
const base: BuildChannelInput = {
  platformOS: 'ios',
  isDev: false,
  appEnv: 'production',
  webHostname: null,
  android: undefined,
};

// 실측 지문 — 공식 에뮬레이터 이미지 / 실기기 두 종
const EMULATOR_FP = 'google/sdk_gphone64_arm64/emu64a:14/UE1A.230829.036.A1/11228894:userdebug/dev-keys';
const PIXEL_FP = 'google/husky/husky:14/AP1A.240305.019.A1/11445699:user/release-keys';
const SAMSUNG_FP = 'samsung/b0qksx/b0q:14/UP1A.231005.007/S908NKSU4EXA1:user/release-keys';

describe('resolveBuildChannel', () => {
  describe('웹 — hostname 이 결정한다', () => {
    it('운영 도메인이면 web', () => {
      expect(resolveBuildChannel({ ...base, platformOS: 'web', webHostname: 'synclink.pages.dev' })).toBe('web');
    });

    it.each([
      ['localhost', 'localhost'],
      ['127.0.0.1', '127.0.0.1'],
      // Cloudflare 프리뷰 배포는 내부 확인용이다 — 운영 도메인과 **정확히 일치**해야 web
      ['프리뷰 배포', 'abc123.synclink.pages.dev'],
    ])('%s 는 web_local', (_label, host) => {
      expect(resolveBuildChannel({ ...base, platformOS: 'web', webHostname: host })).toBe('web_local');
    });

    it('hostname 을 못 읽으면 운영이라 단정하지 않고 web_local', () => {
      expect(resolveBuildChannel({ ...base, platformOS: 'web', webHostname: null })).toBe('web_local');
    });

    it('웹은 __DEV__ 보다 hostname 을 먼저 본다 (로컬 dev 웹 = web_local)', () => {
      expect(resolveBuildChannel({ ...base, platformOS: 'web', isDev: true, webHostname: 'localhost' })).toBe('web_local');
    });

    it('운영 도메인 목록에 프리뷰 와일드카드가 섞여 있지 않다', () => {
      // 목록에 넓은 패턴이 들어오면 내부 프리뷰가 운영으로 집계된다.
      expect(PRODUCTION_WEB_HOSTS).toEqual(['synclink.pages.dev']);
    });
  });

  describe('네이티브', () => {
    it('__DEV__ 면 dev (시뮬 검증용 expo run:ios 포함)', () => {
      expect(resolveBuildChannel({ ...base, isDev: true })).toBe('dev');
    });

    it('dev 는 에뮬레이터·preview 보다 우선한다', () => {
      expect(resolveBuildChannel({
        ...base, platformOS: 'android', isDev: true, appEnv: 'preview', android: { Fingerprint: EMULATOR_FP },
      })).toBe('dev');
    });

    it('Android 에뮬레이터면 emulator', () => {
      expect(resolveBuildChannel({ ...base, platformOS: 'android', android: { Fingerprint: EMULATOR_FP } })).toBe('emulator');
    });

    it('에뮬레이터 신호는 Android 에서만 본다', () => {
      // iOS 에 Android 상수가 섞여 들어와도(있을 수 없지만) 내부로 빼지 않는다.
      expect(resolveBuildChannel({ ...base, platformOS: 'ios', android: { Fingerprint: EMULATOR_FP } })).toBe('release');
    });

    it('EAS preview 프로파일이면 preview', () => {
      expect(resolveBuildChannel({ ...base, platformOS: 'android', appEnv: 'preview', android: { Fingerprint: PIXEL_FP } })).toBe('preview');
    });

    it('스토어 빌드 실기기는 release', () => {
      expect(resolveBuildChannel({ ...base, platformOS: 'android', android: { Fingerprint: PIXEL_FP } })).toBe('release');
      expect(resolveBuildChannel(base)).toBe('release');
    });
  });

  describe('🔑 애매하면 release — 실사용자를 내부로 빼지 않는다', () => {
    it.each([
      ['APP_ENV 가 비어 있음', undefined],
      ['APP_ENV 가 빈 문자열', ''],
    ])('%s → preview 가 아니라 release', (_label, appEnv) => {
      // env 주입이 빠진 스토어 빌드를 preview 로 치면 그 버전 사용자 전체가 분석에서 사라진다.
      expect(resolveBuildChannel({ ...base, appEnv })).toBe('release');
    });

    it('Android 상수를 못 받으면 에뮬레이터로 치지 않는다', () => {
      expect(resolveBuildChannel({ ...base, platformOS: 'android', android: undefined })).toBe('release');
    });
  });
});

describe('isAndroidEmulator', () => {
  it.each([
    ['공식 에뮬레이터 지문(sdk_gphone)', { Fingerprint: EMULATOR_FP }],
    ['AOSP generic 지문', { Fingerprint: 'generic/sdk_phone_x86/generic_x86:9/PSR1.180720.075/5124027:userdebug/test-keys' }],
    ['unknown 지문', { Fingerprint: 'unknown/sdk/generic:4.4/KK/1:eng/test-keys' }],
    ['모델명 Android SDK built for x86', { Fingerprint: 'x/y/z:1/A/1:user/release-keys', Model: 'Android SDK built for x86' }],
    ['Genymotion', { Fingerprint: 'x/y/z:1/A/1:user/release-keys', Manufacturer: 'Genymotion' }],
  ])('%s → true', (_label, c) => {
    expect(isAndroidEmulator(c)).toBe(true);
  });

  it.each([
    ['Pixel 8 Pro', { Fingerprint: PIXEL_FP, Model: 'Pixel 8 Pro', Manufacturer: 'Google', Brand: 'google' }],
    ['Galaxy S22 Ultra', { Fingerprint: SAMSUNG_FP, Model: 'SM-S908N', Manufacturer: 'samsung', Brand: 'samsung' }],
    ['빈 상수', {}],
    ['상수 없음', undefined],
  ])('실기기·정보 없음 %s → false', (_label, c) => {
    expect(isAndroidEmulator(c)).toBe(false);
  });
});

describe('075 마이그레이션 — 값 통제는 앱이, DB 는 길이만', () => {
  const raw = readFileSync(
    path.resolve(__dirname, '..', '..', 'supabase', 'migrations', '075_funnel_events_build_channel.sql'),
    'utf8',
  );
  // 🔑 실행되는 SQL 만 본다 — 주석에는 `in (...)` 을 쓰지 말라는 설명이 들어 있다.
  const sql = raw.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

  it('build_channel 을 재실행 안전하게 추가한다', () => {
    expect(sql).toMatch(/add column if not exists build_channel text/i);
  });

  it('nullable 이다 — 옛 번들(1.4.15 이하)은 이 값을 보내지 않는다', () => {
    expect(sql).not.toMatch(/build_channel[^;]*not null/i);
  });

  it('🔴 값 목록 check 가 없다 — 있으면 새 채널 값의 기록이 조용히 버려진다', () => {
    // trackFunnel 은 insert 오류를 삼킨다. 1.4.16 이 testflight 같은 새 값을 보내면
    // 옛 제약에 걸려 그 기기의 퍼널 기록 전체가 흔적 없이 사라진다.
    expect(sql).not.toMatch(/build_channel\s+in\s*\(/i);
    expect(sql).not.toMatch(/=\s*any\s*\(/i);
  });
});

describe('getBuildChannel — 런타임 조회', () => {
  // 모듈 캐시를 테스트마다 새로 받기 위해 isolateModules 안에서 require 한다.
  const load = () => {
    let mod!: typeof import('@/lib/buildChannel');
    let rn!: typeof import('react-native');
    jest.isolateModules(() => {
      rn = require('react-native');
      mod = require('@/lib/buildChannel');
    });
    return { mod, Platform: rn.Platform };
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('jest(__DEV__=true, iOS) 에서는 dev 이고, 한 번 정한 값은 실행 중 바뀌지 않는다', () => {
    const { mod, Platform } = load();
    const original = Platform.OS;
    expect(mod.getBuildChannel()).toBe('dev');
    // 첫 판별 뒤에 환경이 바뀐 것처럼 만들어도 캐시된 값이 나와야 한다.
    // (캐시가 없으면 여기서 web_local 이 나온다 — 같은 기기의 기록이 채널을 오가면 집계가 깨진다)
    (Platform as { OS: string }).OS = 'web';
    try {
      expect(mod.getBuildChannel()).toBe('dev');
    } finally {
      (Platform as { OS: string }).OS = original;
    }
  });

  it('🔴 판별 중 예외가 나도 throw 하지 않고 null("모름")을 돌려준다', () => {
    const { mod, Platform } = load();
    const original = Platform.OS;
    // Android 경로에서 Platform.constants 를 읽다가 네이티브 모듈이 터지는 상황
    (Platform as { OS: string }).OS = 'android';
    jest.spyOn(Platform, 'constants', 'get').mockImplementation(() => {
      throw new Error('native module missing');
    });
    try {
      expect(() => mod.getBuildChannel()).not.toThrow();
      mod.__resetBuildChannelForTest();
      expect(mod.getBuildChannel()).toBeNull();
    } finally {
      (Platform as { OS: string }).OS = original;
    }
  });
});

// ─── 2단계 — 네이티브 설치 출처 (1.4.16, modules/install-source) ─────────────

describe('resolveBuildChannel — 네이티브 설치 출처', () => {
  it.each([
    ['ios', 'simulator', 'simulator'],
    ['ios', 'testflight', 'testflight'],
    ['ios', 'sideload', 'sideload'],
    ['ios', 'app_store', 'app_store'],
    ['android', 'play', 'play'],
    ['android', 'sideload', 'sideload'],
    ['android', 'other_store', 'other_store'],
  ])('%s + %s → %s', (platformOS, installSource, expected) => {
    expect(resolveBuildChannel({ ...base, platformOS, installSource })).toBe(expected);
  });

  it.each([
    ['네이티브 모듈 없음(옛 바이너리·OTA)', 'ios', null],
    ['값이 unknown', 'android', 'unknown'],
    ['플랫폼 불일치 — iOS 인데 play', 'ios', 'play'],
    ['플랫폼 불일치 — Android 인데 app_store', 'android', 'app_store'],
    ['모르는 값(오타·새 값)', 'ios', 'testfligth'],
  ])('🔑 %s → release (확실한 신호가 아니면 실사용자 쪽)', (_label, platformOS, installSource) => {
    expect(resolveBuildChannel({ ...base, platformOS, installSource })).toBe('release');
  });

  it('dev 는 네이티브 값보다 우선한다 (개발 빌드도 시뮬레이터 표식을 갖는다)', () => {
    expect(resolveBuildChannel({ ...base, isDev: true, installSource: 'simulator' })).toBe('dev');
  });

  it('Android 에뮬레이터 판별은 네이티브 play 보다 우선한다', () => {
    expect(resolveBuildChannel({
      ...base, platformOS: 'android', android: { Fingerprint: EMULATOR_FP }, installSource: 'play',
    })).toBe('emulator');
  });

  it('preview 프로파일은 네이티브 sideload 보다 구체적이라 우선한다', () => {
    expect(resolveBuildChannel({
      ...base, platformOS: 'android', appEnv: 'preview', android: { Fingerprint: PIXEL_FP }, installSource: 'sideload',
    })).toBe('preview');
  });

  it('웹은 네이티브 값을 보지 않는다', () => {
    expect(resolveBuildChannel({
      ...base, platformOS: 'web', webHostname: 'synclink.pages.dev', installSource: 'testflight',
    })).toBe('web');
  });
});

describe('getBuildChannel — 네이티브 모듈 연결(런타임)', () => {
  // jest 는 __DEV__=true 라 그대로면 항상 dev 에서 끝난다 → 네이티브 경로를 보려고 잠시 끈다.
  const g = globalThis as { __DEV__?: boolean };
  let originalDev: boolean | undefined;
  beforeEach(() => { originalDev = g.__DEV__; g.__DEV__ = false; });
  afterEach(() => { g.__DEV__ = originalDev; jest.dontMock('expo-modules-core'); });

  /**
   * expo-modules-core 를 주어진 모듈 값으로 목킹한 뒤 buildChannel 을 새로 불러온다.
   * 🔑 isolateModules 안의 doMock 은 **이 파일이 위에서 이미 buildChannel 을 import 해
   *    expo-modules-core 가 로드된 상태**에서는 적용되지 않았다(진단 실측: mocked=null).
   *    그래서 레지스트리를 비우고(resetModules) 목을 건 뒤 require 한다.
   */
  const loadWithNative = (native: unknown): typeof import('@/lib/buildChannel') => {
    jest.resetModules();
    jest.doMock('expo-modules-core', () => ({ requireOptionalNativeModule: () => native }));
    return require('@/lib/buildChannel');
  };

  it('iOS 에서 모듈이 testflight 를 주면 testflight 로 기록된다', () => {
    expect(loadWithNative({ installSource: 'testflight' }).getBuildChannel()).toBe('testflight');
  });

  it('🔴 모듈이 없으면(1.4.15 이하 바이너리에 OTA 로 간 경우) 1단계처럼 release', () => {
    expect(loadWithNative(null).getBuildChannel()).toBe('release');
  });

  it('모듈은 있는데 값이 없으면 release', () => {
    expect(loadWithNative({}).getBuildChannel()).toBe('release');
  });
});

// ─── 3단계 — 운영 웹의 크롤러 표식 bot (2026-09-13 밤) ────────────────────────

// 실측 UA(09-06~13 Supabase 엣지 로그, 퍼널 insert 요청 헤더 원문)
const PLAY_CRAWLER_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.64 Safari/537.36 PlayStore-Google';
const GOOGLE_BARE_UA = 'Google';
// 실측 사람(내부 Mac Chrome) — 같은 표에서 봇과 나란히 찍혔다
const MAC_CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36';

describe('isKnownBotUserAgent', () => {
  it.each([
    ['실측 Play 크롤러(PlayStore-Google)', PLAY_CRAWLER_UA],
    ['실측 UA 가 딱 Google', GOOGLE_BARE_UA],
    ['앞뒤 공백이 붙은 Google', '  Google  '],
    ['Googlebot', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'],
    ['Googlebot 스마트폰(렌더링 Chrome)', 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'],
    ['AdsBot-Google', 'AdsBot-Google (+http://www.google.com/adsbot.html)'],
    ['Mediapartners-Google', 'Mediapartners-Google'],
    ['Google-InspectionTool', 'Mozilla/5.0 (compatible; Google-InspectionTool/1.0;)'],
    ['bingbot', 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)'],
    ['Applebot', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)'],
    ['HeadlessChrome', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/130.0.0.0 Safari/537.36'],
  ])('%s → true', (_label, ua) => {
    expect(isKnownBotUserAgent(ua)).toBe(true);
  });

  it.each([
    ['실측 Mac Chrome', MAC_CHROME_UA],
    ['iPhone Safari', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1'],
    ['Google 앱 인앱 브라우저(GSA)', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/380.0.782563498 Mobile/15E148 Safari/604.1'],
    // 🔑 합성 반례 — `Google` 정확 일치를 부분일치로 넓히면 여기서 걸린다(변이 검증에서 이것만 잡았다)
    ['UA 에 Google 이 들어 있을 뿐인 문자열(합성)', 'Google Chrome'],
    ['Android Chrome(갤럭시)', 'Mozilla/5.0 (Linux; Android 14; SM-S908N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36'],
    ['Samsung Internet', 'Mozilla/5.0 (Linux; Android 14; SM-S908N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36'],
    ['카카오톡 인앱', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 25.7.1'],
    ['네이버 인앱', 'Mozilla/5.0 (Linux; Android 14; SM-S908N wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/139.0.0.0 Mobile Safari/537.36 NAVER(inapp; search; 2000; 12.10.3)'],
    ['빈 문자열', ''],
    ['공백뿐', '   '],
    ['null', null],
    ['undefined', undefined],
  ])('사람·정보 없음 %s → false', (_label, ua) => {
    expect(isKnownBotUserAgent(ua)).toBe(false);
  });
});

describe('resolveBuildChannel — 운영 웹의 크롤러는 bot', () => {
  const web = { ...base, platformOS: 'web', webHostname: 'synclink.pages.dev' };

  it.each([
    ['Play 크롤러', PLAY_CRAWLER_UA],
    ['UA 가 딱 Google', GOOGLE_BARE_UA],
  ])('운영 도메인 + %s → bot', (_label, webUserAgent) => {
    expect(resolveBuildChannel({ ...web, webUserAgent })).toBe('bot');
  });

  it('운영 도메인 + 사람 브라우저 → web', () => {
    expect(resolveBuildChannel({ ...web, webUserAgent: MAC_CHROME_UA })).toBe('web');
  });

  it('🔑 UA 를 못 읽으면 봇이라 단정하지 않고 web (사람 쪽)', () => {
    expect(resolveBuildChannel({ ...web, webUserAgent: null })).toBe('web');
    expect(resolveBuildChannel({ ...web, webUserAgent: undefined })).toBe('web');
  });

  it('로컬·프리뷰는 봇 UA 여도 web_local 로 남는다 (헤드리스 스모크의 뜻을 바꾸지 않는다)', () => {
    expect(resolveBuildChannel({
      ...base, platformOS: 'web', webHostname: 'localhost', webUserAgent: 'Mozilla/5.0 HeadlessChrome/130.0.0.0',
    })).toBe('web_local');
    expect(resolveBuildChannel({
      ...base, platformOS: 'web', webHostname: 'abc123.synclink.pages.dev', webUserAgent: PLAY_CRAWLER_UA,
    })).toBe('web_local');
  });

  it('네이티브는 웹 UA 를 보지 않는다 (Apple 심사 기기는 이 방법으로 못 거른다)', () => {
    expect(resolveBuildChannel({ ...base, platformOS: 'ios', webUserAgent: PLAY_CRAWLER_UA, installSource: 'app_store' }))
      .toBe('app_store');
    expect(resolveBuildChannel({ ...base, platformOS: 'android', webUserAgent: GOOGLE_BARE_UA })).toBe('release');
  });
});

describe('getBuildChannel — 웹 UA 연결(런타임)', () => {
  const g = globalThis as Record<string, unknown>;
  let savedLocation: PropertyDescriptor | undefined;
  let savedNavigator: PropertyDescriptor | undefined;

  beforeEach(() => {
    savedLocation = Object.getOwnPropertyDescriptor(g, 'location');
    savedNavigator = Object.getOwnPropertyDescriptor(g, 'navigator');
  });

  afterEach(() => {
    // 전역을 원래 모양 그대로 되돌린다(없던 속성은 지운다) — 다른 테스트에 새지 않게.
    for (const [key, saved] of [['location', savedLocation], ['navigator', savedNavigator]] as const) {
      if (saved) Object.defineProperty(g, key, saved);
      else delete g[key];
    }
  });

  /**
   * 웹 환경(Platform.OS·location·navigator)을 만든 뒤 buildChannel 을 새로 불러와 채널을 읽는다.
   * @param hostname location.hostname
   * @param userAgent navigator.userAgent — undefined 면 navigator 에 userAgent 가 없는 상태
   * @returns 판별된 채널
   */
  const channelOnWeb = (hostname: string, userAgent: string | undefined) => {
    jest.resetModules();
    const { Platform } = require('react-native') as typeof import('react-native');
    const originalOS = Platform.OS;
    (Platform as { OS: string }).OS = 'web';
    Object.defineProperty(g, 'location', { value: { hostname }, configurable: true, writable: true });
    Object.defineProperty(g, 'navigator', {
      value: userAgent === undefined ? {} : { userAgent }, configurable: true, writable: true,
    });
    try {
      return (require('@/lib/buildChannel') as typeof import('@/lib/buildChannel')).getBuildChannel();
    } finally {
      (Platform as { OS: string }).OS = originalOS;
    }
  };

  it('운영 도메인에서 navigator.userAgent 가 Play 크롤러면 bot 으로 기록된다', () => {
    expect(channelOnWeb('synclink.pages.dev', PLAY_CRAWLER_UA)).toBe('bot');
  });

  it('운영 도메인의 사람 브라우저는 web', () => {
    expect(channelOnWeb('synclink.pages.dev', MAC_CHROME_UA)).toBe('web');
  });

  it('navigator 에 userAgent 가 없어도 throw 하지 않고 web', () => {
    expect(channelOnWeb('synclink.pages.dev', undefined)).toBe('web');
  });
});
