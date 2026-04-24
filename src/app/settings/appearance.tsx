/**
 * Appearance settings — user-selectable header title colour + link to
 * open-source license notices. Created in response to a user request
 * for a dedicated "내 정보 > 화면 설정" section.
 */

import { ScrollView, View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import type { ColorTokens } from '@/hooks/useColors';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import {
  useAppearanceStore,
  HEADER_TITLE_COLOR_HEX,
  type HeaderTitleColor,
} from '@/stores/appearanceStore';

const COLOR_OPTIONS: Array<{ key: HeaderTitleColor; label: string }> = [
  { key: 'default', label: '기본' },
  { key: 'primary', label: '인디고' },
  { key: 'rose',    label: '로즈' },
  { key: 'emerald', label: '에메랄드' },
  { key: 'amber',   label: '앰버' },
  { key: 'violet',  label: '바이올렛' },
];

export default function AppearanceSettingsScreen() {
  const colors = useColors();
  const styles = makeStyles(colors);
  const headerTitleColor = useAppearanceStore((s) => s.headerTitleColor);
  const setHeaderTitleColor = useAppearanceStore((s) => s.setHeaderTitleColor);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Local header (not using Stack options so the screen is self-contained) */}
      <View style={styles.header}>
        <Pressable style={styles.back} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>화면 설정</Text>
        <View style={styles.back} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionLabel}>상단 제목 색상</Text>
        <Text style={styles.sectionHelp}>
          탭 상단의 홈 · 캘린더 · 플래너 · 내 정보 제목에 적용됩니다.
        </Text>
        <View style={styles.colorGrid}>
          {COLOR_OPTIONS.map((opt) => {
            const hex = HEADER_TITLE_COLOR_HEX[opt.key] ?? colors.textPrimary;
            const selected = opt.key === headerTitleColor;
            return (
              <Pressable
                key={opt.key}
                style={[
                  styles.colorChip,
                  selected && { borderColor: hex, borderWidth: 2 },
                ]}
                onPress={() => setHeaderTitleColor(opt.key)}
              >
                <View style={[styles.colorSwatch, { backgroundColor: hex }]} />
                <Text style={[styles.colorLabel, selected && { color: hex, fontWeight: '700' }]}>
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.divider} />

        <Pressable
          style={styles.row}
          onPress={() => router.push('/settings/licenses')}
        >
          <Text style={styles.rowText}>오픈소스 라이선스</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
        </Pressable>
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
    sectionLabel: {
      ...textStyles.labelLg,
      color: colors.textPrimary,
      fontWeight: '600',
      marginBottom: spacing[1],
    },
    sectionHelp: {
      ...textStyles.caption,
      color: colors.textSecondary,
      marginBottom: spacing[3],
    },
    colorGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing[2],
    },
    colorChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: spacing[3],
      paddingVertical: spacing[2],
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    colorSwatch: {
      width: 16,
      height: 16,
      borderRadius: 8,
    },
    colorLabel: {
      ...textStyles.body,
      color: colors.textPrimary,
    },
    divider: {
      height: 1,
      backgroundColor: colors.border,
      marginVertical: spacing[5],
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: colors.surface,
      padding: spacing[4],
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
    },
    rowText: {
      ...textStyles.body,
      color: colors.textPrimary,
    },
  });
}
