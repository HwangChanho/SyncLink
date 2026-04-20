/**
 * Event detail screen — displays a single event's full information.
 *
 * Features:
 *  - Loads event via getEventById (TASK-201)
 *  - Shows title, date/time, location, description, repeat, shared spaces
 *  - Owner only: Edit (→ /event/edit/[id]) and Delete buttons
 *  - Share toggle per space (owner only)
 *
 * Presented as a stack modal from the calendar tab.
 * Route: /event/[id]
 */

import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, Pressable, ActivityIndicator,
  Alert, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { Event } from '@/types';
import { getEventById, deleteEvent } from '@/services/eventService';
import { shareEventToSpace, unshareEventFromSpace } from '@/services/eventShareService';
import { useEventStore } from '@/stores/eventStore';
import { useSpaceStore } from '@/stores/spaceStore';
import { light as colors } from '@/constants/colors';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Korean weekday abbreviations. */
const KO_WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'] as const;

/**
 * Format a Date to a human-readable Korean date+time string.
 * e.g. "2026년 4월 18일 (토) 오전 9:00"
 */
function formatDateTime(date: Date, allDay: boolean): string {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const wd = KO_WEEKDAY[date.getDay()] ?? '';
  if (allDay) return `${y}년 ${m}월 ${d}일 (${wd})`;
  const h = date.getHours();
  const min = String(date.getMinutes()).padStart(2, '0');
  const ampm = h < 12 ? '오전' : '오후';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${y}년 ${m}월 ${d}일 (${wd}) ${ampm} ${h12}:${min}`;
}

/** Maps RepeatType to Korean label. */
const REPEAT_LABELS: Record<string, string> = {
  none: '반복 없음',
  daily: '매일',
  weekly: '매주',
  monthly: '매월',
  yearly: '매년',
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function EventDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { removeEvent } = useEventStore();
  const { spaces } = useSpaceStore();

  const [event, setEvent] = useState<Event | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  /** Tracks which space share toggles are currently saving. */
  const [sharingInFlight, setSharingInFlight] = useState<Set<string>>(new Set());

  // ── Load event ─────────────────────────────────────────────────────────────

  const loadEvent = useCallback(async () => {
    if (!id) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await getEventById(id);
      setEvent(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '일정을 불러오지 못했습니다.');
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => { void loadEvent(); }, [loadEvent]);

  // ── Delete ─────────────────────────────────────────────────────────────────

  const handleDelete = useCallback(() => {
    if (!event) return;
    Alert.alert(
      '일정 삭제',
      `"${event.title}" 일정을 삭제하시겠습니까?`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '삭제',
          style: 'destructive',
          onPress: async () => {
            setIsDeleting(true);
            try {
              await deleteEvent(event.id);
              // Remove from store so calendar reflects the deletion immediately
              removeEvent(event.id);
              router.back();
            } catch (err) {
              Alert.alert(
                '삭제 실패',
                err instanceof Error ? err.message : '삭제 중 오류가 발생했습니다.',
              );
              setIsDeleting(false);
            }
          },
        },
      ],
    );
  }, [event, removeEvent, router]);

  // ── Share toggle ────────────────────────────────────────────────────────────

  /**
   * Toggle sharing of this event to a space.
   * Optimistically updates local state; reverts on error.
   */
  const handleShareToggle = useCallback(async (spaceId: string) => {
    if (!event) return;
    const isCurrentlyShared = event.sharedSpaceIds.includes(spaceId);

    // Prevent duplicate taps
    if (sharingInFlight.has(spaceId)) return;
    setSharingInFlight((prev) => new Set([...prev, spaceId]));

    // Optimistic update
    setEvent((prev) => {
      if (!prev) return prev;
      const sharedSpaceIds = isCurrentlyShared
        ? prev.sharedSpaceIds.filter((sid) => sid !== spaceId)
        : [...prev.sharedSpaceIds, spaceId];
      return { ...prev, sharedSpaceIds };
    });

    try {
      if (isCurrentlyShared) {
        await unshareEventFromSpace(event.id, spaceId);
      } else {
        await shareEventToSpace(event.id, spaceId);
      }
    } catch (err) {
      // Revert optimistic update
      setEvent((prev) => {
        if (!prev) return prev;
        const sharedSpaceIds = isCurrentlyShared
          ? [...prev.sharedSpaceIds, spaceId]
          : prev.sharedSpaceIds.filter((sid) => sid !== spaceId);
        return { ...prev, sharedSpaceIds };
      });
      Alert.alert('오류', err instanceof Error ? err.message : '공유 설정 변경에 실패했습니다.');
    } finally {
      setSharingInFlight((prev) => {
        const next = new Set(prev);
        next.delete(spaceId);
        return next;
      });
    }
  }, [event, sharingInFlight]);

  // ── Render states ───────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  if (error || !event) {
    return (
      <SafeAreaView style={styles.centered}>
        <Text style={styles.errorText}>{error ?? '일정을 찾을 수 없습니다.'}</Text>
        <Pressable style={styles.retryButton} onPress={() => void loadEvent()}>
          <Text style={styles.retryText}>다시 시도</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  // ── Main render ─────────────────────────────────────────────────────────────

  const startLabel = formatDateTime(event.startAt, event.allDay);
  const endLabel   = formatDateTime(event.endAt, event.allDay);
  const isSameDay  =
    event.startAt.toDateString() === event.endAt.toDateString();
  const repeatLabel = REPEAT_LABELS[event.repeatType] ?? event.repeatType;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      {/* ── Header bar ── */}
      <View style={styles.headerBar}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>{event.title}</Text>
        {/* Only the owner can edit */}
        {event.isOwn && (
          <Pressable
            style={styles.editButton}
            onPress={() => router.push(`/event/edit/${event.id}`)}
          >
            <Ionicons name="pencil-outline" size={20} color={colors.primary} />
          </Pressable>
        )}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Color stripe + title */}
        <View style={[styles.colorStripe, { backgroundColor: event.color ?? colors.primary }]} />
        <Text style={styles.title}>{event.title}</Text>
        {!event.isOwn && (
          <Text style={styles.ownerLabel}>by {event.ownerNickname}</Text>
        )}

        {/* Date / Time */}
        <View style={styles.section}>
          <Ionicons name="calendar-outline" size={18} color={colors.textSecondary} />
          <View style={styles.sectionText}>
            <Text style={styles.sectionPrimary}>{startLabel}</Text>
            {/* Show end only if it differs (multi-day or specific end time) */}
            {!isSameDay && (
              <Text style={styles.sectionSecondary}>~ {endLabel}</Text>
            )}
            {isSameDay && !event.allDay && (
              <Text style={styles.sectionSecondary}>
                ~ {formatDateTime(event.endAt, false).split(' ').slice(-2).join(' ')}
              </Text>
            )}
          </View>
        </View>

        {/* Repeat */}
        {event.repeatType !== 'none' && (
          <View style={styles.section}>
            <Ionicons name="repeat-outline" size={18} color={colors.textSecondary} />
            <View style={styles.sectionText}>
              <Text style={styles.sectionPrimary}>{repeatLabel}</Text>
              {event.repeatUntil && (
                <Text style={styles.sectionSecondary}>
                  {event.repeatUntil.getFullYear()}년{' '}
                  {event.repeatUntil.getMonth() + 1}월{' '}
                  {event.repeatUntil.getDate()}일까지
                </Text>
              )}
            </View>
          </View>
        )}

        {/* Location */}
        {event.location ? (
          <View style={styles.section}>
            <Ionicons name="location-outline" size={18} color={colors.textSecondary} />
            <Text style={[styles.sectionPrimary, styles.sectionText]}>{event.location}</Text>
          </View>
        ) : null}

        {/* Description */}
        {event.description ? (
          <View style={styles.section}>
            <Ionicons name="document-text-outline" size={18} color={colors.textSecondary} />
            <Text style={[styles.sectionPrimary, styles.sectionText]}>{event.description}</Text>
          </View>
        ) : null}

        {/* Space sharing — only owner can toggle */}
        {event.isOwn && spaces.length > 0 && (
          <View style={styles.sharingSection}>
            <Text style={styles.sharingTitle}>공유 중인 Space</Text>
            {spaces.map((space) => {
              const shared = event.sharedSpaceIds.includes(space.id);
              const inFlight = sharingInFlight.has(space.id);
              return (
                <Pressable
                  key={space.id}
                  style={styles.spaceRow}
                  onPress={() => void handleShareToggle(space.id)}
                  disabled={inFlight}
                >
                  <Text style={styles.spaceName}>{space.name}</Text>
                  {inFlight ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <Ionicons
                      name={shared ? 'checkmark-circle' : 'ellipse-outline'}
                      size={22}
                      color={shared ? colors.primary : colors.border}
                    />
                  )}
                </Pressable>
              );
            })}
          </View>
        )}

        {/* Delete button — owner only */}
        {event.isOwn && (
          <Pressable
            style={styles.deleteButton}
            onPress={handleDelete}
            disabled={isDeleting}
          >
            {isDeleting ? (
              <ActivityIndicator size="small" color={colors.error} />
            ) : (
              <Text style={styles.deleteText}>일정 삭제</Text>
            )}
          </Pressable>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing[6],
  },
  errorText: {
    ...textStyles.body,
    color: colors.error,
    textAlign: 'center',
    marginBottom: spacing[4],
  },
  retryButton: {
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[4],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  retryText: {
    ...textStyles.label,
    color: colors.primary,
  },

  // Header bar
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 56,
    paddingHorizontal: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  backButton: {
    padding: spacing[1],
    marginRight: spacing[2],
  },
  headerTitle: {
    ...textStyles.labelLg,
    color: colors.textPrimary,
    flex: 1,
  },
  editButton: {
    padding: spacing[1],
    marginLeft: spacing[2],
  },

  // Scroll content
  scroll: { flex: 1 },
  scrollContent: {
    padding: spacing[5],
    paddingBottom: spacing[10],
  },

  // Color stripe
  colorStripe: {
    height: 4,
    borderRadius: radius.sm,
    marginBottom: spacing[4],
  },

  // Title
  title: {
    ...textStyles.h2,
    color: colors.textPrimary,
    marginBottom: spacing[1],
  },
  ownerLabel: {
    ...textStyles.caption,
    color: colors.textSecondary,
    marginBottom: spacing[4],
  },

  // Detail rows
  section: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[3],
    paddingVertical: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  sectionText: {
    flex: 1,
  },
  sectionPrimary: {
    ...textStyles.body,
    color: colors.textPrimary,
  },
  sectionSecondary: {
    ...textStyles.bodySm,
    color: colors.textSecondary,
    marginTop: spacing[0.5],
  },

  // Sharing section
  sharingSection: {
    marginTop: spacing[6],
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing[4],
  },
  sharingTitle: {
    ...textStyles.label,
    color: colors.textSecondary,
    marginBottom: spacing[3],
  },
  spaceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  spaceName: {
    ...textStyles.body,
    color: colors.textPrimary,
    flex: 1,
    marginRight: spacing[2],
  },

  // Delete button
  deleteButton: {
    marginTop: spacing[8],
    paddingVertical: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.error,
    alignItems: 'center',
  },
  deleteText: {
    ...textStyles.label,
    color: colors.error,
  },
});
