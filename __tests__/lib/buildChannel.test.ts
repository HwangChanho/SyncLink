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
 */

import { readFileSync } from 'fs';
import path from 'path';

import {
  resolveBuildChannel,
  isAndroidEmulator,
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
