/**
 * freeTimeRecommend unit tests — v1.2 Phase 3.
 */

import { findNextFreeSlot } from '@/lib/freeTimeRecommend';

describe('findNextFreeSlot', () => {
  const baseNow = new Date('2026-05-20T10:00:00');  // 화요일 오전 10시

  it('일정 없으면 활동시간(7-23) 안에서 슬롯 반환', () => {
    const slot = findNextFreeSlot([], baseNow);
    expect(slot).not.toBeNull();
    expect(slot!.suggestion.length).toBeGreaterThan(0);
  });

  it('다음 일정까지 60분 이상 비면 슬롯 반환', () => {
    const events = [
      { startAt: new Date('2026-05-20T14:00:00'), endAt: new Date('2026-05-20T15:00:00') },
    ];
    const slot = findNextFreeSlot(events, baseNow);
    expect(slot).not.toBeNull();
    expect(slot!.startAt.getHours()).toBe(10);
    expect(slot!.endAt.getHours()).toBe(14);
  });

  it('60분 미만 빈 슬롯은 skip 후 다음 빈 시간 탐색', () => {
    const events = [
      { startAt: new Date('2026-05-20T10:30:00'), endAt: new Date('2026-05-20T11:30:00') },
    ];
    const slot = findNextFreeSlot(events, baseNow);
    expect(slot).not.toBeNull();
    // 10:00-10:30 만 (30분) → skip → 11:30 이후 슬롯 찾음
    expect(slot!.startAt.getTime()).toBeGreaterThanOrEqual(new Date('2026-05-20T11:30:00').getTime());
  });

  it('새벽 시간(00-07)은 활동 시간 밖으로 분류', () => {
    const lateNight = new Date('2026-05-20T02:00:00');
    const slot = findNextFreeSlot([], lateNight);
    expect(slot).not.toBeNull();
    expect(slot!.startAt.getHours()).toBeGreaterThanOrEqual(7);
  });

  it('현재 시간 이전 일정은 무시', () => {
    const events = [
      { startAt: new Date('2026-05-20T08:00:00'), endAt: new Date('2026-05-20T09:00:00') }, // 과거
    ];
    const slot = findNextFreeSlot(events, baseNow);
    expect(slot).not.toBeNull();
    expect(slot!.startAt.getTime()).toBeGreaterThanOrEqual(baseNow.getTime());
  });
});
