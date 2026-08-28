/**
 * SpaceActivityFeed — real-time space member activity widget for the Home tab.
 *
 * Subscribes to event_shares changes via eventRealtimeService.
 * Shows a feed of recent events shared/updated by space members.
 * Tapping an activity item navigates to the event detail screen.
 *
 * Manages its own Realtime subscription (self-contained).
 *
 * TASK-600 (Sprint 6): 다크모드 대응 — makeStyles(colors) 패턴으로 교체
 */

import { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { subscribeToSharedEvents } from '@/services/eventRealtimeService';
import { useSpaceStore } from '@/stores/spaceStore';
import type { EventSummary } from '@/types';
import { useColors } from '@/hooks/useColors';
import type { ColorTokens } from '@/hooks/useColors';
import { spacing, radius } from '@/constants/spacing';
import { textStyles, fontSize } from '@/constants/typography';

// ─── Types ────────────────────────────────────────────────────────────────────

type ActivityType = 'shared' | 'updated' | 'removed';

interface ActivityItem {
  /** Unique key for the list. */
  id: string;
  type: ActivityType;
  event: EventSummary;
  timestamp: Date;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Generates a human-readable activity label using i18n. */
function useActivityLabel() {
  const { t } = useTranslation();
  return (item: ActivityItem): string => {
    switch (item.type) {
      case 'shared':  return t('space.activity_shared',  { title: item.event.title });
      case 'updated': return t('space.activity_updated', { title: item.event.title });
      case 'removed': return t('space.activity_removed', { title: item.event.title });
    }
  };
}

/**
 * Hook returning a locale-aware "relative time" formatter.
 * The thresholds match Apple/Google Calendar feeds: 방금 (<1min) → N분 전
 * (<1h) → N시간 전 (<1d) → N일 전. i18n keys live under `space.relative_*`
 * so en/ja/zh degrade gracefully (e.g. "5 min ago", "5 分前").
 */
function useRelativeTimeFormatter(): (date: Date) => string {
  const { t } = useTranslation();
  return (date: Date): string => {
    const diffMs  = Date.now() - date.getTime();
    const diffMin = Math.floor(diffMs / 60_000);
    if (diffMin < 1)  return t('space.relative_just_now');
    if (diffMin < 60) return t('space.relative_minutes_ago', { count: diffMin });
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24)  return t('space.relative_hours_ago', { count: diffHr });
    return t('space.relative_days_ago', { count: Math.floor(diffHr / 24) });
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

/** Maximum number of activity items to show in the feed. */
const MAX_ITEMS = 10;

export function SpaceActivityFeed() {
  const { t } = useTranslation();
  const colors = useColors();
  const styles = makeStyles(colors);
  const router = useRouter();
  // 2026-08-28 UX 단순화 — Space 가 하나도 없으면 이 피드는 영구히 "활동 없음"
  // 빈 상태만 보여주며 홈 한 칸을 차지한다(실사용 Space 가입자 2명).
  // 기능을 없앤 게 아니라 **빈 껍데기를 숨기는 것**이다. Space 에 들어가면 즉시 돌아온다.
  const spaces = useSpaceStore((s) => s.spaces);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const getActivityLabel = useActivityLabel();
  const formatRelative = useRelativeTimeFormatter();

  // ── Add item to feed (newest first, capped at MAX_ITEMS) ──────────────────
  const addActivity = useCallback((
    type: ActivityType,
    event: EventSummary,
  ) => {
    setActivities(prev => {
      const item: ActivityItem = {
        id:        `${type}-${event.id}-${Date.now()}`,
        type,
        event,
        timestamp: new Date(),
      };
      return [item, ...prev].slice(0, MAX_ITEMS);
    });
  }, []);

  // ── Subscribe to realtime space events ────────────────────────────────────
  useEffect(() => {
    const unsubscribe = subscribeToSharedEvents(
      (event) => addActivity('shared',  event),
      (event) => addActivity('updated', event),
      // For removed events, create a minimal EventSummary with just the ID
      (eventId) => {
        const stub: EventSummary = {
          id:      eventId,
          title:   t('event.unknown'),
          startAt: new Date(),
          endAt:   new Date(),
          allDay:  false,
          color:   colors.border,
          isOwn:   false,
        };
        addActivity('removed', stub);
      },
    );
    return unsubscribe;
  }, [addActivity, colors.border, t]);

  // 훅을 모두 호출한 뒤에 판단한다 — 훅 순서가 렌더마다 달라지면 안 된다.
  if (spaces.length === 0) return null;

  return (
    <View style={styles.container}>
      {/* Section header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t('space.activity_notification')}</Text>
        <View style={styles.liveIndicator}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>{t('space.live')}</Text>
        </View>
      </View>

      {activities.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>{t('space.activity_empty')}</Text>
        </View>
      ) : (
        <View style={styles.list}>
          {activities.map(item => (
            <TouchableOpacity
              key={item.id}
              style={styles.activityRow}
              onPress={() => {
                // Only navigate for active events (not 'removed')
                if (item.type !== 'removed') {
                  router.push(`/event/${item.event.id}`);
                }
              }}
              activeOpacity={item.type === 'removed' ? 1 : 0.7}
            >
              {/* Color dot */}
              <View
                style={[
                  styles.colorDot,
                  { backgroundColor: item.event.color ?? colors.primary },
                ]}
              />

              <View style={styles.activityContent}>
                <Text style={styles.activityLabel} numberOfLines={2}>
                  {getActivityLabel(item)}
                </Text>
                <Text style={styles.activityTime}>
                  {formatRelative(item.timestamp)}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
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
      marginHorizontal: spacing[4],
      marginBottom:     spacing[6],
    },
    header: {
      flexDirection:  'row',
      justifyContent: 'space-between',
      alignItems:     'center',
      marginBottom:   spacing[2],
    },
    headerTitle: {
      ...textStyles.h4,
      color: colors.textPrimary,
    },
    liveIndicator: {
      flexDirection: 'row',
      alignItems:    'center',
      gap:           spacing[1],
    },
    liveDot: {
      width:           6,
      height:          6,
      borderRadius:    3,
      // success token: green-500 in light, green-400 in dark — semantic live indicator
      backgroundColor: colors.success,
    },
    liveText: {
      ...textStyles.caption,
      color: colors.success,
    },
    emptyContainer: {
      paddingVertical: spacing[3],
      alignItems:      'center',
    },
    emptyText: {
      ...textStyles.bodySm,
      color: colors.textTertiary,
    },
    list: {
      backgroundColor: colors.surface,
      borderRadius:    radius.md,
      borderWidth:     1,
      borderColor:     colors.border,
      overflow:        'hidden',
    },
    activityRow: {
      flexDirection:  'row',
      alignItems:     'center',
      padding:        spacing[3],
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    colorDot: {
      width:        10,
      height:       10,
      borderRadius: 5,
      marginRight:  spacing[3],
      flexShrink:   0,
    },
    activityContent: {
      flex: 1,
    },
    activityLabel: {
      fontSize:   fontSize.sm,
      color:      colors.textPrimary,
      lineHeight: fontSize.sm * 1.4,
    },
    activityTime: {
      ...textStyles.caption,
      color:     colors.textTertiary,
      marginTop: spacing[0.5],
    },
  });
}
