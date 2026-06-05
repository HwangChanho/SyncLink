/**
 * loginPromptStore — global visibility state for the guest LoginPromptSheet.
 *
 * Any component can call `open()` when a browsing guest attempts a value
 * action (create event, AI input, share) to surface a soft sign-in nudge
 * instead of a hard redirect. The sheet itself is mounted once at the root
 * layout and reads this store. Part A / Phase 2 of the 2026-06-04 guest plan.
 */

import { create } from 'zustand';

interface LoginPromptState {
  /** Whether the sheet is visible. */
  visible: boolean;
  /** Optional context line overriding the default sheet body copy. */
  message: string | null;
  /** Show the sheet, optionally with a context-specific message. */
  open: (message?: string) => void;
  /** Hide the sheet. */
  close: () => void;
}

export const useLoginPromptStore = create<LoginPromptState>((set) => ({
  visible: false,
  message: null,
  open: (message) => set({ visible: true, message: message ?? null }),
  close: () => set({ visible: false }),
}));
