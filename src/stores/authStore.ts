/**
 * Auth store — global authentication state.
 *
 * Wraps authService.ts and provides reactive state for components.
 *
 * This is a STUB. Implementation: TASK-100 (Sprint 1).
 */

import { create } from 'zustand';
import type { UserRow } from '@/types';

interface AuthState {
  /** Currently authenticated user profile. null = not logged in. */
  user: UserRow | null;
  /** True during initial session restore (prevents premature redirect). */
  isLoading: boolean;
  /** True if the user is authenticated. */
  isAuthenticated: boolean;

  // Actions
  /** Set after a successful login. */
  setUser: (user: UserRow | null) => void;
  /** Set loading state during auth initialization. */
  setLoading: (loading: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,
  isAuthenticated: false,

  setUser: (user) => set({
    user,
    isAuthenticated: user !== null,
    isLoading: false,
  }),

  setLoading: (isLoading) => set({ isLoading }),
}));
