/**
 * LanguageButton — header button that opens a language-selection action sheet.
 *
 * Renders an Ionicons "language" icon suitable for placement in a navigation
 * header's headerRight slot.  Tapping it presents a bottom action sheet with
 * the four supported languages; selecting one calls useLanguage().changeLanguage()
 * which updates i18next and persists the choice to AsyncStorage.
 *
 * Supported languages:
 *   🇰🇷  한국어 (ko)
 *   🇺🇸  English (en)
 *   🇨🇳  中文 (zh)
 *   🇯🇵  日本語 (ja)
 *
 * Usage (in a tab screen's headerRight):
 *   <Tabs.Screen options={{ headerRight: () => <LanguageButton /> }} />
 */

import { TouchableOpacity, ActionSheetIOS, Alert, Platform, StyleSheet, View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useColors } from '@/hooks/useColors';
import { useLanguage, type UseLanguageReturn } from '@/hooks/useLanguage';
import type { SupportedLocale } from '@/lib/i18n';
import { spacing } from '@/constants/spacing';

// ─── Language option config ────────────────────────────────────────────────────

interface LangOption {
  /** i18next locale code. */
  locale: SupportedLocale;
  /** Flag emoji + display name shown in the picker. */
  label: string;
}

/** The four supported languages in the order they appear in the picker. */
const LANG_OPTIONS: LangOption[] = [
  { locale: 'ko', label: '🇰🇷  한국어' },
  { locale: 'en', label: '🇺🇸  English' },
  { locale: 'zh', label: '🇨🇳  中文' },
  { locale: 'ja', label: '🇯🇵  日本語' },
];

// ─── Component ─────────────────────────────────────────────────────────────────

/**
 * Icon button that opens an OS-native action sheet for language selection.
 * On iOS uses ActionSheetIOS; on Android falls back to an Alert-based picker.
 */
export function LanguageButton() {
  const { t } = useTranslation();
  const colors = useColors();
  const { currentLanguage, changeLanguage }: UseLanguageReturn = useLanguage();

  /** Two-letter uppercase code shown next to the icon (KO / EN / ZH / JA). */
  const languageLabel = currentLanguage.toUpperCase();

  /**
   * Present the language picker appropriate for the current platform.
   * iOS:     ActionSheetIOS (native bottom sheet)
   * Android: Alert with button list (no ActionSheet API on Android)
   * Web:     cycle through the four languages on each tap. React Native
   *          Web's Alert with 4+ buttons silently no-ops, so we fall back
   *          to a simple "click to advance" UX where the header label
   *          (KO/EN/ZH/JA) doubles as the visible state.
   */
  const handlePress = () => {
    const optionLabels = LANG_OPTIONS.map(o => o.label);

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [...optionLabels, t('common.cancel')],
          cancelButtonIndex: optionLabels.length,
        },
        (buttonIndex) => {
          if (buttonIndex < LANG_OPTIONS.length) {
            const selected = LANG_OPTIONS[buttonIndex];
            if (selected) {
              void changeLanguage(selected.locale);
            }
          }
        },
      );
    } else if (Platform.OS === 'web') {
      // Cycle: ko → en → zh → ja → ko
      const idx = LANG_OPTIONS.findIndex((o) => o.locale === currentLanguage);
      const next = LANG_OPTIONS[(idx + 1) % LANG_OPTIONS.length];
      if (next) void changeLanguage(next.locale);
    } else {
      // Android — Alert with button list works here.
      Alert.alert(
        t('time.lang_ko', '언어 선택'),
        undefined,
        [
          ...LANG_OPTIONS.map(opt => ({
            text: opt.label,
            onPress: () => { void changeLanguage(opt.locale); },
          })),
          { text: t('common.cancel'), style: 'cancel' as const },
        ],
      );
    }
  };

  return (
    <TouchableOpacity
      onPress={handlePress}
      style={styles.button}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityLabel={`Change language (current: ${languageLabel})`}
      accessibilityRole="button"
    >
      <View style={styles.row}>
        <Ionicons name="language" size={20} color={colors.textPrimary} />
        <Text style={[styles.label, { color: colors.textPrimary }]}>{languageLabel}</Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  button: {
    paddingHorizontal: spacing[3],
    paddingVertical:   spacing[2],
  },
  row: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           4,
  },
  label: {
    fontSize:   12,
    fontWeight: '600',
  },
});
