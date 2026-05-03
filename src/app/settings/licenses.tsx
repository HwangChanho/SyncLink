/**
 * Open-source license notices. We ship a curated list rather than a
 * generated NOTICE file so the user lands on something readable; the
 * full generated list can be added in a later pass if legal asks.
 */

import { ScrollView, View, Text, Pressable, StyleSheet, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useColors } from '@/hooks/useColors';
import type { ColorTokens } from '@/hooks/useColors';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';

interface LicenseEntry {
  name: string;
  license: string;
  url?: string;
}

const LICENSES: LicenseEntry[] = [
  { name: 'React Native',                 license: 'MIT', url: 'https://github.com/facebook/react-native/blob/main/LICENSE' },
  { name: 'Expo SDK',                     license: 'MIT', url: 'https://github.com/expo/expo/blob/main/LICENSE' },
  { name: 'Supabase JS',                  license: 'MIT', url: 'https://github.com/supabase/supabase-js/blob/master/LICENSE' },
  { name: 'Zustand',                      license: 'MIT', url: 'https://github.com/pmndrs/zustand/blob/main/LICENSE' },
  { name: 'i18next',                      license: 'MIT', url: 'https://github.com/i18next/i18next/blob/master/LICENSE' },
  { name: 'react-native-gesture-handler', license: 'MIT' },
  { name: 'react-native-reanimated',      license: 'MIT' },
  { name: '@react-native-google-mobile-ads', license: 'Apache-2.0' },
  { name: 'expo-tracking-transparency',   license: 'MIT' },
  { name: '@sentry/react-native',         license: 'MIT' },
  { name: 'react-native-purchases',       license: 'MIT' },
  { name: '@gorhom/bottom-sheet',         license: 'MIT' },
  { name: '@react-native-async-storage/async-storage', license: 'MIT' },
  { name: '@react-native-community/datetimepicker', license: 'MIT' },
  { name: 'Ionicons / @expo/vector-icons', license: 'MIT' },
  { name: 'OpenWeatherMap API',           license: 'Free tier terms', url: 'https://openweathermap.org/terms' },
  { name: 'Claude API (Anthropic)',       license: 'Commercial terms', url: 'https://www.anthropic.com/legal' },
];

export default function LicensesScreen() {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { t } = useTranslation();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable style={styles.back} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>{t('settings.licenses_title')}</Text>
        <View style={styles.back} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.intro}>{t('settings.licenses_intro')}</Text>
        {LICENSES.map((item) => (
          <Pressable
            key={item.name}
            style={styles.row}
            onPress={() => item.url && void Linking.openURL(item.url)}
            disabled={!item.url}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.license}>{item.license}</Text>
            </View>
            {item.url && (
              <Ionicons name="open-outline" size={16} color={colors.textSecondary} />
            )}
          </Pressable>
        ))}
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
    content: { padding: spacing[4], gap: spacing[2] },
    intro: {
      ...textStyles.body,
      color: colors.textSecondary,
      marginBottom: spacing[3],
      lineHeight: 20,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: spacing[3],
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      gap: spacing[2],
    },
    name: {
      ...textStyles.body,
      color: colors.textPrimary,
      fontWeight: '600',
    },
    license: {
      ...textStyles.caption,
      color: colors.textSecondary,
      marginTop: 2,
    },
  });
}
