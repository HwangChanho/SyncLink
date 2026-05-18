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
  legs:      '하체',
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
        <Svg width="100%" height="100%" viewBox="0 0 200 340">
          {/* v1.1.1 — boxy 도형에서 곡선 anatomy 차트 스타일로 리워크.
              머리·목·어깨 라인 라운드 처리, 가슴→허리 잘록, 팔·다리는
              위쪽이 굵고 아래로 가면서 좁아지는 자연스러운 비율. 각 region 의
              hit area 는 그대로 onPress 로 부위 토글. */}

          {/* Head — slightly smaller + softer placement so neck/shoulder
              proportions feel natural. */}
          <Circle cx={100} cy={28} r={18} fill={fill.base} stroke={fill.stroke} strokeWidth={1.5} />

          {/* Neck (cosmetic). */}
          <Path
            d="M90 46 L110 46 L113 60 L87 60 Z"
            fill={fill.base}
            stroke={fill.stroke}
            strokeWidth={1.5}
          />

          {/* Shoulders — rounded yoke. Curves over the chest line for an
              anatomy-chart silhouette. */}
          <Path
            onPress={() => handleTap('shoulders')}
            d="M42 78 Q70 60 100 60 Q130 60 158 78 Q160 88 152 95 Q126 84 100 84 Q74 84 48 95 Q40 88 42 78 Z"
            fill={fillFor('shoulders')}
            stroke={fill.stroke}
            strokeWidth={1.5}
          />

          {/* Chest — rounded pectoral block. Wider at the top, tucks in
              toward the waist via the cubic curve. */}
          <Path
            onPress={() => handleTap('chest')}
            d="M58 95 Q62 92 75 94 L125 94 Q138 92 142 95 L138 145 Q100 152 62 145 Z"
            fill={fillFor('chest')}
            stroke={fill.stroke}
            strokeWidth={1.5}
          />

          {/* Core — abdomen narrows toward the hips. */}
          <Path
            onPress={() => handleTap('core')}
            d="M62 145 Q100 152 138 145 L132 198 Q100 204 68 198 Z"
            fill={fillFor('core')}
            stroke={fill.stroke}
            strokeWidth={1.5}
          />

          {/* Arms — tapered limbs (wider at the shoulder, narrow at the
              wrist). Single combined path with M between the two arms so
              they share the same fill / hit handler. */}
          <Path
            onPress={() => handleTap('arms')}
            d="M28 90 Q22 92 26 105 L34 195 Q34 202 42 202 Q52 202 54 195 L58 100 Q56 92 50 92 Z
               M172 90 Q178 92 174 105 L166 195 Q166 202 158 202 Q148 202 146 195 L142 100 Q144 92 150 92 Z"
            fill={fillFor('arms')}
            stroke={fill.stroke}
            strokeWidth={1.5}
          />

          {/* Legs — thighs wider at the hip, calves narrow at the ankle. */}
          <Path
            onPress={() => handleTap('legs')}
            d="M68 198 Q70 200 76 200 L96 200 Q98 202 96 215 L88 320 Q88 326 80 326 Q72 326 70 320 L66 218 Z
               M104 200 L124 200 Q130 200 132 198 L134 218 L130 320 Q128 326 120 326 Q112 326 112 320 L104 215 Q102 202 104 200 Z"
            fill={fillFor('legs')}
            stroke={fill.stroke}
            strokeWidth={1.5}
          />

          {/* Subtle face dots — purely cosmetic so the silhouette doesn't
              look like a blob. */}
          <Ellipse cx={93} cy={26} rx={1.8} ry={2.2} fill={fill.stroke} />
          <Ellipse cx={107} cy={26} rx={1.8} ry={2.2} fill={fill.stroke} />
          <Path d="M94 36 Q100 39 106 36" stroke={fill.stroke} strokeWidth={1} fill="none" />
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
      height: 300,
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
