/**
 * /stats/fitness — v1.2.1 헬스 + 러닝 통계 화면.
 *
 * 헬스: 부위별 횟수 list (최근 30일).
 * 러닝: 주별 누적 km + 평균 페이스 list (최근 12주).
 *
 * 차트 라이브러리 없이 simple bar 시각화 (최대 bar 비율로 width 100%).
 */

import { useEffect, useState } from 'react';
import { ScrollView, View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useColors, type ColorTokens } from '@/hooks/useColors';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import {
  getWorkoutPartStats, getRunningWeeklyStats,
  type WorkoutPartStat, type RunningStat,
} from '@/services/fitnessStatsService';

const PART_LABELS_KO: Record<string, string> = {
  chest: '가슴', back: '등', shoulders: '어깨', arms: '팔', legs: '하체',
  core: '코어', cardio: '유산소', trapezius: '승모', thighs: '허벅지', calves: '종아리',
};

function formatPace(sec: number): string {
  if (!sec) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}'${String(s).padStart(2, '0')}"`;
}

export default function FitnessStatsScreen() {
  const colors = useColors();
  const styles = makeStyles(colors);
  const [partStats, setPartStats] = useState<WorkoutPartStat[]>([]);
  const [runStats, setRunStats] = useState<RunningStat[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getWorkoutPartStats(30), getRunningWeeklyStats(12)]).then(([p, r]) => {
      if (cancelled) return;
      setPartStats(p);
      setRunStats(r);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const maxPartCount = Math.max(1, ...partStats.map((p) => p.count));
  const maxKm        = Math.max(1, ...runStats.map((r) => r.totalKm));

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.back}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>운동 통계</Text>
        <View style={styles.back} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {loading ? (
          <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
        ) : (
          <>
            {/* 헬스 부위별 통계 */}
            <Text style={styles.sectionTitle}>헬스 — 최근 30일 부위별 횟수</Text>
            {partStats.length === 0 ? (
              <Text style={styles.empty}>아직 기록된 헬스 일정이 없어요.</Text>
            ) : (
              <View style={styles.card}>
                {partStats.map((p) => (
                  <View key={p.part} style={styles.row}>
                    <Text style={styles.rowLabel}>{PART_LABELS_KO[p.part] ?? p.part}</Text>
                    <View style={styles.barWrap}>
                      <View
                        style={[
                          styles.bar,
                          { width: `${(p.count / maxPartCount) * 100}%` },
                        ]}
                      />
                    </View>
                    <Text style={styles.rowCount}>{p.count}회</Text>
                  </View>
                ))}
              </View>
            )}

            {/* 러닝 주별 통계 */}
            <Text style={styles.sectionTitle}>러닝 — 최근 12주</Text>
            {runStats.length === 0 ? (
              <Text style={styles.empty}>아직 기록된 러닝 일정이 없어요.</Text>
            ) : (
              <View style={styles.card}>
                {runStats.map((r) => (
                  <View key={r.bucket} style={styles.row}>
                    <Text style={styles.rowLabel}>{r.bucket.slice(5)}</Text>
                    <View style={styles.barWrap}>
                      <View
                        style={[
                          styles.bar,
                          styles.barRun,
                          { width: `${(r.totalKm / maxKm) * 100}%` },
                        ]}
                      />
                    </View>
                    <Text style={styles.rowCount}>
                      {r.totalKm} km · {formatPace(r.avgPaceSeconds)}/km
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </>
        )}
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
    scroll: { padding: spacing[4], gap: spacing[3] },
    center: { padding: spacing[6], alignItems: 'center' },
    sectionTitle: {
      ...textStyles.label,
      color: colors.textSecondary,
      marginTop: spacing[3],
      marginBottom: spacing[2],
    },
    empty: {
      ...textStyles.bodySm,
      color: colors.textTertiary,
      textAlign: 'center',
      padding: spacing[5],
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing[3],
      gap: spacing[2],
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[2],
    },
    rowLabel: {
      ...textStyles.bodySm,
      color: colors.textPrimary,
      width: 60,
    },
    barWrap: {
      flex: 1,
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.backgroundAlt,
      overflow: 'hidden',
    },
    bar: {
      height: '100%',
      backgroundColor: '#A1887F', // 헬스/러닝 통일 갈색
      borderRadius: 4,
    },
    barRun: { backgroundColor: '#8D6E63' },  // 러닝 좀 더 진한 갈색
    rowCount: {
      ...textStyles.caption,
      color: colors.textSecondary,
      minWidth: 90,
      textAlign: 'right',
    },
  });
}
