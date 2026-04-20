/**
 * TodayEventList — today's events widget for the Home tab.
 *
 * Reads from eventStore.eventsByDate[today].
 * Tapping an event navigates to the event detail screen.
 */

import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useEventStore } from '@/stores/eventStore';
import type { EventSummary } from '@/types';
import { light as colors, palette } from '@/constants/colors';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns today's date key (YYYY-MM-DD) in local time. */
function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Formats a Date as "HH:MM" (24h). */
function formatTime(date: Date): string {
  return date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

// ─── Event row ────────────────────────────────────────────────────────────────

interface EventRowProps {
  event: EventSummary;
  onPress: () => void;
}

function EventRow({ event, onPress }: EventRowProps) {
  const timeLabel = event.allDay
    ? '종일'
    : `${formatTime(event.startAt)} – ${formatTime(event.endAt)}`;

  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      {/* Color indicator strip */}
      <View style={[styles.colorBar, { backgroundColor: event.color ?? colors.primary }]} />

      <View style={styles.rowContent}>
        <Text style={styles.eventTitle} numberOfLines={1}>{event.title}</Text>
        <Text style={styles.eventTime}>{timeLabel}</Text>
      </View>

      {/* Shared indicator */}
      {!event.isOwn && (
        <View style={styles.sharedBadge}>
          <Text style={styles.sharedBadgeText}>공유</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TodayEventList() {
  const router       = useRouter();
  const eventsByDate = useEventStore(s => s.eventsByDate);

  const todayEvents  = eventsByDate[todayKey()] ?? [];
  const sortedEvents = [...todayEvents].sort(
    (a, b) => a.startAt.getTime() - b.startAt.getTime(),
  );

  return (
    <View style={styles.container}>
      {/* Section header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>📅 오늘 일정</Text>
        <Text style={styles.headerCount}>
          {sortedEvents.length > 0 ? `${sortedEvents.length}개` : ''}
        </Text>
      </View>

      {sortedEvents.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>오늘 일정이 없습니다</Text>
        </View>
      ) : (
        <ScrollView
          horizontal={false}
          scrollEnabled={false}  // parent ScrollView handles vertical scroll
          nestedScrollEnabled={false}
        >
          {sortedEvents.map(event => (
            <EventRow
              key={event.id}
              event={event}
              onPress={() => router.push(`/event/${event.id}`)}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    marginHorizontal: spacing[4],
    marginBottom:     spacing[4],
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
  headerCount: {
    ...textStyles.caption,
    color: colors.textTertiary,
  },
  row: {
    flexDirection:    'row',
    alignItems:       'center',
    backgroundColor:  colors.surface,
    borderRadius:     radius.md,
    borderWidth:      1,
    borderColor:      colors.border,
    marginBottom:     spacing[2],
    overflow:         'hidden',
  },
  colorBar: {
    width:  4,
    alignSelf: 'stretch',
  },
  rowContent: {
    flex:            1,
    paddingVertical: spacing[2],
    paddingLeft:     spacing[3],
    paddingRight:    spacing[2],
  },
  eventTitle: {
    ...textStyles.labelLg,
    color: colors.textPrimary,
  },
  eventTime: {
    ...textStyles.caption,
    color:     colors.textSecondary,
    marginTop: spacing[0.5],
  },
  sharedBadge: {
    backgroundColor: palette.violet100,
    borderRadius:    radius.sm,
    paddingVertical:   spacing[0.5],
    paddingHorizontal: spacing[1.5],
    marginRight:       spacing[2],
  },
  sharedBadgeText: {
    ...textStyles.labelSm,
    color: colors.primary,
  },
  emptyContainer: {
    paddingVertical: spacing[3],
    alignItems:      'center',
  },
  emptyText: {
    ...textStyles.bodySm,
    color: colors.textTertiary,
  },
});
