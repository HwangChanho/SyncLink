/**
 * Note settings store — user preferences for the planner Notes feature.
 *
 * Responsibilities:
 *  - Track whether YouTube thumbnails should be shown in the notes list.
 *  - Persist the preference to AsyncStorage so it survives app restarts.
 *
 * Follows the same manual-persist + hydrate() pattern as subscriptionStore /
 * onboardingStore (not zustand/persist middleware) so app-startup hydration
 * stays explicit and consistent across stores.
 *
 * Usage:
 *  ```tsx
 *  const show = useNoteSettingsStore((s) => s.showYoutubeThumbnails);
 *  ```
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

/** AsyncStorage key for persisting note settings. */
const STORAGE_KEY = 'synclink:notes:settings';

interface NoteSettingsState {
  /**
   * When true (default), a note whose body contains a YouTube link shows the
   * video thumbnail in the notes list. When false, only the text is shown.
   */
  showYoutubeThumbnails: boolean;

  /** Toggle the YouTube thumbnail preference and persist it. */
  setShowYoutubeThumbnails: (value: boolean) => void;

  /**
   * Restore the persisted preference from AsyncStorage.
   * Called once at app startup (root _layout.tsx). Safe to call repeatedly —
   * only applies when a saved value exists.
   */
  hydrate: () => Promise<void>;
}

export const useNoteSettingsStore = create<NoteSettingsState>((set) => ({
  // Default ON — thumbnails are the expected/nice behaviour out of the box.
  showYoutubeThumbnails: true,

  setShowYoutubeThumbnails: (value: boolean) => {
    set({ showYoutubeThumbnails: value });
    // Fire-and-forget — UI shouldn't block on storage, and a failure just
    // means the toggle reverts to its default on next launch.
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ showYoutubeThumbnails: value }))
      .catch(() => {/* non-critical */});
  },

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as Partial<Pick<NoteSettingsState, 'showYoutubeThumbnails'>>;
      if (typeof saved.showYoutubeThumbnails === 'boolean') {
        set({ showYoutubeThumbnails: saved.showYoutubeThumbnails });
      }
    } catch {
      // Corrupted/unavailable storage — keep the default (already set above).
    }
  },
}));
