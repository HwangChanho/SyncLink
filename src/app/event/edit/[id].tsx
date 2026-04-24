/**
 * Event edit screen — pre-fills form with existing event data.
 *
 * Features:
 *  - Loads event via getEventById on mount
 *  - Same fields as create.tsx (title, all-day, start/end, repeat, location,
 *    description, space sharing)
 *  - Save: calls updateEvent → upsertEvent in store → back
 *  - Delete: calls deleteEvent → removeEvent in store → pop to calendar
 *
 * Only the event owner can reach this screen (EditButton gated by isOwn).
 * Route: /event/edit/[id]
 */

import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TextInput, ScrollView, Switch, Pressable,
  ActivityIndicator, Alert, StyleSheet, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import type { Event, RepeatType } from '@/types';
import { getEventById, updateEvent, deleteEvent } from '@/services/eventService';
import { getReminders, updateReminders } from '@/services/reminderService';
import { shareEventToSpace, unshareEventFromSpace } from '@/services/eventShareService';
import { useEventStore } from '@/stores/eventStore';
import { useSpaceStore } from '@/stores/spaceStore';
import { useColors } from '@/hooks/useColors';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import { PlaceSearchInput } from '@/components/places/PlaceSearchInput';
import { ReminderPicker } from '@/components/reminders/ReminderPicker';
import { DateTimeModal } from '@/components/common/DateTimeModal';
import { showAlert } from '@/lib/webAlert';

// ─── Constants ────────────────────────────────────────────────────────────────

// REPEAT_OPTIONS is now built inside the component using i18n.

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatField(date: Date, allDay: boolean): string {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  if (allDay) return `${y}년 ${m}월 ${d}일`;
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${y}년 ${m}월 ${d}일  ${hh}:${mm}`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/**
 * A labelled form row with a right-side content area.
 *
 * @param label    - Row label text
 * @param children - Right-side content
 * @param rowStyle - Computed row style from makeRowStyles()
 */
function FormRow({
  label,
  children,
  rowStyle,
}: {
  label: string;
  children: React.ReactNode;
  rowStyle: ReturnType<typeof makeRowStyles>;
}) {
  return (
    <View style={rowStyle.row}>
      <Text style={rowStyle.label}>{label}</Text>
      <View style={rowStyle.value}>{children}</View>
    </View>
  );
}

/**
 * Dynamic row styles factory — receives current theme color tokens.
 *
 * @param colors - Active theme color tokens from useColors()
 */
function makeRowStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 52,
      paddingVertical: spacing[2],
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    label: {
      ...textStyles.label,
      color: colors.textSecondary,
      width: 72,
      flexShrink: 0,
    },
    value: {
      flex: 1,
      marginLeft: spacing[3],
    },
  });
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function EventEditScreen() {
  // Resolve active theme colors for dark mode support (TASK-700)
  const { t } = useTranslation();
  const colors = useColors();
  const styles = makeStyles(colors);
  const rowStyle = makeRowStyles(colors);

  /** Repeat options built from i18n translations. */
  const REPEAT_OPTIONS: { value: RepeatType; label: string }[] = [
    { value: 'none',    label: t('time.no_repeat') },
    { value: 'daily',   label: t('time.daily') },
    { value: 'weekly',  label: t('time.weekly') },
    { value: 'monthly', label: t('time.monthly') },
    { value: 'yearly',  label: t('time.annual') },
  ];

  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { upsertEvent, removeEvent } = useEventStore();
  const { spaces } = useSpaceStore();

  // ── Load state ─────────────────────────────────────────────────────────────

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ── Form state — initialised empty, filled once the event loads ────────────

  const [title, setTitle] = useState('');
  const [allDay, setAllDay] = useState(false);
  const [startAt, setStartAt] = useState<Date>(new Date());
  const [endAt, setEndAt] = useState<Date>(new Date());
  const [repeatType, setRepeatType] = useState<RepeatType>('none');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [shareSpaceIds, setShareSpaceIds] = useState<string[]>([]);

  /**
   * Current reminder offsets (minutes before event start).
   * Pre-loaded from `event_reminders` table on mount (TASK-1304).
   */
  const [reminderMinutes, setReminderMinutes] = useState<number[]>([]);

  /** Original event kept for diffing shares on save. */
  const [originalEvent, setOriginalEvent] = useState<Event | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  /**
   * DateTimeModal target — tracks which field (start/end) is being edited.
   * null = modal closed. Same pattern as create.tsx.
   */
  const [pickerTarget, setPickerTarget] = useState<'start' | 'end' | null>(null);

  // ── Load event on mount ────────────────────────────────────────────────────

  useEffect(() => {
    if (!id) return;

    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setLoadError(null);
      try {
        const [ev, reminders] = await Promise.all([
          getEventById(id),
          getReminders(id).catch(() => []), // non-fatal: fall back to empty
        ]);
        if (cancelled) return;
        setOriginalEvent(ev);
        // Pre-fill form fields
        setTitle(ev.title);
        setAllDay(ev.allDay);
        setStartAt(ev.startAt);
        setEndAt(ev.endAt);
        setRepeatType(ev.repeatType);
        setLocation(ev.location ?? '');
        setDescription(ev.description ?? '');
        setShareSpaceIds(ev.sharedSpaceIds);
        // Pre-fill reminder offsets from DB
        setReminderMinutes(reminders.map((r) => r.minutesBefore));
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : t('event.load_failed'));
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [id]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const toggleSpace = useCallback((spaceId: string) => {
    setShareSpaceIds((prev) =>
      prev.includes(spaceId)
        ? prev.filter((sid) => sid !== spaceId)
        : [...prev, spaceId],
    );
  }, []);

  const shiftTime = useCallback((field: 'start' | 'end', deltaMinutes: number) => {
    const setter = field === 'start' ? setStartAt : setEndAt;
    setter((prev) => {
      const next = new Date(prev);
      next.setMinutes(next.getMinutes() + deltaMinutes);
      return next;
    });
  }, []);

  /** Open the DateTimeModal for the start/end field. */
  const openPicker = useCallback((field: 'start' | 'end') => {
    setPickerTarget(field);
  }, []);

  /**
   * Commit the value chosen in DateTimeModal. Ensures end stays after start.
   */
  const handlePickerConfirm = useCallback((selected: Date) => {
    if (!pickerTarget) return;
    if (pickerTarget === 'start') {
      setStartAt(selected);
      setEndAt((prev) => (prev <= selected ? new Date(selected.getTime() + 60 * 60 * 1000) : prev));
    } else {
      setEndAt(selected);
    }
    setPickerTarget(null);
  }, [pickerTarget]);

  /** Close the DateTimeModal without saving. */
  const handlePickerCancel = useCallback(() => {
    setPickerTarget(null);
  }, []);

  /** Compute sharing diff and persist. */
  const handleSave = useCallback(async () => {
    if (!id || !originalEvent) return;

    if (!title.trim()) {
      showAlert(t('common.error'), t('event.title_placeholder'));
      return;
    }
    if (!allDay && endAt <= startAt) {
      showAlert(t('common.error'), t('event.end_after_start'));
      return;
    }

    setIsSaving(true);
    try {
      // 1. Update event fields
      // exactOptionalPropertyTypes: only spread optional fields when they have a value
      const updated = await updateEvent(id, {
        title: title.trim(),
        allDay,
        startAt,
        endAt: allDay
          ? new Date(startAt.getFullYear(), startAt.getMonth(), startAt.getDate(), 23, 59, 59)
          : endAt,
        repeatType,
        ...(location.trim()    ? { location:    location.trim() }    : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
      });

      // 2. Compute sharing diff
      const prev = new Set(originalEvent.sharedSpaceIds);
      const next = new Set(shareSpaceIds);
      const toAdd    = [...next].filter((sid) => !prev.has(sid));
      const toRemove = [...prev].filter((sid) => !next.has(sid));

      await Promise.all([
        ...toAdd.map((sid) => shareEventToSpace(id, sid)),
        ...toRemove.map((sid) => unshareEventFromSpace(id, sid)),
      ]);

      // 3. Replace all reminders with the current selection (fire-and-forget;
      //    failure must not block navigation — user can edit reminders later).
      void updateReminders(
        id,
        reminderMinutes,
        updated.title,
        updated.startAt,
      );

      // 4. Update store
      upsertEvent({
        id: updated.id,
        title: updated.title,
        startAt: updated.startAt,
        endAt: updated.endAt,
        allDay: updated.allDay,
        color: updated.color ?? colors.primary,
        isOwn: true,
      });

      // Go back two screens (edit → detail → calendar)
      router.back();
      router.back();
    } catch (err) {
      console.error('[EventEdit] handleSave failed:', err);
      showAlert(t('common.error'), err instanceof Error ? err.message : t('event.save_error'));
      setIsSaving(false);
    }
  }, [
    id, originalEvent, title, allDay, startAt, endAt,
    repeatType, location, description, shareSpaceIds, reminderMinutes,
    upsertEvent, router, colors.primary, t,
  ]);

  const handleDelete = useCallback(() => {
    if (!id || !originalEvent) return;
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
              await deleteEvent(id);
              removeEvent(id);
              // Pop back past edit + detail to calendar
              router.back();
              router.back();
            } catch (err) {
              Alert.alert(t('common.error'), err instanceof Error ? err.message : t('common.delete_failed'));
              setIsDeleting(false);
            }
          },
        },
      ],
    );
  }, [id, originalEvent, removeEvent, router, t]);

  // ── Render states ───────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  if (loadError) {
    return (
      <SafeAreaView style={styles.centered}>
        <Text style={styles.errorText}>{loadError}</Text>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backText}>돌아가기</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  // ── Main render ─────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.headerBar}>
        <Pressable style={styles.headerButton} onPress={() => router.back()}>
          <Text style={styles.headerCancel}>{t('common.cancel')}</Text>
        </Pressable>
        <Text style={styles.headerTitle}>{t('common.edit')} {t('event.untitled')}</Text>
        <Pressable
          style={[styles.headerButton, isSaving && styles.headerButtonDisabled]}
          onPress={() => void handleSave()}
          disabled={isSaving}
        >
          {isSaving ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Text style={styles.headerSave}>{t('common.save')}</Text>
          )}
        </Pressable>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Title */}
        <TextInput
          style={styles.titleInput}
          placeholder={t('event.title_placeholder')}
          placeholderTextColor={colors.textSecondary}
          value={title}
          onChangeText={setTitle}
          returnKeyType="done"
        />

        <View style={styles.form}>
          {/* All-day */}
          <FormRow label="종일" rowStyle={rowStyle}>
            <Switch
              value={allDay}
              onValueChange={setAllDay}
              trackColor={{ false: colors.border, true: colors.primaryLight }}
              thumbColor={allDay ? colors.primary : colors.surface}
            />
          </FormRow>

          {/* Start — tap to open DateTimeModal (±30 min shortcuts retained) */}
          <FormRow label="시작" rowStyle={rowStyle}>
            <View style={styles.timeRow}>
              <Pressable style={styles.timeChip} onPress={() => shiftTime('start', -30)}>
                <Ionicons name="remove" size={16} color={colors.textSecondary} />
              </Pressable>
              <Pressable onPress={() => openPicker('start')} style={{ flex: 1 }}>
                <Text style={[styles.timeText, styles.timeTextClickable]}>
                  {formatField(startAt, allDay)}
                </Text>
              </Pressable>
              <Pressable style={styles.timeChip} onPress={() => shiftTime('start', 30)}>
                <Ionicons name="add" size={16} color={colors.textSecondary} />
              </Pressable>
            </View>
          </FormRow>

          {/* End */}
          {!allDay && (
            <FormRow label="종료" rowStyle={rowStyle}>
              <View style={styles.timeRow}>
                <Pressable style={styles.timeChip} onPress={() => shiftTime('end', -30)}>
                  <Ionicons name="remove" size={16} color={colors.textSecondary} />
                </Pressable>
                <Pressable onPress={() => openPicker('end')} style={{ flex: 1 }}>
                  <Text style={[styles.timeText, styles.timeTextClickable]}>
                    {formatField(endAt, false)}
                  </Text>
                </Pressable>
                <Pressable style={styles.timeChip} onPress={() => shiftTime('end', 30)}>
                  <Ionicons name="add" size={16} color={colors.textSecondary} />
                </Pressable>
              </View>
            </FormRow>
          )}

          {/*
           * DateTimeModal — unified date + time editor (Bug 2 fix, parity with create.tsx).
           * Hidden on web where the browser's native <input type="datetime-local"> UI is preferred.
           */}
          {Platform.OS !== 'web' && pickerTarget !== null && (
            <DateTimeModal
              visible={pickerTarget !== null}
              initialValue={pickerTarget === 'start' ? startAt : endAt}
              allDay={allDay}
              {...(pickerTarget === 'end' ? { minimumDate: startAt } : {})}
              onCancel={handlePickerCancel}
              onConfirm={handlePickerConfirm}
            />
          )}

          {/* Repeat */}
          <FormRow label="반복" rowStyle={rowStyle}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.chipRow}>
                {REPEAT_OPTIONS.map((opt) => (
                  <Pressable
                    key={opt.value}
                    style={[
                      styles.repeatChip,
                      repeatType === opt.value && styles.repeatChipSelected,
                    ]}
                    onPress={() => setRepeatType(opt.value)}
                  >
                    <Text style={[
                      styles.repeatChipText,
                      repeatType === opt.value && styles.repeatChipTextSelected,
                    ]}>
                      {opt.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          </FormRow>

          {/* Location — Google Places Autocomplete (TASK-901) */}
          <FormRow label="위치" rowStyle={rowStyle}>
            <PlaceSearchInput
              value={location}
              onPlaceSelect={setLocation}
              placeholder={t('places.search_placeholder')}
            />
          </FormRow>

          {/* Description */}
          <FormRow label="메모" rowStyle={rowStyle}>
            <TextInput
              style={[styles.inlineInput, styles.multilineInput]}
              placeholder={t('nl.placeholder')}
              placeholderTextColor={colors.textSecondary}
              value={description}
              onChangeText={setDescription}
              multiline
            />
          </FormRow>

          {/* Reminders — users can manage multiple offsets (TASK-1304) */}
          <FormRow label={t('reminder.title')} rowStyle={rowStyle}>
            <ReminderPicker
              minutesList={reminderMinutes}
              onAdd={(min) =>
                setReminderMinutes((prev) => prev.includes(min) ? prev : [...prev, min])
              }
              onRemove={(min) =>
                setReminderMinutes((prev) => prev.filter((m) => m !== min))
              }
            />
          </FormRow>

          {/* Space sharing */}
          {spaces.length > 0 && (
            <View style={styles.sharingSection}>
              <Text style={styles.sharingLabel}>공유할 Space</Text>
              {spaces.map((space) => {
                const selected = shareSpaceIds.includes(space.id);
                return (
                  <Pressable
                    key={space.id}
                    style={styles.spaceRow}
                    onPress={() => toggleSpace(space.id)}
                  >
                    <Text style={styles.spaceName}>{space.name}</Text>
                    <Ionicons
                      name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                      size={22}
                      color={selected ? colors.primary : colors.border}
                    />
                  </Pressable>
                );
              })}
            </View>
          )}

          {/* Delete */}
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
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

/**
 * Dynamic styles factory — receives current theme color tokens.
 * Must be called inside the component to react to theme changes.
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
  backButton: {
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[4],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  backText: {
    ...textStyles.label,
    color: colors.textSecondary,
  },

  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 56,
    paddingHorizontal: spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  headerButton: {
    minWidth: 48,
    alignItems: 'center',
  },
  headerButtonDisabled: {
    opacity: 0.5,
  },
  headerTitle: {
    ...textStyles.labelLg,
    color: colors.textPrimary,
    flex: 1,
    textAlign: 'center',
  },
  headerCancel: {
    ...textStyles.body,
    color: colors.textSecondary,
  },
  headerSave: {
    ...textStyles.labelLg,
    color: colors.primary,
  },

  scroll: { flex: 1 },
  scrollContent: {
    paddingBottom: spacing[10],
  },

  titleInput: {
    ...textStyles.h3,
    color: colors.textPrimary,
    padding: spacing[5],
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },

  form: {
    paddingHorizontal: spacing[5],
  },

  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
  },
  timeChip: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeText: {
    ...textStyles.body,
    color: colors.textPrimary,
    flex: 1,
    textAlign: 'center',
  },
  timeTextClickable: {
    textDecorationLine: 'underline',
    color: colors.primary,
  },

  chipRow: {
    flexDirection: 'row',
    gap: spacing[2],
  },
  repeatChip: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  repeatChipSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  repeatChipText: {
    ...textStyles.labelSm,
    color: colors.textSecondary,
  },
  repeatChipTextSelected: {
    color: colors.primary,
  },

  inlineInput: {
    ...textStyles.body,
    color: colors.textPrimary,
    paddingVertical: spacing[1],
    flex: 1,
  },
  multilineInput: {
    minHeight: 60,
    textAlignVertical: 'top',
  },

  sharingSection: {
    marginTop: spacing[6],
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing[4],
  },
  sharingLabel: {
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
}
