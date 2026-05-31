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
import { PieChart, BarChart } from 'react-native-chart-kit';
import { Dimensions } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useSubscriptionStore } from '@/stores/subscriptionStore';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import {
  getEventStatsForRange,
  presetRange,
  type EventStats,
} from '@/services/analyticsService';
import { generateInsight, type InsightResult } from '@/services/insightsService';

type Preset = 'week' | 'month' | 'quarter';

const DOW_LABELS = ['일', '월', '화', '수', '목', '금', '토'] as const;

/** 화면 너비 - 카드 좌우 padding 32. chart 가 카드 안 꽉 채우게. */
const chartWidth = Dimensions.get('window').width - 64;

/** chart-kit 공통 config — 테마 색 반영. */
function chartConfig(colors: ReturnType<typeof useColors>) {
  return {
    backgroundColor: 'transparent',
    backgroundGradientFrom: colors.surface,
    backgroundGradientTo: colors.surface,
    decimalPlaces: 0,
    color: (opacity = 1) => `rgba(124, 58, 237, ${opacity})`,
    labelColor: () => colors.textSecondary,
    barPercentage: 0.65,
    propsForBackgroundLines: { stroke: 'transparent' },
  };
}

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
  const isPro = useSubscriptionStore((s) => s.plan === 'pro');

  const [preset, setPreset] = useState<Preset>('month');
  const [stats, setStats] = useState<EventStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchStats = async () => {
    // 분석은 Pro 전용 — Free 사용자는 통계 쿼리 자체를 생략 (불필요 비용 방지).
    if (!isPro) {
      setLoading(false);
      return;
    }
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

  // ─── 분석 탭 전체 Pro 게이트 ──────────────────────────────────────────
  // Free 사용자에게는 실제 분석 대신 가치 제안 + 업그레이드 안내 화면을 보여준다.
  // 탭 자체는 탭바에 그대로 노출 → 발견성 유지 + 전환 유도 (paywall teaser 패턴).
  if (!isPro) {
    return <AnalyticsPaywallView styles={styles} colors={colors} />;
  }

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

            {/* 카테고리 비중 — chart-kit PieChart + legend */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>카테고리 비중</Text>
              {stats.byCategory.length === 0 ? (
                <Text style={styles.emptyText}>이 기간에 등록된 일정이 없어요</Text>
              ) : (
                <>
                  <PieChart
                    data={stats.byCategory.slice(0, 6).map((c) => ({
                      name:            c.name,
                      population:      c.count,
                      color:           c.color,
                      legendFontColor: colors.textSecondary,
                      legendFontSize:  11,
                    }))}
                    width={chartWidth}
                    height={180}
                    chartConfig={chartConfig(colors)}
                    accessor="population"
                    backgroundColor="transparent"
                    paddingLeft="0"
                    absolute={false}
                    hasLegend={false}
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
                          <Text style={styles.catCount}>
                            {cat.count}개 · {pct}%
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                </>
              )}
            </View>

            {/* 요일 분포 — chart-kit BarChart */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>요일 분포</Text>
              <BarChart
                data={{
                  labels: stats.byDayOfWeek.map((d) => DOW_LABELS[d.dow] ?? ''),
                  datasets: [{
                    data: stats.byDayOfWeek.map((d) => d.count),
                  }],
                }}
                width={chartWidth}
                height={180}
                yAxisLabel=""
                yAxisSuffix=""
                fromZero
                showValuesOnTopOfBars
                withHorizontalLabels={false}
                withInnerLines={false}
                chartConfig={chartConfig(colors)}
                style={{ marginLeft: -spacing[3] }}
              />
            </View>

            {/* 시간대 분포 — Pro. 4분할 heat map. Free 는 잠금 overlay. */}
            <ProGate isPro={isPro} styles={styles} colors={colors} title="시간대 분포">
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
              <Text style={styles.bucketCaption}>
                아침 5–12시 · 낮 12–17시 · 저녁 17–22시 · 밤 22–5시
              </Text>
            </ProGate>

            {/* AI 인사이트 — Pro. Edge Function 호출은 Pro 일 때만. */}
            {isPro ? (
              <AIInsightCard stats={stats} styles={styles} colors={colors} />
            ) : (
              <ProGate isPro={false} styles={styles} colors={colors} title="AI 인사이트">
                <Text style={styles.insightBody}>
                  AI 가 당신의 일정 패턴을 분석해 자연어 인사이트와 액션 제안을 드려요.
                </Text>
              </ProGate>
            )}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * 분석 탭 Pro 페이월 화면 — Free 사용자가 분석 탭에 진입했을 때 표시.
 *
 * 블러 미리보기 대신 "무엇을 얻는지"를 명확히 제시 + 업그레이드 CTA.
 * CTA 는 기존 결제 화면(`/subscription/paywall`)을 재사용한다.
 */
function AnalyticsPaywallView({
  styles,
  colors,
}: {
  styles: ReturnType<typeof makeStyles>;
  colors: ReturnType<typeof useColors>;
}) {
  // Pro 분석이 제공하는 핵심 가치 — paywall feature 목록과 톤 일치.
  const features: Array<{
    icon: React.ComponentProps<typeof Ionicons>['name'];
    text: string;
  }> = [
    { icon: 'pie-chart-outline', text: '카테고리 · 요일 · 시간대 분포 분석' },
    { icon: 'trending-up-outline', text: '기간별 추이와 가장 바쁜 시간 파악' },
    { icon: 'sparkles-outline', text: 'AI 맞춤 인사이트 & 다음 주 추천' },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.paywallContent}>
        <View style={styles.paywallHero}>
          <View style={styles.paywallIconCircle}>
            <Ionicons name="bar-chart" size={34} color={colors.primary} />
          </View>
          <Text style={styles.paywallTitle}>분석은 Pro 기능이에요</Text>
          <Text style={styles.paywallSub}>
            내 일정 패턴을 한눈에 보고, AI 인사이트로 더 똑똑하게 계획하세요.
          </Text>
        </View>

        <View style={styles.paywallFeatures}>
          {features.map((f) => (
            <View key={f.icon} style={styles.paywallFeatureRow}>
              <Ionicons name={f.icon} size={18} color={colors.primary} />
              <Text style={styles.paywallFeatureText}>{f.text}</Text>
            </View>
          ))}
        </View>

        <TouchableOpacity
          style={styles.paywallCta}
          activeOpacity={0.9}
          onPress={() => router.push('/subscription/paywall')}
        >
          <Ionicons name="lock-open-outline" size={16} color="#FFFFFF" />
          <Text style={styles.paywallCtaText}>Pro로 업그레이드</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * Pro 게이트 wrapper. isPro 면 자식 그대로, Free 면 blur overlay + 자물쇠
 * + paywall CTA. 카드 외형은 동일하게 유지.
 */
function ProGate({
  isPro,
  title,
  styles,
  colors,
  children,
}: {
  isPro: boolean;
  title: string;
  styles: ReturnType<typeof makeStyles>;
  colors: ReturnType<typeof useColors>;
  children: React.ReactNode;
}) {
  if (isPro) {
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{title}</Text>
        {children}
      </View>
    );
  }
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={() => router.push('/subscription/paywall')}
      style={styles.card}
    >
      <View style={styles.insightHeader}>
        <Text style={styles.cardTitle}>{title}</Text>
        <View style={styles.proBadge}>
          <Ionicons name="star" size={10} color={colors.textInverse} />
          <Text style={styles.proBadgeText}>PRO</Text>
        </View>
      </View>
      <View style={styles.gateLocked}>{children}</View>
      <View style={styles.gateCta}>
        <Text style={styles.gateCtaText}>탭하면 Pro 로 잠금 해제</Text>
        <Ionicons name="chevron-forward" size={14} color={colors.primary} />
      </View>
    </TouchableOpacity>
  );
}

/**
 * AI 인사이트 카드.
 *
 * stats 가 바뀔 때마다 자동 호출 (preset 변경 trigger). 응답 = 자연어 코멘트
 * + 액션 제안. 일일 quota 초과 시 안내 텍스트.
 */
function AIInsightCard({
  stats,
  styles,
  colors,
}: {
  stats: EventStats;
  styles: ReturnType<typeof makeStyles>;
  colors: ReturnType<typeof useColors>;
}) {
  const [insight, setInsight] = useState<InsightResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setInsight(null);
    generateInsight(stats)
      .then((res) => {
        if (!cancelled) setInsight(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '인사이트를 받지 못했어요.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [stats]);

  return (
    <View style={styles.card}>
      <View style={styles.insightHeader}>
        <Text style={styles.cardTitle}>AI 인사이트</Text>
        <View style={styles.insightBadge}>
          <Text style={styles.insightBadgeText}>BETA</Text>
        </View>
      </View>
      {loading ? (
        <View style={styles.insightLoadingRow}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.insightLoadingText}>분석 중이에요…</Text>
        </View>
      ) : error ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : insight?.quotaExceeded ? (
        <Text style={styles.lockedText}>
          오늘 무료 인사이트 한도를 모두 사용했어요. Pro 로 무제한 사용할 수 있어요.
        </Text>
      ) : insight ? (
        <>
          <Text style={styles.insightBody}>{insight.comment}</Text>
          {insight.suggestion ? (
            <Text style={styles.insightAction}>💡 {insight.suggestion}</Text>
          ) : null}
        </>
      ) : null}
    </View>
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

    // ─── Pro 페이월 화면 (Free 사용자 진입 시) ───────────────────────────
    paywallContent: {
      flexGrow: 1,
      justifyContent: 'center',
      padding: spacing[5],
      gap: spacing[5],
    },
    paywallHero: { alignItems: 'center', gap: spacing[2] },
    paywallIconCircle: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: colors.backgroundAlt,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing[2],
    },
    paywallTitle: {
      ...textStyles.h2,
      color: colors.textPrimary,
      fontWeight: '700',
      textAlign: 'center',
    },
    paywallSub: {
      ...textStyles.body,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 20,
    },
    paywallFeatures: {
      gap: spacing[3],
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: spacing[4],
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    paywallFeatureRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
    paywallFeatureText: { ...textStyles.body, color: colors.textPrimary, flex: 1 },
    paywallCta: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing[2],
      backgroundColor: colors.primary,
      paddingVertical: spacing[3],
      borderRadius: radius.full,
    },
    paywallCtaText: { ...textStyles.body, color: '#FFFFFF', fontWeight: '700' },
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
    bucketCaption: {
      ...textStyles.caption,
      color: colors.textTertiary,
      textAlign: 'center',
    },
    insightHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[2],
    },
    insightBadge: {
      paddingHorizontal: spacing[2],
      paddingVertical: 2,
      borderRadius: radius.full,
      backgroundColor: colors.primary,
    },
    insightBadgeText: {
      ...textStyles.caption,
      color: colors.textInverse,
      fontWeight: '700',
      fontSize: 10,
    },
    insightBody: {
      ...textStyles.body,
      color: colors.textPrimary,
      lineHeight: 22,
    },
    insightAction: {
      ...textStyles.caption,
      color: colors.primary,
      fontWeight: '700',
    },
    insightLoadingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[2],
    },
    insightLoadingText: {
      ...textStyles.body,
      color: colors.textSecondary,
    },
    proBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      paddingHorizontal: spacing[2],
      paddingVertical: 2,
      borderRadius: radius.full,
      backgroundColor: colors.primary,
    },
    proBadgeText: {
      ...textStyles.caption,
      color: colors.textInverse,
      fontWeight: '700',
      fontSize: 10,
    },
    gateLocked: {
      opacity: 0.4,
    },
    gateCta: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing[1],
      paddingTop: spacing[2],
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    gateCtaText: {
      ...textStyles.caption,
      color: colors.primary,
      fontWeight: '700',
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
