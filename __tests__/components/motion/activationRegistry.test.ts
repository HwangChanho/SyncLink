/**
 * activationRegistry 테스트 — "방금 완료" 표시가 한 번만, 짧은 시간 안에만 유효한지.
 * 이 규칙이 깨지면 팝이 아예 안 보이거나(만료가 너무 짧음) 엉뚱한 때 튄다(안 지워짐).
 */
import {
  consumeJustActivated,
  markJustActivated,
  subscribeActivation,
} from '@/components/motion/activationRegistry';

describe('activationRegistry', () => {
  it('표시 직후 한 번은 true, 두 번째는 false(한 번만 튄다)', () => {
    markJustActivated('todo:a', 1000);
    expect(consumeJustActivated('todo:a', 1100)).toBe(true);
    expect(consumeJustActivated('todo:a', 1150)).toBe(false);
  });

  it('800ms 가 지나면 무효(쌓였다가 엉뚱한 때 튀지 않게)', () => {
    markJustActivated('todo:b', 1000);
    expect(consumeJustActivated('todo:b', 1800)).toBe(false);
  });

  it('표시하지 않은 키는 false', () => {
    expect(consumeJustActivated('todo:none')).toBe(false);
  });
});

describe('activationRegistry — 구독(탭바 아이콘 경로)', () => {
  it('구독자가 처리하면(true) 표시가 지워진다 — 새로 마운트된 쪽이 또 튀지 않게', () => {
    const fn = jest.fn(() => true);
    const off = subscribeActivation('tab:home', fn);
    markJustActivated('tab:home', 5000);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(consumeJustActivated('tab:home', 5001)).toBe(false);
    off();
  });

  it('구독자가 무시하면(false) 표시가 남는다 — 곧 재마운트될 체크박스가 가져간다', () => {
    const off = subscribeActivation('todo:c', () => false);
    markJustActivated('todo:c', 6000);
    expect(consumeJustActivated('todo:c', 6100)).toBe(true);
    off();
  });

  it('구독 해제 후에는 불리지 않는다', () => {
    const fn = jest.fn(() => true);
    subscribeActivation('tab:x', fn)();
    markJustActivated('tab:x', 7000);
    expect(fn).not.toHaveBeenCalled();
  });
});
