/**
 * 관리자 대시보드 — /admin.
 *
 * 진입 URL:
 *   - 웹:    https://synclink.pages.dev/admin
 *   - 모바일: synclink://admin
 *
 * 보안 (마이그레이션 047):
 *   - supabase auth 와 완전 분리. admin_credentials 테이블 사용.
 *   - 진입 = username/password 폼 → admin_verify RPC 검증
 *   - 통계 = admin_get_stats RPC (매 호출에 자격 증명 전달)
 *   - AsyncStorage (web=localStorage) 에 자격 증명 저장 → 재진입 시 자동 로그인
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
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BarChart } from 'react-native-chart-kit';
import { useColors } from '@/hooks/useColors';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import {
  adminLogin,
  getAdminStats,
  getSavedCredentials,
  saveCredentials,
  clearCredentials,
  type AdminStats,
  type AdminCredentials,
} from '@/services/adminService';

type Days = 1 | 7 | 30;

const chartWidth = Dimensions.get('window').width - 64;

export default function AdminDashboard() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // null = 자격 증명 확인 전 (AsyncStorage 로딩 중), 객체 = 로그인 완료.
  const [creds, setCreds] = useState<AdminCredentials | null>(null);
  const [credsChecked, setCredsChecked] = useState(false);
  const [days, setDays] = useState<Days>(7);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ─── 1) 저장된 자격 증명 자동 로그인 ──────────────────────────────────
  useEffect(() => {
    getSavedCredentials()
      .then((saved) => {
        if (saved) setCreds(saved);
      })
      .finally(() => setCredsChecked(true));
  }, []);

  // ─── 2) stats fetch ────────────────────────────────────────────────────
  const fetchStats = async (c: AdminCredentials) => {
    setError(null);
    try {
      const res = await getAdminStats(c, days);
      setStats(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '통계를 불러오지 못했습니다.';
      // 권한 에러 = 저장된 자격 증명이 만료/변경됨 → 로그아웃.
      if (msg.includes('permission denied') || msg.includes('invalid credentials')) {
        await clearCredentials();
        setCreds(null);
        setError('자격 증명이 만료되었어요. 다시 로그인해주세요.');
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (creds) {
      setLoading(true);
      fetchStats(creds);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creds, days]);

  const onRefresh = () => {
    if (!creds) return;
    setRefreshing(true);
    fetchStats(creds);
  };

  const onLogout = async () => {
    await clearCredentials();
    setCreds(null);
    setStats(null);
  };

  // ─── 3) 자격 증명 로딩 중 ──────────────────────────────────────────────
  if (!credsChecked) {
    return (
      <View style={hardStyles.lightSafe}>
        <View style={hardStyles.center}>
          <ActivityIndicator size="large" color="#7C3AED" />
        </View>
      </View>
    );
  }
  if (!creds) {
    return <AdminLoginGate onSuccess={(c) => setCreds(c)} prefilledError={error} />;
  }

  // ─── 4) 대시보드 본문 ──────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle}>관리자 대시보드</Text>
          <TouchableOpacity onPress={onLogout} style={styles.logoutBtn}>
            <Text style={styles.logoutText}>로그아웃</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.userBadge}>{creds.username}</Text>

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
            <TouchableOpacity onPress={() => creds && fetchStats(creds)} style={styles.retryBtn}>
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
                <Stat label="비용 (USD)" value={`$${stats.today.usd}`} styles={styles} />
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
                    <Text style={[styles.cell, styles.cellNum]}>in tok</Text>
                    <Text style={[styles.cell, styles.cellNum]}>USD</Text>
                  </View>
                  {stats.by_function.map((fn) => (
                    <View key={fn.function_name} style={styles.tableRow}>
                      <Text style={[styles.cell, styles.cellName]} numberOfLines={1}>
                        {fn.function_name}
                      </Text>
                      <Text style={[styles.cell, styles.cellNum]}>{fn.calls}</Text>
                      <Text style={[styles.cell, styles.cellNum]}>{fn.users}</Text>
                      <Text style={[styles.cell, styles.cellNum]}>{fn.in_tok}</Text>
                      <Text style={[styles.cell, styles.cellNum]}>${fn.usd}</Text>
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

/**
 * 관리자 진입 로그인 form (supabase auth 와 무관).
 *
 * admin_credentials 테이블의 username/password 와 매칭.
 * 성공 시 AsyncStorage 에 저장 + 부모에 자격 증명 전달.
 */
function AdminLoginGate({
  onSuccess,
  prefilledError,
}: {
  onSuccess: (c: AdminCredentials) => void;
  prefilledError?: string | null;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(prefilledError ?? null);

  const handleLogin = async () => {
    setError(null);
    if (!username.trim() || !password) {
      setError('아이디와 비밀번호를 입력해주세요.');
      return;
    }
    setLoading(true);
    try {
      const ok = await adminLogin(username.trim(), password);
      if (!ok) {
        setError('아이디 또는 비밀번호가 올바르지 않아요.');
        return;
      }
      const creds: AdminCredentials = { username: username.trim(), password };
      await saveCredentials(creds);
      onSuccess(creds);
    } catch (err) {
      setError(err instanceof Error ? err.message : '로그인에 실패했어요.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={hardStyles.lightSafe}>
      <ScrollView contentContainerStyle={hardStyles.formScroll} keyboardShouldPersistTaps="handled">
        <View style={hardStyles.formCard}>
          <Text style={hardStyles.formTitle}>관리자 로그인</Text>
          <Text style={hardStyles.formSub}>
            관리자 자격 증명으로 로그인하면 대시보드를 볼 수 있어요.
          </Text>

          <TextInput
            style={hardStyles.input}
            placeholder="아이디"
            placeholderTextColor="#9CA3AF"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!loading}
          />
          <TextInput
            style={hardStyles.input}
            placeholder="비밀번호"
            placeholderTextColor="#9CA3AF"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            editable={!loading}
            onSubmitEditing={handleLogin}
          />

          {error && <Text style={hardStyles.formError}>{error}</Text>}

          <TouchableOpacity
            style={[hardStyles.cta, loading && hardStyles.ctaDisabled]}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Text style={hardStyles.ctaText}>로그인</Text>
            )}
          </TouchableOpacity>

          <Text style={hardStyles.formHint}>
            * 일반 사용자는 메인 앱을 사용하세요.
            등록된 관리자만 진입할 수 있어요.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

// Hardcoded styles — 가드 화면 전용. useColors 의존성/hydration 영향 X,
// 다크 모드와 무관하게 항상 가독성 보장.
const hardStyles = StyleSheet.create({
  lightSafe: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    minHeight: '100%' as unknown as number,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  diagText: {
    fontSize: 16,
    color: '#111827',
    fontWeight: '600',
  },
  diagSub: {
    fontSize: 12,
    color: '#6B7280',
  },
  deniedTitle: {
    fontSize: 22,
    color: '#DC2626',
    fontWeight: '700',
    textAlign: 'center',
  },
  deniedText: {
    fontSize: 14,
    color: '#374151',
    textAlign: 'center',
    lineHeight: 20,
  },
  cta: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#7C3AED',
  },
  ctaText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  ctaDisabled: {
    opacity: 0.6,
  },
  formScroll: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  formCard: {
    backgroundColor: '#FFFFFF',
    maxWidth: 380,
    width: '100%',
    alignSelf: 'center',
    padding: 28,
    borderRadius: 12,
    gap: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
  },
  formTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111827',
  },
  formSub: {
    fontSize: 13,
    color: '#6B7280',
    lineHeight: 18,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#111827',
    backgroundColor: '#FFFFFF',
  },
  formError: {
    color: '#DC2626',
    fontSize: 13,
    textAlign: 'center',
  },
  formHint: {
    fontSize: 11,
    color: '#9CA3AF',
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 16,
  },
});

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
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    headerTitle: {
      ...textStyles.h1,
      color: colors.textPrimary,
      fontWeight: '700',
    },
    logoutBtn: {
      paddingHorizontal: spacing[3],
      paddingVertical: spacing[1],
      borderRadius: radius.full,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    logoutText: {
      ...textStyles.caption,
      color: colors.textSecondary,
      fontWeight: '600',
    },
    userBadge: {
      ...textStyles.caption,
      color: colors.textTertiary,
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
