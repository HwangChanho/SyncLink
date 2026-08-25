/**
 * chatStore — AI 비서 멀티턴 채팅의 클라이언트 상태 (v1.2 Phase 2).
 *
 * 현재 세션의 messages 만 메모리에 보관. 영구 저장은 v1.2.1+에서 검토 (Supabase
 * `assistant_chat_logs` 테이블).
 *
 * 윈도우 정책: 마지막 20턴 또는 30분 보다 오래된 메시지는 자동 폐기. 컨텍스트
 * 비용 / Edge Fn payload 크기 둘 다 절약.
 */

import { create } from 'zustand';

/** UI 표시용 메시지. id 는 React key 와 streaming 갱신용. */
export interface ChatUiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** assistant 메시지에 부수된 실행 결과 (예: "일정 1건 생성됨"). */
  executed?: { tool: string; ok: boolean; summary: string }[];
  createdAt: number;
}

interface ChatState {
  messages: ChatUiMessage[];
  /** 모달/시트 open 상태 — ChatFab 트리거. */
  isOpen: boolean;
  /** 현재 LLM 응답 대기 중. UI 에서 로딩 인디케이터. */
  isLoading: boolean;

  open: () => void;
  close: () => void;
  pushUser: (text: string) => void;
  pushAssistant: (text: string, executed?: ChatUiMessage['executed']) => void;
  setLoading: (loading: boolean) => void;
  clear: () => void;

  /** Edge Fn 으로 보낼 메시지 페이로드. 최근 20턴 또는 30분 내. */
  getOutgoingMessages: () => { role: 'user' | 'assistant'; content: string }[];
}

const WINDOW_TURNS = 20;
const WINDOW_MS = 30 * 60 * 1000;

const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isOpen: false,
  isLoading: false,

  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),

  pushUser: (text) =>
    set((s) => ({
      messages: [...s.messages, { id: newId(), role: 'user', content: text, createdAt: Date.now() }],
    })),

  pushAssistant: (text, executed) =>
    set((s) => {
      const msg: ChatUiMessage = {
        id: newId(),
        role: 'assistant',
        content: text,
        createdAt: Date.now(),
        ...(executed && executed.length > 0 ? { executed } : {}),
      };
      return { messages: [...s.messages, msg] };
    }),

  setLoading: (loading) => set({ isLoading: loading }),
  clear: () => set({ messages: [] }),

  getOutgoingMessages: () => {
    const all = get().messages;
    const cutoff = Date.now() - WINDOW_MS;
    const recent = all.filter((m) => m.createdAt >= cutoff).slice(-WINDOW_TURNS);
    return recent.map((m) => ({ role: m.role, content: m.content }));
  },
}));
