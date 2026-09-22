/**
 * TodayEventList — today's events widget for the Home tab.
 *
 * Reads from eventStore.eventsByDate[today].
 * Tapping an event navigates to the event detail screen.
 *
 * TASK-600 (Sprint 6): 다크모드 대응 — makeStyles(colors) 패턴으로 교체
 */

import { View, TouchableOpacity, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useRequireAuth } from '@/hooks/useRequireAuth';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useEventStore } from '@/stores/eventStore';
import type { EventSummary } from '@/types';
import { useColors } from '@/hooks/useColors';
import type { ColorTokens } from '@/hooks/useColors';
// palette 직접 import 를 걷어냈다 — 아래 sharedBadge 가 마지막 사용처였고,
// 고정 violet 을 쓰는 바람에 사용자가 테마 색을 바꿔도 그 배지만 보라로 남았다.
import { spacing, radius, elevation } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import { DDayBadge } from '@/components/event/DDayBadge';
import { Text } from '@/components/common/AppText';

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
        {/* v1.3 — 상대일 일정이면 D-day 배지 (라벨 + D-N). */}
        {event.baseDate ? <DDayBadge target={event.startAt} label={event.offsetLabel ?? null} /> : null}
      </View>

      {/* Shared indicator */}
      {!event.isOwn && (
        <View style={styles.sharedBadge}>
          <Text style={styles.sharedBadgeText}>{t('space.shared_badge')}</Text>
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
  const requireAuth  = useRequireAuth();
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
          {sortedEvents.length > 0 ? t('event.event_count', { count: sortedEvents.length }) : ''}
        </Text>
      </View>

      {sortedEvents.length === 0 ? (
        <Pressable
          style={styles.emptyContainer}
          onPress={() => requireAuth(() => router.push('/event/create'), 'event_create')}
          accessibilityRole="button"
          accessibilityLabel={t('event.add')}
        >
          <Ionicons name="calendar-outline" size={32} color={colors.textTertiary} />
          <Text style={styles.emptyText}>{t('event.today_empty')}</Text>
          <View style={styles.emptyAddRow}>
            <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
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
              onPress={() => requireAuth(() => router.push(`/event/${event.id}`), 'event_detail')}
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
      borderRadius:     radius.lg,
      borderWidth:      1,
      borderColor:      colors.border,
      marginBottom:     spacing[2],
      overflow:         'hidden',
      ...elevation[1],
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
      backgroundColor: colors.primaryLight,
      borderRadius:    radius.sm,
      paddingVertical:   spacing[0.5],
      paddingHorizontal: spacing[1.5],
      marginRight:       spacing[2],
    },
    sharedBadgeText: {
      ...textStyles.labelSm,
      color: colors.primary,
    },
    /**
     * 빈 상태 — 2026-09-20 레이아웃 개편.
     *
     * 이전에는 **점선 테두리**였다. 점선은 "아직 안 만들어진 자리"로 읽혀서,
     * 신규 사용자가 앱에서 처음 보는 화면이 미완성처럼 보였다.
     * 실선 + 카드와 같은 깊이로 바꿔 "지금 누를 수 있는 것"으로 만든다.
     */
    emptyContainer: {
      paddingVertical:   spacing[7],
      paddingHorizontal: spacing[4],
      alignItems:        'center',
      gap:               spacing[2],
      backgroundColor:   colors.surface,
      borderRadius:      radius.lg,
      borderWidth:       1,
      borderColor:       colors.border,
      ...elevation[1],
    },
    emptyText: {
      ...textStyles.body,
      color: colors.textSecondary,
    },
    /**
     * 다음 행동. 이전에는 작은 텍스트 링크라 눈에 걸리지 않았다 —
     * 빈 화면에서 유일하게 할 수 있는 일이므로 버튼 모양을 준다.
     */
    emptyAddRow: {
      flexDirection:     'row',
      alignItems:        'center',
      gap:               spacing[1],
      marginTop:         spacing[2],
      paddingVertical:   spacing[2],
      paddingHorizontal: spacing[4],
      borderRadius:      radius.full,
      backgroundColor:   colors.primaryLight,
    },
    emptyAddText: {
      ...textStyles.label,
      color: colors.primary,
    },
  });
}
