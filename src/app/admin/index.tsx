/**
 * 관리자 대시보드 — /admin.
 *
 * 진입 URL:
 *   - 웹:    https://synclink.pages.dev/admin
 *   - 모바일: synclink://admin
 *
 * 보안 (마이그레이션 050 — 세션 토큰):
 *   - supabase auth 와 완전 분리. admin_credentials 테이블 사용.
 *   - 진입 = username/password 폼 → admin_login RPC → 10시간 token 발급
 *   - 통계/사용자 RPC = token 만 전송 (평문 password 저장 X)
 *   - AsyncStorage 에 { token, expiresAt, username } 저장
 *   - expires_at 경과 또는 세션 무효 응답 시 자동 logout + 로그인 폼 노출
 *   - 서버: rate limit 5fail/5min lockout, pg_cron 매일 02시 cleanup
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  adminLogout,
  getAdminStats,
  getAdminUsers,
  getSavedSession,
  getStoreRatings,
  type AdminStats,
  type AdminSession,
  type StoreRatings,
  type AdminUsersResult,
  type UsersSort,
  getSupportRequests,
  updateSupportRequest,
  type SupportRequestList,
  type SupportRequestRow,
  type SupportStatus,
} from '@/services/adminService';

type Days = 1 | 7 | 30;

const chartWidth = Dimensions.get('window').width - 64;

/**
 * Claude API 월 예산 (docs/architecture/BUDGET_GUARDRAILS.md 기준).
 * run-rate 게이지의 100% 기준선. 초과 시 경고색 표시.
 */
const MONTHLY_BUDGET_USD = 30;

/** 고비용 사용자 강조 임계값 (USD). 누적 비용이 이 값을 넘으면 행을 강조. */
const HIGH_COST_USER_THRESHOLD = 1;

/** "5시간 23분 남음" / "12분 남음" / "곧 만료" 포맷. */
function formatRemaining(ms: number): string {
  if (ms <= 0) return '만료됨';
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return `${m}분 남음`;
  return `${h}시간 ${m}분 남음`;
}

/** USD 금액 포맷 — 작은 값은 소수 4자리, 큰 값은 2자리. */
function formatUsd(v: number | string | undefined): string {
  const n = typeof v === 'string' ? parseFloat(v) : (v ?? 0);
  if (!isFinite(n)) return '$0';
  if (n === 0) return '$0';
  return n < 1 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
}

/**
 * 월 예상 비용(run-rate) 계산.
 * 기간 합계 비용을 일평균으로 환산 후 ×30. 일수 정보가 없으면 0.
 */
function projectMonthlyUsd(totalUsd: number, days: number): number {
  if (!days || days <= 0) return 0;
  return (totalUsd / days) * 30;
}

export default function AdminDashboard() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [session, setSession] = useState<AdminSession | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [days, setDays] = useState<Days>(7);
  const [stats, setStats] = useState<AdminStats | null>(null);
  /** 스토어 별점 — 통계와 별개 소스라 실패해도 대시보드는 그대로 뜬다. */
  const [ratings, setRatings] = useState<StoreRatings | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remainingMs, setRemainingMs] = useState<number>(0);
  const expireTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── 자동 로그아웃 헬퍼 ───────────────────────────────────────────────
  const doLogout = useCallback(async (reason?: string) => {
    if (expireTimer.current) {
      clearTimeout(expireTimer.current);
      expireTimer.current = null;
    }
    await adminLogout(session?.token ?? null);
    setSession(null);
    setStats(null);
    setError(reason ?? null);
  }, [session?.token]);

  // ─── 1) 저장된 세션 자동 복구 ─────────────────────────────────────────
  useEffect(() => {
    getSavedSession()
      .then((saved) => { if (saved) setSession(saved); })
      .finally(() => setSessionChecked(true));
  }, []);

  // ─── 만료 타이머 — 세션 변경 시 정확히 expires_at 에 자동 logout ──────
  useEffect(() => {
    if (expireTimer.current) {
      clearTimeout(expireTimer.current);
      expireTimer.current = null;
    }
    if (!session) {
      setRemainingMs(0);
      return;
    }
    const tick = () => {
      const left = new Date(session.expiresAt).getTime() - Date.now();
      setRemainingMs(Math.max(0, left));
      if (left <= 0) {
        doLogout('세션이 만료되었어요. 다시 로그인해주세요.');
      }
    };
    tick();
    // 1분마다 남은 시간 표시 갱신.
    const interval = setInterval(tick, 60_000);
    // 절대 만료 시각에 정확히 한 번 더 trigger.
    const left = new Date(session.expiresAt).getTime() - Date.now();
    if (left > 0) {
      expireTimer.current = setTimeout(() => {
        doLogout('세션이 만료되었어요. 다시 로그인해주세요.');
      }, left);
    }
    return () => {
      clearInterval(interval);
      if (expireTimer.current) clearTimeout(expireTimer.current);
    };
  }, [session, doLogout]);

  // ─── 2) stats fetch ────────────────────────────────────────────────────
  const fetchStats = async (token: string) => {
    setError(null);
    try {
      const res = await getAdminStats(token, days);
      setStats(res);
      // 별점은 외부 스토어 의존이라 느리거나 실패할 수 있다. 통계 렌더를 막지 않게
      // 기다리지 않고 따로 채운다.
      getStoreRatings().then(setRatings).catch(() => setRatings(null));
    } catch (err) {
      const msg = err instanceof Error ? err.message : '통계를 불러오지 못했습니다.';
      if (/invalid or expired session|permission denied/i.test(msg)) {
        await doLogout('세션이 만료되었어요. 다시 로그인해주세요.');
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (session) {
      setLoading(true);
      fetchStats(session.token);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, days]);

  const onRefresh = () => {
    if (!session) return;
    setRefreshing(true);
    fetchStats(session.token);
  };

  const onLogout = () => doLogout();

  // ─── 3) 세션 로딩 중 ──────────────────────────────────────────────────
  if (!sessionChecked) {
    return (
      <View style={hardStyles.lightSafe}>
        <View style={hardStyles.center}>
          <ActivityIndicator size="large" color="#7C3AED" />
        </View>
      </View>
    );
  }
  if (!session) {
    return <AdminLoginGate onSuccess={(s) => setSession(s)} prefilledError={error} />;
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
        <Text style={styles.userBadge}>
          {session.username} · 세션 만료 {formatRemaining(remainingMs)}
        </Text>

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
            <TouchableOpacity onPress={() => session && fetchStats(session.token)} style={styles.retryBtn}>
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

            {/* 사용자 카드 — 전체/활성 + (054) Pro/Free 전환율 */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>사용자</Text>
              <View style={styles.row}>
                <Stat label="전체 가입" value={`${stats.users.total_users}`} styles={styles} />
                <Stat label={`최근 ${days}일 활성`} value={`${stats.users.active_users}`} styles={styles} />
              </View>
              {/* pro/free 카운트는 마이그레이션 054 이후에만 존재 → 옵셔널 가드 */}
              {stats.users.pro_users != null && (
                <View style={styles.row}>
                  <Stat label="Pro" value={`${stats.users.pro_users}`} styles={styles} />
                  <Stat label="Free" value={`${stats.users.free_users ?? 0}`} styles={styles} />
                  <Stat
                    label="전환율"
                    value={
                      stats.users.total_users > 0
                        ? `${Math.round((stats.users.pro_users / stats.users.total_users) * 100)}%`
                        : '—'
                    }
                    styles={styles}
                  />
                </View>
              )}
            </View>

            {/* 스토어 별점 카드 — 양 스토어 집계 */}
            <StoreRatingsCard ratings={ratings} styles={styles} />

            {/* 확장 인사이트 카드 (054) — 비용/리텐션/성장. 데이터 없으면 각자 skip */}
            <InsightCards stats={stats} days={days} styles={styles} colors={colors} />

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

            {/* 버그 제보 / 문의 카드 — 사용자 목록보다 위. 미확인 건은 빨리 봐야 한다. */}
            <SupportCard token={session.token} styles={styles} colors={colors} />

            {/* 사용자 목록 카드 */}
            <UsersCard token={session.token} styles={styles} colors={colors} />
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
  onSuccess: (s: AdminSession) => void;
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
      const session = await adminLogin(username.trim(), password);
      // 평문 password 는 함수 종료와 함께 GC. AsyncStorage 에는 token 만 저장됨.
      onSuccess(session);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '로그인에 실패했어요.';
      // 서버 메시지 매핑 — 사용자 친화 표현.
      if (/too many attempts/i.test(msg)) {
        setError('로그인 시도가 너무 많아요. 5분 후 다시 시도해주세요.');
      } else if (/invalid credentials/i.test(msg)) {
        setError('아이디 또는 비밀번호가 올바르지 않아요.');
      } else {
        setError(msg);
      }
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

/** 상태 필터 탭. null = 전체. */
const SUPPORT_FILTERS: { k: SupportStatus | null; label: string }[] = [
  { k: null, label: '전체' },
  { k: 'open', label: '미확인' },
  { k: 'in_progress', label: '진행중' },
  { k: 'resolved', label: '완료' },
];

/** 상태별 표시 이름 + 색. 색은 pill 배경으로 쓴다. */
const SUPPORT_STATUS_META: Record<SupportStatus, { label: string; tone: 'open' | 'progress' | 'done' }> = {
  open:        { label: '미확인', tone: 'open' },
  in_progress: { label: '진행중', tone: 'progress' },
  resolved:    { label: '완료',   tone: 'done' },
  ignored:     { label: '보류',   tone: 'done' },
};

/** diagnostics 에서 사람이 볼 만한 값만 한 줄로 뽑는다. 없는 키는 조용히 건너뛴다. */
function formatDiagnostics(d: Record<string, unknown>): string {
  const get = (k: string) => (d[k] == null ? null : String(d[k]));
  return [
    get('platform') && `${get('platform')} ${get('osVersion') ?? ''}`.trim(),
    get('appVersion') && `v${get('appVersion')}(${get('buildNumber') ?? '?'})`,
    get('locale'),
  ].filter(Boolean).join(' · ');
}

/**
 * 버그 제보 / 문의 카드 (마이그레이션 069).
 *
 * 메일 알림이 없는 구조라 **여기가 유일한 확인 창구**다. 그래서
 *   - 미확인(open) 건수를 카드 제목에 크게 띄우고
 *   - 서버 정렬이 open 을 항상 위로 올린다
 * 행을 누르면 펼쳐져 본문 전체 · 진단 정보 · 상태 변경 · 메모가 보인다.
 */
function SupportCard({
  token,
  styles,
  colors,
}: {
  token: string;
  styles: ReturnType<typeof makeStyles>;
  colors: ReturnType<typeof useColors>;
}) {
  const [filter, setFilter] = useState<SupportStatus | null>(null);
  const [data, setData] = useState<SupportRequestList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** 펼쳐진 행 id. 한 번에 하나만 펼친다(목록이 길어지는 걸 막는다). */
  const [expandedId, setExpandedId] = useState<string | null>(null);
  /** 저장 중인 행 id — 중복 탭 방지. */
  const [savingId, setSavingId] = useState<string | null>(null);
  /** 편집 중인 메모. 행 id → 텍스트. 저장 전까지 로컬에만 둔다. */
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await getSupportRequests(token, filter, 50));
    } catch (err) {
      setError(err instanceof Error ? err.message : '제보를 불러오지 못했어요.');
    } finally {
      setLoading(false);
    }
  }, [token, filter]);

  useEffect(() => { void load(); }, [load]);

  /**
   * 상태·메모 저장 후 목록을 다시 읽는다.
   * 낙관적 갱신을 하지 않는 이유: 필터가 걸려 있으면 상태를 바꾼 행이 목록에서
   * 빠져야 하는데, 그 판단을 클라이언트에서 흉내 내면 건수와 어긋난다.
   */
  const apply = useCallback(
    async (id: string, patch: { status?: SupportStatus; note?: string }) => {
      setSavingId(id);
      try {
        await updateSupportRequest(token, id, patch);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : '저장하지 못했어요.');
      } finally {
        setSavingId(null);
      }
    },
    [token, load],
  );

  const counts = data?.counts;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.cardTitle}>제보 · 문의</Text>
        {counts ? (
          counts.open > 0 ? (
            <View style={styles.warnPill}>
              <Text style={styles.warnPillText}>미확인 {counts.open}</Text>
            </View>
          ) : (
            <Text style={styles.subText}>미확인 없음</Text>
          )
        ) : null}
      </View>

      {counts && (
        <Text style={styles.subText}>
          전체 {counts.total} · 버그 {counts.bug} · 문의 {counts.inquiry} · 진행중 {counts.in_progress} · 완료 {counts.resolved}
        </Text>
      )}

      {/* 상태 필터 */}
      <View style={styles.segment}>
        {SUPPORT_FILTERS.map(({ k, label }) => (
          <TouchableOpacity
            key={label}
            onPress={() => setFilter(k)}
            style={[styles.segmentBtn, filter === k && styles.segmentBtnActive]}
          >
            <Text style={[styles.segmentText, filter === k && styles.segmentTextActive]}>
              {label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ paddingVertical: spacing[3] }} />
      ) : error ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : data && data.items.length > 0 ? (
        <View style={styles.tableWrap}>
          {data.items.map((it) => (
            <SupportRow
              key={it.id}
              item={it}
              expanded={expandedId === it.id}
              saving={savingId === it.id}
              note={notes[it.id] ?? it.admin_note ?? ''}
              onToggle={() => setExpandedId(expandedId === it.id ? null : it.id)}
              onNoteChange={(t) => setNotes((prev) => ({ ...prev, [it.id]: t }))}
              onApply={(patch) => void apply(it.id, patch)}
              styles={styles}
              colors={colors}
            />
          ))}
        </View>
      ) : (
        <Text style={styles.emptyText}>
          {filter ? '해당 상태의 제보가 없어요' : '들어온 제보가 없어요'}
        </Text>
      )}
    </View>
  );
}

/**
 * 제보 한 건. 접힌 상태는 요약만, 펼치면 전체 + 처리 UI.
 * 상태 관리는 전부 부모가 한다(이 컴포넌트는 표시와 콜백만 담당).
 */
function SupportRow({
  item,
  expanded,
  saving,
  note,
  onToggle,
  onNoteChange,
  onApply,
  styles,
  colors,
}: {
  item: SupportRequestRow;
  expanded: boolean;
  saving: boolean;
  note: string;
  onToggle: () => void;
  onNoteChange: (text: string) => void;
  onApply: (patch: { status?: SupportStatus; note?: string }) => void;
  styles: ReturnType<typeof makeStyles>;
  colors: ReturnType<typeof useColors>;
}) {
  const meta = SUPPORT_STATUS_META[item.status];
  const isBug = item.kind === 'bug';
  const diag = formatDiagnostics(item.diagnostics ?? {});
  // 제보 후 닉네임이 바뀌었으면 둘 다 보여준다.
  const savedNickname = item.diagnostics?.nickname as string | undefined;
  const who = item.current_nickname ?? savedNickname ?? '(비로그인)';

  return (
    <View style={[styles.userRow, item.status === 'open' && styles.supportRowOpen]}>
      <TouchableOpacity onPress={onToggle} activeOpacity={0.7}>
        <View style={styles.userTitleRow}>
          <View style={[styles.kindPill, isBug ? styles.kindPillBug : styles.kindPillInquiry]}>
            <Text style={styles.proPillText}>{isBug ? '버그' : '문의'}</Text>
          </View>
          <View style={[styles.statusPill, styles[`statusPill_${meta.tone}`]]}>
            <Text style={styles.statusPillText}>{meta.label}</Text>
          </View>
          <Text style={styles.userName} numberOfLines={1}>{who}</Text>
          <Text style={styles.userMeta}>{item.created_at.slice(0, 16).replace('T', ' ')}</Text>
        </View>
        <Text
          style={styles.supportMessage}
          numberOfLines={expanded ? undefined : 2}
        >
          {item.message}
        </Text>
      </TouchableOpacity>

      {expanded && (
        <View style={styles.supportDetail}>
          <Text style={styles.userMeta}>
            {[item.reply_email ?? '회신 메일 없음', diag].filter(Boolean).join(' · ')}
          </Text>
          {savedNickname && item.current_nickname && savedNickname !== item.current_nickname && (
            <Text style={styles.userMeta}>제보 당시 닉네임: {savedNickname}</Text>
          )}

          {/* 상태 변경 */}
          <View style={styles.supportActions}>
            {(['open', 'in_progress', 'resolved', 'ignored'] as const).map((st) => (
              <TouchableOpacity
                key={st}
                disabled={saving || st === item.status}
                onPress={() => onApply({ status: st })}
                style={[
                  styles.supportActionBtn,
                  st === item.status && styles.supportActionBtnActive,
                ]}
              >
                <Text
                  style={[
                    styles.supportActionText,
                    st === item.status && styles.supportActionTextActive,
                  ]}
                >
                  {SUPPORT_STATUS_META[st].label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* 관리자 메모 */}
          <TextInput
            style={[styles.searchInput, styles.supportNoteInput]}
            placeholder="처리 메모 (답변 내용, 원인 등)"
            placeholderTextColor={colors.textTertiary}
            value={note}
            onChangeText={onNoteChange}
            multiline
          />
          <TouchableOpacity
            disabled={saving || note === (item.admin_note ?? '')}
            onPress={() => onApply({ note })}
            style={[
              styles.supportSaveBtn,
              (saving || note === (item.admin_note ?? '')) && styles.supportSaveBtnDisabled,
            ]}
          >
            <Text style={styles.supportSaveText}>{saving ? '저장 중…' : '메모 저장'}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

/**
 * 사용자 목록 카드. 정렬 (recent/active/usage) 토글 + 행 50개.
 */
function UsersCard({
  token,
  styles,
  colors,
}: {
  token: string;
  styles: ReturnType<typeof makeStyles>;
  colors: ReturnType<typeof useColors>;
}) {
  const [sort, setSort] = useState<UsersSort>('recent');
  const [data, setData] = useState<AdminUsersResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 클라이언트 측 검색어 — 이미 로드된 rows 에서 nickname/email 필터.
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getAdminUsers(token, sort, 50)
      .then((res) => { if (!cancelled) setData(res); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : '사용자 목록을 불러오지 못했어요.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token, sort]);

  // 검색어로 필터링된 rows (대소문자 무시, nickname + email 대상).
  const filteredRows = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    if (!q) return data.rows;
    return data.rows.filter(
      (u) =>
        (u.nickname ?? '').toLowerCase().includes(q) ||
        (u.email ?? '').toLowerCase().includes(q),
    );
  }, [data, query]);

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.cardTitle}>사용자 ({data?.total ?? '…'})</Text>
      </View>

      {/* 정렬 segment */}
      <View style={styles.segment}>
        {([
          { k: 'recent', label: '최근 가입' },
          { k: 'active', label: '활성' },
          { k: 'usage',  label: 'AI 호출' },
        ] as const).map(({ k, label }) => (
          <TouchableOpacity
            key={k}
            onPress={() => setSort(k)}
            style={[styles.segmentBtn, sort === k && styles.segmentBtnActive]}
          >
            <Text style={[styles.segmentText, sort === k && styles.segmentTextActive]}>
              {label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* 검색창 — 로드된 rows 에서 nickname/email 필터 */}
      <TextInput
        style={styles.searchInput}
        placeholder="닉네임 또는 이메일 검색"
        placeholderTextColor={colors.textTertiary}
        value={query}
        onChangeText={setQuery}
        autoCapitalize="none"
        autoCorrect={false}
      />

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ paddingVertical: spacing[3] }} />
      ) : error ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : data && filteredRows.length > 0 ? (
        <View style={styles.tableWrap}>
          {filteredRows.map((u) => {
            // 누적 비용이 임계값 초과면 abuse 의심 → 행 강조.
            const highCost = Number(u.total_cost_usd ?? 0) > HIGH_COST_USER_THRESHOLD;
            return (
              <View key={u.id} style={[styles.userRow, highCost && styles.userRowHighlight]}>
                <View style={styles.userMain}>
                  <View style={styles.userTitleRow}>
                    <Text style={styles.userName} numberOfLines={1}>
                      {u.nickname || '(닉네임 없음)'}
                    </Text>
                    {u.subscription_plan === 'pro' && (
                      <View style={styles.proPill}>
                        <Text style={styles.proPillText}>PRO</Text>
                      </View>
                    )}
                    {highCost && (
                      <View style={styles.warnPill}>
                        <Text style={styles.warnPillText}>고비용</Text>
                      </View>
                    )}
                    {u.country_code && (
                      <Text style={styles.userCountry}>{u.country_code}</Text>
                    )}
                  </View>
                  <Text style={styles.userEmail} numberOfLines={1}>
                    {u.email ?? '—'}
                  </Text>
                  <Text style={styles.userMeta}>
                    가입 {u.created_at.slice(0, 10)} · 일정 {u.event_count} · AI {u.ai_calls}회 · {formatUsd(u.total_cost_usd)}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      ) : (
        <Text style={styles.emptyText}>
          {query.trim() ? '검색 결과가 없어요' : '사용자가 없어요'}
        </Text>
      )}
    </View>
  );
}

/**
 * 확장 인사이트 카드 묶음 (마이그레이션 054).
 *
 * 모든 카드는 해당 데이터(stats.xxx)가 응답에 있을 때만 렌더 → 구버전 서버 안전.
 * 단일 책임: "기본 통계 외 비용/리텐션/성장 시각화"를 한 곳에 모은다.
 */
function InsightCards({
  stats,
  days,
  styles,
  colors,
}: {
  stats: AdminStats;
  days: number;
  styles: ReturnType<typeof makeStyles>;
  colors: ReturnType<typeof useColors>;
}) {
  // ── 기간 합계 비용 → 월 run-rate 환산 (by_day 는 기존 키라 항상 존재) ──
  const periodCostUsd = stats.by_day.reduce((sum, d) => sum + Number(d.usd ?? 0), 0);
  const projectedMonthly = projectMonthlyUsd(periodCostUsd, days);
  const budgetPct = MONTHLY_BUDGET_USD > 0 ? (projectedMonthly / MONTHLY_BUDGET_USD) * 100 : 0;
  const overBudget = projectedMonthly > MONTHLY_BUDGET_USD;
  const fillWidth = `${Math.min(Math.max(budgetPct, 0), 100)}%` as const;

  return (
    <>
      {/* ① 월 예상 비용 (run-rate) 게이지 — $30 예산 대비 */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>월 예상 비용 (run-rate)</Text>
        <View style={styles.row}>
          <Stat label={`최근 ${days}일 합계`} value={formatUsd(periodCostUsd)} styles={styles} />
          <Stat label="월 환산" value={formatUsd(projectedMonthly)} styles={styles} />
          <Stat label="예산" value={formatUsd(MONTHLY_BUDGET_USD)} styles={styles} />
        </View>
        <View style={styles.gaugeTrack}>
          <View
            style={[
              styles.gaugeFill,
              { width: fillWidth },
              overBudget && styles.gaugeFillOver,
            ]}
          />
        </View>
        <Text style={[styles.subText, overBudget && styles.warnText]}>
          {overBudget
            ? `⚠️ 예산 초과 예상 (${Math.round(budgetPct)}%)`
            : `예산의 ${Math.round(budgetPct)}% 소진 예상`}
        </Text>
      </View>

      {/* ② 일별 비용 추이 차트 */}
      {stats.by_day.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>일별 비용 추이 (USD)</Text>
          <BarChart
            data={{
              labels: [...stats.by_day].reverse().map((d) => d.day.slice(5)),
              datasets: [{ data: [...stats.by_day].reverse().map((d) => Number(d.usd ?? 0)) }],
            }}
            width={chartWidth}
            height={180}
            yAxisLabel="$"
            yAxisSuffix=""
            fromZero
            withHorizontalLabels={false}
            withInnerLines={false}
            chartConfig={{
              backgroundColor: 'transparent',
              backgroundGradientFrom: colors.surface,
              backgroundGradientTo: colors.surface,
              decimalPlaces: 2,
              color: (opacity = 1) => `rgba(16, 185, 129, ${opacity})`, // emerald — 비용
              labelColor: () => colors.textSecondary,
              barPercentage: 0.6,
              propsForBackgroundLines: { stroke: 'transparent' },
            }}
            style={{ marginLeft: -spacing[3] }}
          />
        </View>
      )}

      {/* ③ 모델별 비용 분해 */}
      {stats.by_model && stats.by_model.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>모델별 (최근 {days}일)</Text>
          <View style={styles.tableWrap}>
            <View style={styles.tableHeader}>
              <Text style={[styles.cell, styles.cellName]}>모델</Text>
              <Text style={[styles.cell, styles.cellNum]}>호출</Text>
              <Text style={[styles.cell, styles.cellNum]}>in tok</Text>
              <Text style={[styles.cell, styles.cellNum]}>out tok</Text>
              <Text style={[styles.cell, styles.cellNum]}>USD</Text>
            </View>
            {stats.by_model.map((m) => (
              <View key={m.model} style={styles.tableRow}>
                <Text style={[styles.cell, styles.cellName]} numberOfLines={1}>{m.model}</Text>
                <Text style={[styles.cell, styles.cellNum]}>{m.calls}</Text>
                <Text style={[styles.cell, styles.cellNum]}>{m.in_tok}</Text>
                <Text style={[styles.cell, styles.cellNum]}>{m.out_tok}</Text>
                <Text style={[styles.cell, styles.cellNum]}>{formatUsd(m.usd)}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* ④ 리텐션 버킷 */}
      {stats.retention && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>리텐션 (일정 활동 기준)</Text>
          <View style={styles.row}>
            <Stat label="7일 내 활성" value={`${stats.retention.active_7d}`} styles={styles} />
            <Stat label="8~30일" value={`${stats.retention.active_30d}`} styles={styles} />
            <Stat label="휴면(30일+)" value={`${stats.retention.dormant}`} styles={styles} />
          </View>
        </View>
      )}

      {/* ⑤ 신규 가입 추이 */}
      {stats.signups_by_day && stats.signups_by_day.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>신규 가입 추이 (최근 {days}일)</Text>
          <BarChart
            data={{
              labels: [...stats.signups_by_day].reverse().map((d) => d.day.slice(5)),
              datasets: [{ data: [...stats.signups_by_day].reverse().map((d) => d.signups) }],
            }}
            width={chartWidth}
            height={160}
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
              color: (opacity = 1) => `rgba(59, 130, 246, ${opacity})`, // blue — 가입
              labelColor: () => colors.textSecondary,
              barPercentage: 0.6,
              propsForBackgroundLines: { stroke: 'transparent' },
            }}
            style={{ marginLeft: -spacing[3] }}
          />
        </View>
      )}

      {/* ⑥ 기능영역별 비용 */}
      {stats.by_feature && stats.by_feature.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>기능영역별 (최근 {days}일)</Text>
          <View style={styles.tableWrap}>
            <View style={styles.tableHeader}>
              <Text style={[styles.cell, styles.cellName]}>영역</Text>
              <Text style={[styles.cell, styles.cellNum]}>호출</Text>
              <Text style={[styles.cell, styles.cellNum]}>USD</Text>
            </View>
            {stats.by_feature.map((f) => (
              <View key={f.feature_area} style={styles.tableRow}>
                <Text style={[styles.cell, styles.cellName]} numberOfLines={1}>{f.feature_area}</Text>
                <Text style={[styles.cell, styles.cellNum]}>{f.calls}</Text>
                <Text style={[styles.cell, styles.cellNum]}>{formatUsd(f.usd)}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* ⑦ 국가 분포 */}
      {stats.country_dist && stats.country_dist.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>국가 분포</Text>
          <View style={styles.tableWrap}>
            {stats.country_dist.map((c) => (
              <View key={c.country_code} style={styles.tableRow}>
                <Text style={[styles.cell, styles.cellName]} numberOfLines={1}>{c.country_code}</Text>
                <Text style={[styles.cell, styles.cellNum]}>{c.users}명</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* ⑧ 스페이스(공유 캘린더) 사용 현황 — 마이그레이션 064 */}
      {stats.spaces && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>스페이스 (공유 캘린더)</Text>
          {/* 1행: 규모 — 전체 / 실제 공유(2명+) / 참여 유저 수 */}
          <View style={styles.row}>
            <Stat label="전체" value={`${stats.spaces.total}`} styles={styles} />
            <Stat label="멤버 2+" value={`${stats.spaces.multi_member}`} styles={styles} />
            <Stat label="참여 유저" value={`${stats.spaces.users_in_space}`} styles={styles} />
          </View>
          {/* 2행: 타입 분포 + 전체 유저 대비 참여율 */}
          <View style={styles.row}>
            <Stat label="커플" value={`${stats.spaces.couple}`} styles={styles} />
            <Stat label="그룹" value={`${stats.spaces.group}`} styles={styles} />
            <Stat
              label="참여율"
              value={
                stats.users.total_users > 0
                  ? `${Math.round((stats.spaces.users_in_space / stats.users.total_users) * 100)}%`
                  : '—'
              }
              styles={styles}
            />
          </View>
          {/* 최근 활동 + 부가기능 채택도 요약 */}
          <Text style={styles.subText}>
            최근 공유 활동 · 7일 {stats.spaces.active_7d} · 30일 {stats.spaces.active_30d} 스페이스
          </Text>
          <Text style={styles.subText}>
            공유 일정 {stats.spaces.shared_events}건 · 메시지 {stats.spaces.messages} · 기념일 {stats.spaces.anniversaries}
          </Text>
        </View>
      )}
    </>
  );
}

/**
 * 스토어 별점 카드 — store-ratings Edge Function 결과를 보여준다.
 *
 * 세 상태를 구분해서 표시한다. 뭉뚱그리면 "0점"과 "못 가져옴"을 헷갈리게 된다.
 *   · 값 있음      → 3.0 처럼 별점 + 평가 수
 *   · 아직 평가 없음 → "—"  (Play 는 리뷰가 쌓여야 집계 별점을 만든다)
 *   · 조회 실패     → "오류" + 사유
 */
function StoreRatingsCard({
  ratings,
  styles,
}: {
  ratings: StoreRatings | null;
  styles: ReturnType<typeof makeStyles>;
}) {
  /** 별점 표기. 소수 한 자리까지만(스토어 표기와 맞춘다). */
  const fmt = (p: { rating: number | null; error?: string } | undefined) => {
    if (!p) return '—';
    if (p.error) return '오류';
    return p.rating == null ? '—' : `${p.rating.toFixed(1)}★`;
  };
  const fmtCount = (p: { count: number | null; error?: string } | undefined) =>
    !p || p.error || p.count == null ? '—' : `${p.count.toLocaleString()}개`;

  if (!ratings) {
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>스토어 별점</Text>
        <Text style={styles.subText}>불러오는 중…</Text>
      </View>
    );
  }

  const { ios, android } = ratings;
  const notes: string[] = [];
  if (ios.error) notes.push(`App Store 조회 실패: ${ios.error}`);
  if (android.error) notes.push(`Play 조회 실패: ${android.error}`);
  if (!android.error && android.rating == null) {
    notes.push('Play 는 리뷰가 일정 수 이상 쌓여야 집계 별점이 생깁니다.');
  }
  if (ios.currentVersionRating != null && ios.version) {
    notes.push(
      `App Store ${ios.version} 기준 ${ios.currentVersionRating.toFixed(1)}★ (${(ios.currentVersionCount ?? 0).toLocaleString()}개)`,
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>스토어 별점</Text>
      <View style={styles.row}>
        <Stat label="App Store" value={fmt(ios)} styles={styles} />
        <Stat label="App Store 평가" value={fmtCount(ios)} styles={styles} />
      </View>
      <View style={styles.row}>
        <Stat label="Play" value={fmt(android)} styles={styles} />
        <Stat label="Play 평가" value={fmtCount(android)} styles={styles} />
      </View>
      {notes.map((n) => (
        <Text key={n} style={styles.subText}>{n}</Text>
      ))}
      <Text style={styles.subText}>
        조회 {new Date(ratings.fetchedAt).toLocaleString('ko-KR')}
        {ratings.cached ? ' (캐시)' : ''}
      </Text>
    </View>
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
    userRow: {
      paddingVertical: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    userMain: {
      gap: 2,
    },
    userTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    userName: {
      ...textStyles.body,
      color: colors.textPrimary,
      fontWeight: '700',
      flexShrink: 1,
    },
    proPill: {
      paddingHorizontal: 6,
      paddingVertical: 1,
      borderRadius: radius.full,
      backgroundColor: colors.primary,
    },
    proPillText: {
      ...textStyles.caption,
      color: colors.textInverse,
      fontWeight: '700',
      fontSize: 9,
    },
    userCountry: {
      ...textStyles.caption,
      color: colors.textTertiary,
      fontSize: 10,
    },
    userEmail: {
      ...textStyles.caption,
      color: colors.textSecondary,
    },
    userMeta: {
      ...textStyles.caption,
      color: colors.textTertiary,
      fontSize: 11,
    },

    // ─── 054 신규 스타일 ───────────────────────────────────────────────
    /** run-rate 게이지 트랙(배경 바). */
    gaugeTrack: {
      height: 10,
      borderRadius: radius.full,
      backgroundColor: colors.backgroundAlt,
      overflow: 'hidden',
    },
    /** run-rate 게이지 채움 — 예산 내(보라). */
    gaugeFill: {
      height: '100%',
      borderRadius: radius.full,
      backgroundColor: colors.primary,
    },
    /** run-rate 게이지 채움 — 예산 초과(빨강). */
    gaugeFillOver: {
      backgroundColor: colors.error,
    },
    /** 예산 초과 경고 텍스트. */
    warnText: {
      color: colors.error,
      fontWeight: '700',
    },
    /** 사용자 검색 입력. */
    searchInput: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: radius.md,
      paddingHorizontal: spacing[3],
      paddingVertical: spacing[2],
      fontSize: 14,
      color: colors.textPrimary,
      backgroundColor: colors.background,
    },
    /** 고비용 사용자 행 강조 배경 (연한 빨강 — 다크/라이트 공통 가독). */
    userRowHighlight: {
      backgroundColor: 'rgba(220, 38, 38, 0.08)',
      borderRadius: radius.sm,
    },
    /** 고비용 표식 pill. */
    warnPill: {
      paddingHorizontal: 6,
      paddingVertical: 1,
      borderRadius: radius.full,
      backgroundColor: colors.error,
    },
    warnPillText: {
      ...textStyles.caption,
      color: colors.textInverse,
      fontWeight: '700',
      fontSize: 9,
    },

    // ─── 069 제보/문의 카드 ────────────────────────────────────────────
    /** 미확인 제보 행 강조 — 목록에서 바로 눈에 띄게. */
    supportRowOpen: {
      backgroundColor: 'rgba(124, 58, 237, 0.06)',
      borderRadius: radius.sm,
      paddingHorizontal: spacing[2],
    },
    /** 종류(버그/문의) pill. */
    kindPill: {
      paddingHorizontal: 6,
      paddingVertical: 1,
      borderRadius: radius.full,
    },
    kindPillBug: { backgroundColor: colors.error },
    kindPillInquiry: { backgroundColor: colors.textSecondary },
    /** 처리 상태 pill — tone 별 배경. */
    statusPill: {
      paddingHorizontal: 6,
      paddingVertical: 1,
      borderRadius: radius.full,
      borderWidth: StyleSheet.hairlineWidth,
    },
    statusPill_open: { borderColor: colors.primary, backgroundColor: 'transparent' },
    statusPill_progress: { borderColor: colors.warning, backgroundColor: 'transparent' },
    statusPill_done: { borderColor: colors.border, backgroundColor: 'transparent' },
    statusPillText: {
      ...textStyles.caption,
      color: colors.textSecondary,
      fontWeight: '600',
      fontSize: 9,
    },
    /** 제보 본문 — 접힘 2줄 / 펼침 전체. */
    supportMessage: {
      ...textStyles.body,
      color: colors.textPrimary,
      marginTop: 4,
      fontSize: 13,
    },
    supportDetail: {
      marginTop: spacing[2],
      gap: spacing[2],
    },
    supportActions: {
      flexDirection: 'row',
      gap: 6,
      flexWrap: 'wrap',
    },
    supportActionBtn: {
      paddingHorizontal: spacing[3],
      paddingVertical: 6,
      borderRadius: radius.full,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    supportActionBtnActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    supportActionText: { ...textStyles.caption, color: colors.textSecondary, fontWeight: '600' },
    supportActionTextActive: { color: colors.textInverse },
    supportNoteInput: {
      minHeight: 60,
      textAlignVertical: 'top',
    },
    supportSaveBtn: {
      alignSelf: 'flex-start',
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[2],
      borderRadius: radius.md,
      backgroundColor: colors.primary,
    },
    supportSaveBtnDisabled: { opacity: 0.4 },
    supportSaveText: { ...textStyles.caption, color: colors.textInverse, fontWeight: '700' },
  });
}
