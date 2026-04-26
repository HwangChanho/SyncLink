/**
 * Space store — global space state management.
 *
 * Manages:
 *  - My spaces list (SpaceSummary[])
 *  - Active (currently selected) space ID
 *  - Per-space detail cache (Space objects)
 *  - Loading / error state
 *
 * Pattern: thin wrapper around spaceService with local cache.
 * Components call store actions; store calls service; store updates state.
 */

import { create } from 'zustand';
import type { Space, SpaceSummary } from '@/types';
import * as spaceService from '@/services/spaceService';

// ─── State shape ──────────────────────────────────────────────────────────────

interface SpaceState {
  /** Summary list of all spaces the current user belongs to. */
  spaces: SpaceSummary[];
  /**
   * ID of the space currently "active" in the UI.
   * Used by the calendar/planner tabs to scope displayed events.
   */
  activeSpaceId: string | null;
  /**
   * Full Space detail cache keyed by space ID.
   * Populated lazily when a space detail screen is opened.
   */
  spaceDetails: Record<string, Space>;
  /** True while any async space operation is in-flight. */
  isLoading: boolean;
  /** Last error message from a failed operation, or null. */
  error: string | null;

  // ─── Sync setters ────────────────────────────────────────────────────────
  setSpaces: (spaces: SpaceSummary[]) => void;
  setActiveSpaceId: (id: string | null) => void;
  /** Upsert a full Space object into the detail cache. */
  setSpaceDetail: (space: Space) => void;
  /** Remove a space from both the summary list and detail cache. */
  removeSpace: (spaceId: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  // ─── Async thunks ────────────────────────────────────────────────────────

  /**
   * Fetch all spaces for the current user and update the spaces list.
   * Sets activeSpaceId to the first space if none is selected yet.
   */
  fetchMySpaces: () => Promise<void>;

  /**
   * Fetch full details for a single space and cache the result.
   * @returns The fetched Space object
   */
  fetchSpaceById: (spaceId: string) => Promise<Space>;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useSpaceStore = create<SpaceState>((set, get) => ({
  spaces: [],
  activeSpaceId: null,
  spaceDetails: {},
  isLoading: false,
  error: null,

  setSpaces: (spaces) => set({ spaces }),

  setActiveSpaceId: (activeSpaceId) => set({ activeSpaceId }),

  setSpaceDetail: (space) =>
    set((state) => ({
      spaceDetails: { ...state.spaceDetails, [space.id]: space },
    })),

  removeSpace: (spaceId) =>
    set((state) => {
      // Remove from detail cache
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [spaceId]: _removed, ...restDetails } = state.spaceDetails;
      // Remove from summary list
      const updatedSpaces = state.spaces.filter(s => s.id !== spaceId);
      // Clear active if it was the removed space
      const activeSpaceId =
        state.activeSpaceId === spaceId ? null : state.activeSpaceId;

      return {
        spaces: updatedSpaces,
        spaceDetails: restDetails,
        activeSpaceId,
      };
    }),

  setLoading: (isLoading) => set({ isLoading }),

  setError: (error) => set({ error }),

  fetchMySpaces: async () => {
    set({ isLoading: true, error: null });
    try {
      const spaces = await spaceService.getMySpaces();
      set((state) => ({
        spaces,
        isLoading: false,
        // Auto-select first space if nothing is currently active
        activeSpaceId:
          state.activeSpaceId === null && spaces.length > 0
            ? (spaces[0]?.id ?? null)
            : state.activeSpaceId,
      }));
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Space 목록을 불러오지 못했습니다.';
      set({ error: message, isLoading: false });
    }
  },

  fetchSpaceById: async (spaceId: string) => {
    // Check cache first to avoid redundant network requests
    const cached = get().spaceDetails[spaceId];
    if (cached) return cached;

    set({ isLoading: true, error: null });
    try {
      const space = await spaceService.getSpaceById(spaceId);
      set((state) => ({
        spaceDetails: { ...state.spaceDetails, [space.id]: space },
        isLoading: false,
      }));
      return space;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Space 정보를 불러오지 못했습니다.';
      set({ error: message, isLoading: false });
      throw err;
    }
  },
}));
