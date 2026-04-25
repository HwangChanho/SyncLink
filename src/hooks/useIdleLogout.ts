/**
 * useIdleLogout — auto sign-out after a period of inactivity (web only).
 *
 * Why web only:
 *   - Native apps already gate access via the OS lock screen and the
 *     in-app PIN/biometric overlay. Auto-logout there would just annoy.
 *   - Browsers, especially shared computers, are the realistic threat
 *     model — leaving a tab open on a public machine should not leak
 *     the calendar.
 *
 * Mechanism:
 *   - Listen to mouse / keyboard / touch / scroll events on `window`.
 *   - Coalesce updates to once every {THROTTLE_MS} so we don't write
 *     to localStorage on every pixel of mouse movement.
 *   - Store the latest activity timestamp in localStorage so that
 *     other tabs of the same site share the same idle clock (closing
 *     and reopening a tab doesn't reset the timer).
 *   - On every activity event, push a single setTimeout that fires
 *     `supabase.auth.signOut()` after {IDLE_MS}. The timeout is
 *     replaced (not stacked) on each activity tick.
 *
 * Tunables are exported so a settings screen could let the user pick
 * a different inactivity window in the future.
 */

import { useEffect } from 'react';
import { Platform } from 'react-native';
import { supabase } from '@/lib/supabase';

/** Inactivity window before forced sign-out. Default: 30 minutes. */
export const DEFAULT_IDLE_MS = 30 * 60 * 1000;

/** How often we persist the last-activity timestamp. */
const THROTTLE_MS = 60 * 1000;

/** Cross-tab synchronisation key. */
const STORAGE_KEY = 'synclink:last_activity';

/**
 * Mounts a window-level activity listener that signs the user out after
 * the configured idle window. Safe to call on every platform — does
 * nothing on native.
 *
 * @param idleMs Override the inactivity window (ms). Defaults to 30 min.
 */
export function useIdleLogout(idleMs: number = DEFAULT_IDLE_MS): void {
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (typeof window === 'undefined') return;

    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    let lastWriteAt = 0;

    const readPersisted = (): number => {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        return raw ? Number(raw) : Date.now();
      } catch {
        return Date.now();
      }
    };

    const persist = (ts: number) => {
      try {
        window.localStorage.setItem(STORAGE_KEY, String(ts));
      } catch {
        // Storage quota / private mode — ignore, in-memory clock still works.
      }
    };

    /** Schedule (or re-schedule) the sign-out callback. */
    const scheduleLogout = (lastActivity: number) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      const elapsed = Date.now() - lastActivity;
      const remaining = Math.max(idleMs - elapsed, 0);
      timeoutHandle = setTimeout(() => {
        // Best-effort: ignore signOut errors so a transient network blip
        // doesn't leave the timer in a stale state.
        void supabase.auth.signOut().catch(() => {/* noop */});
      }, remaining);
    };

    /** Mark "user is here" — bumps the persisted timestamp + reschedules. */
    const markActive = () => {
      const now = Date.now();
      // Throttle persistence so we don't spam localStorage on mousemove.
      if (now - lastWriteAt > THROTTLE_MS) {
        lastWriteAt = now;
        persist(now);
      }
      scheduleLogout(now);
    };

    // Initial schedule based on the persisted timestamp (cross-tab continuity).
    scheduleLogout(readPersisted());

    const events: Array<keyof WindowEventMap> = [
      'mousemove', 'keydown', 'pointerdown', 'touchstart', 'scroll', 'focus',
    ];
    events.forEach((evt) => window.addEventListener(evt, markActive, { passive: true }));

    /** When another tab updates the clock, sync ours so we don't sign out
     *  the active tab while the user is busy in another. */
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        scheduleLogout(Number(e.newValue));
      }
    };
    window.addEventListener('storage', onStorage);

    return () => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      events.forEach((evt) => window.removeEventListener(evt, markActive));
      window.removeEventListener('storage', onStorage);
    };
  }, [idleMs]);
}
