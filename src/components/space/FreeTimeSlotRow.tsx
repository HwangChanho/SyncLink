/**
 * FreeTimeSlotRow — renders one free-time slot result card.
 *
 * Displays: date (e.g. "4월 21일 (화)"), time range ("14:00 – 17:00"),
 * duration ("3시간"), and an optional "이 시간에 만들기" CTA button.
 *
 * IDEA-019 — added optional `onCreateEvent` prop so the Space detail screen
 * can navigate directly to event/create with the slot's start/end prefilled,
 * shortening the flow from "find free time" → "create event".
 */

import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useColors } from '@/hooks/useColors';
import type { FreeTimeSlot } from '@/types';
import type { SpaceDetailStyles } from './spaceDetailStyles';
import { useTranslation } from 'react-i18next';

// ─── Props ────────────────────────────────────────────────────────────────────

interface FreeTimeSlotRowProps {
  /** The free-time slot data to display. */
  slot: FreeTimeSlot;
  /**
   * Active theme colors — passed from parent to avoid redundant hook calls
   * when rendering a list of rows. The underscore prefix silences the
   * "unused variable" lint rule since the row currently derives colours from
   * its own styles object.
   */
  colors: ReturnType<typeof useColors>;
  /** Shared Space detail styles from makeSpaceDetailStyles(). */
  styles: SpaceDetailStyles;
  /**
   * Optional handler for the "이 시간에 만들기" CTA button (IDEA-019).
   * When provided, a small primary button is rendered at the right edge of
   * each slot row. Tapping it passes the slot back to the caller so it can
   * navigate to event/create with start/end prefilled.
   *
   * @param slot - The free-time slot the user chose to schedule in
   */
  onCreateEvent?: (slot: FreeTimeSlot) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Formats a Date to "HH:MM" (zero-padded 24-hour format).
 *
 * @param d - Date to format
 * @returns Zero-padded time string, e.g. "09:05"
 */
function fmtTime(d: Date): string {
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * FreeTimeSlotRow — single row in the free-time results list.
 *
 * Layout: [dot] [date / time] [duration] [CTA button?]
 *
 * @param props - FreeTimeSlotRowProps
 */
export function FreeTimeSlotRow({
  slot,
  colors: _colors,  // kept for API stability; currently unused in row body
  styles,
  onCreateEvent,
}: FreeTimeSlotRowProps) {
  const { t } = useTranslation();

  // Korean weekday abbreviations (index = Date.getDay())
  const KO_WD = ['일', '월', '화', '수', '목', '금', '토'] as const;

  const start   = slot.startAt;
  const end     = slot.endAt;
  const wd      = KO_WD[start.getDay()] ?? '';

  // Build display strings
  const dateStr = `${start.getMonth() + 1}월 ${start.getDate()}일 (${wd})`;
  const timeStr = `${fmtTime(start)} – ${fmtTime(end)}`;
  const dur     = slot.durationMinutes >= 60
    ? `${Math.floor(slot.durationMinutes / 60)}시간${
        slot.durationMinutes % 60 > 0 ? ` ${slot.durationMinutes % 60}분` : ''
      }`
    : `${slot.durationMinutes}분`;

  return (
    <View style={styles.ftSlotRow} testID="free-time-slot-row">
      {/* Left accent dot — matches the Space primary colour */}
      <View style={styles.ftSlotDot} />

      {/* Date and time range text block */}
      <View style={styles.ftSlotInfo}>
        <Text style={styles.ftSlotDate}>{dateStr}</Text>
        <Text style={styles.ftSlotTime}>{timeStr}</Text>
      </View>

      {/* Duration badge (e.g. "2시간 30분") */}
      <Text style={styles.ftSlotDur}>{dur}</Text>

      {/*
       * IDEA-019 — "이 시간에 만들기" CTA.
       * Only rendered when parent supplies onCreateEvent. This keeps the
       * component backward-compatible with screens that don't need the button
       * (e.g. a future read-only summary view).
       */}
      {onCreateEvent ? (
        <TouchableOpacity
          testID="free-time-slot-create-btn"
          style={styles.ftSlotCTA}
          onPress={() => onCreateEvent(slot)}
          activeOpacity={0.8}
          accessibilityLabel={t('event.find_free_time')}
          accessibilityRole="button"
        >
          <Text style={styles.ftSlotCTAText}>
            {t('event.find_free_time')}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}
