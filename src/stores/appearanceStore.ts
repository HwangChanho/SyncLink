/**
 * Appearance store — manages app color scheme (light / dark / system).
 *
 * Responsibilities:
 *  - Store the user's preferred color scheme preference
 *  - Resolve 'system' to an actual 'light' | 'dark' value via
 *    React Native's Appearance API
 *  - Persist the preference to AsyncStorage so it survives app restarts
 *
 * Usage:
 *  ```tsx
 *  const { colorScheme, setColorScheme, resolvedScheme } = useAppearanceStore();
 *  ```
 *
 * TASK-502 (Sprint 5)
 */

import { create } from 'zustand';
import { Appearance } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Constants ────────────────────────────────────────────────────────────────

/** AsyncStorage key for persisting the user's color scheme preference. */
const APPEARANCE_STORAGE_KEY = 'synclink:appearance:colorScheme';
/** Separate key so dark/light preference can change without affecting colour. */
const HEADER_TITLE_COLOR_KEY = 'synclink:appearance:headerTitleColor';

/** Named palette for the top tab title (light mode only uses these). */
export type HeaderTitleColor =
  | 'default' // fall back to theme textPrimary
  | 'primary'
  | 'rose'
  | 'emerald'
  | 'amber'
  | 'violet';

export const HEADER_TITLE_COLOR_HEX: Record<HeaderTitleColor, string | null> = {
  default: null,
  primary: '#6366F1',
  rose:    '#E11D48',
  emerald: '#059669',
  amber:   '#D97706',
  violet:  '#7C3AED',
};

// ─── Types ────────────────────────────────────────────────────────────────────

/** User's explicit preference (including 'system' for automatic). */
export type ColorSchemePreference = 'light' | 'dark' | 'system';

/** The actual resolved scheme (always 'light' or 'dark', never 'system'). */
export type ResolvedColorScheme = 'light' | 'dark';

interface AppearanceState {
  /**
   * User's stored preference.
   * 'system' means follow the OS setting.
   */
  colorScheme: ColorSchemePreference;

  /**
   * Actual resolved scheme after interpreting 'system'.
   * Components should read this, not colorScheme, for rendering decisions.
   */
  resolvedScheme: ResolvedColorScheme;

  /**
   * Change the color scheme preference.
   * If 'system' is selected, resolvedScheme is updated immediately
   * to match the current OS preference.
   *
   * @param scheme - New preference to apply
   */
  setColorScheme: (scheme: ColorSchemePreference) => void;

  /**
   * Called internally when the OS appearance changes (system mode only).
   * Updates resolvedScheme without persisting (the preference stays 'system').
   *
   * @param osScheme - New OS scheme from Appearance.addChangeListener
   */
  _syncSystemScheme: (osScheme: ResolvedColorScheme) => void;

  /** Named colour used to tint the top tab title. Default = theme default. */
  headerTitleColor: HeaderTitleColor;
  setHeaderTitleColor: (c: HeaderTitleColor) => void;
}

// ─── Helper ───────────────────────────────────────────────────────────────────

/**
 * Returns the current OS color scheme, defaulting to 'light' if undetectable.
 * The Appearance API returns null on some platforms/environments.
 */
function getOsScheme(): ResolvedColorScheme {
  return Appearance.getColorScheme() === 'dark' ? 'dark' : 'light';
}

/**
 * Resolves a preference to an actual scheme value.
 * 'system' defers to the OS; other values are passed through.
 */
function resolve(pref: ColorSchemePreference): ResolvedColorScheme {
  return pref === 'system' ? getOsScheme() : pref;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useAppearanceStore = create<AppearanceState>((set, get) => ({
  // Default: follow system preference
  colorScheme: 'system',
  resolvedScheme: getOsScheme(),

  setColorScheme: (scheme: ColorSchemePreference) => {
    const resolved = resolve(scheme);
    set({ colorScheme: scheme, resolvedScheme: resolved });

    // Persist to AsyncStorage (fire-and-forget — UI shouldn't block on this)
    AsyncStorage.setItem(APPEARANCE_STORAGE_KEY, scheme).catch(() => {
      // Storage failure is non-critical; setting is still applied in memory
    });
  },

  _syncSystemScheme: (osScheme: ResolvedColorScheme) => {
    // Only update resolvedScheme if the user is in 'system' mode
    if (get().colorScheme === 'system') {
      set({ resolvedScheme: osScheme });
    }
  },

  headerTitleColor: 'default',
  setHeaderTitleColor: (c: HeaderTitleColor) => {
    set({ headerTitleColor: c });
    AsyncStorage.setItem(HEADER_TITLE_COLOR_KEY, c).catch(() => {/* non-fatal */});
  },
}));

// ─── Initialization ───────────────────────────────────────────────────────────

/**
 * Restore persisted color scheme preference from AsyncStorage.
 * Called once on app startup (e.g., in the root _layout.tsx).
 * Safe to call multiple times — only applies if a saved value is found.
 */
export async function initAppearanceStore(): Promise<void> {
  try {
    const saved = await AsyncStorage.getItem(APPEARANCE_STORAGE_KEY);
    if (saved === 'light' || saved === 'dark' || saved === 'system') {
      useAppearanceStore.getState().setColorScheme(saved);
    }
    const savedColor = await AsyncStorage.getItem(HEADER_TITLE_COLOR_KEY);
    if (savedColor && savedColor in HEADER_TITLE_COLOR_HEX) {
      useAppearanceStore.getState().setHeaderTitleColor(savedColor as HeaderTitleColor);
    }
  } catch {
    // AsyncStorage unavailable — use default (system)
  }
}

// ─── OS appearance change listener ───────────────────────────────────────────

/**
 * Listen for OS-level appearance changes (e.g., user toggles Dark Mode in Settings).
 * Only affects the resolved scheme when the preference is set to 'system'.
 *
 * Set up once at module load. Expo's Appearance subscription is stable
 * for the app lifetime, so no cleanup is needed here.
 */
Appearance.addChangeListener(({ colorScheme: osScheme }) => {
  useAppearanceStore.getState()._syncSystemScheme(
    osScheme === 'dark' ? 'dark' : 'light',
  );
});
