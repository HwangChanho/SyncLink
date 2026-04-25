/**
 * DateSuggestionCard — AI-generated date/meetup suggestion for the home screen.
 *
 * Shown only when the user belongs to at least one Space.
 * Calls the `suggest-date` Edge Function via aiService.getDateSuggestion().
 *
 * Features:
 *  - Displays Claude Haiku's natural-language suggestion
 *  - "Create Event" button pre-fills /event/create with the first free slot
 *  - Loading / error / empty states handled gracefully
 *  - Refreshes suggestion each time the home screen mounts
 *
 * TASK-904 (Sprint 9)
 */

import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useColors } from '@/hooks/useColors';
import { SkeletonLines } from '@/components/common/Skeleton';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import { useSpaceStore } from '@/stores/spaceStore';
import { getDateSuggestion, type DateSuggestionResult } from '@/services/aiService';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns the ISO-8601 date string for the Monday of the current week.
 * Used as `weekStart` parameter for the Edge Function.
 */
function getCurrentWeekMonday(): string {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon, …
  const monday = new Date(now);
  // Shift to Monday: if today is Sunday (0) shift back 6 days, otherwise shift back (day-1)
  monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
  monday.setHours(0, 0, 0, 0);
  return monday.toISOString();
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DateSuggestionCard() {
  const { t } = useTranslation();
  const colors = useColors();
  const styles = makeStyles(colors);

  const { spaces } = useSpaceStore();

  const [result, setResult] = useState<DateSuggestionResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);

  /** Fetch suggestion for the first Space the user belongs to. */
  const fetchSuggestion = useCallback(async () => {
    // Only show when there is at least one Space
    if (spaces.length === 0) return;

    const spaceId = spaces[0]?.id;
    if (!spaceId) return;

    setIsLoading(true);
    setHasError(false);
    try {
      const weekStart = getCurrentWeekMonday();
      const data = await getDateSuggestion(spaceId, weekStart);
      setResult(data);
    } catch {
      setHasError(true);
    } finally {
      setIsLoading(false);
    }
  }, [spaces]);

  useEffect(() => {
    void fetchSuggestion();
  }, [fetchSuggestion]);

  // Only render when the user belongs to at least one Space
  if (spaces.length === 0) return null;

  // ─── Render ────────────────────────────────────────────────────────────────

  /** Navigate to event/create pre-filled with the first free slot. */
  const handleCreateEvent = () => {
    const firstSlot = result?.slots[0];
    if (firstSlot) {
      const startDate = new Date(firstSlot.start);
      const dateKey = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`;
      router.push({
        pathname: '/event/create',
        params: { date: dateKey },
      });
    } else {
      router.push('/event/create');
    }
  };

  return (
    <View style={styles.container}>
      {/* Header row */}
      <View style={styles.header}>
        <Ionicons name="sparkles" size={16} color={colors.primary} />
        <Text style={styles.title}>{t('date_suggest.title')}</Text>
      </View>

      {/* Content */}
      {isLoading ? (
        <SkeletonLines
          lines={2}
          lineHeight={14}
          spacing={10}
          widths={['90%', '60%']}
          style={styles.loadingRow}
        />
      ) : hasError || !result ? (
        <Text style={styles.emptyText}>{t('date_suggest.empty')}</Text>
      ) : (
        <>
          {/* Suggestion text */}
          <Text style={styles.suggestion}>{result.suggestion}</Text>

          {/* Create event button */}
          <TouchableOpacity
            style={styles.createButton}
            onPress={handleCreateEvent}
            activeOpacity={0.8}
          >
            <Ionicons name="add-circle-outline" size={16} color={colors.textInverse} />
            <Text style={styles.createButtonText}>{t('date_suggest.create_event')}</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: {
      marginHorizontal: spacing[4],
      marginTop: spacing[3],
      backgroundColor: colors.surface,
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing[4],
      gap: spacing[3],
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[1.5],
    },
    title: {
      ...textStyles.label,
      color: colors.primary,
      fontWeight: '600',
    },
    loadingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[2],
    },
    loadingText: {
      ...textStyles.caption,
      color: colors.textTertiary,
    },
    emptyText: {
      ...textStyles.body,
      color: colors.textTertiary,
    },
    suggestion: {
      ...textStyles.body,
      color: colors.textPrimary,
      lineHeight: 22,
    },
    createButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing[1.5],
      backgroundColor: colors.primary,
      borderRadius: radius.full,
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[2],
      alignSelf: 'flex-start',
    },
    createButtonText: {
      ...textStyles.label,
      color: colors.textInverse,
    },
  });
}
