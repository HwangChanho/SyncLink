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
import { subscribeToSharedEvents } from '@/services/eventRealtimeService';
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

/** Generates a human-readable activity label. */
function activityLabel(item: ActivityItem): string {
  switch (item.type) {
    case 'shared':  return `"${item.event.title}" 일정이 공유되었습니다`;
    case 'updated': return `"${item.event.title}" 일정이 수정되었습니다`;
    case 'removed': return `"${item.event.title}" 일정 공유가 취소되었습니다`;
  }
}

/** Formats timestamp as relative string (방금, N분 전, etc.) */
function formatRelative(date: Date): string {
  const diffMs  = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1)  return '방금';
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24)  return `${diffHr}시간 전`;
  return `${Math.floor(diffHr / 24)}일 전`;
}

// ─── Component ────────────────────────────────────────────────────────────────

/** Maximum number of activity items to show in the feed. */
const MAX_ITEMS = 10;

export function SpaceActivityFeed() {
  const colors = useColors();
  const styles = makeStyles(colors);
  const router = useRouter();
  const [activities, setActivities] = useState<ActivityItem[]>([]);

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
          title:   '알 수 없는 일정',
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
  }, [addActivity, colors.border]);

  return (
    <View style={styles.container}>
      {/* Section header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>👥 Space 활동</Text>
        <View style={styles.liveIndicator}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>실시간</Text>
        </View>
      </View>

      {activities.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>최근 Space 활동이 없습니다</Text>
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
                  {activityLabel(item)}
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
      backgroundColor: '#22C55E', // green — live
    },
    liveText: {
      ...textStyles.caption,
      color: '#22C55E',
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
