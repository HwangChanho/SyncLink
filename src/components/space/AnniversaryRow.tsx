import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useColors } from '@/hooks/useColors';
import type { Anniversary } from '@/types';
import type { SpaceDetailStyles } from './spaceDetailStyles';

interface AnniversaryRowProps {
  anniversary: Anniversary;
  onDelete: () => void;
  colors: ReturnType<typeof useColors>;
  styles: SpaceDetailStyles;
}

/**
 * Format daysFromToday as Korean D-day string.
 *  0  → 'D-day'
 *  1  → 'D-1'  (내일)
 * -1  → 'D+1'  (어제)
 */
function formatDday(days: number): string {
  if (days === 0) return 'D-day';
  if (days > 0) return `D-${days}`;
  return `D+${Math.abs(days)}`;
}

/** Single anniversary row with D-day display and delete button. */
export function AnniversaryRow({
  anniversary,
  onDelete,
  colors: _colors,
  styles,
}: AnniversaryRowProps) {
  const { t } = useTranslation();
  const dLabel = formatDday(anniversary.daysFromToday);

  return (
    <View style={styles.anniversaryRow}>
      <View style={styles.anniversaryInfo}>
        <Text style={styles.anniversaryTitle}>{anniversary.title}</Text>
        <Text style={styles.anniversaryDate}>
          {anniversary.date.toLocaleDateString('ko-KR', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
          {anniversary.repeatYearly && t('anniversary.repeat_yearly')}
        </Text>
      </View>
      <View style={styles.anniversaryRight}>
        <Text style={styles.ddayLabel}>{dLabel}</Text>
        <TouchableOpacity
          onPress={onDelete}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={styles.deleteButton}
        >
          <Text style={styles.deleteText}>{t('anniversary.delete_button')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
