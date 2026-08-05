/**
 * nlFocusStore — cross-tree focus request bridge for the home NLInputBar.
 *
 * Why: StartGuideCard ("첫 일정 등록" step) lives inside the home ScrollView,
 * while NLInputBar is absolutely positioned at the root of the home screen —
 * different component subtrees with no shared ref. A ref-forwarding chain
 * through the screen would couple three components for one interaction, so a
 * tiny store carries the one-shot "please focus" signal instead (same pattern
 * as loginPromptStore).
 *
 * Usage:
 *  - Requester: useNLFocusStore.getState().requestFocus()
 *  - NLInputBar: subscribes to `requestId` and focuses its TextInput whenever
 *    the value increments, then no cleanup is needed (monotonic counter — a
 *    boolean would need a reset handshake and could drop rapid double-taps).
 */

import { create } from 'zustand';

interface NLFocusState {
  /** Monotonic counter — increments on every focus request. 0 = never requested. */
  requestId: number;
  /** Ask the (single) mounted NLInputBar to focus its text input. */
  requestFocus: () => void;
}

export const useNLFocusStore = create<NLFocusState>((set) => ({
  requestId: 0,
  requestFocus: () => set((s) => ({ requestId: s.requestId + 1 })),
}));
