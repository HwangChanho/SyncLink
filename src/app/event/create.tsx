/**
 * Event creation screen.
 *
 * Form fields:
 *  - Title (required)
 *  - All-day toggle
 *  - Start date + time (pre-filled from ?date= query param)
 *  - End date + time (defaults to start + 1 hour)
 *  - Repeat type selector
 *  - Location (optional)
 *  - Description (optional)
 *  - Space sharing toggles (one per space the user belongs to)
 *
 * On save: calls createEvent → upsertEvent in store → back to calendar.
 *
 * Route: /event/create?date=YYYY-MM-DD
 */

import { useCallback, useState } from 'react';
import {
  View, Text, TextInput, ScrollView, Switch, Pressable,
  ActivityIndicator, StyleSheet, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import * as Location from 'expo-location';
import type { RepeatType } from '@/types';
import { createEvent } from '@/services/eventService';
import { updateReminders } from '@/services/reminderService';
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

/**
 * Parse a YYYY-MM-DD string into a local-midnight Date.
 * Falls back to today if the string is invalid.
 */
function parseDateParam(dateStr: string | undefined): Date {
  if (dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    if (y && m && d) {
      const date = new Date(y, m - 1, d);
      if (!isNaN(date.getTime())) return date;
    }
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

/**
 * Format a Date to a display string for the date/time fields.
 * allDay=true → "YYYY년 M월 D일"
 * allDay=false → "YYYY년 M월 D일  HH:MM"
 */
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

export default function EventCreateScreen() {
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

  const { date: dateParam } = useLocalSearchParams<{ date?: string }>();
  const router = useRouter();
  const { upsertEvent } = useEventStore();
  const { spaces } = useSpaceStore();

  // ── Form state ─────────────────────────────────────────────────────────────

  const [title, setTitle] = useState('');
  const [allDay, setAllDay] = useState(false);

  /** Start date — pre-filled from route param. */
  const [startAt, setStartAt] = useState<Date>(() => {
    const base = parseDateParam(dateParam);
    base.setHours(9, 0, 0, 0);
    return base;
  });

  /** End date — defaults to start + 1 hour. */
  const [endAt, setEndAt] = useState<Date>(() => {
    const base = parseDateParam(dateParam);
    base.setHours(10, 0, 0, 0);
    return base;
  });

  const [repeatType, setRepeatType] = useState<RepeatType>('none');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  /** IDs of spaces the user has chosen to share this event to. */
  const [shareSpaceIds, setShareSpaceIds] = useState<string[]>([]);

  /**
   * Selected reminder offsets (minutes before event start).
   * Starts empty — the user adds reminders explicitly via ReminderPicker.
   * Default was 30 min but is now user-controlled (TASK-1304).
   */
  const [reminderMinutes, setReminderMinutes] = useState<number[]>([]);

  const [isSaving, setIsSaving] = useState(false);

  /**
   * DateTimeModal state.
   * Tracks which field (start/end) is being edited. null = modal closed.
   * The modal internally buffers edits and only commits on 저장.
   * Replaces the old native DateTimePicker that auto-closed on each change.
   */
  const [pickerTarget, setPickerTarget] = useState<'start' | 'end' | null>(null);

  /** Whether a GPS reverse-geocode is in progress. */
  const [isGettingLocation, setIsGettingLocation] = useState(false);

  // ── Handlers ───────────────────────────────────────────────────────────────

  /** Toggle a space in the sharing list. */
  const toggleSpace = useCallback((spaceId: string) => {
    setShareSpaceIds((prev) =>
      prev.includes(spaceId)
        ? prev.filter((id) => id !== spaceId)
        : [...prev, spaceId],
    );
  }, []);

  /**
   * Open the DateTimeModal for the given date field.
   * The modal is a single controlled dialog that shows both date and time
   * pickers simultaneously. User can freely edit year/month/day/hour/minute
   * before committing via 저장.
   *
   * On Web we use a hidden <input type="datetime-local"> (see JSX below).
   *
   * @param field - Which date field to edit
   */
  const openPicker = useCallback((field: 'start' | 'end') => {
    setPickerTarget(field);
  }, []);

  /**
   * Commit the chosen value from the DateTimeModal.
   * Called once when the user taps 저장 in the modal.
   *
   * @param selected - The final Date chosen in the modal
   */
  const handlePickerConfirm = useCallback((selected: Date) => {
    if (!pickerTarget) return;
    if (pickerTarget === 'start') {
      setStartAt(selected);
      // If end is now before start, bump end to start + 1h for consistency
      setEndAt((prev) => (prev <= selected ? new Date(selected.getTime() + 60 * 60 * 1000) : prev));
    } else {
      setEndAt(selected);
    }
    setPickerTarget(null);
  }, [pickerTarget]);

  /** Dismiss the DateTimeModal without persisting changes. */
  const handlePickerCancel = useCallback(() => {
    setPickerTarget(null);
  }, []);

  /**
   * Handle a web <input type="datetime-local"> change event.
   * The value is a string like "2026-04-23T14:30".
   *
   * @param field   - Which date field to update
   * @param isoStr  - The datetime-local input value string
   */
  const handleWebDateChange = useCallback((
    field: 'start' | 'end',
    isoStr: string,
  ) => {
    if (!isoStr) return;
    const parsed = new Date(isoStr);
    if (isNaN(parsed.getTime())) return;
    const setter = field === 'start' ? setStartAt : setEndAt;
    setter(parsed);
  }, []);

  /**
   * Get the current GPS position and reverse-geocode it to an address string.
   * Requests foreground location permission if not already granted.
   * Falls back gracefully if permission is denied or geocoding fails.
   */
  const handleGetGPSLocation = useCallback(async () => {
    setIsGettingLocation(true);
    try {
      // Request permission — shows OS permission dialog if needed
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        showAlert(
          t('notification.permission_required'),
          t('notification.permission_desc'),
        );
        return;
      }

      // Fetch current position (low accuracy is fast enough for a city-level address)
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      // Reverse-geocode coordinates to a human-readable address
      const [geo] = await Location.reverseGeocodeAsync({
        latitude:  pos.coords.latitude,
        longitude: pos.coords.longitude,
      });

      if (geo) {
        // Build a display string from the geocoding result parts
        const parts = [geo.name, geo.street, geo.city, geo.region, geo.country]
          .filter(Boolean)
          .join(', ');
        setLocation(parts);
      }
    } catch (err) {
      // Non-fatal — user can still type a location manually
      console.warn('[EventCreate] GPS location error:', err);
    } finally {
      setIsGettingLocation(false);
    }
  }, [t]);

  /**
   * Validate and submit the form.
   *
   * Uses showAlert (webAlert) so alerts appear on both web (window.alert)
   * and native (Alert.alert). Adds console.error around the createEvent
   * call so iOS failures surface in Metro logs (previously silent).
   */
  const handleSave = useCallback(async () => {
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
      // exactOptionalPropertyTypes: only spread optional fields when they have a value
      const newEvent = await createEvent({
        title: title.trim(),
        allDay,
        startAt,
        endAt: allDay ? new Date(startAt.getFullYear(), startAt.getMonth(), startAt.getDate(), 23, 59, 59) : endAt,
        repeatType,
        ...(location.trim()     ? { location:    location.trim() }     : {}),
        ...(description.trim()  ? { description: description.trim() }  : {}),
        shareToSpaceIds: shareSpaceIds,
      });

      // Persist reminders for the newly created event (fire-and-forget;
      // failure must not block navigation — user can edit reminders later).
      if (reminderMinutes.length > 0) {
        void updateReminders(newEvent.id, reminderMinutes, newEvent.title, newEvent.startAt);
      }

      // Optimistically add to store so calendar reflects the new event immediately
      upsertEvent({
        id: newEvent.id,
        title: newEvent.title,
        startAt: newEvent.startAt,
        endAt: newEvent.endAt,
        allDay: newEvent.allDay,
        color: newEvent.color ?? colors.primary,
        isOwn: true,
      });

      router.back();
    } catch (err) {
      // Always log the full error object to Metro — previously the app
      // showed only the display message which on iOS could be blank.
      // This helps triage silent-save bugs.
      console.error('[EventCreate] handleSave failed:', err);
      showAlert(t('common.error'), err instanceof Error ? err.message : t('event.save_error'));
      setIsSaving(false);
    }
  }, [
    title, allDay, startAt, endAt, repeatType,
    location, description, shareSpaceIds, reminderMinutes,
    upsertEvent, router, colors.primary, t,
  ]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.headerBar}>
        <Pressable style={styles.headerButton} onPress={() => router.back()}>
          <Text style={styles.headerCancel}>{t('common.cancel')}</Text>
        </Pressable>
        {/*
         * Show the event title while the user types; fall back to the
         * i18n placeholder ("제목 없음" / "New Event") when the field is empty,
         * so the header never shows a raw "Untitled" string.
         */}
        <Text style={styles.headerTitle} numberOfLines={1}>
          {title.trim() || t('event.untitled')}
        </Text>
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
          autoFocus
          returnKeyType="done"
        />

        <View style={styles.form}>
          {/* All-day toggle */}
          <FormRow label={t('time.all_day')} rowStyle={rowStyle}>

            <Switch
              value={allDay}
              onValueChange={setAllDay}
              trackColor={{ false: colors.border, true: colors.primaryLight }}
              thumbColor={allDay ? colors.primary : colors.surface}
            />
          </FormRow>

          {/* Start time */}
          <FormRow label="시작" rowStyle={rowStyle}>
            {Platform.OS === 'web' ? (
              // Web: use a native datetime-local input for best UX
              // eslint-disable-next-line @typescript-eslint/ban-ts-comment
              // @ts-ignore — JSX <input> is not typed for RN but valid on web
              <input
                type="datetime-local"
                value={`${startAt.getFullYear()}-${String(startAt.getMonth() + 1).padStart(2, '0')}-${String(startAt.getDate()).padStart(2, '0')}T${String(startAt.getHours()).padStart(2, '0')}:${String(startAt.getMinutes()).padStart(2, '0')}`}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleWebDateChange('start', e.target.value)}
                style={{ fontSize: 16, color: colors.textPrimary, background: 'transparent', border: 'none', outline: 'none' }}
              />
            ) : (
              <Pressable onPress={() => openPicker('start')}>
                <Text style={[styles.timeText, styles.timeTextClickable]}>
                  {formatField(startAt, allDay)}
                </Text>
              </Pressable>
            )}
          </FormRow>

          {/* End time */}
          {!allDay && (
            <FormRow label="종료" rowStyle={rowStyle}>
              {Platform.OS === 'web' ? (
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                <input
                  type="datetime-local"
                  value={`${endAt.getFullYear()}-${String(endAt.getMonth() + 1).padStart(2, '0')}-${String(endAt.getDate()).padStart(2, '0')}T${String(endAt.getHours()).padStart(2, '0')}:${String(endAt.getMinutes()).padStart(2, '0')}`}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleWebDateChange('end', e.target.value)}
                  style={{ fontSize: 16, color: colors.textPrimary, background: 'transparent', border: 'none', outline: 'none' }}
                />
              ) : (
                <Pressable onPress={() => openPicker('end')}>
                  <Text style={[styles.timeText, styles.timeTextClickable]}>
                    {formatField(endAt, false)}
                  </Text>
                </Pressable>
              )}
            </FormRow>
          )}

          {/*
           * DateTimeModal — unified date + time editor (Bug 2 fix).
           * Replaces the previous native DateTimePicker that closed on
           * each field change and made time editing impossible on iOS.
           * The modal keeps a local draft and only commits on 저장.
           */}
          {Platform.OS !== 'web' && pickerTarget !== null && (
            <DateTimeModal
              visible={pickerTarget !== null}
              initialValue={pickerTarget === 'start' ? startAt : endAt}
              allDay={allDay}
              // Clamp end picker to >= startAt
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
                    <Text
                      style={[
                        styles.repeatChipText,
                        repeatType === opt.value && styles.repeatChipTextSelected,
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          </FormRow>

          {/* Location — GPS shortcut + Google Places Autocomplete (TASK-901 / TASK-1302) */}
          <FormRow label="위치" rowStyle={rowStyle}>
            <View style={styles.locationRow}>
              {/*
               * GPS button: only shown on native (iOS/Android).
               * expo-location is not supported on web, so we hide the button entirely
               * on the web platform to prevent crashes.
               */}
              {Platform.OS !== 'web' && (
                <Pressable
                  style={styles.gpsButton}
                  onPress={() => void handleGetGPSLocation()}
                  disabled={isGettingLocation}
                  accessibilityLabel="현재 위치 사용"
                >
                  {isGettingLocation ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <Ionicons name="locate" size={18} color={colors.primary} />
                  )}
                </Pressable>
              )}
              {/* Text search (Google Places autocomplete) — works on both web and native */}
              <View style={styles.locationSearch}>
                <PlaceSearchInput
                  value={location}
                  onPlaceSelect={setLocation}
                  placeholder={t('places.search_placeholder')}
                />
              </View>
            </View>
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
              returnKeyType="default"
            />
          </FormRow>

          {/* Reminders — users can add multiple offsets (TASK-1304) */}
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

  // Header
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

  // Scroll
  scroll: { flex: 1 },
  scrollContent: {
    paddingBottom: spacing[10],
  },

  // Title input
  titleInput: {
    ...textStyles.h3,
    color: colors.textPrimary,
    padding: spacing[5],
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },

  // Form rows
  form: {
    paddingHorizontal: spacing[5],
  },

  // Time adjustment row
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
  /** Tappable date/time text — underline hints it is interactive. */
  timeTextClickable: {
    textDecorationLine: 'underline',
    color: colors.primary,
  },

  // Location row (GPS + search)
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  gpsButton: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  locationSearch: {
    flex: 1,
  },

  // Repeat chips
  chipRow: {
    flexDirection: 'row',
    gap: spacing[2],
  },
  repeatChip: {
    // Ensure the chip's content is centred both horizontally and vertically.
    // Without this the RN default (stretch) can leave the label left-aligned
    // when the chip grows wider than its intrinsic text width.
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 32,
  },
  repeatChipSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  repeatChipText: {
    ...textStyles.labelSm,
    color: colors.textSecondary,
    // Centre the label inside the chip so longer labels (e.g. "매년")
    // remain visually balanced against shorter ones (e.g. "일").
    textAlign: 'center',
  },
  repeatChipTextSelected: {
    color: colors.primary,
  },

  // Inline text input
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

  // Space sharing
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
  });
}
