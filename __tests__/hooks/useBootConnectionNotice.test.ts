/**
 * __tests__/hooks/useBootConnectionNotice.test.ts
 *
 * 부팅이 오래 걸리거나 서버에 닿지 않을 때 «연결 안내» 를 켜는 훅 테스트. (2026-11-27)
 *
 * 왜 이 테스트가 필요한가:
 *  ① **시간 감시** — 인증 초기화나 프로필 조회가 응답 없이 멈추면(Android OkHttp 는
 *     시간 제한 0 = 무제한) 앱이 스켈레톤에 영원히 머문다. 일정 시간 뒤 안내가 켜져야 한다.
 *  ② **즉시 보고** — 조회가 '서버에 닿지 않음' 으로 끝나면 타이머를 기다리지 않고 바로 켠다.
 *  ③ 🔴 **부팅이 끝나면 즉시 꺼진다** — 늦게라도 프로필이 오면 안내가 홈 위에 남으면 안 된다.
 *  ④ 부팅이 끝난 뒤의 보고는 다음 부팅에 새지 않는다.
 *
 * Mock 전략: jest 가짜 타이머로 시간을 직접 넘긴다.
 */

import { act, renderHook } from '@testing-library/react-native';
import { useBootConnectionNotice } from '@/hooks/useBootConnectionNotice';

/** 테스트에서 쓰는 감시 시간(ms) — 실제 기본값과 무관하게 짧게 고정. */
const DELAY = 1000;

describe('useBootConnectionNotice', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('부팅 중이어도 감시 시간 전에는 꺼져 있다', () => {
    const { result } = renderHook(() => useBootConnectionNotice(true, DELAY));
    act(() => { jest.advanceTimersByTime(DELAY - 1); });
    expect(result.current.visible).toBe(false);
  });

  it('부팅이 감시 시간을 넘기면 켜진다', () => {
    const { result } = renderHook(() => useBootConnectionNotice(true, DELAY));
    act(() => { jest.advanceTimersByTime(DELAY); });
    expect(result.current.visible).toBe(true);
  });

  it('부팅 중 reportUnreachable 은 타이머를 기다리지 않고 바로 켠다', () => {
    const { result } = renderHook(() => useBootConnectionNotice(true, DELAY));
    act(() => { result.current.reportUnreachable(); });
    expect(result.current.visible).toBe(true);
  });

  it('부팅이 끝나면 켜져 있던 안내가 바로 꺼진다', () => {
    const { result, rerender } = renderHook(
      ({ booting }: { booting: boolean }) => useBootConnectionNotice(booting, DELAY),
      { initialProps: { booting: true } },
    );
    act(() => { jest.advanceTimersByTime(DELAY); });
    expect(result.current.visible).toBe(true);
    rerender({ booting: false });
    expect(result.current.visible).toBe(false);
  });

  it('부팅이 아닐 때는 시간이 지나도 켜지지 않는다', () => {
    const { result } = renderHook(() => useBootConnectionNotice(false, DELAY));
    act(() => { jest.advanceTimersByTime(DELAY * 5); });
    expect(result.current.visible).toBe(false);
  });

  it('부팅이 끝난 뒤의 보고는 다음 부팅에서 바로 켜지지 않는다', () => {
    const { result, rerender } = renderHook(
      ({ booting }: { booting: boolean }) => useBootConnectionNotice(booting, DELAY),
      { initialProps: { booting: false } },
    );
    act(() => { result.current.reportUnreachable(); });
    rerender({ booting: true });
    expect(result.current.visible).toBe(false);
  });
});
