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
import { useResponsive } from '@/hooks/useResponsive';
import { desktopContentCentered } from '@/constants/webLayout';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useSubscriptionStore } from '@/stores/subscriptionStore';
import { useAuthStore } from '@/stores/authStore';
import { useTranslation } from 'react-i18next';
import { GuestGate } from '@/components/common/GuestGate';
import { AppErrorBoundary } from '@/components/common/AppErrorBoundary';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import {
  getEventStatsForRange,
  presetRange,
  type EventStats,
} from '@/services/analyticsService';
import {
  getDayHourGrid,
  getWeeklyTrend,
  getOwnershipSplit,
  type DayHourGrid,
  type WeeklyTrendPoint,
  type OwnershipSplit,
} from '@/services/analyticsExtrasService';
import { generateInsight, type InsightResult } from '@/services/insightsService';
import i18n from '@/lib/i18n';

type Preset = 'week' | 'month' | 'quarter';

/** Localized weekday short labels (일~토 / Sun~Sat / …) — read from i18n. */
function dowLabels(): readonly string[] {
  return i18n.t('analytics.dow', { returnObjects: true }) as readonly string[];
}

/**
 * 화면 너비 - 카드 좌우 padding. chart 가 카드 안 꽉 채우게.
 * 웹 데스크탑에서는 본문이 _layout 의 maxWidth(880)로 좁혀지므로 window 전체폭을
 * 그대로 쓰면 차트가 컨테이너를 넘친다 → 880 으로 클램프. 모바일은 window<880 이라
 * 기존(window-64)과 동일하게 동작(회귀 없음). (2026-06-08)
 */
const chartWidth = Math.min(Dimensions.get('window').width, 880) - 64;

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
  const hh = i18n.t('analytics.hours');
  const mm = i18n.t('analytics.minutes');
  if (min < 60) return `${min}${mm}`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}${hh}` : `${h}${hh} ${m}${mm}`;
}

/** 증감 비교 결과. up=null = 변화없음/비교불가. */
interface Delta {
  /** "12%" 같은 절대 퍼센트 텍스트 (부호 제외) 또는 'NEW'. */
  text: string;
  /** true=증가, false=감소, null=동일/비교불가. */
  up: boolean | null;
}

/** 현재 vs 직전 값으로 증감률 계산. */
function computeDelta(curr: number, prev: number): Delta {
  if (prev === 0) return { text: curr > 0 ? 'NEW' : '—', up: curr > 0 ? true : null };
  const pct = Math.round(((curr - prev) / prev) * 100);
  if (pct === 0) return { text: '0%', up: null };
  return { text: `${Math.abs(pct)}%`, up: pct > 0 };
}

/** 기간 라벨 (비교 caption 용). */
function presetLabel(p: Preset): string {
  return p === 'week'
    ? i18n.t('analytics.unit_week')
    : p === 'month'
      ? i18n.t('analytics.unit_month')
      : i18n.t('analytics.unit_quarter');
}

/** 하루 평균 일정 수 (기간 길이로 나눔). */
function avgPerDay(s: EventStats): string {
  const days = Math.max(
    1,
    Math.round((s.range.end.getTime() - s.range.start.getTime()) / 86_400_000),
  );
  return (s.totalCount / days).toFixed(1);
}

/** 증감 색상 — 증가 green / 감소 red (테마 무관 고정, 가독 보장). */
const DELTA_UP_COLOR = '#10B981';
const DELTA_DOWN_COLOR = '#EF4444';

/**
 * Guest gate: analytics is account + Pro gated. Guests (no account) get a
 * sign-in prompt; the Pro paywall inside the content component still applies
 * to signed-in Free users.
 */
export default function AnalyticsScreen() {
  const { t } = useTranslation();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  if (!isAuthenticated) {
    return (
      <GuestGate
        description={t('auth.guest.gate_analytics')}
        icon="bar-chart-outline"
        testID="guest-gate-analytics"
      />
    );
  }
  // 분석 화면이 (차트 빈데이터·계정 통합 후 데이터 불일치 등으로) 렌더 크래시해도
  // 검은화면 대신 폴백 + 재시도 UI 를 보여주고, 실제 에러를 error_logs 에 남긴다(2026-06-07).
  return (
    <AppErrorBoundary area="analytics">
      <AnalyticsScreenContent />
    </AppErrorBoundary>
  );
}

function AnalyticsScreenContent() {
  const { t } = useTranslation();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const isPro = useSubscriptionStore((s) => s.plan === 'pro');
  // 데스크탑 웹: 콘텐츠 적정폭(880) 중앙 정렬. (웹 반응형 S2)
  const { isDesktop } = useResponsive();

  const [preset, setPreset] = useState<Preset>('month');
  const [stats, setStats] = useState<EventStats | null>(null);
  // 직전 동일 길이 기간 (증감 비교용) + Phase 3 확장 집계.
  const [prevStats, setPrevStats] = useState<EventStats | null>(null);
  const [grid, setGrid] = useState<DayHourGrid | null>(null);
  const [trend, setTrend] = useState<WeeklyTrendPoint[] | null>(null);
  const [ownership, setOwnership] = useState<OwnershipSplit | null>(null);
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
      // 직전 동일 길이 기간 (range.start 직전으로 같은 span 만큼).
      const spanMs = range.end.getTime() - range.start.getTime();
      const prevRange = {
        start: new Date(range.start.getTime() - spanMs - 1),
        end: new Date(range.start.getTime() - 1),
      };
      // 현재/직전 통계 + 확장 집계를 병렬 조회.
      const [result, prev, gridRes, trendRes, ownershipRes] = await Promise.all([
        getEventStatsForRange(range),
        getEventStatsForRange(prevRange),
        getDayHourGrid(range),
        getWeeklyTrend(8),
        getOwnershipSplit(range),
      ]);
      setStats(result);
      setPrevStats(prev);
      setGrid(gridRes);
      setTrend(trendRes);
      setOwnership(ownershipRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('analytics.error_load'));
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
        contentContainerStyle={[
          styles.content,
          isDesktop && desktopContentCentered,
        ]}
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
                {p === 'week' ? t('analytics.preset_week') : p === 'month' ? t('analytics.preset_month') : t('analytics.preset_quarter')}
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
              <Text style={styles.retryText}>{t('analytics.retry')}</Text>
            </TouchableOpacity>
          </View>
        ) : stats ? (
          <>
            {/* 요약 카드 — 직전 기간 대비 증감 + 하루 평균 + 한가한 요일 + 최다 카테고리 */}
            <View style={styles.card}>
              <View style={styles.insightHeader}>
                <Text style={styles.cardTitle}>{t('analytics.summary_title')}</Text>
                {prevStats && (
                  <Text style={styles.compareCaption}>{t('analytics.compare', { period: presetLabel(preset) })}</Text>
                )}
              </View>
              <View style={styles.summaryRow}>
                <StatDelta
                  label={t('analytics.stat_total')}
                  value={`${stats.totalCount}${t('analytics.count_unit')}`}
                  delta={prevStats ? computeDelta(stats.totalCount, prevStats.totalCount) : null}
                  styles={styles}
                />
                <StatDelta
                  label={t('analytics.stat_total_time')}
                  value={formatMinutes(stats.totalMinutes)}
                  delta={prevStats ? computeDelta(stats.totalMinutes, prevStats.totalMinutes) : null}
                  styles={styles}
                />
              </View>
              <View style={styles.summaryRow}>
                <Stat label={t('analytics.stat_avg_day')} value={`${avgPerDay(stats)}${t('analytics.count_unit')}`} />
                <Stat
                  label={t('analytics.stat_busiest')}
                  value={stats.busiestDow !== null ? `${dowLabels()[stats.busiestDow]}${t('analytics.dow_suffix')}` : t('analytics.none')}
                />
              </View>
              <View style={styles.summaryRow}>
                <Stat
                  label={t('analytics.stat_quietest')}
                  value={stats.quietestDow !== null ? `${dowLabels()[stats.quietestDow]}${t('analytics.dow_suffix')}` : t('analytics.none')}
                />
                <Stat label={t('analytics.stat_top_category')} value={stats.byCategory[0]?.name || t('analytics.none')} />
              </View>
            </View>

            {/* 카테고리 비중 — chart-kit PieChart + legend */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{t('analytics.cat_share_title')}</Text>
              {stats.byCategory.length === 0 ? (
                <Text style={styles.emptyText}>{t('analytics.empty_period')}</Text>
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
                            {cat.count}{t('analytics.count_unit')} · {pct}%
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                </>
              )}
            </View>

            {/* 요일 분포 — chart-kit BarChart.
                ⚠️ chart-kit 은 labels/data 가 빈 배열이면 내부적으로 Math.max(...[])
                = -Infinity 로 스케일을 계산하다 렌더 크래시(검은화면)한다. byDayOfWeek 가
                비어 있으면(해당 기간 일정 0건) 차트 대신 안내 문구로 폴백. (PieChart 와 동일 가드, 2026-06-07) */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{t('analytics.dow_dist_title')}</Text>
              {stats.byDayOfWeek.length === 0 ? (
                <Text style={styles.emptyText}>{t('analytics.empty_period')}</Text>
              ) : (
                <BarChart
                  data={{
                    labels: stats.byDayOfWeek.map((d) => dowLabels()[d.dow] ?? ''),
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
              )}
            </View>

            {/* 요일 × 시간대 히트맵 (7×4) — 4분할 단순 막대를 격자로 강화 */}
            {grid && grid.total > 0 && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>{t('analytics.heatmap_title')}</Text>
                <View style={styles.heatGrid}>
                  <View style={styles.heatRow}>
                    <View style={styles.heatCornerCell} />
                    {[t('analytics.tod_morning'), t('analytics.tod_afternoon'), t('analytics.tod_evening'), t('analytics.tod_night')].map((b) => (
                      <Text key={b} style={styles.heatColLabel}>{b}</Text>
                    ))}
                  </View>
                  {grid.grid.map((row, dow) => (
                    <View key={dow} style={styles.heatRow}>
                      <Text style={styles.heatRowLabel}>{dowLabels()[dow]}</Text>
                      {row.map((count, bIdx) => {
                        const intensity = grid.max > 0 ? count / grid.max : 0;
                        return (
                          <View
                            key={bIdx}
                            style={[
                              styles.heatCell,
                              {
                                backgroundColor: colors.primary,
                                opacity: count === 0 ? 0.06 : 0.2 + intensity * 0.8,
                              },
                            ]}
                          >
                            <Text
                              style={[
                                styles.heatCellText,
                                intensity > 0.5 && styles.heatCellTextStrong,
                              ]}
                            >
                              {count || ''}
                            </Text>
                          </View>
                        );
                      })}
                    </View>
                  ))}
                </View>
                <Text style={styles.bucketCaption}>
                  {t('analytics.tod_legend')}
                </Text>
              </View>
            )}

            {/* 내 일정 · 공유받은 일정 비중 (isOwn 기준) */}
            {ownership && ownership.own.count + ownership.shared.count > 0 && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>{t('analytics.own_share_title')}</Text>
                <View style={styles.summaryRow}>
                  <Stat label={t('analytics.stat_own')} value={`${ownership.own.count}${t('analytics.count_unit')}`} />
                  <Stat label={t('analytics.stat_shared')} value={`${ownership.shared.count}${t('analytics.count_unit')}`} />
                  <Stat label={t('analytics.stat_shared_pct')} value={`${ownership.sharedPct}%`} />
                </View>
                <View style={styles.scopeBar}>
                  <View style={[styles.scopeBarShared, { width: `${ownership.sharedPct}%` }]} />
                </View>
              </View>
            )}

            {/* 주별 추이 (최근 8주) */}
            {trend && trend.some((p) => p.count > 0) && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>{t('analytics.weekly_trend_title')}</Text>
                <BarChart
                  data={{
                    labels: trend.map((p) => p.label),
                    datasets: [{ data: trend.map((p) => p.count) }],
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
            )}

            {/* AI 인사이트 — Pro. Edge Function 호출은 Pro 일 때만. */}
            {isPro ? (
              <AIInsightCard stats={stats} styles={styles} colors={colors} />
            ) : (
              <ProGate isPro={false} styles={styles} colors={colors} title={t('analytics.insights_title')}>
                <Text style={styles.insightBody}>
                  {t('analytics.insights_desc')}
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
  const { t } = useTranslation();
  // 데스크탑 웹: 페이월 콘텐츠 적정폭(880) 중앙 정렬. (웹 반응형 S2)
  const { isDesktop } = useResponsive();
  // Pro 분석이 제공하는 핵심 가치 — paywall feature 목록과 톤 일치.
  const features: {
    icon: React.ComponentProps<typeof Ionicons>['name'];
    text: string;
  }[] = [
    { icon: 'pie-chart-outline', text: t('analytics.feature_distribution') },
    { icon: 'trending-up-outline', text: t('analytics.feature_trend') },
    { icon: 'sparkles-outline', text: t('analytics.feature_ai') },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={[
          styles.paywallContent,
          isDesktop && desktopContentCentered,
        ]}
      >
        <View style={styles.paywallHero}>
          <View style={styles.paywallIconCircle}>
            <Ionicons name="bar-chart" size={34} color={colors.primary} />
          </View>
          <Text style={styles.paywallTitle}>{t('analytics.paywall_title')}</Text>
          <Text style={styles.paywallSub}>
            {t('analytics.paywall_desc')}
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
          <Text style={styles.paywallCtaText}>{t('analytics.pro_upgrade')}</Text>
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
  const { t } = useTranslation();
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
        <Text style={styles.gateCtaText}>{t('analytics.gate_unlock')}</Text>
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
  const { t } = useTranslation();
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
        if (!cancelled) setError(err instanceof Error ? err.message : t('analytics.error_insight'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [stats]);

  return (
    <View style={styles.card}>
      <View style={styles.insightHeader}>
        <Text style={styles.cardTitle}>{t('analytics.insights_title')}</Text>
        <View style={styles.insightBadge}>
          <Text style={styles.insightBadgeText}>BETA</Text>
        </View>
      </View>
      {loading ? (
        <View style={styles.insightLoadingRow}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.insightLoadingText}>{t('analytics.insight_loading')}</Text>
        </View>
      ) : error ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : insight?.quotaExceeded ? (
        <Text style={styles.lockedText}>
          {t('analytics.insight_quota')}
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

/** 증감 배지가 붙는 stat (직전 기간 대비). */
function StatDelta({
  label,
  value,
  delta,
  styles,
}: {
  label: string;
  value: string;
  delta: Delta | null;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.stat}>
      <View style={styles.statValueRow}>
        <Text style={styles.statValue}>{value}</Text>
        {delta && delta.up !== null && (
          <Text
            style={[
              styles.deltaText,
              { color: delta.up ? DELTA_UP_COLOR : DELTA_DOWN_COLOR },
            ]}
          >
            {delta.up ? '▲' : '▼'}{delta.text}
          </Text>
        )}
      </View>
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

    // ─── Phase 3 확장 (비교/히트맵/Space/추이) ───────────────────────────
    compareCaption: { ...textStyles.caption, color: colors.textTertiary },
    statValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
    deltaText: { ...textStyles.caption, fontWeight: '700', fontSize: 11 },
    // 7×4 히트맵
    heatGrid: { gap: 4 },
    heatRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    heatCornerCell: { width: 24 },
    heatColLabel: {
      flex: 1,
      ...textStyles.caption,
      fontSize: 10,
      color: colors.textTertiary,
      textAlign: 'center',
    },
    heatRowLabel: {
      width: 24,
      ...textStyles.caption,
      fontSize: 11,
      color: colors.textSecondary,
      textAlign: 'center',
    },
    heatCell: {
      flex: 1,
      height: 34,
      borderRadius: radius.sm,
      alignItems: 'center',
      justifyContent: 'center',
    },
    heatCellText: { ...textStyles.caption, fontSize: 11, color: colors.textPrimary },
    heatCellTextStrong: { color: '#FFFFFF', fontWeight: '700' },
    // 개인/공유 비율 바
    scopeBar: {
      height: 8,
      borderRadius: radius.full,
      backgroundColor: colors.backgroundAlt,
      overflow: 'hidden',
    },
    scopeBarShared: {
      height: '100%',
      borderRadius: radius.full,
      backgroundColor: colors.primary,
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
