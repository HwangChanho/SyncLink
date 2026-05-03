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

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, ScrollView, Switch, Pressable,
  ActivityIndicator, StyleSheet, Platform, KeyboardAvoidingView,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import * as Location from 'expo-location';
import type { RepeatType } from '@/types';
import {
  createEvent,
  findConflictingEvents,
  searchEventsByTitle,
  type ConflictingEvent,
  type EventAutocompleteSuggestion,
} from '@/services/eventService';
import { updateReminders } from '@/services/reminderService';
import { useEventStore } from '@/stores/eventStore';
import { useSpaceStore } from '@/stores/spaceStore';
import { useColors } from '@/hooks/useColors';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';
import { PlaceSearchInput } from '@/components/places/PlaceSearchInput';
import { ReminderPicker } from '@/components/reminders/ReminderPicker';
import { DateTimeModal } from '@/components/common/DateTimeModal';
import { CategoryPickerSheet } from '@/components/planner/CategoryPickerSheet';
import { ColorPicker } from '@/components/event/ColorPicker';
import { getCategories } from '@/services/categoryService';
import { logError } from '@/lib/errorLogger';
import type { Category } from '@/types';
import { showAlert } from '@/lib/webAlert';
import { SimpleToast, useSimpleToast } from '@/components/common/SimpleToast';
import { FreeTimeRecommendSheet } from '@/components/calendar/FreeTimeRecommendSheet';
import type { FreeSlot } from '@/types/freeTime';

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

  // Build-55 — empty-slot quick-create deep link adds startHour/startMinute on
  // top of the existing date param so the form lands directly on the tapped
  // time. Both fields are optional; omitted = "round-up-to-next-30min" path.
  const {
    date: dateParam,
    startHour: startHourParam,
    startMinute: startMinuteParam,
  } = useLocalSearchParams<{ date?: string; startHour?: string; startMinute?: string }>();
  const router = useRouter();
  const { upsertEvent } = useEventStore();
  const { spaces, fetchMySpaces } = useSpaceStore();

  // Sprint 27 R1 — IDEA-013 defensive sync:
  // space/create 에서 await fetchMySpaces() 후 navigate 하므로 정상 흐름엔 race 가
  // 없지만, 콜드 스타트나 외부 invite 링크로 곧바로 event/create 에 진입하는
  // 경로(예: deep-link)가 생기면 spaces 가 비어 "공유할 Space" 섹션이 안 뜬다.
  // mount 시 한 번만 동기화해 store 가 stale 한 경우를 보호한다. 이미 채워져
  // 있으면 zustand 가 set 으로 동일 reference 를 만들지 않도록 service 레벨에서
  // 처리되므로 추가 re-render 부담은 미미하다.
  useEffect(() => {
    void fetchMySpaces().catch(() => undefined);
    // 의도적으로 mount 1회만 — fetchMySpaces 는 store action 으로 stable identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // IDEA-018 — Couple Space 기본 공유 ON:
  // spaces 가 로드되면(또는 mount 시점에 이미 채워져 있으면) type='couple' 인
  // Space ID 를 shareSpaceIds 초기값으로 설정한다.
  // - 사용자가 직접 toggle 로 끄면 그 상태가 우선한다(한 번만 적용).
  // - spaces 배열이 변경될 때마다 재실행되지 않도록 didAutoSelect ref 로 보호.
  const didAutoSelectCouple = useRef(false);
  useEffect(() => {
    // 이미 자동 선택을 수행했거나 spaces 가 비어 있으면 skip
    if (didAutoSelectCouple.current) return;
    if (spaces.length === 0) return;

    const coupleIds = spaces
      .filter((s) => s.type === 'couple')
      .map((s) => s.id);

    if (coupleIds.length > 0) {
      // 이미 사용자가 수동으로 선택한 것이 있으면 couple ID 를 merge 해서 추가
      setShareSpaceIds((prev) => {
        const merged = [...new Set([...prev, ...coupleIds])];
        return merged;
      });
      didAutoSelectCouple.current = true;
    }
  }, [spaces]);

  // ── Form state ─────────────────────────────────────────────────────────────

  const [title, setTitle] = useState('');
  const [allDay, setAllDay] = useState(false);

  /** Start date — pre-filled from route param.
   *  - date 만 있을 때: 현재 시각 기준 다음 30분 슬롯 (기존 동작).
   *  - date + startHour/startMinute (Build-55 deep link): 정확히 그 시각.
   *  LEAD 2026-04-28: 시작 시간을 현재 시간 기준으로 (이전엔 09:00 고정).
   *  분(minute)은 다음 30분 단위로 round (시각적 가독성 + 슬롯 align).
   */
  const [startAt, setStartAt] = useState<Date>(() => {
    const base = parseDateParam(dateParam);
    if (startHourParam !== undefined) {
      const h = Math.max(0, Math.min(23, parseInt(startHourParam, 10) || 0));
      const m = Math.max(0, Math.min(59, parseInt(startMinuteParam ?? '0', 10) || 0));
      base.setHours(h, m, 0, 0);
      return base;
    }
    const now = new Date();
    const minutes = now.getMinutes();
    const roundedMinutes = minutes < 30 ? 30 : 0;
    const hourOffset = minutes < 30 ? 0 : 1;
    base.setHours(now.getHours() + hourOffset, roundedMinutes, 0, 0);
    return base;
  });

  /** End date — defaults to start + 1 hour. */
  const [endAt, setEndAt] = useState<Date>(() => {
    const base = parseDateParam(dateParam);
    if (startHourParam !== undefined) {
      const h = Math.max(0, Math.min(23, parseInt(startHourParam, 10) || 0));
      const m = Math.max(0, Math.min(59, parseInt(startMinuteParam ?? '0', 10) || 0));
      base.setHours(h, m, 0, 0);
      // +1h end
      base.setTime(base.getTime() + 60 * 60 * 1000);
      return base;
    }
    const now = new Date();
    const minutes = now.getMinutes();
    const roundedMinutes = minutes < 30 ? 30 : 0;
    const hourOffset = minutes < 30 ? 1 : 2;
    base.setHours(now.getHours() + hourOffset, roundedMinutes, 0, 0);
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

  // ── IDEA-019: Toast state (일정 생성 완료 피드백) ──────────────────────────
  const { toast, showToast } = useSimpleToast();

  // ── IDEA-019: Free-time inline (빈 시간 찾기 → 시작/종료 prefill) ─────────
  /**
   * When the user taps "빈 시간 찾기" we open FreeTimeRecommendSheet.
   * The sheet's onCreateEvent callback pre-fills title/startAt/endAt from the
   * chosen slot, then the user finishes editing and saves normally.
   *
   * Note: FreeTimeRecommendSheet expects a FreeSlot from @/types/freeTime.
   * We open it with a synthetic slot derived from the current form dates so
   * the sheet can show relevant AI recommendations immediately.
   */
  const [freeTimeSlot, setFreeTimeSlot] = useState<FreeSlot | null>(null);

  /**
   * DateTimeModal state.
   * Tracks which field (start/end) is being edited. null = modal closed.
   * The modal internally buffers edits and only commits on 저장.
   * Replaces the old native DateTimePicker that auto-closed on each change.
   */
  const [pickerTarget, setPickerTarget] = useState<'start' | 'end' | null>(null);

  /** Whether a GPS reverse-geocode is in progress. */
  const [isGettingLocation, setIsGettingLocation] = useState(false);

  /**
   * User-selected event color override.
   * null = use category color or member color as fallback (default behaviour).
   * Non-null = persist to events.color column and render with this color.
   */
  const [eventColor, setEventColor] = useState<string | null>(null);

  // ── Title autocomplete ─────────────────────────────────────────────────────
  // As the user types, suggest prior calendar events with matching titles.
  // Tapping a suggestion pre-fills the form from that event — title, location,
  // description, category, all_day, and the shape of start/end (time of day +
  // duration) while keeping the *date* the user was creating on. This is the
  // "저장 기준은 달력에 등록되어있는기준" behaviour requested in Sprint 14.
  const [titleSuggestions, setTitleSuggestions] = useState<EventAutocompleteSuggestion[]>([]);
  const [titleFocused, setTitleFocused]   = useState(false);
  /**
   * Selected category id. Build-54: a new event is always assigned a
   * category — the default is the system "기타" (other) so the chip
   * always renders with a colour and the filter/dim flow works without
   * a special "uncategorised" code path. The user can override before
   * saving by tapping the chip.
   *
   * `null` only appears as a transient state while the categories are
   * still loading (we backfill to 기타 in the effect below).
   */
  const [categoryId, setCategoryId]       = useState<string | null>(null);
  /** Whether the inline category picker sheet is visible. */
  const [categoryPickerVisible, setCategoryPickerVisible] = useState(false);
  /** Cached categories for chip color/name lookup. Refreshed when the
   * picker closes so inline creation is reflected immediately. */
  const [categoryMap, setCategoryMap]     = useState<Map<string, Category>>(new Map());

  // Load categories once on mount + whenever the picker closes.
  useEffect(() => {
    let cancelled = false;
    getCategories().then((list) => {
      if (cancelled) return;
      setCategoryMap(new Map(list.map((c) => [c.id, c])));
      // Build-54 — backfill default to system "기타" if user hasn't
      // explicitly chosen one yet. We match by exact name because the
      // builtin three (개인/업무/기타) are seeded with user_id=NULL and
      // shared across users.
      setCategoryId((current) => {
        if (current !== null) return current;
        const other = list.find((c) => c.name === '기타');
        return other?.id ?? null;
      });
    }).catch(() => {
      // Non-fatal — chip just shows "없음" until list loads.
    });
    return () => { cancelled = true; };
  }, [categoryPickerVisible]);

  // Debounced search as title changes.
  useEffect(() => {
    const q = title.trim();
    if (q.length === 0) {
      setTitleSuggestions([]);
      return;
    }
    let cancelled = false;
    const id = setTimeout(() => {
      searchEventsByTitle(q).then((rows) => {
        if (!cancelled) setTitleSuggestions(rows);
      }).catch(() => {
        if (!cancelled) setTitleSuggestions([]);
      });
    }, 200);
    return () => { cancelled = true; clearTimeout(id); };
  }, [title]);

  /** Apply a picked suggestion to the current form. */
  const pickTitleSuggestion = useCallback((s: EventAutocompleteSuggestion) => {
    setTitle(s.title);
    setLocation(s.location ?? '');
    setDescription(s.description ?? '');
    setAllDay(s.allDay);
    setCategoryId(s.categoryId);
    // Preserve the *date* the user opened the create form on, but copy the
    // time-of-day + duration from the template so "내일 주간 회의" becomes
    // 내일 14:00–15:00 when the template was some Tue 14:00–15:00.
    setStartAt((prev) => {
      const next = new Date(prev);
      next.setHours(s.lastStartAt.getHours(), s.lastStartAt.getMinutes(), 0, 0);
      return next;
    });
    setTitleSuggestions([]);
    setTitleFocused(false);
  }, []);

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
      // Symmetric guard for the end side: if the user sets end before the
      // current start, snap start back to (end - 1h) instead of saving an
      // invalid range that the server would reject after a round trip.
      setEndAt(selected);
      setStartAt((prev) => (selected <= prev ? new Date(selected.getTime() - 60 * 60 * 1000) : prev));
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
    if (field === 'start') {
      setStartAt(parsed);
      setEndAt((prev) => (prev <= parsed ? new Date(parsed.getTime() + 60 * 60 * 1000) : prev));
    } else {
      setEndAt(parsed);
      setStartAt((prev) => (parsed <= prev ? new Date(parsed.getTime() - 60 * 60 * 1000) : prev));
    }
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
   * Format a list of conflicting events into a multi-line bullet string for
   * the warning Alert body. Kept inline because it's only used by handleSave
   * and is trivial enough that extracting it elsewhere would obscure the flow.
   */
  const formatConflictList = useCallback((conflicts: ConflictingEvent[]): string => {
    return conflicts
      .map(c => `• ${c.ownerNickname} — ${c.title}`)
      .join('\n');
  }, []);

  /**
   * Run the actual createEvent + side-effects (reminders, store update, navigation).
   * Extracted from handleSave so the conflict-warning "save anyway" path can
   * call it after user confirmation without duplicating the save logic.
   *
   * @param effectiveEndAt - The end date that was committed (allDay-adjusted)
   */
  const performSave = useCallback(async (effectiveEndAt: Date) => {
    try {
      // exactOptionalPropertyTypes: only spread optional fields when they have a value
      const newEvent = await createEvent({
        title: title.trim(),
        allDay,
        startAt,
        endAt: effectiveEndAt,
        repeatType,
        ...(location.trim()     ? { location:    location.trim() }     : {}),
        ...(description.trim()  ? { description: description.trim() }  : {}),
        ...(categoryId          ? { categoryId }                       : {}),
        // Pass color override — null is fine (service layer accepts null = no override)
        ...(eventColor          ? { color: eventColor }                : {}),
        shareToSpaceIds: shareSpaceIds,
      });

      // Persist reminders for the newly created event (fire-and-forget; see
      // long-form rationale above the original implementation).
      if (reminderMinutes.length > 0) {
        updateReminders(newEvent.id, reminderMinutes, newEvent.title, newEvent.startAt)
          .catch((remindErr) => {
            console.warn('[EventCreate] updateReminders failed (non-fatal):', remindErr);
          });
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

      // IDEA-019: Show a brief success toast before navigating back.
      // We show first, then navigate so the toast is briefly visible on the
      // calendar screen (the toast outlasts the navigation transition).
      showToast(t('event.added_toast'));
      router.back();
    } catch (err) {
      void logError({ context: 'event.create.ui', error: err });
      console.error('[EventCreate] handleSave failed:', err);
      showAlert(t('common.error'), err instanceof Error ? err.message : t('event.save_error'));
      setIsSaving(false);
    }
  }, [
    title, allDay, startAt, repeatType, location, description, categoryId,
    eventColor, shareSpaceIds, reminderMinutes, upsertEvent, router, colors.primary, t, showToast,
  ]);

  /**
   * Validate and submit the form.
   *
   * Sprint 26 R3 — Before saving, if the event is being shared to one or more
   * Spaces, run a conflict pre-check against each Space's existing events.
   * If any conflict is found, show a warning Alert; the user can confirm to
   * proceed or cancel to keep editing.
   *
   * Uses showAlert (webAlert) so alerts appear on both web (window.confirm)
   * and native (Alert.alert).
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

    // Compute the canonical end date once — allDay snaps to 23:59:59 of
    // startAt's day. Reused below for both the conflict check and the
    // actual createEvent call so the two cannot diverge.
    const effectiveEndAt = allDay
      ? new Date(startAt.getFullYear(), startAt.getMonth(), startAt.getDate(), 23, 59, 59)
      : endAt;

    // ── Conflict pre-check (only when sharing to at least one Space) ─────
    if (shareSpaceIds.length > 0) {
      // Run all space checks in parallel, then de-duplicate the union by id
      // (an event shared to multiple of the user's spaces would otherwise
      // appear once per space).
      const lists = await Promise.all(
        shareSpaceIds.map(sid =>
          findConflictingEvents(sid, startAt, effectiveEndAt),
        ),
      );
      const seen = new Set<string>();
      const merged: ConflictingEvent[] = [];
      for (const list of lists) {
        for (const c of list) {
          if (!seen.has(c.id)) {
            seen.add(c.id);
            merged.push(c);
          }
        }
      }

      if (merged.length > 0) {
        // Defer the actual save to the user's response on the warning Alert.
        // showAlert fires the chosen button's onPress; if the user cancels
        // we reset isSaving so the header save button re-enables.
        showAlert(
          t('event.conflict_warning_title'),
          t('event.conflict_warning_body', { list: formatConflictList(merged) }),
          [
            {
              text: t('common.cancel'),
              style: 'cancel',
              onPress: () => setIsSaving(false),
            },
            {
              text: t('event.conflict_save_anyway'),
              style: 'destructive',
              onPress: () => {
                void performSave(effectiveEndAt);
              },
            },
          ],
        );
        return;
      }
    }

    // No conflict (or no sharing) — proceed with save immediately.
    void performSave(effectiveEndAt);
  }, [
    title, allDay, startAt, endAt, shareSpaceIds,
    formatConflictList, performSave, t,
  ]);

  // ── IDEA-019: Free-time inline handlers ────────────────────────────────────

  /**
   * Open FreeTimeRecommendSheet with a synthetic slot spanning the current
   * form's start–end range so the sheet can seed AI recommendations.
   * If the range is invalid or zero-length, we fall back to a 1-hour slot.
   */
  const handleOpenFreeTime = useCallback(() => {
    const durationMinutes = allDay
      ? 60
      : Math.max(30, Math.round((endAt.getTime() - startAt.getTime()) / 60_000));
    const slot: FreeSlot = {
      start:           startAt,
      end:             endAt,
      durationMinutes: durationMinutes,
    };
    setFreeTimeSlot(slot);
  }, [startAt, endAt, allDay]);

  /**
   * Called when the user taps "이 활동으로 일정 만들기" inside the sheet.
   * Pre-fills the form's title and (optionally) adjusts start/end to the slot.
   *
   * @param activityTitle - The chosen activity name (e.g. "산책")
   * @param slot          - The free slot the activity was suggested for
   */
  const handleFreeTimeCreateEvent = useCallback((
    activityTitle: string,
    slot: FreeSlot,
  ) => {
    setTitle(activityTitle);
    // Apply slot times to the form, keeping the user's chosen date
    setStartAt(slot.start);
    setEndAt(slot.end);
    setFreeTimeSlot(null);
  }, []);

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
          testID="event-create-save"
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

      {/*
       * KeyboardAvoidingView ensures the memo/description TextInput at the
       * bottom of the form isn't covered by the software keyboard on iOS.
       * Android uses softwareKeyboardLayoutMode="resize" (app.json) so
       * `behavior={undefined}` lets the OS resize the activity itself —
       * stacking both would double-adjust and leave a grey strip above the
       * keyboard (Sprint 14 TASK-1411).
       *
       * keyboardVerticalOffset=56 accounts for the fixed 56 px header bar above
       * so the KAV measures available height correctly on iOS (without this the
       * bar is double-counted and the view lifts too little).
       */}
      <KeyboardAvoidingView
        style={styles.scroll}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 56 : 0}
      >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Title with autocomplete from prior calendar events */}
        <View style={styles.titleWrapper}>
          <TextInput
            testID="event-create-title-input"
            style={styles.titleInput}
            placeholder={t('event.title_placeholder')}
            placeholderTextColor={colors.textSecondary}
            value={title}
            onChangeText={setTitle}
            onFocus={() => setTitleFocused(true)}
            onBlur={() => {
              // Delay so a tap on the suggestion row fires before the list hides.
              setTimeout(() => setTitleFocused(false), 150);
            }}
            autoFocus
            returnKeyType="done"
          />
          {titleFocused && titleSuggestions.length > 0 && (
            <View style={styles.titleSuggestList}>
              {titleSuggestions.map((s) => (
                <TouchableOpacity
                  key={s.id}
                  style={styles.titleSuggestRow}
                  onPress={() => pickTitleSuggestion(s)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.titleSuggestName} numberOfLines={1}>
                    {s.title}
                  </Text>
                  {s.location ? (
                    <Text style={styles.titleSuggestMeta} numberOfLines={1}>
                      {s.location}
                    </Text>
                  ) : null}
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

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
          <FormRow label={t('event.form.start')} rowStyle={rowStyle}>
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
            <FormRow label={t('event.form.end')} rowStyle={rowStyle}>
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
          <FormRow label={t('event.form.repeat')} rowStyle={rowStyle}>
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

          {/*
            Category — inline chip; tap to open the picker.  When a category
            is chosen the chip inherits its colour so the event's accent is
            visible at a glance before saving.
          */}
          <FormRow label={t('event.form.category')} rowStyle={rowStyle}>
            {(() => {
              const cat = categoryId ? categoryMap.get(categoryId) : null;
              return (
                <Pressable
                  style={[
                    styles.categoryChip,
                    cat && { backgroundColor: cat.color + '22', borderColor: cat.color },
                  ]}
                  onPress={() => setCategoryPickerVisible(true)}
                >
                  <Ionicons
                    name="pricetag-outline"
                    size={14}
                    color={cat ? cat.color : colors.textSecondary}
                  />
                  <Text
                    style={[
                      styles.categoryChipLabel,
                      cat && { color: cat.color },
                    ]}
                    numberOfLines={1}
                  >
                    {cat ? cat.name : t('planner.category_none', '없음')}
                  </Text>
                  <Ionicons
                    name="chevron-down"
                    size={14}
                    color={cat ? cat.color : colors.textSecondary}
                  />
                </Pressable>
              );
            })()}
          </FormRow>

          {/* Color picker — user can override the default category/member color */}
          <FormRow label={t('event.form.color')} rowStyle={rowStyle}>
            <ColorPicker value={eventColor} onChange={setEventColor} />
          </FormRow>

          {/* Location — GPS shortcut + Google Places Autocomplete (TASK-901 / TASK-1302) */}
          <FormRow label={t('event.form.location')} rowStyle={rowStyle}>
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
                  accessibilityLabel={t('event.form.current_location')}
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
          <FormRow label={t('event.form.memo')} rowStyle={rowStyle}>
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
            /*
             * testID="event-share-section" — e2e can assert the entire sharing
             * section is visible before checking individual toggles (IDEA-019 #7).
             */
            <View testID="event-share-section" style={styles.sharingSection}>
              <Text style={styles.sharingLabel}>{t('event.form.share_section')}</Text>
              {spaces.map((space) => {
                const selected = shareSpaceIds.includes(space.id);
                return (
                  <Pressable
                    key={space.id}
                    /*
                     * testID="event-share-toggle-{spaceId}" — stable identifier
                     * per Space so e2e can tap specific toggles without relying
                     * on name text that might change (IDEA-019 #7).
                     */
                    testID={`event-share-toggle-${space.id}`}
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
      </KeyboardAvoidingView>

      {/* Category picker — rendered at root so it overlays the whole screen */}
      <CategoryPickerSheet
        visible={categoryPickerVisible}
        selectedId={categoryId}
        onClose={() => setCategoryPickerVisible(false)}
        onSelect={(id) => {
          setCategoryId(id);
          setCategoryPickerVisible(false);
        }}
      />

      {/*
       * IDEA-019 — Free-time inline button (Tier 3 BottomSheet trigger).
       * Rendered at root level (above keyboard, below SafeArea bottom edge)
       * so it floats over the form. Only shown on native; on web the space
       * detail screen already has the finder panel.
       */}
      {Platform.OS !== 'web' && (
        <TouchableOpacity
          testID="event-create-find-free-time"
          style={styles.freeTimeBtn}
          onPress={handleOpenFreeTime}
          activeOpacity={0.8}
          accessibilityLabel={t('event.find_free_time')}
        >
          <Ionicons name="time-outline" size={16} color={colors.primary} />
          <Text style={styles.freeTimeBtnText}>{t('event.find_free_time')}</Text>
        </TouchableOpacity>
      )}

      {/*
       * IDEA-019 — FreeTimeRecommendSheet.
       * Opens when user taps the "빈 시간 찾기" button. Clicking an activity
       * pre-fills the title + time in the form via handleFreeTimeCreateEvent.
       */}
      <FreeTimeRecommendSheet
        slot={freeTimeSlot}
        onClose={() => setFreeTimeSlot(null)}
        onCreateEvent={handleFreeTimeCreateEvent}
      />

      {/*
       * IDEA-019 — SimpleToast overlay.
       * Shows "일정이 추가되었어요" briefly after a successful save.
       * Positioned at the SafeAreaView root so it sits above the home indicator.
       */}
      {toast && <SimpleToast toast={toast} />}
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
    paddingBottom: spacing[20],
  },

  // Title input
  titleWrapper: {
    position: 'relative',
    zIndex: 10,
  },
  titleInput: {
    ...textStyles.h3,
    color: colors.textPrimary,
    padding: spacing[5],
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  /**
   * Autocomplete dropdown from prior calendar events. Absolutely positioned
   * below the title field so it overlaps the first FormRow without pushing
   * the rest of the form down.
   */
  titleSuggestList: {
    position: 'absolute',
    left: spacing[2],
    right: spacing[2],
    top: '100%',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  titleSuggestRow: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  titleSuggestName: {
    ...textStyles.labelLg,
    color: colors.textPrimary,
  },
  titleSuggestMeta: {
    ...textStyles.caption,
    color: colors.textTertiary,
    marginTop: 2,
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
  // Inline category chip on the event-create form. Mirrors the planner
  // quick-add chip so the pattern is consistent across screens.
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    backgroundColor: colors.inputBackground,
    minHeight: 32,
  },
  categoryChipLabel: {
    ...textStyles.body,
    color: colors.textSecondary,
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
    paddingVertical: spacing[2],
    flex: 1,
  },
  multilineInput: {
    minHeight: 60,
    textAlignVertical: 'top',
  },

  // IDEA-019 — "빈 시간 찾기" inline button (above the form, floating)
  freeTimeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    gap: spacing[1],
    marginRight: spacing[5],
    marginTop: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  freeTimeBtnText: {
    ...textStyles.caption,
    color: colors.primary,
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
