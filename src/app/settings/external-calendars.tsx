/**
 * External calendars settings — Sprint 1 (Google import 단방향).
 *
 * 사용자가 Google Calendar 연결/해제 + 수동 동기화. Apple Calendar 는
 * Sprint 2 (read-only, iOS only) — 본 화면에서 placeholder.
 */

import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useColors, type ColorTokens } from '@/hooks/useColors';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import {
  connectGoogleCalendar,
  disconnectGoogleCalendar,
  getGoogleConnectionStatus,
  syncGoogleCalendarNow,
  type GoogleConnectionStatus,
} from '@/services/externalCalendarService';

export default function ExternalCalendarsScreen() {
  const colors = useColors();
  const styles = makeStyles(colors);

  const [status, setStatus] = useState<GoogleConnectionStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState<'connect' | 'disconnect' | 'sync' | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await getGoogleConnectionStatus();
      setStatus(s);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // 연결 안 됨 상태로 fallback (RPC error 는 미연결과 동일 UI).
      setStatus({ connected: false, email: null, connected_at: null, last_sync_at: null, last_sync_error: msg });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const handleConnect = useCallback(async () => {
    if (isBusy) return;
    setIsBusy('connect');
    try {
      await connectGoogleCalendar();
      // 연결 직후 자동 sync (사용자 첫 인상 = 일정 즉시 import).
      const syncResult = await syncGoogleCalendarNow().catch(() => null);
      await refresh();
      Alert.alert(
        '연결 완료',
        syncResult?.ok
          ? `Google 일정 ${syncResult.imported}건을 가져왔어요.`
          : 'Google 계정이 연결됐어요. 동기화는 잠시 후 다시 시도해 주세요.',
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('cancelled')) {
        Alert.alert('연결 실패', msg);
      }
    } finally {
      setIsBusy(null);
    }
  }, [isBusy, refresh]);

  const handleDisconnect = useCallback(() => {
    if (isBusy) return;
    Alert.alert(
      'Google 캘린더 연결 해제',
      '연결을 끊으면 이후 자동 동기화가 멈춰요. 이미 가져온 일정은 그대로 유지됩니다.',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '해제',
          style: 'destructive',
          onPress: async () => {
            setIsBusy('disconnect');
            try {
              await disconnectGoogleCalendar();
              await refresh();
            } catch (err) {
              Alert.alert('해제 실패', err instanceof Error ? err.message : String(err));
            } finally {
              setIsBusy(null);
            }
          },
        },
      ],
    );
  }, [isBusy, refresh]);

  const handleSync = useCallback(async () => {
    if (isBusy) return;
    setIsBusy('sync');
    try {
      const r = await syncGoogleCalendarNow();
      await refresh();
      Alert.alert(
        '동기화 완료',
        `새 일정 ${r.imported}건 · 변경 ${r.updated}건 · 삭제 ${r.deleted}건.`,
      );
    } catch (err) {
      Alert.alert('동기화 실패', err instanceof Error ? err.message : String(err));
    } finally {
      setIsBusy(null);
    }
  }, [isBusy, refresh]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable style={styles.back} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>외부 캘린더</Text>
        <View style={styles.back} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.intro}>
          외부 캘린더 일정을 SyncDay 에 불러와 한 화면에서 같이 봐요. 변경 사항은
          15분마다 자동으로 동기화돼요.
        </Text>

        {/* ── Google ─────────────────────────────────────────────────── */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Google 캘린더</Text>
            {status?.connected && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>연결됨</Text>
              </View>
            )}
          </View>

          {isLoading ? (
            <ActivityIndicator color={colors.textTertiary} style={{ marginVertical: spacing[4] }} />
          ) : status?.connected ? (
            <>
              {status.email && <Text style={styles.metaText}>{status.email}</Text>}
              {status.last_sync_at && (
                <Text style={styles.metaSub}>
                  최근 동기화: {new Date(status.last_sync_at).toLocaleString('ko-KR')}
                </Text>
              )}
              {status.last_sync_error && (
                <Text style={styles.errorText}>오류: {status.last_sync_error}</Text>
              )}
              <View style={styles.actionRow}>
                <Pressable
                  style={[styles.btn, styles.btnSecondary, isBusy && styles.btnDisabled]}
                  onPress={handleSync}
                  disabled={isBusy !== null}
                >
                  {isBusy === 'sync'
                    ? <ActivityIndicator color={colors.textPrimary} />
                    : <Text style={styles.btnSecondaryText}>지금 동기화</Text>}
                </Pressable>
                <Pressable
                  style={[styles.btn, styles.btnDanger, isBusy && styles.btnDisabled]}
                  onPress={handleDisconnect}
                  disabled={isBusy !== null}
                >
                  {isBusy === 'disconnect'
                    ? <ActivityIndicator color={colors.error} />
                    : <Text style={styles.btnDangerText}>연결 해제</Text>}
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.metaSub}>
                Google 계정으로 로그인해 일정을 가져와요. 무료 계정은 최근 7일~다음 30일,
                Pro 는 무제한 기간을 동기화합니다.
              </Text>
              <Pressable
                style={[styles.btn, styles.btnPrimary, isBusy && styles.btnDisabled]}
                onPress={handleConnect}
                disabled={isBusy !== null}
                testID="connect-google-calendar"
              >
                {isBusy === 'connect'
                  ? <ActivityIndicator color={colors.textInverse} />
                  : <Text style={styles.btnPrimaryText}>Google 캘린더 연결</Text>}
              </Pressable>
            </>
          )}
        </View>

        {/* ── Apple (placeholder) ────────────────────────────────────── */}
        <View style={[styles.card, styles.cardDisabled]}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Apple 캘린더</Text>
            <View style={styles.badgeMuted}>
              <Text style={styles.badgeMutedText}>곧 지원</Text>
            </View>
          </View>
          <Text style={styles.metaSub}>iOS 기기의 캘린더 일정을 SyncDay 로 가져옵니다 (Sprint 2 예정).</Text>
        </View>
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
    intro: { ...textStyles.bodySm, color: colors.textSecondary, marginBottom: spacing[2] },
    card: {
      padding: spacing[4],
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      gap: spacing[2],
    },
    cardDisabled: { opacity: 0.6 },
    cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    cardTitle: { ...textStyles.h3, color: colors.textPrimary },
    badge: {
      paddingHorizontal: spacing[2],
      paddingVertical: 2,
      borderRadius: radius.full,
      backgroundColor: colors.primary + '22',
    },
    badgeText: { ...textStyles.caption, color: colors.primary, fontWeight: '600' },
    badgeMuted: {
      paddingHorizontal: spacing[2],
      paddingVertical: 2,
      borderRadius: radius.full,
      backgroundColor: colors.border,
    },
    badgeMutedText: { ...textStyles.caption, color: colors.textTertiary },
    metaText: { ...textStyles.body, color: colors.textPrimary },
    metaSub: { ...textStyles.caption, color: colors.textTertiary, lineHeight: 18 },
    errorText: { ...textStyles.caption, color: colors.error, marginTop: spacing[1] },
    actionRow: { flexDirection: 'row', gap: spacing[2], marginTop: spacing[2] },
    btn: {
      flex: 1,
      paddingVertical: spacing[3],
      borderRadius: radius.lg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    btnDisabled: { opacity: 0.6 },
    btnPrimary: { backgroundColor: colors.primary },
    btnPrimaryText: { ...textStyles.labelLg, color: colors.textInverse, fontWeight: '600' },
    btnSecondary: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    btnSecondaryText: { ...textStyles.body, color: colors.textPrimary, fontWeight: '500' },
    btnDanger: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.error,
    },
    btnDangerText: { ...textStyles.body, color: colors.error, fontWeight: '500' },
  });
}
