/**
 * Spaces tab — 사용자가 속한 모든 Space (커플 / 가족 / 그룹) 목록.
 *
 * Sprint 31 후속 (2026-05-06): LEAD 요청 "스페이스도 하단메뉴에 별도로 분리하자".
 * 기존 my.tsx 안 inline 섹션을 별도 탭으로 옮겨 진입성 향상. SpaceCard 는
 * 컴포넌트로 추출 (`@/components/space/SpaceCard`).
 */

import { useEffect } from 'react';
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
import { useSpaceStore } from '@/stores/spaceStore';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import { SpaceCard } from '@/components/space/SpaceCard';

export default function SpacesScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const styles = makeStyles(colors);
  const { spaces, fetchMySpaces, isLoading } = useSpaceStore();

  // Tab mount 시 + focus 마다 재조회 (다른 탭에서 변경된 경우 동기화)
  useEffect(() => {
    fetchMySpaces();
  }, [fetchMySpaces]);

  const isEmpty = !isLoading && spaces.length === 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Space</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
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
                onPress={() => router.push('/space/create')}
                activeOpacity={0.7}
              >
                <Text style={styles.primaryButtonText}>Space {t('category.new')}</Text>
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
                onPress={() => router.push(`/space/${space.id}`)}
              />
            ))}
            <View style={styles.actionsRow}>
              <TouchableOpacity
                testID="spaces-button-add"
                style={styles.addRow}
                onPress={() => router.push('/space/create')}
                activeOpacity={0.7}
              >
                <Text style={styles.addText}>+ Space {t('category.new')}</Text>
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
    header: {
      paddingHorizontal: spacing[5],
      paddingTop:        spacing[3],
      paddingBottom:     spacing[3],
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      backgroundColor:   colors.background,
    },
    headerTitle: {
      ...textStyles.h2,
      color: colors.textPrimary,
    },
    scrollContent: {
      padding:       spacing[4],
      paddingBottom: spacing[20],
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
