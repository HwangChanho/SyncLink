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
import { ACCENT_PRESETS, type AccentPresetKey } from '@/lib/themePalette';

// ─── Constants ────────────────────────────────────────────────────────────────

/** AsyncStorage key for persisting the user's color scheme preference. */
const APPEARANCE_STORAGE_KEY = 'synclink:appearance:colorScheme';
/** Separate key so dark/light preference can change without affecting colour. */
const HEADER_TITLE_COLOR_KEY = 'synclink:appearance:headerTitleColor';
/** AsyncStorage key for persisting the accent hue (0-360). */
const ACCENT_HUE_KEY = 'synclink:appearance:accentHue';
/** AsyncStorage key for persisting the accent preset name. */
const ACCENT_PRESET_KEY = 'synclink:appearance:accentPreset';

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

// ─── Accent preset re-export ──────────────────────────────────────────────────

/**
 * AccentPresetKey — 6개 사전 정의 색상 이름.
 * ACCENT_PRESETS[key] 로 hue 값을 얻는다.
 * @see ACCENT_PRESETS in '@/lib/themePalette'
 */
export type { AccentPresetKey };
export { ACCENT_PRESETS };

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

  /**
   * Named colour used to tint the top tab title.
   * @deprecated  새 코드는 accentPreset / accentHue 를 사용하세요.
   *              headerTitleColor 는 accentPreset 과 연동되어 있어
   *              setAccentPreset() 호출 시 자동으로 업데이트됩니다.
   */
  headerTitleColor: HeaderTitleColor;
  /** @deprecated setAccentPreset() 사용 권장 */
  setHeaderTitleColor: (c: HeaderTitleColor) => void;

  /**
   * 현재 선택된 액센트 프리셋 이름. 커스텀 hue 사용 시 null.
   * 기본값: 'default' (violet)
   */
  accentPreset: AccentPresetKey | null;

  /**
   * 앱 전체 테마 색조 (0-360).
   * accentPreset 설정 시 자동으로 해당 hue 로 업데이트된다.
   * 커스텀 값 직접 지정도 가능 (accentPreset = null 로 전환됨).
   */
  accentHue: number;

  /**
   * 프리셋 이름으로 accentHue 와 headerTitleColor 를 함께 설정한다.
   * 기존 headerTitleColor 시스템과 역호환.
   *
   * @param preset - AccentPresetKey 이름
   */
  setAccentPreset: (preset: AccentPresetKey) => void;

  /**
   * hue 값(0-360)을 직접 설정한다. accentPreset 은 null 로 초기화된다.
   * HSL 슬라이더 등 커스텀 UI에서 호출.
   *
   * @param hue - 0-360 색조 값
   */
  setAccentHue: (hue: number) => void;
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

  // ── Deprecated: header-only colour (연동 유지) ────────────────────────────
  headerTitleColor: 'default',
  setHeaderTitleColor: (c: HeaderTitleColor) => {
    // 기존 API 호환: headerTitleColor 변경 시 accentPreset 도 함께 동기화.
    // 'default' → preset 'default', 그 외는 동일 키명.
    const preset = c as AccentPresetKey;
    const hue = ACCENT_PRESETS[preset] ?? ACCENT_PRESETS.default;
    set({ headerTitleColor: c, accentPreset: preset, accentHue: hue });
    AsyncStorage.setItem(HEADER_TITLE_COLOR_KEY, c).catch(() => {/* non-fatal */});
    AsyncStorage.setItem(ACCENT_HUE_KEY, String(hue)).catch(() => {/* non-fatal */});
    AsyncStorage.setItem(ACCENT_PRESET_KEY, preset).catch(() => {/* non-fatal */});
  },

  // ── New: full-theme accent ────────────────────────────────────────────────
  accentPreset: 'default',
  accentHue: ACCENT_PRESETS.default, // 258 (violet)

  setAccentPreset: (preset: AccentPresetKey) => {
    const hue = ACCENT_PRESETS[preset];
    // headerTitleColor 와 동기화 (역호환)
    const legacyKey = preset as HeaderTitleColor;
    set({ accentPreset: preset, accentHue: hue, headerTitleColor: legacyKey });
    AsyncStorage.setItem(ACCENT_PRESET_KEY, preset).catch(() => {/* non-fatal */});
    AsyncStorage.setItem(ACCENT_HUE_KEY, String(hue)).catch(() => {/* non-fatal */});
    AsyncStorage.setItem(HEADER_TITLE_COLOR_KEY, legacyKey).catch(() => {/* non-fatal */});
  },

  setAccentHue: (hue: number) => {
    // 커스텀 hue: preset 이름 해제, headerTitleColor는 'default' 유지
    set({ accentHue: hue, accentPreset: null, headerTitleColor: 'default' });
    AsyncStorage.setItem(ACCENT_HUE_KEY, String(hue)).catch(() => {/* non-fatal */});
    AsyncStorage.multiRemove([ACCENT_PRESET_KEY]).catch(() => {/* non-fatal */});
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
    // 1. 라이트/다크/시스템 설정 복원
    const saved = await AsyncStorage.getItem(APPEARANCE_STORAGE_KEY);
    if (saved === 'light' || saved === 'dark' || saved === 'system') {
      useAppearanceStore.getState().setColorScheme(saved);
    }

    // 2. accentPreset 복원 (preset 이름이 있으면 우선 적용)
    const savedPreset = await AsyncStorage.getItem(ACCENT_PRESET_KEY);
    if (savedPreset && savedPreset in ACCENT_PRESETS) {
      useAppearanceStore.getState().setAccentPreset(savedPreset as AccentPresetKey);
    } else {
      // 3. 커스텀 hue 복원 (preset 없을 때)
      const savedHue = await AsyncStorage.getItem(ACCENT_HUE_KEY);
      if (savedHue !== null) {
        const hue = Number(savedHue);
        if (Number.isFinite(hue) && hue >= 0 && hue <= 360) {
          useAppearanceStore.getState().setAccentHue(hue);
        }
      } else {
        // 4. 레거시 headerTitleColor 복원 (이전 버전 마이그레이션)
        const savedColor = await AsyncStorage.getItem(HEADER_TITLE_COLOR_KEY);
        if (savedColor && savedColor in HEADER_TITLE_COLOR_HEX) {
          useAppearanceStore.getState().setHeaderTitleColor(savedColor as HeaderTitleColor);
        }
      }
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
