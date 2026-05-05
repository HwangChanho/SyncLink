/**
 * EventBlock — display-only event card for WeekView and DayView time grids.
 *
 * Positioned absolutely within a day column.
 * Supports overlapping event layout via widthFraction / leftFraction props.
 *
 * Drag-to-reschedule lives in EventBlockGestureHandler (RNGH + Reanimated).
 * EventBlock is the simple, gesture-free render path used by tests and any
 * non-interactive surface that just needs the visual chip.
 */

import { StyleSheet, Text, View } from 'react-native';
import type { EventSummary } from '@/types';
import { useColors } from '@/hooks/useColors';
import { radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';

/** Smallest height that still renders legibly (1-line title). */
const MIN_HEIGHT = 22;

/**
 * Diameter of the owner-indicator dot rendered on Space events.
 * Kept at 7px so it remains visible without overlapping the title text.
 */
const OWNER_DOT_SIZE = 7;

interface EventBlockProps {
  event: EventSummary;
  topOffset: number;
  height: number;
  widthFraction?: number;
  leftFraction?: number;
  /**
   * Tap handler — accepted for backwards-compatible call sites but no longer
   * wired locally. Tap-to-open is dispatched by useGridDragHandler.onTap so
   * the parent PanResponder owns all touches on the chip uncontested.
   */
  onPress?: (event: EventSummary) => void;
  /**
   * Optional pre-resolved translated title (Sprint 19 TASK-1907). Falls back
   * to event.title when undefined.
   */
  translatedTitle?: string;
  /**
   * Build-76 — overlap cluster 의 hidden 일정 수. 0 보면 indicator 없음.
   * 양수면 우측 상단에 "+N" 배지 표시.
   */
  hiddenCount?: number;
}

export function EventBlock({
  event,
  topOffset,
  height,
  widthFraction = 1,
  leftFraction = 0,
  translatedTitle,
  hiddenCount = 0,
}: EventBlockProps) {
  const colors = useColors();
  const styles = makeStyles(colors);

  const blockHeight = Math.max(height, MIN_HEIGHT);
  // Build-76 — narrow chip 에서 텍스트가 글자별 줄바꿈으로 깨지는 것 방지.
  // numberOfLines=2 는 1시간 이상 (60+) 의 chip 에서만 허용. 그보다 작으면
  // 1줄 ellipsize. (이전 임계 38 → 60.)
  const showSubtitle = blockHeight >= 60;
  const bgColor = `${event.color}CC`;

  return (
    <View
      testID="event-block"
      style={[
        styles.block,
        {
          backgroundColor: bgColor,
          borderLeftColor: event.color,
          top: topOffset,
          height: blockHeight,
          left: `${leftFraction * 100}%`,
          width: `${widthFraction * 100}%`,
        },
      ]}
    >
      <Text
        style={styles.title}
        numberOfLines={showSubtitle ? 2 : 1}
        ellipsizeMode="tail"
      >
        {translatedTitle ?? event.title}
      </Text>

      {!event.isOwn && (
        <View
          testID="owner-dot"
          style={[styles.ownerDot, { backgroundColor: event.color }]}
        />
      )}

      {/* Build-76 — overlap 시 hidden chip 수 indicator. */}
      {hiddenCount > 0 && (
        <View testID="overflow-badge" style={styles.overflowBadge}>
          <Text style={styles.overflowBadgeText}>+{hiddenCount}</Text>
        </View>
      )}
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    block: {
      position: 'absolute',
      borderLeftWidth: 3,
      borderRadius: radius.sm,
      paddingHorizontal: 4,
      paddingVertical: 2,
      overflow: 'hidden',
    },
    title: {
      ...textStyles.labelSm,
      color: colors.textPrimary,
    },
    ownerDot: {
      position: 'absolute',
      top: 3,
      right: 3,
      width: OWNER_DOT_SIZE,
      height: OWNER_DOT_SIZE,
      borderRadius: OWNER_DOT_SIZE / 2,
      borderWidth: 1,
      borderColor: 'rgba(255, 255, 255, 0.85)',
    },
    overflowBadge: {
      position: 'absolute',
      bottom: 2,
      right: 2,
      paddingHorizontal: 4,
      paddingVertical: 1,
      borderRadius: 8,
      backgroundColor: 'rgba(0, 0, 0, 0.55)',
    },
    overflowBadgeText: {
      ...textStyles.caption,
      color: '#FFFFFF',
      fontWeight: '700',
      fontSize: 10,
    },
  });
}
