/**
 * useLanguage — hook for reading and changing the active app language.
 *
 * Wraps i18next.changeLanguage() and persists the user's selection to
 * AsyncStorage (@synclink/language) so it survives app restarts.
 * On restart, _layout.tsx calls initI18n() to restore the stored locale.
 *
 * Usage:
 *   const { currentLanguage, changeLanguage } = useLanguage();
 *   await changeLanguage('en');
 */

import { useTranslation } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import i18next, { LANGUAGE_STORAGE_KEY, type SupportedLocale } from '@/lib/i18n';

/** Shape returned by the hook. */
export interface UseLanguageReturn {
  /** The currently active locale code, e.g. 'ko' | 'en' | 'zh' | 'ja'. */
  currentLanguage: SupportedLocale;
  /**
   * Change the app language and persist the selection.
   *
   * @param lang - Target locale code
   */
  changeLanguage: (lang: SupportedLocale) => Promise<void>;
}

/**
 * Hook that provides the current locale and a change function.
 * Triggers a re-render in the consuming component whenever the locale changes
 * (via react-i18next's useTranslation reactivity).
 */
export function useLanguage(): UseLanguageReturn {
  // useTranslation subscribes the component to locale changes so it re-renders
  // when i18next.changeLanguage() is called from any source.
  const { i18n } = useTranslation();

  /**
   * Switch the active language and save the selection to AsyncStorage.
   * Both operations are awaited so callers can handle errors.
   *
   * @param lang - One of the supported locale codes
   */
  const changeLanguage = async (lang: SupportedLocale): Promise<void> => {
    // 1. Update i18next — triggers re-render in all subscribed components.
    await i18next.changeLanguage(lang);
    // 2. Persist so the selection survives app restarts.
    await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
  };

  return {
    currentLanguage: (i18n.language as SupportedLocale) ?? 'en',
    changeLanguage,
  };
}
