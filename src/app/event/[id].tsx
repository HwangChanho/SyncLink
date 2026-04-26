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

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, Pressable, ActivityIndicator,
  Alert, StyleSheet, TextInput, KeyboardAvoidingView, Platform,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import type { Event, EventComment, ReactionSummary } from '@/types';
import { getEventById, deleteEvent } from '@/services/eventService';
import { shareEventToSpace, unshareEventFromSpace } from '@/services/eventShareService';
import {
  getReactionSummaries,
  toggleReaction,
  getComments,
  addComment,
  deleteComment,
  subscribeToEventInteractions,
  REACTION_EMOJIS,
} from '@/services/eventInteractionService';
import type { ReactionEmoji } from '@/types';
import { useEventStore } from '@/stores/eventStore';
import { useSpaceStore } from '@/stores/spaceStore';
import { useAuthStore } from '@/stores/authStore';
import { useColors } from '@/hooks/useColors';
import { useEventTranslation } from '@/hooks/useEventTranslation';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Korean weekday abbreviations (static fallback; i18n used in component). */
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

// Repeat labels are now built inside the component using i18n.

// ─── Component ────────────────────────────────────────────────────────────────

export default function EventDetailScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const styles = makeStyles(colors);
  const { id } = useLocalSearchParams<{ id: string }>();

  /** Maps RepeatType to translated label. */
  const REPEAT_LABELS: Record<string, string> = {
    none:    t('time.no_repeat'),
    daily:   t('time.daily'),
    weekly:  t('time.weekly'),
    monthly: t('time.monthly'),
    yearly:  t('time.annual'),
  };
  const router = useRouter();
  const { removeEvent } = useEventStore();
  const { spaces } = useSpaceStore();
  const { user } = useAuthStore();

  const [event, setEvent] = useState<Event | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  /**
   * When true the user has tapped "Show original" — we render the raw event
   * fields instead of the AI translation. Default is false so Pro users see
   * the translated version first when one is available.
   * Sprint 15 TASK-1503.
   */
  const [showOriginal, setShowOriginal] = useState(false);
  /** Tracks which space share toggles are currently saving. */
  const [sharingInFlight, setSharingInFlight] = useState<Set<string>>(new Set());

  // ── Reactions state ────────────────────────────────────────────────────────
  const [reactions, setReactions] = useState<ReactionSummary[]>([]);
  const [isTogglingReaction, setIsTogglingReaction] = useState<string | null>(null);

  // ── Comments state ─────────────────────────────────────────────────────────
  const [comments, setComments] = useState<EventComment[]>([]);
  const [commentInput, setCommentInput] = useState('');
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null);

  const commentInputRef = useRef<TextInput>(null);

  // ── Load event ─────────────────────────────────────────────────────────────

  const loadEvent = useCallback(async () => {
    if (!id) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await getEventById(id);
      setEvent(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('event.load_failed'));
    } finally {
      setIsLoading(false);
    }
  }, [id, t]);

  useEffect(() => { void loadEvent(); }, [loadEvent]);

  // ── Load reactions and comments (only for shared events) ─────────────────

  const loadReactions = useCallback(async () => {
    if (!id) return;
    try {
      const data = await getReactionSummaries(id);
      setReactions(data);
    } catch {
      // Non-critical: fail silently
    }
  }, [id]);

  const loadComments = useCallback(async () => {
    if (!id) return;
    try {
      const data = await getComments(id);
      setComments(data);
    } catch {
      // Non-critical: fail silently
    }
  }, [id]);

  // Subscribe to realtime reactions/comments updates
  useEffect(() => {
    if (!id || !event) return;
    // Only subscribe if the event has been shared to at least one space,
    // or if the current user is the owner (reactions work on own events too).
    const unsub = subscribeToEventInteractions(id, loadReactions, loadComments);
    return unsub;
  }, [id, event, loadReactions, loadComments]);

  // Load reactions & comments after event is loaded
  useEffect(() => {
    if (!event) return;
    void loadReactions();
    void loadComments();
  }, [event, loadReactions, loadComments]);

  // ── Reaction toggle ────────────────────────────────────────────────────────

  const handleToggleReaction = useCallback(async (emoji: ReactionEmoji) => {
    if (!id || isTogglingReaction) return;
    setIsTogglingReaction(emoji);
    try {
      await toggleReaction(id, emoji);
      await loadReactions();
    } catch (err) {
      Alert.alert(t('common.error'), err instanceof Error ? err.message : t('reaction.change_failed'));
    } finally {
      setIsTogglingReaction(null);
    }
  }, [id, isTogglingReaction, loadReactions, t]);

  // ── Comment submit ─────────────────────────────────────────────────────────

  const handleSubmitComment = useCallback(async () => {
    const trimmed = commentInput.trim();
    if (!trimmed || !id || isSubmittingComment) return;

    setIsSubmittingComment(true);
    try {
      const newComment = await addComment(id, trimmed);
      setComments(prev => [...prev, newComment]);
      setCommentInput('');
      commentInputRef.current?.blur();
    } catch (err) {
      Alert.alert(t('common.error'), err instanceof Error ? err.message : t('comment.write_failed'));
    } finally {
      setIsSubmittingComment(false);
    }
  }, [commentInput, id, isSubmittingComment, t]);

  // ── Comment delete ─────────────────────────────────────────────────────────

  const handleDeleteComment = useCallback((commentId: string) => {
    Alert.alert(
      t('comment.delete'),
      t('comment.delete_confirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            setDeletingCommentId(commentId);
            try {
              await deleteComment(commentId);
              setComments(prev => prev.filter(c => c.id !== commentId));
            } catch (err) {
              Alert.alert(t('common.error'), err instanceof Error ? err.message : t('comment.delete_failed'));
            } finally {
              setDeletingCommentId(null);
            }
          },
        },
      ],
    );
  }, [t]);

  // ── Delete ─────────────────────────────────────────────────────────────────

  const handleDelete = useCallback(() => {
    if (!event) return;
    Alert.alert(
      t('event.delete'),
      t('event.delete_confirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
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
                t('common.error'),
                err instanceof Error ? err.message : t('common.delete_failed'),
              );
              setIsDeleting(false);
            }
          },
        },
      ],
    );
  }, [event, removeEvent, router, t]);

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
      Alert.alert(t('common.error'), err instanceof Error ? err.message : t('share.update_failed'));
    } finally {
      setSharingInFlight((prev) => {
        const next = new Set(prev);
        next.delete(spaceId);
        return next;
      });
    }
  }, [event, sharingInFlight, t]);

  // Sprint 15 TASK-1503 — request an AI translation of the event for the
  // current UI locale. Must be called at the top level (before the early
  // returns below) so the hook invocation order stays stable across renders.
  // The hook itself short-circuits for free users, same-locale events, and
  // null input, so passing `event` (which is null until loaded) is safe.
  const translation = useEventTranslation(event);

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
        <Text style={styles.errorText}>{error ?? t('event.not_found')}</Text>
        <Pressable style={styles.retryButton} onPress={() => void loadEvent()}>
          <Text style={styles.retryText}>{t('common.retry')}</Text>
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

  // Sprint 15 TASK-1503 — render the translated title/description when a Pro
  // subscriber has a translation available and hasn't toggled "show original".
  // `translation.translated` is always null for free users, same-locale
  // events, or while a request is in-flight, so this falls back cleanly.
  const hasTranslation = translation.translated !== null;
  const showTranslation = hasTranslation && !showOriginal;
  const displayTitle       = showTranslation && translation.translated
    ? translation.translated.title
    : event.title;
  const displayDescription = showTranslation && translation.translated
    ? translation.translated.description
    : event.description;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      {/* ── Header bar ── */}
      <View style={styles.headerBar}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>{displayTitle}</Text>
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

      {/*
        Wrap the scrollable content AND the fixed comment input in a single
        KeyboardAvoidingView at the SafeArea level. Nesting KAV inside the
        ScrollView (the previous layout) prevented iOS from lifting the
        input because the KAV didn't see the scroll container's coordinates.
      */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Color stripe + title */}
        <View style={[styles.colorStripe, { backgroundColor: event.color ?? colors.primary }]} />
        <Text style={styles.title}>{displayTitle}</Text>

        {/*
          Sprint 15 TASK-1503 — "Translated · Show original" toggle.
          Only rendered when a translation is actually available (i.e. Pro
          user on a different locale than the event's source). Tapping flips
          between original and translated rendering without re-fetching.
        */}
        {hasTranslation && (
          <Pressable
            style={styles.translationBadge}
            onPress={() => setShowOriginal((prev) => !prev)}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Ionicons name="language-outline" size={14} color={colors.primary} />
            <Text style={styles.translationBadgeText}>
              {showOriginal
                ? t('translation.show_translated')
                : `${t('translation.badge_translated')} · ${t('translation.show_original')}`}
            </Text>
          </Pressable>
        )}

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
        {displayDescription ? (
          <View style={styles.section}>
            <Ionicons name="document-text-outline" size={18} color={colors.textSecondary} />
            <Text style={[styles.sectionPrimary, styles.sectionText]}>{displayDescription}</Text>
          </View>
        ) : null}

        {/* Space sharing — only owner can toggle */}
        {event.isOwn && spaces.length > 0 && (
          <View style={styles.sharingSection}>
            <Text style={styles.sharingTitle}>{t('space.activity_notification')}</Text>
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

        {/* ── Reactions bar (TASK-503) ──────────────────────────────── */}
        <View style={styles.reactionsSection}>
          <Text style={styles.reactionsSectionTitle}>{t('common.unknown')}</Text>
          <View style={styles.reactionsBar}>
            {/* Show existing reactions with counts */}
            {reactions.map(r => (
              <TouchableOpacity
                key={r.emoji}
                style={[
                  styles.reactionChip,
                  r.isMyReaction && styles.reactionChipActive,
                ]}
                onPress={() => { void handleToggleReaction(r.emoji); }}
                disabled={isTogglingReaction === r.emoji}
                activeOpacity={0.7}
              >
                <Text style={styles.reactionEmoji}>{r.emoji}</Text>
                <Text style={[
                  styles.reactionCount,
                  r.isMyReaction && styles.reactionCountActive,
                ]}>
                  {r.count}
                </Text>
              </TouchableOpacity>
            ))}

            {/* Add reaction buttons for emojis not yet used */}
            {REACTION_EMOJIS
              .filter(e => !reactions.some(r => r.emoji === e))
              .map(emoji => (
                <TouchableOpacity
                  key={emoji}
                  style={styles.reactionAddChip}
                  onPress={() => { void handleToggleReaction(emoji); }}
                  disabled={isTogglingReaction === emoji}
                  activeOpacity={0.7}
                >
                  <Text style={styles.reactionEmoji}>{emoji}</Text>
                </TouchableOpacity>
              ))
            }
          </View>
        </View>

        {/* ── Comments section (TASK-503) ───────────────────────────── */}
        <View style={styles.commentsSection}>
          <Text style={styles.commentsSectionTitle}>
            {t('note.label')} {comments.length > 0 ? `${comments.length}개` : ''}
          </Text>

          {/* Comment list */}
          {comments.map(comment => (
            <View key={comment.id} style={styles.commentRow}>
              {/* Author initial avatar */}
              <View style={styles.commentAvatar}>
                <Text style={styles.commentAvatarText}>
                  {comment.authorNickname.charAt(0).toUpperCase()}
                </Text>
              </View>

              <View style={styles.commentContent}>
                <View style={styles.commentHeader}>
                  <Text style={styles.commentAuthor}>{comment.authorNickname}</Text>
                  <Text style={styles.commentTime}>
                    {comment.createdAt.toLocaleDateString('ko-KR', {
                      month: 'short', day: 'numeric',
                    })}
                  </Text>
                </View>
                <Text style={styles.commentText}>{comment.content}</Text>
              </View>

              {/* Delete button (own comments only) */}
              {comment.userId === user?.id && (
                <TouchableOpacity
                  style={styles.commentDeleteButton}
                  onPress={() => handleDeleteComment(comment.id)}
                  disabled={deletingCommentId === comment.id}
                >
                  {deletingCommentId === comment.id ? (
                    <ActivityIndicator size="small" color={colors.textTertiary} />
                  ) : (
                    <Ionicons name="trash-outline" size={16} color={colors.textTertiary} />
                  )}
                </TouchableOpacity>
              )}
            </View>
          ))}

          {/*
            Comment input — sibling of the ScrollView inside the parent
            KeyboardAvoidingView so iOS can lift the whole layout when the
            keyboard appears. The previous nested KAV inside the scroll
            didn't have access to the correct coordinates.
          */}
          <View style={styles.commentInputRow}>
            <TextInput
              ref={commentInputRef}
              style={styles.commentInput}
              placeholder={t('note.label') + '...'}
              placeholderTextColor={colors.textPlaceholder}
              value={commentInput}
              onChangeText={setCommentInput}
              maxLength={500}
              multiline
              returnKeyType="default"
            />
            <TouchableOpacity
              style={[
                styles.commentSendButton,
                (!commentInput.trim() || isSubmittingComment) && styles.commentSendDisabled,
              ]}
              onPress={handleSubmitComment}
              disabled={!commentInput.trim() || isSubmittingComment}
              activeOpacity={0.7}
            >
              {isSubmittingComment ? (
                <ActivityIndicator size="small" color={colors.textInverse} />
              ) : (
                <Ionicons name="send" size={16} color={colors.textInverse} />
              )}
            </TouchableOpacity>
          </View>
        </View>

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
              <Text style={styles.deleteText}>{t('event.delete')}</Text>
            )}
          </Pressable>
        )}
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

/**
 * Dynamic styles factory — receives current theme color tokens.
 * Called inside the component to react to theme changes.
 *
 * @param colors - Active theme color tokens from useColors()
 */
function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
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
  flex: { flex: 1 },
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

  // Sprint 15 TASK-1503 — compact toggle shown under the title when an AI
  // translation is available. Laid out inline (flex row) to keep a light
  // visual footprint next to the title.
  translationBadge: {
    flexDirection:   'row',
    alignItems:      'center',
    gap:             spacing[1],
    alignSelf:       'flex-start',
    paddingHorizontal: spacing[2],
    paddingVertical:   spacing[1],
    marginBottom:    spacing[2],
    borderRadius:    radius.full,
    borderWidth:     1,
    borderColor:     colors.primaryLight,
    backgroundColor: colors.primaryLight,
  },
  translationBadgeText: {
    ...textStyles.caption,
    color: colors.primary,
    fontWeight: '600',
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

  // ── Reactions (TASK-503) ────────────────────────────────────────────────────
  reactionsSection: {
    marginTop: spacing[6],
    gap: spacing[2],
  },
  reactionsSectionTitle: {
    ...textStyles.label,
    color: colors.textSecondary,
  },
  reactionsBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2],
  },
  reactionChip: {
    flexDirection:   'row',
    alignItems:      'center',
    gap:             spacing[1],
    paddingHorizontal: spacing[3],
    paddingVertical:   spacing[1.5],
    borderRadius:    radius.full,
    borderWidth:     1,
    borderColor:     colors.border,
    backgroundColor: colors.surface,
  },
  reactionChipActive: {
    borderColor:     colors.primary,
    backgroundColor: colors.primaryLight,
  },
  reactionAddChip: {
    paddingHorizontal: spacing[2.5],
    paddingVertical:   spacing[1.5],
    borderRadius:    radius.full,
    borderWidth:     1,
    borderColor:     colors.border,
    borderStyle:     'dashed',
    backgroundColor: colors.surface,
  },
  reactionEmoji: {
    fontSize: 16,
  },
  reactionCount: {
    ...textStyles.caption,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  reactionCountActive: {
    color: colors.primary,
  },

  // ── Comments (TASK-503) ─────────────────────────────────────────────────────
  commentsSection: {
    marginTop: spacing[6],
    gap: spacing[3],
  },
  commentsSectionTitle: {
    ...textStyles.label,
    color: colors.textSecondary,
  },
  commentRow: {
    flexDirection: 'row',
    alignItems:    'flex-start',
    gap:           spacing[3],
  },
  commentAvatar: {
    width:           32,
    height:          32,
    borderRadius:    radius.full,
    backgroundColor: colors.primaryLight,
    alignItems:      'center',
    justifyContent:  'center',
    flexShrink:      0,
  },
  commentAvatarText: {
    fontSize:   13,
    fontWeight: '700',
    color:      colors.primary,
  },
  commentContent: {
    flex: 1,
    gap:  spacing[0.5],
  },
  commentHeader: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           spacing[2],
  },
  commentAuthor: {
    ...textStyles.label,
    color: colors.textPrimary,
  },
  commentTime: {
    ...textStyles.caption,
    color: colors.textTertiary,
  },
  commentText: {
    ...textStyles.bodySm,
    color: colors.textPrimary,
  },
  commentDeleteButton: {
    padding: spacing[1],
    flexShrink: 0,
  },
  commentInputRow: {
    flexDirection:  'row',
    alignItems:     'flex-end',
    gap:            spacing[2],
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop:     spacing[3],
  },
  commentInput: {
    flex:          1,
    minHeight:     40,
    maxHeight:     100,
    borderWidth:   1,
    borderColor:   colors.border,
    borderRadius:  radius.lg,
    paddingHorizontal: spacing[3],
    paddingVertical:   spacing[2],
    backgroundColor: colors.inputBackground,
    ...textStyles.body,
    color: colors.textPrimary,
  },
  commentSendButton: {
    width:           40,
    height:          40,
    borderRadius:    radius.full,
    backgroundColor: colors.primary,
    alignItems:      'center',
    justifyContent:  'center',
  },
  commentSendDisabled: {
    opacity: 0.5,
  },
  });
}
