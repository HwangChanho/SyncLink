/**
 * loginPromptStore 퍼널 계측 회귀 방지 (1.4.14).
 *
 * 지키는 것 — "게스트가 막힌 순간"을 못 세게 되는 회귀:
 *  ① `open(source)` 하면 `login_prompt:<source>` 가 남는다.
 *  ② source 별로 다른 단계가 남는다 — 어느 동선에서 막혔는지 갈라야 하기 때문.
 *  ③ 계측이 상태 변경을 막지 않는다(시트는 어떤 경우에도 떠야 한다).
 *  ④ `close()` 는 아무것도 남기지 않는다.
 *
 * 🔑 계측을 스토어에 둔 이유가 곧 이 테스트의 이유다 — 호출부마다 흩어 두면
 *    새 호출부가 생길 때 빠뜨린다. 스토어에서 지키면 호출부가 늘어도 안전하다.
 */

jest.mock('@/services/funnelService', () => ({
  trackFunnel: jest.fn(),
}));

import { useLoginPromptStore } from '@/stores/loginPromptStore';
import { trackFunnel } from '@/services/funnelService';

describe('loginPromptStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useLoginPromptStore.setState({ visible: false, message: null });
  });

  it('open(source) 하면 login_prompt:<source> 를 남긴다', () => {
    useLoginPromptStore.getState().open('nl_input');

    expect(trackFunnel).toHaveBeenCalledWith('login_prompt:nl_input');
  });

  it('source 별로 다른 단계가 남는다', () => {
    useLoginPromptStore.getState().open('event_create');
    useLoginPromptStore.getState().open('planner');

    expect(trackFunnel).toHaveBeenNthCalledWith(1, 'login_prompt:event_create');
    expect(trackFunnel).toHaveBeenNthCalledWith(2, 'login_prompt:planner');
  });

  it('계측과 무관하게 시트는 뜬다 — message 도 그대로 전달된다', () => {
    useLoginPromptStore.getState().open('event_detail', '로그인하면 일정을 볼 수 있어요');

    const s = useLoginPromptStore.getState();
    expect(s.visible).toBe(true);
    expect(s.message).toBe('로그인하면 일정을 볼 수 있어요');
  });

  it('message 없이 열면 message 는 null 이다(기본 문구 사용)', () => {
    useLoginPromptStore.getState().open('suggestion');

    expect(useLoginPromptStore.getState().message).toBeNull();
  });

  it('close() 는 퍼널을 남기지 않는다', () => {
    useLoginPromptStore.getState().open('nl_input');
    (trackFunnel as jest.Mock).mockClear();

    useLoginPromptStore.getState().close();

    expect(useLoginPromptStore.getState().visible).toBe(false);
    expect(trackFunnel).not.toHaveBeenCalled();
  });
});
