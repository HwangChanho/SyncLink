/**
 * chatStore unit tests — v1.2 Phase 2.
 *
 * 윈도우 정책 + push 동작 검증.
 */

import { useChatStore } from '@/stores/chatStore';

describe('chatStore', () => {
  beforeEach(() => {
    useChatStore.setState({ messages: [], isOpen: false, isLoading: false });
  });

  it('pushUser 가 메시지를 끝에 append', () => {
    useChatStore.getState().pushUser('첫 발화');
    useChatStore.getState().pushUser('두 번째');
    const msgs = useChatStore.getState().messages;
    expect(msgs).toHaveLength(2);
    expect(msgs[0]?.content).toBe('첫 발화');
    expect(msgs[1]?.content).toBe('두 번째');
    expect(msgs[0]?.role).toBe('user');
  });

  it('pushAssistant — executed 배열 빈 경우 키 omit', () => {
    useChatStore.getState().pushAssistant('답');
    const m = useChatStore.getState().messages[0];
    expect(m?.role).toBe('assistant');
    expect(m?.executed).toBeUndefined();
  });

  it('pushAssistant — executed 있으면 함께 저장', () => {
    useChatStore.getState().pushAssistant('완료', [
      { tool: 'createEvent', ok: true, summary: '일정 1건' },
    ]);
    const m = useChatStore.getState().messages[0];
    expect(m?.executed).toHaveLength(1);
    expect(m?.executed?.[0]?.tool).toBe('createEvent');
  });

  it('getOutgoingMessages — 최근 20턴만 반환', () => {
    const s = useChatStore.getState();
    for (let i = 0; i < 25; i++) {
      s.pushUser(`u${i}`);
    }
    expect(s.getOutgoingMessages()).toHaveLength(20);
  });

  it('getOutgoingMessages — 30분 이전 메시지는 제외', () => {
    const now = Date.now();
    useChatStore.setState({
      messages: [
        { id: 'old', role: 'user', content: '옛날', createdAt: now - 35 * 60 * 1000 },
        { id: 'new', role: 'user', content: '최근', createdAt: now },
      ],
      isOpen: false,
      isLoading: false,
    });
    const out = useChatStore.getState().getOutgoingMessages();
    expect(out).toHaveLength(1);
    expect(out[0]?.content).toBe('최근');
  });

  it('clear 가 모든 메시지 제거', () => {
    useChatStore.getState().pushUser('test');
    useChatStore.getState().clear();
    expect(useChatStore.getState().messages).toHaveLength(0);
  });

  it('open/close 가 isOpen 토글', () => {
    useChatStore.getState().open();
    expect(useChatStore.getState().isOpen).toBe(true);
    useChatStore.getState().close();
    expect(useChatStore.getState().isOpen).toBe(false);
  });
});
