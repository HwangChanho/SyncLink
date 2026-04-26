import React from 'react';
import { View, Text } from 'react-native';
import { useColors } from '@/hooks/useColors';
import type { FreeTimeSlot } from '@/types';
import type { SpaceDetailStyles } from './spaceDetailStyles';

interface FreeTimeSlotRowProps {
  slot: FreeTimeSlot;
  colors: ReturnType<typeof useColors>;
  styles: SpaceDetailStyles;
}

/**
 * Renders one free time slot with formatted date, time range, and duration.
 * e.g. "4월 21일 (화)  14:00 – 17:00  (3시간)"
 */
export function FreeTimeSlotRow({
  slot,
  colors: _colors,
  styles,
}: FreeTimeSlotRowProps) {
  const KO_WD = ['일', '월', '화', '수', '목', '금', '토'] as const;

  function fmt(d: Date): string {
    const h  = String(d.getHours()).padStart(2, '0');
    const m  = String(d.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }

  const start   = slot.startAt;
  const end     = slot.endAt;
  const wd      = KO_WD[start.getDay()] ?? '';
  const dateStr = `${start.getMonth() + 1}월 ${start.getDate()}일 (${wd})`;
  const timeStr = `${fmt(start)} – ${fmt(end)}`;
  const dur     = slot.durationMinutes >= 60
    ? `${Math.floor(slot.durationMinutes / 60)}시간${slot.durationMinutes % 60 > 0 ? ` ${slot.durationMinutes % 60}분` : ''}`
    : `${slot.durationMinutes}분`;

  return (
    <View style={styles.ftSlotRow}>
      <View style={styles.ftSlotDot} />
      <View style={styles.ftSlotInfo}>
        <Text style={styles.ftSlotDate}>{dateStr}</Text>
        <Text style={styles.ftSlotTime}>{timeStr}</Text>
      </View>
      <Text style={styles.ftSlotDur}>{dur}</Text>
    </View>
  );
}
