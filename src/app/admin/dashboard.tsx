/**
 * 관리자 대시보드 — /admin/dashboard.
 *
 * 진입 URL:
 *   - 웹:    https://synclink.pages.dev/admin/dashboard
 *   - 모바일: synclink://admin/dashboard
 *
 * 보안:
 *   - 진입 시 supabase.rpc('is_admin') 호출 → false 면 즉시 router.back()
 *   - 실제 가드는 get_admin_stats RPC 안 app_admins 화이트리스트 매칭
 *   - URL 노출돼도 비-관리자에게는 빈 화면 또는 에러 (서버 거부)
 *
 * 데이터: usage_metrics + users + events 집계 (마이그레이션 046).
 */
import { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BarChart } from 'react-native-chart-kit';
import { router } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import { getAdminStats, isAdmin, type AdminStats } from '@/services/adminService';

type Days = 1 | 7 | 30;

const chartWidth = Dimensions.get('window').width - 64;

export default function AdminDashboard() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [days, setDays] = useState<Days>(7);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ─── 1) 진입 가드 ──────────────────────────────────────────────────────
  useEffect(() => {
    isAdmin()
      .then((ok) => {
        setAuthorized(ok);
        if (!ok) {
          // 비-관리자: 짧은 안내 후 뒤로. router.back() 이 stack 없으면
          // 홈으로 (Expo Router 의 fallback).
          setTimeout(() => {
            if (router.canGoBack()) router.back();
            else router.replace('/');
          }, 1500);
        }
      })
      .catch(() => setAuthorized(false));
  }, []);

  // ─── 2) stats fetch ────────────────────────────────────────────────────
  const fetchStats = async () => {
    setError(null);
    try {
      const res = await getAdminStats(days);
      setStats(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : '통계를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (authorized === true) {
      setLoading(true);
      fetchStats();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorized, days]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchStats();
  };

  // ─── 3) 가드 화면 ──────────────────────────────────────────────────────
  if (authorized === null) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }
  if (authorized === false) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={styles.deniedTitle}>접근 권한 없음</Text>
          <Text style={styles.deniedText}>
            이 페이지는 등록된 관리자만 볼 수 있어요.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // ─── 4) 대시보드 본문 ──────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Text style={styles.headerTitle}>관리자 대시보드</Text>

        {/* 기간 segment */}
        <View style={styles.segment}>
          {([1, 7, 30] as const).map((d) => (
            <TouchableOpacity
              key={d}
              onPress={() => setDays(d)}
              style={[styles.segmentBtn, days === d && styles.segmentBtnActive]}
            >
              <Text style={[styles.segmentText, days === d && styles.segmentTextActive]}>
                {d === 1 ? '오늘' : d === 7 ? '7일' : '30일'}
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
            {/* 오늘 카드 */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>오늘</Text>
              <View style={styles.row}>
                <Stat label="호출" value={`${stats.today.calls}`} styles={styles} />
                <Stat label="사용자" value={`${stats.today.users}`} styles={styles} />
                <Stat label="예상 비용" value={`$${stats.today.est_usd}`} styles={styles} />
              </View>
              <Text style={styles.subText}>
                input {stats.today.in_tok.toLocaleString()} · output {stats.today.out_tok.toLocaleString()} tokens
              </Text>
            </View>

            {/* 사용자 카드 */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>사용자</Text>
              <View style={styles.row}>
                <Stat label="전체 가입" value={`${stats.users.total_users}`} styles={styles} />
                <Stat label={`최근 ${days}일 활성`} value={`${stats.users.active_users}`} styles={styles} />
              </View>
            </View>

            {/* 함수별 — list */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>함수별 (최근 {days}일)</Text>
              {stats.by_function.length === 0 ? (
                <Text style={styles.emptyText}>호출 기록이 없어요</Text>
              ) : (
                <View style={styles.tableWrap}>
                  <View style={styles.tableHeader}>
                    <Text style={[styles.cell, styles.cellName]}>함수</Text>
                    <Text style={[styles.cell, styles.cellNum]}>호출</Text>
                    <Text style={[styles.cell, styles.cellNum]}>유저</Text>
                    <Text style={[styles.cell, styles.cellNum]}>ms</Text>
                    <Text style={[styles.cell, styles.cellNum]}>USD</Text>
                  </View>
                  {stats.by_function.map((fn) => (
                    <View key={fn.function_name} style={styles.tableRow}>
                      <Text style={[styles.cell, styles.cellName]} numberOfLines={1}>
                        {fn.function_name}
                      </Text>
                      <Text style={[styles.cell, styles.cellNum]}>{fn.calls}</Text>
                      <Text style={[styles.cell, styles.cellNum]}>{fn.users}</Text>
                      <Text style={[styles.cell, styles.cellNum]}>{fn.avg_ms}</Text>
                      <Text style={[styles.cell, styles.cellNum]}>${fn.est_usd}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>

            {/* 일별 추이 차트 */}
            {stats.by_day.length > 0 && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>일별 호출 추이</Text>
                <BarChart
                  data={{
                    labels: [...stats.by_day].reverse().map((d) => d.day.slice(5)), // MM-DD
                    datasets: [{ data: [...stats.by_day].reverse().map((d) => d.calls) }],
                  }}
                  width={chartWidth}
                  height={180}
                  yAxisLabel=""
                  yAxisSuffix=""
                  fromZero
                  showValuesOnTopOfBars
                  withHorizontalLabels={false}
                  withInnerLines={false}
                  chartConfig={{
                    backgroundColor: 'transparent',
                    backgroundGradientFrom: colors.surface,
                    backgroundGradientTo: colors.surface,
                    decimalPlaces: 0,
                    color: (opacity = 1) => `rgba(124, 58, 237, ${opacity})`,
                    labelColor: () => colors.textSecondary,
                    barPercentage: 0.6,
                    propsForBackgroundLines: { stroke: 'transparent' },
                  }}
                  style={{ marginLeft: -spacing[3] }}
                />
              </View>
            )}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ label, value, styles }: { label: string; value: string; styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.background },
    content: { padding: spacing[4], gap: spacing[3] },
    headerTitle: {
      ...textStyles.h1,
      color: colors.textPrimary,
      fontWeight: '700',
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
    segmentBtnActive: { backgroundColor: colors.background },
    segmentText: { ...textStyles.body, color: colors.textSecondary },
    segmentTextActive: { color: colors.textPrimary, fontWeight: '700' },
    center: {
      paddingVertical: spacing[10],
      alignItems: 'center',
      gap: spacing[3],
    },
    deniedTitle: { ...textStyles.h2, color: colors.error, fontWeight: '700' },
    deniedText: { ...textStyles.body, color: colors.textSecondary, textAlign: 'center' },
    errorText: { ...textStyles.body, color: colors.error, textAlign: 'center' },
    retryBtn: {
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[2],
      borderRadius: radius.md,
      backgroundColor: colors.primary,
    },
    retryText: { ...textStyles.body, color: colors.textInverse, fontWeight: '700' },
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: spacing[4],
      gap: spacing[3],
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    cardTitle: { ...textStyles.h3, color: colors.textPrimary },
    row: { flexDirection: 'row', gap: spacing[2] },
    stat: { flex: 1 },
    statValue: { ...textStyles.h2, color: colors.textPrimary, fontWeight: '700' },
    statLabel: { ...textStyles.caption, color: colors.textSecondary, marginTop: 2 },
    subText: { ...textStyles.caption, color: colors.textTertiary },
    emptyText: { ...textStyles.body, color: colors.textSecondary, textAlign: 'center' },
    tableWrap: { gap: 4 },
    tableHeader: {
      flexDirection: 'row',
      paddingBottom: spacing[1],
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    tableRow: { flexDirection: 'row', paddingVertical: 6 },
    cell: { ...textStyles.caption, color: colors.textPrimary },
    cellName: { flex: 2 },
    cellNum: { flex: 1, textAlign: 'right' },
  });
}
