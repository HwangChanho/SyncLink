/**
 * i18n — internationalization setup.
 *
 * Supported locales: ko (Korean), en (English), zh (Chinese Simplified), ja (Japanese)
 * Detection order:
 *   1. AsyncStorage (@synclink/language) — user's explicit selection persists across restarts.
 *   2. System locale (iOS / Android NativeModules) — first-run default.
 *   3. Falls back to 'en'.
 *
 * Usage:
 *   import { t } from '@/lib/i18n';
 *   t('common.ok')          // → '확인' (if active locale is ko)
 *
 * In components, prefer the useTranslation hook for reactivity:
 *   import { useTranslation } from 'react-i18next';
 *   const { t } = useTranslation();
 *
 * Call initI18n() once at app startup (_layout.tsx) to hydrate the stored locale.
 */

import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ko from '@/locales/ko';
import en from '@/locales/en';
import zh from '@/locales/zh';
import ja from '@/locales/ja';

/** AsyncStorage key used to persist the user-selected language. */
export const LANGUAGE_STORAGE_KEY = '@synclink/language';

/** Valid locale codes supported by the app. */
export type SupportedLocale = 'ko' | 'en' | 'zh' | 'ja';

/**
 * Detect the device's primary system language.
 * Reads NativeModules synchronously — safe to call at module initialisation.
 *
 * @returns One of 'ko' | 'zh' | 'ja' | 'en'
 */
function detectLocale(): SupportedLocale {
  // Use expo-localization (sync, cross-platform). Resolves ISSUE-013:
  // NativeModules.I18nManager.localeIdentifier returned an empty string on
  // some Android devices, leaving i18next without a usable lng.
  try {
    const locales = Localization.getLocales();
    const code = locales?.[0]?.languageCode ?? '';
    const tag = (code || locales?.[0]?.languageTag || '').toLowerCase();
    if (tag.startsWith('ko')) return 'ko';
    if (tag.startsWith('zh')) return 'zh';
    if (tag.startsWith('ja')) return 'ja';
  } catch {
    // Ignore — fall through to default.
  }
  return 'en';
}

/**
 * Initialise i18next with the synchronous system-locale default.
 * This runs immediately at module load so that t() works before initI18n resolves.
 */
i18next
  .use(initReactI18next)
  .init({
    resources: {
      ko: { translation: ko },
      en: { translation: en },
      zh: { translation: zh },
      ja: { translation: ja },
    },
    lng:         detectLocale(),
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false, // React already escapes values
    },
  });

/**
 * Async initialiser — call once at app startup (_layout.tsx).
 *
 * Reads the user-persisted language from AsyncStorage and, if present,
 * switches i18next to that locale. This makes the stored language effective
 * on every subsequent app restart.
 *
 * @returns The locale that was applied (or the current system default).
 */
export async function initI18n(): Promise<SupportedLocale> {
  try {
    const stored = await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY);
    const validLocales: SupportedLocale[] = ['ko', 'en', 'zh', 'ja'];
    if (stored && (validLocales as string[]).includes(stored)) {
      const locale = stored as SupportedLocale;
      await i18next.changeLanguage(locale);
      return locale;
    }
  } catch {
    // AsyncStorage failure — silently fall back to the system default.
  }
  return i18next.language as SupportedLocale;
}

export default i18next;

/** Convenience re-export for non-component contexts (services, utils). */
export const t = i18next.t.bind(i18next);
