/**
 * WeeklyReviewCard — AI-generated weekly summary card for the Home screen.
 *
 * Displays:
 *  - Header with the week's date range (Mon ~ Sun)
 *  - AI-generated 2-3 sentence review text
 *  - Refresh button to re-generate
 *  - Loading skeleton while fetching
 *  - Error state with retry option
 *
 * Cache behavior (managed in aiService.getWeeklyReview):
 *  - Same-week revisit: loads from AsyncStorage cache instantly
 *  - Monday: cache miss → calls Edge Function → caches result
 *
 * Subscription gating:
 *  - Free plan: 1 generation/month
 *  - Pro plan: unlimited
 *
 * TASK-504 (Sprint 5)
 */

import { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SkeletonLines } from '@/components/common/Skeleton';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useColors } from '@/hooks/useColors';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import { getWeeklyReview } from '@/services/aiService';
import { useSubscriptionStore } from '@/stores/subscriptionStore';

/**
 * Curated fallback quotes shown when the weekly review has nothing to
 * summarise (e.g. no events logged that week or the Edge Function is
 * unavailable). Kept deliberately short and in Korean since the card
 * headline is Korean.
 */
const MOTIVATIONAL_QUOTES = [
  '오늘 내디딘 작은 한 걸음이 내일의 길을 만듭니다.',
  '바쁘게 산 한 주보다, 의미 있게 산 한 주가 더 깁니다.',
  '잘 쉬는 것도 성장의 한 부분이에요.',
  '완벽하지 않아도 괜찮아요. 지속하는 것이 답입니다.',
  '기록한 하루는 사라지지 않습니다.',
  '가장 좋은 계획은, 지금 시작하는 계획입니다.',
  '당신의 속도대로 가세요. 어디로 향하는지만 잊지 마세요.',
  '어제보다 오늘 1%만 더 나아지면 충분합니다.',
  '할 일을 해낸 당신에게 박수를 보냅니다.',
  '쉬는 것도 일입니다. 잘 쉬고, 잘 돌아오세요.',
  '지나간 한 주를 돌아보는 지금, 이미 성장하고 있는 거예요.',
  '조급함은 내일을 훔칩니다. 오늘에 머무르세요.',
];

/** Pick a quote that's stable for the given day so it doesn't flicker. */
function pickMotivationalQuote(): string {
  const d = new Date();
  const dayStamp = d.getFullYear() * 1000 + d.getMonth() * 40 + d.getDate();
  const idx = dayStamp % MOTIVATIONAL_QUOTES.length;
  return MOTIVATIONAL_QUOTES[idx] ?? MOTIVATIONAL_QUOTES[0]!;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns the Monday (week start) of the week containing the given date.
 * Sets time to 00:00:00.000 local time.
 *
 * @param date - Any date within the target week (defaults to today)
 * @returns Date object for Monday 00:00 of that week
 */
function getMondayOfWeek(date: Date = new Date()): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0 = Sunday, 1 = Monday, …
  // Shift so Monday = 0: (day + 6) % 7
  const offset = (day + 6) % 7;
  d.setDate(d.getDate() - offset);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Formats a week range as "M월 D일 (월) ~ M월 D일 (일)".
 *
 * @param weekStart - Monday of the week
 * @returns Human-readable week range string in Korean
 */
function formatWeekRange(weekStart: Date): string {
  const weekEnd = new Date(weekStart.getTime() + 6 * 24 * 60 * 60 * 1000);

  const fmt = (d: Date) =>
    d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });

  return `${fmt(weekStart)} ~ ${fmt(weekEnd)}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function WeeklyReviewCard() {
  const { t } = useTranslation();
  const colors = useColors();
  const styles = makeStyles(colors);

  const { canUseWeeklyReview, consumeWeeklyReview, plan } = useSubscriptionStore();

  // ── State ─────────────────────────────────────────────────────────────────

  /** AI review text. null = not yet loaded. */
  const [review, setReview] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null);

  /** Monday of the current week. */
  const weekStart = getMondayOfWeek();

  // ── Load review ───────────────────────────────────────────────────────────

  const loadReview = useCallback(async (forceRefresh = false) => {
    // Check subscription limit (skip check for cached data — we only gate new generations)
    if (forceRefresh && !canUseWeeklyReview()) {
      // Redirect to paywall
      router.push('/subscription/paywall');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await getWeeklyReview(weekStart);
      setReview(result.review);
      setGeneratedAt(result.generatedAt);

      // Consume usage only when we actually called the Edge Function
      // (getWeeklyReview returns cached data on same-week re-calls,
      //  so we can't detect this easily here — consume on fresh load too
      //  since the cache write happens inside aiService)
      if (forceRefresh) {
        consumeWeeklyReview();
      }
    } catch {
      // Edge Function unavailable or no data — show empty state instead of error
      setReview(null);
      setError(null);
    } finally {
      setIsLoading(false);
    }
  }, [weekStart, canUseWeeklyReview, consumeWeeklyReview]);

  // Load on mount (cache hit likely, no usage consumed)
  useEffect(() => {
    void loadReview(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={styles.card}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>이번 주 리뷰</Text>
          <Text style={styles.weekRange}>{formatWeekRange(weekStart)}</Text>
        </View>

        {/* Refresh button */}
        {!isLoading && (
          <TouchableOpacity
            style={styles.refreshButton}
            onPress={() => loadReview(true)}
            activeOpacity={0.7}
            accessibilityLabel="주간 리뷰 새로고침"
          >
            <Text style={styles.refreshText}>{t('common.refresh')}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Content */}
      {isLoading ? (
        // Animated skeleton placeholder — communicates progress without
        // a spinner, and the layout pre-shapes the eventual reveal.
        <SkeletonLines
          lines={3}
          lineHeight={14}
          spacing={10}
          widths={['100%', '92%', '70%']}
          style={styles.skeletonContainer}
        />
      ) : error ? (
        // Error state
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => loadReview(false)}
            activeOpacity={0.7}
          >
            <Text style={styles.retryText}>{t('common.retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : review ? (
        // Review text
        <View style={styles.reviewContainer}>
          <Text style={styles.reviewText}>{review}</Text>
          {generatedAt && (
            <Text style={styles.generatedAtText}>
              {generatedAt.toLocaleDateString('ko-KR', {
                month: 'short', day: 'numeric',
              })} 생성
            </Text>
          )}
        </View>
      ) : (
        // Empty state — previously just said "no review" which felt cold.
        // Rotate through a curated pool of motivational quotes so the card
        // still feels worth glancing at in a quiet week. Deterministic by
        // day so the quote doesn't flicker on re-renders.
        <View style={styles.emptyContainer}>
          <Text style={styles.reviewText}>{pickMotivationalQuote()}</Text>
        </View>
      )}

      {/* Free plan usage indicator */}
      {plan === 'free' && (
        <View style={styles.freeIndicator}>
          <Text style={styles.freeIndicatorText}>
            무료 플랜 · 월 1회 생성
          </Text>
        </View>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    card: {
      marginHorizontal: spacing[4],
      marginBottom:     spacing[3],
      backgroundColor:  colors.surface,
      borderRadius:     radius.xl,
      borderWidth:      1,
      borderColor:      colors.border,
      padding:          spacing[4],
      gap:              spacing[3],
    },

    // ── Header ──────────────────────────────────────────────────────────────
    header: {
      flexDirection:  'row',
      alignItems:     'flex-start',
      justifyContent: 'space-between',
    },
    title: {
      ...textStyles.labelLg,
      color: colors.textPrimary,
    },
    weekRange: {
      ...textStyles.caption,
      color: colors.textTertiary,
      marginTop: spacing[0.5],
    },
    refreshButton: {
      paddingHorizontal: spacing[3],
      paddingVertical:   spacing[1.5],
      borderRadius:      radius.full,
      borderWidth:       1,
      borderColor:       colors.border,
    },
    refreshText: {
      ...textStyles.caption,
      color: colors.textSecondary,
    },

    // ── Loading skeleton ─────────────────────────────────────────────────────
    skeletonContainer: {
      gap: spacing[2],
    },
    skeletonLine: {
      height:          14,
      borderRadius:    radius.sm,
      backgroundColor: colors.backgroundAlt,
      width:           '100%',
    },
    skeletonLineMid: {
      width: '85%',
    },
    skeletonLineShort: {
      width: '65%',
    },
    spinner: {
      marginTop: spacing[1],
    },

    // ── Error state ──────────────────────────────────────────────────────────
    errorContainer: {
      gap: spacing[2],
    },
    errorText: {
      ...textStyles.bodySm,
      color: colors.error,
    },
    retryButton: {
      alignSelf: 'flex-start',
    },
    retryText: {
      ...textStyles.label,
      color: colors.primary,
    },

    // ── Review text ──────────────────────────────────────────────────────────
    reviewContainer: {
      gap: spacing[2],
    },
    reviewText: {
      ...textStyles.body,
      color:      colors.textPrimary,
      lineHeight: 22,
    },
    generatedAtText: {
      ...textStyles.caption,
      color: colors.textTertiary,
    },

    // ── Empty state ──────────────────────────────────────────────────────────
    emptyContainer: {},
    emptyText: {
      ...textStyles.bodySm,
      color: colors.textTertiary,
    },

    // ── Free indicator ───────────────────────────────────────────────────────
    freeIndicator: {
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingTop:     spacing[2],
    },
    freeIndicatorText: {
      ...textStyles.caption,
      color: colors.textTertiary,
    },
  });
}
