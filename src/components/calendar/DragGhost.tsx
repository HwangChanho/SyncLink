/**
 * DragGhost — floating preview of the event being rescheduled.
 *
 * Rendered by WeekView/DayView while `useGridDragHandler` reports an
 * active dragState. Positioned absolutely in the day-columns container
 * so its (left, top) match the same coordinate system used by hit-testing.
 *
 * Visuals:
 *  - Same colour band + label as the resting EventBlock (kept simple so
 *    the user immediately recognises which event is moving).
 *  - Slightly elevated + scaled so it reads as "in flight".
 */

import { StyleSheet, Text, View } from 'react-native';

import type { DragState } from './useGridDragHandler';
import { useColors } from '@/hooks/useColors';
import { radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';

interface Props {
  drag: DragState;
}

export function DragGhost({ drag }: Props) {
  const colors = useColors();
  const styles = makeStyles(colors);

  // Place the ghost so its centre tracks the finger. Using the original
  // rect's width/height keeps the visual size stable during the drag.
  const left   = drag.fingerX - drag.rect.width  / 2;
  const top    = drag.fingerY - drag.rect.height / 2;
  const bgColor = `${drag.event.color}EE`;

  return (
    <View
      pointerEvents="none"
      testID="event-drag-ghost"
      style={[
        styles.ghost,
        {
          left,
          top,
          width:           drag.rect.width,
          height:          drag.rect.height,
          backgroundColor: bgColor,
          borderLeftColor: drag.event.color,
        },
      ]}
    >
      <Text style={styles.title} numberOfLines={drag.rect.height >= 38 ? 2 : 1}>
        {drag.event.title}
      </Text>
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    ghost: {
      position: 'absolute',
      borderLeftWidth: 3,
      borderRadius: radius.sm,
      paddingHorizontal: 4,
      paddingVertical: 2,
      overflow: 'hidden',
      // Visual lift: shadow + slight elevation so the chip floats above
      // the resting events on the grid.
      elevation: 8,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.25,
      shadowRadius: 6,
      transform: [{ scale: 1.04 }],
    },
    title: {
      ...textStyles.labelSm,
      color: colors.textPrimary,
    },
  });
}
