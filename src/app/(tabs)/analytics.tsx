/**
 * Analytics tab — AI 분석 대시보드 (Sprint 1 / Phase 2).
 *
 * 카드 구성:
 *  - 기간 segment (이번 주 / 이번 달 / 분기)
 *  - 요약 카드 (총 일정, 가장 바쁜 요일, 빈 시간)
 *  - 카테고리 비중 (Phase 2-차트)
 *  - 요일 분포 (Phase 2-차트)
 *  - 시간대 분포 (Phase 2-차트) — Pro
 *  - 운동 인사이트 — Pro
 *  - AI 코멘트 — Pro (Phase 3)
 *
 * 현재 = Phase 2 스켈레톤. 요약 카드 + 카테고리 list 만. 차트 + AI 는 다음 step.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PieChart, BarChart } from 'react-native-gifted-charts';
import { useColors } from '@/hooks/useColors';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import {
  getEventStatsForRange,
  presetRange,
  type EventStats,
} from '@/services/analyticsService';

type Preset = 'week' | 'month' | 'quarter';

const DOW_LABELS = ['일', '월', '화', '수', '목', '금', '토'] as const;

/**
 * 분(minutes) → "Nh Mm" 또는 "Nm" 사람이 읽는 포맷.
 */
function formatMinutes(min: number): string {
  if (min < 60) return `${min}분`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`;
}

export default function AnalyticsScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [preset, setPreset] = useState<Preset>('month');
  const [stats, setStats] = useState<EventStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchStats = async () => {
    setError(null);
    try {
      const range = presetRange(preset);
      const result = await getEventStatsForRange(range);
      setStats(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : '분석 데이터를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    fetchStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchStats();
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* 기간 segment */}
        <View style={styles.segment}>
          {(['week', 'month', 'quarter'] as const).map((p) => (
            <TouchableOpacity
              key={p}
              onPress={() => setPreset(p)}
              style={[styles.segmentBtn, preset === p && styles.segmentBtnActive]}
            >
              <Text style={[styles.segmentText, preset === p && styles.segmentTextActive]}>
                {p === 'week' ? '주간' : p === 'month' ? '월간' : '분기'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : error ? (
          <View style={styles.center}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity onPress={fetchStats} style={styles.retryBtn}>
              <Text style={styles.retryText}>다시 시도</Text>
            </TouchableOpacity>
          </View>
        ) : stats ? (
          <>
            {/* 요약 카드 */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>요약</Text>
              <View style={styles.summaryRow}>
                <Stat label="총 일정" value={`${stats.totalCount}개`} />
                <Stat label="총 시간" value={formatMinutes(stats.totalMinutes)} />
              </View>
              <View style={styles.summaryRow}>
                <Stat
                  label="가장 바쁜 요일"
                  value={stats.busiestDow !== null ? `${DOW_LABELS[stats.busiestDow]}요일` : '—'}
                />
                <Stat label="빈 날" value={`${stats.emptyDayCount}일`} />
              </View>
            </View>

            {/* 카테고리 비중 — 도넛 차트 + range list */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>카테고리 비중</Text>
              {stats.byCategory.length === 0 ? (
                <Text style={styles.emptyText}>이 기간에 등록된 일정이 없어요</Text>
              ) : (
                <View style={styles.donutWrap}>
                  <PieChart
                    donut
                    radius={70}
                    innerRadius={45}
                    innerCircleColor={colors.surface}
                    data={stats.byCategory.slice(0, 6).map((c) => ({
                      value: c.count,
                      color: c.color,
                    }))}
                    centerLabelComponent={() => (
                      <View style={styles.donutCenter}>
                        <Text style={styles.donutCenterValue}>{stats.totalCount}</Text>
                        <Text style={styles.donutCenterLabel}>건</Text>
                      </View>
                    )}
                  />
                  <View style={styles.legendWrap}>
                    {stats.byCategory.slice(0, 5).map((cat) => {
                      const pct = stats.totalCount > 0
                        ? Math.round((cat.count / stats.totalCount) * 100)
                        : 0;
                      return (
                        <View key={cat.categoryId ?? '__none__'} style={styles.catRow}>
                          <View style={[styles.catDot, { backgroundColor: cat.color }]} />
                          <Text style={styles.catName} numberOfLines={1}>
                            {cat.name}
                          </Text>
                          <Text style={styles.catCount}>{pct}%</Text>
                        </View>
                      );
                    })}
                  </View>
                </View>
              )}
            </View>

            {/* 요일 분포 — gifted-charts BarChart */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>요일 분포</Text>
              <BarChart
                data={stats.byDayOfWeek.map((d) => ({
                  value: d.count,
                  label: DOW_LABELS[d.dow] ?? '',
                  frontColor:
                    d.dow === 0 ? '#EF4444' : d.dow === 6 ? '#3B82F6' : colors.primary,
                }))}
                barWidth={22}
                spacing={12}
                hideRules
                xAxisThickness={0}
                yAxisThickness={0}
                yAxisTextStyle={{ color: colors.textSecondary, fontSize: 10 }}
                xAxisLabelTextStyle={{ color: colors.textSecondary, fontSize: 11 }}
                noOfSections={4}
                isAnimated
                maxValue={Math.max(...stats.byDayOfWeek.map((d) => d.count), 4)}
              />
            </View>

            {/* 시간대 분포 — Pro placeholder (다음 step 에서 활성화) */}
            <View style={[styles.card, styles.lockedCard]}>
              <Text style={styles.cardTitle}>시간대 분포</Text>
              <View style={styles.bucketRow}>
                {stats.byHourBucket.map((b) => {
                  const max = Math.max(...stats.byHourBucket.map((x) => x.count), 1);
                  const intensity = b.count / max;
                  return (
                    <View key={b.bucket} style={styles.bucketCol}>
                      <View
                        style={[
                          styles.bucketBox,
                          { backgroundColor: colors.primary, opacity: 0.15 + intensity * 0.85 },
                        ]}
                      >
                        <Text style={styles.bucketCount}>{b.count}</Text>
                      </View>
                      <Text style={styles.bucketLabel}>
                        {b.bucket === 'morning' ? '아침' : b.bucket === 'afternoon' ? '낮' : b.bucket === 'evening' ? '저녁' : '밤'}
                      </Text>
                    </View>
                  );
                })}
              </View>
              <Text style={styles.lockedText}>운동 인사이트 · AI 코멘트는 Pro 에서 만나요</Text>
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

/** 요약 카드 안 단일 stat. */
function Stat({ label, value }: { label: string; value: string }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    safe: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      padding: spacing[4],
      gap: spacing[3],
    },
    segment: {
      flexDirection: 'row',
      backgroundColor: colors.backgroundAlt,
      borderRadius: radius.full,
      padding: 4,
    },
    segmentBtn: {
      flex: 1,
      paddingVertical: spacing[2],
      borderRadius: radius.full,
      alignItems: 'center',
    },
    segmentBtnActive: {
      backgroundColor: colors.background,
    },
    segmentText: {
      ...textStyles.body,
      color: colors.textSecondary,
    },
    segmentTextActive: {
      color: colors.textPrimary,
      fontWeight: '700',
    },
    center: {
      paddingVertical: spacing[10],
      alignItems: 'center',
      gap: spacing[3],
    },
    errorText: {
      ...textStyles.body,
      color: colors.error,
      textAlign: 'center',
    },
    retryBtn: {
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[2],
      borderRadius: radius.md,
      backgroundColor: colors.primary,
    },
    retryText: {
      ...textStyles.body,
      color: colors.textInverse,
      fontWeight: '700',
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: spacing[4],
      gap: spacing[3],
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    cardTitle: {
      ...textStyles.h3,
      color: colors.textPrimary,
    },
    summaryRow: {
      flexDirection: 'row',
      gap: spacing[3],
    },
    stat: {
      flex: 1,
      paddingVertical: spacing[2],
    },
    statValue: {
      ...textStyles.h2,
      color: colors.textPrimary,
      fontWeight: '700',
    },
    statLabel: {
      ...textStyles.caption,
      color: colors.textSecondary,
      marginTop: 2,
    },
    emptyText: {
      ...textStyles.body,
      color: colors.textSecondary,
      textAlign: 'center',
      paddingVertical: spacing[3],
    },
    donutWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[3],
    },
    donutCenter: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    donutCenterValue: {
      ...textStyles.h2,
      color: colors.textPrimary,
      fontWeight: '700',
    },
    donutCenterLabel: {
      ...textStyles.caption,
      color: colors.textSecondary,
    },
    legendWrap: {
      flex: 1,
      gap: spacing[1.5] ?? 6,
    },
    catRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[2],
    },
    catDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
    },
    catName: {
      ...textStyles.body,
      color: colors.textPrimary,
      flex: 1,
    },
    catCount: {
      ...textStyles.caption,
      color: colors.textSecondary,
    },
    dowRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[2],
    },
    dowLabel: {
      ...textStyles.body,
      color: colors.textPrimary,
      width: 20,
    },
    dowBarBg: {
      flex: 1,
      height: 8,
      backgroundColor: colors.backgroundAlt,
      borderRadius: radius.full,
      overflow: 'hidden',
    },
    dowBarFill: {
      height: '100%',
      backgroundColor: colors.primary,
    },
    dowCount: {
      ...textStyles.caption,
      color: colors.textSecondary,
      width: 24,
      textAlign: 'right',
    },
    bucketRow: {
      flexDirection: 'row',
      gap: spacing[2],
    },
    bucketCol: {
      flex: 1,
      alignItems: 'center',
      gap: spacing[1],
    },
    bucketBox: {
      width: '100%',
      aspectRatio: 1,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    bucketCount: {
      ...textStyles.h3,
      color: colors.textInverse,
      fontWeight: '700',
    },
    bucketLabel: {
      ...textStyles.caption,
      color: colors.textSecondary,
    },
    lockedCard: {
      opacity: 0.85,
    },
    lockedText: {
      ...textStyles.caption,
      color: colors.textSecondary,
      textAlign: 'center',
      marginTop: spacing[2],
    },
  });
}
