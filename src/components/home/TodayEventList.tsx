/**
 * TodayEventList — today's events widget for the Home tab.
 *
 * Reads from eventStore.eventsByDate[today].
 * Tapping an event navigates to the event detail screen.
 *
 * TASK-600 (Sprint 6): 다크모드 대응 — makeStyles(colors) 패턴으로 교체
 */

import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useEventStore } from '@/stores/eventStore';
import type { EventSummary } from '@/types';
import { useColors } from '@/hooks/useColors';
import type { ColorTokens } from '@/hooks/useColors';
import { palette } from '@/constants/colors';
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
  colors: ColorTokens;
  styles: ReturnType<typeof makeStyles>;
}

function EventRow({ event, onPress, colors, styles }: EventRowProps) {
  const { t } = useTranslation();
  const timeLabel = event.allDay
    ? t('time.all_day')
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
  const { t } = useTranslation();
  const colors = useColors();
  const styles = makeStyles(colors);
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
        <Text style={styles.headerTitle}>{t('event.today_list_title')}</Text>
        <Text style={styles.headerCount}>
          {sortedEvents.length > 0 ? `${sortedEvents.length}개` : ''}
        </Text>
      </View>

      {sortedEvents.length === 0 ? (
        <Pressable
          style={styles.emptyContainer}
          onPress={() => router.push('/event/create')}
          accessibilityRole="button"
          accessibilityLabel={t('event.add')}
        >
          <Ionicons name="calendar-outline" size={28} color={colors.textTertiary} />
          <Text style={styles.emptyText}>{t('event.today_empty')}</Text>
          <View style={styles.emptyAddRow}>
            <Ionicons name="add-circle-outline" size={16} color={colors.primary} />
            <Text style={styles.emptyAddText}>{t('event.add')}</Text>
          </View>
        </Pressable>
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
              colors={colors}
              styles={styles}
            />
          ))}
        </ScrollView>
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
      paddingVertical:   spacing[5],
      alignItems:        'center',
      gap:               spacing[2],
      backgroundColor:   colors.surface,
      borderRadius:      radius.md,
      borderWidth:       1,
      borderColor:       colors.border,
      borderStyle:       'dashed',
    },
    emptyText: {
      ...textStyles.bodySm,
      color: colors.textTertiary,
    },
    emptyAddRow: {
      flexDirection:  'row',
      alignItems:     'center',
      gap:            spacing[1],
      marginTop:      spacing[1],
    },
    emptyAddText: {
      ...textStyles.labelSm,
      color: colors.primary,
    },
  });
}
