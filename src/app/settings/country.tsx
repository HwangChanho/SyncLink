/**
 * Country settings — v1.2.0.
 *
 * 사용자가 거주 국가를 선택. 캘린더 공휴일/지역 포맷에 사용. default 'KR'.
 * 변경 즉시 DB persist + authStore 갱신 (다음 캘린더 fetch 부터 새 공휴일 적용).
 */

import { ScrollView, View, Text, Pressable, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { useColors, type ColorTokens } from '@/hooks/useColors';
import { useAuthStore } from '@/stores/authStore';
import { setUserCountry } from '@/services/userProfileService';
import { SUPPORTED_COUNTRIES, type CountryCode } from '@/services/holidayService';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';

export default function CountrySettingsScreen() {
  const colors = useColors();
  const styles = makeStyles(colors);
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const current = (user?.country_code ?? 'KR') as CountryCode;
  const [saving, setSaving] = useState<CountryCode | null>(null);

  const handlePick = useCallback(async (code: CountryCode) => {
    if (code === current || !user) return;
    setSaving(code);
    try {
      await setUserCountry(code);
      // authStore 도 즉시 갱신 → 다른 화면이 reactive 하게 새 country 사용.
      setUser({ ...user, country_code: code });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '국가 변경 실패';
      Alert.alert('오류', msg);
    } finally {
      setSaving(null);
    }
  }, [current, user, setUser]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable style={styles.back} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>국가</Text>
        <View style={styles.back} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.intro}>
          선택한 국가의 공휴일이 캘린더에 자동으로 표시됩니다.
        </Text>

        {SUPPORTED_COUNTRIES.map((opt) => {
          const active = opt.code === current;
          return (
            <Pressable
              key={opt.code}
              onPress={() => handlePick(opt.code)}
              disabled={saving !== null}
              style={[styles.row, active && styles.rowActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.rowLabel, active && styles.rowLabelActive]}>
                {opt.label}
              </Text>
              {active && (
                <Ionicons name="checkmark" size={20} color={colors.primary} />
              )}
              {saving === opt.code && !active && (
                <Text style={styles.savingText}>저장 중…</Text>
              )}
            </Pressable>
          );
        })}
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
      justifyContent: 'space-between',
      paddingHorizontal: spacing[3],
      paddingVertical: spacing[2],
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    back: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
    headerTitle: { ...textStyles.h3, color: colors.textPrimary },
    scroll: { padding: spacing[4], gap: spacing[2] },
    intro: {
      ...textStyles.bodySm,
      color: colors.textSecondary,
      marginBottom: spacing[3],
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: spacing[4],
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    rowActive: {
      borderColor: colors.primary,
      backgroundColor: colors.surface,
    },
    rowLabel: { ...textStyles.body, color: colors.textPrimary },
    rowLabelActive: { color: colors.primary, fontWeight: '600' },
    savingText: { ...textStyles.caption, color: colors.textTertiary },
  });
}
