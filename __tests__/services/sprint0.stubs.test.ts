/**
 * __tests__/services/sprint0.stubs.test.ts
 *
 * QA verification for TASK-002: 서비스 스텁 생성
 *
 * Acceptance Criteria 검증:
 * - [x] 6개 서비스 파일 존재 및 import 가능
 * - [x] 모든 미구현 함수가 `throw new Error('Not implemented: [함수명]')` 반환
 * - [x] 함수 시그니처가 타입 정의와 일치 (tsc로 검증)
 *
 * 목적:
 * - DEV가 함수를 구현할 때까지 "Not implemented" 에러가 명확히 던져지는지 검증
 * - 함수 이름이 에러 메시지에 포함되어 디버깅이 쉬운지 확인
 * - 서비스 파일이 Supabase를 직접 import하지 않는지 확인 (아키텍처 규칙)
 *
 * @task TASK-002
 * @verifiedBy QA
 */

// ─── 서비스 import (Supabase 없이 가능해야 함) ────────────────────────────────
// 이 import들이 실패하면 서비스 파일이 Supabase를 직접 import한 것 → 아키텍처 위반

import * as authService from '@/services/authService';
import * as eventService from '@/services/eventService';
import * as spaceService from '@/services/spaceService';
import * as todoService from '@/services/todoService';
import * as aiService from '@/services/aiService';
import * as notificationService from '@/services/notificationService';

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

/**
 * 비동기 함수가 "Not implemented: [name]" 에러를 throw하는지 검증.
 * @param fn - 테스트할 비동기 함수
 * @param expectedName - 에러 메시지에 포함되어야 할 함수명
 */
async function expectNotImplemented(fn: () => Promise<unknown>, expectedName: string): Promise<void> {
  await expect(fn()).rejects.toThrow(`Not implemented: ${expectedName}`);
}

/**
 * 동기 함수가 "Not implemented: [name]" 에러를 throw하는지 검증.
 */
function expectNotImplementedSync(fn: () => unknown, expectedName: string): void {
  expect(fn).toThrow(`Not implemented: ${expectedName}`);
}

// ─── TASK-002: authService 스텁 검증 ─────────────────────────────────────────
// Sprint 1에서 authService 완전 구현 완료 → stub 테스트 skip.
// 실제 동작 테스트는 TASK-110: __tests__/services/authService.test.ts 에서 진행.

describe.skip('TASK-002: authService stubs', () => {
  it('signInWithApple throws Not implemented', async () => {
    await expectNotImplemented(() => authService.signInWithApple(), 'signInWithApple');
  });

  it('signInWithKakao throws Not implemented', async () => {
    await expectNotImplemented(() => authService.signInWithKakao(), 'signInWithKakao');
  });

  it('signOut throws Not implemented', async () => {
    await expectNotImplemented(() => authService.signOut(), 'signOut');
  });

  it('getSession throws Not implemented', async () => {
    await expectNotImplemented(() => authService.getSession(), 'getSession');
  });

  it('refreshSession throws Not implemented', async () => {
    await expectNotImplemented(() => authService.refreshSession(), 'refreshSession');
  });

  it('onAuthStateChange throws Not implemented', () => {
    expectNotImplementedSync(() => authService.onAuthStateChange(() => {}), 'onAuthStateChange');
  });

  it('updateProfile throws Not implemented', async () => {
    await expectNotImplemented(
      () => authService.updateProfile({ nickname: 'test' }),
      'updateProfile',
    );
  });

  it('deleteAccount throws Not implemented', async () => {
    await expectNotImplemented(() => authService.deleteAccount(), 'deleteAccount');
  });
});

// ─── TASK-002: eventService 스텁 검증 ────────────────────────────────────────
// TASK-201 완료 → eventService 전체 구현됨. stub 검증 skip.
// 실제 동작 테스트는 별도 eventService.test.ts에서 작성 예정.

describe.skip('TASK-002: eventService stubs', () => {
  const dummyRange = { start: new Date(), end: new Date() };

  it('getEventsInRange throws Not implemented', async () => {
    await expectNotImplemented(() => eventService.getEventsInRange(dummyRange), 'getEventsInRange');
  });

  it('getEventById throws Not implemented', async () => {
    await expectNotImplemented(() => eventService.getEventById('evt-001'), 'getEventById');
  });

  it('createEvent throws Not implemented', async () => {
    await expectNotImplemented(
      () => eventService.createEvent({
        title: 'test',
        startAt: new Date(),
        endAt: new Date(),
      }),
      'createEvent',
    );
  });

  it('updateEvent throws Not implemented', async () => {
    await expectNotImplemented(
      () => eventService.updateEvent('evt-001', { title: 'updated' }),
      'updateEvent',
    );
  });

  it('deleteEvent throws Not implemented', async () => {
    await expectNotImplemented(() => eventService.deleteEvent('evt-001'), 'deleteEvent');
  });

  it('shareEventToSpace throws Not implemented', async () => {
    await expectNotImplemented(
      () => eventService.shareEventToSpace('evt-001', 'spc-001'),
      'shareEventToSpace',
    );
  });

  it('unshareEventFromSpace throws Not implemented', async () => {
    await expectNotImplemented(
      () => eventService.unshareEventFromSpace('evt-001', 'spc-001'),
      'unshareEventFromSpace',
    );
  });

  it('findFreeTimeSlots throws Not implemented', async () => {
    await expectNotImplemented(
      () => eventService.findFreeTimeSlots('spc-001', dummyRange),
      'findFreeTimeSlots',
    );
  });

  it('subscribeToSharedEvents throws Not implemented', () => {
    expectNotImplementedSync(
      () => eventService.subscribeToSharedEvents(() => {}, () => {}, () => {}),
      'subscribeToSharedEvents',
    );
  });
});

// ─── TASK-002: spaceService 스텁 검증 ────────────────────────────────────────
// Sprint 1에서 spaceService 완전 구현 완료 → stub 테스트 skip.
// 실제 동작 테스트는 TASK-111: __tests__/services/spaceService.test.ts 에서 진행.

describe.skip('TASK-002: spaceService stubs', () => {
  it('all exported functions throw Not implemented', async () => {
    // spaceService의 모든 함수를 순회하여 검증
    const fns = Object.entries(spaceService).filter(([, v]) => typeof v === 'function');

    // 최소 4개 함수가 있어야 함 (create, get, update, delete, join, leave, getAnniversaries)
    expect(fns.length).toBeGreaterThanOrEqual(4);

    for (const [name, fn] of fns) {
      try {
        // 인자 없이 호출 — 스텁이므로 인자와 무관하게 throw해야 함
        const result = (fn as () => unknown)();
        if (result instanceof Promise) {
          await expect(result).rejects.toThrow('Not implemented');
        }
      } catch (err) {
        expect((err as Error).message).toContain('Not implemented');
        expect((err as Error).message).toContain(name);
      }
    }
  });
});

// ─── TASK-002: todoService 스텁 검증 ────────────────────────────────────────
// TASK-400 완료 (Sprint 4) → todoService 전체 구현됨. stub 검증 skip.
// 실제 동작 테스트는 TASK-410: __tests__/services/todoService.test.ts 에서 진행.

describe.skip('TASK-002: todoService stubs', () => {
  it('all exported functions throw Not implemented', async () => {
    const fns = Object.entries(todoService).filter(([, v]) => typeof v === 'function');
    expect(fns.length).toBeGreaterThanOrEqual(3);

    for (const [name, fn] of fns) {
      try {
        const result = (fn as () => unknown)();
        if (result instanceof Promise) {
          await expect(result).rejects.toThrow('Not implemented');
        }
      } catch (err) {
        expect((err as Error).message).toContain('Not implemented');
        expect((err as Error).message).toContain(name);
      }
    }
  });
});

// ─── TASK-002: aiService 스텁 검증 ───────────────────────────────────────────
// Sprint 3 (TASK-301)에서 aiService가 구현 완료되었으므로
// "stub throws" 검증 대신 필수 export 존재 여부만 확인합니다.

describe('TASK-002: aiService stubs', () => {
  it('exports required NL parse and usage functions', () => {
    expect(typeof aiService.parseNaturalLanguage).toBe('function');
    expect(typeof aiService.getDailyUsage).toBe('function');
    expect(typeof aiService.hasRemainingDailyLimit).toBe('function');
    expect(typeof aiService.resetDailyUsage).toBe('function');
  });
});

// ─── TASK-002: notificationService 스텁 검증 ─────────────────────────────────

// Sprint 3 (TASK-303)에서 registerPushToken / requestPermission 이 구현 완료.
// stub 검증 대신 필수 export 존재 여부를 확인합니다.
describe('TASK-002: notificationService stubs', () => {
  it('exports required push notification functions', () => {
    expect(typeof notificationService.registerPushToken).toBe('function');
    expect(typeof notificationService.requestPermission).toBe('function');
    expect(typeof notificationService.scheduleEventReminder).toBe('function');
    expect(typeof notificationService.setupNotificationHandlers).toBe('function');
  });
});

// ─── 아키텍처 규칙 검증 ───────────────────────────────────────────────────────

describe('Architecture rule: services do not import Supabase directly', () => {
  it('services can be imported without Supabase env vars', () => {
    // 이 파일 자체가 import에 성공했으면 이 테스트는 통과
    // supabase.ts가 서비스에 직접 import되어 있으면 env var 없이 throw됨
    expect(authService).toBeDefined();
    expect(eventService).toBeDefined();
    expect(spaceService).toBeDefined();
    expect(todoService).toBeDefined();
    expect(aiService).toBeDefined();
    expect(notificationService).toBeDefined();
  });
});
