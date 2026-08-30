/**
 * __tests__/hooks/useRouteBreadcrumb.test.ts
 *
 * `sanitizeRoute` 의 계약을 고정한다.
 *
 * 이 함수가 하는 일은 하나다: **화면 이름은 남기고 식별자는 지운다.**
 * 두 방향 다 틀리면 안 된다 —
 *  ① 식별자가 새어나가면 제3자(Sentry)로 개인정보가 나간다.
 *  ② 너무 지워서 화면을 구분 못 하면 애초에 이걸 만든 이유가 사라진다
 *     (2026-08-30 크래시에서 "어느 화면인지 몰라" 원인 특정에 실패했다).
 */

jest.mock('expo-router', () => ({ usePathname: jest.fn() }));
jest.mock('@/lib/sentry', () => ({ addNavigationBreadcrumb: jest.fn() }));

import { sanitizeRoute } from '@/hooks/useRouteBreadcrumb';

describe('sanitizeRoute', () => {
  describe('식별자를 지운다', () => {
    it('UUID 를 [id] 로 바꾼다', () => {
      expect(sanitizeRoute('/event/9a3f1c2e-4b5d-6e7f-8a9b-0c1d2e3f4a5b'))
        .toBe('/event/[id]');
    });

    it('숫자 id 를 [n] 으로 바꾼다', () => {
      expect(sanitizeRoute('/space/12/chat')).toBe('/space/[n]/chat');
    });

    it('초대 코드를 [code] 로 바꾼다', () => {
      expect(sanitizeRoute('/space/join/AB12CD')).toBe('/space/join/[code]');
    });

    it('경로 끝의 숫자도 지운다', () => {
      expect(sanitizeRoute('/note/4821')).toBe('/note/[n]');
    });
  });

  describe('화면 이름은 지키다', () => {
    it.each([
      ['/', '/'],
      ['/auth/login', '/auth/login'],
      ['/event/create', '/event/create'],
      ['/settings/notifications', '/settings/notifications'],
      ['/subscription/paywall', '/subscription/paywall'],
    ])('%s 는 그대로 둔다', (input, expected) => {
      expect(sanitizeRoute(input)).toBe(expected);
    });

    it('식별자를 지운 뒤에도 어느 화면인지 구분된다', () => {
      const a = sanitizeRoute('/event/9a3f1c2e-4b5d-6e7f-8a9b-0c1d2e3f4a5b');
      const b = sanitizeRoute('/note/9a3f1c2e-4b5d-6e7f-8a9b-0c1d2e3f4a5b');
      expect(a).not.toBe(b);
    });
  });
});
