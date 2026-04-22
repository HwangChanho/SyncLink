/**
 * i18n — internationalization setup.
 *
 * Supported locales: ko (Korean), en (English), zh (Chinese Simplified), ja (Japanese)
 * Detection: system locale via expo-localization, falls back to 'en'.
 *
 * Usage:
 *   import { t } from '@/lib/i18n';
 *   t('common.ok')          // → '확인' (if system locale is ko)
 *
 * In components, prefer the useTranslation hook for reactivity:
 *   import { useTranslation } from 'react-i18next';
 *   const { t } = useTranslation();
 */

import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { NativeModules, Platform } from 'react-native';
import ko from '@/locales/ko';
import en from '@/locales/en';
import zh from '@/locales/zh';
import ja from '@/locales/ja';

// Resolve the primary system language without requiring expo-localization native module.
// iOS: SettingsManager.settings.AppleLanguages[0]
// Android: I18nManager.localeIdentifier
// Falls back to 'en' on any failure.
function detectLocale(): string {
  try {
    let tag = 'en';
    if (Platform.OS === 'ios') {
      tag = NativeModules.SettingsManager?.settings?.AppleLocale
        ?? NativeModules.SettingsManager?.settings?.AppleLanguages?.[0]
        ?? 'en';
    } else if (Platform.OS === 'android') {
      tag = NativeModules.I18nManager?.localeIdentifier ?? 'en';
    }
    if (tag.startsWith('ko')) return 'ko';
    if (tag.startsWith('zh')) return 'zh';
    if (tag.startsWith('ja')) return 'ja';
  } catch {
    // ignore — fall through to default
  }
  return 'en';
}

i18next
  .use(initReactI18next)
  .init({
    resources: {
      ko: { translation: ko },
      en: { translation: en },
      zh: { translation: zh },
      ja: { translation: ja },
    },
    lng:             detectLocale(),
    fallbackLng:     'en',
    interpolation: {
      escapeValue: false, // React already escapes values
    },
  });

export default i18next;

/** Convenience re-export for non-component contexts (services, utils). */
export const t = i18next.t.bind(i18next);
