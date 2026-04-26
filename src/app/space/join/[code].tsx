/**
 * Space join preview screen — shown when a user taps an invite link.
 *
 * URL: /space/join/<inviteCode>
 *
 * Flow:
 *  1. Load space info via getSpaceByInviteCode(code)
 *  2. Show space name, type, and member count
 *  3. "참여하기" → spaceService.joinSpace(spaceId)
 *  4. On success → replace to /space/<spaceId>
 *  5. If already a member → navigate directly without re-joining
 *
 * Also handles manually navigated entry (the code comes from the URL segment).
 *
 * TASK-601 (Sprint 6)
 */

import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useColors } from '@/hooks/useColors';
import type { ColorTokens } from '@/hooks/useColors';
import { spacing, radius, componentHeight } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import * as spaceService from '@/services/spaceService';
import { useSpaceStore } from '@/stores/spaceStore';
import type { SpaceSummary } from '@/types';

// Space type labels are now built inside the component using i18n.

// ─── Component ────────────────────────────────────────────────────────────────

export default function SpaceJoinPreviewScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const styles = makeStyles(colors);

  /** Space type labels loaded from i18n. */
  const SPACE_TYPE_LABELS: Record<string, string> = {
    couple: t('space.types.couple'),
    group:  t('space.types.group'),
  };

  const { code } = useLocalSearchParams<{ code: string }>();
  const { fetchMySpaces, setActiveSpaceId } = useSpaceStore();

  const [space,     setSpace]     = useState<SpaceSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isJoining, setIsJoining] = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  // ── Load space info by invite code ────────────────────────────────────────

  const loadSpace = useCallback(async () => {
    if (!code) {
      setError(t('space.no_code'));
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const info = await spaceService.getSpaceByInviteCode(code);
      setSpace(info);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('space.invalid_code'));
    } finally {
      setIsLoading(false);
    }
  }, [code, t]);

  useEffect(() => {
    void loadSpace();
  }, [loadSpace]);

  // ── Join action ───────────────────────────────────────────────────────────

  const handleJoin = useCallback(async () => {
    if (!space) return;
    setIsJoining(true);
    try {
      // joinSpace is idempotent — safe if already a member
      await spaceService.joinSpace(space.id);

      // Update store and navigate to the space
      await fetchMySpaces();
      setActiveSpaceId(space.id);
      router.replace(`/space/${space.id}`);
    } catch (err) {
      Alert.alert(t('space.join_fail_title'), err instanceof Error ? err.message : t('space.join_error'));
      setIsJoining(false);
    }
  }, [space, fetchMySpaces, setActiveSpaceId, t]);

  // ── Render states ─────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>{t('common.loading')}</Text>
      </SafeAreaView>
    );
  }

  if (error || !space) {
    return (
      <SafeAreaView style={styles.centered}>
        <Ionicons name="alert-circle-outline" size={56} color={colors.error} />
        <Text style={styles.errorTitle}>{t('space.code_error')}</Text>
        <Text style={styles.errorText}>{error ?? t('space.invalid_code')}</Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>{t('common.back')}</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────

  const typeLabel = SPACE_TYPE_LABELS[space.type] ?? space.type;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.closeBtn} onPress={() => router.back()}>
          <Ionicons name="close" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Space 초대</Text>
        <View style={styles.closeBtn} />
      </View>

      {/* Space preview card */}
      <View style={styles.card}>
        {/* Icon */}
        <View style={styles.spaceIcon}>
          <Ionicons
            name={space.type === 'couple' ? 'heart' : 'people'}
            size={36}
            color={colors.primary}
          />
        </View>

        {/* Space name */}
        <Text style={styles.spaceName}>{space.name}</Text>

        {/* Type + member count */}
        <View style={styles.meta}>
          <View style={styles.metaChip}>
            <Text style={styles.metaText}>{typeLabel}</Text>
          </View>
          <View style={styles.metaChip}>
            <Ionicons name="person" size={12} color={colors.textSecondary} />
            <Text style={styles.metaText}>{space.memberCount}명</Text>
          </View>
        </View>
      </View>

      {/* Description */}
      <Text style={styles.description}>
        {t('space.join_fail_desc')}
      </Text>

      {/* Action buttons */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.joinBtn, isJoining && styles.btnDisabled]}
          onPress={handleJoin}
          disabled={isJoining}
          activeOpacity={0.8}
        >
          {isJoining ? (
            <ActivityIndicator color={colors.textInverse} />
          ) : (
            <Text style={styles.joinBtnText}>참여하기</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.cancelBtn}
          onPress={() => router.back()}
          disabled={isJoining}
        >
          <Text style={styles.cancelBtnText}>취소</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

/**
 * Dynamic styles factory — receives current theme color tokens.
 *
 * @param colors - Active theme color tokens from useColors()
 */
function makeStyles(colors: ColorTokens) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    centered: {
      flex: 1,
      backgroundColor: colors.background,
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing[4],
      padding: spacing[6],
    },
    loadingText: {
      ...textStyles.body,
      color: colors.textSecondary,
    },

    // Error state
    errorTitle: {
      ...textStyles.h4,
      color: colors.textPrimary,
    },
    errorText: {
      ...textStyles.body,
      color: colors.textSecondary,
      textAlign: 'center',
    },
    backBtn: {
      paddingVertical: spacing[2],
      paddingHorizontal: spacing[4],
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
    },
    backBtnText: {
      ...textStyles.label,
      color: colors.textSecondary,
    },

    // Header
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing[3],
      paddingVertical: spacing[3],
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    closeBtn: {
      padding: spacing[1],
      minWidth: 40,
    },
    headerTitle: {
      ...textStyles.h4,
      color: colors.textPrimary,
    },

    // Space preview card
    card: {
      margin: spacing[6],
      padding: spacing[6],
      backgroundColor: colors.surface,
      borderRadius: radius['2xl'],
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      gap: spacing[3],
    },
    spaceIcon: {
      width: 72,
      height: 72,
      borderRadius: radius.full,
      backgroundColor: colors.primaryLight,
      alignItems: 'center',
      justifyContent: 'center',
    },
    spaceName: {
      ...textStyles.h3,
      color: colors.textPrimary,
      textAlign: 'center',
    },
    meta: {
      flexDirection: 'row',
      gap: spacing[2],
    },
    metaChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[1],
      paddingVertical: spacing[1],
      paddingHorizontal: spacing[2],
      borderRadius: radius.full,
      backgroundColor: colors.backgroundAlt,
    },
    metaText: {
      ...textStyles.caption,
      color: colors.textSecondary,
    },

    // Description
    description: {
      ...textStyles.bodyLg,
      color: colors.textSecondary,
      textAlign: 'center',
      paddingHorizontal: spacing[6],
    },

    // Action buttons
    actions: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      padding: spacing[5],
      gap: spacing[3],
      borderTopWidth: 1,
      borderTopColor: colors.border,
      backgroundColor: colors.background,
    },
    joinBtn: {
      height: componentHeight.button,
      backgroundColor: colors.primary,
      borderRadius: radius.xl,
      alignItems: 'center',
      justifyContent: 'center',
    },
    joinBtnText: {
      ...textStyles.labelLg,
      color: colors.textInverse,
    },
    cancelBtn: {
      height: componentHeight.buttonSm,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cancelBtnText: {
      ...textStyles.labelLg,
      color: colors.textSecondary,
    },
    btnDisabled: {
      opacity: 0.5,
    },
  });
}
