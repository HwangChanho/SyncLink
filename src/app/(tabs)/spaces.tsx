/**
 * Spaces tab — 사용자가 속한 모든 Space (커플 / 가족 / 그룹) 목록.
 *
 * Sprint 31 후속 (2026-05-06): LEAD 요청 "스페이스도 하단메뉴에 별도로 분리하자".
 * 기존 my.tsx 안 inline 섹션을 별도 탭으로 옮겨 진입성 향상. SpaceCard 는
 * 컴포넌트로 추출 (`@/components/space/SpaceCard`).
 */

import { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useColors } from '@/hooks/useColors';
import { useResponsive } from '@/hooks/useResponsive';
import { desktopContentCentered } from '@/constants/webLayout';
import { useAuthStore } from '@/stores/authStore';
import { GuestGate } from '@/components/common/GuestGate';
import { useSpaceStore } from '@/stores/spaceStore';
import { useSubscriptionStore } from '@/stores/subscriptionStore';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import { SpaceCard } from '@/components/space/SpaceCard';
import { getUnreadCounts } from '@/services/spaceMessageService';
import { AppErrorBoundary } from '@/components/common/AppErrorBoundary';

/**
 * Guest gate: Spaces (shared calendars) require an account. Browsing guests
 * see a sign-in prompt instead of an empty space list.
 */
export default function SpacesScreen() {
  const { t } = useTranslation();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  if (!isAuthenticated) {
    return (
      <GuestGate
        description={t('auth.guest.gate_spaces')}
        icon="people-outline"
        testID="guest-gate-spaces"
      />
    );
  }
  // 스페이스 화면이 (계정 통합 후 데이터 불일치 등으로) 렌더 크래시해도 검은화면
  // 대신 폴백 + 재시도 UI 를 보여주고, 실제 에러를 error_logs 에 남긴다(2026-06-07).
  return (
    <AppErrorBoundary area="spaces">
      <SpacesScreenContent />
    </AppErrorBoundary>
  );
}

function SpacesScreenContent() {
  const { t } = useTranslation();
  const colors = useColors();
  const styles = makeStyles(colors);
  // 데스크탑 웹: 콘텐츠 적정폭(880) 중앙 정렬 — 풀폭 늘어짐 방지. (웹 반응형 S2)
  const { isDesktop } = useResponsive();
  const { spaces, fetchMySpaces, isLoading } = useSpaceStore();
  // v1.2.1 — Space 별 안 본 메시지 수.
  const [unread, setUnread] = useState<Record<string, number>>({});

  // 스페이스 "생성"은 Pro 전용 (참여는 free 허용 — 정책: 생성만 Pro). 서버 트리거
  // (마이그레이션 065)가 최종 방어선이지만, free 유저는 생성 화면 대신 페이월로 보낸다.
  const isPro = useSubscriptionStore((s) => s.plan === 'pro');
  const goCreateSpace = () => {
    if (!isPro) {
      router.push('/subscription/paywall');
      return;
    }
    router.push('/space/create');
  };

  // Tab mount 시 + focus 마다 재조회 (다른 탭에서 변경된 경우 동기화)
  useEffect(() => {
    fetchMySpaces();
    void getUnreadCounts().then(setUnread);
  }, [fetchMySpaces]);

  const isEmpty = !isLoading && spaces.length === 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          isDesktop && desktopContentCentered,
        ]}
      >
        {isLoading && spaces.length === 0 ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={colors.primary} />
          </View>
        ) : isEmpty ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>{t('common.none')}</Text>
            <View style={styles.actionsRow}>
              <TouchableOpacity
                testID="spaces-button-create"
                style={styles.primaryButton}
                onPress={goCreateSpace}
                activeOpacity={0.7}
              >
                <Text style={styles.primaryButtonText}>{t('space.create_button')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => router.push('/space/join')}
                activeOpacity={0.7}
              >
                <Text style={styles.secondaryButtonText}>{t('space.join_with_code')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <>
            {spaces.map(space => (
              <SpaceCard
                key={space.id}
                space={space}
                unreadCount={unread[space.id] ?? 0}
                onPress={() => router.push(`/space/${space.id}`)}
              />
            ))}
            <View style={styles.actionsRow}>
              <TouchableOpacity
                testID="spaces-button-add"
                style={styles.addRow}
                onPress={goCreateSpace}
                activeOpacity={0.7}
              >
                <Text style={styles.addText}>+ {t('space.create_button')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.addRow}
                onPress={() => router.push('/space/join')}
                activeOpacity={0.7}
              >
                <Text style={styles.addText}>{t('space.join_with_code')}</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    safe: {
      flex:            1,
      backgroundColor: colors.backgroundAlt,
    },
    scrollContent: {
      // 사용자 요청 (2026-05-15): 리스트를 상단에 더 가깝게 — 단 딱 붙지
      // 않도록 적당한 여백 유지. 좌우 패딩은 기존 유지.
      paddingHorizontal: spacing[4],
      paddingTop:        spacing[2],
      paddingBottom:     spacing[20],
    },
    loadingRow: {
      paddingVertical: spacing[6],
      alignItems:      'center',
    },
    emptyCard: {
      backgroundColor:  colors.surface,
      borderRadius:     radius.xl,
      padding:          spacing[6],
      alignItems:       'center',
    },
    emptyText: {
      ...textStyles.body,
      color:        colors.textSecondary,
      marginBottom: spacing[4],
    },
    actionsRow: {
      flexDirection:  'row',
      gap:            spacing[2],
      marginTop:      spacing[3],
      flexWrap:       'wrap',
      justifyContent: 'center',
    },
    primaryButton: {
      backgroundColor:   colors.primary,
      paddingVertical:   spacing[3],
      paddingHorizontal: spacing[5],
      borderRadius:      radius.lg,
    },
    primaryButtonText: {
      ...textStyles.body,
      color:      colors.textInverse,
      fontWeight: '600',
    },
    secondaryButton: {
      backgroundColor:   colors.surface,
      paddingVertical:   spacing[3],
      paddingHorizontal: spacing[5],
      borderRadius:      radius.lg,
      borderWidth:       1,
      borderColor:       colors.border,
    },
    secondaryButtonText: {
      ...textStyles.body,
      color:      colors.textPrimary,
      fontWeight: '500',
    },
    addRow: {
      paddingVertical:   spacing[3],
      paddingHorizontal: spacing[5],
      borderRadius:      radius.lg,
      backgroundColor:   colors.surface,
      borderWidth:       1,
      borderColor:       colors.border,
    },
    addText: {
      ...textStyles.body,
      color:      colors.textPrimary,
      fontWeight: '500',
    },
  });
}
