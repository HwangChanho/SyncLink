/**
 * BodyParts — v1.1 운동 일정 등록 silhouette picker.
 *
 * A stylised front-view human silhouette built from SVG paths. The user
 * taps a region to toggle which body part they trained. Cardio doesn't
 * map onto a body region cleanly so it sits below the silhouette as a
 * standalone chip; "back" similarly lives in the chip row because a
 * front-view drawing can't disambiguate front-of-shoulder from back.
 *
 * Read-only mode is used by the event detail screen — taps are
 * disabled and selected regions stay highlighted for review.
 *
 * Plan: docs/plans/2026-05-17-workout-event-type.md
 */

import { useCallback, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Svg, { Path, Circle, Ellipse } from 'react-native-svg';
import { useColors } from '@/hooks/useColors';
import type { WorkoutPartDb } from '@/types';
import { spacing, radius } from '@/constants/spacing';
import { textStyles } from '@/constants/typography';

/** Body parts the silhouette renders as tappable regions on the canvas. */
const SILHOUETTE_PARTS: WorkoutPartDb[] = ['chest', 'shoulders', 'arms', 'core', 'legs'];
/** Parts that live as chips below the silhouette (no clean front-view shape). */
const CHIP_PARTS: WorkoutPartDb[] = ['back', 'cardio'];

const PART_LABELS_KO: Record<WorkoutPartDb, string> = {
  chest:     '가슴',
  back:      '등',
  shoulders: '어깨',
  arms:      '팔',
  legs:      '다리',
  core:      '코어',
  cardio:    '유산소',
};

export interface BodyPartsProps {
  selected: WorkoutPartDb[];
  /** Tap handler. omit (or pass readOnly) to disable interaction. */
  onToggle?: (part: WorkoutPartDb) => void;
  readOnly?: boolean;
}

/**
 * Stylised silhouette. Each region is a separate SVG <Path>/<Circle> so we
 * can independently colour the selected ones. Coordinates are tuned for a
 * 200×320 viewBox; the parent should give the component a fixed height.
 */
export function BodyParts({ selected, onToggle, readOnly }: BodyPartsProps) {
  const colors = useColors();
  const styles = makeStyles(colors);

  const isSelected = useCallback(
    (part: WorkoutPartDb) => selected.includes(part),
    [selected],
  );
  const handleTap = useCallback(
    (part: WorkoutPartDb) => {
      if (readOnly || !onToggle) return;
      onToggle(part);
    },
    [onToggle, readOnly],
  );

  // Cache the per-part fill colour so SVG re-renders are cheap.
  const fill = useMemo(() => {
    const base = colors.surface;
    const active = colors.primary;
    const dim = colors.surface;
    return {
      base,
      active,
      dim,
      stroke: colors.border,
    };
  }, [colors]);

  // Helper to pick fill for a part — readOnly mode uses the same logic
  // but without the dim hover affordance.
  const fillFor = (part: WorkoutPartDb) =>
    isSelected(part) ? fill.active : fill.base;

  return (
    <View style={styles.container}>
      <View style={styles.svgWrap}>
        <Svg width="100%" height="100%" viewBox="0 0 200 320">
          {/* Head (decorative — not tappable). */}
          <Circle cx={100} cy={32} r={22} fill={fill.base} stroke={fill.stroke} strokeWidth={1.5} />

          {/* Shoulders — broad ellipse just below the head. */}
          <Path
            onPress={() => handleTap('shoulders')}
            d="M50 75 Q100 58 150 75 L150 92 Q100 80 50 92 Z"
            fill={fillFor('shoulders')}
            stroke={fill.stroke}
            strokeWidth={1.5}
          />

          {/* Chest — middle torso block. */}
          <Path
            onPress={() => handleTap('chest')}
            d="M62 92 L138 92 L138 145 L62 145 Z"
            fill={fillFor('chest')}
            stroke={fill.stroke}
            strokeWidth={1.5}
          />

          {/* Core — abdomen, narrower. */}
          <Path
            onPress={() => handleTap('core')}
            d="M66 145 L134 145 L130 198 L70 198 Z"
            fill={fillFor('core')}
            stroke={fill.stroke}
            strokeWidth={1.5}
          />

          {/* Arms — two long rectangles hugging the torso. */}
          <Path
            onPress={() => handleTap('arms')}
            d="M30 92 L58 92 L58 198 L30 198 Z M142 92 L170 92 L170 198 L142 198 Z"
            fill={fillFor('arms')}
            stroke={fill.stroke}
            strokeWidth={1.5}
          />

          {/* Legs — two long blocks from hip down. */}
          <Path
            onPress={() => handleTap('legs')}
            d="M70 198 L98 198 L94 304 L70 304 Z M102 198 L130 198 L130 304 L106 304 Z"
            fill={fillFor('legs')}
            stroke={fill.stroke}
            strokeWidth={1.5}
          />

          {/* Subtle face dots — purely cosmetic so the silhouette doesn't
              look like a blob. */}
          <Ellipse cx={92} cy={28} rx={2} ry={2.5} fill={fill.stroke} />
          <Ellipse cx={108} cy={28} rx={2} ry={2.5} fill={fill.stroke} />
        </Svg>
      </View>

      {/* Chip row for back + cardio. Same accent colour as silhouette
          selection so the visual language stays consistent. */}
      <View style={styles.chipRow}>
        {CHIP_PARTS.map((part) => {
          const active = isSelected(part);
          return (
            <Pressable
              key={part}
              onPress={() => handleTap(part)}
              disabled={readOnly}
              style={[
                styles.chip,
                active && { backgroundColor: colors.primary, borderColor: colors.primary },
              ]}
            >
              <Text style={[styles.chipText, active && { color: colors.textInverse }]}>
                {PART_LABELS_KO[part]}
              </Text>
            </Pressable>
          );
        })}
        {/* Silhouette parts also need a label row for accessibility / when
            taps on the SVG are visually ambiguous. Keep it compact. */}
        {SILHOUETTE_PARTS.map((part) => {
          if (!isSelected(part)) return null;
          return (
            <View key={`badge-${part}`} style={styles.activeBadge}>
              <Text style={[styles.chipText, { color: colors.textInverse, fontSize: 11 }]}>
                {PART_LABELS_KO[part]}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: {
      gap: spacing[2],
      alignItems: 'center',
    },
    svgWrap: {
      width: '100%',
      maxWidth: 220,
      height: 280,
    },
    chipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing[2],
      justifyContent: 'center',
    },
    chip: {
      paddingVertical: spacing[1],
      paddingHorizontal: spacing[3],
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    chipText: {
      ...(textStyles.labelSm as object),
      color: colors.textPrimary,
    },
    activeBadge: {
      paddingVertical: spacing[1],
      paddingHorizontal: spacing[3],
      borderRadius: radius.full,
      backgroundColor: colors.primary,
      borderWidth: 1,
      borderColor: colors.primary,
    },
  });
}
