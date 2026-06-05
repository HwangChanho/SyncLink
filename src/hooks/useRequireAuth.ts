/**
 * useRequireAuth — guard for value actions behind a soft sign-in nudge.
 *
 * Returns a function that runs `action` when the user is signed in, or opens
 * the LoginPromptSheet (a friendly bottom sheet) when the user is a browsing
 * guest. Use it to wrap create/share/AI actions so guests get a gentle prompt
 * instead of a hard redirect to the login screen.
 *
 *   const requireAuth = useRequireAuth();
 *   <Pressable onPress={() => requireAuth(() => router.push('/event/create'))} />
 *
 * Part A / Phase 2 of the 2026-06-04 guest-entry plan.
 */

import { useCallback } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useLoginPromptStore } from '@/stores/loginPromptStore';

export function useRequireAuth(): (action: () => void, message?: string) => boolean {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const open = useLoginPromptStore((s) => s.open);

  /**
   * @param action   Runs only when authenticated.
   * @param message  Optional context line for the sheet (guest path).
   * @returns        true if the action ran, false if the guest prompt opened.
   */
  return useCallback(
    (action: () => void, message?: string): boolean => {
      if (isAuthenticated) {
        action();
        return true;
      }
      open(message);
      return false;
    },
    [isAuthenticated, open],
  );
}
