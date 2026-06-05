/**
 * UpcomingEventsCard — shows the next few events beyond today on the Home tab.
 *
 * Reads from eventStore.eventsByDate for tomorrow through the next 6 days.
 * Only renders when there is at least one upcoming event. Tapping an event
 * navigates to its detail screen.
 */

import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useEventStore } from '@/stores/eventStore';
import type { EventSummary } from '@/types';
import { useColors } from '@/hooks/useColors';
import type { ColorTokens } from '@/hooks/useColors';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DAYS_AHEAD   = 6;   // look this many days into the future
const MAX_EVENTS   = 5;   // cap list length for compact display

/** Returns a YYYY-MM-DD key for the given Date in local time. */
function localDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Adds `days` calendar days to `date`, returning a new Date at midnight local time. */
function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  d.setHours(0, 0, 0, 0);
  return d;
}

interface UpcomingEvent extends EventSummary {
  dateKey: string;
}

// ─── Sub-component ────────────────────────────────────────────────────────────

interface EventRowProps {
  event: UpcomingEvent;
  dateLabel: string;
  onPress: () => void;
  colors: ColorTokens;
  styles: ReturnType<typeof makeStyles>;
}

function UpcomingRow({ event, dateLabel, onPress, colors, styles }: EventRowProps) {
  const { t } = useTranslation();
  const timeLabel = event.allDay
    ? t('time.all_day')
    : event.startAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={[styles.colorBar, { backgroundColor: event.color ?? colors.primary }]} />
      <View style={styles.rowContent}>
        <Text style={styles.eventTitle} numberOfLines={1}>{event.title}</Text>
        <Text style={styles.eventMeta}>{dateLabel} · {timeLabel}</Text>
      </View>
      <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
    </TouchableOpacity>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function UpcomingEventsCard() {
  const { t, i18n } = useTranslation();
  const colors       = useColors();
  const styles       = makeStyles(colors);
  const router       = useRouter();
  const requireAuth  = useRequireAuth();
  const eventsByDate = useEventStore(s => s.eventsByDate);

  // Collect events from tomorrow through DAYS_AHEAD days ahead
  const today    = new Date();
  today.setHours(0, 0, 0, 0);

  const upcoming: UpcomingEvent[] = [];
  for (let i = 1; i <= DAYS_AHEAD; i++) {
    const day     = addDays(today, i);
    const dateKey = localDateKey(day);
    const events  = eventsByDate[dateKey] ?? [];
    for (const ev of events) {
      upcoming.push({ ...ev, dateKey });
    }
  }

  // Sort by startAt, cap at MAX_EVENTS
  upcoming.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  const visible = upcoming.slice(0, MAX_EVENTS);

  // Don't render the card if there's nothing to show
  if (visible.length === 0) return null;

  /** Format date key as locale-friendly relative label (내일, 모레, or full date). */
  function dateLabel(dateKey: string): string {
    const daysDiff = Math.round(
      (new Date(dateKey).getTime() - today.getTime()) / 86_400_000,
    );
    if (daysDiff === 1) return t('time.tomorrow');
    // Locale-aware short date (Apr 22 / 4월 22일 / etc.)
    return new Intl.DateTimeFormat(i18n.language === 'ko' ? 'ko-KR' : i18n.language, {
      month: 'short',
      day:   'numeric',
    }).format(new Date(dateKey + 'T00:00:00'));
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t('event.upcoming')}</Text>
        <Text style={styles.headerCount}>
          {t('event.event_count', { count: visible.length })}
        </Text>
      </View>

      <View style={styles.list}>
        {visible.map(event => (
          <UpcomingRow
            key={event.id}
            event={event}
            dateLabel={dateLabel(event.dateKey)}
            onPress={() => requireAuth(() => router.push(`/event/${event.id}`))}
            colors={colors}
            styles={styles}
          />
        ))}
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

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
    list: {
      backgroundColor: colors.surface,
      borderRadius:    radius.md,
      borderWidth:     1,
      borderColor:     colors.border,
      overflow:        'hidden',
    },
    row: {
      flexDirection:     'row',
      alignItems:        'center',
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      overflow:          'hidden',
    },
    colorBar: {
      width:     4,
      alignSelf: 'stretch',
    },
    rowContent: {
      flex:            1,
      paddingVertical: spacing[2.5],
      paddingLeft:     spacing[3],
      paddingRight:    spacing[1],
    },
    eventTitle: {
      ...textStyles.label,
      color: colors.textPrimary,
    },
    eventMeta: {
      ...textStyles.caption,
      color:     colors.textSecondary,
      marginTop: 2,
    },
  });
}
