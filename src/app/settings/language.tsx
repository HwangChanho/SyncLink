/**
 * Language settings — explicit per-locale toggle in the Settings menu.
 *
 * Why a dedicated screen (Sprint 25, PRD 4.5):
 *   The header LanguageButton is a power-user shortcut; new users browse
 *   Settings to discover language switching. This screen exposes the same
 *   useLanguage().changeLanguage() entrypoint as a labelled list so the
 *   feature is findable without prior knowledge of the header glyph.
 */

import { ScrollView, View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useColors } from '@/hooks/useColors';
import type { ColorTokens } from '@/hooks/useColors';
import { useLanguage } from '@/hooks/useLanguage';
import type { SupportedLocale } from '@/lib/i18n';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';

type LanguageOption = {
  locale: SupportedLocale;
  nativeLabel: string;
  translationKey: string;
};

const LANGUAGE_OPTIONS: LanguageOption[] = [
  { locale: 'ko', nativeLabel: '한국어',  translationKey: 'common.lang_ko' },
  { locale: 'en', nativeLabel: 'English', translationKey: 'common.lang_en' },
  { locale: 'zh', nativeLabel: '中文',    translationKey: 'common.lang_zh' },
  { locale: 'ja', nativeLabel: '日本語',   translationKey: 'common.lang_ja' },
];

export default function LanguageSettingsScreen() {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { t } = useTranslation();
  const { currentLanguage, changeLanguage } = useLanguage();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable
          style={styles.back}
          onPress={() => router.back()}
          testID="settings-language-back"
        >
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>
          {t('settings.language', { defaultValue: '언어' })}
        </Text>
        <View style={styles.back} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionHelp}>
          {t('settings.language_help', {
            defaultValue: '선택 즉시 앱 전체 텍스트가 전환됩니다.',
          })}
        </Text>

        <View style={styles.list}>
          {LANGUAGE_OPTIONS.map((opt) => {
            const selected = opt.locale === currentLanguage;
            return (
              <Pressable
                key={opt.locale}
                style={[styles.row, selected && styles.rowSelected]}
                onPress={() => { void changeLanguage(opt.locale); }}
                testID={`settings-language-row-${opt.locale}`}
                accessibilityRole="button"
                accessibilityState={{ selected }}
              >
                <View style={styles.rowLabels}>
                  <Text style={styles.rowNative}>{opt.nativeLabel}</Text>
                  <Text style={styles.rowTranslated}>
                    {t(opt.translationKey, { defaultValue: opt.nativeLabel })}
                  </Text>
                </View>
                {selected ? (
                  <Ionicons name="checkmark" size={22} color={colors.primary} />
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(colors: ColorTokens) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      height: 52,
      paddingHorizontal: spacing[2],
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    back: { width: 44, alignItems: 'center', justifyContent: 'center' },
    headerTitle: {
      flex: 1,
      textAlign: 'center',
      ...textStyles.labelLg,
      color: colors.textPrimary,
      fontWeight: '700',
    },
    content: { padding: spacing[4] },
    sectionHelp: {
      ...textStyles.caption,
      color: colors.textSecondary,
      marginBottom: spacing[3],
    },
    list: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.lg,
      backgroundColor: colors.surface,
      overflow: 'hidden',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[3],
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    rowSelected: {
      backgroundColor: colors.surface,
    },
    rowLabels: { flex: 1 },
    rowNative: {
      ...textStyles.body,
      color: colors.textPrimary,
      fontWeight: '600',
    },
    rowTranslated: {
      ...textStyles.caption,
      color: colors.textSecondary,
      marginTop: 2,
    },
  });
}
