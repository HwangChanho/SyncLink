/**
 * Linked accounts section — multi-provider OAuth identity linking.
 *
 * TASK-002 / ADR-010 (Sprint 21).
 *
 * Lets the user attach additional sign-in methods (Google/Kakao/Apple) to
 * the same Supabase user, so future logins via any linked provider resolve
 * to the existing account (no duplicate user creation).
 *
 * Calls authService.linkProvider / getLinkedProviders / unlinkProvider.
 * Errors are surfaced via Alert; the row stays loading until the OAuth
 * round-trip resolves.
 */

import { useState, useEffect, useCallback } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useColors } from '@/hooks/useColors';
import { textStyles } from '@/constants/typography';
import { spacing, radius } from '@/constants/spacing';
import * as authService from '@/services/authService';
import { useAuthStore } from '@/stores/authStore';
import { makeMenuStyles } from './menuStyles';

type Provider = 'google' | 'kakao' | 'apple';
const PROVIDERS: { key: Provider; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'google', label: 'Google', icon: 'logo-google' },
  { key: 'kakao',  label: 'Kakao',  icon: 'chatbubble-ellipses' },
  { key: 'apple',  label: 'Apple',  icon: 'logo-apple' },
];

export function LinkedAccountsSection() {
  const { t } = useTranslation();
  const colors = useColors();
  const menu = makeMenuStyles(colors);
  const local = makeLocal(colors);

  const myId = useAuthStore((s) => s.user?.id ?? null);
  const [linked, setLinked] = useState<string[]>([]);
  const [loadingProvider, setLoadingProvider] = useState<Provider | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  // Phase B — 동일 이메일 통합 후보 (있으면 안내 배너 노출).
  const [candidates, setCandidates] = useState<authService.MergeCandidate[]>([]);
  const [merging, setMerging] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const providers = await authService.getLinkedProviders();
      setLinked(providers);
      setBootError(null);
    } catch (err) {
      setBootError(err instanceof Error ? err.message : '연결된 계정을 불러오지 못했습니다');
    }
  }, []);

  // 통합 후보는 부가 정보 — 실패해도 섹션 동작에 영향 주지 않게 분리.
  const refreshCandidates = useCallback(async () => {
    try {
      setCandidates(await authService.getAccountMergeCandidates());
    } catch {
      setCandidates([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
    void refreshCandidates();
  }, [refresh, refreshCandidates]);

  /**
   * 통합 실행. Pro 계정을 primary(유지)로, 다른 쪽을 secondary(흡수)로 결정.
   * - 후보가 Pro 이고 내 계정이 Pro 가 아니면 → 후보가 primary → 내 계정이 삭제됨
   *   → 병합 후 현재 세션이 무효해지므로 재로그인 안내.
   */
  const handleMerge = useCallback(async (candidate: authService.MergeCandidate) => {
    if (!myId || merging) return;

    const candidateIsPrimary = candidate.plan === 'pro';
    const primary = candidateIsPrimary ? candidate.user_id : myId;
    const secondary = candidateIsPrimary ? myId : candidate.user_id;

    const warnSelfDelete = candidateIsPrimary; // 내 현재 계정이 흡수되는 경우

    Alert.alert(
      '계정 통합',
      candidateIsPrimary
        ? `Pro 계정(${candidate.nickname || candidate.email})을 기준으로 통합해요. 현재 로그인한 계정의 데이터가 Pro 계정으로 옮겨지고, 통합 후 다시 로그인해야 해요. 진행할까요?`
        : `다른 계정(${candidate.nickname || candidate.email})의 데이터를 현재 계정으로 가져와 통합해요. 진행할까요?`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '통합',
          style: 'destructive',
          onPress: async () => {
            setMerging(true);
            try {
              const res = await authService.mergeAccount(primary, secondary);
              if (res.both_pro) {
                Alert.alert(
                  '통합 완료',
                  '두 계정 모두 Pro 였어요. 중복 구독이 있는지 스토어에서 확인하고 필요 시 한쪽을 해지해 주세요.',
                );
              } else if (warnSelfDelete) {
                Alert.alert('통합 완료', '통합이 끝났어요. 다시 로그인해 주세요.', [
                  { text: '확인', onPress: () => void authService.signOut() },
                ]);
              } else {
                Alert.alert('통합 완료', '계정이 하나로 합쳐졌어요.');
                await refreshCandidates();
                await refresh();
              }
            } catch (err) {
              Alert.alert('통합 실패', err instanceof Error ? err.message : '잠시 후 다시 시도해주세요');
            } finally {
              setMerging(false);
            }
          },
        },
      ],
    );
  }, [myId, merging, refresh, refreshCandidates]);

  const handleToggle = useCallback(async (provider: Provider) => {
    if (loadingProvider !== null) return;
    const isLinked = linked.includes(provider);
    setLoadingProvider(provider);
    try {
      if (isLinked) {
        if (linked.length <= 1) {
          Alert.alert('해제 불가', '마지막 로그인 방법은 해제할 수 없습니다');
          return;
        }
        await authService.unlinkProvider(provider);
      } else {
        await authService.linkProvider(provider);
      }
      await refresh();
    } catch (err) {
      Alert.alert('실패', err instanceof Error ? err.message : '잠시 후 다시 시도해주세요');
    } finally {
      setLoadingProvider(null);
    }
  }, [linked, loadingProvider, refresh]);

  return (
    <View style={menu.section}>
      <Text style={menu.sectionTitle}>{t('my.linked_accounts.title') /* fallback: "연결된 로그인" */}</Text>
      {bootError !== null && (
        <Text style={local.errorText}>{bootError}</Text>
      )}

      {/* Phase B/C — 동일 이메일 통합 후보. Pro 후보 강조 + 통합 실행 버튼. */}
      {candidates.map((c) => (
        <View key={c.user_id} style={local.candidateBanner}>
          <Ionicons
            name={c.plan === 'pro' ? 'star' : 'information-circle'}
            size={18}
            color={c.plan === 'pro' ? colors.warning : colors.primary}
          />
          <View style={local.candidateBody}>
            <Text style={local.candidateText}>
              {c.plan === 'pro'
                ? `같은 이메일의 다른 계정(${c.nickname || c.email}, Pro)을 발견했어요. 이 Pro 계정 기준으로 통합할 수 있어요.`
                : `같은 이메일의 다른 계정(${c.nickname || c.email})을 발견했어요. 현재 계정으로 통합할 수 있어요.`}
            </Text>
            <TouchableOpacity
              style={local.mergeBtn}
              onPress={() => void handleMerge(c)}
              disabled={merging}
            >
              {merging ? (
                <ActivityIndicator size="small" color={colors.textInverse} />
              ) : (
                <Text style={local.mergeBtnText}>통합하기</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      ))}
      <View style={menu.menuCard}>
        {PROVIDERS.map((p, i) => {
          const isLinked = linked.includes(p.key);
          const isLoading = loadingProvider === p.key;
          return (
            <View key={p.key}>
              <TouchableOpacity
                style={menu.menuItem}
                onPress={() => void handleToggle(p.key)}
                disabled={loadingProvider !== null}
                accessibilityLabel={`${p.label} ${isLinked ? '연결 해제' : '연결'}`}
              >
                <View style={local.row}>
                  <Ionicons name={p.icon} size={20} color={colors.textSecondary} />
                  <Text style={[menu.menuItemText, local.rowText]}>{p.label}</Text>
                </View>
              {isLoading ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : isLinked ? (
                <View style={local.linkedBadge}>
                  <Text style={local.linkedBadgeText}>연결됨</Text>
                </View>
              ) : (
                <Text style={local.linkLabel}>연결</Text>
              )}
              </TouchableOpacity>
              {i < PROVIDERS.length - 1 && <View style={menu.menuDivider} />}
            </View>
          );
        })}
      </View>
    </View>
  );
}

function makeLocal(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    errorText: {
      ...textStyles.caption,
      color: colors.error,
      marginTop: spacing[1],
      marginHorizontal: spacing[4],
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[3],
    },
    rowText: {
      flex: 1,
    },
    linkedBadge: {
      paddingHorizontal: spacing[2],
      paddingVertical:   spacing[1] / 2,
      backgroundColor:   'rgba(108,99,255,0.1)',
      borderRadius:      radius.sm,
    },
    linkedBadgeText: {
      ...textStyles.caption,
      color: colors.primary,
    },
    linkLabel: {
      ...textStyles.label,
      color: colors.primary,
    },
    candidateBanner: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing[2],
      marginHorizontal: spacing[4],
      marginTop: spacing[2],
      padding: spacing[3],
      borderRadius: radius.md,
      backgroundColor: 'rgba(108,99,255,0.08)',
    },
    candidateBody: {
      flex: 1,
      gap: spacing[2],
    },
    candidateText: {
      ...textStyles.caption,
      color: colors.textSecondary,
      lineHeight: 17,
    },
    mergeBtn: {
      alignSelf: 'flex-start',
      paddingHorizontal: spacing[3],
      paddingVertical: spacing[1],
      borderRadius: radius.full,
      backgroundColor: colors.primary,
    },
    mergeBtnText: {
      ...textStyles.label,
      color: colors.textInverse,
      fontWeight: '700',
    },
  });
}
