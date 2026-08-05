/**
 * startGuideStore — persisted progress for the post-login "시작 가이드"
 * checklist card on Home (StartGuideCard).
 *
 * Persistence model (deliberately minimal):
 *  - Persisted here: only flags that CANNOT be derived from real data —
 *    `dismissed` (user closed the card / finished), `calendarVisited`
 *    (navigation is not observable from data), `notifGranted` (permission
 *    state is cached after a successful grant so we don't re-query every
 *    render; re-checked once per hydrate on native).
 *  - Derived live by StartGuideCard, NOT stored: "has ≥1 event" (eventStore)
 *    and "has ≥1 space" (spaceStore). Real data is the source of truth, so a
 *    user who creates an event on another device still gets the check mark.
 *
 * Same hydrate-then-read pattern as onboardingStore: `hydrated` guards the
 * card so it never flashes for users who already dismissed it.
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

/** AsyncStorage key — JSON blob of the persisted flags. */
export const START_GUIDE_STORAGE_KEY = '@synclink/start_guide_v1';

/** Shape persisted to AsyncStorage (subset of the store). */
interface PersistedFlags {
  dismissed: boolean;
  calendarVisited: boolean;
  notifGranted: boolean;
}

interface StartGuideState extends PersistedFlags {
  /** false until AsyncStorage has been read — card renders nothing meanwhile. */
  hydrated: boolean;
  /** Read persisted flags into memory (call once where the card mounts). */
  hydrate: () => Promise<void>;
  /** Permanently hide the card (X button, or auto after completion). */
  dismiss: () => void;
  /** Mark the "check the calendar" step done (set when the user taps through). */
  markCalendarVisited: () => void;
  /** Cache a granted notification permission. */
  markNotifGranted: () => void;
}

/** Write the persisted subset back to storage (fire-and-forget). */
function persist(state: PersistedFlags): void {
  AsyncStorage.setItem(
    START_GUIDE_STORAGE_KEY,
    JSON.stringify(state),
  ).catch(() => {
    // Persist failure is non-critical — in-memory flags keep the session correct.
  });
}

/** Extract the persistable subset from a full state object. */
const toPersisted = (s: StartGuideState): PersistedFlags => ({
  dismissed: s.dismissed,
  calendarVisited: s.calendarVisited,
  notifGranted: s.notifGranted,
});

export const useStartGuideStore = create<StartGuideState>((set, get) => ({
  hydrated: false,
  dismissed: false,
  calendarVisited: false,
  notifGranted: false,

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(START_GUIDE_STORAGE_KEY);
      if (raw !== null) {
        const saved = JSON.parse(raw) as Partial<PersistedFlags>;
        set({
          dismissed: saved.dismissed === true,
          calendarVisited: saved.calendarVisited === true,
          notifGranted: saved.notifGranted === true,
        });
      }
    } catch {
      // Corrupt/unreadable storage — fall through with defaults (card shows again;
      // harmless, all steps re-derive from real data).
    } finally {
      set({ hydrated: true });
    }
  },

  dismiss: () => {
    set({ dismissed: true });
    persist(toPersisted(get()));
  },

  markCalendarVisited: () => {
    if (get().calendarVisited) return;
    set({ calendarVisited: true });
    persist(toPersisted(get()));
  },

  markNotifGranted: () => {
    if (get().notifGranted) return;
    set({ notifGranted: true });
    persist(toPersisted(get()));
  },
}));
