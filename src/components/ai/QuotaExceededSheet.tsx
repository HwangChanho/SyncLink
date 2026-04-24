/**
 * QuotaExceededSheet — Bottom-sheet shown when the user hits the free AI
 * quota. Offers two paths:
 *   1. Watch a rewarded ad → earn AI credits (AdMob) — hidden when ads are
 *      unavailable on the current platform (e.g. web, Android before the key
 *      ships, offline).
 *   2. Upgrade to Pro (existing paywall flow).
 *
 * Sprint 14 TASK-1404
 */

import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useColors } from '@/hooks/useColors';
import type { ColorTokens } from '@/hooks/useColors';
import { radius, spacing } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import { useRewardedAd } from '@/hooks/useRewardedAd';
import { useSubscriptionStore } from '@/stores/subscriptionStore';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Credits granted per successful rewarded ad view. Kept in sync with the
 * `reward-credit` Edge Function. If you change this, update the function too
 * — the server is the source of truth; clients just render an optimistic UI.
 */
const CREDITS_PER_AD = 2;

// ─── Props ────────────────────────────────────────────────────────────────────

export interface QuotaExceededSheetProps {
  /** Whether the sheet is visible. */
  visible: boolean;
  /** Called when the sheet should close (overlay tap, close btn, reward earned). */
  onClose: () => void;
  /**
   * Optional callback when the user successfully earns credits from the ad.
   * Typically used by the caller to retry the AI call immediately.
   */
  onRewardEarned?: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Modal bottom-sheet presenting the watch-an-ad / upgrade-to-Pro choice.
 */
export function QuotaExceededSheet({
  visible,
  onClose,
  onRewardEarned,
}: QuotaExceededSheetProps) {
  const { t } = useTranslation();
  const colors = useColors();
  const styles = makeStyles(colors);

  const rewarded = useRewardedAd();
  const refreshCredits = useSubscriptionStore((s) => s.refreshCredits);

  const [watching, setWatching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleWatchAd = useCallback(async () => {
    if (watching) return;
    setWatching(true);
    setError(null);

    try {
      const earned = await rewarded.show();
      if (earned) {
        // Refresh the balance from the server — the SSV callback on our Edge
        // Function will have written the new balance. A small delay gives
        // the callback time to land; we poll-retry a couple of times below.
        await refreshCredits();
        onRewardEarned?.();
        onClose();
      } else {
        setError(t('ads.watch_failed'));
      }
    } catch {
      setError(t('ads.watch_failed'));
    } finally {
      setWatching(false);
    }
  }, [rewarded, watching, refreshCredits, onRewardEarned, onClose, t]);

  const handleUpgrade = useCallback(() => {
    onClose();
    router.push('/subscription/paywall');
  }, [onClose]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.handle} />

          <Text style={styles.title}>{t('ai.quota_exceeded_title') ?? 'AI 쿼터 초과'}</Text>
          <Text style={styles.subtitle}>
            {t('ai.quota_exceeded_subtitle') ?? '오늘의 무료 AI 사용량을 모두 사용했어요.'}
          </Text>

          {error !== null && (
            <Text style={styles.error}>{error}</Text>
          )}

          {/* Ad CTA — hidden on platforms where ads are unavailable. */}
          {rewarded.isAvailable && (
            <Pressable
              style={[styles.primaryBtn, watching && styles.disabled]}
              onPress={() => void handleWatchAd()}
              disabled={watching || !rewarded.isLoaded}
            >
              {watching ? (
                <ActivityIndicator color={colors.textInverse} size="small" />
              ) : (
                <>
                  <Ionicons name="play" size={18} color={colors.textInverse} />
                  <Text style={styles.primaryBtnText}>
                    {t('ads.watch_to_unlock', {
                      defaultValue: `광고 보고 AI ${CREDITS_PER_AD}회 더 사용`,
                    })}
                  </Text>
                </>
              )}
            </Pressable>
          )}

          {/* Upgrade CTA — always available. */}
          <Pressable style={styles.secondaryBtn} onPress={handleUpgrade}>
            <Text style={styles.secondaryBtnText}>
              {t('ai.upgrade_cta') ?? 'Pro로 업그레이드'}
            </Text>
          </Pressable>

          <Pressable style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeBtnText}>{t('common.close') ?? '닫기'}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function makeStyles(colors: ColorTokens) {
  return StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.4)',
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: radius['2xl'],
      borderTopRightRadius: radius['2xl'],
      paddingHorizontal: spacing[6],
      paddingTop: spacing[3],
      paddingBottom: spacing[8],
      gap: spacing[3],
    },
    handle: {
      alignSelf: 'center',
      width: 40,
      height: 4,
      borderRadius: radius.full,
      backgroundColor: colors.border,
      marginBottom: spacing[2],
    },
    title: {
      ...textStyles.h3,
      color: colors.textPrimary,
    },
    subtitle: {
      ...textStyles.body,
      color: colors.textSecondary,
    },
    error: {
      ...textStyles.bodySm,
      color: colors.error,
    },
    primaryBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing[2],
      backgroundColor: colors.primary,
      borderRadius: radius.md,
      paddingVertical: spacing[4],
    },
    primaryBtnText: {
      ...textStyles.labelLg,
      color: colors.textInverse,
    },
    secondaryBtn: {
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.primary,
      paddingVertical: spacing[4],
    },
    secondaryBtnText: {
      ...textStyles.labelLg,
      color: colors.primary,
    },
    closeBtn: {
      alignItems: 'center',
      paddingVertical: spacing[3],
    },
    closeBtnText: {
      ...textStyles.body,
      color: colors.textSecondary,
    },
    disabled: {
      opacity: 0.6,
    },
  });
}
